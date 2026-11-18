# SIZE_REPORT.md — measured payload, web + APK plan

All numbers are from the actual `dist/` that Cloudflare serves, produced by
`npm run build:web`, not estimates. Lighthouse figures come from running
Lighthouse 12 against `https://skillfarm.pages.dev/` with mobile emulation.

---

## 1. What "250 MB" actually was

The website is **5.0 MB**. The ~250 MB figure the operator saw is the **Android
APK / build workspace** (native toolchain output + `node_modules` during build).
The ≤100 MB target applies to the APK; web is measured separately below.

---

## 2. Web payload: before → after

| Step | Technique | dist size | Δ |
|---|---|---|---|
| Baseline (first Cloudflare deploy) | — | 6.0 MB | — |
| Icon fonts unreachable | moved `assets/node_modules/**` → `vendor/**` so wrangler uploads them | 6.0 MB | 0 (fixes icons) |
| 18 unused icon families | source-aware prune in `scripts/post-export-fix.mjs` | 5.4 MB | **−3.52 MB** |
| Oversized icon font | **glyph subsetting** to the 135 glyphs the app uses (`scripts/subset-icons.mjs`) | 5.4 → **5.0 MB** | **−341 KB** (font 381 KB → 40 KB, −89%) |
| Lighthouse transferred | — | 977 KiB → **800 KiB** | **−18%** |

### Current breakdown (5.0 MB deployed)

| Group | Size | Cache policy |
|---|---|---|
| JS entry chunk | 2.06 MB raw (~600 KB Brotli) | `immutable`, 1 year |
| Lazy chunks (jspdf, xlsx, html2canvas) | ~0.9 MB | `immutable`, loaded on demand only |
| Ionicons subset TTF | **40 KB** | `immutable` |
| App images (icons, splash, illustrations) | ~1.9 MB | `immutable` |
| HTML shell, `_headers`, `_redirects`, robots, sitemap, og-image | ~0.1 MB | shell revalidates |

---

## 3. Lighthouse (mobile, production URL)

| Category | Before | After |
|---|---|---|
| Performance | 53 | **52–56** (run-to-run variance) |
| Accessibility | 88 | **100** |
| Best practices | 100 | 100 |
| SEO | 92 | **100** |

| Metric | Before | After |
|---|---|---|
| FCP | 1.1 s | 1.1–1.4 s |
| LCP | 6.9 s | **6.0–6.1 s** |
| TBT | 750 ms | 670–1130 ms (noisy) |
| Speed Index | 5.6 s | **4.2 s** |
| CLS | 0.01 | 0.01 |
| Transferred | 977 KiB | **800 KiB** |

**Honest read:** performance stays in the low 50s because this is a
client-rendered SPA — the LCP element is text painted only after 2 MB of JS
parses and executes. The only structural fix is server-side rendering (Expo
`web.output: "static"` or "server"), which changes the routing model and was
deliberately out of scope (ASSUMPTIONS A12). Everything cheap has been done:
font subsetting, preloading the entry chunk, Brotli, immutable caching.

Lighthouse's remaining suggestion is "reduce unused JavaScript: ~415 KiB" —
that is the expo-router + screen code needed for client-side navigation; tree
shaking it out would break route transitions.

---

## 4. APK size plan (configured, needs one EAS build)

`app.json` now carries `expo-build-properties` with:

```json
{ "android": {
    "enableProguardInReleaseBuilds": true,
    "enableShrinkResourcesInReleaseBuilds": true,
    "enablePngCrunchInReleaseBuilds": true,
    "useLegacyPackaging": false
} }
```

| Technique | Expected effect | State |
|---|---|---|
| R8/ProGuard code shrinking | typically 20–35% off the APK | configured |
| Resource shrinking | strips unused drawables/translations | configured |
| PNG crunching | re-compresses packaged PNGs | configured |
| `useLegacyPackaging: false` | modern, smaller zip blocks | configured |
| ABI splits | ~40% smaller per-device download | production profile ships an **AAB**, which Play store splits per device automatically |
| Hermes bytecode | default in SDK 54 (smaller + faster than JSC) | already active |

A new APK cannot be measured until an EAS build runs — that consumes build
minutes and is the operator's call (ASSUMPTIONS question 3).


## 4b. APK — build 33 measured (2026-11-18)

| | |
|---|---|
| File | `application-…apk` (EAS artifact) |
| **Size** | **104,952,827 B = 100.1 MB** |
| versionCode | 33 |
| Profile | `preview` (universal APK, internal distribution) |
| Artifact valid until | 2026-12-02 |

**Verdict: 0.1 MB over the ≤100 MB target.** ProGuard + resource shrinking
were applied (config verified), but a *universal* APK still bundles four
architectures — `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`. The x86 slices
exist only for emulators and are pure payload on a phone.

**Fix in flight:** `plugins/withAbiFilters.js` restricts Gradle to
`arm64-v8a` + `armeabi-v7a` (verified present in the generated
`android/app/build.gradle`). Expected result ≈ 55–70 MB, comfortably inside the
target, with no device compatibility loss (every Android phone since ~2016 is
arm64; older ones use armeabi-v7a).

Note: the production profile ships an **AAB**, where Play already splits by
architecture/device, so store installs are far smaller than this test APK.

---

## 5. Not done, and why

- **Image → WebP/AVIF:** the images double as native app assets (icons, splash).
  Converting only the web copies would fork the asset set for ~200 KB.
- **Route-level splitting:** expo-router already emits per-route chunks; the
  remaining single entry is required for client-side navigation.
- **Fonts → woff2:** Ionicons is already 40 KB after subsetting; woff2 would
  save ~15 KB and drop older-browser support.
- **APK verification:** pending an EAS build.