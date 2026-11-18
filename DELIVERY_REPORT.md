# SkillFarm — Migration Audit & Fix Report (2026-11-18)

## W1/W2 — Icon invisibility on Cloudflare: ROOT CAUSE + FIX ✅
**Evidence:** `https://skillfarm.pages.dev/assets/node_modules/.../Ionicons.<hash>.ttf`
returned **200 with 1215 bytes of `text/html`** (the SPA-fallback index.html),
not the 389 KB font. The JS bundle and `_redirects` uploaded fine.
**Root cause:** `wrangler pages deploy` silently skips every path containing
`node_modules`. Expo's web export puts bundled fonts/images at
`dist/assets/node_modules/...` → fonts never uploaded → fallback HTML served
as font → invisible icons.
**Fix:** `scripts/post-export-fix.mjs` (wired into `npm run build:web`):
moves `dist/assets/node_modules` → `dist/vendor` and rewrites the 31 asset
URLs inside the JS bundle. Deployed 49 files; font now returns
`200, 389724b, font/ttf` with a valid TTF magic header.

## W3 — Netlify → Cloudflare ✅
- `netlify.toml` deleted; SPA fallback lives in `public/_redirects` (same syntax).
- Domain replaced everywhere: `app.json` (8), `eas.json` (2), `.env.example` (2),
  `lib/applinks.ts` (5), setup docs, `supabase/public-catalog-fix.sql` →
  `skillfarm.pages.dev`.
- App-link claim files restored at `public/.well-known/` and verified live
  (assetlinks.json: 200, application/json).
- Historical CLIENT_FIXES_*.md left untouched (changelog history, not shipped code).

## Live site now = v12.14 (same as Netlify)
Desktop "Copy" folder was 19 commits behind. Synced to `origin/main`
(Google sign-in, ticket QR, attendance, analytics, batches…) + restored 4
modules the GitHub upload was missing:
- `lib/supabase.ts`, `lib/storage.ts`, `lib/ticket.ts` (recovered from local master)
- `lib/typography.ts`, `lib/updatesSeen.ts` (recreated to their referenced API)

## Google sign-in
Web flow = Supabase OAuth popup → `auth/callback` (lib/auth-callback.ts),
redirect URL is computed from `window.location.origin`, so it works on the
Cloudflare domain automatically. **One manual step:** Supabase Dashboard →
Auth → URL Configuration → add `https://skillfarm.pages.dev/auth/callback`
to Redirect URLs (and App redirect URLs), else Google login loops back to
Netlify. Android app uses native Google Sign-In (unchanged).

## Size
Web dist: **6.0 MB** (2.0 MB JS gzip ~600 KB + 4.3 MB icon fonts/images) —
well under any 100 MB target. The "250 MB" figure is the Android APK (native
toolchain), not the website. APK size unchanged by this migration.

## W4-W7 (deep links, redesign, size, polish)
- Deep links already implemented in-repo (applinks.ts, deeplink.ts, share URLs);
  now correctly served on Cloudflare + `_headers` not needed (CF sets sane defaults).
- UI redesign (W5) & further size work (W6) NOT executed — live app already has a
  token system (`constants/theme.ts`) and clean v12.14 UI; per operator's note
  "don't disturb anything that works". Recommended as a separate later workstream.

## W4 — Share links fixed (2026-11-18, later session)
User-reported: copied course link still showed the old Netlify URL.
**Root cause:** local `expo export` doesn't read eas.json, so
`EXPO_PUBLIC_SITE_URL` was never injected → `SITE_URL` undefined → shares
fell back to `createURL()` (scheme links / stale env).
**Fix:** `lib/deeplink.ts` now resolves SITE_URL = env → `window.location.origin`
(web) → inlined `https://skillfarm.pages.dev`. `lib/ticket.ts` reuses it.
Verified in the live bundle: `SITE_URL = window.location.origin ?? pages.dev`,
0 netlify refs in the served JS.
**ACCEPT W3:** grep -ri netlify over shipped code (excl. historical changelogs)
= 0. **ACCEPT W4:** all share routes (/course,/org,/ticket,/auth/callback)
return 200 with SPA fallback; OG preview is static meta (expo default) —
per-route dynamic OG requires a serverless worker, deferred by design.

## W4 (final) — share links are hard-blocked from ever being netlify
Root cause of "still netlify in the app": the APK on the phone was built when
`eas.json` still had `EXPO_PUBLIC_SITE_URL=https://skillfarm.netlify.app`, so the
value was **baked into its JS bundle**. Web was fixed but the phone kept the old
string.
Fix:
1. `lib/deeplink.ts` rewritten — a `*.netlify.app` host is never honoured.
   Resolution: sanitised env → `window.location.origin` (web) → inlined
   `https://skillfarm.pages.dev`. `courseShareUrl`, `orgShareUrl`, `siteUrl`,
   `authRedirectUrl` all use it; `canonicalShareUrl()` rewrites any legacy
   netlify URL (stored data included) to pages.dev.
2. `lib/ticket.ts` uses the same constant.
3. Web rebuilt + deployed (live bundle: 0 netlify refs, contains the block regex).
4. **OTA updates published to both channels** so installed APKs self-heal:
   - preview: update group `deddd301-571e-4285-9ef8-e56550a0113a`
   - production: update group `d87bcf49-c5b0-4dbd-8d6c-a1a52c90f02a`
   (runtime 1.7.4). The APK picks this up on next cold start with network.

## BLOCKED (1 item)
- `git push origin main` → 403: the stored GitHub PAT has no write access to
  `Consistencycentral/Skillfarm`. Fix: create a fine-grained PAT with
  Contents: Read+Write on Skillfarm, then `git push origin main` from the
  "SKILLfarm - Copy" folder (commit `6fff7ac` is ready locally).

## Future deploys
```
npm install            # once
npm run deploy:web     # builds + fixes fonts + uploads to skillfarm.pages.dev
```
