// ===========================================================================
// My Seats — the learner's registered courses. Shows status badge
// (Pending / Confirmed / Waitlist / Rejected / Cancelled / Completed),
// location, and a Cancel button for active seats (pending / waitlist / confirmed).
// ===========================================================================
import { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, Pressable, RefreshControl } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { seatLabel } from '../../components/BatchSeatMap';
import { listMyRegistrations, cancelMyRegistration, listMyWaitlistPositions, type RegistrationWithCourse } from '../../api/registrations';
import { CATEGORY_LABELS } from '../../api/courses';
import { supabase } from '../../lib/supabase';
import { EmptyState } from '../../components/EmptyState';
import { theme } from '../../constants/theme';
import { RegistrationTimeline } from '../../components/RegistrationTimeline';
import { Alert } from '../../lib/alert';
import { useLanguage } from '../../lib/i18n';
import { localizeCourse } from '../../lib/courseText';
import { syncTrainingReminders } from '../../lib/localNotifications';
import { StatusPill, Card } from '../../components/ui';
import { Button } from '../../components/Button';
import { FadeInView } from '../../components/motion';

export default function MyRegistrationsScreen() {
  const { t, lang } = useLanguage();
  const [regs, setRegs] = useState<RegistrationWithCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitPos, setWaitPos] = useState<Map<string, { position: number; total: number }>>(new Map());

  // isRefresh (from pull-to-refresh) skips the full-screen spinner. Kept out of
  // the dep array so `load`'s identity is stable and the focus effect fires once.
  const load = useCallback(async (isRefresh = false) => {
    try {
      setError(null);
      if (!isRefresh) setLoading(true);
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { setRegs([]); return; }
      const rows = await listMyRegistrations(u.user.id);
      setRegs(rows);
      void syncTrainingReminders(rows);
      // "You're #N on the waitlist" (needs the v9 SQL; empty map if it is not installed).
      if (rows.some((r) => r.status === 'waitlist')) setWaitPos(await listMyWaitlistPositions());
    } catch (e: any) {
      setError(e?.message ?? 'Could not load your registrations.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function statusLabel(s: string) {
    if (s === 'registered') return t.cd_confirmed;
    if (s === 'pending') return t.cd_pendingApproval;
    if (s === 'waitlist') return t.cd_waitlist;
    if (s === 'cancelled') return t.cd_cancelled;
    if (s === 'rejected') return t.cd_rejected;
    if (s === 'completed') return t.cd_completed;
    // Unknown status — never mislabel it as "Completed".
    return 'Unknown';
  }

  function handleCancel(reg: RegistrationWithCourse) {
    if (reg.status === 'waitlist') {
      Alert.alert(t.wl_leave, `You will leave the waitlist for "${reg.course.title}".`, [
        { text: 'Stay on waitlist', style: 'cancel' },
        {
          text: t.wl_leave,
          style: 'destructive',
          onPress: async () => {
            try { await cancelMyRegistration(reg.id); load(); }
            catch (e: any) { Alert.alert('Could not leave the waitlist', e?.message ?? 'Please try again.'); }
          },
        },
      ]);
      return;
    }
    Alert.alert('Cancel registration?', `${reg.preferred_seat_number ? `Seat ${seatLabel(reg.preferred_seat_number, reg.batch?.seats_total ?? 40)} in` : 'Your seat in'} "${reg.course.title}" will be released.`, [
      { text: 'Keep seat', style: 'cancel' },
      {
        text: 'Cancel seat',
        style: 'destructive',
        onPress: async () => {
          try {
            // One registration row = one seat, so a learner holding several seats
            // cancels exactly the seat they tapped.
            await cancelMyRegistration(reg.id);
            load();
          } catch (e: any) {
            Alert.alert('Could not cancel', e?.message ?? 'Please try again.');
          }
        },
      },
    ]);
  }

  if (loading && !refreshing) {
    return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
  }
  if (error) {
    return (
      <View style={styles.center}>
        <EmptyState icon="cloud-offline" title="Could not load My Seats" subtitle={error} />
        <View style={{ marginTop: 16 }}><Button label="Retry" icon="refresh" onPress={() => load()} /></View>
      </View>
    );
  }
  const summary = ['registered', 'pending', 'waitlist', 'rejected'] as const;

  if (regs.length === 0) {
    return (
      <View style={styles.center}>
        <EmptyState icon="ticket-outline" title="No seats booked yet" subtitle="Browse courses and register your first offline seat." />
        <View style={{ marginTop: 16 }}><Button label="Browse courses" icon="search" onPress={() => router.push('/(student)/browse')} /></View>
      </View>
    );
  }

  return (
    <FlatList
      data={regs}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
      ListHeaderComponent={
        <View style={styles.summaryRow}>
          {summary.map((key) => {
            const count = regs.filter((r) => r.status === key).length;
            const tone = theme.status[key];
            return (
              <View key={key} style={[styles.summaryTile, { backgroundColor: tone.bg }]}>
                <Text style={[styles.summaryCount, { color: tone.fg }]}>{count}</Text>
                <Text style={[styles.summaryLabel, { color: tone.fg }]} numberOfLines={1}>{statusLabel(key)}</Text>
              </View>
            );
          })}
        </View>
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} colors={[theme.colors.primary]} />}
      renderItem={({ item }) => {
        return (
          <FadeInView>
          <Card style={styles.card} onPress={() => router.push(`/course/${item.course_id}`)} accessibilityLabel={item.course.title}>
            <View style={styles.cardHeader}>
              <StatusPill status={item.status} label={statusLabel(item.status)} />
              <Text style={styles.date}>{new Date(item.registered_at).toLocaleDateString()}</Text>
            </View>

            <Text style={styles.title} numberOfLines={2}>{item.course.title}</Text>

            {item.batch ? (
              <View style={styles.batchBox}>
                <Ionicons name="layers-outline" size={14} color={theme.colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.batchName}>{item.batch.name}{item.preferred_seat_number ? ` · Seat ${seatLabel(item.preferred_seat_number, item.batch.seats_total)}` : ''}</Text>
                  <Text style={styles.meta}>
                    {[item.batch.start_date, item.batch.end_date].filter(Boolean).join(' – ') || 'Dates to be confirmed'}
                    {item.batch.timings ? ` · ${item.batch.timings}` : ''}
                  </Text>
                </View>
              </View>
            ) : null}

            <View style={styles.metaRow}>
              <Ionicons name="pricetag" size={13} color={theme.colors.textMuted} />
              <Text style={styles.meta}>{CATEGORY_LABELS[item.course.category as keyof typeof CATEGORY_LABELS] ?? 'Course'}</Text>
            </View>
            <View style={styles.metaRow}>
              <Ionicons name="location" size={13} color={theme.colors.textMuted} />
              <Text style={styles.meta} numberOfLines={1}>
                {[item.course.city, item.course.state].filter(Boolean).join(', ') || item.course.address}
              </Text>
            </View>

            <View style={styles.attendanceRow}>
              <Ionicons name={item.attendance_status === 'present' ? 'checkmark-circle' : item.attendance_status === 'absent' ? 'close-circle' : 'time-outline'} size={15} color={item.attendance_status === 'present' ? theme.colors.success : item.attendance_status === 'absent' ? theme.colors.danger : theme.colors.textMuted} />
              <Text style={styles.meta}>Attendance: {item.attendance_status === 'present' ? 'Present' : item.attendance_status === 'absent' ? 'Absent' : 'Not marked yet'}</Text>
            </View>
            <RegistrationTimeline status={item.status} />

            {item.status === 'pending' ? (
              <View style={styles.metaRow}>
                <Ionicons name="time-outline" size={15} color={theme.colors.warning} />
                <Text style={styles.meta}>{item.waitlist_promoted_at ? t.wl_seatOpened : t.cd_heldWaiting}</Text>
              </View>
            ) : null}
            {item.status === 'waitlist' ? (
              <View style={styles.metaRow}>
                <Ionicons name="hourglass-outline" size={15} color={theme.colors.warning} />
                <Text style={styles.meta}>
                  {waitPos.get(item.id)
                    ? `${t.wl_position.replace('{n}', String(waitPos.get(item.id)!.position))} (${waitPos.get(item.id)!.total})`
                    : t.wl_doneBody}
                </Text>
              </View>
            ) : null}
            {item.status === 'registered' ? (
              <View style={{ marginTop: 14 }}>
                <Button label="Open attendance ticket" icon="qr-code-outline" fullWidth onPress={() => router.push(`/ticket/${item.id}`)} />
              </View>
            ) : null}
            {item.status === 'registered' || item.status === 'waitlist' || item.status === 'pending' ? (
              <Pressable style={styles.cancelBtn} onPress={() => handleCancel(item)}>
                <Text style={styles.cancelText}>{item.status === 'waitlist' ? t.wl_leave : 'Cancel registration'}</Text>
              </Pressable>
            ) : null}
          </Card>
          </FadeInView>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: theme.colors.background },
  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  summaryTile: { flex: 1, paddingVertical: 12, paddingHorizontal: 8, borderRadius: theme.radius.lg, alignItems: 'center' },
  summaryCount: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  summaryLabel: { fontSize: 10.5, fontWeight: '700', marginTop: 2 },
  card: { marginBottom: 14, padding: 18 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  date: { ...theme.type.caption, color: theme.colors.textSubtle },
  title: { ...theme.type.h2, color: theme.colors.text, marginBottom: 10 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  meta: { ...theme.type.small, color: theme.colors.textMuted, flexShrink: 1 },
  batchBox: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6, padding: 12, borderRadius: theme.radius.md, backgroundColor: theme.colors.primaryTint },
  batchName: { fontSize: 13.5, fontWeight: '700', color: theme.colors.text, marginBottom: 2 },
  cancelBtn: { marginTop: 10, paddingVertical: 10, alignSelf: 'center' },
  cancelText: { color: theme.colors.danger, fontSize: 13.5, fontWeight: '700' },
  attendanceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, marginBottom: 2 },
});
