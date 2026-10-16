# SkillFarm 1.6.5 merged repair

Baseline: SkillFarm_AI_FIXED_1.6.4_20260905 (last known-good build).

Preserved from the newer build: Google Android native sign-in, OAuth callback handling, 3-language onboarding (English/Tamil/Hindi), language preference persistence, cross-platform web Alert wrapper, role/onboarding guard fixes, and Google service configuration.

Restored from the last known-good build: AI assistant, learning materials, downloads, payment, ticket/QR, provider analytics/attendance/materials routes, their supporting libraries/APIs, React Query provider/dependencies, production Expo plugins and deep links.

Version bumped to 1.6.5 / Android versionCode 24 to avoid downgrading the app build.


## Registration + learning-material access fix (2026-10-07)
- New email signup now detects Supabase's existing-account/empty-identities response and sends the user to Sign in instead of pretending a new account was created.
- A learner with a confirmed `registered`/`completed` course enrollment now gets an actionable `Already registered · Open course` button that opens the course materials.
- Materials access accepts paid/not-required registrations and falls back to approved registration status on older databases that do not expose `payment_status`.
- New learners still see `Request a seat` only when no active registration exists for the selected course batch.

### Expected behaviour
1. Brand-new email + password → Create account succeeds; it must not show Already registered.
2. Existing email → Account already exists; user switches to Sign in.
3. New learner with no registration on the selected batch → Request a seat.
4. Learner already approved/registered → Already registered · Open course → Learning materials.
5. Approved learner with published PDF/Excel/note/video → Open or Download works; downloaded files remain available offline.
