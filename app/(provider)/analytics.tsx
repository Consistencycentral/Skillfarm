import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Pressable } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { listMyCourses, type Course } from '../../api/courses';
import { listMyStudents } from '../../api/registrations';
import { listAllBatchesForCourses, type Batch } from '../../api/batches';
import { supabase } from '../../lib/supabase';
import { theme } from '../../constants/theme';

export default function ProviderAnalyticsScreen() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (refresh = false) => {
    if (!refresh) setLoading(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const coursesData = await listMyCourses(data.user.id);
      const [studentsData, allBatches] = await Promise.all([
        listMyStudents(data.user.id),
        listAllBatchesForCourses(coursesData.map((c) => c.id)),
      ]);
      setCourses(coursesData);
      setStudents(studentsData);
      setBatches(allBatches);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load analytics.');
    } finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const registered = students.filter(s => s.status === 'registered' || s.status === 'completed').length;
  const completed = students.filter(s => s.status === 'completed').length;
  const pending = students.filter(s => s.status === 'pending').length;
  const attended = students.filter(s => s.attendance_status === 'present').length;
  const capacity = batches.reduce((n, b) => n + Math.max(0, b.seats_total || 0), 0);
  const filled = batches.reduce((n, b) => n + Math.max(0, b.seats_filled || 0), 0);
  const fillPct = capacity ? Math.round((filled / capacity) * 100) : 0;
  const attendancePct = registered ? Math.round((attended / registered) * 100) : 0;
  const completionPct = registered ? Math.round((completed / registered) * 100) : 0;
  if (loading && !refreshing) return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
  if (error) return <View style={styles.center}><Text style={styles.empty}>{error}</Text><Pressable style={styles.retry} onPress={() => load()}><Text style={styles.retryText}>Retry</Text></Pressable></View>;
  return <ScrollView style={styles.container} contentContainerStyle={{paddingBottom:28}} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => {setRefreshing(true); load(true)}} colors={[theme.colors.primary]} />}>
    <View style={styles.top}><View><Text style={styles.heading}>Analytics</Text><Text style={styles.sub}>See how your training programmes are performing.</Text></View><Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close circle"><Ionicons name="close-circle-outline" size={25} color={theme.colors.textMuted}/></Pressable></View>
    <View style={styles.hero}><Text style={styles.heroLabel}>Seat fill rate</Text><Text style={styles.heroValue}>{fillPct}%</Text><View style={styles.track}><View style={[styles.fill,{width:`${Math.min(100,fillPct)}%`}]} /></View><Text style={styles.heroSub}>{filled} filled of {capacity || 0} published seats</Text></View>
    <View style={styles.grid}>
      <Metric icon="people-outline" value={registered} label="Registered" />
      <Metric icon="time-outline" value={pending} label="Pending" />
      <Metric icon="checkmark-circle-outline" value={`${attendancePct}%`} label="Attendance" />
      <Metric icon="ribbon-outline" value={`${completionPct}%`} label="Completion" />
    </View>
    <Text style={styles.section}>Course performance</Text>
    {batches.map(b => { const pct = b.seats_total ? Math.round((b.seats_filled / b.seats_total) * 100) : 0; return <View key={b.id} style={styles.course}><View style={{flex:1}}><Text style={styles.courseTitle}>{b.name}</Text><Text style={styles.courseMeta}>{b.seats_filled}/{b.seats_total} seats filled · {pct}%</Text></View><View style={styles.smallTrack}><View style={[styles.smallFill,{width:`${Math.min(100,pct)}%`}]} /></View></View>})}
    {batches.length === 0 ? <Text style={styles.empty}>Add a batch to start seeing performance data.</Text> : null}
  </ScrollView>;
}
function Metric({icon,value,label}:{icon:keyof typeof Ionicons.glyphMap;value:string|number;label:string}) { return <View style={styles.metric}><Ionicons name={icon} size={21} color={theme.colors.primary}/><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View> }
const styles=StyleSheet.create({container:{flex:1,backgroundColor:theme.colors.background,padding:16},center:{flex:1,justifyContent:'center',alignItems:'center'},top:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16},heading:{fontSize:theme.font.heading,fontWeight:'900',color:theme.colors.text},sub:{fontSize:13,color:theme.colors.textMuted,marginTop:3},hero:{backgroundColor:theme.colors.primary,borderRadius:theme.radius.lg,padding:18,marginBottom:12},heroLabel:{fontSize:13,color:'#fff',opacity:.9},heroValue:{fontSize:38,fontWeight:'900',color:'#fff',marginTop:2},track:{height:8,borderRadius:8,backgroundColor:'rgba(255,255,255,.3)',overflow:'hidden',marginTop:10},fill:{height:8,borderRadius:8,backgroundColor:'#fff'},heroSub:{fontSize:12,color:'#fff',opacity:.9,marginTop:8},grid:{flexDirection:'row',flexWrap:'wrap',gap:10,marginBottom:18},metric:{width:'48%',backgroundColor:theme.colors.surface,borderRadius:theme.radius.lg,padding:15,borderWidth:1,borderColor:theme.colors.border},metricValue:{fontSize:24,fontWeight:'900',color:theme.colors.text,marginTop:7},metricLabel:{fontSize:12,color:theme.colors.textMuted,marginTop:2},section:{fontSize:18,fontWeight:'900',color:theme.colors.text,marginBottom:10},course:{backgroundColor:theme.colors.surface,borderRadius:theme.radius.lg,padding:14,borderWidth:1,borderColor:theme.colors.border,marginBottom:10},courseTitle:{fontSize:15,fontWeight:'800',color:theme.colors.text},courseMeta:{fontSize:12,color:theme.colors.textMuted,marginTop:3},smallTrack:{height:7,borderRadius:7,backgroundColor:theme.colors.background,overflow:'hidden',marginTop:10},smallFill:{height:7,borderRadius:7,backgroundColor:theme.colors.primary},empty:{fontSize:14,color:theme.colors.textMuted,paddingVertical:12},retry:{marginTop:12,paddingHorizontal:18,paddingVertical:10,borderRadius:theme.radius.md,backgroundColor:theme.colors.primary},retryText:{color:'#fff',fontWeight:'800'}});
