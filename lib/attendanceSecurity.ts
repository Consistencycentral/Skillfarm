import { supabase } from './supabase';

/** Server-backed attendance challenge. The server validates ownership, approval, payment and expiry. */
export async function issueAttendanceChallenge(registrationId: string) {
  const { data, error } = await supabase.rpc('issue_attendance_challenge', { p_registration_id: registrationId });
  if (error) throw error;
  return data as { token: string; short_code?: string; expires_at: string };
}

export async function validateAttendanceChallenge(token: string) {
  const { data, error } = await supabase.rpc('validate_attendance_challenge', { p_token: token });
  if (error) throw error;
  return data;
}

export type AttendanceScanResult = {
  ok: boolean;
  error?: string;
  already_present?: boolean;
  registration_id?: string;
  learner_name?: string;
  seat?: number | null;
  course_title?: string;
  batch_name?: string | null;
  days_present?: number;
};

/** Partner scan: verifies the QR token and marks the learner present for today in one atomic call. */
export async function markAttendanceByToken(token: string, batchId?: string | null): Promise<AttendanceScanResult> {
  const { data, error } = await supabase.rpc('mark_attendance_by_token', { p_token: token, p_batch_id: batchId ?? null });
  if (error) throw error;
  return data as AttendanceScanResult;
}

/** Backup when the camera can't scan: the 6-digit code shown under the learner's QR. */
export async function markAttendanceByCode(code: string, batchId?: string | null): Promise<AttendanceScanResult> {
  const { data, error } = await supabase.rpc('mark_attendance_by_code', { p_code: code, p_batch_id: batchId ?? null });
  if (error) throw error;
  return data as AttendanceScanResult;
}

/** Pulls the one-time token out of a scanned QR value (`.../attendance/<id>?c=<token>`). */
export function tokenFromQr(value: string): string | null {
  const m = value.match(/[?&]c=([A-Za-z0-9]+)/);
  return m?.[1] ?? null;
}

export type AttendanceSummary = {
  registration_id: string;
  today_status: 'present' | 'absent' | null;
  days_present: number;
};

/** Today's status + number of present days for up to many registrations (learner or partner). */
export async function getAttendanceSummaries(ids: string[]): Promise<Map<string, AttendanceSummary>> {
  const out = new Map<string, AttendanceSummary>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase.rpc('get_attendance_summaries', { p_reg_ids: ids });
  if (error) throw error;
  for (const row of (data ?? []) as AttendanceSummary[]) out.set(row.registration_id, row);
  return out;
}

export type AttendanceLogRow = { registration_id: string; attendance_date: string; status: 'present' | 'absent'; method: string };

/** Day-wise attendance rows for the partner's own courses (used by the report export). */
export async function getAttendanceReport(opts: { courseId?: string; batchId?: string; from?: string; to?: string } = {}): Promise<AttendanceLogRow[]> {
  const { data, error } = await supabase.rpc('get_attendance_report', {
    p_course_id: opts.courseId ?? null,
    p_batch_id: opts.batchId ?? null,
    p_from: opts.from ?? null,
    p_to: opts.to ?? null,
  });
  if (error) throw error;
  return (data ?? []) as AttendanceLogRow[];
}

/** Whether the server currently requires payment before an attendance QR is issued. */
export async function isPaymentRequiredForAttendance(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('attendance_payment_required');
    if (error) return false;
    return data === true;
  } catch { return false; }
}
