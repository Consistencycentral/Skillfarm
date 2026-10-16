# SkillFarm v13

## Registration identity fix
- Registration state is cleared before every course/batch lookup.
- Existing registration is matched strictly by authenticated `student_id` + `course_id` + `batch_id`.
- Enrollment email is locked to the signed-in account email to prevent a typed email from being mistaken for a different account.
- A missing/failed registration lookup defaults to Request a seat, never Registered.

## UI refresh
- Subtle glass-style surfaces with translucent borders, rounded cards, depth and softer hierarchy.
- Seat map upgraded with clearer status hierarchy and selected-seat elevation.
- Primary CTA uses softer modern geometry and restrained elevation.

## Important
The logged-in Supabase account is the identity for registration. Typing another email cannot create a second identity inside the same login session; use a separate authenticated account to test a truly new learner.
