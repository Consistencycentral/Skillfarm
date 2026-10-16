import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from './Button';
import type { StudentRow } from '../api/registrations';
import type { ExportFilter } from '../lib/export';
import { exportLearnerReportAsExcel, exportLearnerReportAsPdf, exportAttendanceReport } from '../lib/export';
import { getAttendanceReport } from '../lib/attendanceSecurity';
import { theme } from '../constants/theme';
import { Alert } from '../lib/alert';

type Props = {
  students: StudentRow[];
  providerName?: string;
  filter?: ExportFilter;
  /** true while there is nothing to export (e.g. no learners registered yet) */
  disabled?: boolean;
};

export function LearnerReportExportButtons({ students, providerName, filter = {}, disabled = false }: Props) {
  const [busy, setBusy] = useState<'pdf' | 'excel' | null>(null);
  async function run(kind: 'pdf' | 'excel') {
    if (!students.length) {
      Alert.alert('Nothing to export', 'No learners have registered yet.');
      return;
    }
    try {
      setBusy(kind);
      if (kind === 'pdf') await exportLearnerReportAsPdf(students, providerName, filter);
      else await exportLearnerReportAsExcel(students, providerName, filter);
    } catch (e: any) {
      Alert.alert(`Could not export ${kind === 'pdf' ? 'PDF' : 'Excel'}`, e?.message ?? 'Please try again.');
    } finally {
      setBusy(null);
    }
  }
  return (
    <View style={styles.row}>
      <View style={styles.item}><Button label="Export PDF" onPress={() => run('pdf')} loading={busy === 'pdf'} disabled={disabled} /></View>
      <View style={styles.item}><Button label="Export Excel" variant="outline" onPress={() => run('excel')} loading={busy === 'excel'} disabled={disabled} /></View>
    </View>
  );
}

/** Day-wise attendance report (present/absent per training day) for the selected course. */
export function AttendanceReportButtons({ students, providerName, filter = {}, disabled = false }: Props) {
  const [busy, setBusy] = useState<'pdf' | 'excel' | null>(null);
  async function run(kind: 'pdf' | 'excel') {
    try {
      setBusy(kind);
      const logs = await getAttendanceReport({ courseId: filter.course_id });
      await exportAttendanceReport(kind, students, logs, providerName, filter);
    } catch (e: any) {
      Alert.alert('Could not export attendance', e?.message ?? 'Please try again.');
    } finally {
      setBusy(null);
    }
  }
  return (
    <View style={styles.row}>
      <View style={styles.item}><Button label="Attendance PDF" onPress={() => run('pdf')} loading={busy === 'pdf'} disabled={disabled} /></View>
      <View style={styles.item}><Button label="Attendance Excel" variant="outline" onPress={() => run('excel')} loading={busy === 'excel'} disabled={disabled} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, marginTop: 8 },
  item: { flex: 1 },
});
