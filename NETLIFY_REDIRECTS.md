# Netlify → Cloudflare redirect map

Purpose: every URL that was ever shared from the old Netlify deployment must
land on the equivalent Cloudflare page instead of showing the stale copy.

The app is an SPA, so the mapping is **1:1 on the path** — nothing needs
rewriting except the host. Both rules below are therefore equivalent; per-path
rules are listed explicitly so the intent is auditable, with a wildcard as the
catch-all.

---

## 1. Paste-ready `_redirects` for the Netlify site root

Create a file named `_redirects` at the **root of the published folder** on
Netlify (next to `index.html`), containing:

```
# SkillFarm — old host redirects to Cloudflare Pages
# Per-path rules (explicit, auditable)
/                        https://skillfarm.pages.dev/                        301!
/login                   https://skillfarm.pages.dev/login                   301!
/forgot-password         https://skillfarm.pages.dev/forgot-password         301!
/reset-password          https://skillfarm.pages.dev/reset-password          301!
/role-select             https://skillfarm.pages.dev/role-select             301!
/language-select         https://skillfarm.pages.dev/language-select         301!
/downloads               https://skillfarm.pages.dev/downloads               301!
/downloads/*             https://skillfarm.pages.dev/downloads/:splat        301!
/auth/*                  https://skillfarm.pages.dev/auth/:splat             301!
/course/*                https://skillfarm.pages.dev/course/:splat           301!
/org/*                   https://skillfarm.pages.dev/org/:splat              301!
/ticket/*                https://skillfarm.pages.dev/ticket/:splat           301!
/attendance/*            https://skillfarm.pages.dev/attendance/:splat       301!
/payment/*               https://skillfarm.pages.dev/payment/:splat          301!
/materials/*             https://skillfarm.pages.dev/materials/:splat        301!
/certificate-wallet      https://skillfarm.pages.dev/certificate-wallet      301!

# Catch-all — anything not listed above (deep links already in the wild,
# app-link claim files, hashed bundles, unknown paths)
/*                       https://skillfarm.pages.dev/:splat                  301!
```

`301!` forces the redirect even if a file with that name exists on Netlify
(Netlify otherwise lets real files win, which is exactly how the stale site
keeps being served).

---

## 2. Verification

After deploying the file to Netlify:

```bash
# every one of these must answer 301 + location: https://skillfarm.pages.dev/...
curl -sI https://skillfarm.netlify.app/course/8b53a218-df76-4926-ace8-9ea78a1a6177 | grep -i "^HTTP/\|^location"
curl -sI https://skillfarm.netlify.app/org/13c3650c-7a40-49c8-82a6-271d96095726 | grep -i "^HTTP/\|^location"
curl -sI https://skillfarm.netlify.app/login | grep -i "^HTTP/\|^location"
curl -sI https://skillfarm.netlify.app/ | grep -i "^HTTP/\|^location"
```

Expected: `HTTP/2 301` and `location: https://skillfarm.pages.dev/<same path>`.

App-link files matter most — a universal link that points at Netlify will still
try to open the app from Netlify's copy of
`/.well-known/assetlinks.json`, which is why the catch-all is `301!` and not a
plain rewrite.

---

## 3. Why this cannot be done from Cloudflare

Cloudflare serves `skillfarm.pages.dev` only. It has no authority over
`skillfarm.netlify.app`, so a redirect must be published on the Netlify side
(or the Netlify site deleted). That is why this file exists as a deliverable
rather than as a deployed change — it needs one drag-and-drop onto Netlify.

---

## 4. If you delete Netlify instead

Old links then fail immediately (better than showing an outdated app). The
mapping above becomes moot; nothing in the current app references Netlify any
more (verified: 0 occurrences in shipped code).