import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../constants/theme';
import { batchSeatsLeft, type Batch } from '../api/batches';

export function NextBatchInfo({ batch, compact = false }: { batch: Batch | null; compact?: boolean }) {
  if (!batch) return null;
  const left = batchSeatsLeft(batch);
  const dates = [batch.start_date, batch.end_date].filter(Boolean).join(' – ');
  return (
    <View style={[styles.wrap, compact && styles.compact]}>
      <View style={styles.icon}><Ionicons name="calendar-outline" size={compact ? 14 : 16} color={theme.colors.primary} /></View>
      <View style={styles.body}>
        <Text style={styles.label}>Next batch · {batch.name}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {dates || 'Dates to be confirmed'}{batch.timings ? ` · ${batch.timings}` : ''}
        </Text>
        {!compact && batch.registration_deadline ? (
          <Text style={styles.deadline}>Registration closes {batch.registration_deadline}</Text>
        ) : null}
      </View>
      <Text style={styles.seats}>{left} left</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, marginTop: 10, borderRadius: theme.radius.md, backgroundColor: theme.colors.background, borderWidth: 1, borderColor: theme.colors.border },
  compact: { padding: 9, marginTop: 8 },
  icon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary + '15' },
  body: { flex: 1, minWidth: 0 },
  label: { fontSize: 12, fontWeight: '700', color: theme.colors.text },
  meta: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
  deadline: { fontSize: 11, color: theme.colors.textMuted, marginTop: 3 },
  seats: { fontSize: 12, fontWeight: '700', color: theme.colors.primary },
});
