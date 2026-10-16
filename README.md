# SkillFarm

Expo (React Native + expo-router) app with a Supabase backend.

## Run
```
npm install
cp .env.example .env      # fill EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY
npx expo start
```

## Android test build (APK)
```
npm install
eas build -p android --profile preview
```
After installing, the login screen shows the build label (e.g. `SkillFarm · v1.7.4 · build 12.14`).
If the label is not the latest, the phone still has an old APK.

## Over-the-air (JS-only) updates
`eas update --channel preview --message "..."` (needs a build made with this version of `app.json` / `eas.json`).

## Notes
* Supabase SQL: `supabase/migrations`, one-time scripts in `supabase/*.sql`.
* Release notes per version: `CLIENT_FIXES_*.md` (latest: `CLIENT_FIXES_V12_12.md`).
