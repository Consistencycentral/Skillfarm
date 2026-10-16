// ===========================================================================
// Reviews — program/course reviews + public partner replies. A learner may
// leave ONE review per course when signed in. The Learning Partner who owns
// the course cannot review it, but may post ONE public reply.
// ===========================================================================
import { supabase } from '../lib/supabase';

export interface Review {
  id: string;
  course_id: string;
  learner_id: string;
  rating: number;            // 1–5
  body: string | null;
  created_at: string;
  // joined from profiles:
  learner_name?: string | null;
  // joined from review_replies (0 or 1):
  reply?: ReviewReply | null;
}

export interface ReviewReply {
  id: string;
  review_id: string;
  partner_id: string;
  body: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// List all reviews + replies + learner names for a course, newest first.
// ---------------------------------------------------------------------------
export async function listCourseReviews(courseId: string): Promise<Review[]> {
  // Preferred path: the privacy-safe projection created by the latest SQL migration.
  const projection = await supabase
    .from('public_course_reviews')
    .select('id, course_id, learner_id, rating, body, created_at, learner_name, reply_id, reply_review_id, reply_partner_id, reply_body, reply_created_at')
    .eq('course_id', courseId)
    .order('created_at', { ascending: false });

  if (!projection.error) {
    return (projection.data ?? []).map((row: any): Review => ({
      id: row.id,
      course_id: row.course_id,
      learner_id: row.learner_id,
      rating: row.rating,
      body: row.body,
      created_at: row.created_at,
      learner_name: row.learner_name ?? null,
      reply: row.reply_id ? {
        id: row.reply_id,
        review_id: row.reply_review_id,
        partner_id: row.reply_partner_id,
        body: row.reply_body,
        created_at: row.reply_created_at,
      } : null,
    }));
  }

  // Compatibility fallback for databases where the public_course_reviews view
  // has not been created/refreshed in PostgREST's schema cache yet. Read only
  // the review rows and the public reply rows, then combine them client-side.
  // This fixes the course page without exposing the profiles table.
  const { data: reviewRows, error: reviewError } = await supabase
    .from('reviews')
    .select('id, course_id, learner_id, rating, body, created_at')
    .eq('course_id', courseId)
    .order('created_at', { ascending: false });
  if (reviewError) throw reviewError;

  const rows = (reviewRows ?? []) as any[];
  if (rows.length === 0) return [];

  const reviewIds = rows.map((r) => r.id);
  const [{ data: replies }, { data: profiles }] = await Promise.all([
    supabase
      .from('review_replies')
      .select('id, review_id, partner_id, body, created_at')
      .in('review_id', reviewIds),
    supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', Array.from(new Set(rows.map((r) => r.learner_id)))),
  ]);

  const replyByReview = new Map<string, any>((replies ?? []).map((r: any) => [r.review_id, r]));
  const nameByUser = new Map<string, string | null>((profiles ?? []).map((p: any) => [p.id, p.full_name ?? null]));

  return rows.map((r: any): Review => {
    const rr = replyByReview.get(r.id);
    return {
      id: r.id,
      course_id: r.course_id,
      learner_id: r.learner_id,
      rating: r.rating,
      body: r.body,
      created_at: r.created_at,
      learner_name: nameByUser.get(r.learner_id) ?? null,
      reply: rr ? {
        id: rr.id,
        review_id: rr.review_id,
        partner_id: rr.partner_id,
        body: rr.body,
        created_at: rr.created_at,
      } : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Average rating + count for a course.
// ---------------------------------------------------------------------------
export async function getCourseRating(courseId: string): Promise<{ avg: number; count: number }> {
  const { data, error } = await supabase
    .from('reviews')
    .select('rating')
    .eq('course_id', courseId);
  if (error) throw error;
  const ratings = (data ?? []).map((r: any) => r.rating as number);
  if (ratings.length === 0) return { avg: 0, count: 0 };
  return { avg: ratings.reduce((a, b) => a + b, 0) / ratings.length, count: ratings.length };
}

// ---------------------------------------------------------------------------
// Batched ratings for the discovery/Home screen: avg + count per course id.
//
// This is `getCourseRating` fanned out over many courses in one place. We filter
// by the ids we actually show (`.in('course_id', chunk)`) rather than doing an
// unfiltered `select('course_id, rating')` — the latter would ship EVERY review
// row in the system to every learner as the catalogue grows. Chunked at 100 ids
// per request to stay under PostgREST's URL length limit; served by
// `reviews_course_id_idx`. `reviews_select_all` is `using (true)`, so a learner
// may read across courses. Returns a map; ids with no reviews are simply absent.
// ---------------------------------------------------------------------------
export interface CourseRatingStat { avg: number; count: number }
export type CourseRatingMap = Record<string, CourseRatingStat>;

const RATING_CHUNK = 100;

export async function listAllCourseRatings(courseIds: string[]): Promise<CourseRatingMap> {
  const ids = Array.from(new Set(courseIds.filter(Boolean)));
  if (ids.length === 0) return {};

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += RATING_CHUNK) {
    chunks.push(ids.slice(i, i + RATING_CHUNK));
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      supabase.from('reviews').select('course_id, rating').in('course_id', chunk)
    )
  );

  // { courseId: { sum, count } } accumulator, folded into avg at the end.
  const acc: Record<string, { sum: number; count: number }> = {};
  for (const { data, error } of results) {
    if (error) throw error;
    for (const row of (data ?? []) as any[]) {
      const cid = row.course_id as string;
      const r = row.rating as number;
      const bucket = acc[cid] ?? (acc[cid] = { sum: 0, count: 0 });
      bucket.sum += r;
      bucket.count += 1;
    }
  }

  const map: CourseRatingMap = {};
  for (const cid of Object.keys(acc)) {
    const { sum, count } = acc[cid];
    map[cid] = { avg: count > 0 ? sum / count : 0, count };
  }
  return map;
}

// ---------------------------------------------------------------------------
// Learner: create or update my review for a course.
// ---------------------------------------------------------------------------
export async function upsertReview(courseId: string, rating: number, body: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error('Not signed in.');
  // Preferred: server function (clear errors, owner check, upsert in one step).
  const rpc = await supabase.rpc('submit_review', { p_course_id: courseId, p_rating: rating, p_body: body.trim() || null });
  if (!rpc.error) {
    const res = rpc.data as { ok: boolean; error?: string } | null;
    if (res && res.ok === false) throw new Error(res.error ?? 'Could not save your review.');
    return;
  }
  // Older database without the function: fall back to direct table access.
  // Try update first (unique course_id+learner_id); if no row matches, insert.
  const { data: updated, error: upErr } = await supabase
    .from('reviews')
    .update({ rating, body: body.trim() || null })
    .eq('course_id', courseId)
    .eq('learner_id', u.user.id)
    .select('id');
  if (upErr) throw upErr;
  if (!updated || updated.length === 0) {
    const { error: insErr } = await supabase
      .from('reviews')
      .insert({ course_id: courseId, learner_id: u.user.id, rating, body: body.trim() || null });
    if (insErr) throw insErr;
  }
}

// ---------------------------------------------------------------------------
// Learner: delete my review for a course.
// ---------------------------------------------------------------------------
export async function deleteReview(reviewId: string): Promise<void> {
  const { error } = await supabase.from('reviews').delete().eq('id', reviewId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Partner: post a public reply under a review (one per review).
// ---------------------------------------------------------------------------
export async function postReply(reviewId: string, body: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error('Not signed in.');
  const rpc = await supabase.rpc('post_review_reply', { p_review_id: reviewId, p_body: body });
  if (!rpc.error) {
    const res = rpc.data as { ok: boolean; error?: string } | null;
    if (res && res.ok === false) throw new Error(res.error ?? 'Could not post your reply.');
    return;
  }
  const { error } = await supabase
    .from('review_replies')
    .upsert(
      { review_id: reviewId, partner_id: u.user.id, body: body.trim() },
      { onConflict: 'review_id' }
    );
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Partner: delete my reply under a review.
// ---------------------------------------------------------------------------
export async function deleteReply(reviewId: string): Promise<void> {
  const { error } = await supabase
    .from('review_replies')
    .delete()
    .eq('review_id', reviewId);
  if (error) throw error;
}
