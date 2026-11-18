# FIGMA_SPEC.md — SkillFarm design system, ready to rebuild in Figma

This file mirrors `constants/theme.ts` and the primitives in `components/ui.tsx`
+ `components/Button.tsx`. Everything here exists in code; nothing is aspirational.
Build it in Figma in the order: **tokens → components → screens**.

---

## 1. Frames (page structure)

| Frame | Width | Min height | Used by |
|---|---|---|---|
| `Mobile / 375` | 375 | 812 | primary design frame (iPhone 13 mini) |
| `Mobile / 390` | 390 | 844 | modern iPhone |
| `Mobile / 412` | 412 | 915 | Android (Pixel) reference |
| `Tablet / 768` | 768 | 1024 | iPad portrait |
| `Desktop / 1280` | 1280 | 800 | web export (expo-router renders same tree) |

Content max-width on tablet/desktop: **520** for forms, **1080** for the landing
and catalogue grids. Horizontal page padding: `16` mobile, `24` tablet+.

---

## 2. Colour styles (Figma › Local styles › Colour)

**Brand**

| Name | Hex | Use |
|---|---|---|
| `Brand/Primary` | `#1F6B45` | primary buttons, active tab, links |
| `Brand/Primary Dark` | `#134A2F` | pressed state, headings on tint |
| `Brand/Primary Light` | `#CFE6D6` | disabled primary fill, chart bands |
| `Brand/Primary Tint` | `#EAF3ED` | selected rows, chip background |
| `Brand/On Primary` | `#FFFFFF` | text on primary |
| `Brand/Accent` | `#2B7A9B` | secondary data, "info" affordances |

**Neutrals**

| Name | Hex | Use |
|---|---|---|
| `Neutral/Background` | `#F6F8F6` | app background |
| `Neutral/Surface` | `#FFFFFF` | cards, sheets, inputs |
| `Neutral/Surface Alt` | `#EEF4F0` | inset sections, skeletons |
| `Neutral/Border` | `#E3E9E5` | hairlines |
| `Neutral/Border Strong` | `#CBD5CE` | outline buttons, dividers |
| `Neutral/Text` | `#13201A` | primary text |
| `Neutral/Text Muted` | `#5B6A61` | secondary text |
| `Neutral/Text Subtle` | `#8B988F` | placeholders, meta |
| `Neutral/Overlay` | `#0B1A12` @ 45% | modal scrim |

**Status (fg / bg pairs — all AA on their own background)**

| Name | fg | bg |
|---|---|---|
| `Status/Success` | `#177347` | `#E6F4EC` |
| `Status/Warning` | `#96620F` | `#FDF3DC` |
| `Status/Danger` | `#C0392B` | `#FCEAE8` |
| `Status/Info` | `#2563A8` | `#E6EEF9` |
| `Status/Teal (waitlist)` | `#0F766E` | `#DFF3F1` |
| `Status/Neutral (cancelled)` | `#5B6A61` | `#EEF1EF` |

**Dark mode collection** (exists in code, not shipped — see ASSUMPTIONS A13):
`#0E1512` bg, `#151F1A` surface, `#1C2822` surface-alt, `#2A382F` border,
`#E8F2EC` text, `#A9BDB2` muted, `#6FBF92` primary, `#0B1A12` on-primary.

---

## 3. Contrast verification (WCAG 2.1 AA)

Measured with the standard relative-luminance formula. AA needs **4.5:1** for
body text, **3:1** for large text and UI boundaries.

