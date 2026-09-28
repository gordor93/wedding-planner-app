import { FileState, GoogleGenAI, type GenerateContentParameters } from '@google/genai';

const GEMINI_TIMEOUT_MS = 300_000;
const NETWORK_RETRY_ATTEMPTS = 2;
const GEMINI_PDF_MODEL = 'gemini-3.8-flash';
const GEMINI_FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash'];

function errorText(error: unknown) {
  const err = error as { message?: string; cause?: { code?: string; message?: string } };
  return `${err?.message || ''} ${err?.cause?.message || ''} ${err?.cause?.code || ''}`.toLowerCase();
}

function isAbortError(error: unknown) {
  const message = errorText(error);
  return message.includes('aborted') || message.includes('abort');
}

function isTransientNetworkError(error: unknown) {
  const message = errorText(error);
  return (
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('und_err') ||
    message.includes('socket')
  );
}

function isHighDemandError(error: unknown) {
  const message = errorText(error);
  return (
    message.includes('high demand') ||
    message.includes('unavailable') ||
    message.includes('"code":503') ||
    message.includes('"code": 503')
  );
}

function isUnavailableModelError(error: unknown) {
  const message = errorText(error);
  return (
    message.includes('no longer available') ||
    message.includes('not_found') ||
    message.includes('"code":404') ||
    message.includes('"code": 404')
  );
}

function isQuotaError(error: unknown) {
  const message = errorText(error);
  return (
    message.includes('resource_exhausted') ||
    message.includes('exceeded your current quota') ||
    message.includes('quota exceeded') ||
    message.includes('free_tier') ||
    message.includes('"code":429') ||
    message.includes('"code": 429')
  );
}

export function formatGeminiError(error: unknown) {
  if (isQuotaError(error)) {
    return 'Gemini free-tier quota is used up for today. Wait until the quota resets or enable billing at https://ai.dev/rate-limit.';
  }

  if (isUnavailableModelError(error)) {
    return 'That Gemini model is no longer available on this API key. The app now uses gemini-3.8-flash.';
  }

  if (isHighDemandError(error)) {
    return 'Gemini is busy (high demand). Wait about a minute and upload the PDF again.';
  }

  if (isAbortError(error) || isTransientNetworkError(error)) {
    return 'Gemini timed out or dropped the connection while reading this PDF. Please try again in a minute.';
  }

  const err = error as { message?: string };
  return err?.message || 'Gemini request failed';
}

export function createGeminiClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      timeout: GEMINI_TIMEOUT_MS,
      retryOptions: {
        attempts: 2,
        httpStatusCodes: [408, 500, 502, 503, 504],
      },
    },
  });
}

export async function generateGeminiContent(params: GenerateContentParameters) {
  const ai = createGeminiClient();
  const models = [params.model, ...GEMINI_FALLBACK_MODELS.filter((model) => model !== params.model)];
  let lastError: unknown;

  for (const model of models) {
    for (let attempt = 1; attempt <= NETWORK_RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await ai.models.generateContent({ ...params, model });
      } catch (error) {
        lastError = error;
        console.warn(`Gemini generateContent failed on ${model}:`, error);

        if (isQuotaError(error) || isUnavailableModelError(error)) {
          break;
        }

        if (isHighDemandError(error)) {
          if (attempt < NETWORK_RETRY_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 8000));
            continue;
          }
          break;
        }

        if (!isTransientNetworkError(error) || attempt === NETWORK_RETRY_ATTEMPTS) {
          throw new Error(formatGeminiError(error));
        }

        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      }
    }
  }

  throw new Error(formatGeminiError(lastError));
}

async function waitForFileActive(ai: GoogleGenAI, name: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const file = await ai.files.get({ name });
    if (file.state === FileState.ACTIVE) return file;
    if (file.state === FileState.FAILED) {
      throw new Error(file.error?.message || 'Gemini failed to process the uploaded PDF');
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('Gemini is still processing the uploaded PDF. Please try again.');
}

export async function generateGeminiFromPdf(bytes: Uint8Array, prompt: string) {
  const ai = createGeminiClient();
  const uploaded = await ai.files.upload({
    file: new Blob([Buffer.from(bytes)], { type: 'application/pdf' }),
    config: { mimeType: 'application/pdf' },
  });

  if (!uploaded.name) {
    throw new Error('Gemini file upload did not return a file name');
  }

  try {
    const ready = await waitForFileActive(ai, uploaded.name);
    const response = await generateGeminiContent({
      model: GEMINI_PDF_MODEL,
      contents: [
        {
          fileData: {
            fileUri: ready.uri,
            mimeType: ready.mimeType || 'application/pdf',
          },
        },
        { text: prompt },
      ],
    });

    return response.text?.trim() ?? '';
  } finally {
    try {
      await ai.files.delete({ name: uploaded.name });
    } catch (error) {
      console.warn('Could not delete temporary Gemini file:', error);
    }
  }
}
