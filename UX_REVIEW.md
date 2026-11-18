# UX_REVIEW.md — screen-by-screen review, SkillFarm v1.7.4

Method: static analysis of every route in `app/` (29 screens) plus the shared
components, measuring four things that predict real UX quality — token
discipline, state coverage, touch/a11y coverage, and screen weight. Numbers come
from `ux-metrics.json` (generated, reproducible).

---

## 1. What the numbers say

| Signal | Finding | Why it matters |
|---|---|---|
| Type scale | **22 distinct font sizes** in use; **13 are off-scale** (10, 14, 17, 18, 20, 21, 22, 23, 25, 27, 28, 32, 38) | The token scale defines 10 sizes (12→30). Screens invent 13 more, so headlines of visually equal importance differ by 1–3 px. That reads as "unfinished", not "designed". |
| Spacing | **29 distinct padding values**; **16 off the 4/8 grid** (2,3,5,6,7,9,10,11,13,14,15,17,18,22,30,45) | Same problem vertically: rows drift instead of aligning to a rhythm. |
| Colour | **15 hardcoded hex literals** across screens (down from 46 across the whole app) | Most remnants sit in one-off illustrations (seat map, ticket frame). Low impact, but they bypass theming. |
| Empty states | **17 of 29 screens have no empty state** — 11 of those are forms where it is N/A, leaving **6 list/detail screens** that can render a blank area | Blank screen = user thinks the app is broken. |
| Loading | 1 screen has no loading affordance (`downloads/index.tsx`) | Local-only screen, lower risk, but it renders nothing while the file list resolves. |
| a11y labels | **8 screens have buttons but zero `accessibilityLabel`** | Screen-reader users hear "button" repeatedly. |
| Screen weight | `course/[id].tsx` is **868 lines / 50 KB**; `course-edit.tsx` 609 lines | Hard to change safely, and its render cost lands on the most-shared page in the product. |

---

## 2. Per-screen review

Legend: **L** loading · **E** empty · **X** error handling present.

| Screen | LOC | States | Findings |
|---|---|---|---|
| `course/[id].tsx` | 868 | L E X | Strongest screen functionally; 3 hex literals; 16 icons and 4 labelled controls. **Risk:** 868 lines mixing data fetch, seat logic, share, and layout. Hero CTA competes with the share/save icons in the same row. |
| `(provider)/course-edit.tsx` | 609 | L – X | No empty state (form — acceptable). 10 buttons, only 2 labelled. Long form with no section anchors; the save action sits at the bottom with no sticky bar. |
| `(provider)/profile.tsx` | 529 | L – X | 9 buttons, 4 labelled. Org profile/logo/trainers in one scroll; trainer rows have no per-row affordance hint. |
| `(provider)/students.tsx` | 430 | L E X | Good state coverage. Filters and export actions compete for the same bar. |
| `login.tsx` | 411 | L – X | Google + email sign-in in one column; the segmented Sign-in/Sign-up switch is the only mode indicator. Error text is inline (good). |
| `(student)/profile.tsx` | 397 | L – X | 5 buttons, 5 labelled — best a11y coverage in the app. |
| `materials/[courseId].tsx` | 352 | L E X | Download states are per-row; no global "downloading all" indicator. |
| `org/[id].tsx` | 261 | L E X | **5 buttons, 0 labels** — icon-only share/back controls are unlabelled. Also 1 of the 6 screens with no empty state for the course list. |
| `(student)/browse.tsx` | 258 | L E X | Filter chips + list; filter sheet discovered only via an icon. No result count shown after filtering. |
| `(student)/my-registrations.tsx` | 236 | L E X | Status pills carry the meaning well (icon + word + colour). |
| `(provider)/attendance-scan.tsx` | 231 | L – X | Camera-first; permission-denied path exists but is a generic alert, not an inline state with a retry. |
| `payment/[id].tsx` | 227 | L – X | **6 buttons, 0 labels.** Money screen with no empty/error illustration — failures surface as alerts. |
| `(provider)/courses.tsx` | 219 | L E X | 3 hex literals; delete/share icons labelled (fixed in this pass). |
| `(student)/courses.tsx` | 179 | L E X | Category grid; no count per category. |
| `(provider)/home.tsx` | 177 | L E X | Dashboard cards; numbers not differentiated (no trend/context). |
| `reset-password.tsx` / `forgot-password.tsx` | 142 / 128 | L – X | Clean, single-purpose. Token-expired case is a generic alert. |
| `ticket/[id].tsx` | 117 | L – X | **3 buttons, 0 labels**; 3 hex literals in the ticket frame. QR is the hero (correct). |
| `(provider)/course-materials/[courseId].tsx` | 113 | L E X | 11 buttons, 3 labelled — many icon actions per row. |
| `language-select.tsx` | 91 | L – X | Single icon button, unlabelled; selection state relies on tick icon only. |
| `(student)/saved.tsx` | 89 | L E X | Simple list, good states. |
| `role-select.tsx` | 84 | L – X | Two large cards; clear. |
| `index.tsx` (landing) | 74 | L – X | Composes `LandingContent`; landing is the SEO/LCP surface, so its weight is dominated by the JS bundle, not this file. |
| `ai-assistant.tsx` | 71 | L – X | 2 hex literals; chat scroll has no "thinking" indicator beyond a spinner. |
| `downloads/index.tsx` | 69 | **–** E X | Only screen with **no loading state**. |
| `(provider)/analytics.tsx` | 64 | L – X | Charts summarised as numbers only — no empty state when there is no data. |
| `attendance/[id].tsx` | 63 | L – X | Partner-side; 2 buttons, 0 labels. |
| `(student)/notifications.tsx` | 55 | L E – | **No error path**; a failed fetch renders an empty list, which reads as "no updates". |
| `auth/callback.tsx` | 37 | L – X | Redirect shim; fine as-is. |

