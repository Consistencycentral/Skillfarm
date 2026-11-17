# SkillFarm Google Sign-In — final setup

The app keeps **Supabase Auth as the real application identity**. Google supplies the ID token; Supabase creates/persists the application session.

## Already fixed in this project

- Firebase `google-services.json` is included.
- Android package is `com.skillfarm.app`.
- `@react-native-google-signin/google-signin` is configured.
- The Web OAuth client ID from `google-services.json` is used by native Google Sign-In.
- Android exchanges the Google ID token with Supabase using `signInWithIdToken()`.
- Supabase sessions persist with SecureStore on Android/iOS and localStorage on web.
- Google users get a profile automatically and are sent through language/role onboarding when needed.
- App version is now `1.0.1` / Android versionCode `2`.

## One-time dashboard checks

### Firebase / Google Cloud

1. Open Firebase project `skillfarm-e77b3`.
2. Make sure the Android app package is exactly `com.skillfarm.app`.
3. Add the **SHA-1 and SHA-256** fingerprints for the certificate used by the APK/AAB you are testing.
   - EAS development/preview and Google Play production can have different signing certificates.
   - Add every certificate that will actually sign a build.
4. In Google Cloud/Firebase, make sure the OAuth Web client exists. The app uses the Web client ID contained in `google-services.json`.

### Supabase

In **Authentication → Providers → Google**:

- Enable Google.
- Configure the Google OAuth client ID/secret expected by your Supabase project.
- Save the provider.

In **Authentication → URL Configuration → Redirect URLs**, allow:

- `https://skillfarm.pages.dev/auth/callback`
- `skillfarm://auth/callback`
- your local web callback if you test locally, for example `http://localhost:8081/auth/callback`

Do not put a Supabase `service_role` key in the app.

## Database migration

Run this file once in **Supabase → SQL Editor**:

`supabase/migrations/20261006_auth_language_security.sql`

It adds/repairs:

- `profiles.preferred_language`
- `profiles.onboarding_complete`
- supported-language validation
- language index
- own-profile insert/update policies

It does **not** remove the existing public course/catalog policies.

## Build and test

From the project folder in PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
npm install
npx expo prebuild --clean
npx eas build --platform android --profile development
```

Install the generated APK on a real Android phone. Do **not** use Expo Go for native Google Sign-In.

### Test checklist

1. New email signup → account created → language screen → role screen.
2. Confirm email if Supabase email confirmation is enabled → sign in again → same profile continues.
3. Existing email login → session survives app restart.
4. Google new account → profile created → language → role.
5. Google existing account → saved language/role restored.
6. Cancel Google picker → no scary error.
7. Select each language → selection persists after restart.
8. Sign out → session is cleared.

If Google still fails after the APK build, the error is most likely an OAuth/SHA/redirect configuration mismatch rather than the React Native auth code.
