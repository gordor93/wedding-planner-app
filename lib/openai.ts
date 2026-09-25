import OpenAI, { toFile } from 'openai';

const OPENAI_MODEL = 'gpt-4o';

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

  return new OpenAI({ apiKey, timeout: 180_000, maxRetries: 1 });
}

export function formatOpenAIError(error: unknown) {
  const err = error as { status?: number; code?: string; message?: string };
  const message = `${err?.message || ''}`.toLowerCase();

  if (err?.status === 429 || message.includes('quota') || message.includes('rate limit')) {
    return 'OpenAI rate limit or quota was hit. Wait a minute and try again, or check billing at https://platform.openai.com/account/billing.';
  }

  if (message.includes('incorrect api key') || message.includes('invalid_api_key')) {
    return 'OpenAI rejected the API key. Check OPENAI_API_KEY in .env.local.';
  }

  if (message.includes('timed out') || message.includes('timeout')) {
    return 'OpenAI timed out while reading this PDF. Try again; large photo-style proposals can take a couple of minutes.';
  }

  return err?.message || 'OpenAI request failed';
}

export async function transcribePdfWithOpenAI(bytes: Uint8Array, prompt: string) {
  const client = getOpenAIClient();
  const uploaded = await client.files.create({
    file: await toFile(Buffer.from(bytes), 'contract.pdf', { type: 'application/pdf' }),
    purpose: 'user_data',
  });

  try {
    const response = await client.responses.create(
      {
        model: OPENAI_MODEL,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_file', file_id: uploaded.id },
              { type: 'input_text', text: prompt },
            ],
          },
        ],
      },
      { timeout: 180_000, maxRetries: 1 }
    );

    const text = response.output_text?.trim() ?? '';
    if (!text) {
      throw new Error('OpenAI did not return any text from this PDF.');
    }

    return text;
  } finally {
    try {
      await client.files.delete(uploaded.id);
    } catch (error) {
      console.warn('Could not delete temporary OpenAI file:', error);
    }
  }
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
