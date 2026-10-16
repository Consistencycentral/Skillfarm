# Booking + Reviews compatibility fix — 2026-10-08

- Local test mode now creates one non-persistent `Batch 1 · Test booking` when a course has no DB batch rows.
- Local test mode starts with all seats available and completes the UI flow without writing a fake booking to Supabase.
- Reviews no longer hard-fail when `public.public_course_reviews` is missing from the PostgREST schema cache. The client falls back to `reviews` + `review_replies` and display names.
- Added `supabase/migrations/20261008_booking_reviews_compat.sql` to restore the review projection in the real Supabase database.
- Production booking behaviour remains unchanged when `EXPO_PUBLIC_BOOKING_FLOW_TEST_MODE=false`.
