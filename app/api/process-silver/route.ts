import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from '@google/genai';

export async function POST(request: Request) {
  try {
    const { payloadId, weddingId } = await request.json();

    if (!payloadId) {
      return NextResponse.json({ error: 'Missing Bronze payload row ID' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Fetch the raw text payload from your Bronze table row
    const { data: bronzeData, error: bronzeError } = await supabase
      .from('bronze_contract_raw_payloads')
      .select('*')
      .eq('id', payloadId)
      .single();

    if (bronzeError || !bronzeData) {
      throw new Error(`Failed to fetch Bronze row payload: ${bronzeError?.message || 'Not found'}`);
    }

    // INITIALIZE GEMINI WITH AUTO-RETRY ALGORITHMS FOR 503 SECURITY SPIKES
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        retryOptions: {
          attempts: 4, // original request + 3 retries (default retryable codes include 429 and 5xx)
        },
      },
    });

    // Invoke Gemini 3.5 to transform unstructured string content into strict JSON schemas
    const aiResponse = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: [
        {
          text: `Analyze this unstructured wedding contract text block carefully. 
                 Extract the vendor's metadata profiles precisely according to the requested data formats.
                 Contract content:\n\n${bronzeData.raw_text}`
        }
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            company_name: { type: Type.STRING, description: 'The official name of the business/company' },
            category: { type: Type.STRING, description: 'Type of vendor, e.g., decor, entertainment, catering' },
            contact_name: { type: Type.STRING, description: 'The specific main point of contact person name, or null' },
            email: { type: Type.STRING, description: 'The contact email address found in document, or null' },
            phone: { type: Type.STRING, description: 'The phone number found in document, or null' },
            contracted_arrival_time: { type: Type.STRING, description: 'The explicit setup or arrival time in HH:MM:SS format, or null' },
            contracted_departure_time: { type: Type.STRING, description: 'The explicit breakdown or departure time in HH:MM:SS format, or null' }
          },
          required: ['company_name', 'category']
        }
      }
    });

    const parsedJsonText = aiResponse.text;
    if (!parsedJsonText) throw new Error('Gemini failed to generate a structured layout.');

    const vendorDetails = JSON.parse(parsedJsonText);

    // Insert structured data directly into your silver_vendors destination table
    const { data: newVendor, error: silverError } = await supabase
      .from('silver_vendors')
      .insert([
        {
          wedding_id: weddingId || null,
          company_name: vendorDetails.company_name,
          category: vendorDetails.category || bronzeData.vendor_type,
          contact_name: vendorDetails.contact_name || null,
          email: vendorDetails.email || null,
          phone: vendorDetails.phone || null,
          contracted_arrival_time: vendorDetails.contracted_arrival_time || null,
          contracted_departure_time: vendorDetails.contracted_departure_time || null
        }
      ])
      .select()
      .single();

    if (silverError) throw silverError;

    // Update the Bronze tracking marker status row to 'processed'
    await supabase
      .from('bronze_contract_raw_payloads')
      .update({ status: 'processed' })
      .eq('id', payloadId);

    return NextResponse.json({ 
      success: true, 
      message: 'Successfully parsed and populated Silver vendor profiles!',
      vendor: newVendor 
    });

  } catch (error: any) {
    console.error('Silver Layer Processing Crash:', error.message);
    return NextResponse.json({ error: error.message || 'Internal pipeline processing error' }, { status: 500 });
  }
}
