import { useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../constants/theme';
import { useLanguage } from '../lib/i18n';
import { tapFeedback } from '../lib/haptics';

type Props = {
  seatsTotal: number;
  seatsFilled: number;
  bookedSeats?: number[];
  /** Seats currently picked. Tapping a seat calls onSelect(seat) — the parent toggles it. */
  selectedSeats: number[];
  onSelect: (seat: number) => void;
};

/** Columns per row for a given capacity (4 / 6 / 8 / 10, split evenly by the aisle).
 *  The map always draws exactly `total` seats - the last row is simply shorter. */
function columnsFor(total: number) {
  return total <= 12 ? 4 : total <= 36 ? 6 : total <= 64 ? 8 : 10;
}

/** BookMyShow-style label for a seat number: 1 -> A1, 9 -> B1 (for 8 per row). */
export function seatLabel(seat: number | null | undefined, seatsTotal: number): string {
  if (!seat) return '—';
  const total = Math.max(1, Math.min(Math.trunc(Number(seatsTotal) || 0), 200));
  const perRow = columnsFor(total);
  const row = Math.floor((seat - 1) / perRow);
  const col = ((seat - 1) % perRow) + 1;
  return `${String.fromCharCode(65 + row)}${col}`;
}

const C = {
  primary: theme.colors.primary,
  primaryDark: theme.colors.primaryDark,
  tint: '#E8F3EC',
  seatBorder: '#8FC3A0',
  seatCushion: '#CFE6D6',
  bookedBack: '#E7EBE8',
  bookedCushion: '#D6DCD8',
  bookedIcon: '#A2ADA6',
  amber: '#B7791F',
  amberBg: '#FFF4DD',
};

export function BatchSeatMap({ seatsTotal, seatsFilled, bookedSeats = [], selectedSeats, onSelect }: Props) {
  const { t } = useLanguage();
  const total = Math.max(0, Math.min(Math.trunc(Number(seatsTotal) || 0), 200));
  if (!total) return null;

  const seatsPerRow = columnsFor(total);
  const columnsPerSide = seatsPerRow / 2;
  const rows = Math.ceil(total / seatsPerRow);
  const compact = seatsPerRow >= 10;
  const picked = new Set(selectedSeats ?? []);
  const booked = new Set(bookedSeats.filter((n) => Number.isInteger(n) && n >= 1 && n <= total));
  // Only seats the server says are held are blocked (never guessed from a counter).
  const isBooked = (seat: number) => booked.has(seat);
  const counted = Math.max(booked.size, Math.max(0, Math.min(Math.trunc(Number(seatsFilled) || 0), total)));
  const availableCount = Math.max(0, total - counted);
  const filledPct = Math.min(100, Math.round((counted / total) * 100));
  const soldOut = availableCount === 0;
  const fillingFast = !soldOut && availableCount / total <= 0.2;
  const pickedList = Array.from(picked).filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);

  return (
    <View style={styles.wrap}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t.chooseSeat ?? 'Choose your seat'}</Text>
          <Text style={styles.sub}>{t.seatRequestHint ?? 'Tap an available seat to pick it.'}</Text>
        </View>
        <View style={styles.ticketIcon}><Ionicons name="ticket" size={22} color={C.primary} /></View>
      </View>

      {/* Stat tiles */}
      <View style={styles.statsRow}>
        <View style={styles.statTile}>
          <Text style={[styles.statNum, { color: C.primary }]}>{availableCount}</Text>
          <Text style={styles.statLabel}>{t.seatAvailable ?? 'Available'}</Text>
        </View>
        <View style={styles.statTile}>
          <Text style={[styles.statNum, { color: C.bookedIcon }]}>{counted}</Text>
          <Text style={styles.statLabel}>{t.seatBooked ?? 'Booked'}</Text>
        </View>
        <View style={styles.statTile}>
          <Text style={styles.statNum}>{total}</Text>
          <Text style={styles.statLabel}>{t.totalSeats ?? 'Total seats'}</Text>
        </View>
      </View>

      {/* Fill progress */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${filledPct}%`, backgroundColor: soldOut ? C.bookedIcon : fillingFast ? C.amber : C.primary }]} />
      </View>
      {soldOut || fillingFast ? (
        <View style={[styles.badge, soldOut ? styles.badgeSold : styles.badgeFast]}>
          <Ionicons name={soldOut ? 'lock-closed' : 'flame'} size={12} color={soldOut ? theme.colors.textMuted : C.amber} />
          <Text style={[styles.badgeText, { color: soldOut ? theme.colors.textMuted : C.amber }]}>{soldOut ? 'Fully booked' : `Filling fast · only ${availableCount} left`}</Text>
        </View>
      ) : null}

      {/* Stage */}
      <View style={styles.stageWrap}>
        <View style={styles.stageGlow} />
        <View style={styles.screenArc} />
        <Text style={styles.stageText}>STAGE · TRAINER</Text>
      </View>

      {/* Seats */}
      <View style={styles.mapShell}>
        {Array.from({ length: rows }, (_, row) => {
          const rowSeats = Array.from({ length: seatsPerRow }, (_, col) => row * seatsPerRow + col + 1);
          const rowLabel = String.fromCharCode(65 + row);
          const renderSeat = (seat: number) => seat <= total
            ? <Seat key={seat} seat={seat} label={`${rowLabel}${((seat - 1) % seatsPerRow) + 1}`} booked={isBooked(seat)} selected={picked.has(seat)} compact={compact} onSelect={onSelect} />
            : <View key={seat} style={styles.seatGap} />;
          return (
            <View key={`row-${row}`} style={styles.rowWrap}>
              <View style={styles.rowBadge}><Text style={styles.rowLabel}>{rowLabel}</Text></View>
              <View style={styles.sideBlock}>{rowSeats.slice(0, columnsPerSide).map(renderSeat)}</View>
              <View style={styles.aisle} />
              <View style={styles.sideBlock}>{rowSeats.slice(columnsPerSide).map(renderSeat)}</View>
              <View style={styles.rowBadge}><Text style={styles.rowLabel}>{rowLabel}</Text></View>
            </View>
          );
        })}
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <Legend label={t.seatAvailable ?? 'Available'} kind="available" />
        <Legend label={t.seatSelected ?? 'Selected'} kind="selected" />
        <Legend label={t.seatBooked ?? 'Booked'} kind="booked" />
      </View>

      {/* Your selection */}
      {pickedList.length > 0 ? (
        <View style={styles.selectionBar}>
          <View style={styles.selectionHead}>
            <Ionicons name="checkmark-circle" size={16} color={C.primary} />
            <Text style={styles.selectionTitle}>{pickedList.length} {pickedList.length === 1 ? 'seat' : 'seats'} selected</Text>
          </View>
          <View style={styles.chipRow}>
            {pickedList.map((n) => (
              <View key={n} style={styles.chip}><Text style={styles.chipText}>{seatLabel(n, total)}</Text></View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Seat({ seat, label, booked, selected, compact, onSelect }: { seat: number; label: string; booked: boolean; selected: boolean; compact: boolean; onSelect: (seat: number) => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const mounted = useRef(false);
  const native = Platform.OS !== 'web';
  // Little "boing" whenever a seat becomes selected / unselected.
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    scale.setValue(0.8);
    Animated.spring(scale, { toValue: 1, useNativeDriver: native, friction: 4, tension: 200 }).start();
  }, [selected, scale, native]);
  return (
    <Animated.View style={[styles.seatWrap, { transform: [{ scale }] }]}>
      <Pressable
        disabled={booked}
        onPress={() => { void tapFeedback(); onSelect(seat); }}
        hitSlop={3}
        accessibilityRole="button"
        accessibilityLabel={`Seat ${label}${booked ? ', booked' : selected ? ', selected' : ', available'}`}
        style={StyleSheet.absoluteFill}
      >
        <View style={[styles.back, booked && styles.backBooked, selected && styles.backSelected]}>
          {booked
            ? <Ionicons name="close" size={compact ? 11 : 15} color={C.bookedIcon} />
            : <Text style={[styles.seatText, compact && styles.seatTextCompact, selected && styles.inverted]}>{label}</Text>}
        </View>
        <View style={[styles.cushion, booked && styles.cushionBooked, selected && styles.cushionSelected]} />
      </Pressable>
    </Animated.View>
  );
}

function Legend({ label, kind }: { label: string; kind: 'available' | 'selected' | 'booked' }) {
  return (
    <View style={styles.legendItem}>
      <View style={styles.miniSeat}>
        <View style={[styles.miniBack, kind === 'booked' && styles.backBooked, kind === 'selected' && styles.backSelected]} />
        <View style={[styles.miniCushion, kind === 'booked' && styles.cushionBooked, kind === 'selected' && styles.cushionSelected]} />
      </View>
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 18, padding: 18, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 28,
    backgroundColor: theme.colors.surface,
    shadowColor: '#0F2A1B', shadowOpacity: 0.07, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 3,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  title: { fontSize: 21, fontWeight: '900', color: theme.colors.text, letterSpacing: -0.3 },
  sub: { fontSize: 12.5, color: theme.colors.textMuted, marginTop: 4, lineHeight: 17 },
  ticketIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: C.tint },

  statsRow: { flexDirection: 'row', gap: 9, marginTop: 16 },
  statTile: { flex: 1, paddingVertical: 10, borderRadius: 16, backgroundColor: '#F6F9F7', borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center' },
  statNum: { fontSize: 20, fontWeight: '900', color: theme.colors.text },
  statLabel: { fontSize: 10.5, fontWeight: '700', color: theme.colors.textMuted, marginTop: 2, letterSpacing: 0.3 },

  progressTrack: { height: 6, borderRadius: 3, backgroundColor: theme.colors.border, marginTop: 14, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  badgeFast: { backgroundColor: C.amberBg },
  badgeSold: { backgroundColor: '#EEF1EF' },
  badgeText: { fontSize: 11.5, fontWeight: '800' },

  stageWrap: { alignItems: 'center', marginTop: 20, marginBottom: 16 },
  stageGlow: { position: 'absolute', top: 6, width: '86%', height: 40, borderTopLeftRadius: 120, borderTopRightRadius: 120, backgroundColor: C.primary + '12' },
  screenArc: { width: '78%', height: 28, borderTopLeftRadius: 90, borderTopRightRadius: 90, borderTopWidth: 4, borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.primary, backgroundColor: C.primary + '14' },
  stageText: { fontSize: 9.5, fontWeight: '900', letterSpacing: 2, color: theme.colors.textMuted, marginTop: 7 },

  mapShell: { paddingHorizontal: 6, paddingVertical: 12, borderRadius: 20, backgroundColor: '#F8FBF9', borderWidth: 1, borderColor: theme.colors.border },
  rowWrap: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  rowBadge: { width: 18, alignItems: 'center' },
  rowLabel: { fontSize: 10, fontWeight: '900', color: theme.colors.textMuted },
  sideBlock: { flex: 1, flexDirection: 'row', gap: 5 },
  aisle: { width: 22 },

  seatWrap: { flex: 1, aspectRatio: 1, maxWidth: 44 },
  seatGap: { flex: 1, maxWidth: 44 },
  back: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 7,
    borderTopLeftRadius: 11, borderTopRightRadius: 11, borderBottomLeftRadius: 5, borderBottomRightRadius: 5,
    borderWidth: 1.4, borderColor: C.seatBorder, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  cushion: { position: 'absolute', left: 3, right: 3, bottom: 0, height: 9, borderRadius: 5, backgroundColor: C.seatCushion },
  backBooked: { backgroundColor: C.bookedBack, borderColor: C.bookedBack },
  cushionBooked: { backgroundColor: C.bookedCushion },
  backSelected: {
    backgroundColor: C.primary, borderColor: C.primary,
    shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  cushionSelected: { backgroundColor: C.primaryDark },
  seatText: { fontSize: 10.5, fontWeight: '900', color: C.primary },
  seatTextCompact: { fontSize: 8.5 },
  inverted: { color: '#fff' },

  legend: { marginTop: 16, flexDirection: 'row', justifyContent: 'center', gap: 20, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  miniSeat: { width: 16, height: 16 },
  miniBack: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 4,
    borderTopLeftRadius: 6, borderTopRightRadius: 6, borderBottomLeftRadius: 2, borderBottomRightRadius: 2,
    borderWidth: 1.2, borderColor: C.seatBorder, backgroundColor: '#fff',
  },
  miniCushion: { position: 'absolute', left: 2, right: 2, bottom: 0, height: 5, borderRadius: 3, backgroundColor: C.seatCushion },
  legendText: { fontSize: 11.5, fontWeight: '600', color: theme.colors.textMuted },

  selectionBar: { marginTop: 16, padding: 12, borderRadius: 16, backgroundColor: C.tint, borderWidth: 1, borderColor: '#CFE6D6' },
  selectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  selectionTitle: { fontSize: 13, fontWeight: '800', color: C.primaryDark },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 9 },
  chip: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 12, backgroundColor: C.primary },
  chipText: { fontSize: 12, fontWeight: '900', color: '#fff' },
});
