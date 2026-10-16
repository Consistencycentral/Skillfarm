import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable, Alert, Linking, ScrollView, AppState } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { getMyRegistrationById, type RegistrationWithCourse } from '../../api/registrations';
import { ticketEmailUrl, ticketQrValue, ticketShareUrl } from '../../lib/ticket';
import QRCode from 'react-native-qrcode-svg';
import { ShareButton } from '../../components/ShareButton';
import { theme } from '../../constants/theme';
import { cacheJson, readCachedJson } from '../../lib/offlineCache';
import { issueAttendanceChallenge, getAttendanceSummaries } from '../../lib/attendanceSecurity';

function dateText(value?: string | null) { if (!value) return 'Date to be confirmed'; try { return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return value; } }

export default function TicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [registration, setRegistration] = useState<RegistrationWithCourse | null>(null);
  const [loading, setLoading] = useState(true);
  const [dynamicQr, setDynamicQr] = useState<string | null>(null);
  const load = useCallback(async () => { if (!id) return; setLoading(true); try { const { data } = await supabase.auth.getUser(); if (!data.user) return setRegistration(null); const fresh = await getMyRegistrationById(data.user.id, id); setRegistration(fresh); if (fresh) await cacheJson(`ticket.${id}`, fresh); } catch { const cached = await readCachedJson<RegistrationWithCourse>(`ticket.${id}`); setRegistration(cached); } finally { setLoading(false); } }, [id]);
  useEffect(() => { load(); }, [load]);
  const [qrError, setQrError] = useState<string | null>(null);
  const [shortCode, setShortCode] = useState<string | null>(null);
  const [todayStatus, setTodayStatus] = useState<'present' | 'absent' | null>(null);
  const [daysPresent, setDaysPresent] = useState(0);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const approved = registration?.status === 'registered';
  const regId = registration?.id;
  const presentToday = todayStatus === 'present';

  // Pause all polling while the app is in the background (saves battery + server calls).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => setAppActive(st === 'active'));
    return () => sub.remove();
  }, []);

  // Live QR: approved + payment settled (the server enforces both). Stops once today's attendance is marked.
  useEffect(() => {
    if (!regId || !approved || presentToday || !appActive) return;
    let alive = true;
    const refreshChallenge = async () => {
      try {
        const challenge = await issueAttendanceChallenge(regId);
        if (!alive) return;
        setDynamicQr(`${ticketQrValue(regId)}?c=${encodeURIComponent(challenge.token)}`);
        setShortCode(challenge.short_code ?? null);
        setQrError(null);
      } catch (e: any) {
        if (!alive) return;
        setDynamicQr(null);
        setShortCode(null);
        setQrError(e?.message ?? 'Could not create your QR. Check your internet connection.');
      }
    };
    refreshChallenge();
    const timer = setInterval(refreshChallenge, 10_000);
    return () => { alive = false; clearInterval(timer); };
  }, [regId, approved, presentToday, appActive]);

  // Watch for the partner scanning this ticket (per-day attendance).
  useEffect(() => {
    if (!regId || !approved || !appActive) return;
    let alive = true;
    const check = async () => {
      try {
        const map = await getAttendanceSummaries([regId]);
        const row = map.get(regId);
        if (alive && row) { setTodayStatus(row.today_status); setDaysPresent(Number(row.days_present) || 0); }
      } catch { /* offline: keep last known state */ }
    };
    check();
    const timer = setInterval(check, presentToday ? 60_000 : 5_000);
    return () => { alive = false; clearInterval(timer); };
  }, [regId, approved, appActive, presentToday]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
  if (!registration) return <View style={styles.center}><Ionicons name="ticket-outline" size={52} color={theme.colors.border} /><Text style={styles.errorTitle}>Ticket not found</Text><Text style={styles.errorText}>This ticket may belong to another account or may have been removed.</Text><Pressable style={styles.primaryBtn} onPress={() => router.replace('/(student)/my-registrations')}><Text style={styles.primaryBtnText}>Back to My Seats</Text></Pressable></View>;
  const batch = registration.batch; const seat = registration.assigned_seat_number ?? registration.preferred_seat_number; const ticketUrl = ticketShareUrl(registration.id); const qrValue = dynamicQr ?? ''; const batchLabel = `${dateText(batch?.start_date)}${batch?.end_date ? ` – ${dateText(batch.end_date)}` : ''}${batch?.timings ? ` · ${batch.timings}` : ''}`; const location = [registration.course.city, registration.course.state].filter(Boolean).join(', ') || registration.course.address || 'Training centre';
  async function emailTicket() { const url = ticketEmailUrl({ email: registration!.learner_email ?? '', courseTitle: registration!.course.title, batch: batchLabel, seat: seat ? `Seat ${seat}` : 'Waitlist', location, ticketUrl, qrValue }); try { await Linking.openURL(url); } catch { Alert.alert('Email not available', 'Please use Share ticket and choose your email app.'); } }
  return <ScrollView style={styles.container} contentContainerStyle={styles.content}>
    <View style={styles.headerRow}><View style={{flex:1}}><Text style={styles.eyebrow}>SKILLFARM</Text><Text style={styles.title}>Your training ticket</Text></View><ShareButton message={`My SkillFarm ticket for ${registration.course.title}`} url={ticketUrl} size={42} label="Share ticket" /></View>
    <View style={[styles.status, !approved && { backgroundColor: '#FFF8E1' }]}><Ionicons name={approved ? 'checkmark-circle' : 'time-outline'} size={18} color={approved ? theme.colors.success : theme.colors.warning} /><Text style={[styles.statusText, !approved && { color: theme.colors.warning }]}>{registration.status === 'registered' ? 'Seat confirmed' : registration.status === 'pending' ? 'Booking pending' : 'Waitlist'}</Text></View>
    <View style={styles.ticketCard}><Text style={styles.courseTitle}>{registration.course.title}</Text><Text style={styles.partner}>Learning Partner</Text><View style={styles.divider}/><Fact icon="calendar-outline" label="Batch" value={batchLabel}/><Fact icon="location-outline" label="Location" value={location}/><Fact icon="grid-outline" label="Seat" value={seat ? `Seat ${seat}` : 'Waitlist'}/><Fact icon="person-outline" label="Learner" value={registration.learner_name ?? 'Learner'}/>
      {registration.status === 'registered' ? (
        presentToday ? (
          <View style={styles.qrSection}>
            <Ionicons name="checkmark-circle" size={64} color={theme.colors.success} />
            <Text style={styles.qrTitle}>Attendance marked for today</Text>
            <Text style={styles.qrHint}>The Learning Partner has scanned your ticket. You are marked present{daysPresent > 1 ? ` (${daysPresent} days so far)` : ''}. Your QR returns on the next training day.</Text>
            <Text style={styles.ticketId}>Ticket ID: {registration.id.slice(0,8).toUpperCase()}</Text>
          </View>
        ) : (
          <View style={styles.qrSection}>
            <Text style={styles.qrTitle}>Scan for attendance</Text>
            <Text style={styles.qrHint}>Show this QR to your Learning Partner at the training centre. It refreshes automatically, so screenshots will not work.</Text>
            {qrValue ? <QRCode value={qrValue} size={220} backgroundColor="#fff" color="#111" quietZone={8} /> : qrError ? (
              <View style={{ alignSelf: 'stretch' }}>
                <View style={styles.pendingBox}><Ionicons name="alert-circle-outline" size={20} color={theme.colors.warning}/><Text style={styles.pendingText}>{qrError}</Text></View>
                {/payment/i.test(qrError) ? <Pressable style={[styles.primaryBtn, { marginTop: 10 }]} onPress={() => router.push(`/payment/${registration.id}`)}><Ionicons name="card-outline" size={18} color="#fff"/><Text style={styles.primaryBtnText}>Complete payment</Text></Pressable> : null}
              </View>
            ) : <ActivityIndicator style={{ marginVertical: 60 }} color={theme.colors.primary} />}
            <Text style={styles.ticketId}>Ticket ID: {registration.id.slice(0,8).toUpperCase()}</Text>
            {shortCode && qrValue ? <Text style={styles.backupCode}>Camera not working? Tell your partner this code: {shortCode.slice(0,3)} {shortCode.slice(3)}</Text> : null}
          </View>
        )
      ) : (
        <View style={styles.pendingBox}><Ionicons name="time-outline" size={20} color={theme.colors.warning}/><Text style={styles.pendingText}>{registration.status === 'pending' ? 'Waiting for the Learning Partner to approve your request. Your QR appears here as soon as they accept.' : 'Your attendance QR is available only for approved seats.'}</Text></View>
      )}
    </View>
    <View style={styles.actions}><Pressable style={styles.primaryBtn} onPress={emailTicket}><Ionicons name="mail-outline" size={18} color="#fff"/><Text style={styles.primaryBtnText}>Open email</Text></Pressable><ShareButton message={`My SkillFarm ticket for ${registration.course.title}. Seat: ${seat ? `Seat ${seat}` : 'Waitlist'}.`} url={ticketUrl} size={48} label="Share ticket with friends"/></View>
    <Text style={styles.shareHint}>Share the course link with friends before booking. Every friend who registers gets their own separate ticket and QR.</Text>
  </ScrollView>;
}
function Fact({icon,label,value}:{icon:keyof typeof Ionicons.glyphMap;label:string;value:string}){return <View style={styles.fact}><Ionicons name={icon} size={17} color={theme.colors.primary}/><Text style={styles.factLabel}>{label}</Text><Text style={styles.factValue}>{value}</Text></View>}
const styles=StyleSheet.create({container:{flex:1,backgroundColor:theme.colors.background},content:{padding:16,paddingBottom:32},center:{flex:1,alignItems:'center',justifyContent:'center',padding:24,backgroundColor:theme.colors.background},errorTitle:{marginTop:12,fontSize:20,fontWeight:'800',color:theme.colors.text},errorText:{marginTop:6,color:theme.colors.textMuted,textAlign:'center',lineHeight:19},headerRow:{flexDirection:'row',alignItems:'center',gap:12,marginBottom:14},eyebrow:{fontSize:11,letterSpacing:1.5,fontWeight:'800',color:theme.colors.primary},title:{fontSize:25,fontWeight:'900',color:theme.colors.text,marginTop:2},status:{flexDirection:'row',alignItems:'center',gap:7,padding:12,borderRadius:theme.radius.md,backgroundColor:'#E8F5E9',marginBottom:12},statusText:{color:theme.colors.success,fontWeight:'800'},ticketCard:{backgroundColor:theme.colors.surface,borderRadius:22,padding:18,borderWidth:1,borderColor:theme.colors.border},courseTitle:{fontSize:21,fontWeight:'900',color:theme.colors.text},partner:{fontSize:13,color:theme.colors.textMuted,marginTop:4},divider:{height:1,backgroundColor:theme.colors.border,marginVertical:14},fact:{flexDirection:'row',alignItems:'flex-start',gap:9,marginVertical:7},factLabel:{width:65,fontSize:12,color:theme.colors.textMuted},factValue:{flex:1,fontSize:13,fontWeight:'700',color:theme.colors.text},qrSection:{alignItems:'center',marginTop:14,paddingTop:14,borderTopWidth:1,borderTopColor:theme.colors.border},qrTitle:{fontSize:16,fontWeight:'900',color:theme.colors.text},qrHint:{fontSize:12,color:theme.colors.textMuted,textAlign:'center',marginTop:4,lineHeight:17},qr:{width:220,height:220,marginTop:12,backgroundColor:'#fff'},backupCode:{fontSize:12,fontWeight:'800',color:theme.colors.text,marginTop:10,textAlign:'center'},ticketId:{fontSize:11,color:theme.colors.textMuted,marginTop:4,letterSpacing:1},pendingBox:{flexDirection:'row',gap:8,padding:12,borderRadius:theme.radius.md,backgroundColor:'#FFF8E1',marginTop:12},pendingText:{flex:1,fontSize:12,color:theme.colors.text,lineHeight:17},actions:{flexDirection:'row',alignItems:'center',gap:10,marginTop:14},primaryBtn:{flex:1,minHeight:48,paddingHorizontal:16,borderRadius:theme.radius.md,backgroundColor:theme.colors.primary,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:7},primaryBtnText:{color:'#fff',fontWeight:'800'},shareHint:{fontSize:12,lineHeight:18,color:theme.colors.textMuted,textAlign:'center',marginTop:10}});
