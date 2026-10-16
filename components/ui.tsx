// ===========================================================================
// Design-system primitives. Screens compose these instead of hand-rolling
// styles, so spacing, radii, type and colour stay identical everywhere.
//   BrandMark      - logo tile + wordmark
//   Card           - surface with border + soft shadow (optionally pressable)
//   StatusPill     - registration status, semantic colours + icon
//   Chip           - selectable / informational pill
//   SectionHeader  - title + optional action link
//   Field          - labelled text input with focus ring, hint and error
//   Segmented      - two/three way switch (e.g. Sign in | Sign up)
//   IconBadge      - rounded-square icon tile
//   Divider
// ===========================================================================
import { createContext, useContext, useId, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Platform,
  type StyleProp, type ViewStyle, type TextInputProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, type StatusKey } from '../constants/theme';
import { PressableScale } from './motion';
import { createFocusGuard, type FocusGuard } from '../lib/focusGuard';
import { FormScrollContext } from './FormScreen';

type IconName = keyof typeof Ionicons.glyphMap;

// ---------------------------------------------------------------- BrandMark
export function BrandMark({ size = 'md', stacked = false }: { size?: 'sm' | 'md' | 'lg'; stacked?: boolean }) {
  const box = size === 'lg' ? 64 : size === 'sm' ? 32 : 44;
  const icon = size === 'lg' ? 34 : size === 'sm' ? 18 : 24;
  const word = size === 'lg' ? 28 : size === 'sm' ? 17 : 22;
  return (
    <View style={{ flexDirection: stacked ? 'column' : 'row', alignItems: 'center', gap: stacked ? 12 : 10 }}>
      <View style={{
        width: box, height: box, borderRadius: box * 0.3, backgroundColor: theme.colors.primary,
        alignItems: 'center', justifyContent: 'center',
        shadowColor: theme.colors.primary, shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 5,
      }}>
        <Ionicons name="leaf" size={icon} color="#fff" />
      </View>
      <Text style={{ fontSize: word, fontWeight: '800', letterSpacing: -0.5, color: theme.colors.text }}>
        Skill<Text style={{ color: theme.colors.primary }}>Farm</Text>
      </Text>
    </View>
  );
}

// --------------------------------------------------------------------- Card
export function Card({
  children, style, onPress, padded = true, accessibilityLabel,
}: {
  children?: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; padded?: boolean; accessibilityLabel?: string;
}) {
  const base = [styles.card, padded && { padding: theme.spacing.lg }, style];
  if (onPress) {
    return (
      <PressableScale scaleTo={0.985} onPress={onPress} style={base} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
        {children}
      </PressableScale>
    );
  }
  return <View style={base}>{children}</View>;
}

