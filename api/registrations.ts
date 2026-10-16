// ===========================================================================
// Registration helpers — register a seat, list a student's registrations,
// and list a provider's students (the rows behind the HTML learner report).
// ===========================================================================
import { supabase } from '../lib/supabase';
import type { Course } from './courses';

export type RegistrationStatus =
  | 'pending'
  | 'registered'
  | 'waitlist'
  | 'cancelled'
  | 'completed'
  | 'rejected';

export type AttendanceStatus = 'pending' | 'present' | 'absent';

export interface Registration {
  id: string;
  course_id: string;
  batch_id: string;
  student_id: string;
  status: RegistrationStatus;
  attendance_status: AttendanceStatus;
  registered_at: string;
  // Learner capture fields (filled at register time, shown in the export).
  learner_email: string | null;
  learner_age: number | null;
  learner_location: string | null;
  learner_experience: boolean | null;
  learner_name: string | null;
  learner_phone: string | null;
  learner_additional_details: string | null;
  payment_status: 'unpaid' | 'pending' | 'paid' | 'failed' | 'refunded' | 'not_required';
  payment_amount: number | null;
  payment_currency: string | null;
  razorpay_payment_link_id: string | null;
  razorpay_payment_id: string | null;
  payment_link_url: string | null;
  payment_paid_at: string | null;
  preferred_seat_number?: number | null;
  assigned_seat_number?: number | null;
  /** Set when a freed seat was automatically given to this learner from the waitlist. */
  waitlist_promoted_at?: string | null;
}

// Joined view: a registration with the course + student details nested.
export interface RegistrationWithCourse extends Registration {
  course: Pick<
    Course,
    'id' | 'title' | 'category' | 'start_date' | 'address' | 'city' | 'state' | 'contact_phone' | 'fee' | 'discount' | 'certificate_available'
  > & { provider_name?: string | null };
  batch: {
    id: string;
    name: string;
    start_date: string | null;
    end_date: string | null;
    duration_weeks: number | null;
    timings: string | null;
    seats_total: number;
    seats_filled: number;
    registration_deadline: string | null;
  } | null;
}

export interface StudentRow {
  registration_id: string;
  registered_at: string;
  status: RegistrationStatus;
  batch_id: string;
  attendance_status: AttendanceStatus;
  course_id: string;
  batch_name: string | null;
  batch_start_date: string | null;
  batch_end_date: string | null;
  course_title: string;
  course_start_date: string | null;
  student_id: string;
  student_name: string | null;
  student_phone: string | null;
  student_email: string | null;
  // Per-enrollment capture (filled by the learner at register time).
  learner_email: string | null;
  preferred_seat_number?: number | null;
  assigned_seat_number?: number | null;
  learner_age: number | null;
  learner_location: string | null;
  learner_experience: boolean | null;
  learner_name: string | null;
  learner_phone: string | null;
  learner_additional_details: string | null;
  payment_status?: string | null;
  /** true when the course has a fee (fee - discount > 0). */
  payment_required?: boolean;
  /** Attendance for today (India time): null = not marked yet. */
  attendance_today?: 'present' | 'absent' | null;
  attendance_days?: number;
}

// Learner-side payload for the register form.
export interface EnrollmentCapture {
  email: string;
  age: string;        // "" if blank; coerced to int server-side
  location: string;
  experience: boolean | null; // Yes / No; null = not answered
  name: string;
  phone: string;
  additionalDetails: string;
  preferredSeatNumber?: number | null;
}

// Create a Razorpay Payment Link for a pending booking. The Razorpay secret
// never reaches the Expo app; it stays inside the Supabase Edge Function.
export async function createRazorpayPayment(registrationId: string) {
  const { data, error } = await supabase.functions.invoke('create-razorpay-payment', {
    body: { registration_id: registrationId },
  });
  if (error) throw error;
  return data as {
    ok: boolean;
    status?: string;
    payment_status?: string;
    payment_url?: string;
    payment_link_id?: string;
    amount?: number;
    currency?: string;
    registration_id?: string;
    error?: string;
  };
}

