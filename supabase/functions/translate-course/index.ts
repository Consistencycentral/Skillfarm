// Translates the partner's English course text into Tamil and Hindi.
// The Anthropic key stays here (Supabase secret ANTHROPIC_API_KEY); the app
// only sends the text. Only signed-in users can call it.
//
// Deploy:  supabase functions deploy translate-course
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const FIELDS = ['title', 'description', 'agenda', 'learning_outcomes', 'eligibility', 'batch_timings', 'trainer_name', 'trainer_bio'];
const MODEL = 'claude-sonnet-5-5';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!supabaseUrl || !serviceRole || !apiKey) {
    return json({ error: 'Translation service is not configured (ANTHROPIC_API_KEY missing on Supabase).' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Not signed in.' }, 401);
  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  if (userError || !userData.user) return json({ error: 'Not signed in.' }, 401);

  let body: { fields?: Record<string, string> };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }

  const source: Record<string, string> = {};
  let total = 0;
  for (const f of FIELDS) {
    const v = String(body.fields?.[f] ?? '').trim();
    if (v) { source[f] = v; total += v.length; }
  }
  if (!Object.keys(source).length) return json({ error: 'Nothing to translate.' }, 400);
  if (total > 12000) return json({ error: 'Text is too long to translate at once (limit 12,000 characters).' }, 400);

  const prompt =
    'Translate this agriculture-training course content from English into Tamil (ta) and Hindi (hi). ' +
    'Keep numbers, dates, phone numbers, names of people and places, and line breaks exactly as they are. ' +
    'For person names (trainer_name) transliterate into the target script. Use simple, natural wording farmers will understand. ' +
    'Reply with ONLY a JSON object of the form {"ta":{<field>:<text>},"hi":{<field>:<text>}} using exactly the same field keys as the input, no markdown.\n\n' +
    JSON.stringify(source);

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!resp.ok) return json({ error: `Translation failed (${resp.status}).` }, 502);

  const data = await resp.json();
  const text = (data.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    const out: Record<string, Record<string, string>> = { ta: {}, hi: {} };
    for (const lng of ['ta', 'hi']) {
      for (const f of Object.keys(source)) {
        const v = parsed?.[lng]?.[f];
        if (typeof v === 'string' && v.trim()) out[lng][f] = v.trim();
      }
    }
    return json({ ok: true, translations: out });
  } catch {
    return json({ error: 'Could not read the translation. Please try again.' }, 502);
  }
});
