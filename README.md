# SkillFarm

Offline-first course registration for rural skilling: learners find in-person
training from local Learning Partners, request a seat in one tap, and keep their
enrolments and tickets on their phone.

- **Web (live):** https://skillfarm.pages.dev — Cloudflare Pages project `skillfarm`
- **Stack:** Expo SDK 54 (React Native 0.81.5, expo-router 6) + Supabase
- **App id:** `com.skillfarm.app` · scheme `skillfarm` · v1.7.4 · build 12.14

## Run locally

```bash
npm install
cp .env.example .env      # fill EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY
npx expo start            # press w for web, a for Android
```

## Deploy the web build

```bash
npm run deploy:web
```

That single command:

1. deletes `dist/` (a stale export once produced a 45 MB broken deploy),
2. runs `expo export --platform web`,
3. `scripts/post-export-fix.mjs` — moves `assets/node_modules/**` to `vendor/**`
   (wrangler refuses to upload `node_modules` paths, which is what made every
   icon invisible), rewrites the bundle's asset URLs, prunes unused icon
   families and asserts the SPA/app-link files exist,
4. `scripts/subset-icons.mjs` — subsets the Ionicons TTF to the glyphs the app
   actually uses (381 KB → ~40 KB),
5. `scripts/gen-sitemap.mjs` — writes `dist/sitemap.xml` from the public views,
6. `wrangler pages deploy dist --project-name skillfarm`.

First run needs `npx wrangler login`.

## Android build (APK)

```bash
npx eas-cli build -p android --profile preview
```

`app.json` enables R8/ProGuard, resource shrinking and PNG crunching, so each
release build is materially smaller than the 1.7.4 baseline.

## OTA (JS-only) updates

```bash
npx eas-cli update --channel preview --message "..."
```

## Layout

```
app/           screens (expo-router); +not-found.tsx = branded 404
components/    design-system primitives (ui.tsx, Button, motion, cards)
constants/     theme.ts — colours, type scale, spacing, shadows, motion, touch
lib/           supabase client, session, deeplinks, storage, offline cache, i18n
api/           typed data access (courses, landing, registrations, reviews…)
functions/     Cloudflare Pages Function: per-route OG/Twitter previews
scripts/       build post-processing (export fix, font subset, sitemap)
public/        _redirects, _headers, robots.txt, og-image, .well-known claim files
```

## Documentation

| File | Contents |
|---|---|
| `AUDIT.md` | diagnostic audit: 12 defects with evidence, fix plan |
| `ASSUMPTIONS.md` | decisions taken without asking, plus open questions |
| `CHANGELOG.md` | what changed in the migration |
| `SIZE_REPORT.md` | measured web/APK size work |
| `FIGMA_SPEC.md` | design system ready to rebuild in Figma |
| `DELIVERY_REPORT.md` | final metrics and verification results |
| `BLOCKED.md` | blocked items, each with two ways forward |

## Notes

- Supabase SQL lives in `supabase/migrations`; one-time scripts in `supabase/*.sql`.
- Release notes per version: `CLIENT_FIXES_*.md`.
- Google sign-in needs `https://skillfarm.pages.dev/auth/callback` in Supabase →
  Authentication → URL Configuration.
- Cloudflare answers `200` with an empty body to bare `curl`/scripted clients
  (bot protection). Send a browser `User-Agent` when verifying by hand.