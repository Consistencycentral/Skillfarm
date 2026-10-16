// ===========================================================================
// DateField - tap to open a calendar, no typing.
//
// Value is a plain 'YYYY-MM-DD' string ('' = empty), exactly what the old text
// inputs held, so validation and API code need no change.
// Pure JS (Modal + Pressable): no native package, works on Android, iOS, web.
// ===========================================================================
import { useMemo, useState } from 'react';
import { Keyboard, Modal, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../constants/theme';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const WEEKDAYS_LONG = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (n: number) => String(n).padStart(2, '0');
const toKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`; // m is 0-based
function parseKey(v?: string | null): { y: number; m: number; d: number } | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const y = Number(v.slice(0, 4)), m = Number(v.slice(5, 7)) - 1, d = Number(v.slice(8, 10));
  const dt = new Date(y, m, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) return null; // e.g. 2026-02-31
  return { y, m, d };
}
function todayKey() {
  const t = new Date();
  return toKey(t.getFullYear(), t.getMonth(), t.getDate());
}
function pretty(v: string) {
  const p = parseKey(v);
  if (!p) return v;
  return `${p.d} ${MON_SHORT[p.m]} ${p.y} (${WEEKDAYS_LONG[new Date(p.y, p.m, p.d).getDay()]})`;
}

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Earliest selectable day, 'YYYY-MM-DD'. */
  minDate?: string;
  /** Latest selectable day, 'YYYY-MM-DD'. */
  maxDate?: string;
  /** Show a clear (x) button when a date is set. Default true. */
  clearable?: boolean;
  /** Smaller box, for filter rows. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function DateField({ value, onChange, placeholder = 'Select date', minDate, maxDate, clearable = true, compact = false, style, accessibilityLabel }: Props) {
  const [open, setOpen] = useState(false);
  const today = todayKey();

  // month being shown in the calendar
  const [view, setView] = useState<{ y: number; m: number }>(() => {
    const s = parseKey(value) ?? parseKey(today)!;
    return { y: s.y, m: s.m };
  });

  function openCal() {
    Keyboard.dismiss();
    const s = parseKey(value) ?? parseKey(minDate && minDate > todayKey() ? minDate : todayKey())!;
    setView({ y: s.y, m: s.m });
    setOpen(true);
  }

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1).getDay();
    const days = new Date(view.y, view.m + 1, 0).getDate();
    const out: (number | null)[] = Array(first).fill(null);
    for (let d = 1; d <= days; d++) out.push(d);
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [view]);

  function shift(delta: number) {
    setView((v) => {
      const dt = new Date(v.y, v.m + delta, 1);
      return { y: dt.getFullYear(), m: dt.getMonth() };
    });
  }
  const disabledKey = (k: string) => (minDate ? k < minDate : false) || (maxDate ? k > maxDate : false);

  function pick(d: number) {
    const k = toKey(view.y, view.m, d);
    if (disabledKey(k)) return;
    onChange(k);
    setOpen(false);
  }

  return (
    <>
      <Pressable
        onPress={openCal}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? 'Select date'}
        style={[styles.box, compact && styles.boxCompact, style]}
      >
        <Ionicons name="calendar-outline" size={compact ? 16 : 18} color={theme.colors.primary} />
        <Text style={[styles.text, compact && styles.textCompact, !value && styles.placeholder]} numberOfLines={1}>
          {value ? pretty(value) : placeholder}
        </Text>
        {value && clearable ? (
          <Pressable onPress={() => onChange('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear date">
            <Ionicons name="close-circle" size={compact ? 16 : 18} color={theme.colors.textMuted} />
          </Pressable>
        ) : null}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* inner Pressable swallows taps so touching the card does not close it */}
          <Pressable style={styles.card} onPress={() => {}}>
            <View style={styles.head}>
              <Pressable onPress={() => shift(-1)} hitSlop={10} style={styles.nav} accessibilityLabel="Previous month">
                <Ionicons name="chevron-back" size={20} color={theme.colors.text} />
              </Pressable>
              <Text style={styles.title}>{MONTHS[view.m]} {view.y}</Text>
              <Pressable onPress={() => shift(1)} hitSlop={10} style={styles.nav} accessibilityLabel="Next month">
                <Ionicons name="chevron-forward" size={20} color={theme.colors.text} />
              </Pressable>
            </View>

            <View style={styles.row}>
              {WEEKDAYS.map((w) => <Text key={w} style={styles.weekday}>{w}</Text>)}
            </View>

            <View style={styles.grid}>
              {cells.map((d, i) => {
                if (d == null) return <View key={i} style={styles.cell} />;
                const k = toKey(view.y, view.m, d);
                const isSel = value === k;
                const isToday = k === today;
                const off = disabledKey(k);
                return (
                  <Pressable key={i} style={styles.cell} onPress={() => pick(d)} disabled={off} accessibilityLabel={`${d} ${MONTHS[view.m]} ${view.y}`}>
                    <View style={[styles.day, isToday && styles.dayToday, isSel && styles.daySel]}>
                      <Text style={[styles.dayText, off && styles.dayOff, isSel && styles.dayTextSel]}>{d}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.foot}>
              <Pressable
                onPress={() => { const t = todayKey(); if (!disabledKey(t)) { onChange(t); setOpen(false); } else { const p = parseKey(t)!; setView({ y: p.y, m: p.m }); } }}
                hitSlop={8}
              >
                <Text style={styles.link}>Today</Text>
              </Pressable>
              <View style={{ flex: 1 }} />
              {clearable && value ? (
                <Pressable onPress={() => { onChange(''); setOpen(false); }} hitSlop={8} style={{ marginRight: 20 }}>
                  <Text style={[styles.link, { color: theme.colors.textMuted }]}>Clear</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <Text style={styles.link}>Close</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const CELL = `${100 / 7}%` as const;

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md,
    paddingHorizontal: 12, paddingVertical: 12, backgroundColor: theme.colors.surface,
  },
  boxCompact: { paddingVertical: 10, gap: 8 },
  text: { flex: 1, fontSize: 16, color: theme.colors.text },
  textCompact: { fontSize: 14 },
  placeholder: { color: theme.colors.textMuted },

  backdrop: { flex: 1, backgroundColor: 'rgba(15,42,27,0.45)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 360, backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: 14 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  nav: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background },
  title: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  row: { flexDirection: 'row' },
  weekday: { width: CELL, textAlign: 'center', fontSize: 12, fontWeight: '600', color: theme.colors.textMuted, paddingVertical: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: CELL, height: 42, alignItems: 'center', justifyContent: 'center' },
  day: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dayToday: { borderWidth: 1.5, borderColor: theme.colors.primary },
  daySel: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  dayText: { fontSize: 14, color: theme.colors.text },
  dayTextSel: { color: '#fff', fontWeight: '700' },
  dayOff: { color: '#C3CBC6' },
  foot: { flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.colors.border },
  link: { fontSize: 14, fontWeight: '700', color: theme.colors.primary },
});