| Pair | Ratio | Verdict |
|---|---|---|
| Text on Background | 15.75 | AAA |
| Text on Surface | 16.81 | AAA |
| Text Muted on Background | 5.35 | AA |
| Text Muted on Surface | 5.71 | AA |
| Text Subtle on Surface | 3.01 | AA (large/decorative only) |
| On Primary on Primary | 6.47 | AA |
| Primary on Surface | 6.47 | AA |
| Danger on Surface | 5.44 | AA |
| Warning fg on Warning bg | 4.70 | AA ✅ (was 3.30 — fixed) |
| Success fg on Success bg | 5.17 | AA ✅ (was 3.84 — fixed) |
| Teal fg on Teal bg | 4.75 | AA |
| Info fg on Info bg | 5.24 | AA |
| Accent on Surface | 4.82 | AA |
| Dark: Text on Dark Background | 16.17 | AAA |
| Dark: Muted on Dark Background | 9.35 | AAA |
| Dark: Primary on Dark Background | 8.41 | AAA |

The two ✅ rows are the fix shipped in this pass: `success` moved
`#1F8A55 → #177347`, `warning` `#B7791F → #96620F`, with hues preserved.

---

## 4. Type styles

Font: **system stack** (`SF Pro` / `Roboto` / `Segoe UI`) — no webfont
download, which matters on rural data. In Figma, use *Inter* as the closest
substitute and mark it "approximate".

| Style | Size / line-height | Weight | Tracking |
|---|---|---|---|
| `Type/Display` | 30 / 36 | 800 | −0.6 |
| `Type/H1` | 24 / 30 | 800 | −0.4 |
| `Type/H2` | 19 / 25 | 700 | −0.2 |
| `Type/H3` | 16 / 22 | 700 | −0.1 |
| `Type/Body` | 15 / 22 | 400 | 0 |
| `Type/Body Strong` | 15 / 22 | 600 | 0 |
| `Type/Small` | 13 / 18 | 400 | 0 |
| `Type/Caption` | 12 / 16 | 500 | 0 |
| `Type/Overline` | 11 / 14 | 700 | +1.1 (uppercase) |
| `Type/Button` | 15 / 20 | 700 | +0.1 |

---

## 5. Spacing, radius, elevation

**Spacing scale (8-pt based):** `4 · 8 · 12 · 16 · 24 · 32 · 48`
Card padding **16**, screen padding **16/24**, section gap **24**, list row gap **12**.

**Radii:** `sm 8` (chips, inputs dense) · `md 12` (inputs, small cards) ·
`lg 16` (cards) · `xl 22` (hero cards, sheets) · `pill 999` (pills, avatars).

**Elevation**

| Style | Shadow |
|---|---|
| `Elevation/Card` | `0 5 14 rgba(15,42,27,0.06)` + Android elevation 2 |
| `Elevation/Raised` | `0 10 20 rgba(15,42,27,0.12)` + elevation 6 |
| `Elevation/None` | none (flat lists) |

---

## 6. Components (variants to build)

### 6.1 Button — `components/Button.tsx`
Grid of **5 variants × 2 sizes = 10 components**, plus `Disabled` and `Loading` booleans.

| Property | Values |
|---|---|
| Variant | Primary · Secondary · Outline · Ghost · Danger |
| Size | Md (min-height 48) · Lg (min-height 56) |
| Icon | None · Leading icon (Ionicons 18/20) |
| State | Default · Pressed · Disabled (50% opacity) · Loading (spinner replaces label) |

Auto-layout: horizontal, gap 8, padding `12/20` (Md) or `16/24` (Lg),
corner radius 14 (Md) / 16 (Lg), height hug → min 48/56.
Primary carries the coloured shadow; others do not.

### 6.2 Card — `components/ui.tsx`
Variants: `Padded` (16) / `Flush` (list) / `Pressable` (adds spring scale 0.985).
Radius 16, border 1 `Neutral/Border`, `Elevation/Card`.

### 6.3 StatusPill
States: Registered · Pending · Waitlist · Completed · Cancelled · Rejected.
Auto-layout horizontal gap 6, padding `4/10`, radius pill, icon 12 + `Type/Caption`.
Colours from the Status table above.

