import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import { PDFParse } from 'pdf-parse';

export const runtime = 'nodejs';

const MIN_USEFUL_TEXT_LENGTH = 40;

const GEMINI_TRANSCRIBE_PROMPT = `You are an expert contract transcriber for a wedding planning application.
Read this document carefully. Extract and transcribe all visible textual content,
clauses, payment schedules, names, and terms exactly as written.
If the document is a scanned image, screenshot, blurry photo, or handwriting, use your vision capabilities to perform high-fidelity text extraction.
Return ONLY the extracted text lines. Do not add conversational introductions, summaries, or markdown fences.`;

type ExtractionMethod = 'local' | 'gemini';

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

async function extractWithGemini(base64Data: string): Promise<string> {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      retryOptions: {
        attempts: 4,
      },
    },
  });

  const aiResponse = await ai.models.generateContent({
    model: 'gemini-3.5-flash',
    contents: [
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: base64Data,
        },
      },
      {
        text: GEMINI_TRANSCRIBE_PROMPT,
      },
    ],
  });

  return aiResponse.text?.trim() ?? '';
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
    const base64Data = Buffer.from(bytes).toString('base64');

    let extractedText = normalizeLocalPdfText(await extractLocalPdfText(bytes));
    let extractionMethod: ExtractionMethod = 'local';

    if (!hasUsefulText(extractedText)) {
      extractionMethod = 'gemini';
      extractedText = await extractWithGemini(base64Data);
    }

    if (!extractedText) {
      throw new Error('No text could be extracted from this PDF with local parsing or Gemini.');
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
