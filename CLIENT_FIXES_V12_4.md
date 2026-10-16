# v12.4 - sign in / sign up keyboard + focus fix (JS only)

Symptom (screen recording): on Sign up, focus hopped Name -> Phone -> Email -> Name by itself
(~every 100 ms, no touch) while the screen scrolled after it, and an Android autofill email-suggestion
popup kept appearing. Tapping the popup / elsewhere stopped it.

## Changes
* app/login.tsx
  - Autofill OFF on every input (Sign in + Sign up) via NO_AUTOFILL
    (autoComplete off, importantForAutofill noExcludeDescendants, textContentType none, no autocorrect/spellcheck).
  - Keyboard.dismiss() when switching the Sign in / Sign up tabs.
* components/KeyboardAwareScreen.tsx (v12.3b rewrite + v12.4)
  - Android: measured viewport inset, no JS scrolling (v12.3 / v12.3b).
  - keyboardDidHide is debounced 200 ms so text <-> number-pad switches don't reset the viewport (v12.4).

No new packages, no SQL, no new native build needed (OTA / Metro reload is enough).
Not device-tested - please retest Sign up: tap Name, Phone, Email, Password in turn.

## v12.5 - focus-hop fix (Android) + calendar date picker
Second recording showed the bug even without an autofill popup: right after ONE tap native focus moves to the
next input by itself (Name -> Phone -> Email ..., Sign in: Email -> Password). App code never calls .focus().
* components/ui.tsx: new <FocusGroup>. Inside it (Android only) only the input the user last TAPPED is editable;
  the others are disabled + covered by a tap-catcher, so Android's focus search has nowhere to jump.
  Field is unchanged outside a group, and on iOS / web.
* app/login.tsx: whole form wrapped in <FocusGroup>.
* components/DateField.tsx (new): tap-to-open calendar, value stays 'YYYY-MM-DD'. Pure JS, no new package.
  Used for: Start date + Registration deadline (course-edit), Batch start/end (BatchManageModal),
  Registration date range filter (students).
No new packages, no SQL, no native module.
