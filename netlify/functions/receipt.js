import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { getSession, json, unauthorized } from './lib/auth.js';
import { getSettings } from './lib/settings.js';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_MEDIA = ['image/jpeg', 'image/png', 'image/webp'];

const ReceiptExtraction = z.object({
  date: z.string().nullable().describe('Date of service in YYYY-MM-DD format, or null if not readable'),
  amount: z.number().nullable().describe('Total cost of the care in dollars, or null'),
  description: z.string().nullable().describe('Short description like "Annual physical — Dr. Patel"'),
  providerType: z.string().nullable().describe('One of the allowed provider types, or a short new type name'),
  providerTypeIsNew: z.boolean().describe('True if providerType is not in the allowed list'),
  person: z.string().nullable().describe('Matching family member name from the list, or null'),
  note: z.string().nullable().describe('One short caveat about the extraction worth showing the user, or null'),
});

function buildPrompt(settings) {
  return `This is a photo of a healthcare bill, receipt, or insurance statement. Extract the details for a family expense tracker.

Rules:
- date: the DATE OF SERVICE (fall back to the receipt/statement date). Format YYYY-MM-DD.
- amount: the TOTAL cost of the care in dollars — what it would cost cash with no insurance involved. Prefer "total charges" / "billed amount" over "patient responsibility", "amount due", "copay", or insurance-adjusted figures. If only a patient-paid amount is visible, use it and say so in note.
- description: short and human, e.g. "Annual physical — Dr. Patel" or "Amoxicillin — CVS".
- providerType: pick the best fit from this list: ${settings.providerTypes.join(', ')}. Only if none fits, invent a concise new type (e.g. "Chiropractor") and set providerTypeIsNew to true.
- person: the patient. Match against this family list only if the name on the bill clearly corresponds: ${settings.persons.join(', ')}. Otherwise null.
- note: one short caveat if something matters (e.g. "Amount is the patient-paid total; full billed amount not shown"). Otherwise null.
- Use null for anything you cannot read confidently. Never invent values.`;
}

export default async function handler(request) {
  const session = await getSession(request);
  if (!session) return unauthorized();
  if (request.method !== 'POST') return json({ error: 'Not found' }, { status: 404 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request' }, { status: 400 });
  }
  const { imageBase64, mediaType } = body || {};
  if (!imageBase64 || !ALLOWED_MEDIA.includes(mediaType)) {
    return json({ error: 'A JPEG, PNG, or WebP image is required' }, { status: 400 });
  }
  if (imageBase64.length * 0.75 > MAX_IMAGE_BYTES) {
    return json({ error: 'Image is too large — try again, it will be compressed further' }, { status: 413 });
  }

  // Deterministic extraction for the local e2e suite; never set in production.
  if (process.env.RECEIPT_MOCK_JSON) {
    return json({ extraction: JSON.parse(process.env.RECEIPT_MOCK_JSON) });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return json(
      { error: 'Receipt scanning is not set up yet — add the ANTHROPIC_API_KEY environment variable in Netlify and redeploy.' },
      { status: 503 },
    );
  }

  const settings = await getSettings();
  const client = new Anthropic({ timeout: 25_000, maxRetries: 0 });

  let response;
  try {
    response = await client.messages.parse({
      model: process.env.RECEIPT_MODEL || 'claude-opus-5',
      max_tokens: 4096,
      output_config: {
        effort: 'low',
        format: zodOutputFormat(ReceiptExtraction),
      },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: buildPrompt(settings) },
          ],
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return json({ error: 'The ANTHROPIC_API_KEY on this site is invalid — update it in Netlify.' }, { status: 503 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return json({ error: 'Receipt scanning is briefly rate-limited — try again in a minute.' }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      console.error('Anthropic API error', error.status, error.message);
      return json({ error: 'Could not read the receipt right now — try again or enter it manually.' }, { status: 502 });
    }
    console.error('Receipt scan failed', error);
    return json({ error: 'Could not read the receipt right now — try again or enter it manually.' }, { status: 502 });
  }

  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    return json({ error: "Couldn't make out this image — try a clearer photo or enter the details manually." }, { status: 422 });
  }

  const extraction = response.parsed_output;
  if (extraction.date && !/^\d{4}-\d{2}-\d{2}$/.test(extraction.date)) extraction.date = null;
  if (extraction.amount != null) {
    extraction.amount = Math.round(Number(extraction.amount) * 100) / 100;
    if (!Number.isFinite(extraction.amount) || extraction.amount <= 0) extraction.amount = null;
  }
  return json({ extraction });
}

export const config = {
  path: ['/api/receipt'],
};
