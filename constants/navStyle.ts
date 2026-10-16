// Shared navigation look (headers + bottom tab bar) so every screen matches.
//
// Light, quiet headers: white surface, dark title, brand-green back arrow and
// a hairline underneath. Content is the hero, not the chrome. (This also makes
// the dark status-bar icons set in the root layout legible on every screen.)
//
// v12.7: the tab bar now has a Google/Material-style height (64dp + the phone's
// bottom safe area) with breathing room above and below, so it no longer looks
// glued to the bottom edge. Use useTabOptions() in the tab layouts.
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from './theme';

export const headerOptions = {
  headerStyle: { backgroundColor: theme.colors.surface },
  headerTintColor: theme.colors.primary,
  headerTitleStyle: { fontWeight: '700' as const, fontSize: 17, color: theme.colors.text },
  headerTitleAlign: 'center' as const,
  headerShadowVisible: false,
  headerBackTitleVisible: false,
};

export const tabOptions = {
  ...headerOptions,
  animation: 'fade' as const, // soft cross-fade when switching tabs
  tabBarActiveTintColor: theme.colors.primary,
  tabBarInactiveTintColor: theme.colors.textSubtle,
  tabBarHideOnKeyboard: true,
  tabBarLabelStyle: { fontSize: 11, fontWeight: '600' as const },
  tabBarStyle: {
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    shadowColor: '#0F2A1B',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -3 },
    elevation: 8,
  },
};

export const TAB_BAR_HEIGHT = 64; // dp, content area (Material nav bar is 64-80dp)

/** Tab options with a taller bar that always clears the system gesture / nav area. */
export function useTabOptions() {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 10); // never flush with the screen edge
  return {
    ...tabOptions,
    tabBarLabelStyle: { fontSize: 12, fontWeight: '600' as const, marginTop: 2 },
    tabBarItemStyle: { paddingVertical: 2 },
    tabBarStyle: {
      ...tabOptions.tabBarStyle,
      height: TAB_BAR_HEIGHT + bottom,
      paddingTop: 8,
      paddingBottom: bottom,
    },
  };
}
