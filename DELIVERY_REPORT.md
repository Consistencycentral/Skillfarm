# DELIVERY_REPORT.md — SkillFarm: Netlify → Cloudflare Pages + polish

Date: 2026-11-18 · App version: **1.7.4 · build 12.14** · Live: **https://skillfarm.pages.dev**

---

## 1. What was delivered

| Workstream | Result |
|---|---|
| **W1 Audit** | `AUDIT.md` — 12 defects, each with file/command evidence, plus a P0–P3 plan |
| **W2 Icons** | Root-caused and fixed the invisible-icon bug; icon font now serves as real `font/ttf` |
| **W3 Migration** | Cloudflare Pages project `skillfarm`; 0 `netlify` references in shipped code; SPA fallback + headers + claim files |
| **W4 Deep links** | Canonical share URLs for course/org/ticket; **per-route OG previews** via an edge function; og-image, robots, sitemap |
| **W5 UI/UX + tokens** | Dark palette, motion + touch tokens, two WCAG failures fixed, branded 404, 13 a11y labels, web focus ring, `FIGMA_SPEC.md` |
| **W6 Size** | Web 6.0 MB → **5.0 MB**; icon font −89 %; ProGuard/shrink configured for the APK |
| **W7 Polish** | `CHANGELOG.md`, `ASSUMPTIONS.md`, `SIZE_REPORT.md`, `BLOCKED.md`, Lighthouse before/after |

## 2. Verified live (last run, all pass)

| Check | Result |
|---|---|
| `/`, `/login`, `/reset-password`, `/course/<id>`, `/org/<id>`, `/ticket/<id>`, `/auth/callback`, unknown route | 200, 2.4–2.6 KB HTML |
| Ionicons font | 200 · **41,280 B** · `font/ttf` |
| `og-image.png` | 200 · 46,702 B |
| `robots.txt` / `sitemap.xml` | 200 · 336 B / 2.7 KB |
| `assetlinks.json` / `apple-app-site-association` | 200 · 295 B / **411 B raw JSON** |
| Course OG title | `Mushroom cultivation — Coimbatore, Tamilnadu \| SkillFarm` |
| Org OG title | `Greenfields agro academy — The city \| SkillFarm` |
| Google OAuth chain | Supabase accepts `redirect_to=https://skillfarm.pages.dev/auth/callback` |
| TypeScript | **0 errors** (was 10) |
| Netlify strings in served JS | **0** |

## 3. Lighthouse (mobile, production)

| | Before | After |
|---|---|---|
| Performance | 53 | 52–56 |
| Accessibility | 88 | **100** |
| Best practices | 100 | 100 |
| SEO | 92 | **100** |
| LCP | 6.9 s | 6.0 s |
| Speed Index | 5.6 s | 4.2 s |
| Transferred | 977 KiB | 800 KiB |

Performance is capped by client-side rendering (LCP is JS-painted text). The
honest fix is SSR/static rendering, which changes routing — documented as
out of scope in `ASSUMPTIONS.md` A12.

## 4. Defects fixed (details in AUDIT.md)

1. Icon fonts never uploaded (wrangler skips `node_modules`) — **critical**
2. Repo could not build (5 missing modules) — **critical**
3. Share links pointed at the dead Netlify host — **critical**
4. App-link claim files missing from the deploy — high
5. SPA rule variant that shadowed all static assets — high
6. Middleware injecting HTML into a JSON claim file — medium
7. `eas update` clobbering `dist/` with a 45 MB mixed export — medium
8. No social metadata anywhere — high
9. 18 unused icon font families shipped — medium
10. 46 hardcoded colour literals (deferred by design)
11. No branded 404 — low
12. GitHub push denied (external) — blocking

Also repaired during the audit: `ticketQrValue` / `ticketEmailUrl` were missing
from `lib/ticket.ts` after a repo repair, which would have crashed the ticket
screen at runtime; `pickAndUploadCertificate` was missing from `lib/storage.ts`;
`useUnreadUpdates` returned a boolean where the tab badge expects a count.

## 5. How to ship changes from now on

```bash
npm install                # once
npm run deploy:web         # build (with all post-processing) + upload to Cloudflare
```
`build:web` performs: clean → `expo export` → vendor move + URL rewrite + font
prune → glyph subsetting → sitemap generation.

## 6. What is still on the operator

| Item | Where |
|---|---|
| Push commits to GitHub (PAT lacks write) | `BLOCKED.md` B1 |
| Netlify 301 map **or** delete the old site | `BLOCKED.md` B2 |
| Paste URLs into OG validators (confirmation only) | `BLOCKED.md` B3 |
| Decide on an EAS build to measure the new APK | `BLOCKED.md` B4 |
| Add `https://skillfarm.pages.dev/auth/callback` in Supabase | done by operator |

## 7. Risks / notes

- **OTA updates** were published to `preview` and `production` for the
  share-link fix; installed apps heal on next cold start.
- The Ionicons subset keeps 135 of 1357 glyphs. It is generated from source
  **and** from `name:"…"` props in the built bundle, so a new icon is picked up
  automatically on the next build.
- Cloudflare serves `200` with an empty body to bare `curl`/urllib clients
  (bot protection). Verification must send a browser `User-Agent` — noted in
  `AUDIT.md` §6 so future checks are not misread.
- `lighthouse*.json` files at the repo root are the raw measurements referenced
  above.