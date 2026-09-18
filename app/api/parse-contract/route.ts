import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
// @ts-ignore
import pdf from 'pdf-parse'; // changed to wildcard import to fix the ESM export crash
// @ts-ignore
import mammoth from 'mammoth';

// Initialize server-side Supabase client using secret environmental values
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function POST(request: NextRequest) {
  try {
    // 1. Extract the form data payload coming from the browser frontend
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const vendorType = formData.get('vendorType') as string;

    if (!file) {
      return NextResponse.json({ error: 'No file provided in the upload request' }, { status: 400 });
    }

    // 2. Convert the uploaded file data into a raw Node.js buffer memory segment
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let extractedText = '';

    // 3. Conditional routine to pick the correct parsing package based on the file type
    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
      // Run pdf-parse text extraction
      const pdfparser = (pdf.default ||pdf) as any
      const pdfData = await pdf(buffer);
      extractedText = pdfData.text;
    } else if (file.name.endsWith('.docx')) {
      // Run mammoth text extraction for Word documents
      const wordResult = await mammoth.extractRawText({ buffer: buffer });
      extractedText = wordResult.value;
    } else {
      return NextResponse.json({ error: 'Unsupported file type. Please upload a PDF or DOCX file' }, { status: 400 });
    }

    if (!extractedText || extractedText.trim() === '') {
      return NextResponse.json({ error: 'Could not extract any clean text from this document' }, { status: 422 });
    }

    // 4. Save the real scraped text block straight into your Bronze database table
    const { data, error } = await supabase
      .from('bronze_contract_new_payloads')
      .insert([
        {
          file_name: file.name,
          raw_text: extractedText, // This now holds the actual full sentences of the contract!
          vendor_type: vendorType,
          status: 'pending'
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('Supabase DB error:', error);
      return NextResponse.json({ error: `Database insert failed: ${error.message}` }, { status: 500 });
    }

    // 5. Send a clean response back to the client layout confirming processing completion
    return NextResponse.json({
      success: true,
      message: 'Contract text successfully extracted and saved to database',
      record: data
    });

  } catch (err: any) {
    console.error('Parser server route crashed:', err);
    return NextResponse.json({ error: `Internal Server Error: ${err.message}` }, { status: 500 });
  }
}