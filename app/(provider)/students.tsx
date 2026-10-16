// ===========================================================================
// Enrollment Dashboard — the Learning Partner's view of everyone who applied
// to their courses. Stat tiles (total / pending / approved / waitlist /
// cancelled), per-row Approve/Reject, and an attendance marker. The export at
// the top produces an HTML report (openable, printable, "Save as PDF") — not a
// spreadsheet; see lib/export.ts.
// ===========================================================================
import { useState, useCallback } from 'react';
import {
  View, Text, TextInput, StyleSheet, FlatList, ActivityIndicator, RefreshControl, Pressable, Modal, ScrollView, Switch
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  listMyStudents, approveRegistration, rejectRegistration, setAttendance,
  type StudentRow, type AttendanceStatus,
} from '../../api/registrations';
import { listMyCourses } from '../../api/courses';
import { getMyProfile } from '../../api/profile';
import { DEFAULT_EXPORT_FIELDS, type ExportFields } from '../../lib/export';
import { LearnerReportExportButtons, AttendanceReportButtons } from '../../components/LearnerReportExportButtons';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { EmptyState } from '../../components/EmptyState';
import { theme } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import { Alert } from '../../lib/alert';

// One course option in the export-filter dropdown.
interface CourseOption { id: string; title: string; }