// ---------------------------------------------------------------------------
// Student: register a seat. Calls the atomic register_seat RPC so two students
// tapping "Register" at the same instant can't overbook.
// The optional `capture` carries the enrollment-form data (email/age/location/
// previous experience) the learner fills before registering; stored on the
// registration row and surfaced in the export. Returns { ok, status, error }.
// ---------------------------------------------------------------------------

export async function bookSeat(
  courseId: string,
  batchId: string,
  capture: EnrollmentCapture,
): Promise<{
  ok: boolean; status?: string; seats_left?: number; batch_id?: string;
  registration_id?: string; seat_number?: number; error?: string;
}> {
  const { data, error } = await supabase.rpc('book_seat', {
    p_course_id: courseId,
    p_batch_id: batchId,
    p_email: capture.email?.trim() || null,
    p_age: capture.age ? Number(capture.age) : null,
    p_location: capture.location?.trim() || null,
    p_experience: capture.experience ?? null,
    p_name: capture.name?.trim() || null,
    p_phone: capture.phone?.trim() || null,
    p_additional_details: capture.additionalDetails?.trim() || null,
    p_preferred_seat_number: capture.preferredSeatNumber ? Math.trunc(Number(capture.preferredSeatNumber)) : null,
  });
  if (error) throw error;
  return data as {
    ok: boolean; status?: string; seats_left?: number; batch_id?: string;
    registration_id?: string; seat_number?: number; error?: string;
  };
}

// ---------------------------------------------------------------------------
// Student: book 1-6 seats in one go (v8). One registration row per seat, all
// 'pending' until the partner approves each one. Needs the v8 SQL.
// ---------------------------------------------------------------------------
export const MAX_SEATS_PER_BOOKING = 6;

export interface BookSeatsResult {
  ok: boolean;
  status?: string;
  registration_ids?: string[];
  seat_numbers?: number[];
  seat_count?: number;
  price_per_seat?: number;
  total_price?: number;
  seats_left?: number;
  batch_id?: string;
  error?: string;
}

export async function bookSeats(
  courseId: string,
  batchId: string,
  seatNumbers: number[],
  capture: EnrollmentCapture,
): Promise<BookSeatsResult> {
  const seats = Array.from(new Set(seatNumbers.map((n) => Math.trunc(Number(n))).filter((n) => n > 0))).sort((a, b) => a - b);
  const { data, error } = await supabase.rpc('book_seats', {
    p_course_id: courseId,
    p_batch_id: batchId,
    p_seat_numbers: seats,
    p_email: capture.email?.trim() || null,
    p_age: capture.age ? Number(capture.age) : null,
    p_location: capture.location?.trim() || null,
    p_experience: capture.experience ?? null,
    p_name: capture.name?.trim() || null,
    p_phone: capture.phone?.trim() || null,
    p_additional_details: capture.additionalDetails?.trim() || null,
  });
  if (error) {
    if (/book_seats|schema cache|does not exist/i.test(error.message ?? '')) {
      // v8 SQL not run yet: a single seat still works through the v6 book_seat RPC.
      if (seats.length === 1) {
        const one = await bookSeat(courseId, batchId, { ...capture, preferredSeatNumber: seats[0] as any });
        return {
          ok: one.ok, status: one.status, error: one.error, seats_left: one.seats_left, batch_id: one.batch_id,
          registration_ids: one.registration_id ? [one.registration_id] : [],
          seat_numbers: [seats[0]], seat_count: 1,
        };
      }
      throw new Error('Multiple-seat booking needs the v8 database update. Run supabase/migrations/20261014_client_fixes_v8.sql once in the Supabase SQL Editor.');
    }
    throw error;
  }
  return data as BookSeatsResult;
}

// ---------------------------------------------------------------------------
// Waitlist (v9). When a batch is full the learner joins the waitlist instead of
// picking a seat. If a seat is released, the oldest waitlisted learner gets it
// automatically as a pending request. Needs 20261018_waitlist_and_push.sql.
// ---------------------------------------------------------------------------
export interface JoinWaitlistResult {
  ok: boolean;
  status?: string;
  registration_id?: string;
  position?: number;
  batch_id?: string;
  error?: string;
}

