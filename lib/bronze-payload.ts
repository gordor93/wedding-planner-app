const BRONZE_TEXT_KEYS = [
  'raw_text',
  'payload',
  'raw_payload',
  'content',
  'extracted_text',
  'document_text',
] as const;

export function bronzeRawText(row: Record<string, unknown> | null | undefined): string {
  if (!row) return '';
  for (const key of BRONZE_TEXT_KEYS) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}
