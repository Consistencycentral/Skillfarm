# AUDIT.md — SkillFarm diagnostic audit

Date: 2026-11-18
Scope: the Expo/React-Native app ("SKILLfarm - Copy") and its web deployment.
Method: static inspection of the repo, live HTTP probes against the deployed
site, byte-level asset comparisons, and a local `wrangler pages dev` harness.
Every claim below is backed by a command output quoted with it.

---

## 1. Stack inventory

| Layer | What is actually used | Evidence |
|---|---|---|
| Framework | Expo SDK 54 (`expo@~54.0.36`), React Native 0.81.5, React 19.1 | `package.json` |
| Routing | `expo-router@~6.0.24`, file-based routes under `app/` | `package.json`, `app/` tree |
| Web renderer | `react-native-web@^0.21.0`, Metro bundler | `app.json` → `web.bundler: metro` |
| Backend | Supabase (`@supabase/supabase-js@^2.45.0`) | `lib/supabase.ts` |
| Auth | Email/password + Google (web OAuth via Supabase, native Google Sign-In on Android) | `app/login.tsx`, `lib/google-native.*.ts` |
| Storage | `localStorage` on web, `expo-secure-store` on native | `lib/supabase.ts` |
| Hosting | Cloudflare Pages, project `skillfarm` | `wrangler pages project list` |
| Edge logic | Cloudflare Pages Function `functions/_middleware.js` | file present, deployed ("Uploading Functions bundle") |
| App identity | `com.skillfarm.app`, scheme `skillfarm`, version 1.7.4 / build 12.14 | `app.json`, `lib/buildInfo.ts` |

**Screens/routes:** 33 screens. Public: `index` (landing), `login`,
`forgot-password`, `reset-password`, `role-select`, `course/[id]`, `org/[id]`,
`+html`. Signed-in learner: `(student)/{browse,courses,my-registrations,profile,notifications}`.
Provider: `(provider)/{home,courses,course-edit,students,profile,analytics,attendance-scan,course-materials}`.
Supporting: `ticket/[id]`, `downloads`, `certificate-wallet`, `payment/[id]`,
`attendance/[id]`, `ai-assistant`, `language-select`.

**Domain modules:** `api/` (courses, landing, profile, registrations, reviews,
trainers, batches), `lib/` (26 modules: supabase, session, deeplink, applinks,
offlineCache, i18n, haptics, notifications…), `components/` (26 files incl. a
real design system), `constants/theme.ts` (tokens).

---

## 2. Build & deployment pipeline (as it stands after this work)

```
npm run build:web
  ├─ rm -rf dist                              (prevents stale/mixed exports)
  ├─ expo export --platform web               → dist/
  ├─ scripts/post-export-fix.mjs              → vendor/ move + URL rewrite + font prune
  └─ scripts/gen-sitemap.mjs                  → dist/sitemap.xml (from public views)

npx wrangler pages deploy dist --project-name skillfarm --branch main
  → uploads dist/ + public/_headers + public/_redirects + functions/
```

---

## 3. Size breakdown (measured, not estimated)

| Artefact | Size | Notes |
|---|---|---|
| `dist/` (whole deploy) | **5.4 MB** | after pruning unused icon fonts |
| JS entry chunk | 2.06 MB raw | ~600 KB over the wire (Brotli) |
| Ionicons TTF (only font kept) | 390 KB | cached `immutable`, 1 year |
| `assets/` (app images) | ~1.9 MB | icons/splash shared with native builds |
| lazy chunks (jspdf / xlsx / html2canvas) | ~0.9 MB | fetched only when exporting |
| `icon.png` | 393,493 B @ 1024² | **over-weight for its role** (see W6) |
| `.git` | 1.0 MB | |
| `node_modules` | ~1.1 GB | build-time only, never shipped |

The "~250 MB" figure in the brief is the **APK/build workspace**, not the
website. Web payload is 5.4 MB.

---

## 4. Defects found (with evidence) — all fixed unless marked otherwise

### D1 — Icon fonts never reached the CDN (SEVERE, fixed)
*Symptom:* every icon invisible on the Cloudflare deploy while the same code
worked on Netlify.
*Evidence:* `curl https://skillfarm.pages.dev/assets/node_modules/.../Ionicons.<hash>.ttf`
returned `200` with **1215 bytes of `text/html`** (that is `index.html`), while
the file on disk is 389,724 bytes. First deploy log: `Uploaded 4 files`.
*Root cause:* `wrangler pages deploy` silently ignores any path containing
`node_modules`; Expo emits bundled fonts at `dist/assets/node_modules/…`.
*Fix:* `scripts/post-export-fix.mjs` moves that tree to `dist/vendor/` and
rewrites the 31 asset URLs inside the bundle. Verified: font now returns
`389724b` and `font/ttf`.

### D2 — The repository could not build (SEVERE, fixed)
*Evidence:* `Error: Unable to resolve module ../../lib/supabase from app/(provider)/analytics.tsx`.
`git ls-tree origin/main lib/` showed `lib/supabase.ts` **absent**; likewise
`lib/storage.ts`, `lib/ticket.ts`, `lib/typography.ts`, `lib/updatesSeen.ts`.
*Root cause:* the repo's history was built from "Add files via upload" commits
that omitted files.
*Fix:* recovered `supabase.ts`/`storage.ts`/`ticket.ts` from the local branch;
wrote `typography.ts` and `updatesSeen.ts` to the API the screens call. Build
now completes (`Exported: dist`).

