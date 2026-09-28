import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { formatOpenAIError } from '@/lib/openai';
import { parseProcessSilver } from '@/lib/parse-contractroute';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_CONTRACT_CHARS = 40_000;

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

    const { data: bronzeData, error: bronzeError } = await supabase
      .from('bronze_contract_raw_payloads')
      .select('*')
      .eq('id', payloadId)
      .single();

    if (bronzeError || !bronzeData) {
      throw new Error(`Failed to fetch Bronze row payload: ${bronzeError?.message || 'Not found'}`);
    }

    const rawContractText = String(bronzeData.raw_text || '');
    if (rawContractText.length > MAX_CONTRACT_CHARS) {
      throw new Error('Contract exceeds the 10-page operational limit');
    }

    const silverContract = await parseProcessSilver(rawContractText);

    let vendorId: string | null = null;
    if (weddingId) {
      const { data: linkedVendor, error: vendorLookupError } = await supabase
        .from('silver_vendors')
        .select('id')
        .eq('wedding_id', weddingId)
        .eq('category', silverContract.vendor_type || bronzeData.vendor_type)
        .maybeSingle();

      if (!vendorLookupError) {
        vendorId = linkedVendor?.id || null;
      }
    }

    const { data: newContract, error: silverError } = await supabase
      .from('silver_contracts')
      .insert([
        {
          wedding_id: weddingId || null,
          bronze_payload_id: payloadId,
          vendor_id: vendorId,
          vendor_name: silverContract.vendor_name,
          vendor_type: silverContract.vendor_type || bronzeData.vendor_type,
          contract_type: silverContract.contract_type,
          client_name: silverContract.client_name,
          event_date: silverContract.event_date,
          payment_milestones: silverContract.payment_milestones,
        },
      ])
      .select()
      .single();

    if (silverError) throw silverError;

    await supabase
      .from('bronze_contract_raw_payloads')
      .update({ status: 'processed' })
      .eq('id', payloadId);

    return NextResponse.json({
      success: true,
      message: 'Successfully parsed the bronze contract into silver_contracts.',
      contract: newContract,
    });
  } catch (error: any) {
    console.error('Silver Layer Processing Crash:', error.message);
    const message =
      error.message === 'Contract exceeds the 10-page operational limit'
        ? error.message
        : formatOpenAIError(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
