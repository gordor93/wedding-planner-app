import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { formatOpenAIError } from '@/lib/openai';
import { parseSilverContractInPageBatches, type SilverContract } from '@/lib/parse-contractroute';
import { castSilverContractForPostgres } from '@/lib/silver-contract-sanitize';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_CONTRACT_CHARS = 40_000;

function emptySilverContract(): SilverContract {
  return {
    vendor_name: '',
    vendor_type: '',
    contract_type: '',
    client_name: '',
    event_date: '',
    grand_total: '',
    payment_milestones: [],
  };
}

export async function POST(request: Request) {
  let payloadId: unknown = null;

  try {
    const body = await request.json();
    payloadId = body.payloadId;
    const weddingId = body.weddingId;

    if (!payloadId) {
      return NextResponse.json(
        { success: false, error: 'Missing Bronze payload row ID', errors: ['payloadId is required'] },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: bronzeData, error: bronzeError } = await supabase
      .from('bronze_contract_raw_payloads')
      .select('*')
      .eq('id', payloadId)
      .maybeSingle();

    if (bronzeError || !bronzeData) {
      return NextResponse.json(
        {
          success: false,
          error: 'Bronze payload was not found',
          errors: [bronzeError?.message || 'Not found'],
        },
        { status: 200 }
      );
    }

    const { data: existingContract } = await supabase
      .from('silver_contracts')
      .select('*')
      .eq('bronze_payload_id', payloadId)
      .maybeSingle();

    if (existingContract) {
      return NextResponse.json({
        success: true,
        message: 'Reused existing silver_contracts row for this Bronze payload.',
        contract: existingContract,
        warnings: [],
      });
    }

    const rawContractText = String(bronzeData.raw_text || '');
    if (rawContractText.length > MAX_CONTRACT_CHARS) {
      await supabase
        .from('bronze_contract_raw_payloads')
        .update({ status: 'failed_validation' })
        .eq('id', bronzeData.id);

      return NextResponse.json(
        {
          success: false,
          error: 'Contract exceeds the 10-page operational limit',
          errors: ['raw_text exceeds 40000 characters'],
        },
        { status: 200 }
      );
    }

    let extracted = emptySilverContract();
    const parseWarnings: string[] = [];
    try {
      extracted = await parseSilverContractInPageBatches(rawContractText, {
        vendorTypeHint: bronzeData.vendor_type,
      });
    } catch (error) {
      parseWarnings.push(formatOpenAIError(error));
    }

    let vendorId: string | null = null;
    if (weddingId) {
      try {
        const { data: linkedVendor, error: vendorLookupError } = await supabase
          .from('silver_vendors')
          .select('id')
          .eq('wedding_id', weddingId)
          .eq('category', extracted.vendor_type || bronzeData.vendor_type)
          .maybeSingle();

        if (!vendorLookupError) {
          vendorId = linkedVendor?.id || null;
        }
      } catch (error) {
        parseWarnings.push(`vendor lookup skipped: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }

    const cast = castSilverContractForPostgres({
      extracted,
      rawText: rawContractText,
      payloadId: bronzeData.id,
      weddingId,
      vendorId,
      vendorTypeHint: bronzeData.vendor_type,
    });
    const warnings = [...parseWarnings, ...cast.warnings];

    if (!cast.row) {
      await supabase
        .from('bronze_contract_raw_payloads')
        .update({ status: 'failed_validation' })
        .eq('id', bronzeData.id);

      return NextResponse.json(
        {
          success: false,
          error: 'Silver row failed validation and was skipped',
          errors: cast.errors,
          warnings,
        },
        { status: 200 }
      );
    }

    const { data: newContract, error: silverError } = await supabase
      .from('silver_contracts')
      .insert([cast.row])
      .select()
      .maybeSingle();

    if (silverError || !newContract) {
      await supabase
        .from('bronze_contract_raw_payloads')
        .update({ status: 'failed_validation' })
        .eq('id', bronzeData.id);

      return NextResponse.json(
        {
          success: false,
          error: 'Silver insert was skipped because the row failed PostgreSQL type checks',
          errors: [silverError?.message || 'insert returned no row'],
          warnings,
        },
        { status: 200 }
      );
    }

    await supabase
      .from('bronze_contract_raw_payloads')
      .update({ status: 'processed' })
      .eq('id', bronzeData.id);

    return NextResponse.json({
      success: true,
      message: 'Successfully parsed the bronze contract into silver_contracts.',
      contract: newContract,
      warnings,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Silver processing failed';
    console.error('Silver Layer Processing Crash:', message, { payloadId });
    return NextResponse.json(
      {
        success: false,
        error: formatOpenAIError(error),
        errors: [message],
      },
      { status: 200 }
    );
  }
}
