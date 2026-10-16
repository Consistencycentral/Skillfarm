# SkillFarm - v10 (2026-10-19): Learning Partner sets the seat count

## What changed
| Item | Change |
|---|---|
| Seat count | The Learning Partner now chooses the number of seats per event (1-200, default 40). No longer fixed at 40. |
| Course form | "Number of seats" is an editable field (single-event courses). With 2+ batches it says "Set per batch". |
| Manage batches | Each batch has its own "Number of seats" field. |
| Seat map | Learners see a map with exactly that many seats (A1, A2 ...). Small events (<=12) use 4 per row, <=36 use 6, <=64 use 8, else 10. The last row is just shorter. |
| Safety | Seats cannot be reduced below the seats already booked, or below the highest booked seat number. |
| Booking / approve / waitlist | Use the batch's own seat count instead of the hard-coded 40. |

## Deploy
1. Supabase -> SQL Editor -> run `supabase/migrations/20261019_partner_seat_capacity.sql` once (safe to re-run). Run it AFTER v6, v8 and 20261018.
2. Ship a new app build (JS only change, so an EAS update is enough).

## Test
* Partner: create/edit a course, set seats to 25 -> learner opens the course -> map shows 25 seats (A1..D1).
* Partner: set 10 -> 3 rows of 4/4/2. Set 200 -> 20 rows of 10.
* Book 5 seats, then try to set seats to 3 -> refused ("already booked").
* Existing events keep 40 seats.

## Seat map redesign (visual only)
`components/BatchSeatMap.tsx` restyled: chair-shaped seats, stat tiles (Available / Booked / Total), fill progress bar with "Filling fast" / "Fully booked" badges, glowing stage arc, row badges, legend with mini seats, and a "N seats selected" bar with seat chips. Props, seat numbering and booking logic are unchanged.

## App-wide design refresh (visual only, no data changes)
* `constants/theme.ts`: refined palette, softer borders, bigger radii, shadow tokens. Status colours are now distinct: pending = amber, cancel/delete/rejected = red, links/completed = blue, waitlist = teal (before, several were shades of green).
* `constants/navStyle.ts` (new): one header + bottom tab bar style used by the root stack, learner tabs and partner tabs.
* Button, EmptyState, CourseCard, CourseTile, CourseRow, Browse, My Seats, Partner Dashboard restyled; every card-style box app-wide gets a soft shadow; headings are bolder.

## Motion + interaction polish (visual only)
* `components/motion.tsx` (new): PressableScale (springy press + light haptic), FadeInView (fade + rise), Pulse (skeleton breathing), Pop (save-bookmark boing), TabIcon (tab icon pops and fills when selected).
* Applied to: all Buttons, course cards/tiles, bookmark button, loading skeletons, empty states, dashboard stat tiles, bottom-tab icons + soft tab cross-fade, seat-map seats (boing + haptic on tap).
* Bottom tab bar: removed the fixed height/padding that clipped the labels; React Navigation now sizes it itself.
