// Branded 404 — expo-router renders this for any path that matches no route.
// Without it, a mistyped or expired share link landed on a blank shell.
//
// Registered by convention: app/+not-found.tsx. Works on web (deep link that no
// longer exists) and in the native app (bad universal/app link target).

import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../constants/theme';
import { Button } from '../components/Button';
import { BrandMark } from '../components/ui';

export default function NotFoundScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.wrap}>
        <BrandMark size="md" />

        <View style={styles.iconTile} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Ionicons name="compass-outline" size={44} color={theme.colors.primary} />
        </View>

        <Text style={theme.type.h1 as any} accessibilityRole="header">Page not found</Text>
        <Text style={styles.body}>
          This link may have expired, or the course or training partner is no longer listed.
          Everything else is still where you left it.
        </Text>

        <View style={styles.actions}>
          <Button
            label="Browse courses"
            icon="search-outline"
            size="lg"
            fullWidth
            onPress={() => router.replace('/(student)/browse')}
          />
          <Button
            label="Back to home"
            icon="home-outline"
            variant="outline"
            size="lg"
            fullWidth
            onPress={() => router.replace('/')}
          />
        </View>

        <Text style={styles.hint}>SkillFarm · offline-first course registration</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  wrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.lg,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  iconTile: {
    width: 88,
    height: 88,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing.lg,
  },
  body: {
    ...(theme.type.body as any),
    color: theme.colors.textMuted,
    textAlign: 'center',
    maxWidth: 400,
  },
  actions: { alignSelf: 'stretch', gap: theme.spacing.md, marginTop: theme.spacing.lg },
  hint: {
    ...(theme.type.caption as any),
    color: theme.colors.textSubtle,
    marginTop: theme.spacing.xl,
  },
});