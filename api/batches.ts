// ===========================================================================
// SkillFarm — Multiple batch helpers
// ===========================================================================

import { supabase } from '../lib/supabase';

export interface Batch {
  id: string;
  course_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  duration_weeks: number | null;
  timings: string | null;
  seats_total: number;
  seats_filled: number;
  registration_deadline: string | null;
  created_at: string;
}

export type BatchInput = {
  name: string;
  start_date?: string | null;
  end_date?: string | null;
  duration_weeks?: number | null;
  timings?: string | null;
  seats_total: number;
  registration_deadline?: string | null;
};

/** Partner-chosen capacity: whole number 1..200 (blank / invalid -> 40). */
export function clampSeats(n: unknown): number {
  const v = Math.trunc(Number(n));
  if (!Number.isFinite(v) || v < 1) return 40;
  return Math.min(v, 200);
}

export function batchSeatsLeft(batch: Pick<Batch, 'seats_total' | 'seats_filled'>) {
  return Math.max(0, batch.seats_total - batch.seats_filled);
}

export function isBatchFull(batch: Pick<Batch, 'seats_total' | 'seats_filled'>) {
  return batch.seats_filled >= batch.seats_total;
}

export function isBatchRegistrationOpen(
  batch: Pick<Batch, 'registration_deadline' | 'start_date'>,
  now = new Date()
) {
  // The start day itself is still bookable (it is shown as UPCOMING until the
  // end of that day); registration only closes once the day is over.
  if (batch.start_date) {
    const startEnd = new Date(`${batch.start_date}T23:59:59`);
    if (!Number.isNaN(startEnd.getTime()) && now.getTime() > startEnd.getTime()) return false;
  }

  if (!batch.registration_deadline) return true;
  const deadline = new Date(batch.registration_deadline);
  if (Number.isNaN(deadline.getTime())) return true;
  // A deadline saved as a plain date arrives as midnight UTC. The partner means
  // "until the end of that day", so keep registration open for the whole day.
  const isDateOnly = deadline.getUTCHours() === 0 && deadline.getUTCMinutes() === 0 && deadline.getUTCSeconds() === 0;
  const closesAt = isDateOnly ? deadline.getTime() + 24 * 60 * 60 * 1000 - 1 : deadline.getTime();
  return now.getTime() <= closesAt;
}


export function pickNextBatch(batches: Batch[], now = new Date()) {
  const upcoming = batches.filter((b) => !b.start_date || new Date(`${b.start_date}T23:59:59`).getTime() >= now.getTime());
  const open = upcoming.filter((b) => batchSeatsLeft(b) > 0 && isBatchRegistrationOpen(b, now));
  return (open[0] ?? upcoming[0]) ?? null;
}

