# v12.8 - learner navigation cleanup (JS only)

Bottom tabs are now: Home, Saved, My Seats, Updates, Profile.

* Home + Courses merged. Home has search + a Filters button (city, fee, upcoming, seats available)
  + sector chips. Any of them switches Home to a result list with a "Clear" link.
  "See all" on a row still opens the full Courses list (hidden route, back arrow in header).
  The bell icon on Home is removed (Updates is a tab now).
* Updates is a real tab with an unread badge (lib/updatesSeen.ts). Seat approved / waitlist
  promoted / rejected show as a red count; opening Updates clears it.
* My Seats starts with a "Today's attendance" card: every confirmed seat whose batch runs today,
  with seat no., timing, Present / Absent / Not marked yet and a "Show QR" button.
  The old "Attendance & My Seats" card is removed from Profile.
* Empty-state "Browse courses" button on My Seats now goes to Home.

Files: app/(student)/_layout.tsx, browse.tsx, my-registrations.tsx, notifications.tsx, profile.tsx,
lib/updatesSeen.ts (new). No new packages, no SQL, no native build.
Run: npx.cmd expo start --clear

## Partner dashboard
* app/(provider)/home.tsx: big green "Create course" button right under the heading (opens the course form
  directly, 1 tap instead of Dashboard > Courses > + Add course). "Add or edit courses" card renamed "My courses".
