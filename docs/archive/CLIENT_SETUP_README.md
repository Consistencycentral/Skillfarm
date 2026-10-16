# SkillFarm — Client Ready Setup

## Normal app run
From PowerShell:

```powershell
cd "C:\Users\wwwpo\Downloads\SkillFarm_FINAL_AUTH_40_SEAT_BOOKING_FIX_V2"
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\START_SKILLFARM.ps1
```

This build does not force a fresh account on every launch. It uses the real Supabase session and real booking flow.

## One-time Supabase step
The app cannot create database tables/functions from the browser for security reasons. The SkillFarm repository therefore includes the complete Supabase migration history under `supabase/migrations/`.

If the client's deployment system already runs Supabase migrations from that folder, no manual action is needed.

If it does not, the client's Supabase administrator must run the migrations once. The booking-specific migrations are:
- 20260903_multi_batch_system.sql
- 20260909_seat_preference.sql
- 20261007_theatre_seat_map.sql
- 20261008_booking_payment_flow.sql
- 20261008_ensure_legacy_batch_for_learner.sql
- 20261008_legacy_batch_seat_count_sync.sql
- 20261008_theatre_seat_integrity.sql
- 20261009_atomic_seat_booking.sql
- 20261010_direct_seat_booking.sql
- 20261011_learning_partner_event_sync.sql

For the requested test state (two upcoming courses, 40 seats each, zero bookings), use:
`SUPABASE_ONE_TIME_RESET_2_LIVE_COURSES_40_SEATS.sql`

Only use that reset on test/staging or after confirming those two courses have no real customer bookings.

## Expected learner flow
Book Seat -> upcoming batch -> exact 01-40 seat map -> Your details -> Razorpay -> server/webhook verified success -> ticket.
