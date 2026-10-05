import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PDFParse } from 'pdf-parse';
import { bronzeRawText } from '@/lib/bronze-payload';
import { formatOpenAIError, transcribePdfWithOpenAI } from '@/lib/openai';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MIN_USEFUL_TEXT_LENGTH = 40;
const MAX_LOCAL_PAGES = 10;

const GEMINI_TRANSCRIBE_PROMPT = `You are an expert contract transcriber for a wedding planning application.
Read this document carefully. Extract and transcribe all visible textual content,
clauses, payment schedules, names, and terms exactly as written.
If the document is a scanned image, screenshot, blurry photo, or handwriting, use your vision capabilities to perform high-fidelity text extraction.
Return ONLY the extracted text lines. Do not add conversational introductions, summaries, or markdown fences.`;

type ExtractionMethod = 'pdf-parse' | 'openai' | 'cached';

function isPdf(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function normalizeExtractedText(text: string) {
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function hasUsefulText(text: string) {
  return normalizeExtractedText(text).replace(/---\s*page\s+\d+\s*---/gi, '').trim().length >= MIN_USEFUL_TEXT_LENGTH;
}

async function extractWithPdfParse(bytes: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: bytes.slice() });
  try {
    const result = await parser.getText({
      first: MAX_LOCAL_PAGES,
      lineEnforce: true,
      pageJoiner: '\n--- page page_number ---\n',
    });

    const pages = [...result.pages]
      .sort((a, b) => a.num - b.num)
      .map((page) => {
        const pageText = page.text?.trim() ?? '';
        if (!pageText) return '';
        return `--- page ${page.num} ---\n${pageText}`;
      })
      .filter(Boolean);

    return normalizeExtractedText(pages.join('\n\n') || result.text || '');
  } finally {
    await parser.destroy();
  }
}

async function extractWithOpenAI(bytes: Uint8Array): Promise<string> {
  return transcribePdfWithOpenAI(bytes, GEMINI_TRANSCRIBE_PROMPT);
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('contract') as File;
    const vendorType = (formData.get('vendorType') as string) || 'unassigned';

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    if (!isPdf(file)) {
      return NextResponse.json({ error: 'Please upload a PDF contract' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: cachedRows, error: cacheError } = await supabase
      .from('bronze_contract_raw_payloads')
      .select('*')
      .eq('file_name', file.name);

    if (cacheError) {
      console.warn('Bronze cache lookup failed:', cacheError.message);
    }

    const cached = cachedRows?.find((row) => hasUsefulText(bronzeRawText(row)));
    if (cached) {
      return NextResponse.json({
        id: cached.id,
        message: 'Reused prior Bronze text for this file (skipped OpenAI scan)',
        extractionMethod: 'cached',
      });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    let extractedText = '';
    let extractionMethod: ExtractionMethod = 'pdf-parse';

    try {
      extractedText = await extractWithPdfParse(bytes);
    } catch (error) {
      console.warn('pdf-parse text extraction failed:', error);
    }

    if (!hasUsefulText(extractedText)) {
      extractionMethod = 'openai';
      try {
        extractedText = await extractWithOpenAI(bytes);
      } catch (error) {
        throw new Error(formatOpenAIError(error));
      }
    }

    if (!extractedText) {
      throw new Error('No text could be extracted from this PDF with local parsing or OpenAI.');
    }

    const { data, error } = await supabase
      .from('bronze_contract_raw_payloads')
      .insert([
        {
          file_name: file.name,
          raw_text: extractedText,
          status: 'pending',
          vendor_type: vendorType,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error('Supabase Core Sync Error:', error);
      if (error.code === 'PGRST204' || /raw_text/i.test(error.message || '')) {
        throw new Error(
          "Bronze table is missing raw_text. Run supabase/bronze_contract_raw_payloads.sql in the Supabase SQL editor, then upload again."
        );
      }
      throw error;
    }

    return NextResponse.json({
      id: data.id,
      message: 'Scanned document processed',
      extractionMethod,
    });
  } catch (error: any) {
    console.error('Contract ingestion crash:', error.message);
    const message = error.message || 'Internal processing error';
    const status = /rate-limited|quota/i.test(message) ? 429 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