/** Fetch batches for an entire course list in one request to avoid N+1 card queries. */
export async function listNextBatchesForCourses(courseIds: string[]) {
  if (!courseIds.length) return {} as Record<string, Batch | null>;
  const { data, error } = await supabase
    .from('batches')
    .select('id, course_id, name, start_date, end_date, duration_weeks, timings, seats_total, seats_filled, registration_deadline, created_at')
    .in('course_id', courseIds)
    .order('start_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  const grouped: Record<string, Batch[]> = {};
  for (const row of (data ?? []) as Batch[]) (grouped[row.course_id] ??= []).push(row);

  // Only published batches are used for learner-facing availability.
  // Course-level seats/date fields are legacy metadata and must not become a
  // fake batch because that can make course cards disagree with booking.
  const result: Record<string, Batch | null> = {};
  for (const id of courseIds) result[id] = pickNextBatch(grouped[id] ?? []);
  return result;
}

/** Fetch all batches belonging to the supplied course ids. */
export async function listAllBatchesForCourses(courseIds: string[]): Promise<Batch[]> {
  if (!courseIds.length) return [];
  const { data, error } = await supabase
    .from('batches')
    .select('id, course_id, name, start_date, end_date, duration_weeks, timings, seats_total, seats_filled, registration_deadline, created_at')
    .in('course_id', courseIds)
    .order('start_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Batch[];
}


/**
 * Compatibility helper for older courses created before the multi-batch table
 * was introduced. It copies the course's published date/timing/capacity into
 * a real Batch 1 row, so learners can see the event and continue through the
 * normal batch -> seat -> details -> payment flow. It is idempotent.
 */
export async function ensureLearnerVisibleBatch(courseId: string) {
  const { data, error } = await supabase.rpc('ensure_learner_batch', {
    p_course_id: courseId,
  });
  if (error) throw error;
  return data as Batch | null;
}

export async function listBatches(courseId: string) {
  const { data, error } = await supabase
    .from('batches')
    .select(
      'id, course_id, name, start_date, end_date, duration_weeks, timings, seats_total, seats_filled, registration_deadline, created_at'
    )
    .eq('course_id', courseId)
    .order('start_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as Batch[];
}

async function getBatchWithError(batchId: string) {
  const { data, error } = await supabase
    .from('batches')
    .select(
      'id, course_id, name, start_date, end_date, duration_weeks, timings, seats_total, seats_filled, registration_deadline, created_at'
    )
    .eq('id', batchId)
    .single();

  return { data: data as Batch, error };
}

export async function getBatch(batchId: string) {
  const { data, error } = await getBatchWithError(batchId);
  if (error) throw error;
  return data;
}


/**
 * Publish/synchronise the first event when a Learning Partner saves a course.
 * Existing multi-batch schedules are preserved; this only creates/updates the
 * legacy/default Batch 1 used by older courses.
 */
export async function syncPrimaryBatchFromCourse(courseId: string, input: {
  start_date: string | null;
  duration_weeks?: number | null;
  timings?: string | null;
  seats_total: number;
  registration_deadline?: string | null;
}) {
  if (!input.start_date) return null;
  const current = await listBatches(courseId);
  if (current.length > 1) return current[0];

  const payload: BatchInput = {
    name: current[0]?.name?.trim() || 'Batch 1',
    start_date: input.start_date,
    end_date: input.duration_weeks ? undefined : current[0]?.end_date ?? null,
    duration_weeks: input.duration_weeks ?? null,
    timings: input.timings ?? null,
    seats_total: input.seats_total, // chosen by the Learning Partner (1-200)
    registration_deadline: input.registration_deadline ?? null,
  };

  if (current[0]) return updateBatch(current[0].id, payload);
  return createBatch(courseId, payload);
}

export async function createBatch(courseId: string, input: BatchInput) {
  const { data, error } = await supabase.rpc('create_batch', {
    p_course_id: courseId,
    p_name: input.name.trim(),
    p_start_date: input.start_date ?? null,
    p_end_date: input.end_date ?? null,
    p_duration_weeks: input.duration_weeks ?? null,
    p_timings: input.timings?.trim() || null,
    p_seats_total: clampSeats(input.seats_total),
    p_registration_deadline: input.registration_deadline ?? null,
  });

  if (error) throw error;
  return data as Batch;
}

export async function updateBatch(batchId: string, input: Partial<BatchInput>) {
  const { data: current, error: readError } = await getBatchWithError(batchId);
  if (readError) throw readError;

  const { data, error } = await supabase.rpc('update_batch', {
    p_batch_id: batchId,
    p_name: input.name !== undefined ? input.name.trim() : current.name,
    p_start_date: input.start_date !== undefined ? input.start_date : current.start_date,
    p_end_date: input.end_date !== undefined ? input.end_date : current.end_date,
    p_duration_weeks:
      input.duration_weeks !== undefined
        ? (input.duration_weeks == null ? null : Math.max(1, Math.trunc(input.duration_weeks)))
        : current.duration_weeks,
    p_timings: input.timings !== undefined ? (input.timings?.trim() || null) : current.timings,
    p_seats_total:
      input.seats_total !== undefined ? clampSeats(input.seats_total) : current.seats_total,
    p_registration_deadline:
      input.registration_deadline !== undefined
        ? input.registration_deadline
        : current.registration_deadline,
  });

  if (error) {
    // Compatibility fallback for projects where the update_batch RPC has not
    // been refreshed yet. Provider ownership is still enforced by RLS.
    const payload = {
      name: input.name !== undefined ? input.name.trim() : current.name,
      start_date: input.start_date !== undefined ? input.start_date : current.start_date,
      end_date: input.end_date !== undefined ? input.end_date : current.end_date,
      duration_weeks: input.duration_weeks !== undefined ? (input.duration_weeks == null ? null : Math.max(1, Math.trunc(input.duration_weeks))) : current.duration_weeks,
      timings: input.timings !== undefined ? (input.timings?.trim() || null) : current.timings,
      seats_total: input.seats_total !== undefined ? clampSeats(input.seats_total) : current.seats_total,
      registration_deadline: input.registration_deadline !== undefined ? input.registration_deadline : current.registration_deadline,
    };
    const { data: updated, error: directError } = await supabase.from('batches').update(payload).eq('id', batchId).select('id, course_id, name, start_date, end_date, duration_weeks, timings, seats_total, seats_filled, registration_deadline, created_at').single();
    if (directError) throw directError;
    return updated as Batch;
  }
  return data as Batch;
}

export async function deleteBatch(batchId: string) {
  const { data, error } = await supabase.rpc('delete_batch', { p_batch_id: batchId });
  if (error) throw error;
  return data as boolean;
}
