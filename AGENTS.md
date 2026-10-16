# Expo — version pinned to SDK 54

This project is deliberately on **Expo SDK 54** (`expo@~54.0.36`, `react-native@0.81.5`, `expo-router@~6`), pinned because the Play Store Expo Go app maxes at SDK 54 (see `~/.claude/.../memory/coursearc-project.md`). Do NOT upgrade to 55/56/57 without an explicit decision.

Read the exact **v54** docs before writing any code: https://docs.expo.dev/versions/v54.0.0/

SDK-54 specifics that bite:
- Use `expo-file-system` root API, NOT `expo-file-system/legacy` (the legacy path is an SDK 55+ artifact — though it still resolves on 54, prefer the root import).
- `expo-image-picker` is installed at `17.0.11` (resolved as compatible by `expo install`); its API (`launchImageLibraryAsync`, `requestMediaLibraryPermissionsAsync`, `MediaTypeOptions`) is stable across the SDK.

## Modal scroll convention (cross-platform, version-independent)

When content inside a `Modal` (or a `KeyboardAvoidingView`) may exceed the viewport — iOS vs Android safaris differ — wrap the inner content in a `ScrollView`, not a plain `View`, so scrolling works on both platforms:

- A plain `View` inside a small modal will NOT scroll on iOS.
- Use `ScrollView` with `contentContainerStyle={{ flexGrow: 1 }}` and `keyboardShouldPersistTaps="handled"`. Hide the scrollbar with `showsVerticalScrollIndicator={false}` for a cleaner look.

Pattern (used by the trick-list modal in `app/_layout.tsx`):
```tsx
<Modal visible={open} animationType="fade" transparent onRequestClose={close}>
  <KeyboardAvoidingView>
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
      keyboardShouldPersistTaps="handled"
    >
      {card}
      {tricksList}
    </ScrollView>
  </KeyboardAvoidingView>
</Modal>
```
Always prefer `ScrollView` for modal interiors that hold lists or forms; it avoids the "content cut off at the bottom on Android" / "can't scroll on iOS" regression.

