import { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { listMyNotifications, type SkillFarmNotification } from '../../api/notifications';
import { EmptyState } from '../../components/EmptyState';
import { useSession } from '../../lib/session';
import { theme } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import { markUpdatesSeen } from '../../lib/updatesSeen';

export default function NotificationsScreen() {
  const router = useRouter();
  const { session } = useSession();
  const [items, setItems] = useState<SkillFarmNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [live, setLive] = useState(true);
  const load = useCallback(async (refresh = false) => {
    if (!session?.user?.id) return;
    if (!refresh) setLoading(true); else setRefreshing(true);
    try { const list = await listMyNotifications(session.user.id); setItems(list); void markUpdatesSeen(session.user.id, list.map((n) => n.id)); } finally { setLoading(false); setRefreshing(false); }
  }, [session?.user?.id]);
  useFocusEffect(useCallback(() => {
    load();
    if (!session?.user?.id) return;
    const channel = supabase.channel(`student-notifications-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${session.user.id}` }, () => load(true))
      .subscribe();
    const timer = setInterval(() => load(true), 60000);
    return () => { clearInterval(timer); void supabase.removeChannel(channel); };
  }, [load, session?.user?.id]));
  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[theme.colors.primary]} />}
      ListHeaderComponent={<View style={styles.header}><Text style={styles.title}>Updates</Text><View style={styles.liveRow}><Text style={styles.subtitle}>Your latest booking, payment and batch updates.</Text><View style={styles.livePill}><View style={styles.liveDot}/><Text style={styles.liveText}>LIVE</Text></View></View></View>}
      ListEmptyComponent={<EmptyState icon="notifications-outline" title="You’re all caught up" subtitle="Registration updates will appear here." />}
      renderItem={({ item }) => (
        <Pressable style={styles.card} onPress={() => (item.id.endsWith('-approved') || item.id.endsWith('-upcoming') ? router.push(`/ticket/${item.registrationId}` as any) : router.push({ pathname: '/(student)/my-registrations' }))} accessibilityRole="button">
          <View style={[styles.icon, item.tone === 'success' && styles.success, item.tone === 'warning' && styles.warning]}>
            <Ionicons name={item.tone === 'success' ? 'checkmark' : item.tone === 'warning' ? 'time-outline' : 'information-outline'} size={18} color={theme.colors.primary} />
          </View>
          <View style={styles.body}><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardBody}>{item.body}</Text></View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
        </Pressable>
      )}
    />
  );
}
const styles=StyleSheet.create({content:{padding:16,paddingBottom:32,backgroundColor:theme.colors.background},header:{paddingVertical:8,marginBottom:10},title:{fontSize:28,fontWeight:'800',color:theme.colors.text},subtitle:{fontSize:13,lineHeight:19,color:theme.colors.textMuted,marginTop:4},card:{flexDirection:'row',alignItems:'center',gap:12,padding:14,marginBottom:10,borderRadius:theme.radius.md,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.surface},icon:{width:38,height:38,borderRadius:19,alignItems:'center',justifyContent:'center',backgroundColor:theme.colors.primary+'15'},success:{backgroundColor:theme.colors.success+'18'},warning:{backgroundColor:theme.colors.warning+'18'},body:{flex:1},cardTitle:{fontSize:14,fontWeight:'800',color:theme.colors.text},cardBody:{fontSize:12,lineHeight:18,color:theme.colors.textMuted,marginTop:3},center:{flex:1,alignItems:'center',justifyContent:'center'},liveRow:{flexDirection:'row',alignItems:'center',gap:8},livePill:{flexDirection:'row',alignItems:'center',gap:5,paddingHorizontal:8,paddingVertical:4,borderRadius:12,backgroundColor:theme.colors.success+'15'},liveDot:{width:7,height:7,borderRadius:4,backgroundColor:theme.colors.success},liveText:{fontSize:10,fontWeight:'900',color:theme.colors.success}});
