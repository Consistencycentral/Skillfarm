# SkillFarm - v11: Product-design pass (visual only, no data / logic changes)

## Design system
* `constants/theme.ts` - added type scale (`theme.type.*`), semantic status colours + soft backgrounds
  (`theme.status.*`), `primaryTint`, `textSubtle`, `borderStrong`, extra spacing. All old keys kept.
* `constants/navStyle.ts` - headers are now light (white, dark title, green back arrow) instead of a heavy
  green bar. Tab bar gets a hairline + quieter shadow. Matches the dark status-bar icons.
* `components/ui.tsx` (new) - BrandMark, Card, StatusPill, Chip, SectionHeader, Field (focus ring, hint, error),
  Segmented, IconBadge, Divider. Build new screens from these.
* `components/Button.tsx` - variants primary / secondary / outline / ghost / danger, optional leading icon,
  accessibility state.

## Screens
* Login: brand mark + tagline, Sign up | Sign in segmented switch, icon fields with focus state,
  show/hide password, Google button with logo, shared Button.
* Role select: icons instead of emoji, tidy cards with check bullets.
* Language select: shared Button, check-mark selection, tinted selected row.
* Loading screens: branded (logo) instead of a bare spinner.
* Home (learner): cleaner hero, category chips use shared Chip (selected state).
* Course card: clearer hierarchy, one seat pill (green / amber when <=5 / teal waitlist), footer bar.
* Course tile: "seats available" is green (amber is reserved for Pending).
* My Seats: real status colours (confirmed green, pending amber, waitlist teal, rejected red),
  summary tiles, shared Card + Button.
* Partner dashboard: removed duplicate "Dashboard" title, action cards use IconBadge.
* Stray hard-coded greens/greys replaced by theme tokens.

## Deploy
JS only - no SQL, no new packages. EAS update is enough.
