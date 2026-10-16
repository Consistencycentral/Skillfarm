# SkillFarm - fixes v7 (2026-10-13)

## Do this first (nothing else will work without it)
The v6 SQL file was never run on the live Supabase project. The errors you saw
("stack depth limit exceeded", Approve failing, 40-seat booking, reviews) are
all database-side and stay until it runs:

1. Supabase -> SQL Editor -> run `supabase/migrations/20261013_client_fixes_v6.sql` once
   (on a backup/staging copy first). It is safe to run twice.
2. Run the two verification queries at the bottom of that file. Both must return 0 rows.
3. Do NOT run anything in `supabase/legacy_do_not_run/`.

## Changed in v7 (app code)
| Problem | Fix |
|---|---|
| Provider app shows a tab called "materials/[courseId]" that spins forever | The provider materials screen now lives at `(provider)/course-materials/[courseId]`, is hidden from the tab bar, and never spins if opened without a course. It also no longer shares a URL with the learner materials screen. |
| Partner had no way to open course materials | A folder icon on each course card in Courses opens Materials for that course. |
| Dashboard still had an "Export learner report" panel | Removed. Export now exists only on the Learners screen (Export data popup with the Age / Location / Experience / Additional details panel). |
| Learners list showed "Unnamed learner" / no phone | Shows the name and phone the learner typed when booking, then falls back to the profile. Load errors are shown with a Retry button instead of an empty list. Counts refresh after Approve/Reject. |
| Saving a course could be refused with a seats error | The course form no longer sends a seat total on edit (capacity is 40 per batch, owned by batches). "stack depth" now shows a clear "run the v6 migration" message. |
| Course could be saved with a past start date / deadline, so nobody could ever book (your "Mega project": deadline Aug 2, 2026) | New dates must be in the future and the deadline must not be after the start date. Old finished courses can still have their text edited. |
| Booking popup said the partner "has not published" an event when the date had only passed | It now says the last event date has passed and a new date is needed. |

## Already in v6 (verified present in code, needs the SQL above to work)
Approve -> confirmed seat; exactly 40 seats per batch with no overbooking; seat map clickable;
saved courses per signed-in learner; My Seats and profile counts (Enrolled / Completed /
Pending approval / Waitlist); reviews and replies; Tamil/Hindi course text; no Compare page and
no Certificate Wallet (neither exists in the code).

## Not code - needs you
* Google sign-in: Supabase -> Authentication -> Providers -> Google (Client ID + Secret),
  redirect URLs `https://skillfarm.netlify.app/auth/callback` and `skillfarm://auth/callback`,
  Android SHA-1/SHA-256 in Firebase. Native Google sign-in does not work in Expo Go.
* Razorpay: intentionally not added yet (as you said, later).
* Certificate upload by the partner: not built; the course form only has the
  "Certificate available on completion" Yes/No switch.
* Tamil/Hindi: partners type the translated text in the course form. There is no teacher/trainer
  field on the course page to translate.
* "Mega project" itself has a past event. After the SQL runs, edit it and pick a future start
  date (and deadline) to make it bookable.

## Booking screen redesigned like BookMyShow (v7b)
* Booking opens full-screen with the event date, time and venue under the course name.
* Seat map: curved "screen" at the top, row letters on both sides, seats named A1, B3 ...,
  green = available, solid green = yours, grey with a cross = taken.
* Fixed bottom bar: "Seat B3 - Free/₹fee" with a Proceed button (like "Pay" on BookMyShow).
* Seat label (A1...) is also used in the booking summary and the confirmation.
* One seat per learner per batch (the database rule). Booking is still a request that the
  Learning Partner approves; there is no payment step.
