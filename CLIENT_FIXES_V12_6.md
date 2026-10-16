# v12.6 - focus-jump fix on ALL forms (JS only)

v12.5 put the Android focus-jump fix (<FocusGroup>) only on the Sign in / Sign up screen.
Other forms still used plain <TextInput>, so focus could still hop to another field after one tap.

* components/ui.tsx: new <FocusTextInput> - drop-in TextInput that follows <FocusGroup> (Android only).
  Outer layout styles (flex, width, margin...) move to a wrapper so rows / half-width inputs look the same.
* Wrapped in <FocusGroup> + TextInput swapped to FocusTextInput:
  - app/(provider)/course-edit.tsx   (learning partner course registration form)
  - components/BatchManageModal.tsx  (add / edit batch)
  - app/reset-password.tsx
  - components/CourseFilterSheet.tsx
  - app/(student)/profile.tsx
* Calendar pickers (DateField, from v12.5) are already used for: Start date, Registration deadline,
  Batch start/end, Registration date filter. No date is typed by hand any more.

No new packages, no SQL, no native build - Metro reload / OTA is enough. Please test on the real phone.
