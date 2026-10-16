# SkillFarm — Client Requirements Completion

This build keeps the existing SkillFarm architecture and implements the requested marketplace workflow:

- Learner + Course Provider roles
- Organization profile details, images/logo, location and trainer information
- Multiple real batches per course
- Batch dates, duration, timings, capacity and registration deadline
- Batch-specific learner registration requests
- Provider approval/rejection with database-side capacity protection
- Waitlist handling for full batches
- Duplicate registration protection per learner/course/batch
- Provider learner management with PDF and Excel-compatible CSV export
- Authenticated course reviews without requiring an approved registration
- Course-owner self-review blocked in the UI
- Clearer batch selection, seat availability and learner registration summary
- Batch details shown in My Registrations
- Registration form captures name, contact number, email, experience and optional additional details
- Registration stores a per-request snapshot of learner name/contact/additional details for provider review and export

## Supabase migration order

Run the existing migrations in order, then review and apply:

`supabase/migrations/20260904_review_access.sql`
`supabase/migrations/20260905_registration_contact_details.sql`

Do not run migrations blindly against production. Review them against the live Supabase schema first.

## Local validation

After extracting the project:

```bash
npm install
npx tsc --noEmit
npx expo start
```

The ZIP intentionally excludes `node_modules`, `.git`, and `.expo`.


## CLIENT-READY V4 / 2026-09-06

### What changed visibly
- Learner course cards now show the next batch, date/time, and batch seats when batch data is available.
- Course detail shows a dedicated “Choose your batch” section before the seat request.
- Signed-out visitors can see batch choices; sign-in is only required to request a seat.
- Seat request language now makes the approval workflow explicit: the learner sends a request and the Learning Partner approves it.
- Provider course cards show how many batches are configured and expose “Manage”.
- Provider dashboard export copy now correctly says PDF or Excel.
- My Seats gives a clear database-update message and Retry action when the batch relationship has not yet been applied.

### IMPORTANT: Supabase update
If My Seats or Profile shows “Could not find a relationship between 'registrations' and 'batches' in the schema cache”, the app code is ready but the database migration has not been applied.

In Supabase Dashboard → SQL Editor, run the complete file:
`supabase/SKILLFARM_CLIENT_UPDATE_20260906.sql`

Then reload the app. The final `NOTIFY pgrst, 'reload schema'` refreshes the API schema cache.

Recommended production migration order remains:
1. existing baseline migrations
2. `20260903_multi_batch_system.sql`
3. `20260904_review_access.sql`
4. `20260905_registration_contact_details.sql`

The consolidated SQL file is provided for convenience when the database is already on the baseline. Do not run unrelated or destructive SQL.
