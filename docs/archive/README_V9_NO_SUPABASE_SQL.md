# SkillFarm v9 — client-side compatibility fix

This build does NOT require the user to run a new Supabase SQL migration.

Changes:
- Seat map uses the selected batch's `seats_total` as the hall capacity.
- Existing `get_batch_booked_seats` RPC is used when already present.
- If that RPC is unavailable, the app falls back to registration seat markers and batch `seats_filled` for the visual seat map.
- Preferred seat is saved through the learner's own registration row instead of requiring a new `set_preferred_seat` RPC.
- A seat that became booked before submission is rejected and the map refreshes.
- Language labels for the theatre seat map are translated in English, Tamil and Hindi.
- No new Supabase table/RPC is required by this build.
