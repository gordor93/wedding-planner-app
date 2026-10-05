import {
  normalizeVendorType,
  SILVER_VENDOR_TYPES,
  type PaymentMilestone,
  type SilverContract,
  type SilverVendorType,
} from '@/lib/parse-contractroute';

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MONTHS: Record<string, string> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
};

const CONTRACT_TYPES = ['proposal', 'contract', 'invoice', 'agreement'] as const;

export type SilverContractPgRow = {
  wedding_id: string | null;
  bronze_payload_id: string;
  vendor_id: string | null;
  vendor_name: string | null;
  vendor_type: string | null;
  contract_type: string | null;
  client_name: string | null;
  event_date: string | null;
  grand_total: number | null;
  payment_milestones: Array<{ due_date: string | null; amount: number | null }>;
};

export type SilverCastResult = {
  row: SilverContractPgRow | null;
  errors: string[];
  warnings: string[];
};

export function sanitizeText(value: unknown, maxLength = 200): string {
  return String(value ?? '')
    .replace(CONTROL_CHARS, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function asUuid(value: unknown): string | null {
  const text = sanitizeText(value, 36);
  return UUID_RE.test(text) ? text.toLowerCase() : null;
}

export function asNumeric(value: unknown): number | null {
  const match = String(value ?? '')
    .replace(/,/g, '')
    .match(/-?\d+(?:\.\d{1,2})?/);
  if (!match) return null;
  const amount = Number(match[0]);
  if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) return null;
  return Math.round(amount * 100) / 100;
}

export function asDate(value: unknown): string | null {
  const text = sanitizeText(value, 40);
  if (!text) return null;

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return toValidIsoDate(iso[1], iso[2], iso[3]);

  const numeric = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (numeric) {
    const month = numeric[1].padStart(2, '0');
    const day = numeric[2].padStart(2, '0');
    const year = numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3];
    return toValidIsoDate(year, month, day);
  }

  const named = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i
  );
  if (named) {
    const month = MONTHS[named[1].toLowerCase().replace('.', '')];
    if (!month) return null;
    return toValidIsoDate(named[3], month, named[2].padStart(2, '0'));
  }

  return null;
}

