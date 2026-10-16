# SkillFarm Auth + 40-seat booking fix — 2026-10-08

Implemented in this build:

1. **Future JWT recovery**
   - Detects a clearly future-issued Supabase access token at app startup.
   - If Supabase explicitly returns `JWT issued at future`, the local session is cleared.
   - The app does not keep retrying a broken session.
   - Network/offline errors do not force logout.

2. **Duplicate email signup**
   - Existing email is switched to Sign in mode.
   - User gets a clear `Account already exists` message.

3. **Booking event refresh**
   - The booking modal now has `Refresh event` when no upcoming batch is visible.
   - It re-reads the real `batches` table; it does not create fake learner-side data.

4. **40-seat test/staging reset SQL**
   - `SUPABASE_ONE_TIME_RESET_2_LIVE_COURSES_40_SEATS.sql` now guarantees a real Batch 1 exists for the first two upcoming live courses selected by the script.
   - Resets selected courses to 40 seats and 0 bookings.
   - Ensures the selected primary event date is not in the past.
   - Deletes old registrations for those two selected test courses.

## Important

The SQL reset is destructive for the two selected courses and must only be run on test/staging, or after the client confirms those two courses have no real customer registrations.

Production learner booking still uses `public.batches` as the source of truth. No fake local batch or fake seat count is created by the learner UI.
