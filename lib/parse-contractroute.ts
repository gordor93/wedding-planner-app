import OpenAI from 'openai';

const MAX_CONTRACT_CHARS = 40_000;
const OPENAI_MODEL = 'gpt-4o-mini';

export type PaymentMilestone = {
  due_date: string;
  amount: string;
};

export type SilverContract = {
  vendor_name: string;
  vendor_type: string;
  contract_type: string;
  client_name: string;
  event_date: string;
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

export async function parseProcessSilver(rawContractText: string): Promise<SilverContract> {
  if (rawContractText.length > MAX_CONTRACT_CHARS) {
    throw new Error('Contract exceeds the 10-page operational limit');
  }

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
Analyze this 1 to 10 page wedding contract or proposal. Extrapolate labels only when the document clearly implies them, and summarize each field concisely.
Return vendor_name, vendor_type, contract_type (for example proposal, contract, or invoice), client_name, event_date, and payment milestones.
If a field is not present, use an empty string or an empty array. Do not invent payment due dates.

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
                description: 'Vendor category such as florist, decor, venue, or entertainment',
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

    return JSON.parse(parsedJsonText) as SilverContract;
  } catch (error) {
    console.error('parseProcessSilver failed:', error);
    throw error;
  }
}
