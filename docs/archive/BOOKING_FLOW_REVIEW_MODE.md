# SkillFarm review mode

This build is configured for a clean client-review flow:

1. Cold app launch signs out the previous session.
2. Login opens on **Create account**.
3. After signup and learner role selection, browse a course.
4. **Book Seat** opens Batch -> Seat -> Your details.
5. If Supabase has no batch row for the course, the UI supplies a temporary Batch 1 so the complete flow can be demonstrated.
6. If real Supabase batches exist, those are used instead.

Environment flags are in `.env.local`: `EXPO_PUBLIC_FRESH_START=true` and `EXPO_PUBLIC_BOOKING_FLOW_TEST_MODE=true`.

Before production, set both to `false` and create real batches in Supabase.
