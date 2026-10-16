// ===========================================================================
// BackHome — a reliable "leave this page" affordance for the public share
// screens (/course/[id], /org/[id]).
//
// Why not router.back(): those screens are usually the FIRST entry in history
// (someone opened a WhatsApp link cold, or the Android hardware-back already
// left the app once and the webview killed the session). In that state back()
// has nowhere to go — expo-router's browser back either closes the tab/app or
// does nothing, which read as "tapping back completely closes it".
//
// Behavior: if there IS in-app history, back() works as normal. Otherwise
// replace('/'), which swaps the current entry for the landing page — the app
// never exits, Escape/hardware-back always has a landing spot.
// ===========================================================================
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { theme } from '../constants/theme';

export function BackHome({ color = '#fff' }: { color?: string }) {
  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }
  return (
    <Pressable onPress={goBack} hitSlop={10} style={styles.hit} accessibilityLabel="Go back">
      <Ionicons name="arrow-back" size={22} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { padding: 6 },
});
