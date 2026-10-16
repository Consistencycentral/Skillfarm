// ===========================================================================
// Button — the single button used everywhere in the app.
// Variants: primary, secondary (tinted), outline, ghost, danger.
// Sizes: md, lg. Optional leading icon. Springy press + haptic via PressableScale.
// ===========================================================================
import { Text, StyleSheet, ActivityIndicator, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../constants/theme';
import { PressableScale } from './motion';

type Variant = 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost';
type Size = 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
}

const FG: Record<Variant, string> = {
  primary: '#FFFFFF',
  danger: '#FFFFFF',
  secondary: theme.colors.primary,
  outline: theme.colors.primary,
  ghost: theme.colors.primary,
};

export function Button({
  label, onPress, variant = 'primary', size = 'md', icon,
  disabled = false, loading = false, fullWidth = false,
}: ButtonProps) {
  const fg = FG[variant];
  return (
    <PressableScale
      haptic
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={[
        styles.base,
        size === 'lg' && styles.lg,
        fullWidth && styles.fullWidth,
        stylesVariant[variant],
        (disabled || loading) && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.content}>
          {icon ? <Ionicons name={icon} size={size === 'lg' ? 20 : 18} color={fg} /> : null}
          <Text style={[theme.type.button as any, { color: fg }, size === 'lg' && { fontSize: 16 }]}>{label}</Text>
        </View>
      )}
    </PressableScale>
  );
}

const stylesVariant = StyleSheet.create({
  primary: { backgroundColor: theme.colors.primary, shadowColor: theme.colors.primary, shadowOpacity: 0.24, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  secondary: { backgroundColor: theme.colors.primaryTint },
  danger: { backgroundColor: theme.colors.danger },
  outline: { backgroundColor: theme.colors.surface, borderWidth: 1.5, borderColor: theme.colors.borderStrong },
  ghost: { backgroundColor: 'transparent' },
});

const styles = StyleSheet.create({
  base: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 20, borderRadius: theme.radius.md + 2, alignItems: 'center', justifyContent: 'center' },
  lg: { minHeight: 56, paddingVertical: 16, paddingHorizontal: 24, borderRadius: theme.radius.lg },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  fullWidth: { alignSelf: 'stretch' },
  disabled: { opacity: 0.5 },
});
