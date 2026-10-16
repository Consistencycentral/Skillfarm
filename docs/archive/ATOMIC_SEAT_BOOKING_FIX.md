# SkillFarm — Registration + Seat Booking Fix

## Fixed
- New email signup now clearly detects Supabase's existing-account response and switches the learner to Sign in instead of treating the account as newly created.
- Course enrollment now requires a seat selection for batch-based courses.
- Seat selection uses a theatre/BookMyShow-style grid with available, selected and booked states.
- The selected seat is submitted together with the registration request.
- Supabase now enforces one active learner per batch seat with a partial unique index and an atomic registration RPC.
- A race where two learners choose the same seat is handled safely; one succeeds and the other receives a retry message.
- Cancelled/rejected registrations release their seat automatically because the uniqueness rule applies only to active statuses.

## Required Supabase step
Run `supabase/migrations/20261009_atomic_seat_booking.sql` in the Supabase SQL Editor after the existing batch/theatre-seat migrations.
