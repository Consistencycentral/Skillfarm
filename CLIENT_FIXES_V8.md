# SkillFarm - fixes v8 (2026-10-14)

## Order to deploy (do in this order)
1. Supabase -> SQL Editor -> run `supabase/migrations/20261014_client_fixes_v8.sql` once
   (after v6, which is already run). Safe to run twice. Check the 4 verification queries at the bottom.
2. Auto-translate (optional): `supabase secrets set ANTHROPIC_API_KEY=...` then
   `supabase functions deploy translate-course`.
3. Deploy the v8 app (Netlify web / EAS native). Clients must hard-refresh or reinstall.
4. Edit "Mega project" and set a FUTURE start date + deadline.

## What changed
| Item | Change |
|---|---|
| Certificate upload (pt 12) | Partner can upload a PDF/image certificate in Add/Edit course (shown when "Certificate available" = Yes). Learners see "View sample certificate" on the course page. Bucket `course-certificates`. |
| Teacher details (pt 4) | New "Trainer name" and "About the trainer" fields; shown on the course page; translatable to Tamil/Hindi. |
| Title/agenda translate | New "Auto-translate to Tamil + Hindi" button in the course form. Fills only EMPTY boxes; partner can edit before saving. |
| Signed-out link shows English | The public view did not carry the translations. Fixed in the SQL (`public_courses`) and in `api/landing.ts` (falls back safely if SQL not run yet). |
| Multiple seats / price | Learner can pick up to 6 seats in one booking. One registration per seat, each approved/cancelled separately by the partner/learner. Booking bar and summary show price per seat and total. |
| My Seats | Shows the seat label on each card; Cancel releases exactly that seat. |

## Limits / not done
* Seat price is the course fee after discount, per seat. No online payment (Razorpay is still later).
* After a booking is placed, the learner cannot add more seats to the same batch from the course page
  (button says "Request sent"). They can book other batches.
* Certificate is ONE sample/template file per course, not a per-learner certificate.
* Google sign-in (Supabase provider + Firebase SHA keys) is config, not code.
* Auto-translate needs the Anthropic key above; without it the button shows an error and manual typing still works.

## v8b (2026-10-14) - no more hard block when SQL is missing
* Saving a course no longer fails if the v8 SQL has not been run: trainer/certificate/translation
  fields are skipped and the course still saves (with a notice).
* Booking ONE seat falls back to the v6 function if `book_seats` is missing. Multiple seats still need SQL.
* New single file `supabase/RUN_THIS_ONCE_v6_plus_v8.sql` = v6 + v8 in the right order. Run it once in
  the Supabase SQL Editor and everything is enabled.
