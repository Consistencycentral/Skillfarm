import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { unregisterPush } from '../lib/pushNotifications';
import { useSession } from '../lib/session';
import { theme } from '../constants/theme';
import { Alert } from '../lib/alert';
import { BrandMark, IconBadge } from '../components/ui';
import { FadeInView, PressableScale } from '../components/motion';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../lib/i18n';

type Role = 'student' | 'provider';

export default function RoleSelectScreen() {
  const [saving, setSaving] = useState(false);
  const [chosen, setChosen] = useState<Role | null>(null);
  const { refresh, role } = useSession();
  const { t } = useLanguage();

  useEffect(() => {
    if (!chosen || role !== chosen) return;
    router.replace(chosen === 'student' ? '/(student)/browse' : '/(provider)/home');
  }, [chosen, role]);

  async function chooseRole(picked: Role) {
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { setSaving(false); router.replace('/login'); return; }
      let { error } = await supabase.from('profiles').upsert({ id: u.user.id, role: picked, onboarding_complete: true }, { onConflict: 'id' });
      if (error && /onboarding_complete|schema cache|column/i.test(error.message ?? '')) {
        const fallback = await supabase.from('profiles').upsert({ id: u.user.id, role: picked }, { onConflict: 'id' });
        error = fallback.error;
      }
      if (error) throw error;
      await refresh();
      setChosen(picked);
    } catch (e: any) {
      Alert.alert(t.languageErrorTitle, e?.message ?? t.tryAgain);
      setSaving(false);
    }
  }

  if (saving) return <View style={styles.loading}><ActivityIndicator size="large" color={theme.colors.primary} /><Text style={styles.loadingText}>{t.continue}…</Text></View>;

  const learnerBullets = [t.browseSectorCity, t.requestTrack, t.directionsRate];
  const providerBullets = [t.publishCourses, t.manageRequests, t.exportReport];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}><BrandMark size="sm" /><Text style={styles.kicker}>{t.welcome.toUpperCase()}</Text><Text style={styles.title}>{t.roleTitle}</Text><Text style={styles.subtitle}>{t.roleSubtitle}</Text></View>
      <FadeInView delay={60}><RoleCard icon="school" title={t.learner} description={t.learnerText} bullets={learnerBullets} onPress={() => chooseRole('student')} /></FadeInView>
      <FadeInView delay={140}><RoleCard icon="business" title={t.provider} description={t.providerText} bullets={providerBullets} onPress={() => chooseRole('provider')} /></FadeInView>
      <Pressable style={styles.signOut} onPress={async () => { await unregisterPush().catch(() => {}); await supabase.auth.signOut(); router.replace('/login'); }}><Text style={styles.signOutText}>{t.signOut}</Text></Pressable>
    </ScrollView>
  );
}

function RoleCard({ icon, title, description, bullets, onPress }: { icon: keyof typeof Ionicons.glyphMap; title:string; description:string; bullets:string[]; onPress:()=>void }) {
  return <PressableScale scaleTo={0.985} haptic style={styles.card} onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
    <View style={styles.cardTop}>
      <IconBadge name={icon} size={52} />
      <View style={styles.arrow}><Ionicons name="arrow-forward" size={18} color={theme.colors.primary} /></View>
    </View>
    <Text style={styles.cardTitle}>{title}</Text>
    <Text style={styles.cardText}>{description}</Text>
    <View style={styles.divider}/>
    {bullets.map((line,i)=><View key={i} style={styles.bulletRow}><Ionicons name="checkmark-circle" size={17} color={theme.colors.success} style={{marginTop:1}} /><Text style={styles.bulletText}>{line}</Text></View>)}
  </PressableScale>;
}

const styles=StyleSheet.create({
  screen:{flex:1,backgroundColor:theme.colors.background}, container:{padding:20,paddingBottom:40,maxWidth:560,width:'100%',alignSelf:'center'},
  loading:{flex:1,backgroundColor:theme.colors.background,alignItems:'center',justifyContent:'center'}, loadingText:{marginTop:12,color:theme.colors.textMuted,fontSize:14,fontWeight:'600'},
  header:{paddingTop:24,paddingBottom:22}, kicker:{...theme.type.overline,color:theme.colors.primary,marginTop:26,marginBottom:6}, title:{...theme.type.display,color:theme.colors.text}, subtitle:{...theme.type.body,color:theme.colors.textMuted,marginTop:8,maxWidth:560},
  card:{backgroundColor:theme.colors.surface,borderRadius:theme.radius.xl+2,padding:20,marginBottom:14,borderWidth:1,borderColor:theme.colors.border,...theme.shadow.card},
  cardTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}, arrow:{width:36,height:36,borderRadius:18,backgroundColor:theme.colors.primaryTint,alignItems:'center',justifyContent:'center'},
  cardTitle:{...theme.type.h1,color:theme.colors.text,marginTop:16}, cardText:{...theme.type.body,color:theme.colors.textMuted,marginTop:4}, divider:{height:1,backgroundColor:theme.colors.border,marginVertical:16},
  bulletRow:{flexDirection:'row',alignItems:'flex-start',gap:10,marginTop:8}, bulletText:{flex:1,...theme.type.small,fontSize:14,lineHeight:20,color:theme.colors.text},
  signOut:{alignItems:'center',paddingVertical:16,marginTop:6}, signOutText:{fontSize:14,fontWeight:'700',color:theme.colors.danger},
});