export default function ProviderStudentsScreen() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Export filters
  const [showExport, setShowExport] = useState(false);
  const [fields, setFields] = useState<ExportFields>(DEFAULT_EXPORT_FIELDS);
  const [courseOptions, setCourseOptions] = useState<CourseOption[]>([]);
  const [filterCourseId, setFilterCourseId] = useState<string>(''); // '' = all
  const [filterFrom, setFilterFrom] = useState(''); // YYYY-MM-DD
  const [filterTo, setFilterTo] = useState('');   // YYYY-MM-DD
  // Goes into the report filename so two partners' exports are distinguishable
  // — it used to be left undefined, making every file SkillFarm_skillfarm_<date>.
  const [orgName, setOrgName] = useState('');

  // isRefresh (from pull-to-refresh) skips the full-screen spinner. Kept out of
  // the dep array so `load`'s identity is stable and the focus effect fires once.
  const load = useCallback(async (isRefresh = false) => {
    try {
      if (!isRefresh) setLoading(true);
      setLoadError(null);
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const [rows, courses, me] = await Promise.all([
        listMyStudents(u.user.id),
        listMyCourses(u.user.id),
        getMyProfile(),
      ]);
      setStudents(rows);
      setCourseOptions(courses.map((c) => ({ id: c.id, title: c.title })));
      setOrgName(me?.org_name ?? me?.full_name ?? '');
    } catch (e: any) {
      // Say what went wrong instead of silently showing "No learners yet".
      setLoadError(e?.message ?? 'Could not load your learners.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function statusColor(s: string) {
    if (s === 'registered') return theme.colors.success;
    if (s === 'pending') return theme.colors.warning;
    if (s === 'waitlist') return theme.colors.accent;
    if (s === 'cancelled' || s === 'rejected') return theme.colors.danger;
    if (s === 'completed') return theme.colors.info;
    return theme.colors.info;
  }

  // Stat tiles derived from the loaded list.
  const total = students.length;
  const pending = students.filter((s) => s.status === 'pending').length;
  const approved = students.filter((s) => s.status === 'registered').length;
  const waitlist = students.filter((s) => s.status === 'waitlist').length;
  const cancelled = students.filter((s) => s.status === 'cancelled' || s.status === 'rejected').length;

  function patchRow(id: string, patch: Partial<StudentRow>) {
    setStudents((prev) => prev.map((s) => (s.registration_id === id ? { ...s, ...patch } : s)));
  }

  async function handleApprove(row: StudentRow) {
    try {
      setBusyId(row.registration_id);
      const res = await approveRegistration(row.registration_id);
      if (res.ok) {
        patchRow(row.registration_id, { status: (res.status as any) ?? 'registered' });
        void load(true);
        if (res.status === 'waitlist') Alert.alert('Batch is full', 'All seats are taken, so this learner stays on the waitlist.');
      } else Alert.alert('Could not approve', res.error ?? 'Please try again.');
    } catch (e: any) {
      Alert.alert('Could not approve', e?.message ?? 'Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(row: StudentRow) {
    try {
      setBusyId(row.registration_id);
      const res = await rejectRegistration(row.registration_id);
      if (res.ok) { patchRow(row.registration_id, { status: 'rejected' }); void load(true); }
      else Alert.alert('Could not reject', res.error ?? 'Please try again.');
    } catch (e: any) {
      Alert.alert('Could not reject', e?.message ?? 'Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleAttendance(row: StudentRow, status: AttendanceStatus) {
    try {
      setBusyId(row.registration_id);
      const res = await setAttendance(row.registration_id, status);
      if (res.ok) {
        const today = status === 'pending' ? null : status;
        const wasPresent = row.attendance_today === 'present';
        const days = Math.max(0, (row.attendance_days ?? 0) + (status === 'present' && !wasPresent ? 1 : 0) - (status !== 'present' && wasPresent ? 1 : 0));
        patchRow(row.registration_id, { attendance_status: status, attendance_today: today, attendance_days: days });
      } else {
        Alert.alert('Could not update attendance', res.error ?? 'Please try again.');
      }
    } catch (e: any) {
      Alert.alert('Could not update attendance', e?.message ?? 'Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flexGrow: 1, flexBasis: 200 }}>
          <Text style={styles.heading}>Enrollment Dashboard</Text>
          <Text style={styles.count}>{total} learner{total === 1 ? '' : 's'} across your courses</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable style={styles.filterToggle} onPress={() => router.push('/(provider)/attendance-scan')} accessibilityRole="button" accessibilityLabel="Scan attendance QR">
          <Ionicons name="qr-code-outline" size={16} color={theme.colors.primary} />
          <Text style={styles.filterToggleText}>Scan</Text>
        </Pressable>
        <Pressable style={styles.filterToggle} onPress={() => setShowExport(true)} accessibilityRole="button" accessibilityLabel="Export data">
          <Ionicons name="download-outline" size={16} color={theme.colors.primary} />
          <Text style={styles.filterToggleText}>Export data</Text>
        </Pressable>
        </View>
      </View>

      {/* Export popup — opens only when the partner taps "Export data". */}
      <Modal visible={showExport} animationType="slide" transparent onRequestClose={() => setShowExport(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.filterTitle}>Export learner data</Text>
                <Text style={styles.filterSub}>Choose the course, then what to include.</Text>
              </View>
              <Pressable onPress={() => setShowExport(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={24} color={theme.colors.text} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.fieldLabel}>Course</Text>
              <View style={styles.chips}>
                <Pressable
                  style={[styles.chip, !filterCourseId ? styles.chipActive : styles.chipInactive]}
                  onPress={() => setFilterCourseId('')}
                >
                  <Text style={[styles.chipText, !filterCourseId ? styles.chipTextActive : {}]}>All courses</Text>
                </Pressable>
                {courseOptions.map((c) => (
                  <Pressable
                    key={c.id}
                    style={[styles.chip, filterCourseId === c.id ? styles.chipActive : styles.chipInactive]}
                    onPress={() => setFilterCourseId(c.id)}
                  >
                    <Text style={[styles.chipText, filterCourseId === c.id ? styles.chipTextActive : {}]} numberOfLines={1}>
                      {c.title}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.detailsPanel}>
                <Text style={styles.detailsTitle}>Additional details</Text>
                <Text style={styles.detailsSub}>Learner information collected at booking time.</Text>
                {([
                  ['age', 'Age'],
                  ['location', 'Location'],
                  ['experience', 'Experience (Yes / No)'],
                  ['additional', 'Additional information'],
                ] as const).map(([key, label]) => (
                  <View key={key} style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{label}</Text>
                    <Switch
                      value={fields[key]}
                      onValueChange={(v) => setFields((f) => ({ ...f, [key]: v }))}
                      trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
                    />
                  </View>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Registration date range (optional)</Text>
              <View style={styles.dateRow}>
                <DateField compact style={{ flex: 1 }} value={filterFrom} onChange={setFilterFrom} placeholder="From" maxDate={filterTo || undefined} />
                <Text style={styles.dateDash}>→</Text>
                <DateField compact style={{ flex: 1 }} value={filterTo} onChange={setFilterTo} placeholder="To" minDate={filterFrom || undefined} />
              </View>

              <View style={styles.filterActions}>
                <Pressable onPress={() => { setFilterCourseId(''); setFilterFrom(''); setFilterTo(''); setFields(DEFAULT_EXPORT_FIELDS); }}>
                  <Text style={styles.linkText}>Reset</Text>
                </Pressable>
              </View>
              {students.length === 0 ? (
                <Text style={styles.exportHint}>No learners have registered yet. Export unlocks after the first registration.</Text>
              ) : null}
              <LearnerReportExportButtons
                disabled={students.length === 0}
                students={students}
                providerName={orgName || undefined}
                filter={{
                  course_id: filterCourseId || undefined,
                  course_title: courseOptions.find((c) => c.id === filterCourseId)?.title,
                  date_from: filterFrom.trim() || undefined,
                  date_to: filterTo.trim() || undefined,
                  fields,
                }}
              />
              <Text style={styles.exportHint}>Excel exports a real .xlsx file. On a phone the share sheet opens (save / send); in the browser it downloads directly.</Text>
              <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Attendance report (day-wise, selected course)</Text>
              <AttendanceReportButtons
                disabled={students.length === 0}
                students={students}
                providerName={orgName || undefined}
                filter={{ course_id: filterCourseId || undefined, course_title: courseOptions.find((c) => c.id === filterCourseId)?.title }}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Stat tiles */}
      <View style={styles.stats}>
        <StatTile label="Total" value={total} color={theme.colors.primary} />
        <StatTile label="Pending approval" value={pending} color={theme.colors.warning} />
        <StatTile label="Approved" value={approved} color={theme.colors.success} />
        <StatTile label="Waitlist" value={waitlist} color={theme.colors.accent} />
        <StatTile label="Cancelled" value={cancelled} color={theme.colors.danger} />
      </View>

      {loadError ? (
        <View style={styles.center}>
          <EmptyState icon="cloud-offline" title="Could not load learners" subtitle={loadError} />
          <Pressable style={styles.filterToggle} onPress={() => load()}><Text style={styles.filterToggleText}>Retry</Text></Pressable>
        </View>
      ) : students.length === 0 ? (
        <View style={styles.center}>
          <EmptyState icon="people-outline" title="No learners yet" subtitle="Learners who register for your courses will appear here." />
        </View>
      ) : (
        <FlatList
          data={students}
          keyExtractor={(item) => item.registration_id}
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} colors={[theme.colors.primary]} />}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.name} numberOfLines={1}>{item.learner_name ?? item.student_name ?? 'Unnamed learner'}</Text>
                <View style={[styles.statusPill, { backgroundColor: statusColor(item.status) + '20' }]}>
                  <Text style={[styles.statusText, { color: statusColor(item.status) }]}>
                    {item.status}
                  </Text>
                </View>
              </View>
              <Text style={styles.course} numberOfLines={1}>{item.course_title}</Text>
              {item.payment_required ? (
                <View style={styles.metaRow}>
                  <Ionicons name={item.payment_status === 'paid' || item.payment_status === 'not_required' ? 'checkmark-circle' : 'time-outline'} size={13} color={item.payment_status === 'paid' || item.payment_status === 'not_required' ? theme.colors.success : theme.colors.warning} />
                  <Text style={styles.meta}>{item.payment_status === 'paid' || item.payment_status === 'not_required' ? 'Payment received' : 'Payment pending — QR locked until paid'}</Text>
                </View>
              ) : null}
              {item.batch_name ? (
                <View style={styles.batchRow}>
                  <Ionicons name="layers-outline" size={13} color={theme.colors.primary} />
                  <Text style={styles.batchText} numberOfLines={1}>{item.batch_name}</Text>
                  {item.batch_start_date ? <Text style={styles.meta}>· {new Date(item.batch_start_date).toLocaleDateString()}</Text> : null}
                </View>
              ) : null}
              <View style={styles.metaRow}>
                <Ionicons name="call-outline" size={13} color={theme.colors.textMuted} />
                <Text style={styles.meta}>{item.learner_phone ?? item.student_phone ?? 'No phone'}</Text>
                <Text style={styles.dot}>•</Text>
                <Ionicons name="calendar-outline" size={13} color={theme.colors.textMuted} />
                <Text style={styles.meta}>{new Date(item.registered_at).toLocaleDateString()}</Text>
              </View>

              {(item.learner_age != null || item.learner_location || item.learner_experience != null || item.learner_additional_details) ? (
                <View style={styles.learnerInfo}>
                  {item.learner_age != null ? <Text style={styles.infoLine}>Age: {item.learner_age}</Text> : null}
                  {item.learner_location ? <Text style={styles.infoLine}>Location: {item.learner_location}</Text> : null}
                  {item.learner_experience != null ? <Text style={styles.infoLine}>Experience: {item.learner_experience ? 'Yes' : 'No'}</Text> : null}
                  {item.learner_additional_details ? <Text style={styles.infoLine}>Info: {item.learner_additional_details}</Text> : null}
                </View>
              ) : null}

              {/* Approve / Reject — only for pending or waitlist requests */}
              {(item.status === 'pending' || item.status === 'waitlist') ? (
                <View style={styles.actions}>
                  <Button label="Approve" variant="primary" onPress={() => handleApprove(item)} loading={busyId === item.registration_id} />
                  <Button label="Reject" variant="danger" onPress={() => handleReject(item)} loading={busyId === item.registration_id} />
                </View>
              ) : null}

              {/* Attendance — only for approved learners */}
              {item.status === 'registered' ? (
                <View style={styles.attendance}>
                  <Text style={styles.attendanceLabel}>Attendance today{(item.attendance_days ?? 0) > 0 ? ` · ${item.attendance_days} day${item.attendance_days === 1 ? '' : 's'} present` : ''}</Text>
                  <View style={styles.attendanceChips}>
                    {(['pending', 'present', 'absent'] as AttendanceStatus[]).map((a) => {
                      const todayKey: AttendanceStatus = item.attendance_today ?? 'pending';
                      const on = todayKey === a;
                      return (
                        <Pressable
                          key={a}
                          style={[styles.attChip, on ? styles.attChipOn : {}]}
                          disabled={busyId === item.registration_id}
                          onPress={() => handleAttendance(item, a)}
                        >
                          <Text style={[styles.attChipText, on ? styles.attChipTextOn : {}]}>
                            {a === 'pending' ? '—' : a === 'present' ? 'Present' : 'Absent'}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}
            </View>
          )}
        />
      )}
    </View>
  );
}

function StatTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: theme.colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 16 },
  heading: { fontSize: theme.font.heading, fontWeight: '800', color: theme.colors.text },
  count: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2 },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: theme.colors.border, ...theme.shadow.card },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  name: { fontSize: 16, fontWeight: '800', color: theme.colors.text, flex: 1, marginRight: 8 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: theme.radius.pill },
  statusText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  course: { fontSize: 14, color: theme.colors.primary, fontWeight: '600', marginBottom: 6 },
  batchRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  batchText: { fontSize: 12, color: theme.colors.primary, fontWeight: '700', maxWidth: 180 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { fontSize: 12, color: theme.colors.textMuted },
  dot: { color: theme.colors.border, fontSize: 12 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  stat: { flexBasis: '30%', flexGrow: 1, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '800' },
  statLabel: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  attendance: { marginTop: 10 },
  attendanceLabel: { fontSize: 13, color: theme.colors.textMuted, marginBottom: 6 },
  attendanceChips: { flexDirection: 'row', gap: 8 },
  attChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: theme.radius.pill, borderWidth: 1.5, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  attChipOn: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary },
  attChipText: { fontSize: 13, fontWeight: '700', color: theme.colors.textMuted, textTransform: 'capitalize' },
  attChipTextOn: { color: '#fff' },
  filterToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.pill, borderWidth: 1.5, borderColor: theme.colors.primary, backgroundColor: theme.colors.surface },
  filterToggleText: { fontSize: 14, fontWeight: '700', color: theme.colors.primary },
  filterCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, padding: 14, marginBottom: 12, ...theme.shadow.card },
  filterTitle: { fontSize: 16, fontWeight: '800', color: theme.colors.text, marginBottom: 2 },
  filterSub: { fontSize: 13, color: theme.colors.textMuted, marginBottom: 12 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalCard: { maxHeight: '90%', backgroundColor: theme.colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18 },
  modalHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  detailsPanel: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: 12, marginBottom: 14, backgroundColor: theme.colors.background },
  detailsTitle: { fontSize: 15, fontWeight: '800', color: theme.colors.text },
  detailsSub: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2, marginBottom: 6 },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  detailLabel: { fontSize: 14, color: theme.colors.text, fontWeight: '600' },
  learnerInfo: { marginTop: 8, padding: 10, borderRadius: theme.radius.md, backgroundColor: theme.colors.background, gap: 2 },
  infoLine: { fontSize: 12.5, color: theme.colors.text },
  exportHint: { fontSize: 12, color: theme.colors.textMuted, textAlign: 'center', marginTop: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: theme.colors.text, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipInactive: { backgroundColor: theme.colors.surface },
  chipText: { fontSize: 13, fontWeight: '600', color: theme.colors.textMuted, maxWidth: 180 },
  chipTextActive: { color: '#fff' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  dateInput: { flex: 1, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, backgroundColor: theme.colors.surface, color: theme.colors.text },
  dateDash: { fontSize: 18, color: theme.colors.textMuted },
  filterActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  linkText: { color: theme.colors.primary, fontSize: 14, fontWeight: '600' },
});
