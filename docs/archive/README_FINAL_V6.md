# SkillFarm — Final Client Ready V6

This version keeps the client-required SkillFarm functionality and adds focused marketplace UX improvements:

- Reusable `NextBatchInfo` preview with real batch dates, timings, capacity and registration deadline.
- Batched next-batch loading for learner course lists to avoid N+1 batch queries.
- Smart learner course filters: location, fee range, upcoming batches and available seats.
- Clear registration status timeline and real-data status summary on My Seats.
- Provider dashboard summary: courses, upcoming batches, pending requests, approved learners and available seats.
- Course detail highlights the next available batch before batch selection.
- Existing batch capacity, waitlist, approval/rejection, duplicate prevention, reviews, exports and organization gallery remain intact.

No fake data or new dependencies were introduced.

## Supabase

Apply the migrations in the existing project order, including:
- `supabase/migrations/20260903_multi_batch_system.sql`
- `supabase/migrations/20260904_review_access.sql`
- `supabase/migrations/20260907_client_visibility_and_org_gallery.sql`
- `supabase/migrations/20260908_review_owner_guard.sql`

The consolidated `supabase/SKILLFARM_FINAL_CLIENT_FIX.sql` also contains the corresponding final client fixes and schema refresh statements.
