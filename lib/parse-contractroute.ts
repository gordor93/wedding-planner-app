import OpenAI from 'openai';

const MAX_CONTRACT_CHARS = 40_000;
const OPENAI_MODEL = 'gpt-4o-mini';

export type PaymentMilestone = {
  due_date: string;
  amount: string;
};

export type SilverContract = {
  vendor_type: string;
  client_name: string;
  event_date: string;
  payment_milestones: PaymentMilestone[];
  key_questionnaire_items: string[];
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
              text: `You extract structured wedding-contract data for a planning app.
Analyze this standard wedding contract (1 to 10 pages). Extrapolate missing labels only when the document clearly implies them, and summarize each field concisely.
Return vendor_type, client_name, event_date, payment milestones, and onboarding questionnaire items.

Contract text:
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
              vendor_type: {
                type: 'string',
                description: 'Vendor category that maps to the silver_contracts.vendor_type column',
              },
              client_name: {
                type: 'string',
                description: 'Couple or client name on the contract',
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
                    due_date: { type: 'string', description: 'Payment due date' },
                    amount: { type: 'string', description: 'Payment amount including currency if present' },
                  },
                  required: ['due_date', 'amount'],
                },
              },
              key_questionnaire_items: {
                type: 'array',
                items: { type: 'string' },
                description: 'Concise onboarding questions or requirements pulled from the contract',
              },
            },
            required: [
              'vendor_type',
              'client_name',
              'event_date',
              'payment_milestones',
              'key_questionnaire_items',
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
