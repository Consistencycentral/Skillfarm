// ===========================================================================
// EmptyState — friendly placeholder when a list has nothing to show.
// ===========================================================================
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../constants/theme';
import { FadeInView } from './motion';

interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
}

export function EmptyState({ icon = 'folder-open', title, subtitle }: EmptyStateProps) {
  return (
    <FadeInView style={styles.container}>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={34} color={theme.colors.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </FadeInView>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  iconCircle: { width: 84, height: 84, borderRadius: 42, backgroundColor: theme.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.primaryLight },
  title: { fontSize: theme.font.title, fontWeight: '800', color: theme.colors.text, marginTop: 18, textAlign: 'center' },
  subtitle: { fontSize: 14, color: theme.colors.textMuted, marginTop: 6, textAlign: 'center', lineHeight: 20 },
});
