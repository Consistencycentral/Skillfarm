# ASSUMPTIONS.md — decisions made without asking

Every entry: the fact I could not verify, the professional default I chose, and
why. Anything that would change behaviour in a way the operator must confirm is
listed at the bottom as a **question**, not silently assumed.

---

## A1. `origin/main` (v1.7.4 · build 12.14) is the source of truth
**Assumption:** the GitHub `main` branch is what produced the live Netlify site,
and the Desktop "Copy" folder (19 commits behind) was stale.
**Evidence:** live Netlify login screen renders `SkillFarm · v1.7.4 · build 12.14`,
which matches `lib/buildInfo.ts` + `app.json` on `origin/main`.
**Consequence:** the local folder was re-pointed at `origin/main` and missing
modules were restored, rather than deploying the older code.

## A2. The "~250 MB" figure is the APK, not the website
**Assumption:** the target `≤100 MB` refers to the app download, while the web
deployment is measured separately (5.4 MB).
**Why:** the static export physically cannot reach 250 MB; an Expo APK with all
ABIs and dev assets can.
**Consequence:** web and APK are reported separately in `SIZE_REPORT.md`.

## A3. Cloudflare Pages project name and hostname
**Assumption:** project slug `skillfarm`, production URL
`https://skillfarm.pages.dev`, branch `main`.
**Why:** operator asked for the name in chat; Pages derives the hostname from
the project name.
**Consequence:** every canonical URL, OG tag, sitemap and app-link host uses it.

## A4. Keep `app.json` / `eas.json` site URL as `pages.dev` (no custom domain)
**Assumption:** no custom domain is being attached yet.
**Consequence:** `EXPO_PUBLIC_SITE_URL=https://skillfarm.pages.dev` in both EAS
profiles, and an inlined fallback in code so a build that misses env injection
still produces correct links.

## A5. The anon Supabase key may live in the repo and the edge function
**Assumption:** `EXPO_PUBLIC_SUPABASE_ANON_KEY` is public by design (it already
ships in the APK and the JS bundle) and RLS protects data.
**Evidence:** `lib/supabase.ts` documents this; `public_courses` / `public_orgs`
views expose no PII (verified by reading their columns).
**Consequence:** the key is inlined in `functions/_middleware.js` and
`scripts/gen-sitemap.mjs` as a fallback, with env override supported. The
service_role key is nowhere in the repo.

## A6. Preview cards read from the `public_*` views only
**Assumption:** social metadata may come from public catalogue data, never from
`profiles` or `courses` directly.
**Why:** `courses` returned `[]` under RLS for anon; the views are the intended
public surface.

## A7. `/course/<id>` and `/org/<id>` are the only deep-link shapes worth
meta-tagging per route. `/ticket/<id>` is private — the middleware injects the
site-wide card there on purpose (a ticket title in a chat preview would leak
course/seat info).

## A8. Ionicons is the only icon family in use
**Assumption:** pruning the other 18 TTFs is safe.
**Evidence:** `grep` over `app/ components/ lib/ constants/` finds no other
family import; the prune is source-aware, so adding a family later re-enables
its font automatically.

## A9. Google OAuth on the web is configured in Supabase, not in this repo
**Assumption:** Google provider is enabled and the Cloudflare callback is
allow-listed (operator confirmed "done").
**Verification done here:** `/auth/v1/settings` reports `google: true`; the
authorize endpoint accepts `redirect_to=https://skillfarm.pages.dev/auth/callback`;
Google's own `redirect_uri` is Supabase's callback (unchanged, already
registered). No repo change can alter these.

## A10. OTA updates are the right delivery mechanism for the share-link fix
**Assumption:** installed APKs run runtime version `1.7.4` and listen on
channels `preview` / `production`.
**Why:** `eas.json` defines those channels; the OTA publish targeted that
runtime version.
**Consequence:** users get the fix on next cold start; a fresh install of the
*old* APK file only heals after its first update check.

## A11. Keep the `/*  /index.html 200` SPA rule despite the wrangler warning
**Assumption:** the warning is a false positive.
**Evidence:** with `/*  /  200` every static asset returned the HTML shell
(og-image 1215 B, fonts 1215 B); with `/index.html` they return real bytes. The
rule is therefore the correct one.
**Consequence:** local `wrangler pages dev` prints a cosmetic warning; documented
in `public/_redirects` so nobody "fixes" it again.

## A12. `app/+html.tsx` is committed but inert
**Assumption:** the SPA export does not consume it (it applies to static
rendering), and the edge function is the working mechanism.
**Consequence:** file kept because it becomes active if the app ever switches to
`web.output: "static"`; it does not affect today's output.

## A13. Web-only design tokens, no dark mode switch
**Assumption:** shipping a dark palette now would change every screen's
appearance for existing users mid-pilot, which the operator's brief ("don't
disturb what works") argues against.
**Consequence:** `theme.colors.dark*` tokens and `theme.motion` were added
**additively**; `userInterfaceStyle` stays `light`. Flipping it on later is a
one-line change plus a `useColorScheme` hook — documented in `FIGMA_SPEC.md`.

## A14. Accessibility scope
**Assumption:** WCAG 2.1 AA for the shipped screens, verified for contrast
numerically (see `FIGMA_SPEC.md` §Contrast) and structurally (labels on
icon-only controls, 48 px minimum touch targets in `Button`/`PressableScale`).
A formal audit with a screen reader is out of scope for this pass.

## A15. Documentation language and location
All docs live at the repo root (`AUDIT.md`, `ASSUMPTIONS.md`, `CHANGELOG.md`,
`SIZE_REPORT.md`, `DELIVERY_REPORT.md`, `FIGMA_SPEC.md`, `BLOCKED.md`) so they
travel with the code and are visible to anyone opening the repo.

---

## Open questions (operator input would change the outcome)

1. **Patched PAT** — without Contents: write on `Consistencycentral/Skillfarm`
   nothing can be pushed. Current state: local commits only.
2. **Netlify teardown** — should `skillfarm.netlify.app` stay alive as a 301 to
   `pages.dev` (best for old shared links) or be deleted? Both need a Netlify
   login to apply.
3. **APK rebuild** — ProGuard + resource shrinking only take effect after a new
   EAS build; that consumes build minutes. Confirm before burning one.