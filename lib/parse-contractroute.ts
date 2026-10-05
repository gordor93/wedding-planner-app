import OpenAI from 'openai';

const MAX_CONTRACT_CHARS = 40_000;
const MAX_SILVER_PARSE_CHARS = 8_000;
const OPENAI_MODEL = 'gpt-4o-mini';
export const SILVER_PAGE_BATCH_SIZE = 3;

const SILVER_PRESCAN_PATTERNS = [
  /\bvendor\b/i,
  /\bcompany\b/i,
  /\bstudio\b/i,
  /\bflorist\b/i,
  /\bfloral\b/i,
  /\bflower lab\b/i,
  /\bdj\b/i,
  /\bphotographer\b/i,
  /\bphotography\b/i,
  /\bcatering\b/i,
  /\bvenue\b/i,
  /\bclient\b/i,
  /\bcouple\b/i,
  /\bprepared for\b/i,
  /\bbride\b/i,
  /\bgroom\b/i,
  /\bwedding date\b/i,
  /\bevent date\b/i,
  /\bceremony\b/i,
  /\bgrand total\b/i,
  /\btotal due\b/i,
  /\binvestment\b/i,
  /\bbalance\b/i,
  /\bsubtotal\b/i,
  /\bproposal\b/i,
  /\bcontract\b/i,
  /\binvoice\b/i,
  /\bagreement\b/i,
  /\$\s?\d[\d,]*(?:\.\d{2})?/,
];

export type PaymentMilestone = {
  due_date: string;
  amount: string;
};

export const SILVER_VENDOR_TYPES = [
  'entertainment',
  'decor',
  'catering',
  'venue',
  'media',
] as const;

export type SilverVendorType = (typeof SILVER_VENDOR_TYPES)[number];

export type SilverContract = {
  vendor_name: string;
  vendor_type: string;
  contract_type: string;
  client_name: string;
  event_date: string;
  grand_total: string;
  payment_milestones: PaymentMilestone[];
};

export type SilverContractRow = SilverContract & {
  wedding_id: string | null;
  bronze_payload_id: string;
  vendor_id: string | null;
};

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY. Add it to .env.local and restart the dev server.');
  }

  return new OpenAI({ apiKey, timeout: 180_000, maxRetries: 1 });
}

const VENDOR_TYPE_ALIASES: Record<string, SilverVendorType> = {
  entertainment: 'entertainment',
  dj: 'entertainment',
  music: 'entertainment',
  decor: 'decor',
  florist: 'decor',
  floral: 'decor',
  flowers: 'decor',
  catering: 'catering',
  food: 'catering',
  venue: 'venue',
  media: 'media',
  photography: 'media',
  photo: 'media',
  video: 'media',
};

export function normalizeVendorType(value: string | null | undefined, fallback = ''): string {
  const key = (value || '').trim().toLowerCase();
  if (!key) return fallback;
  return VENDOR_TYPE_ALIASES[key] || (SILVER_VENDOR_TYPES.includes(key as SilverVendorType) ? key : fallback);
}

export function parseGrandTotal(value: string | null | undefined): number | null {
  if (!value) return null;
  const numeric = value.replace(/[^0-9.]/g, '');
  if (!numeric) return null;
  const amount = Number(numeric);
  return Number.isFinite(amount) ? amount : null;
}

function mergeRanges(ranges: Array<{ start: number; end: number }>) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];

  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || range.start > previous.end) {
      merged.push({ ...range });
    } else {
      previous.end = Math.max(previous.end, range.end);
    }
  }

  return merged;
}

export function prescanSilverContractText(rawContractText: string): string {
  const text = rawContractText.trim();
  if (!text) return '';
  if (text.length <= MAX_SILVER_PARSE_CHARS) return text;

  const windowSize = 280;
  const ranges: Array<{ start: number; end: number }> = [
    { start: 0, end: Math.min(text.length, 2_000) },
    { start: Math.max(0, text.length - 2_000), end: text.length },
  ];

  for (const pattern of SILVER_PRESCAN_PATTERNS) {
    const matcher = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    for (const match of text.matchAll(matcher)) {
      const index = match.index ?? 0;
      ranges.push({
        start: Math.max(0, index - windowSize),
        end: Math.min(text.length, index + match[0].length + windowSize),
      });
    }
  }

  const excerpt = mergeRanges(ranges)
    .map((range) => text.slice(range.start, range.end).trim())
    .filter(Boolean)
    .join('\n\n---\n\n');

  if (excerpt.length <= MAX_SILVER_PARSE_CHARS) return excerpt;
  return `${excerpt.slice(0, 4_000)}\n\n---\n\n${excerpt.slice(-4_000)}`;
}