function toValidIsoDate(year: string, month: string, day: string): string | null {
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

export function asContractType(value: unknown): string | null {
  const text = sanitizeText(value, 40).toLowerCase();
  if (!text) return null;
  return CONTRACT_TYPES.find((type) => text.includes(type)) || null;
}

export function extractSilverFieldsWithRegex(rawText: string): SilverContract {
  const text = rawText.replace(CONTROL_CHARS, ' ');

  const clientMatch =
    text.match(/\bprepared for\b[:\s]+([^\n]{3,80})/i) ||
    text.match(/\bclient\b[:\s]+([^\n]{3,80})/i) ||
    text.match(/\bcouple\b[:\s]+([^\n]{3,80})/i);

  const vendorMatch =
    text.match(/\b(?:vendor|company|studio|florist)\b[:\s]+([^\n]{3,80})/i) ||
    text.match(/\b(flower lab(?:\s+design)?)\b/i);

  const totalMatch =
    text.match(/\bgrand\s*total\b[:\s]*\$?\s*([\d,]+(?:\.\d{2})?)/i) ||
    text.match(/\btotal due\b[:\s]*\$?\s*([\d,]+(?:\.\d{2})?)/i) ||
    text.match(/\$\s*([\d,]+(?:\.\d{2})?)/);

  const dateMatch =
    text.match(
      /\b(?:wedding date|event date|date)\b[:\s]*([A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i
    ) ||
    text.match(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/i
    );

  const vendorTypeHint = [
    /\b(florist|floral|flowers)\b/i.test(text) ? 'florist' : '',
    /\b(dj|entertainment|music)\b/i.test(text) ? 'dj' : '',
    /\b(photo(?:graphy)?|video|media)\b/i.test(text) ? 'photo' : '',
    /\bcatering|food\b/i.test(text) ? 'catering' : '',
    /\bvenue\b/i.test(text) ? 'venue' : '',
  ]
    .map((value) => normalizeVendorType(value))
    .find(Boolean);

  return {
    vendor_name: sanitizeText(vendorMatch?.[1] || ''),
    vendor_type: vendorTypeHint || '',
    contract_type: asContractType(text) || '',
    client_name: sanitizeText(clientMatch?.[1] || ''),
    event_date: sanitizeText(dateMatch?.[1] || dateMatch?.[0] || '', 40),
    grand_total: totalMatch?.[1] || '',
    payment_milestones: [],
  };
}

function mergeExtractedFields(primary: SilverContract, fallback: SilverContract): SilverContract {
  return {
    vendor_name: primary.vendor_name || fallback.vendor_name,
    vendor_type: primary.vendor_type || fallback.vendor_type,
    contract_type: primary.contract_type || fallback.contract_type,
    client_name: primary.client_name || fallback.client_name,
    event_date: primary.event_date || fallback.event_date,
    grand_total: primary.grand_total || fallback.grand_total,
    payment_milestones:
      primary.payment_milestones?.length > 0 ? primary.payment_milestones : fallback.payment_milestones,
  };
}

function castMilestones(milestones: PaymentMilestone[] | undefined) {
  if (!Array.isArray(milestones)) return [];
  return milestones
    .map((item) => ({
      due_date: asDate(item?.due_date),
      amount: asNumeric(item?.amount),
    }))
    .filter((item) => item.due_date || item.amount !== null);
}

export function castSilverContractForPostgres(input: {
  extracted: SilverContract;
  rawText: string;
  payloadId: unknown;
  weddingId: unknown;
  vendorId: unknown;
  vendorTypeHint?: unknown;
}): SilverCastResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const extracted = mergeExtractedFields(input.extracted, extractSilverFieldsWithRegex(input.rawText));

  const bronzePayloadId = asUuid(input.payloadId);
  if (!bronzePayloadId) {
    errors.push('bronze_payload_id is not a valid uuid');
  }

  const weddingId = asUuid(input.weddingId);
  if (input.weddingId && !weddingId) {
    warnings.push('wedding_id was not a valid uuid and was stored as null');
  }

  const vendorId = asUuid(input.vendorId);
  if (input.vendorId && !vendorId) {
    warnings.push('vendor_id was not a valid uuid and was stored as null');
  }

  const vendorName = sanitizeText(extracted.vendor_name, 120) || null;
  const clientName = sanitizeText(extracted.client_name, 120) || null;
  const vendorType =
    normalizeVendorType(extracted.vendor_type, normalizeVendorType(String(input.vendorTypeHint || ''))) || null;
  const contractType = asContractType(extracted.contract_type) || asContractType(input.rawText);
  const eventDate = asDate(extracted.event_date) || asDate(input.rawText);
  const grandTotal = asNumeric(extracted.grand_total) ?? asNumeric(
    input.rawText.match(/\bgrand\s*total\b[:\s]*\$?\s*([\d,]+(?:\.\d{2})?)/i)?.[1]
  );

  if (!vendorName) warnings.push('vendor_name could not be parsed');
  if (!clientName) warnings.push('client_name could not be parsed');
  if (!eventDate) warnings.push('event_date could not be cast to date');
  if (grandTotal === null) warnings.push('grand_total could not be cast to numeric');
  if (vendorType && !SILVER_VENDOR_TYPES.includes(vendorType as SilverVendorType)) {
    warnings.push('vendor_type was not a known category');
  }

  if (!bronzePayloadId) {
    return { row: null, errors, warnings };
  }

  return {
    row: {
      wedding_id: weddingId,
      bronze_payload_id: bronzePayloadId,
      vendor_id: vendorId,
      vendor_name: vendorName,
      vendor_type: vendorType,
      contract_type: contractType,
      client_name: clientName,
      event_date: eventDate,
      grand_total: grandTotal,
      payment_milestones: castMilestones(extracted.payment_milestones),
    },
    errors,
    warnings,
  };
}
