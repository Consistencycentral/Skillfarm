# SkillFarm V10

Adds a theatre-style batch seat map as a **preferred seat** interaction. Occupied seats are derived from real batch capacity/fill data; selecting a seat is clearly presented as a preference until provider approval, so the request workflow and backend capacity guarantees are preserved.

Also fixes the missing `supabase` import in `app/course/[id].tsx` and includes the seat-preference migration `supabase/migrations/20260909_seat_preference.sql`.
