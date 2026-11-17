# SkillFarm Auth Setup (after code fix)

The code now handles the OAuth callback and session itself. The Supabase Dashboard still needs the provider/redirect configuration.

## Supabase project

Project URL for this SkillFarm build:

`https://eyzfbuisexschgrtkcdv.supabase.co`

Keep this as the value of `EXPO_PUBLIC_SUPABASE_URL`. Do not append `/rest/v1/`.

## Supabase → Authentication → URL Configuration

Add these redirect URLs:

- `https://skillfarm.pages.dev/auth/callback`
- `skillfarm://auth/callback`
- Your local web URL while developing, for example `http://localhost:8081/auth/callback`

If your deployed web hostname changes, add the new `/auth/callback` URL as well.

For local web development, the Expo web server normally uses port `8081`, so the exact local callback is:

`http://localhost:8081/auth/callback`

If Expo starts on a different port, add that exact callback URL too.

## Supabase → Authentication → Providers → Google

Enable Google and enter the Google OAuth client credentials from Google Cloud Console.

Google's authorized redirect URI must be the Supabase project's callback endpoint shown by the Supabase dashboard (the `.../auth/v1/callback` URL), not the SkillFarm `/auth/callback` route.

## Email authentication

If email confirmation is enabled, SkillFarm now correctly handles `signUp()` returning a user with `session = null` and asks the user to confirm their email before signing in.

## Required SQL

Run the newest migration after the existing migrations:

`supabase/migrations/20261006_auth_language_security.sql`

This migration:
- makes `profiles` readable only by its owner;
- adds `onboarding_complete`;
- adds a restricted registration-contact RPC for authorized Learning Partners;
- creates the authenticated course projection;
- keeps the anonymous `public_courses` / `public_orgs` projections available.

## Environment

Set:

`EXPO_PUBLIC_SUPABASE_URL`
`EXPO_PUBLIC_SUPABASE_ANON_KEY`

Never put a Supabase `service_role` key in the Expo app.

For deployed password-reset web links, optionally set:

`EXPO_PUBLIC_SITE_URL=https://skillfarm.pages.dev`
