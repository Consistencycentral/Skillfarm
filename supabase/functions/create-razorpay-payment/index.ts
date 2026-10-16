import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const razorpayKeyId = Deno.env.get('RAZORPAY_KEY_ID');
  const razorpaySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
  if (!supabaseUrl || !serviceRole || !razorpayKeyId || !razorpaySecret) {
    return json({ error: 'Payment service is not configured on Supabase.' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Not signed in.' }, 401);

  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ error: 'Not signed in.' }, 401);

  let body: { registration_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const registrationId = String(body.registration_id ?? '');
  if (!registrationId) return json({ error: 'registration_id is required.' }, 400);

  const { data: registration, error: regError } = await admin
    .from('registrations')
    .select('id, student_id, status, payment_status, payment_amount, payment_currency, payment_link_url, razorpay_payment_link_id, learner_name, learner_email, learner_phone, course_id, batch_id, course:courses!registrations_course_id_fkey(title, fee, discount), batch:batches!registrations_batch_id_fkey(name)')
    .eq('id', registrationId)
    .eq('student_id', userData.user.id)
    .maybeSingle();

  if (regError) return json({ error: regError.message }, 400);
  if (!registration) return json({ error: 'Registration not found.' }, 404);

  const course = Array.isArray(registration.course) ? registration.course[0] : registration.course;
  const batch = Array.isArray(registration.batch) ? registration.batch[0] : registration.batch;
  const fee = Math.max(0, Number(registration.payment_amount ?? Number(course?.fee ?? 0) - Number(course?.discount ?? 0)));

  if (registration.payment_status === 'paid' || registration.status === 'registered' && registration.payment_status === 'not_required') {
    return json({ ok: true, status: 'paid', payment_status: registration.payment_status, registration_id: registration.id });
  }

  if (registration.status !== 'pending') {
    return json({ error: 'This booking is not waiting for payment.' }, 409);
  }

  if (fee <= 0) {
    const { data: finalized, error: finalizeError } = await admin.rpc('finalize_razorpay_payment', {
      p_registration_id: registration.id,
      p_payment_link_id: 'not_required',
      p_payment_id: 'not_required',
      p_amount: 0,
    });
    if (finalizeError) return json({ error: finalizeError.message }, 400);
    return json({ ok: true, status: 'registered', payment_status: 'not_required', result: finalized });
  }

  if (registration.razorpay_payment_link_id && registration.payment_link_url && registration.payment_status === 'pending') {
    return json({ ok: true, status: 'pending', registration_id: registration.id, payment_status: 'pending', payment_url: registration.payment_link_url });
  }

  const amountPaise = Math.round(fee * 100);
  const auth = btoa(`${razorpayKeyId}:${razorpaySecret}`);
  const siteUrl = Deno.env.get('SKILLFARM_SITE_URL');
  const callbackUrl = siteUrl ? `${siteUrl.replace(/\/$/, '')}/payment/${encodeURIComponent(registration.id)}` : undefined;

  const payload = {
    amount: amountPaise,
    currency: 'INR',
    accept_partial: false,
    reference_id: registration.id,
    description: `SkillFarm booking — ${course?.title ?? 'Course'} — ${batch?.name ?? 'Batch'}`,
    customer: {
      name: registration.learner_name ?? userData.user.user_metadata?.full_name ?? 'SkillFarm Learner',
      email: registration.learner_email ?? userData.user.email ?? undefined,
      contact: registration.learner_phone ?? undefined,
    },
    notify: { sms: false, email: false },
    reminder_enable: false,
    ...(callbackUrl ? { callback_url: callbackUrl, callback_method: 'get' } : {}),
    notes: {
      registration_id: registration.id,
      course_id: registration.course_id,
      batch_id: registration.batch_id,
    },
  };

  const razorpayResponse = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const razorpayData = await razorpayResponse.json().catch(() => ({}));
  if (!razorpayResponse.ok) {
    return json({ error: razorpayData?.error?.description ?? 'Could not create the Razorpay payment link.' }, 502);
  }

  const { error: updateError } = await admin
    .from('registrations')
    .update({
      payment_status: 'pending',
      payment_amount: fee,
      payment_currency: 'INR',
      razorpay_payment_link_id: razorpayData.id,
      payment_link_url: razorpayData.short_url,
    })
    .eq('id', registration.id)
    .eq('student_id', userData.user.id);

  if (updateError) return json({ error: updateError.message }, 400);

  return json({
    ok: true,
    status: 'pending',
    registration_id: registration.id,
    payment_status: 'pending',
    payment_url: razorpayData.short_url,
    payment_link_id: razorpayData.id,
    amount: fee,
    currency: 'INR',
  });
});
