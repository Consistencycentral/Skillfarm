# Learner booking fix when the app developer has no Supabase access

This build fixes the learner UI contradiction for older courses: when no batch row is readable, the app mirrors the course's own published event date, timing, total seats and filled seats instead of showing a contradictory `FULL` state.

A real seat reservation/payment still requires a real `batches` row and the existing Supabase booking RPC. If the Learning Partner has not published a batch row, the app will clearly tell the learner that partner sync is required rather than pretending a booking succeeded.

For older single-batch courses, the included migration `20261008_legacy_batch_seat_count_sync.sql` keeps `Batch 1` in sync with the course-level seat counts when the client eventually runs migrations.


# FINAL booking architecture — client deployment note

The learner booking flow now uses one authoritative source: `public.batches`.
A Learning Partner's normal course Publish/Save action synchronizes its first
published event into `batches`; multi-batch schedules are preserved.

## One-time client action
Run this migration in the client's Supabase SQL Editor:

`supabase/migrations/20261011_learning_partner_event_sync.sql`

The existing batch/payment migrations in this project must also already be
deployed. This new migration is safe to re-run and does not create fake learner
events.

After deployment, a partner only needs to publish the course with an event
date, timing and seat capacity. Learners then see:

Learning Partner -> Publish event -> Upcoming batch -> Exact seats -> Your details -> Razorpay -> Verified success popup.

The app never treats a course-level legacy seat count as a real booking batch.
This prevents `39 seats left` on the course page from conflicting with `Full`
in the booking modal.

## 2026-10-08 auth + test reset update
- The app now recovers from a stale/future JWT session by clearing only the invalid local session and asking the learner to sign in again.
- If the booking modal says no upcoming batch, use **Refresh event** after the Learning Partner publishes the event.
- For TEST/STAGING only, run `SUPABASE_ONE_TIME_RESET_2_LIVE_COURSES_40_SEATS.sql` to prepare two upcoming courses as 40 seats / 0 bookings.
