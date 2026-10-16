# SkillFarm — Final Client Requirements V5

Implemented and verified in source:
- Learner + Learning Partner roles
- Organization profile with logo + multi-photo gallery
- Courses with multiple real batches
- Batch dates, timings, capacity and registration deadline
- Learner batch selection
- Registration request flow with name, phone, email, age, location, experience and additional details
- Server-side capacity protection and waitlist behavior
- Provider approve/reject workflow
- Provider learner dashboard with batch filters/details
- PDF + Excel-compatible CSV export
- Signed-in review access without requiring registration
- Course owner blocked from reviewing their own course at UI + RLS level
- Public organization gallery
- My Seats uses batch data without requiring the fragile nested PostgREST relationship

## Supabase migration order
Run the existing project migrations in order, then run:
1. `supabase/migrations/20260907_client_visibility_and_org_gallery.sql`
2. `supabase/migrations/20260908_review_owner_guard.sql`

Or use the consolidated `supabase/SKILLFARM_FINAL_CLIENT_FIX.sql` for the project's final client database update.

## Local validation
```powershell
npm install
npx tsc --noEmit
npx expo start
```

Do not use `npm audit fix --force`; it can introduce breaking Expo/router upgrades.
