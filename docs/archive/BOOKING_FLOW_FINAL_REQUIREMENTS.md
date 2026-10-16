# SkillFarm — Final Booking Flow Requirements

Implemented in this build:

1. **Batch / event list**
   - Shows every real batch published for the course.
   - Shows upcoming status, event date, exact timing, duration, location, seat capacity, seats available and registration status.
   - Seat capacity is read from the Learning Partner's `batches.seats_total`; it is not hard-coded.

2. **Seat selection**
   - Uses the selected batch's exact capacity.
   - Example: a batch with `seats_total = 30` renders exactly 30 seats.
   - Theatre-style rows A/B/C... with a centre aisle.
   - Available / Selected / Occupied states are shown.

3. **Your details**
   - Name, phone and email are auto-filled from the signed-in learner profile when available.
   - Location/age are also prefilled when those profile fields exist; otherwise the course city is used as a sensible location default.
   - Learner can edit all editable fields before submission.
   - A final "Details to be registered" preview is shown.

4. **Payment**
   - Registration creates the pending booking first and then routes directly to the Razorpay payment screen.
   - Razorpay credentials remain server-side in Supabase Edge Functions.
   - After the Razorpay webhook verifies payment, the app polls and shows a payment-success popup with course, batch, seat and amount.
   - The popup opens the final ticket/booking screen.

5. **No fake batch capacity**
   - The booking build no longer treats local test mode as a production booking path.
   - If no batch exists in Supabase, the learner sees that the Learning Partner has not published an upcoming event yet.
   - Run the existing `supabase/migrations/20260903_multi_batch_system.sql` (or the consolidated client SQL already in the project) so existing courses get a `Batch 1` copied from the course's date, timings and seat capacity.