---

## 3. The six real UX problems (ranked)

1. **Type and spacing drift.** 13 off-scale font sizes and 16 off-grid paddings
   mean two "equally important" headings can differ by 2 px, and list rows don't
   align down the page. Fix: migrate screens to `theme.type.*` and
   `theme.spacing.*` — the tokens already exist.
2. **Unlabelled icon actions on 8 screens** (`org/[id]`, `payment/[id]`,
   `ticket/[id]`, `attendance/[id]`, `language-select`, `notifications`,
   `reset-password`, `forgot-password`). Fix: `accessibilityLabel` on each
   icon-only control (this pass added 13 across 7 other files).
3. **Blank states on list/detail screens** — `org/[id]` (no courses),
   `analytics.tsx` (no data), `notifications.tsx` (fetch failure looks empty).
   Fix: reuse the existing `EmptyState` component with a cause-specific line.
4. **Money and ticket screens have no inline error UI** (`payment/[id]`,
   `ticket/[id]`) — everything is an `Alert`, which disappears on navigation.
5. **Discoverability of filters** — `browse.tsx` hides filtering behind an icon
   and never shows "N results".
6. **Screen weight** — `course/[id].tsx` at 868 lines is the highest-risk file
   and the most-shared page; splitting data/seat logic into hooks would make
   future changes safe.

---

## 4. Before/after notes (what this pass changed)

| Area | Before | After |
|---|---|---|
| Status pill contrast | success 3.84:1, warning 3.30:1 (fails AA) | **5.17:1 / 4.70:1** (passes) |
| Accent on surface-alt | 4.32:1 (fails) | **5.11:1** (passes) |
| Icon-only buttons | 13 across 7 files had no label | now labelled; a further 8 screens still listed above |
| 404 / dead link | blank shell | branded screen: icon, headline, two actions |
| Keyboard focus (web) | invisible | 2 px brand ring on `:focus-visible` |
| Dark mode | none | full dark palette + motion/touch tokens available (not enabled — see ASSUMPTIONS A13) |
| Screens visually redesigned | — | **none**; this pass fixed tokens, contrast, states and a11y, and did not restructure layouts |

**Honest statement:** the layouts shipped in v12.14 are unchanged. What changed
is the system underneath them plus the accessibility and state gaps. A visual
redesign of all 29 screens is a separate, riskier body of work (it touches the
live app's navigation and forms) and is not represented as done here.

---

## 5. Recommended next pass (in order)

1. Migrate `fontSize`/`padding` literals to tokens, screen by screen, starting
   with the 6 most-used: `course/[id]`, `browse`, `login`, `my-registrations`,
   `(provider)/courses`, `(student)/profile`. Verifiable with the same script.
2. Add `EmptyState` to `org/[id]`, `analytics`, `notifications`, `browse`.
3. Add `accessibilityLabel` to the 8 screens listed in §3.2.
4. Give `payment/[id]` and `ticket/[id]` inline error blocks with a retry.
5. Break `course/[id].tsx` into `useCourseDetail()` + presentational parts.
6. Only then consider visual redesign (colour/mood refresh), using
   `FIGMA_SPEC.md` as the source of truth.

Reproduce the measurements anytime:
`python scripts/ux_metrics.py` → `ux-metrics.json`.