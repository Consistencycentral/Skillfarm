// ===========================================================================
// ShareButton — opens the native OS share sheet (WhatsApp, email, SMS, copy,
// etc.) with a text payload. Uses React Native's built-in Share API, so it
// needs no extra dependency and works on both iOS and Android in Expo Go.
//
// Pass a `message` (the share text). On iOS, `Share.share` splits the payload
// into `message` (the body) + `url` is not separately forwarded by all apps, so
// we keep everything inside `message` for cross-app reliability. A tap shows
// the system share sheet; if sharing is somehow unavailable (very rare), we
// fall back to a no-op instead of crashing.
// ===========================================================================
import { Pressable, StyleSheet, Share, Platform, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../constants/theme';
import { Alert } from '../lib/alert';

interface Props {
  message: string;
  // Optional canonical link to share (e.g. a course deep link from
  // lib/deeplink.ts). It is BOTH passed as the share sheet's `url` (so chat
  // apps that support a URL attachment get a real, tappable link) AND appended
  // to the message text, because several Android targets ignore the separate
  // `url` field and only send `message`.
  url?: string;
  // Size of the circular icon button (px). Defaults to 36.
  size?: number;
  // Tint of the icon. Defaults to the brand primary green.
  color?: string;
  // Optional accessibility label override.
  label?: string;
  // Visual style: 'solid' sits on a surface chip; 'ghost' is just the icon.
  variant?: 'solid' | 'ghost';
}

export function ShareButton({ message, url, size = 36, color, label = 'Share', variant = 'solid' }: Props) {
  const iconColor = color ?? theme.colors.primary;
  const dim = { width: size, height: size, borderRadius: size / 2 };

  // Long-press = open the link yourself right now (handy for testing a
  // shared link without leaving the app, and it exercises exactly the URL a
  // recipient will receive).
  async function handleOpenUrl() {
    if (!url) return;
    try { await Linking.openURL(url); } catch { /* no handler for scheme */ }
  }

  async function handleShare() {
    if (!message && !url) return;
    // Keep the link inside the text too — see the `url` prop doc above.
    const text = url && !message.includes(url) ? `${message}\n\n${url}` : message;
    try {
      // `dialogTitle` is an *option*, not part of the share content — passing it
      // inside the first argument is a type error (ShareContent has no such key).
      // It labels the Android chooser; iOS ignores it.
      await Share.share(url ? { message: text, url } : { message: text }, { dialogTitle: 'Share via' });
    } catch (e: any) {
      // Some Android devices/ROMs reject an empty result; never crash the app.
      if (Platform.OS === 'ios') {
        // On iOS a user-cancelled share throws — treat it as a no-op, not an error.
        return;
      }
      Alert.alert('Sharing failed', e?.message ?? 'Could not open the share sheet.');
    }
  }

  if (variant === 'ghost') {
    return (
      <Pressable
        onPress={handleShare}
        onLongPress={handleOpenUrl}
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={8}
        style={[styles.ghost, { width: size, height: size }]}
      >
        <Ionicons name="share-social" size={size * 0.62} color={iconColor} />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={handleShare}
      onLongPress={handleOpenUrl}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={[styles.solid, dim]}
    >
      <Ionicons name="share-social" size={size * 0.5} color={iconColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  solid: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  ghost: { alignItems: 'center', justifyContent: 'center' },
});
