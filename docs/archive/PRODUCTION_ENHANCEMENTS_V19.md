# SkillFarm v19 — Production enhancements

Implemented (excluding referral/rewards):
- FlashList for high-volume learner course lists.
- Offline banner + cached course discovery fallback.
- Course skeleton loading.
- Realtime notification refresh with a 60s safety refresh instead of 6s polling.
- Local training reminders (24h + 1h) synced from My Seats.
- Attendance status surfaced in My Seats.
- Certificate Wallet entry and completed-course eligibility view.
- Profile quick links to Certificate Wallet and Attendance/My Seats.
- Existing recommendation/personalization engine retained.
- Existing partner trust profile, reviews, QR ticket and payment states retained.

Still requiring backend/provider operations for a production launch:
- Actual certificate file issuance by Learning Partners.
- WhatsApp Business API automation (the app can use native sharing/reminders but automated outbound WhatsApp requires a verified provider/account).
- Supabase Realtime must be enabled for the notifications table if not already enabled.
