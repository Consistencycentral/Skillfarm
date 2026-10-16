// Sends a real push notification (Expo Push Service) to every device a learner
// has signed in on. Called by the database trigger `notify_registration_push`
// (pg_net), NOT by the app. It is protected by a shared secret header.
//
// Deploy:  supabase functions deploy send-push --no-verify-jwt
// Secret:  supabase secrets set PUSH_WEBHOOK_SECRET=<long random string>
//          (optional) supabase secrets set EXPO_ACCESS_TOKEN=<expo access token>
// The same PUSH_WEBHOOK_SECRET value is also stored in public.app_settings
// (key push_webhook_secret) so the trigger can send it. See CLIENT_FIXES_V9.md.
import { createClient } from 'npm:@supabase/supabase-js@2';

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';
const CHANNEL_ID = 'seat-updates';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !supabaseUrl || !serviceRole) return json({ error: 'Push is not configured.' }, 500);

  const sent = req.headers.get('x-push-secret') ?? '';
  if (!safeEqual(sent, secret)) return json({ error: 'Unauthorized.' }, 401);

  let payload: { user_id?: string; title?: string; body?: string; data?: Record<string, unknown> };
  try { payload = await req.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }

  const userId = String(payload.user_id ?? '');
  const title = String(payload.title ?? '').slice(0, 120);
  const body = String(payload.body ?? '').slice(0, 300);
  if (!UUID.test(userId) || !title) return json({ error: 'user_id and title are required.' }, 400);

  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  const { data: rows, error } = await admin.from('push_tokens').select('token').eq('user_id', userId);
  if (error) return json({ error: error.message }, 500);
  const tokens = (rows ?? []).map((r: { token: string }) => r.token);
  if (tokens.length === 0) return json({ ok: true, sent: 0 });

  const messages = tokens.map((to) => ({
    to, title, body,
    data: payload.data ?? {},
    sound: 'default',
    priority: 'high',
    channelId: CHANNEL_ID,
  }));

  const headers: Record<string, string> = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
  const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (expoToken) headers['Authorization'] = `Bearer ${expoToken}`;

  let tickets: Array<{ status: string; message?: string; details?: { error?: string } }> = [];
  try {
    const resp = await fetch(EXPO_URL, { method: 'POST', headers, body: JSON.stringify(messages) });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) return json({ error: 'Expo push service rejected the request.', detail: result }, 502);
    tickets = Array.isArray(result?.data) ? result.data : [];
  } catch (e) {
    return json({ error: `Could not reach Expo push service: ${(e as Error).message}` }, 502);
  }

  // Remove tokens Expo says are dead (app uninstalled / token revoked).
  const dead: string[] = [];
  tickets.forEach((t, i) => {
    if (t?.status === 'error' && t.details?.error === 'DeviceNotRegistered') dead.push(tokens[i]);
  });
  if (dead.length) await admin.from('push_tokens').delete().in('token', dead);

  const ok = tickets.filter((t) => t?.status === 'ok').length;
  return json({ ok: true, sent: ok, removed: dead.length });
});
