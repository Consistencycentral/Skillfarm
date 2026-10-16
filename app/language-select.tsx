import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { theme } from '../constants/theme';
import { LANGUAGE_OPTIONS, type Lang } from '../lib/i18n';
import { getPreferredLanguageLocal } from '../lib/localPreferences';
import { useSession } from '../lib/session';
import { useLanguage } from '../lib/i18n';
import { Button } from '../components/Button';
import { Ionicons } from '@expo/vector-icons';

export default function LanguageSelectScreen() {
  const params = useLocalSearchParams<{ next?: string }>();
  const returnToProfile = params.next === 'profile';
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Lang>('en');
  const [loadingCurrent, setLoadingCurrent] = useState(true);
  const [saving, setSaving] = useState(false);
  const { refresh, role } = useSession();
  const { setLanguage, t } = useLanguage();
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return LANGUAGE_OPTIONS;
    return LANGUAGE_OPTIONS.filter(x => x.englishName.toLowerCase().includes(q) || x.nativeName.toLowerCase().includes(q));
  }, [query]);

  useEffect(() => {
    let alive = true;
    getPreferredLanguageLocal().then(lang => {
      if (alive && lang) setSelected(lang);
    }).finally(() => { if (alive) setLoadingCurrent(false); });
    return () => { alive = false; };
  }, []);

  async function continueNext() {
    try {
      setSaving(true);
      await setLanguage(selected);
      // Language selection must not wait on a profile refresh. Older DB schemas
      // may not have preferred_language, and the role route is already protected
      // by the active auth session.
      if (returnToProfile) {
        await refresh();
        router.replace(role === 'provider' ? '/(provider)/profile' : '/(student)/profile');
      } else {
        // If the account already has a completed role, go straight back into
        // the app. Only first-time accounts need the role picker.
        if (role === 'provider') router.replace('/(provider)/home');
        else if (role === 'student') router.replace('/(student)/browse');
        else router.replace('/role-select');
      }
    } catch (e: any) {
      // Local language saving is the source of truth here. Only a real local
      // storage failure should reach this path.
      console.warn('[language-select] save failed:', e?.message ?? e);
    } finally { setSaving(false); }
  }

  if (loadingCurrent) return <View style={[styles.screen, { flex: 1, alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color={theme.colors.primary} /></View>;

  return <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
    <Text style={styles.kicker}>{t.welcome}</Text>
    <Text style={styles.title}>{t.chooseLanguage}</Text>
    <Text style={styles.sub}>{t.languageSub}</Text>
    <TextInput value={query} onChangeText={setQuery} placeholder={t.searchLanguage} style={styles.search} />
    <View style={styles.list}>
      {filtered.map(item => {
        const on = selected === item.code;
        return <Pressable key={item.code} onPress={async () => { setSelected(item.code); await setLanguage(item.code); }} style={[styles.row, on && styles.rowSelected]} accessibilityRole="radio" accessibilityState={{checked:on}}>
          <View style={{flex:1}}><Text style={styles.native}>{item.nativeName}</Text><Text style={styles.english}>{item.englishName}</Text></View>
          <View style={[styles.radio, on && styles.radioOn]}>{on ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}</View>
        </Pressable>;
      })}
    </View>
    <View style={{ marginTop: 20 }}><Button label={t.continue} size="lg" fullWidth loading={saving} onPress={continueNext} /></View>
    <Text style={styles.note}>{t.languageNote}</Text>
  </ScrollView>;
}

const styles=StyleSheet.create({
  screen:{flex:1,backgroundColor:theme.colors.background}, container:{padding:24,paddingBottom:48},
  kicker:{...theme.type.overline,color:theme.colors.primary,marginTop:24},
  title:{...theme.type.display,color:theme.colors.text,marginTop:8}, sub:{fontSize:14,lineHeight:21,color:theme.colors.textMuted,marginTop:8,marginBottom:18},
  search:{backgroundColor:theme.colors.surface,borderWidth:1.5,borderColor:theme.colors.border,borderRadius:theme.radius.md,paddingHorizontal:14,paddingVertical:13,fontSize:15,color:theme.colors.text},
  list:{marginTop:12,backgroundColor:theme.colors.surface,borderRadius:theme.radius.lg,borderWidth:1,borderColor:theme.colors.border,overflow:'hidden'},
  row:{minHeight:64,paddingHorizontal:16,paddingVertical:10,flexDirection:'row',alignItems:'center',borderBottomWidth:1,borderBottomColor:theme.colors.border}, rowSelected:{backgroundColor:theme.colors.primaryTint},
  native:{fontSize:16,fontWeight:'700',color:theme.colors.text}, english:{fontSize:12,color:theme.colors.textMuted,marginTop:2},
  radio:{width:22,height:22,borderRadius:11,borderWidth:2,borderColor:theme.colors.border,alignItems:'center',justifyContent:'center'}, radioOn:{borderColor:theme.colors.primary,backgroundColor:theme.colors.primary}, radioDot:{width:10,height:10,borderRadius:5,backgroundColor:theme.colors.primary},
  primary:{marginTop:20,backgroundColor:theme.colors.primary,borderRadius:theme.radius.md,paddingVertical:15,alignItems:'center'}, primaryText:{color:'#fff',fontSize:16,fontWeight:'800'}, note:{fontSize:12,color:theme.colors.textMuted,textAlign:'center',marginTop:10,lineHeight:17}
});
