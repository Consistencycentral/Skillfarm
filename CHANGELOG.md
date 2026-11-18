# CHANGELOG.md

All notable changes to the SkillFarm app and its deployments.
Format follows Keep a Changelog; the project versions with `app.json` +
`lib/buildInfo.ts` (`v1.7.4 · build 12.14` at the time of this migration).

---

## [Unreleased] — Cloudflare migration + design polish

### Added
- **Cloudflare Pages deployment** (`skillfarm`), replacing Netlify:
  `public/_redirects` (SPA fallback), `public/_headers` (immutable caching for
  hashed assets, baseline security headers), app-link claim files.
- **Per-route link previews** — `functions/_middleware.js` (Pages Function)
  rewrites Open Graph + Twitter tags from the Supabase `public_courses` /
  `public_orgs` views. Course and organisation URLs now unfurl with their real
  title, description and location.
- **Branded social card** `public/og-image.png` (1200×630).
- **`public/robots.txt`** and build-time **`dist/sitemap.xml`**
  (`scripts/gen-sitemap.mjs`, generated from public courses + organisations).
- **`scripts/post-export-fix.mjs`** — after `expo export`: moves
  `assets/node_modules/**` to `vendor/`, rewrites bundle asset URLs, prunes icon
  fonts for unused families, and asserts the SPA/app-link files exist.
- **Branded 404** — `app/+not-found.tsx`.
- **Design tokens (additive)** — `theme.colors.dark*` palette, `theme.motion`,
  `theme.touch` minimum target sizes; no existing key changed.
- **Docs**: `AUDIT.md`, `ASSUMPTIONS.md`, `SIZE_REPORT.md`,
  `DELIVERY_REPORT.md`, `FIGMA_SPEC.md`, `BLOCKED.md`.
- `npm run build:web` / `npm run deploy:web` scripts.

### Fixed
- **Invisible icons in production** — `wrangler pages deploy` skips
  `node_modules` paths, so Expo's bundled icon fonts 404'd into the SPA
  fallback. Fonts now live under `vendor/` and serve as real `font/ttf`
  (389,724 B).
- **Repository could not build** — restored `lib/supabase.ts`,
  `lib/storage.ts`, `lib/ticket.ts`; added missing `lib/typography.ts` and
  `lib/updatesSeen.ts` to the API the screens call.
- **Share links pointed at the dead Netlify domain** — `lib/deeplink.ts` now
  rejects any `*.netlify.app` host and resolves to the live origin
  (env → `window.location.origin` → inlined `https://skillfarm.pages.dev`).
  `canonicalShareUrl()` rewrites legacy URLs from stored data. Applied to
  course, organisation and ticket shares. Published as OTA updates to `preview`
  and `production` so installed apps heal without a reinstall.
- **App-link claim files missing** — `.well-known/assetlinks.json` and
  `.well-known/apple-app-site-association` restored and served raw (the preview
  middleware was injecting HTML into them).
- **Stale build output** — `build:web` wipes `dist/` first; an `eas update` had
  left a 45 MB mixed-platform export (45 MB, no `index.html`) in place.
- **Deploy weight** — 6.0 MB → 5.4 MB by pruning 18 unused icon font families
  (−3.52 MB).

### Changed
- Site URLs in `app.json`, `eas.json`, `.env.example`, `lib/applinks.ts` and the
  setup docs now point at `skillfarm.pages.dev`; `netlify.toml` removed.
- Android/iOS deep-link hosts updated to the Cloudflare domain.

### Removed
- `netlify.toml`.
- 18 unused icon TTF bundles from the deploy (still installable if a family is
  ever imported).

### Known gaps
- APK size work (ProGuard/R8, resource shrinking) is configured but not yet
  compiled into a build.
- `git push` to GitHub is blocked on a PAT without Contents: write.
- Per-route previews cover `/course/*` and `/org/*`; private routes intentionally
  keep the site-wide card.

---

## [1.7.4 · build 12.14] — prior release (baseline)
Sign-in/sign-up keyboard jumping fix; app-first deep links with org/course share
from the provider list; shared course/org pages return to the app correctly.
Source of truth for this migration.