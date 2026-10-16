// ===========================================================================
// Deep-link target for the ticket QR (`/attendance/<registrationId>?c=<token>`).
// Reached when someone scans the learner QR with a normal phone camera, or taps
// a shared link, instead of using the in-app scanner.
//   * signed out  -> login
//   * learner     -> their ticket
//   * partner     -> marks attendance right away (same server check as the scanner)
// ===========================================================================
import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '../../lib/session';
import { markAttendanceByToken, type AttendanceScanResult } from '../../lib/attendanceSecurity';
import { theme } from '../../constants/theme';

export default function AttendanceLink() {
  const { id, c } = useLocalSearchParams<{ id: string; c?: string }>();
  const { session, role, loading } = useSession();
  const [result, setResult] = useState<AttendanceScanResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (loading || !session || role !== 'provider' || !c || started.current) return;
    started.current = true;
    markAttendanceByToken(String(c))
      .then(setResult)
      .catch((e: any) => setFailure(e?.message ?? 'Could not mark attendance. Check your connection.'));
  }, [loading, session, role, c]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
  if (!session) return <Redirect href="/login" />;
  if (role === 'student') return <Redirect href={`/ticket/${id}` as any} />;
  if (role !== 'provider') return <Redirect href="/" />;
  if (!c) return <Redirect href="/(provider)/attendance-scan" />;

  if (!result && !failure) return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /><Text style={styles.text}>Checking ticket…</Text></View>;

  const ok = !!result?.ok;
  const message = ok
    ? `${result?.learner_name ?? 'Learner'} · ${result?.seat ? `Seat ${result.seat}` : 'No seat number'}${result?.course_title ? `\n${result.course_title}` : ''}`
    : (result?.error ?? failure ?? 'Please try again.');
  return (
    <View style={styles.center}>
      <Ionicons name={ok ? 'checkmark-circle' : 'alert-circle'} size={72} color={ok ? theme.colors.success : '#C62828'} />
      <Text style={styles.title}>{ok ? (result?.already_present ? 'Already marked present today' : 'Attendance marked') : 'Could not mark attendance'}</Text>
      <Text style={styles.text}>{message}</Text>
      <Pressable style={styles.button} onPress={() => router.replace('/(provider)/attendance-scan')}><Text style={styles.buttonText}>Scan next</Text></Pressable>
      <Pressable onPress={() => router.replace('/(provider)/home')}><Text style={styles.back}>Done</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: theme.colors.background },
  title: { fontSize: 22, fontWeight: '900', color: theme.colors.text, marginTop: 14, textAlign: 'center' },
  text: { fontSize: 14, lineHeight: 20, color: theme.colors.textMuted, textAlign: 'center', marginTop: 8, marginBottom: 20 },
  button: { backgroundColor: theme.colors.primary, paddingHorizontal: 24, paddingVertical: 13, borderRadius: theme.radius.md },
  buttonText: { color: '#fff', fontWeight: '800' },
  back: { marginTop: 16, color: theme.colors.primary, fontWeight: '700' },
});
