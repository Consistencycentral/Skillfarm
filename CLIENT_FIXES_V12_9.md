# v12.9 - keyboard not opening on Sign in / Sign up (JS only)

Cause: the v12.5-12.8 FocusGroup toggled each input editable=false/true and called focus() from JS.
focus() on a just-enabled Android input is unreliable -> field focused but soft keyboard never opened.

Fix (components/ui.tsx only): inputs are always editable again, so a normal tap opens the keyboard.
FocusGroup now only remembers the last touched input and, if native focus hops to a different
input within 800 ms of that touch, pulls focus back. No other file changes, no new packages.
