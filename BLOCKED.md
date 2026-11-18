# BLOCKED.md — what is blocked, and the two ways out

Rule applied: an item is only listed here after two real attempts failed.

---

## B1. GitHub push to `Consistencycentral/Skillfarm` — BLOCKED

**Attempts made**
1. `git push origin main` → `remote: Permission to Consistencycentral/Skillfarm.git denied` / `HTTP 403`.
2. Re-pushed with the credential-manager token injected explicitly
   (`https://Consistencycentral:<token>@github.com/...`) → same `403`.

**Diagnosis:** the stored fine-grained PAT is scoped to other repositories. It
authenticates (Who am I: `Consistencycentral`) but has no *Contents: write* on
this repo.

**Impact:** none on the live site — Cloudflare deploys from the local `dist/`,
not from GitHub. Only the source backup/history is affected. All work is
committed locally (`git log` shows the migration commits on `main`).

**Option A — new fine-grained PAT (recommended)**
1. github.com → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token.
2. Repository access: *Only select repositories* → `Consistencycentral/Skillfarm`.
3. Permissions → Repository permissions → **Contents: Read and write**.
4. Send the token; push becomes `git push origin main` (one command, no other change).

**Option B — GitHub Desktop / browser upload**
1. Open the repo folder in GitHub Desktop, sign in with the account that owns it.
2. Commit is already made — press **Push origin**.
   (Or: repo → Add file → Upload files, drag the changed files.)

---

## B2. Netlify → Cloudflare 301 redirect map — BLOCKED (needs Netlify login)

Old links live at `https://skillfarm.netlify.app/**`. The domain still resolves
and serves the *old* build, which is why a link shared before the migration
still opens Netlify.

**Attempts made**
1. Cannot deploy to Netlify from here — no Netlify CLI session, no token, and
   `netlify.toml` was removed from this repo during the migration.
2. A Cloudflare-side 301 is impossible: Cloudflare cannot control a hostname it
   does not serve.

**Impact:** old shared links keep working but point at a stale copy of the app.

**Option A — redirect on Netlify (keeps every old link alive)**
1. Add a file named `_redirects` at the **site root** of the Netlify deploy with:
   ```
   /*  https://skillfarm.pages.dev/:splat  301!
   ```
2. Redeploy the Netlify site (drag-and-drop the folder containing that file).
3. Verify: `curl -I https://skillfarm.netlify.app/course/8b53a218-df76-4926-ace8-9ea78a1a6177`
   → `301` with `location: https://skillfarm.pages.dev/course/8b53a218-...`.

**Option B — retire Netlify instead**
1. Netlify → Site settings → Delete site.
2. Old links then fail fast instead of showing an out-of-date app; new links
   (everything shared from today) already use `pages.dev`.

---

## B3. OG/Twitter validator runs — BLOCKED (manual step)

**Attempts made**
1. The tags are verified present over HTTP (course, org and landing pages all
   return route-specific `og:title`/`og:description`/`og:image`).
2. Automated submission to Facebook's Sharing Debugger and the Twitter Card
   Validator is not possible — both require an interactive session and block
   scripted clients.

**Impact:** none on function; this is confirmation only.

**Option A — paste the URL once per surface**
- Facebook/WhatsApp: https://developers.facebook.com/tools/debug/ → paste a
  course URL → "Scrape Again".
- Twitter/X: https://cards-dev.twitter.com/validator → paste → Preview card.
- LinkedIn: https://www.linkedin.com/post-inspector/ → paste.

**Option B — trust the markup**
Both crawlers read the same `og:*` and `twitter:*` tags that are already
confirmed in the response body; if the card does not render, the usual cause is
crawler caching, and "Scrape Again" clears it.

---

## B4. APK rebuild — NOT BLOCKED, awaiting a decision

ProGuard/resource-shrinking config is committed but only takes effect in a new
native build. An EAS build consumes build minutes; it also produces the only
honest measurement of the new APK size.

**Option A — build the preview APK now**
```
npx eas-cli build -p android --profile preview
```
**Option B — defer to the next release**
Config stays in place and applies automatically to whatever build you run next.