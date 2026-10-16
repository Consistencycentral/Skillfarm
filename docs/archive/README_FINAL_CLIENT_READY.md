# SkillFarm — Final Client Requirements Build

This ZIP is the complete SkillFarm source with the client-requested marketplace workflow implemented and the visible learner/provider UX updated.

## What is now covered

- Learner + Learning Partner roles.
- Learning Partner organization profile with logo, **up to 6 organization photos**, sectors, contact/location, Google Maps link and trainers.
- Courses with fee, description, eligibility, certificate, images and course details.
- **Multiple real batches per course** with name, date range, timings, capacity and registration deadline.
- Learner explicitly chooses a batch before sending a registration request.
- Batch capacity is enforced server-side; full batches become **waitlist**.
- Registration is a **request**; the Learning Partner approves/rejects it.
- Registration form captures name, contact number, email, age, location, previous experience and additional details.
- Provider dashboard shows course, learner, batch and registration status, with PDF + Excel-compatible export.
- Signed-in users can review/comment without needing an approved registration; course owner cannot review their own course.
- Learner Home/course cards surface the next batch, timing, availability and batch count when batch data is available.
- My Seats shows the selected batch and its dates/timings.
- PostgREST relationship-cache issue is avoided in the app by fetching batch details separately; the final SQL also refreshes the schema cache.

## Local validation

```powershell
npm install
npx tsc --noEmit
npx expo start
```

Do not run `npm audit fix --force`; this project is intentionally pinned to Expo SDK 54.

## IMPORTANT — Supabase

The app source cannot change the live Supabase database by itself.

Run this **one SQL file** in the existing SkillFarm Supabase SQL Editor:

`supabase/SKILLFARM_FINAL_CLIENT_FIX.sql`

It is designed to be re-runnable and non-destructive. It includes the multi-batch, registration snapshot, review-access, organization-gallery and PostgREST schema-refresh changes.

Do not reset or recreate the database.

After the SQL finishes, refresh the app. The `registrations -> batches` error on **My Seats** should disappear.

## Main client-demo flows

### Learner
Home → Courses → Course → **Choose your batch** → Register → registration form → request sent → My Seats.

### Full batch
Course → choose a full batch → **Full — join waitlist** → request enters waitlist.

### Learning Partner
Courses → Add/Edit course → **Manage batches** → create multiple dated/capacity batches → Students → approve/reject → Export PDF/Excel.

### Organization
Profile → organization details → **Organization photos** → trainers → Save profile. The photos appear on the public Learning Partner profile.
