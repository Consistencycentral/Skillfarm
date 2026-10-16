import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../constants/theme';
import type { RegistrationStatus } from '../api/registrations';

export function RegistrationTimeline({ status }: { status: RegistrationStatus }) {
  const terminal = status === 'rejected' || status === 'cancelled';
  const steps = [
    { key: 'booked', label: 'Seat booked', done: ['registered', 'completed', 'pending', 'waitlist'].includes(status) },
    { key: 'confirmed', label: 'Confirmed', done: ['registered', 'completed'].includes(status) },
    { key: 'attending', label: status === 'completed' ? 'Completed' : 'Attending', done: status === 'completed' },
      ];
  if (terminal) {
    return <View style={styles.terminal}><Ionicons name={status === 'rejected' ? 'ban-outline' : 'close-circle-outline'} size={16} color={status === 'rejected' ? theme.colors.danger : theme.colors.textMuted} /><Text style={[styles.terminalText, { color: status === 'rejected' ? theme.colors.danger : theme.colors.textMuted }]}>{status === 'rejected' ? 'Booking rejected' : 'Booking cancelled'}</Text></View>;
  }
  if (status === 'waitlist') {
    return <View style={styles.terminal}><Ionicons name="hourglass-outline" size={16} color={theme.colors.warning} /><Text style={[styles.terminalText, { color: theme.colors.warning }]}>On the waitlist — you’ll be notified if a seat opens.</Text></View>;
  }
  return <View style={styles.timeline}>{steps.map((step, i) => <View key={step.key} style={styles.step}><View style={styles.marker}><Ionicons name={step.done ? 'checkmark' : 'ellipse-outline'} size={13} color={step.done ? theme.colors.primary : theme.colors.border} /></View>{i < steps.length - 1 ? <View style={[styles.line, step.done && styles.lineDone]} /> : null}<Text style={[styles.label, step.done && styles.labelDone]}>{step.label}</Text></View>)}</View>;
}

const styles = StyleSheet.create({ timeline: { marginTop: 12, paddingVertical: 2 }, step: { minHeight: 32, flexDirection: 'row', alignItems: 'center', position: 'relative' }, marker: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface, zIndex: 2 }, line: { position: 'absolute', left: 10, top: 22, bottom: -2, width: 1, backgroundColor: theme.colors.border }, lineDone: { backgroundColor: theme.colors.primary }, label: { marginLeft: 9, fontSize: 12, color: theme.colors.textMuted }, labelDone: { color: theme.colors.text, fontWeight: '600' }, terminal: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12, padding: 10, borderRadius: theme.radius.md, backgroundColor: theme.colors.background }, terminalText: { flex: 1, fontSize: 12, fontWeight: '600' } });
