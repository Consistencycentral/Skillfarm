# Booking 40-seat test update

- The seat map is exact-capacity: a 40-seat event renders exactly seats 01–40.
- A fresh test reset SQL is included: `SUPABASE_ONE_TIME_RESET_2_LIVE_COURSES_40_SEATS.sql`.
- The reset targets the first 2 currently-live upcoming courses, clears their old registrations, and sets the primary batch to 40 total / 0 booked.
- Learner browsing is read-only and no longer creates a missing batch automatically.
- After the reset, the intended flow is 0/40 available -> select one seat -> details -> Razorpay -> server/webhook verified success.