// --------------------------------------------------------------- StatusPill
export function StatusPill({ status, label, size = 'md' }: { status: StatusKey | string; label: string; size?: 'sm' | 'md' }) {
  const s = (theme.status as Record<string, { fg: string; bg: string; icon: string }>)[status]
    ?? { fg: theme.colors.textMuted, bg: theme.colors.neutralBg, icon: 'help-circle' };
  const sm = size === 'sm';
  return (
    <View style={[styles.pill, { backgroundColor: s.bg, paddingHorizontal: sm ? 8 : 10, paddingVertical: sm ? 3 : 5 }]}>
      <Ionicons name={s.icon as IconName} size={sm ? 12 : 14} color={s.fg} />
      <Text style={{ color: s.fg, fontSize: sm ? 11 : 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

// --------------------------------------------------------------------- Chip
export function Chip({
  label, icon, selected = false, tone = 'neutral', onPress,
}: {
  label: string; icon?: IconName; selected?: boolean; tone?: 'neutral' | 'success' | 'info' | 'warning'; onPress?: () => void;
}) {
  const tones = {
    neutral: { fg: theme.colors.textMuted, bg: theme.colors.neutralBg },
    success: { fg: theme.colors.success, bg: theme.colors.successBg },
    info: { fg: theme.colors.info, bg: theme.colors.infoBg },
    warning: { fg: theme.colors.warning, bg: theme.colors.warningBg },
  }[tone];
  const fg = selected ? theme.colors.onPrimary : onPress ? theme.colors.text : tones.fg;
  const bg = selected ? theme.colors.primary : onPress ? theme.colors.surface : tones.bg;
  const content = (
    <>
      {icon ? <Ionicons name={icon} size={13} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 12.5, fontWeight: '600' }}>{label}</Text>
    </>
  );
  const style = [styles.chip, { backgroundColor: bg, borderColor: selected ? theme.colors.primary : onPress ? theme.colors.border : 'transparent' }];
  if (!onPress) return <View style={style}>{content}</View>;
  return (
    <PressableScale scaleTo={0.95} onPress={onPress} style={style} accessibilityRole="button" accessibilityState={{ selected }}>
      {content}
    </PressableScale>
  );
}

// ------------------------------------------------------------ SectionHeader
export function SectionHeader({ title, subtitle, actionLabel, onAction }: { title: string; subtitle?: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={{ flex: 1 }}>
        <Text style={theme.type.h2 as any}>{title}</Text>
        {subtitle ? <Text style={[theme.type.small as any, { color: theme.colors.textMuted, marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Text style={{ color: theme.colors.primary, fontSize: 13.5, fontWeight: '700' }}>{actionLabel}</Text>
          <Ionicons name="chevron-forward" size={14} color={theme.colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- FocusGroup
// Android only. Some phones move native focus to ANOTHER input by itself right
// after a tap (Name -> Phone -> Email ...). Inputs stay normal and always
// editable (so a tap always opens the keyboard); <FocusGroup> only runs the
// focus guard in lib/focusGuard.ts, which pushes focus back to the input the
// user really tapped. Outside a group (and on iOS / web) nothing changes.
type FocusGroupValue = FocusGuard;
const FocusGroupContext = createContext<FocusGroupValue | null>(null);

export function FocusGroup({ children }: { children?: ReactNode }) {
  const guard = useMemo(() => createFocusGuard(), []);
  if (Platform.OS !== 'android') return <>{children}</>;
  return <FocusGroupContext.Provider value={guard}>{children}</FocusGroupContext.Provider>;
}

// ------------------------------------------------------------ FocusTextInput
// Drop-in replacement for react-native's <TextInput> inside a <FocusGroup>.
// Outside a group (and on iOS / web) it is a plain TextInput.
function GroupedTextInput({ group, ...props }: TextInputProps & { group: FocusGroupValue }) {
  const id = useId();
  const inputRef = useRef<TextInput>(null);
  const refocus = () => inputRef.current?.focus();
  return (
    <TextInput
      {...props}
      ref={inputRef}
      onTouchStart={(e) => { group.touch(id, refocus); props.onTouchStart?.(e); }}
      onFocus={(e) => { group.focus(id, refocus); props.onFocus?.(e); }}
      onBlur={(e) => { group.blur(id); props.onBlur?.(e); }}
    />
  );
}

export function FocusTextInput(props: TextInputProps) {
  const group = useContext(FocusGroupContext);
  if (!group) return <TextInput {...props} />;
  return <GroupedTextInput group={group} {...props} />;
}

// -------------------------------------------------------------------- Field
export function Field({
  label, hint, error, icon, right, style, inputRef: externalRef, ...input
}: TextInputProps & { label: string; hint?: string; error?: string | null; icon?: IconName; right?: ReactNode; style?: StyleProp<ViewStyle>; inputRef?: Ref<TextInput> }) {
  const [focused, setFocused] = useState(false);
  const group = useContext(FocusGroupContext);
  const reveal = useContext(FormScrollContext);
  const boxRef = useRef<View>(null);
  const id = useId();
  const inputRef = useRef<TextInput | null>(null);
  // Lets a screen keep its own ref to this input (used for Next -> Next -> Done chaining).
  const setRefs = (node: TextInput | null) => {
    inputRef.current = node;
    if (typeof externalRef === 'function') externalRef(node);
    else if (externalRef) (externalRef as { current: TextInput | null }).current = node;
  };
  const borderColor = error ? theme.colors.danger : focused ? theme.colors.primary : theme.colors.border;
  return (
    <View style={[{ marginTop: theme.spacing.md }, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View ref={boxRef} collapsable={false} style={[
        styles.fieldBox,
        { borderColor, backgroundColor: focused ? theme.colors.surface : theme.colors.background },
        focused && { shadowColor: theme.colors.primary, shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
      ]}>
        {icon ? <Ionicons name={icon} size={18} color={focused ? theme.colors.primary : theme.colors.textSubtle} /> : null}
        <TextInput
          // v12.12: Android autofill OFF by default on EVERY Field. The autofill
          // suggestion card is what stole focus (Name -> Phone -> Email) and made
          // the keyboard flicker / close. A screen can still override any of these.
          autoComplete="off"
          importantForAutofill="noExcludeDescendants"
          textContentType="none"
          // v12.13: on Android a keyboard action (Done/Next) blurs a single-line input and the OS
          // then gives focus to the FIRST input on screen -> focus "jumps" and the keyboard closes.
          submitBehavior={Platform.OS === 'android' && !input.multiline ? 'submit' : undefined}
          {...input}
          ref={setRefs}
          placeholderTextColor={theme.colors.textSubtle}
          onTouchStart={(e) => { group?.touch(id, () => inputRef.current?.focus()); input.onTouchStart?.(e); }}
          onFocus={(e) => { group?.focus(id, () => inputRef.current?.focus()); setFocused(true); reveal?.(boxRef.current); input.onFocus?.(e); }}
          onBlur={(e) => { group?.blur(id); setFocused(false); input.onBlur?.(e); }}
          style={styles.fieldInput}
        />
        {right}
      </View>
      {error ? <Text style={[styles.fieldHint, { color: theme.colors.danger }]}>{error}</Text>
        : hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------- Segmented
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={[styles.segment, on && styles.segmentOn]}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: on ? theme.colors.text : theme.colors.textMuted }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- IconBadge
export function IconBadge({ name, color = theme.colors.primary, bg, size = 44 }: { name: IconName; color?: string; bg?: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.32, backgroundColor: bg ?? color + '18', alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={name} size={size * 0.5} color={color} />
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: 1, backgroundColor: theme.colors.border }, style]} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl,
    borderWidth: 1, borderColor: theme.colors.border, ...theme.shadow.card,
  },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: theme.radius.pill, alignSelf: 'flex-start' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: theme.radius.pill, borderWidth: 1, alignSelf: 'flex-start' },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: theme.spacing.lg, marginBottom: theme.spacing.md },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: theme.colors.text, marginBottom: 6 },
  fieldBox: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderRadius: theme.radius.md, paddingHorizontal: 14, minHeight: 50 },
  fieldInput: { flex: 1, fontSize: 16, color: theme.colors.text, paddingVertical: 12, outlineStyle: 'none' } as any,
  fieldHint: { fontSize: 12, color: theme.colors.textMuted, marginTop: 6 },
  segmented: { flexDirection: 'row', backgroundColor: theme.colors.neutralBg, borderRadius: theme.radius.md, padding: 4 },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: theme.radius.md - 3 },
  segmentOn: { backgroundColor: theme.colors.surface, ...theme.shadow.card, shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
});