export async function joinWaitlist(
  courseId: string,
  batchId: string,
  capture: EnrollmentCapture,
): Promise<JoinWaitlistResult> {
  const { data, error } = await supabase.rpc('join_waitlist', {
    p_course_id: courseId,
    p_batch_id: batchId,
    p_email: capture.email?.trim() || null,
    p_age: capture.age ? Number(capture.age) : null,
    p_location: capture.location?.trim() || null,
    p_experience: capture.experience ?? null,
    p_name: capture.name?.trim() || null,
    p_phone: capture.phone?.trim() || null,
    p_additional_details: capture.additionalDetails?.trim() || null,
  });
  if (error) {
    if (/join_waitlist|schema cache|does not exist/i.test(error.message ?? '')) {
      throw new Error('The waitlist needs the v9 database update. Run supabase/migrations/20261018_waitlist_and_push.sql once in the Supabase SQL Editor.');
    }
    throw error;
  }
  return data as JoinWaitlistResult;
}

/** registration id -> { position, total } for the signed-in learner's waitlist spots. */
export async function listMyWaitlistPositions(): Promise<Map<string, { position: number; total: number }>> {
  const out = new Map<string, { position: number; total: number }>();
  try {
    const { data, error } = await supabase.rpc('my_waitlist_positions');
    if (error) return out; // v9 SQL not run yet: the screen simply shows no number
    for (const row of (data ?? []) as Array<{ registration_id: string; queue_position: number; waitlist_total: number }>) {
      out.set(row.registration_id, { position: Number(row.queue_position), total: Number(row.waitlist_total) });
    }
  } catch { /* offline */ }
  return out;
}

// Cancel exactly one seat (registration row) that belongs to the signed-in learner.
export async function cancelMyRegistration(registrationId: string) {
  const { data, error } = await supabase.rpc('cancel_my_registration', { p_reg_id: registrationId });
  if (error) throw error;
  const result = data as { ok: boolean; status?: string; seats_left?: number; batch_id?: string; error?: string };
  if (!result.ok) throw new Error(result.error ?? 'Could not cancel this seat.');
  return result;
}

export async function registerSeat(
  courseId: string,
  batchId: string,
  capture?: EnrollmentCapture
): Promise<{
  ok: boolean; status?: string; seats_left?: number; batch_id?: string; error?: string;
}>;
export async function registerSeat(
  courseId: string,
  capture?: EnrollmentCapture
): Promise<{
  ok: boolean; status?: string; seats_left?: number; batch_id?: string; error?: string;
}>;
export async function registerSeat(
  courseId: string,
  batchOrCapture?: string | EnrollmentCapture,
  maybeCapture?: EnrollmentCapture
) {
  const isBatchCall = typeof batchOrCapture === 'string';
  const batchId = isBatchCall ? batchOrCapture : undefined;
  const capture = isBatchCall ? maybeCapture : batchOrCapture;

  if (batchId) {
    const { data, error } = await supabase.rpc('register_seat', {
      p_course_id: courseId,
      p_batch_id: batchId,
      p_email: capture?.email?.trim() || null,
      p_age: capture && capture.age ? Number(capture.age) : null,
      p_location: capture?.location?.trim() || null,
      p_experience: capture?.experience ?? null,
      p_name: capture?.name?.trim() || null,
      p_phone: capture?.phone?.trim() || null,
      p_additional_details: capture?.additionalDetails?.trim() || null,
      p_preferred_seat_number: capture?.preferredSeatNumber
        ? Math.trunc(Number(capture.preferredSeatNumber))
        : null,
    });
    if (error) throw error;
    return data as {
      ok: boolean; status?: string; seats_left?: number; batch_id?: string; error?: string;
    };
  }

  // Compatibility path for an older screen that has not yet added the picker.
  const { data, error } = await supabase.rpc('register_seat', {
    p_course_id: courseId,
    p_email: capture?.email?.trim() || null,
    p_age: capture && capture.age ? Number(capture.age) : null,
    p_location: capture?.location?.trim() || null,
    p_experience: capture?.experience ?? null,
  });
  if (error) throw error;
  return data as {
    ok: boolean; status?: string; seats_left?: number; batch_id?: string; error?: string;
  };
}

