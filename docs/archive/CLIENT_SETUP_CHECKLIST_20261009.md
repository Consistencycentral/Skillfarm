# SkillFarm – what must be done in the accounts (one page)

Everything in the app code is already fixed in this zip. The items below can only
be done inside the Supabase / Firebase / Razorpay / Expo accounts.
Do them in this order.

## 1. Supabase → SQL Editor  (≈2 min, safe to re-run)
Paste and run the whole file:
`supabase/migrations/20261012_fix_trigger_loop_restore_razorpay.sql`

It fixes:
- "stack depth limit exceeded" when a Learning Partner approves a booking
- the missing Razorpay step (paid course → pending → Razorpay → registered)
- seats stuck forever when a learner abandons the payment page
  (a `pending` hold is released after 30 minutes; a late payment is still
  honoured if the seat is free, otherwise the SQL answer tells you to refund)

If it stops with "SkillFarm fix cannot run yet. Missing: …", run the older file it
names first, then run this one again.

## 2. Supabase → Edge Functions + secrets  (needed for Razorpay)
Deploy both functions from `supabase/functions/`:
- `create-razorpay-payment`  (JWT verification ON)
- `razorpay-webhook`         (JWT verification **OFF** – Razorpay does not send a Supabase token.
  `supabase/config.toml` already says this when deployed with the CLI; in the dashboard
  switch "Verify JWT" off for this one function.)

Secrets (Project settings → Edge Functions → Secrets):
`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
(optional: `SKILLFARM_SITE_URL` = `https://skillfarm.netlify.app`)

Razorpay dashboard → Webhooks:
- URL: `https://eyzfbuisexschgrtkcdv.supabase.co/functions/v1/razorpay-webhook`
- Event: `payment_link.paid`
- Secret: the same value as `RAZORPAY_WEBHOOK_SECRET`

A course must have **Fee > 0** to go through Razorpay.

## 3. Supabase → Authentication → Providers → Google
Add this under **Authorized Client IDs**:
`334322665437-cgfc4tejd9lnb9qc40td4mqapdu1ff49.apps.googleusercontent.com`
(without it Google sign-in is rejected by Supabase even when the app side is correct)

## 4. Firebase – Google sign-in on Android
1. `npx eas credentials -p android` → copy SHA-1 and SHA-256
   (if the app is on Google Play with Play App Signing, also copy the
   *App signing key* SHA-1 from Play Console → App integrity)
2. Firebase project `skillfarm-bf0ab` → Project settings → Android app
   `com.skillfarm.app` → **Add fingerprint** (each SHA)
3. Download the new `google-services.json` and replace the one in the project root.
   It must now contain an entry with `"client_type": 1`.

## 5. Build
- Test APK (installable on a phone): `npx eas build -p android --profile preview`
- Play Store bundle (AAB):            `npx eas build -p android --profile production`
(`npx eas build -p android` with no profile builds the production AAB.)
Native Google sign-in does not work in Expo Go.

## Quick test after everything
1. Learner books a paid course → Razorpay page opens → pay → seat becomes *registered*.
2. Learning Partner approves / changes a booking → no "stack depth" error.
3. Learner closes the payment page → after 30 min the seat is free again.
4. Google sign-in on the installed APK.

---

## Client feedback list – status

| # | Client point | Status |
|---|---|---|
| 1 | Google sign-in | Code fixed. Needs steps 3 + 4 above (Supabase Authorized Client ID + Firebase SHA + new google-services.json + rebuild). |
| 2 | Cannot approve, only reject / "stack depth limit exceeded" on course edit | Fixed by the SQL in step 1 (tested: approve, reject, course edit). |
| 3 | Razorpay | Works once step 2 is done. Can be postponed. |
| 4 | Language only changes outer content | Screen labels follow the language. Text typed by the Learning Partner (agenda, trainer details) is stored in one language and is **not** auto-translated. |
| 5 | Reviews & ratings | Learning Partner now sees rating + review count on every course and a "View & reply" shortcut. Run `20260908_review_owner_guard.sql` and `20261008_booking_reviews_compat.sql` if reviews still fail to post. |
| 6 | Export panel always visible on learners page | Removed. Now a single "Export data" button opens a popup. |
| 7 | Additional details panel | The popup has an "Additional details" panel (Age, Location, Experience Yes/No, Additional information) with on/off switches; each learner card also shows these details. |
| 8 | Seat selection not clickable | A batch was treated as closed on its registration-deadline day and on its start day. Fixed in the app and in the SQL. The booking popup now also says clearly when no batch is open (full / past deadline). Partner: re-save the course with future dates after running the SQL. |
| 9 | Saved courses not filtered | Saved page shows only saved courses; un-saving removes the card immediately. |
| 10 | My Seats "needs database update" | My Seats no longer depends on optional columns/relations and shows the real error text if something else fails. |
| 11 | Profile counters | Enrolled / Pending approval / Waitlist / Completed are shown. |
| 12 | Certificate wallet | Removed. |
| 13 | Course comparison | Removed (page, button and card toggle). |