### 6.4 Chip / FilterChip
Unselected: surface + `Border`; Selected: `Primary Tint` bg + `Primary` text +
`Primary Light` border. Radius pill, padding `8/12`, min height 36 (tap target
extended to 44 via hitSlop).

### 6.5 Field (input)
Anatomy: `Label` (`Type/Small`, 600) → input box (min height 48, radius 12,
surface, border `Border`) → `Hint` (`Type/Caption`, subtle) → `Error`
(`Status/Danger`, `Type/Caption`). Focus ring: 2 px `Primary` + 2 px
`Primary Tint` halo.

### 6.6 Segmented (Sign in | Sign up)
Track: `Surface Alt`, radius pill, inner active segment `Surface` + `Elevation/Card`.

### 6.7 SectionHeader
Title (`Type/H2`) + optional action ("See all", `Type/Small` 600, `Primary`),
baseline-aligned, 24 top / 8 bottom.

### 6.8 IconBadge
Rounded square 44/56, radius 14, tinted background, centred Ionicons 20/24.
Must be wrapped by a labelled control if pressable.

### 6.9 Navigation
- Mobile: 5 tabs, height 56 + safe area, icon 24 + label `Type/Caption`,
  active = `Primary`, inactive = `Text Muted`, optional badge (`Danger`, 16 px).
- Tablet/desktop: same tree, centered content column max 520/1080.
- Web: visible focus ring on every focusable element (2 px `Primary`, 2 px offset).

### 6.10 Empty / Loading / Error states
- **Empty:** icon 44 in `Primary Tint` tile + `Type/H3` + one line `Type/Small` muted + optional primary action.
- **Loading:** skeletons only — `Surface Alt` blocks, radius 12, `Pulse` animation 1.2 s. No spinners for lists.
- **Error:** `Status/Danger` icon + one-sentence cause + "Try again" secondary button.

### 6.11 Not found (404)
`app/+not-found.tsx`: BrandMark → 88 px icon tile → `Type/H1` "Page not found" →
`Type/Body` muted explanation → two full-width buttons (primary "Browse
courses", outline "Back to home").

---

## 7. Motion tokens (`theme.motion`)

| Token | Value | Where |
|---|---|---|
| `instant` | 90 ms | ripple / pressed tint |
| `fast` | 140 ms | chip select, toggle |
| `normal` | 220 ms | sheet open, tab switch |
| `slow` | 320 ms | page enter, list stagger |
| `press` | scale 0.97, spring speed 50, bounciness 7 | every pressable |
| `enter` | translateY 8 → 0, opacity 0 → 1, 240 ms | `FadeInView` |

Never animate `transform` with `useNativeDriver: false` on native, and respect
`prefers-reduced-motion` on web (the existing helpers already use native driver).

---

## 8. Accessibility contract (implemented)

- Every **icon-only** control has `accessibilityRole="button"` +
  `accessibilityLabel` (13 labels added across 7 files in this pass; the audit
  found 28 candidates, the remaining ones carry visible text).
- Minimum touch target **44 px**, buttons 48 px (`theme.touch`).
- Status is never colour-only: pills pair colour with an icon and a word.
- Headings use `accessibilityRole="header"`.
- Web focus ring: 2 px `Primary` with 2 px offset on `:focus-visible`.
- Screen-reader-only text used for the seat-map grid cells.

---

## 9. Handoff notes

1. Import the palette above as a Figma *variable collection* named `SkillFarm`,
   with a second mode `Dark` holding the dark values — that mirrors `theme.ts`
   and lets you flip modes per frame.
2. Publish components as a library so screens stay in sync with code.
3. The app has **no custom webfont**; do not add one in Figma that the code
   cannot ship.
4. Card grids: 1-col ≤ 480, 2-col 481–900, 3-col ≥ 900, gutter 16.
5. Anything that shows money/seat counts uses tabular numerals
   (`font-variant-numeric: tabular-nums`, already applied globally by
   `lib/typography.ts`).