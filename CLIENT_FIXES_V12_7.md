# v12.7 - taller bottom navigation bar (JS only)
* constants/navStyle.ts: new useTabOptions() - bar height 64dp + safe-area bottom, 8dp top padding,
  min 10dp bottom clearance, 12sp labels. No longer glued to the screen edge.
* app/(student)/_layout.tsx and app/(provider)/_layout.tsx use useTabOptions().
No new packages, no SQL, no native build. Run: npx.cmd expo start --clear