// ---------------------------------------------------------------------------
// Partner: approve a pending/waitlist registration. Bumps seats_filled when a
// real seat is taken. Returns { ok, status, seats_left }.
// ---------------------------------------------------------------------------

/** Save a learner's preferred seat without requiring a custom RPC.
 * The learner owns their registration row, so the normal RLS update is enough.
 * We keep the seat in learner_additional_details for compatibility with older
 * databases that do not have preferred_seat_number yet.
 */
export async function setPreferredSeat(registrationId: string, seatNumber: number) {
  const { data: current, error: readError } = await supabase
    .from('registrations')
    .select('learner_additional_details')
    .eq('id', registrationId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  const existing = String(current?.learner_additional_details ?? '')
    .replace(/\n?Preferred seat: \d+/gi, '')
    .trim();
  const next = [existing, `Preferred seat: ${Math.trunc(seatNumber)}`].filter(Boolean).join('\n');
  const { error } = await supabase.from('registrations').update({ learner_additional_details: next }).eq('id', registrationId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, preferred_seat_number: Math.trunc(seatNumber) };
}

function seatNumbersFromDetails(rows: any[], maxSeat = 200): number[] {
  const out = new Set<number>();
  for (const row of rows ?? []) {
    if (!['pending','registered','completed'].includes(String(row.status))) continue;
    const text = String(row.learner_additional_details ?? '');
    const match = text.match(/Preferred seat:\s*(\d+)/i);
    const n = match ? Number(match[1]) : NaN;
    if (Number.isFinite(n) && n >= 1 && n <= maxSeat) out.add(n);
  }
  return [...out].sort((a,b) => a-b);
}

export async function listBookedSeatNumbers(batchId: string, seatsTotal = 200): Promise<number[]> {
  // Use the richer RPC when an existing deployment already has it. No new
  // Supabase setup is required for this app build.
  try {
    const { data, error } = await supabase.rpc('get_batch_booked_seats', { p_batch_id: batchId });
    if (!error) {
      const raw = Array.isArray(data) ? data : (typeof data === 'string' ? (() => { try { return JSON.parse(data); } catch { return []; } })() : []);
      return raw.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0 && n <= seatsTotal);
    }
  } catch {}

  // Older deployments: derive booked positions from the learner-owned seat
  // marker when the database exposes registration rows. This keeps the UI
  // functional without requiring a migration.
  try {
    const { data, error } = await supabase
      .from('registrations')
      .select('status, learner_additional_details')
      .eq('batch_id', batchId);
    if (!error) return seatNumbersFromDetails(data ?? [], seatsTotal);
  } catch {}
  return [];
}

export async function approveRegistration(regId: string) {
  const { data, error } = await supabase.rpc('approve_registration', { p_reg_id: regId });
  if (error) throw error;
  return data as { ok: boolean; status?: string; seats_left?: number; error?: string };
}

// ---------------------------------------------------------------------------
// Partner: reject a pending/waitlist/registered registration. Releases the
// seat if it was registered.
// ---------------------------------------------------------------------------
export async function rejectRegistration(regId: string) {
  const { data, error } = await supabase.rpc('reject_registration', { p_reg_id: regId });
  if (error) throw error;
  return data as { ok: boolean; status?: string; error?: string };
}

// ---------------------------------------------------------------------------
// Partner: mark a learner's attendance (present/absent/pending).
// ---------------------------------------------------------------------------
export async function setAttendance(regId: string, status: AttendanceStatus) {
  const { data, error } = await supabase.rpc('set_attendance', { p_reg_id: regId, p_status: status });
  if (error) throw error;
  return data as { ok: boolean; attendance_status?: string; error?: string };
}

