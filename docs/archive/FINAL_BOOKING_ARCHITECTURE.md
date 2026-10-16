# SkillFarm — Final Booking Architecture

## Production flow

Learning Partner
→ Publish course event (date, timing, capacity)
→ `batches` row is created/synchronised
→ Learner opens Book Seat
→ Upcoming batch list
→ Exact batch capacity
→ Exact seat map
→ Auto-filled learner details
→ Atomic pending seat hold
→ Razorpay payment
→ Server-side payment verification/webhook
→ `registered` + seat confirmed
→ Payment-success popup + ticket

## Source of truth

`public.batches.seats_total` and `public.batches.seats_filled` are the booking capacity source.
The learner UI never converts legacy `courses.seats_total` into a fake batch.

This prevents the earlier contradiction where the course card could show `39 seats left` while the booking modal showed `Full` or `No upcoming batch`.

## One-time client deployment

The client must deploy:

`supabase/migrations/20261011_learning_partner_event_sync.sql`

The project already contains the batch, atomic seat-booking, theatre-seat and Razorpay migrations/functions. Those must be deployed to the client's Supabase project as part of the normal production setup.

After the event-sync migration is deployed, saving/publishing a course with a real event start date automatically creates or synchronises its first `Batch 1` when no multi-batch schedule exists. Existing multiple batches are never overwritten.

## Important date rule

The learner sees only upcoming events. A past event is not treated as bookable even if it still has seats.

## Payment rule

Paid bookings remain `pending` until the Razorpay server/webhook verifies the exact payment. The app never marks a paid booking as confirmed merely because the learner tapped Pay or returned from the payment page.

## Fresh 40-seat test state

For the current booking test, use `SUPABASE_ONE_TIME_RESET_2_LIVE_COURSES_40_SEATS.sql` in a test/staging Supabase database. It resets the first two currently-live upcoming courses to 40 seats with zero registrations. The learner app itself does not fabricate or create a batch while browsing.
