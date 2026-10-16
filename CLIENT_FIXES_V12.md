# SkillFarm - v12: Image-led UI, course detail redesign, booking flow, typography

## 1. Image-led course cards (`components/CourseCard.tsx`)
* 16:9 photo on top, category chip (top-left) + bookmark (top-right, white circle) overlaid.
* Certificate badge sits on the photo (bottom-left).
* No photo / broken URL -> sector colour + sector icon (same fallback as Home tiles).
* Sector icons moved to `lib/sectorIcons.ts` and shared by CourseTile + CourseCard.

## 2. Course detail (`app/course/[id].tsx`)
* Full-width paging photo carousel with dots; transparent back / save / share over the photo
  (stack header is hidden for this route in `app/_layout.tsx`).
* Title block: title, partner + verified tick, rating, price (strike-through when discounted).
* Key facts row: date (+ duration), time, seats left (colour-coded).
* Sticky bottom bar: price + Book seat (all existing states kept: booked / pending / waitlist /
  closed / sign-in for shared-link visitors).
* Collapsible sections: About, What you'll learn, Location, Reviews.
* Batch selector + "Add to calendar" stay on the page. The inline seat map was removed from the
  page: seats are picked in the booking flow (step 2).

## 3. Booking flow (`components/BookingFlowModal.tsx`)
* Step indicator: Batch -> Seat -> Details -> Pay (label is "Confirm" for free / waitlist).
* One primary action per step. Details are validated when leaving step 3.
* Price summary card under the seat map; full summary + total on the last step.
* Success screen: animated check + confetti (core Animated, no new native module) and
  "Add to calendar".
* NOTE: the Pay step is review + total only. The existing flow does not take payment in the
  modal (seat request -> partner approves -> payment screen), and that was not changed.

## 4. Typography (`lib/typography.ts`, `app/_layout.tsx`)
* Inter (Latin) + Noto Sans Tamil + Noto Sans Devanagari, weights 400-800.
* Text / TextInput are wrapped once: weight -> font file, script auto-detected from the text,
  Tamil/Devanagari get line-height >= 1.55 x font size so vowel signs don't clip.
* Explicit `fontFamily` in a style is respected.

## Deploy
New packages: `expo-font`, `@expo-google-fonts/inter`, `.../noto-sans-tamil`, `.../noto-sans-devanagari`.
Run `npm install`, then make a new EAS build (fonts are bundled JS assets, but expo-font must be in
the native binary). No SQL changes.
