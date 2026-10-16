# SkillFarm — Razorpay booking setup

## Learner flow

1. Learning Partner creates a batch. If no custom name is supplied, SkillFarm uses **Batch 1**.
2. Seat capacity defaults to **30** in the provider form; the partner can change it.
3. Learner chooses the batch/date/timing.
4. Learner chooses one exact seat from the two-block theatre-style map.
5. Learner fills **Name, Contact number, Email, Age, Location, Previous experience, Additional details**.
6. Paid courses create a `pending` seat hold and open Razorpay.
7. Razorpay webhook verifies the payment.
8. Only after verified payment does the registration become `registered` and the batch's `seats_filled` increase.
9. The learner can then open the QR ticket/materials.

Free courses skip Razorpay and are registered immediately.

## Supabase migration

Run:

`supabase/migrations/20261008_booking_payment_flow.sql`

## Supabase Edge Functions

Deploy both functions:

- `supabase/functions/create-razorpay-payment`
- `supabase/functions/razorpay-webhook`

Set Function secrets:

- `RAZORPAY_KEY_ID` — Razorpay public key ID
- `RAZORPAY_KEY_SECRET` — Razorpay secret; **never** put this in Expo `.env`
- `RAZORPAY_WEBHOOK_SECRET` — a long random secret configured identically in Razorpay Dashboard
- `SKILLFARM_SITE_URL` — optional public SkillFarm web URL for the Razorpay callback redirect

The app itself only uses the Supabase client and never receives the Razorpay secret.

## Razorpay Dashboard

Create a webhook pointing to:

`https://<YOUR_SUPABASE_PROJECT>.supabase.co/functions/v1/razorpay-webhook`

Enable the **payment_link.paid** event.

The webhook signature must match `RAZORPAY_WEBHOOK_SECRET`. The webhook function also checks the registration reference ID, payment-link ID, and exact amount before confirming the seat.

## Important

Do not mark a learner as `registered` from the app merely because they tapped **Pay** or returned from the Razorpay page. The webhook is the authoritative payment confirmation.
