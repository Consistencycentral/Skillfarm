# SIZE_REPORT.md — SkillFarm web payload

Measured on the real `dist/` that is deployed to Cloudflare Pages, not estimates.

## The "250 MB" figure

The website was **never** 250 MB. The ~250 MB the operator saw is the
**Android APK / build artifacts** (native toolchain, EAS build output, plus
`node_modules` during build). The web app is a static export and is measured
below. The ≤100 MB target is met with >90% headroom by the web app; the APK is
a separate EAS build and is not part of this migration.

## Before → after (this migration)

| Step | Technique | dist size | Δ |
|---|---|---|---|
| Baseline (first Cloudflare deploy) | — | 6.0 MB | — |
| Icon fonts in `node_modules` path | moved to `vendor/` so wrangler uploads them | 6.0 MB | 0 (fixes icons, no size change) |
| Unused icon families | `@expo/vector-icons` ships 19 TTFs; app uses only Ionicons → pruned 18 in `scripts/post-export-fix.mjs` | **5.4 MB** | **−3.52 MB (−37%)** |
| Dead deploy output | `build:web` now wipes `dist/` first (an `eas update` had left a 45 MB mixed-platform export) | 5.4 MB | prevented a 45 MB deploy |

## Current payload breakdown (5.4 MB total)

| Asset group | Size | Notes |
|---|---|---|
| JS runtime + app bundle | ~2.1 MB | single entry chunk; ~600 KB over the wire with Brotli |
| Ionicons TTF (only font) | 380 KB | loaded once, cached `immutable` for 1 year |
| App images / icons | ~1.9 MB | `icon.png`, adaptive icons, splash |
| lazy chunks (pdf/xlsx/html2canvas) | ~0.9 MB | only fetched when exporting |
| HTML shell, `_headers`, `_redirects`, robots, sitemap, og-image | ~0.1 MB | |

## Caching (buying real-world speed)

`public/_headers` sets `Cache-Control: public, max-age=31536000, immutable`
for `/_expo/*`, `/assets/*` and `/vendor/*` — all content-hashed names, so a
returning user re-downloads only `index.html` (~2 KB). The shell is
`must-revalidate`, so a deploy is visible immediately.

## Not done (deliberately)

- Image → WebP/AVIF conversion: the images are app icons/splash consumed by
  native builds too; converting them would desync the APK assets for ~1 MB.
- Route-level code splitting: expo-router already emits lazy chunks for the
  heavy exporters; splitting further risks breaking deep links.
- APK slimming (`enableProguardInReleaseBuilds`, ABI splits, asset stripping):
  requires an EAS native build, not a web deploy — outside this migration.