// ---------------------------------------------------------------------------
// Student: cancel my registration for a course.
//
// This MUST be a single RPC call. The previous version set status='cancelled'
// via a direct table update and *then* called free_seat — but free_seat only
// releases the seat `if status = 'registered'`, which the update had already
// overwritten. Confirmed seats were never returned to the pool. free_seat now
// owns the whole transaction (see migration 20260821), and learners no longer
// have UPDATE rights on `registrations` at all.
// ---------------------------------------------------------------------------
export async function cancelRegistration(courseId: string, batchId?: string) {
  const { data, error } = batchId
    ? await supabase.rpc('free_seat', {
        p_course_id: courseId,
        p_batch_id: batchId,
      })
    : await supabase.rpc('free_seat', { p_course_id: courseId });

  if (error) throw error;

  const result = data as {
    ok: boolean;
    status?: string;
    seats_left?: number;
    batch_id?: string;
    error?: string;
  };

  if (!result.ok) {
    throw new Error(result.error ?? 'Could not cancel this registration.');
  }

  return result;
}

// ---------------------------------------------------------------------------
// Student: list my registrations with course details.
// ---------------------------------------------------------------------------
export async function listMyRegistrations(studentId: string) {
  // Keep the learner view resilient to PostgREST schema-cache lag. We fetch
  // registrations and batches separately instead of relying on a nested
  // `registrations -> batches` relationship being present in the cache.
  // `select('*')` + a separate course lookup (instead of a named embedded join
  // and a fixed column list) keeps My Seats and the Profile counters working
  // even when an optional column or a PostgREST relationship is missing.
  const { data, error } = await supabase
    .from('registrations')
    .select('*')
    .eq('student_id', studentId)
    .order('registered_at', { ascending: false });
  if (error) throw error;

  const rows = data ?? [];
  const courseIds = Array.from(new Set(rows.map((r: any) => r.course_id).filter(Boolean)));
  const courseMap = new Map<string, any>();
  if (courseIds.length > 0) {
    const { data: courses, error: courseError } = await supabase
      .from('courses')
      .select('*')
      .in('id', courseIds);
    if (courseError) console.warn('Could not load course details:', courseError.message);
    for (const c of courses ?? []) courseMap.set((c as any).id, c);
  }
  const batchIds = Array.from(new Set(rows.map((r: any) => r.batch_id).filter(Boolean)));
  const batchMap = new Map<string, any>();
  if (batchIds.length > 0) {
    const { data: batches, error: batchError } = await supabase
      .from('batches')
      .select('id, course_id, name, start_date, end_date, duration_weeks, timings, seats_total, seats_filled, registration_deadline')
      .in('id', batchIds);
    if (batchError) {
      // Older databases may not have the batch table yet. Keep the registration
      // visible rather than turning the whole My Seats screen into an error.
      console.warn('Could not load batch details:', batchError.message);
    } else {
      for (const b of batches ?? []) batchMap.set(b.id, b);
    }
  }

  return rows.map((row: any) => {
    const c = courseMap.get(row.course_id) ?? {
      id: row.course_id,
      title: 'Course no longer available',
      category: 'other',
      start_date: null,
      address: '',
      city: null,
      state: null,
      contact_phone: null,
      fee: 0,
      discount: null,
      certificate_available: null,
    };
    return {
      ...row,
      course: c,
      batch: row.batch_id ? (batchMap.get(row.batch_id) ?? null) : null,
    } as RegistrationWithCourse;
  });
}


export async function getMyRegistrationById(studentId: string, registrationId: string) {
  const rows = await listMyRegistrations(studentId);
  return rows.find((row) => row.id === registrationId) ?? null;
}