export function splitContractPages(rawContractText: string): string[] {
  const text = rawContractText.trim();
  if (!text) return [];

  const marked = text
    .split(/--\s*\d+\s+of\s+\d+\s*--|---\s*pages?\s+\d+(?:\s*-\s*\d+)?\s*---/i)
    .map((part) => part.trim())
    .filter(Boolean);

  if (marked.length > 1) return marked;

  const chunkSize = 1_800;
  if (text.length <= chunkSize * SILVER_PAGE_BATCH_SIZE) return [text];

  const pages: string[] = [];
  for (let index = 0; index < text.length; index += chunkSize) {
    pages.push(text.slice(index, index + chunkSize));
  }
  return pages;
}

function chunkPages(pages: string[], size: number) {
  const batches: string[][] = [];
  for (let index = 0; index < pages.length; index += size) {
    batches.push(pages.slice(index, index + size));
  }
  return batches;
}

export function mergeSilverContracts(parts: SilverContract[]): SilverContract {
  const merged: SilverContract = {
    vendor_name: '',
    vendor_type: '',
    contract_type: '',
    client_name: '',
    event_date: '',
    grand_total: '',
    payment_milestones: [],
  };

  for (const part of parts) {
    merged.vendor_name = merged.vendor_name || part.vendor_name;
    merged.vendor_type = merged.vendor_type || part.vendor_type;
    merged.contract_type = merged.contract_type || part.contract_type;
    merged.client_name = merged.client_name || part.client_name;
    merged.event_date = merged.event_date || part.event_date;
    if (part.grand_total) merged.grand_total = part.grand_total;
    if (part.payment_milestones?.length) merged.payment_milestones = part.payment_milestones;
  }

  return merged;
}

export async function parseSilverContractInPageBatches(
  rawContractText: string,
  options?: { vendorTypeHint?: string }
): Promise<SilverContract> {
  const pages = splitContractPages(rawContractText);
  const batches = chunkPages(pages.length ? pages : [rawContractText], SILVER_PAGE_BATCH_SIZE);
  const excerpts = batches.map((batch) => prescanSilverContractText(batch.join('\n\n')));
  const combined = prescanSilverContractText(excerpts.filter(Boolean).join('\n\n--- pages ---\n\n'));
  return parseProcessSilver(combined || rawContractText, options);
}

export async function parseProcessSilver(
  rawContractText: string,
  options?: { vendorTypeHint?: string }
): Promise<SilverContract> {
  if (rawContractText.length > MAX_CONTRACT_CHARS) {
    throw new Error('Contract exceeds the 10-page operational limit');
  }

  const vendorTypeHint = options?.vendorTypeHint?.trim() || 'unassigned';

  try {
    const client = getOpenAIClient();
    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `You extract structured wedding-document data for a planning app.
Analyze this batch of up to 3 wedding-document pages. Extract only silver_contracts fields that are visible in this batch: vendor_name, vendor_type, contract_type, client_name, event_date, and grand_total.
vendor_type must be one of: entertainment, decor, catering, venue, media.
Map florist/floral to decor, DJ/music to entertainment, photo/video to media.
The planner classified this upload as: ${vendorTypeHint}. Use that vendor_type if the document does not clearly state a category.
grand_total is the document grand total / overall service cost as digits only (example 12450.00), with no currency symbol or commas. Empty string if no total is stated.
If a field is not present, use an empty string or an empty array. Do not invent names, dates, or totals.

Document text:
${rawContractText}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'silver_contract',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              vendor_name: {
                type: 'string',
                description: 'Business name on the document, for example Flower Lab Design',
              },
              vendor_type: {
                type: 'string',
                description: 'One of entertainment, decor, catering, venue, media',
              },
              contract_type: {
                type: 'string',
                description: 'Document kind such as proposal, contract, or invoice',
              },
              client_name: {
                type: 'string',
                description: 'Couple or client name on the document',
              },
              event_date: {
                type: 'string',
                description: 'Wedding or event date as written or ISO YYYY-MM-DD',
              },
              grand_total: {
                type: 'string',
                description: 'Overall cost as digits only, or empty if not stated',
              },
              payment_milestones: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    due_date: { type: 'string', description: 'Payment due date, or empty if not stated' },
                    amount: { type: 'string', description: 'Payment amount including currency if present' },
                  },
                  required: ['due_date', 'amount'],
                },
              },
            },
            required: [
              'vendor_name',
              'vendor_type',
              'contract_type',
              'client_name',
              'event_date',
              'grand_total',
              'payment_milestones',
            ],
          },
        },
      },
    });

    const parsedJsonText = response.output_text?.trim();
    if (!parsedJsonText) {
      throw new Error('OpenAI returned an empty structured contract payload.');
    }

    const parsed = JSON.parse(parsedJsonText) as SilverContract;
    parsed.vendor_type = normalizeVendorType(parsed.vendor_type, normalizeVendorType(vendorTypeHint));
    return parsed;
  } catch (error) {
    console.error('parseProcessSilver failed:', error);
    throw error;
  }
}
