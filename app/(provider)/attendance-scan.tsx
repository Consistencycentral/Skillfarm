import { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, TextInput, KeyboardAvoidingView, ScrollView } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { markAttendanceByToken, markAttendanceByCode, tokenFromQr, type AttendanceScanResult } from '../../lib/attendanceSecurity';
import { supabase } from '../../lib/supabase';
import { listAllBatchesForCourses } from '../../api/batches';
import { theme } from '../../constants/theme';

type BatchChip = { id: string; label: string; start: string | null; end: string | null };

function todayLocal() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

type Feedback = { kind: 'success' | 'error'; title: string; lines: string[] };

export default function AttendanceScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [count, setCount] = useState(0);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState('');
  const [batches, setBatches] = useState<BatchChip[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const lock = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Optional batch filter: only learners of the selected batch can be marked.
  const loadBatches = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const { data: courses } = await supabase.from('courses').select('id, title').eq('provider_id', data.user.id);
      const titleById = new Map<string, string>((courses ?? []).map((c: any) => [c.id as string, c.title as string]));
      const rows = await listAllBatchesForCourses(Array.from(titleById.keys()));
      const today = todayLocal();
      const chips: BatchChip[] = rows
        .filter((b) => !b.end_date || b.end_date >= today)
        .map((b) => ({ id: b.id, label: `${titleById.get(b.course_id) ?? 'Course'} · ${b.name}`, start: b.start_date, end: b.end_date }));
      setBatches(chips);
      // If exactly one batch is running today, select it automatically.
      const running = chips.filter((b) => (!b.start || b.start <= today) && (!b.end || b.end >= today));
      setBatchId((cur) => (cur && chips.some((b) => b.id === cur) ? cur : running.length === 1 ? running[0].id : null));
    } catch { /* filter is optional; scanning still works without it */ }
  }, []);

  // Camera only runs while this screen is focused (tabs keep screens mounted).
  useFocusEffect(useCallback(() => {
    setActive(true);
    void loadBatches();
    return () => { setActive(false); if (resumeTimer.current) clearTimeout(resumeTimer.current); lock.current = false; setFeedback(null); setBusy(false); };
  }, [loadBatches]));

  function resume(delay: number) {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => { setFeedback(null); lock.current = false; setBusy(false); }, delay);
  }

  async function run(call: () => Promise<AttendanceScanResult>) {
    try {
      const res = await call();
      if (res.ok) {
        const seat = res.seat ? `Seat ${res.seat}` : 'No seat number';
        setCount((c) => c + (res.already_present ? 0 : 1));
        setFeedback({
          kind: 'success',
          title: res.already_present ? 'Already marked present today' : 'Attendance marked',
          lines: [res.learner_name ?? 'Learner', `${seat}${res.course_title ? ' · ' + res.course_title : ''}`, ...(res.batch_name ? [res.batch_name] : []), ...(res.days_present && res.days_present > 1 ? [`${res.days_present} days present`] : [])],
        });
        setCode('');
        setManual(false);
        resume(2200);
      } else {
        setFeedback({ kind: 'error', title: 'Could not mark attendance', lines: [res.error ?? 'Please try again.'] });
        resume(3200);
      }
    } catch (e: any) {
      setFeedback({ kind: 'error', title: 'Could not mark attendance', lines: [e?.message ?? 'Check your internet connection and try again.'] });
      resume(3200);
    }
  }

  async function handleScan(value: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    const token = tokenFromQr(value);
    if (!token) {
      setFeedback({ kind: 'error', title: 'Not a valid ticket QR', lines: ['Ask the learner to open their SkillFarm ticket and show the live QR (screenshots do not work).'] });
      resume(2500);
      return;
    }
    await run(() => markAttendanceByToken(token, batchId));
  }

  async function submitCode() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    await run(() => markAttendanceByCode(code, batchId));
  }

  if (!permission) return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;

  if (!permission.granted) {
    const blocked = permission.canAskAgain === false;
    return (
      <View style={styles.center}>
        <Ionicons name="camera-outline" size={52} color={theme.colors.primary} />
        <Text style={styles.title}>Scan attendance QR</Text>
        <Text style={styles.text}>
          {blocked
            ? 'Camera access is blocked. Enable it for SkillFarm in your phone Settings, then come back.'
            : 'Allow camera access to mark learners present from their live SkillFarm ticket QR.'}
        </Text>
        {!blocked || Platform.OS === 'web' ? <Pressable style={styles.button} onPress={requestPermission}><Text style={styles.buttonText}>Allow camera</Text></Pressable> : null}
        <Pressable onPress={() => router.replace('/(provider)/home')}><Text style={styles.back}>Back</Text></Pressable>
      </View>
    );
  }

  const bg = feedback?.kind === 'success' ? 'rgba(46,125,50,.92)' : 'rgba(198,40,40,.92)';
  return (
    <View style={styles.container}>
      {active ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={busy || manual ? undefined : ({ data }) => handleScan(data)}
        />
      ) : null}
      <View style={styles.overlay} pointerEvents="box-none">
        <View>
        <View style={styles.top}>
          <Pressable onPress={() => router.replace('/(provider)/home')} style={styles.close} accessibilityLabel="Close scanner"><Ionicons name="close" size={24} color="#fff" /></Pressable>
          <Text style={styles.header}>Scan learner QR</Text>
          <View style={styles.counter}><Text style={styles.counterText}>{count} marked</Text></View>
        </View>
        {batches.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
            <Pressable onPress={() => setBatchId(null)} style={[styles.chip, batchId === null && styles.chipOn]}><Text style={[styles.chipText, batchId === null && styles.chipTextOn]}>All batches</Text></Pressable>
            {batches.map((b) => (
              <Pressable key={b.id} onPress={() => setBatchId(b.id)} style={[styles.chip, batchId === b.id && styles.chipOn]}>
                <Text style={[styles.chipText, batchId === b.id && styles.chipTextOn]} numberOfLines={1}>{b.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        </View>
        <View style={styles.frame}>
          <View style={styles.corner} />
          <View style={[styles.corner, { right: 0, left: undefined, transform: [{ rotate: '90deg' }] }]} />
          <View style={[styles.corner, { bottom: 0, top: undefined, transform: [{ rotate: '-90deg' }] }]} />
          <View style={[styles.corner, { right: 0, bottom: 0, left: undefined, top: undefined, transform: [{ rotate: '180deg' }] }]} />
        </View>
        <View style={styles.bottom}>
          {feedback ? (
            <View style={[styles.feedback, { backgroundColor: bg }]}>
              <Ionicons name={feedback.kind === 'success' ? 'checkmark-circle' : 'alert-circle'} size={34} color="#fff" />
              <Text style={styles.fbTitle}>{feedback.title}</Text>
              {feedback.lines.map((l, i) => <Text key={i} style={styles.fbLine}>{l}</Text>)}
            </View>
          ) : manual ? (
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.manualBox}>
              <Text style={styles.manualLabel}>Enter the 6-digit code from the learner’s ticket</Text>
              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
                placeholder="000000"
                placeholderTextColor="#9AA"
                style={styles.manualInput}
                autoFocus
              />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable style={[styles.button, { flex: 1, backgroundColor: 'rgba(255,255,255,.2)' }]} onPress={() => { setManual(false); setCode(''); }}><Text style={styles.buttonText}>Use camera</Text></Pressable>
                <Pressable style={[styles.button, { flex: 1, opacity: code.length === 6 && !busy ? 1 : 0.5 }]} disabled={code.length !== 6 || busy} onPress={submitCode}><Text style={styles.buttonText}>{busy ? 'Checking…' : 'Mark present'}</Text></Pressable>
              </View>
            </KeyboardAvoidingView>
          ) : (
            <View style={{ alignItems: 'center', gap: 10 }}>
              <Text style={styles.bottomText}>{busy ? 'Checking ticket…' : 'Place the learner’s live QR inside the frame'}</Text>
              <Pressable onPress={() => setManual(true)}><Text style={styles.manualLink}>Camera not scanning? Enter code</Text></Pressable>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: theme.colors.background },
  title: { fontSize: 23, fontWeight: '900', color: theme.colors.text, marginTop: 14 },
  text: { fontSize: 14, lineHeight: 20, color: theme.colors.textMuted, textAlign: 'center', marginTop: 6, marginBottom: 18 },
  button: { backgroundColor: theme.colors.primary, paddingHorizontal: 22, paddingVertical: 13, borderRadius: theme.radius.md },
  buttonText: { color: '#fff', fontWeight: '800' },
  back: { marginTop: 16, color: theme.colors.primary, fontWeight: '700' },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between', padding: 20 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  close: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,.45)', alignItems: 'center', justifyContent: 'center' },
  header: { flex: 1, fontSize: 18, fontWeight: '800', color: '#fff' },
  counter: { backgroundColor: 'rgba(0,0,0,.5)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  counterText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  frame: { width: 270, height: 270, alignSelf: 'center', position: 'relative' },
  corner: { position: 'absolute', left: 0, top: 0, width: 48, height: 48, borderLeftWidth: 4, borderTopWidth: 4, borderColor: '#fff', borderRadius: 4 },
  bottom: { alignItems: 'center', paddingBottom: 24, minHeight: 140, justifyContent: 'flex-end' },
  bottomText: { color: '#fff', fontSize: 14, fontWeight: '700', backgroundColor: 'rgba(0,0,0,.5)', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: 'rgba(0,0,0,.5)', maxWidth: 240 },
  chipOn: { backgroundColor: '#fff' },
  chipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  chipTextOn: { color: '#111' },
  manualBox: { alignSelf: 'stretch', backgroundColor: 'rgba(0,0,0,.72)', borderRadius: 18, padding: 16, gap: 12 },
  manualLabel: { color: '#fff', fontWeight: '700', fontSize: 13, textAlign: 'center' },
  manualInput: { backgroundColor: '#fff', borderRadius: 12, fontSize: 28, letterSpacing: 8, fontWeight: '900', textAlign: 'center', paddingVertical: 10, color: '#111' },
  manualLink: { color: '#fff', fontWeight: '800', textDecorationLine: 'underline', fontSize: 13 },
  feedback: { alignSelf: 'stretch', borderRadius: 18, padding: 16, alignItems: 'center', gap: 4 },
  fbTitle: { color: '#fff', fontSize: 18, fontWeight: '900' },
  fbLine: { color: '#fff', fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
