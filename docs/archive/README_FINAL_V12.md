# SkillFarm — Final V12 client-complete pass

Built on V11.

## Added in V12
- Google OAuth sign-in/sign-up button on the login screen.
- Native/deep-link OAuth callback route (`skillfarm://auth/callback`) plus web-safe callback route.
- First-time Google/email accounts are sent through language preference onboarding before role selection.
- Account language preference stored in `profiles.preferred_language`.
- English + all 22 languages listed in India's Eighth Schedule are available as selectable preferences.
- Searchable language picker.
- Preferred language can be reopened later from Learner and Learning Partner profiles.
- Current app UI remains English; the saved preference is ready for future translation/content localization and does not change course text entered by providers.
- Added `supabase/migrations/20260910_language_preference.sql`.
- Added the same language schema change to `supabase/SKILLFARM_FINAL_CLIENT_FIX.sql`.
- Fixed the V11 TypeScript `compare.tsx` implicit-any row callback issue.

## Important Supabase setup for Google login
In Supabase Authentication > Providers, enable Google and configure the Google OAuth credentials.
Add the following redirect URLs to the Supabase Auth URL configuration as appropriate:
- `skillfarm://auth/callback` for Android/iOS builds.
- Your deployed web callback URL for the web build (Expo/Netlify URL with `/auth/callback`).

Google OAuth cannot become functional from app code alone unless the Google provider is enabled in the Supabase project.

## Language migration
Run:
`supabase/migrations/20260910_language_preference.sql`

If using the consolidated script instead, its final language-preference section can be applied once after the existing SkillFarm migrations.

## Validation
After extracting this ZIP:
1. `npm install`
2. `npx tsc --noEmit`
3. `npx expo start`
4. Test email signup -> language selection -> role selection.
5. Test Google -> language selection -> role selection.
6. Test profile -> Preferred language -> save -> return.
7. Test existing email login still lands in the correct role.
