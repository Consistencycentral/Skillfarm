// ===========================================================================
// Provider Dashboard — stats (courses, registrations, seats used) + quick
// links to manage courses. (Learner export lives only on the Learners screen.)
// ===========================================================================
import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, RefreshControl, ScrollView } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { listMyCourses } from '../../api/courses';
import { listMyStudents } from '../../api/registrations';
import { listNextBatchesForCourses, type Batch } from '../../api/batches';
import { supabase } from '../../lib/supabase';
import { EmptyState } from '../../components/EmptyState';
import { theme } from '../../constants/theme';
import { FadeInView } from '../../components/motion';
import { Card, IconBadge } from '../../components/ui';
import { Button } from '../../components/Button';

export default function ProviderHomeScreen() {
  const [stats, setStats] = useState({ courses: 0, upcomingBatches: 0, pending: 0, approved: 0, seatsAvailable: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // isRefresh (from pull-to-refresh) skips the full-screen spinner. Kept out of
  // the dep array so `load`'s identity is stable and the focus effect fires once.
  const load = useCallback(async (isRefresh = false) => {
    try {
      if (!isRefresh) setLoading(true);
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const [courses, students] = await Promise.all([
        listMyCourses(u.user.id),
        listMyStudents(u.user.id),
      ]);
      let batches: Record<string, Batch | null> = {};
      try { batches = await listNextBatchesForCourses(courses.map((c) => c.id)); } catch { batches = {}; }
      const now = Date.now();
      const upcomingBatches = Object.values(batches).filter((b) => b?.start_date && new Date(b.start_date).getTime() >= now).length;
      const pending = students.filter((s) => s.status === 'pending').length;
      const approved = students.filter((s) => s.status === 'registered' || s.status === 'completed').length;
      const seatsAvailable = courses.reduce((sum, c) => sum + Math.max(0, c.seats_total - c.seats_filled), 0);
      setStats({ courses: courses.length, upcomingBatches, pending, approved, seatsAvailable });
    } catch (e) {
      // ignore on background refresh
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading && !refreshing) {
    return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} colors={[theme.colors.primary]} />}
    >
      <Text style={styles.overline}>OVERVIEW</Text>
      <Text style={styles.heading}>Your learning centre</Text>
      <Text style={styles.headingSub}>Requests, batches and seats at a glance.</Text>

      {/* Primary action: one tap from the dashboard to the new-course form. */}
      <View style={styles.createWrap}>
        <Button label="Create course" icon="add-circle" size="lg" fullWidth onPress={() => router.push('/(provider)/course-edit')} />
        <Text style={styles.createHint}>
          {stats.courses === 0 ? 'Start here: list your first offline course.' : 'Add a new offline course and its batches.'}
        </Text>
      </View>

      {/* Actionable provider summary — all values are derived from live courses, batches and registrations. */}
      <View style={styles.statRow}>
        <StatTile icon="book" label="Courses" value={stats.courses} color={theme.colors.primary} />
        <StatTile icon="calendar" label="Upcoming batches" value={stats.upcomingBatches} color={theme.colors.info} />
      </View>
      <View style={styles.statRow}>
        <StatTile icon="time" label="Pending requests" value={stats.pending} color={theme.colors.warning} />
        <StatTile icon="people" label="Approved learners" value={stats.approved} color={theme.colors.success} />
      </View>
      <View style={styles.availableCard}>
        <View style={[styles.statIcon, { backgroundColor: theme.colors.primary + '20' }]}><Ionicons name="ticket-outline" size={22} color={theme.colors.primary} /></View>
        <View style={{ flex: 1 }}><Text style={styles.availableValue}>{stats.seatsAvailable}</Text><Text style={styles.statLabel}>Seats currently available</Text></View>
        <Pressable onPress={() => router.push('/(provider)/students')} accessibilityLabel="View learner requests"><Ionicons name="chevron-forward" size={20} color={theme.colors.textSubtle} /></Pressable>
      </View>

      {stats.pending > 0 || stats.upcomingBatches === 0 ? (
        <View style={styles.attentionCard}>
          <View style={styles.attentionIcon}>
            <Ionicons name={stats.pending > 0 ? 'notifications-outline' : 'calendar-outline'} size={20} color={theme.colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.attentionTitle}>{stats.pending > 0 ? 'Needs your attention' : 'Plan your next batch'}</Text>
            <Text style={styles.attentionText}>
              {stats.pending > 0
                ? `${stats.pending} learner request${stats.pending === 1 ? '' : 's'} waiting for your review.`
                : 'Add an upcoming batch so learners can discover and request a seat.'}
            </Text>
          </View>
          <Pressable onPress={() => router.push(stats.pending > 0 ? '/(provider)/students' : '/(provider)/courses')} style={styles.attentionAction}>
            <Text style={styles.attentionActionText}>{stats.pending > 0 ? 'Review' : 'Manage'}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Quick actions */}
      <Text style={styles.sectionTitle}>Quick actions</Text>
      <Card style={styles.actionCard} onPress={() => router.push('/(provider)/courses')}>
        <IconBadge name="create-outline" />
        <View style={styles.actionText}>
          <Text style={styles.actionTitle}>My courses</Text>
          <Text style={styles.actionSub}>Edit courses, set batches and upload materials</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={theme.colors.textSubtle} />
      </Card>

      <Card style={styles.actionCard} onPress={() => router.push('/(provider)/attendance-scan')} accessibilityLabel="Scan attendance QR">
        <IconBadge name="qr-code-outline" />
        <View style={styles.actionText}>
          <Text style={styles.actionTitle}>Scan attendance</Text>
          <Text style={styles.actionSub}>Scan a learner's ticket QR to mark them present</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={theme.colors.textSubtle} />
      </Card>

      {stats.courses === 0 ? (
        <View style={{ marginTop: 24 }}>
          <EmptyState icon="rocket-outline" title="Welcome!" subtitle="Tap “Create course” above to start receiving registrations." />
        </View>
      ) : null}
    </ScrollView>
  );
}

function StatTile({ icon, label, value, color }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: number; color: string }) {
  return (
    <FadeInView style={styles.statTile}>
      <View style={[styles.statIcon, { backgroundColor: color + '20' }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </FadeInView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: theme.colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  overline: { ...theme.type.overline, color: theme.colors.primary, marginTop: 4, marginBottom: 6 },
  heading: { ...theme.type.display, color: theme.colors.text },
  headingSub: { ...theme.type.body, color: theme.colors.textMuted, marginTop: 4, marginBottom: 20 },
  createWrap: { marginBottom: 20 },
  createHint: { fontSize: 12.5, color: theme.colors.textMuted, textAlign: 'center', marginTop: 8 },
  statRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  statTile: { flex: 1, backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, padding: 16, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'flex-start', ...theme.shadow.card },
  statIcon: { width: 42, height: 42, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  statValue: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.6, color: theme.colors.text },
  statLabel: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2 },
  availableCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: theme.colors.border, ...theme.shadow.card },
  availableValue: { fontSize: 24, fontWeight: '800', color: theme.colors.text },
  sectionTitle: { fontSize: theme.font.title, fontWeight: '800', color: theme.colors.text, marginTop: 8, marginBottom: 12 },
  attentionCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.lg, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: theme.colors.primaryLight },
  attentionIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' },
  attentionTitle: { fontSize: 14, fontWeight: '800', color: theme.colors.text },
  attentionText: { fontSize: 12.5, lineHeight: 18, color: theme.colors.textMuted, marginTop: 2 },
  attentionAction: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: theme.radius.md, backgroundColor: theme.colors.primary },
  attentionActionText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  actionCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, marginBottom: 12, borderRadius: theme.radius.lg },
  actionText: { flex: 1 },
  actionTitle: { ...theme.type.h3, color: theme.colors.text },
  actionSub: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2 },
});