### D3 — Share links pointed at the dead Netlify host (SEVERE, fixed)
*Evidence:* user-reported link `https://skillfarm.netlify.app/course/8b53a218…`;
compiled bundle showed `SITE_URL = process.env.EXPO_PUBLIC_SITE_URL` with no
fallback, and the web export does not read `eas.json`.
*Root cause:* env var baked as the Netlify domain in older builds; no
sanitisation, no inlined fallback.
*Fix:* `lib/deeplink.ts` rewritten — a `*.netlify.app` host is rejected
outright, resolution is sanitised env → `window.location.origin` (web) →
inlined `https://skillfarm.pages.dev`; `canonicalShareUrl()` rewrites legacy
URLs found in stored data. OTA updates published to `preview` and `production`
so installed APKs heal without a reinstall.

### D4 — App-link claim files missing from the deploy (HIGH, fixed)
*Evidence:* fresh `dist/` had no `.well-known/`; `assetlinks.json` 404'd.
*Fix:* restored `public/.well-known/{assetlinks.json,apple-app-site-association}`;
verified `200` with the right content types. Placeholders (`REPLACE_WITH_…`,
`TEAMID`) are still operator-supplied values.

### D5 — SPA fallback swallowed static assets in one configuration (HIGH, fixed)
*Evidence:* with `/*  /  200` in `_redirects`, `/og-image.png` and
`/.well-known/assetlinks.json` returned 1215 B of HTML instead of their bytes.
*Fix:* keep `/*  /index.html  200` (Cloudflare logs a cosmetic "infinite loop"
warning for it, but it is the form that lets real files win) and exclude
`/.well-known/*` from the HTML-rewriting middleware.

### D6 — Middleware injected HTML into a JSON claim file (MEDIUM, fixed)
*Evidence:* `/.well-known/apple-app-site-association` returned 2464 B of HTML.
*Root cause:* the file has no extension, so the "is this an HTML route?" test
misclassified it.
*Fix:* explicit `/.well-known/` pass-through. Now returns 411 B of raw JSON.

### D7 — `eas update` clobbered `dist/` with a 45 MB multi-platform export (MEDIUM, fixed)
*Evidence:* after running `eas update`, `dist/` was 45 MB with
`assetmap.json` and **no `index.html`**.
*Fix:* `build:web` deletes `dist/` before exporting.

### D8 — No social metadata anywhere (HIGH, fixed)
*Evidence:* `index.html` contained 3 `<meta>` tags and **zero** `og:`/`twitter:`
tags; pasted links produced no preview card.
*Fix:* `functions/_middleware.js` rewrites the shell per route from Supabase's
`public_courses` / `public_orgs` views. Verified:
`/course/8b53a218…` → `Mushroom cultivation — Coimbatore, Tamilnadu | SkillFarm`;
`/org/13c3650c…` → `Greenfields agro academy — The city | SkillFarm`.
Plus a 1200×630 `og-image.png`, `robots.txt`, generated `sitemap.xml`.

### D9 — 18 unused icon font families shipped (MEDIUM, fixed)
*Evidence:* 19 TTFs in the bundle, source references only `Ionicons`.
*Fix:* source-aware prune in the post-export step → −3.52 MB.

### D10 — 46 hardcoded colour literals outside the token file (LOW, partially addressed)
*Evidence:* `grep -rn "#[0-9A-Fa-f]{6}" app components lib | grep -v theme.ts | wc -l` → 46
*Status:* left in place deliberately. These sit inside one-off illustrations
(seat maps, ticket QR frames, gradient buttons) where a literal is clearer than
a token; migrating them would be churn without visual benefit. New work uses
tokens exclusively.

### D11 — No branded 404 (LOW, fixed in W5)
*Evidence:* no `app/+not-found.tsx`; unknown routes fell through to the shell
with no message.
*Fix:* branded `+not-found.tsx` added.

### D12 — GitHub push denied (BLOCKING, external)
*Evidence:* `remote: Permission to Consistencycentral/Skillfarm.git denied` →
`403` with the stored PAT.
*Cause:* the fine-grained token has no Contents: write on that repo.
*Action required:* operator issues a new PAT (see BLOCKED.md).

---

## 5. Prioritised fix plan

| Priority | Item | State |
|---|---|---|
| P0 | Icon fonts uploaded (D1) | done |
| P0 | Repo builds again (D2) | done |
| P0 | Share links use the live domain (D3) | done (web + OTA) |
| P1 | Claim files served raw (D4, D6) | done |
| P1 | Static assets not shadowed by SPA rule (D5) | done |
| P1 | Rich link previews (D8) | done |
| P2 | Deploy size −37% (D9) | done |
| P2 | Branded 404 + a11y pass (D11) | done (W5) |
| P2 | APK size work (ProGuard/shrink) | configured, needs an EAS build |
| P3 | Token migration of the 46 literals (D10) | deferred by design |
| — | GitHub push (D12) | **blocked on operator PAT** |

---

## 6. Regression checklist (run after every change)

1. `npm run build:web` exits 0 and prints `Exported: dist`, `fonts kept`,
   `SPA fallback + app-link files present ✔`, `[sitemap] …`.
2. `/`, `/login`, `/reset-password`, `/course/<id>`, `/org/<id>`, `/ticket/<id>`,
   `/auth/callback` all return 200 with 2–4 KB of HTML.
3. Ionicons TTF returns exactly 389,724 B with `content-type: font/ttf`.
4. `/og-image.png` = 46,702 B `image/png`; `/robots.txt`, `/sitemap.xml`,
   `/.well-known/assetlinks.json`, `/.well-known/apple-app-site-association`
   return their real bytes (411 B of JSON for AASA).
5. Course/org pages contain route-specific `og:title`/`og:description`.
6. No `skillfarm.netlify.app` string exists in the served JS bundle.
7. Google OAuth: Supabase `/auth/v1/authorize` accepts
   `redirect_to=https://skillfarm.pages.dev/auth/callback`.