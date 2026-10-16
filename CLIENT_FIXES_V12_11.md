# v12.11 - review of screen recording (Oct 16)

The recording was made on an OLD APK (it still showed "Excel is a CSV file", "{t.activeSub}", "Each batch has 40 seats").
Those items are already fixed in this code. New in v12.11:

* Learners screen > Export data: PDF / Excel / Attendance buttons are disabled while there are 0 learners,
  with a hint, instead of opening and then showing "Nothing to export".
* Sign in / Sign up keyboard: v12.9 already removed the editable toggle that blocked the keyboard
  (inputs are always editable; FocusGroup only pulls focus back if it hops). Not changed here.
* app.json version 1.7.4.

Not changed on purpose: open reviews (any signed-in learner can rate) is a deliberate rule in the code and
in supabase migrations (review_access, review_owner_guard). Tell us if reviews should need an approved seat.
