# SkillFarm — fixes v6 (2026-10-13)

## 1. Database (do this first, on a backup/staging copy)
Run **one** file in Supabase → SQL Editor:

    supabase/migrations/20261013_client_fixes_v6.sql

It is safe to run twice. It needs the older migrations (multi-batch, reviews) to
already exist and tells you clearly if something is missing. Afterwards run the
read-only verification queries at the bottom of that file: both must return 0 rows.
Do NOT run anything in `supabase/legacy_do_not_run/`.

## 2. What changed
| Client point | Change |
|---|---|
| Course edit "stack depth limit exceeded" | Trigger loop removed in the database (v6 migration). |
| Approve not working, Reject working | Same loop. Approve now turns a pending request into a confirmed seat. |
| Seats: exactly 40, no overbooking, correct counts | 40 per batch is forced by the database; a batch can never hold more than 40; a seat can't be held twice; counts = pending + confirmed seats. Course form and batch form show "40 (fixed)". |
| Seat selection not clickable | Seat map no longer greys out seats based on a counter; only seats the server reports as held are blocked. |
| My Seats / profile counts | Booking now creates "Pending approval"; profile shows Enrolled, Completed, Pending approval, Waitlist. The "Complete payment" button was removed. |
| Saved courses | Saved per signed-in learner (was shared by every account on the device). |
| Reviews & ratings | App now uses `submit_review` / `post_review_reply` (clear errors, owner check). |
| Languages (EN/TA/HI) | All course-page labels are translated. Course title/description/agenda/outcomes/eligibility/timings show the partner's Tamil/Hindi text when entered in the course form ("Tamil/Hindi version"); otherwise English is shown. |
| Export panel / learner details | Learners screen has one Export popup with the Age / Location / Experience / Additional details panel. |
| Compare page, Certificate Wallet | Not present in this code base; unused compare helpers removed. |
| Razorpay | Not added. Existing dormant payment files were left untouched but nothing links to them. |
| Course delete | Deleting a course failed ("A course must keep at least one batch"); fixed in the migration. |

## 3. Needs dashboard settings (cannot be fixed in code)
Google Sign-In: Supabase → Authentication → Providers → Google (Client ID + Secret),
redirect URLs `https://skillfarm.netlify.app/auth/callback` and `skillfarm://auth/callback`,
and the Android SHA-1/SHA-256 in Firebase. See GOOGLE_AUTH_SETUP.md.

## 4. Known limits
* Titles/agendas typed by partners are not machine-translated; partners add the Tamil/Hindi text.
* A public (signed-out) course link still shows English content.
* "Booking = request the partner approves" is how the client's list was interpreted; change it only deliberately.
