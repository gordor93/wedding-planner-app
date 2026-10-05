import { PDFParse } from 'pdf-parse';
import OpenAI from 'openai';

const OPENAI_MODEL = 'gpt-4o-mini';
const MAX_RENDER_PAGES = 10;
const PAGE_BATCH_SIZE = 3;
const SCREENSHOT_WIDTH = 512;
const RATE_LIMIT_COOLDOWN_MS = 120_000;

const transcriptionCache = new Map<string, string>();
const transcriptionInflight = new Map<string, Promise<string>>();
const rateLimitCooldownUntil = new Map<string, number>();

export type VendorDetails = {
  company_name: string;
  category: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  contracted_arrival_time: string | null;
  contracted_departure_time: string | null;
};

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY. Add it to .env.local and restart the dev server.');
  }

  return new OpenAI({ apiKey, timeout: 180_000, maxRetries: 0 });
}

function isRateLimitError(error: unknown) {
  const err = error as { status?: number; code?: string; message?: string };
  const message = `${err?.message || ''}`.toLowerCase();
  return (
    err?.status === 429 ||
    err?.code === 'rate_limit_exceeded' ||
    message.includes('rate limit')
  );
}

function cacheKeyForPdf(bytes: Uint8Array) {
  const mid = bytes[Math.floor(bytes.length / 2)] ?? 0;
  return `${bytes.length}:${bytes[0] ?? 0}:${mid}:${bytes[bytes.length - 1] ?? 0}`;
}

async function renderPdfPageImages(bytes: Uint8Array) {
  const parser = new PDFParse({ data: bytes.slice() });
  try {
    const screenshots = await parser.getScreenshot({
      first: MAX_RENDER_PAGES,
      desiredWidth: SCREENSHOT_WIDTH,
      imageBuffer: true,
      imageDataUrl: true,
    });

    return screenshots.pages
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map((page) => {
        if (page.dataUrl) return page.dataUrl;
        const base64 = Buffer.from(page.data).toString('base64');
        return `data:image/png;base64,${base64}`;
      });
  } finally {
    await parser.destroy();
  }
}

export function formatOpenAIError(error: unknown) {
  const err = error as {
    name?: string;
    status?: number;
    code?: string;
    message?: string;
    error?: { type?: string; code?: string; message?: string };
  };
  const message = `${err?.message || err?.error?.message || ''}`.toLowerCase();
  const code = `${err?.code || err?.error?.code || err?.error?.type || ''}`;

  if (
    code === 'insufficient_quota' ||
    message.includes('exceeded your current quota') ||
    message.includes('insufficient_quota')
  ) {
    return 'OpenAI billing quota is used up. Add credit or raise the usage limit at https://platform.openai.com/account/billing, then retry.';
  }

  if (err?.name === 'OpenAIRateLimitError' && err.message) {
    return err.message;
  }

  if (err?.status === 429 || code === 'rate_limit_exceeded' || message.includes('rate limit')) {
    return 'OpenAI rate-limited this request. Wait two minutes before uploading again. Extra clicks are blocked for this file so they will not spend more quota.';
  }

  if (message.includes('incorrect api key') || message.includes('invalid_api_key')) {
    return 'OpenAI rejected the API key. Check OPENAI_API_KEY in .env.local.';
  }

  if (message.includes('timed out') || message.includes('timeout')) {
    return 'OpenAI timed out while reading this PDF. Try again; large photo-style proposals can take a couple of minutes.';
  }

  return err?.message || 'OpenAI request failed';
}

function pickKeyPages(pages: string[]) {
  if (pages.length <= PAGE_BATCH_SIZE) return pages;
  const last = pages.length - 1;
  const middle = Math.floor(last / 2);
  return [pages[0], pages[middle], pages[last]];
}

export async function transcribePdfWithOpenAI(bytes: Uint8Array, prompt: string) {
  const cacheKey = cacheKeyForPdf(bytes);
  const cached = transcriptionCache.get(cacheKey);
  if (cached) return cached;

  const cooldownUntil = rateLimitCooldownUntil.get(cacheKey) ?? 0;
  if (Date.now() < cooldownUntil) {
    const waitSec = Math.ceil((cooldownUntil - Date.now()) / 1000);
    const error = new Error(
      `OpenAI rate-limited this request. Wait ${waitSec}s before uploading this file again.`
    );
    error.name = 'OpenAIRateLimitError';
    throw error;
  }

  const pending = transcriptionInflight.get(cacheKey);
  if (pending) return pending;

  const work = (async () => {
    const pageImages = pickKeyPages(await renderPdfPageImages(bytes));
    if (pageImages.length === 0) {
      throw new Error('Could not render PDF pages for transcription.');
    }

    const client = getOpenAIClient();
    try {
      const response = await client.responses.create(
        {
          model: OPENAI_MODEL,
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: `${prompt}\n\nThese are 3 key pages (cover, middle, last). Transcribe vendor name, client/couple name, event date, document type, and grand total. Mark the output as --- pages 1-3 ---.`,
                },
                ...pageImages.map((imageUrl) => ({
                  type: 'input_image' as const,
                  image_url: imageUrl,
                  detail: 'low' as const,
                })),
              ],
            },
          ],
        },
        { timeout: 180_000, maxRetries: 0 }
      );

      const text = response.output_text?.trim() ?? '';
      if (!text) {
        throw new Error('OpenAI did not return any text from this PDF.');
      }
      const marked = `--- pages 1-3 ---\n${text}`;
      transcriptionCache.set(cacheKey, marked);
      return marked;
    } catch (error) {
      if (isRateLimitError(error)) {
        rateLimitCooldownUntil.set(cacheKey, Date.now() + RATE_LIMIT_COOLDOWN_MS);
      }
      throw error;
    }
  })().finally(() => {
    transcriptionInflight.delete(cacheKey);
  });

  transcriptionInflight.set(cacheKey, work);
  return work;
}

export async function extractVendorDetailsWithOpenAI(rawText: string): Promise<VendorDetails> {
  const client = getOpenAIClient();

  const response = await client.responses.create({
    model: OPENAI_MODEL,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `Analyze this unstructured wedding contract text block carefully.
Extract the vendor metadata precisely.
Contract content:\n\n${rawText}`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'vendor_details',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            company_name: { type: 'string', description: 'The official name of the business/company' },
            category: { type: 'string', description: 'Type of vendor, e.g., decor, entertainment, catering' },
            contact_name: { type: ['string', 'null'], description: 'Main point of contact, or null' },
            email: { type: ['string', 'null'], description: 'Contact email, or null' },
            phone: { type: ['string', 'null'], description: 'Phone number, or null' },
            contracted_arrival_time: { type: ['string', 'null'], description: 'Arrival/setup time in HH:MM:SS, or null' },
            contracted_departure_time: { type: ['string', 'null'], description: 'Departure/breakdown time in HH:MM:SS, or null' },
          },
          required: [
            'company_name',
            'category',
            'contact_name',
            'email',
            'phone',
            'contracted_arrival_time',
            'contracted_departure_time',
          ],
        },
      },
    },
  });

  const parsedJsonText = response.output_text?.trim();
  if (!parsedJsonText) {
    throw new Error('OpenAI failed to generate a structured vendor layout.');
  }

  return JSON.parse(parsedJsonText) as VendorDetails;
}
