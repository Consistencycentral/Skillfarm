import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Batch } from '../api/batches';
import { batchSeatsLeft, isBatchRegistrationOpen } from '../api/batches';
import { theme } from '../constants/theme';

type Props = {
  batches: Batch[];
  selectedBatchId: string | null;
  onSelect: (batch: Batch) => void;
  location?: string;
};

function dateLabel(value: string | null) {
  if (!value) return 'Date to be confirmed';
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function isUpcoming(value: string | null) {
  if (!value) return true;
  const d = new Date(`${value}T23:59:59`);
  return !Number.isNaN(d.getTime()) && d.getTime() >= Date.now();
}

function daysUntil(value: string | null) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.ceil((d.getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000));
}

export function BatchSelector({ batches, selectedBatchId, onSelect, location }: Props) {
  if (!batches.length) {
    return (
      <View style={styles.empty}>
        <View style={styles.emptyIcon}><Ionicons name="calendar-outline" size={20} color={theme.colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.emptyTitle}>No upcoming batch published yet</Text>
          <Text style={styles.emptyText}>There is no upcoming event date for this course. The Learning Partner needs to publish a new one.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Upcoming batches & events</Text>
      <Text style={styles.subtitle}>Pick the exact event date and time. Seat capacity is set by the Learning Partner.</Text>

      {batches.map((batch) => {
        const selected = batch.id === selectedBatchId;
        const left = batchSeatsLeft(batch);
        const full = left === 0;
        const upcoming = isUpcoming(batch.start_date);
        const open = upcoming && !full && isBatchRegistrationOpen(batch);
        const days = daysUntil(batch.start_date);
        const fillPct = batch.seats_total > 0 ? Math.min(100, (batch.seats_filled / batch.seats_total) * 100) : 0;

        return (
          <Pressable
            key={batch.id}
            onPress={() => onSelect(batch)}
            disabled={!open}
            style={[styles.card, selected && styles.cardSelected, !open && styles.cardDisabled]}
          >
            <View style={styles.dateBox}>
              <Text style={styles.dateDay}>{batch.start_date ? new Date(`${batch.start_date}T00:00:00`).toLocaleDateString(undefined, { day: '2-digit' }) : '—'}</Text>
              <Text style={styles.dateMonth}>{batch.start_date ? new Date(`${batch.start_date}T00:00:00`).toLocaleDateString(undefined, { month: 'short' }).toUpperCase() : 'TBD'}</Text>
            </View>

            <View style={styles.body}>
              <View style={styles.topLine}>
                <Text style={styles.name} numberOfLines={1}>{batch.name?.trim() || 'Upcoming batch'}</Text>
                <View style={[styles.statusPill, full ? styles.fullPill : upcoming ? styles.upcomingPill : styles.closedPill]}>
                  <Text style={[styles.statusText, full ? styles.fullText : upcoming ? styles.upcomingText : styles.closedText]}>{full ? 'FULL' : upcoming ? 'UPCOMING' : 'CLOSED'}</Text>
                </View>
              </View>

              <Text style={styles.metaStrong}><Ionicons name="calendar-outline" size={13} color={theme.colors.primary} /> {dateLabel(batch.start_date)}</Text>
              <Text style={styles.metaStrong}><Ionicons name="time-outline" size={13} color={theme.colors.primary} /> {batch.timings?.trim() || 'Timing to be confirmed'}</Text>
              {batch.duration_weeks ? <Text style={styles.meta}><Ionicons name="hourglass-outline" size={13} color={theme.colors.textMuted} /> {batch.duration_weeks} week{batch.duration_weeks === 1 ? '' : 's'}</Text> : null}
              {location ? <Text style={styles.meta} numberOfLines={1}><Ionicons name="location-outline" size={13} color={theme.colors.textMuted} /> {location}</Text> : null}

              <View style={styles.eventRow}>
                <Text style={[styles.seats, full && styles.full]}>{full ? 'No seats available' : `${left} of ${batch.seats_total} seats available`}</Text>
                {days !== null && upcoming && !full ? <Text style={styles.days}>{days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`}</Text> : null}
              </View>
              <View style={styles.capacityTrack}><View style={[styles.capacityFill, { width: `${fillPct}%` }]} /></View>
              {!open && !full && <View style={styles.closedRow}><Ionicons name="lock-closed-outline" size={13} color={theme.colors.textMuted} /><Text style={styles.closed}>Registration closed for this event</Text></View>}
            </View>

            <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}</View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 18 },
  title: { fontSize: 18, fontWeight: '900', color: theme.colors.text },
  subtitle: { marginTop: 4, color: theme.colors.textMuted, fontSize: 13, lineHeight: 18 },
  card: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 12, padding: 13, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 17, backgroundColor: theme.colors.surface, gap: 11 },
  cardSelected: { borderColor: theme.colors.primary, borderWidth: 2, backgroundColor: '#F5FBF7' },
  cardDisabled: { opacity: 0.6 },
  dateBox: { width: 52, minHeight: 58, borderRadius: 13, backgroundColor: theme.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border },
  dateDay: { fontSize: 20, fontWeight: '900', color: theme.colors.primary },
  dateMonth: { marginTop: 1, fontSize: 9, fontWeight: '900', color: theme.colors.textMuted, letterSpacing: 0.7 },
  body: { flex: 1, minWidth: 0 },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  name: { flex: 1, fontSize: 15, fontWeight: '900', color: theme.colors.text },
  statusPill: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8 },
  upcomingPill: { backgroundColor: '#E7F5EB' },
  fullPill: { backgroundColor: '#F0F1F0' },
  closedPill: { backgroundColor: '#F2F2F2' },
  statusText: { fontSize: 8.5, fontWeight: '900', letterSpacing: 0.7 },
  upcomingText: { color: theme.colors.primary },
  fullText: { color: theme.colors.textMuted },
  closedText: { color: theme.colors.textMuted },
  metaStrong: { marginTop: 6, color: theme.colors.text, fontSize: 12.5, fontWeight: '700' },
  meta: { marginTop: 4, color: theme.colors.textMuted, fontSize: 12 },
  eventRow: { marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  seats: { color: theme.colors.primary, fontWeight: '800', fontSize: 12.5 },
  full: { color: theme.colors.textMuted },
  days: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '800' },
  capacityTrack: { height: 5, borderRadius: 3, backgroundColor: theme.colors.border, marginTop: 7, overflow: 'hidden' },
  capacityFill: { height: '100%', backgroundColor: theme.colors.primary, borderRadius: 3 },
  closedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  closed: { color: theme.colors.textMuted, fontSize: 11 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  radioSelected: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  empty: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 14, padding: 15, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceAlt },
  emptyIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 14, fontWeight: '900', color: theme.colors.text },
  emptyText: { marginTop: 3, fontSize: 12, color: theme.colors.textMuted, lineHeight: 17 },
});
