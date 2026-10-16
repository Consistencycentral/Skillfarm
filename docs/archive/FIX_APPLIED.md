# SkillFarm — fixes applied in this build

## Fixed

1. Added the missing `supabase/20261006_auth_language_security.sql` migration referenced by the app's auth/language implementation.
2. Added the 23 supported language codes to the database validation and kept account preference persistence through `profiles.preferred_language`.
3. Added core translated navigation/account/language strings for all 23 language choices instead of falling back to English for unsupported codes.
4. Kept Supabase session persistence: SecureStore on native and localStorage on web.
5. Kept Google Android ID-token → Supabase session flow.
6. Bumped Android versionCode to 2 and app version to 1.0.1 for a fresh test build.

## Required outside the ZIP

Google OAuth credentials, SHA-1/SHA-256 signing fingerprints, Supabase Google provider settings, and Supabase redirect URLs are dashboard settings. They cannot be safely changed by editing the client ZIP.

Run the SQL migration and follow `GOOGLE_AUTH_SETUP.md` before testing Google Sign-In.
