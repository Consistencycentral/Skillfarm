# SkillFarm Booking Flow Update

The learner booking experience is now a BookMyShow-style 3-step flow:

1. **Batch** — choose the date/time batch.
2. **Seat** — tap an available seat from the theatre-style seat map.
3. **Your details** — confirm learner details and tap **Book Seat**.

Successful bookings are immediately marked `registered` and increment the batch's
`seats_filled` count. The exact seat is stored in `registrations.preferred_seat_number`
and protected by the active-seat unique index.

## Supabase migration required

Run this migration in Supabase SQL Editor after the existing seat migrations:

`supabase/migrations/20261010_direct_seat_booking.sql`

The previous `register_seat` approval workflow remains available for older/provider
flows; this new `book_seat` RPC is used only by the new learner seat-booking flow.

## Visual update

Category/sector colors now use the SkillFarm primary green instead of changing colors
by category. The booking UI also uses the same green + neutral palette throughout.

## 2026-10-08 — Fresh booking-flow test mode

For local PowerShell testing, `.env.local` enables `EXPO_PUBLIC_BOOKING_FLOW_TEST_MODE=true`.

In this mode:
- Existing occupied-seat markers are hidden from the learner seat map so the flow starts visually clean.
- Batch selector shows the full configured seat capacity as available for UI testing.
- Past/deadline batch UI gates are relaxed locally so the Batch -> Seat -> Your details flow can be inspected.
- The real Supabase booking RPC is still used when the final booking is submitted; this test mode does **not** delete or modify existing database registrations.

To return to production seat availability locally, remove `.env.local` or change the flag to `false`.


## 2026-10-08 — Final learner booking UI

The supplied project now uses the real booking flow by default (`EXPO_PUBLIC_BOOKING_FLOW_TEST_MODE=false`).

- **Step 1 — Batch:** all batches returned for the course are listed with batch name, date range, timing, capacity and seats available.
- **Step 2 — Seat:** the selected batch opens the theatre-style seat map. Exact occupied seats come from `get_batch_booked_seats`; selecting a seat is required before continuing.
- **Step 3 — Your details:** learner registration fields are collected and a live **Details to be registered** review is shown before submission.
- **After booking:** the confirmation screen shows the batch, seat, status and the full registered learner details.

The exact seat is persisted through `book_seat` and the `preferred_seat_number` field. Apply the existing migrations `20260903_multi_batch_system.sql`, `20261008_theatre_seat_integrity.sql`, and `20261010_direct_seat_booking.sql` in Supabase if they have not already been applied.
