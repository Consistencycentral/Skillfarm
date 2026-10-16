# SkillFarm - v9 (2026-10-18): Waitlist + real Push

## What changed
| Item | Change |
|---|---|
| Waitlist (7) | A full batch now shows **Join waitlist** (course page + booking flow). The learner fills the same details form, no seat is held. When a held seat is released (learner cancels / partner rejects) the **oldest** waitlisted learner gets the lowest free seat automatically as *Pending*; the partner still approves. My Seats shows "You're #N on the waitlist"; the learner can leave the waitlist. |
| Real push (5) | "Seat approved", "Request not approved" and "A seat opened up for you" now arrive as real push notifications, also when the app is closed. Tapping opens the ticket / My Seats. |

## Order to deploy
1. **SQL** - Supabase -> SQL Editor -> run `supabase/migrations/20261018_waitlist_and_push.sql` once (safe to re-run). Run it AFTER v6 + v8.
2. **Edge Function** (push only):
   ```
   supabase secrets set PUSH_WEBHOOK_SECRET=<a long random string>
   supabase functions deploy send-push --no-verify-jwt
   ```
3. **Tell the database where to call** (push only). SQL Editor, use the SAME secret as above:
   ```sql
   insert into public.app_settings (key, value) values
     ('push_function_url',   'https://eyzfbuisexschgrtkcdv.supabase.co/functions/v1/send-push'),
     ('push_webhook_secret', '<same long random string>')
   on conflict (key) do update set value = excluded.value;
   ```
   Until both rows exist the push trigger silently does nothing (bookings and approvals are never affected).
4. **EAS credentials** (push only): Android needs an FCM V1 service-account key uploaded to EAS
   (`eas credentials` -> Android -> Google Service Account Key for Push Notifications). iOS: EAS creates the APNs key during a build with the Apple Developer account.
5. **App**: ship a new build (EAS). Waitlist is JS-only; push needs a real build, it does not work in Expo Go.

## How to test
* Waitlist: fill a batch to 40, sign in as a 41st learner -> "Join waitlist". Cancel one seat -> the 41st learner becomes *Pending* with that seat.
* Push: real phone, sign in as learner, book a seat, approve it from the partner account -> notification arrives with the app closed.
* If no push arrives: `select * from net._http_response order by created desc limit 5;` (status 401 = secret mismatch, 500 = function secret missing).

## Rules / limits
* Promoted learner still needs partner approval (same as a normal booking). The seat given is the lowest free seat, not a chosen one.
* No time limit on a promoted seat. Batches that already started do not promote.
* A learner can hold either seats or a waitlist spot in the same batch, not both.
* Learners hold up to 6 seats; approving several seats sends one push per seat.
* Push is sent to learners only (no partner "new request" push yet).
* With real push active the older on-device alert is silent, so approvals do not pop up twice. In Expo Go / permission denied, the old on-device alert is still the fallback (app open only).
