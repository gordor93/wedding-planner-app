import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PDFParse } from 'pdf-parse';
import { formatOpenAIError, transcribePdfWithOpenAI } from '@/lib/openai';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MIN_USEFUL_TEXT_LENGTH = 40;

const GEMINI_TRANSCRIBE_PROMPT = `You are an expert contract transcriber for a wedding planning application.
Read this document carefully. Extract and transcribe all visible textual content,
clauses, payment schedules, names, and terms exactly as written.
If the document is a scanned image, screenshot, blurry photo, or handwriting, use your vision capabilities to perform high-fidelity text extraction.
Return ONLY the extracted text lines. Do not add conversational introductions, summaries, or markdown fences.`;

type ExtractionMethod = 'local' | 'openai';

function isPdf(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function normalizeLocalPdfText(text: string) {
  return text
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasUsefulText(text: string) {
  return normalizeLocalPdfText(text).length >= MIN_USEFUL_TEXT_LENGTH;
}

async function extractLocalPdfText(bytes: Uint8Array): Promise<string> {
  try {
    const parser = new PDFParse({ data: bytes.slice() });
    try {
      const result = await parser.getText();
      const text = result.text?.trim() ?? '';
      if (text) return text;
    } finally {
      await parser.destroy();
    }
  } catch (error) {
    console.warn('pdf-parse failed, trying pdf-parse-fork:', error);
  }

  try {
    const pdfParseFork = (await import('pdf-parse-fork')).default as (buffer: Buffer) => Promise<{ text?: string }>;
    const result = await pdfParseFork(Buffer.from(bytes));
    return result.text?.trim() ?? '';
  } catch (error) {
    console.warn('pdf-parse-fork failed, trying pdf-text-reader:', error);
  }

  try {
    const { readPdfText } = await import('pdf-text-reader');
    return (await readPdfText({ data: bytes.slice() })).trim();
  } catch (error) {
    console.warn('Local PDF parsers could not extract text:', error);
    return '';
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

    const bytes = new Uint8Array(await file.arrayBuffer());

    let extractedText = normalizeLocalPdfText(await extractLocalPdfText(bytes));
    let extractionMethod: ExtractionMethod = 'local';

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

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

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
      throw error;
    }

    return NextResponse.json({
      id: data.id,
      message: 'Scanned document processed',
      extractionMethod,
    });
  } catch (error: any) {
    console.error('Contract ingestion crash:', error.message);
    return NextResponse.json({ error: error.message || 'Internal processing error' }, { status: 500 });
  }
}