// ---------------------------------------------------------------------------
// Provider: list every student who registered for any of my courses.
// Batch details are fetched separately so the dashboard does not depend on a
// stale PostgREST relationship cache.
// ---------------------------------------------------------------------------
export async function listMyStudents(providerId: string) {
  const { data: courseRows, error: cErr } = await supabase
    .from('courses')
    .select('id, title, start_date, fee, discount')
    .eq('provider_id', providerId);
  if (cErr) throw cErr;

  const courseIds = (courseRows ?? []).map((c: any) => c.id);
  if (courseIds.length === 0) return [] as StudentRow[];

  const courseMap = new Map<string, { title: string; start_date: string | null; net_fee: number }>(
    (courseRows ?? []).map((c: any) => [c.id as string, { title: c.title, start_date: c.start_date, net_fee: Math.max(0, Number(c.fee ?? 0) - Number(c.discount ?? 0)) }])
  );

  const { data: regs, error: rErr } = await supabase
    .from('registrations')
    .select('*')
    .in('course_id', courseIds);
  if (rErr) throw rErr;

  if ((regs ?? []).length === 0) return [] as StudentRow[];

  const batchIds = Array.from(new Set((regs ?? []).map((r: any) => r.batch_id).filter(Boolean)));
  const batchMap = new Map<string, any>();
  if (batchIds.length > 0) {
    const { data: batches, error: bErr } = await supabase
      .from('batches')
      .select('id, name, start_date, end_date')
      .in('id', batchIds);
    if (bErr) console.warn('Could not load batch details:', bErr.message);
    for (const b of batches ?? []) batchMap.set(b.id, b);
  }

  const studentIds = Array.from(new Set((regs ?? []).map((r: any) => r.student_id as string)));
  // Contact lookup is a convenience: if the RPC is missing the list still loads
  // and falls back to the name/phone the learner typed at booking time.
  const { data: students, error: sErr } = await supabase.rpc('get_registration_student_contacts', { p_student_ids: studentIds });
  if (sErr) console.warn('Could not load learner contacts:', sErr.message);

  const studentMap = new Map<string, { full_name: string | null; phone: string | null }>(
    (students ?? []).map((s: any) => [s.id as string, { full_name: s.full_name, phone: s.phone }])
  );

  // Per-day attendance (today's status + days present). Optional: if the RPC is
  // not installed yet the list still loads and falls back to the stored status.
  let summaries = new Map<string, { today_status: 'present' | 'absent' | null; days_present: number }>();
  let paymentGate = false;
  try {
    const { getAttendanceSummaries, isPaymentRequiredForAttendance } = await import('../lib/attendanceSecurity');
    paymentGate = await isPaymentRequiredForAttendance();
    summaries = await getAttendanceSummaries((regs ?? []).map((r: any) => r.id as string));
  } catch (e: any) {
    console.warn('Could not load attendance summaries:', e?.message ?? e);
  }

  return (regs ?? []).map((r: any): StudentRow => {
    const c = courseMap.get(r.course_id)!;
    const att = summaries.get(r.id);
    const b = r.batch_id ? batchMap.get(r.batch_id) : null;
    const s = studentMap.get(r.student_id) ?? { full_name: null, phone: null };
    return {
      registration_id: r.id,
      registered_at: r.registered_at,
      status: r.status,
      attendance_status: r.attendance_status ?? 'pending',
      course_id: r.course_id,
      batch_id: r.batch_id,
      batch_name: b?.name ?? null,
      batch_start_date: b?.start_date ?? null,
      batch_end_date: b?.end_date ?? null,
      course_title: c.title,
      course_start_date: c.start_date,
      student_id: r.student_id,
      student_name: s.full_name,
      student_phone: s.phone,
      student_email: r.learner_email ?? null,
      learner_email: r.learner_email ?? null,
      learner_age: r.learner_age ?? null,
      learner_location: r.learner_location ?? null,
      learner_experience: r.learner_experience ?? null,
      learner_name: r.learner_name ?? s.full_name,
      learner_phone: r.learner_phone ?? s.phone,
      learner_additional_details: r.learner_additional_details ?? null,
      preferred_seat_number: r.preferred_seat_number ?? null,
      payment_status: r.payment_status ?? null,
      payment_required: paymentGate && c.net_fee > 0,
      attendance_today: att ? att.today_status : (r.attendance_status === 'present' || r.attendance_status === 'absent' ? r.attendance_status : null),
      attendance_days: att ? Number(att.days_present) : (r.attendance_status === 'present' ? 1 : 0),
    };
  });
}
