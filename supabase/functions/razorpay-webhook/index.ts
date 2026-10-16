import { createClient } from 'npm:@supabase/supabase-js@2';

async function hmacSha256(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const webhookSecret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!webhookSecret || !supabaseUrl || !serviceRole) {
    return new Response('Webhook is not configured', { status: 500 });
  }

  const raw = await req.text();
  const signature = req.headers.get('x-razorpay-signature') ?? '';
  const expected = await hmacSha256(webhookSecret, raw);
  if (!safeEqual(signature, expected)) return new Response('Invalid signature', { status: 401 });

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return new Response('Invalid JSON', { status: 400 }); }

  if (payload?.event !== 'payment_link.paid') return new Response('Ignored', { status: 200 });

  const entity = payload?.payload?.payment_link?.entity;
  const paymentLinkId = entity?.id;
  const referenceId = entity?.reference_id;
  const payment = Array.isArray(entity?.payments) ? entity.payments[0] : null;
  const paymentId = payment?.payment_id ?? payment?.id ?? null;
  const amountPaise = Number(entity?.amount_paid ?? entity?.amount ?? 0);
  if (!paymentLinkId || !referenceId || !paymentId || !Number.isFinite(amountPaise)) {
    return new Response('Missing payment-link fields', { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  const { data: registration, error: findError } = await admin
    .from('registrations')
    .select('id, payment_amount, payment_status, razorpay_payment_link_id')
    .eq('id', referenceId)
    .maybeSingle();
  if (findError) return new Response(findError.message, { status: 500 });
  if (!registration) return new Response('Registration not found', { status: 404 });

  if (registration.razorpay_payment_link_id && registration.razorpay_payment_link_id !== paymentLinkId) {
    return new Response('Payment link mismatch', { status: 409 });
  }

  const expectedPaise = Math.round(Number(registration.payment_amount ?? 0) * 100);
  if (expectedPaise !== amountPaise) return new Response('Amount mismatch', { status: 409 });

  const { data: result, error: finalizeError } = await admin.rpc('finalize_razorpay_payment', {
    p_registration_id: registration.id,
    p_payment_link_id: paymentLinkId,
    p_payment_id: paymentId,
    p_amount: amountPaise / 100,
  });
  if (finalizeError) return new Response(finalizeError.message, { status: 500 });
  if (result?.ok === false) return new Response(result.error ?? 'Could not finalize booking', { status: 409 });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
