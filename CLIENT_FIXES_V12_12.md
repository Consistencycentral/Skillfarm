# v12.12 / v12.13 / v12.14 - Sign in / Sign up keyboard, and why fixes kept "coming back"

## v12.14 - page jumping while typing (components/FormScreen.tsx)
* The recording shows the page scrolling back and forth AND focus hopping. Cause: the ScrollView was resized
  when the keyboard opened/closed, the native auto-scroll and our own scroll fought each other.
* New Android form screen: nothing resizes. A fixed blank spacer under the form gives scroll room; when a field
  gets focus it scrolls ONCE (smooth) to sit near the top. Used by Sign in / Sign up, Forgot and Reset password.
* Build label: "build 12.14".


## v12.13 - the real focus-jump cause
* On Android a keyboard action (Done/Next) or Keyboard.dismiss() BLURS the input, and the OS then gives focus
  to the FIRST input on screen ("Full name") and closes the keyboard. That is the Name highlight in the recording.
  Fix: submitBehavior="submit" on every login input (and by default on every Field on Android);
  removed Keyboard.dismiss() from the Sign in/Sign up tab switch.
* Race: "has signed in before" was read async and flipped Sign up -> Sign in after the user had tapped a field,
  unmounting the focused input. The form now draws only once the mode is known.
* Build label is now "build 12.13".


## What the Oct 16 recording really shows
* It was recorded on an OLD APK: there is no build label under "By continuing you agree..." (the code
  always draws one) and the email-autofill card is on screen (autofill is OFF in the current code).
* On that build, focus hops Name -> Phone -> Email by itself and the keyboard opens then closes.
* The Booking popup on the same phone types fine (plain TextInput, no focus tricks). So the problem is
  the Sign in / Sign up screen's extra focus machinery, not the phone.

## Sign in / Sign up (app/login.tsx, components/ui.tsx)
* Removed <FocusGroup> from the login screen. It force-called focus() on other inputs ("revert"); a
  programmatic focus() racing native focus is itself what leaves a field half-focused with no keyboard.
* Field now has autofill OFF by default (autoComplete off, importantForAutofill noExcludeDescendants,
  textContentType none) - so EVERY form is protected, not only login.
* Keyboard "Next" key: Name -> Phone -> Email -> Password -> Confirm. "Done" submits.
* The form card is a plain View (no native-driver translateY animation around the inputs).
* Build label is bigger and fully visible so a recording proves which APK it is.

## Why fixes never reached the phone
* app.json had no runtimeVersion and no updates.url, and eas.json had no channels, so "JS only" fixes
  could never be delivered over the air. Added runtimeVersion (appVersion policy), updates.url, and
  channels development / preview / production.
* Versions disagreed (package.json 1.7.2, label 1.7.3, app.json 1.7.4). All 1.7.4, label "build 12.12".

## Small
* Booking popup: removed the extra "selected batch" card under the list (it looked like a duplicate batch
  with a second tick).
* Header title for language-select has a fallback so the raw route name can never show.

## You must do once
1. Uninstall the old SkillFarm APK, then `eas build -p android --profile preview` and install the NEW apk.
2. Open Sign in: the last line must read "SkillFarm · v1.7.4 · build 12.12 · built-in".
   If it does not, the phone is still on the old APK - nothing else matters until it does.
3. From now on JS-only fixes: `eas update --channel preview --message "..."` (needs the new build once).

## App icon (v12.14)
* The phone launcher icon / splash / favicon were still the default Expo template (blue chevron with guide lines).
  Replaced with the SkillFarm leaf logo (white leaf on brand green #1F6B45), same as the in-app logo.
  assets/icon.png, android-icon-foreground/background/monochrome.png, splash-icon.png, favicon.png;
  app.json adaptiveIcon.backgroundColor -> #1F6B45. Needs a NEW APK build to show on the phone.
