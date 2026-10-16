import { useCallback, useMemo, useState } from 'react';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, Alert, SectionList, Linking,
  RefreshControl, Platform,
} from 'react-native';
import { useLocalSearchParams, useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getCourse, CATEGORY_LABELS, isCourseCategory } from '../../api/courses';
import { listCourseMaterials, type CourseMaterial } from '../../api/materials';
import { downloadMaterial, deleteDownloadedMaterial, listDownloadedMaterials } from '../../lib/materialDownloads';
import { createMaterialDownloadUrl } from '../../lib/materialStorage';
import { notifyMaterialUpdates } from '../../lib/materialNotifications';
import { supabase } from '../../lib/supabase';
import { theme } from '../../constants/theme';

const LOAD_TIMEOUT_MS = 10000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function withTimeout<T>(promise: PromiseLike<T>, ms = LOAD_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('This is taking too long. Check your connection and try again.')), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

type Access = 'loading' | 'locked' | 'ready';
const typeLabel: Record<string, string> = { pdf: 'PDFs', note: 'Notes', video: 'Videos', poll: 'Polls' };
const iconFor: Record<string, any> = {
  pdf: 'document-text-outline', note: 'reader-outline', video: 'play-circle-outline', poll: 'stats-chart-outline',
};

export default function MaterialsScreen() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const [course, setCourse] = useState<any>(null);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [downloaded, setDownloaded] = useState<any[]>([]);
  const [access, setAccess] = useState<Access>('loading');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (!courseId) { setError('Course ID is missing.'); setLoading(false); return; }
    if (!UUID_RE.test(String(courseId))) { setError('This course link is invalid. Open the course again from SkillFarm.'); setLoading(false); setAccess('locked'); return; }
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const [courseData, localDownloads] = await withTimeout(Promise.all([
        getCourse(courseId),
        listDownloadedMaterials(),
      ]));
      setCourse(courseData);
      setDownloaded(localDownloads);

      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) {
        setAccess('locked');
        return;
      }

      // Check only this course instead of loading every registration. This
      // removes the biggest source of the old endless-loading state and keeps
      // course_id as the single source of truth.
      const { data: reg, error: regError } = await withTimeout(
        supabase
          .from('registrations')
          .select('status, payment_status')
          .eq('student_id', uid)
          .eq('course_id', courseId)
          .in('status', ['registered', 'completed'])
          .order('registered_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      );

      let eligible = false;
      if (!regError && reg) {
        // Approved/registered learners can see the materials once payment is
        // confirmed. Some older deployments do not have payment_status yet;
        // in that case the approved registration itself is the access proof.
        eligible = !('payment_status' in reg) || ['paid', 'not_required'].includes(reg.payment_status);
      } else if (regError && /payment_status|column .* does not exist|schema cache/i.test(String(regError.message ?? ''))) {
        // Backward-compatible fallback for databases that predate the payment
        // column. Do not let a schema-cache mismatch lock an already-registered
        // learner out of their course files.
        const fallback = await withTimeout(
          supabase
            .from('registrations')
            .select('status')
            .eq('student_id', uid)
            .eq('course_id', courseId)
            .in('status', ['registered', 'completed'])
            .order('registered_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        );
        if (fallback.error) throw fallback.error;
        eligible = !!fallback.data;
      } else if (regError) {
        throw regError;
      }
      if (!eligible) {
        setAccess('locked');
        setMaterials([]);
        return;
      }

      const rows = await withTimeout(listCourseMaterials(courseId));
      setMaterials(rows);
      setAccess('ready');
      await notifyMaterialUpdates(courseData.title, rows);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load learning materials.');
      setAccess('locked');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [courseId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const sections = useMemo(() => {
    const grouped = materials.reduce((acc, item) => {
      (acc[item.type] ??= []).push(item);
      return acc;
    }, {} as Record<string, CourseMaterial[]>);
    return Object.entries(grouped).map(([key, data]) => ({ title: typeLabel[key] ?? key, data }));
  }, [materials]);

  async function handleDownload(item: CourseMaterial) {
    if (item.type === 'poll') {
      Alert.alert(
        item.title,
        item.description || (item.poll_options ?? []).join('\n') || 'Poll',
      );
      return;
    }
    const saved = downloaded.find(x => x.id === item.id);
    if (saved && saved.version === item.version) return;

    const isUpdate = Boolean(saved && saved.version < item.version);
    const title = 'New version available';
    const body = `${item.title} is now v${item.version}. Download the updated copy for offline learning?`;

    if (isUpdate) {
      const confirmed = await new Promise<boolean>(resolve => Alert.alert(title, body, [
        { text: 'Later', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Download', onPress: () => resolve(true) },
      ]));
      if (!confirmed) return;
    }

    setBusy(item.id);
    try {
      await downloadMaterial(item);
      setDownloaded(await listDownloadedMaterials());
    } catch (e: any) {
      Alert.alert('Download failed', e?.message ?? 'Check your connection.');
    } finally {
      setBusy(null);
    }
  }

  async function openMaterial(item: CourseMaterial) {
    // Web: a signed URL opens fine in a new tab.
    // Android/iOS: a raw file:// URI or a signed PDF URL often opens a blank
    // browser page. Download to cache and hand the file to the system viewer.
    try {
      const saved = downloaded.find(x => x.id === item.id && x.version === item.version);
      if (Platform.OS === 'web') {
        if (!item.storage_path) return;
        await Linking.openURL(await createMaterialDownloadUrl(item.storage_path));
        return;
      }

      let localUri = saved?.localUri ?? null;
      if (!localUri) {
        if (!item.storage_path) return;
        setBusy(item.id);
        const signed = await createMaterialDownloadUrl(item.storage_path);
        const ext = item.type === 'pdf' ? 'pdf' : item.type === 'video' ? 'mp4' : (item.storage_path.split('.').pop() || 'bin');
        const target = `${FileSystem.cacheDirectory}skillfarm-open-${item.id}-v${item.version}.${ext}`;
        const res = await FileSystem.downloadAsync(signed, target);
        if (res.status && res.status >= 400) throw new Error('Could not download this file. Please try again.');
        localUri = res.uri;
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(localUri, {
          mimeType: item.mime_type || (item.type === 'pdf' ? 'application/pdf' : undefined),
          dialogTitle: item.title,
        });
      } else {
        await Linking.openURL(localUri);
      }
    } catch (e: any) {
      Alert.alert('Could not open', e?.message ?? 'This file type is not supported on this device.');
    } finally {
      setBusy(null);
    }
  }

  function removeOffline(item: CourseMaterial) {
    Alert.alert(
      'Delete offline copy?',
      'Only the device copy will be removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          await deleteDownloadedMaterial(item.id);
          setDownloaded(await listDownloadedMaterials());
        } },
      ],
    );
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
  }

  const courseTitle = course?.title ?? 'Learning materials';
  const rawCategory = course?.category;
  const category = isCourseCategory(rawCategory) ? CATEGORY_LABELS[rawCategory] : null;

  return (
    <SectionList
      sections={access === 'ready' ? sections : []}
      keyExtractor={item => item.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.colors.primary} />}
      ListHeaderComponent={
        <View>
          <Pressable style={styles.back} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="arrow-back" size={20} color={theme.colors.text} />
            <Text style={styles.backText}>Back to course</Text>
          </Pressable>
          <View style={styles.hero}>
            <View style={styles.heroIcon}><Ionicons name="library-outline" size={25} color={theme.colors.primary} /></View>
            <View style={styles.heroCopy}>
              <Text style={styles.kicker}>{category ?? 'SKILLFARM LEARNING'}</Text>
              <Text style={styles.title}>{courseTitle}</Text>
              <Text style={styles.sub}>PDFs, Excel sheets, notes, videos and polls shared by your Learning Partner.</Text><View style={styles.livePill}><View style={styles.liveDot}/><Text style={styles.liveText}>LIVE UPDATES</Text></View>
            </View>
          </View>

          {error ? (
            <View style={styles.errorCard}>
              <Ionicons name="alert-circle-outline" size={20} color={theme.colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
              <Pressable onPress={() => load()}><Text style={styles.retry}>Retry</Text></Pressable>
            </View>
          ) : null}

          {access !== 'ready' ? (
            <View style={styles.lockCard}>
              <View style={styles.lockIcon}><Ionicons name="lock-closed-outline" size={24} color={theme.colors.primary} /></View>
              <Text style={styles.lockTitle}>Learning materials</Text>
              <Text style={styles.lockText}>Learning materials unlock after your seat is approved and payment is confirmed.</Text>
              <Pressable style={styles.primaryButton} onPress={() => router.push('/(student)/my-registrations')}>
                <Text style={styles.primaryButtonText}>View My Seats</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.offlineBanner}>
              <Ionicons name="cloud-offline-outline" size={19} color={theme.colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.offlineTitle}>Offline learning</Text>
                <Text style={styles.offlineText}>Download what you need and learn without an internet connection.</Text>
              </View>
            </View>
          )}
        </View>
      }
      renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
      renderItem={({ item }) => {
        const saved = downloaded.find(x => x.id === item.id);
        const current = saved?.version === item.version;
        const hasUpdate = Boolean(saved && saved.version < item.version);
        const title = item.title;
        return (
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.icon}><Ionicons name={iconFor[item.type]} size={22} color={theme.colors.primary} /></View>
              <View style={styles.copy}>
                <Text style={styles.name}>{title}</Text>
                <Text style={styles.meta}>v{item.version}{item.is_required ? ` · Required` : ''}</Text>
                {hasUpdate ? <Text style={styles.update}>{`Updated · v${item.version}`}</Text> : null}
                {current ? <Text style={styles.saved}>✓ Available offline</Text> : null}
              </View>
              <Pressable onPress={() => handleDownload(item)} disabled={busy === item.id} style={styles.downloadButton} accessibilityRole="button" accessibilityLabel={`${current ? 'Downloaded' : 'Download'} ${title}`}>
                {busy === item.id ? <ActivityIndicator size="small" color={theme.colors.primary} /> : <Ionicons name={current ? 'checkmark-circle' : hasUpdate ? 'cloud-download-outline' : 'download-outline'} size={24} color={theme.colors.primary} />}
              </Pressable>
            </View>
            <View style={styles.bottom}>
              <Pressable onPress={() => openMaterial(item)}><Text style={styles.open}>{current ? 'Open offline' : 'Open'}</Text></Pressable>
              {saved ? <Pressable onPress={() => removeOffline(item)}><Text style={styles.delete}>{'Delete offline copy'}</Text></Pressable> : null}
            </View>
          </View>
        );
      }}
      ListEmptyComponent={access === 'ready' ? <View style={styles.empty}><Ionicons name="library-outline" size={42} color={theme.colors.border} /><Text style={styles.emptyTitle}>{'No materials published yet'}</Text><Text style={styles.emptyText}>{'Trainer materials will appear here when published.'}</Text></View> : null}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 36 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background },
  back: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 4, marginBottom: 12 },
  backText: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 18, padding: 15 },
  heroIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary + '14' },
  heroCopy: { flex: 1 },
  kicker: { fontSize: 11, fontWeight: '900', color: theme.colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { fontSize: 21, fontWeight: '900', color: theme.colors.text, marginTop: 2 },
  sub: { fontSize: 13, color: theme.colors.textMuted, lineHeight: 18, marginTop: 4 },
  offlineBanner: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: theme.colors.primary + '0D', borderWidth: 1, borderColor: theme.colors.primary + '25' },
  offlineTitle: { fontWeight: '800', color: theme.colors.text, fontSize: 13 },
  offlineText: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
  lockCard: { marginTop: 14, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 18, padding: 18, alignItems: 'center' },
  lockIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: theme.colors.primary + '14', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  lockTitle: { textAlign: 'center', fontSize: 17, fontWeight: '900', color: theme.colors.text },
  lockText: { textAlign: 'center', fontSize: 13, color: theme.colors.textMuted, lineHeight: 19, marginTop: 6 },
  primaryButton: { marginTop: 14, backgroundColor: theme.colors.primary, borderRadius: 11, paddingHorizontal: 16, paddingVertical: 11 },
  primaryButtonText: { color: '#fff', fontWeight: '800' },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, padding: 11, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.danger, backgroundColor: theme.colors.surface },
  errorText: { flex: 1, fontSize: 12, color: theme.colors.text },
  retry: { fontWeight: '800', color: theme.colors.primary },
  section: { fontSize: 13, fontWeight: '900', color: theme.colors.textMuted, textTransform: 'uppercase', marginTop: 20, marginBottom: 8 },
  card: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 16, padding: 13, marginBottom: 9 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 42, height: 42, borderRadius: 12, backgroundColor: theme.colors.primary + '14', alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '800', color: theme.colors.text },
  meta: { fontSize: 11, color: theme.colors.textMuted, marginTop: 3 },
  saved: { fontSize: 11, color: theme.colors.success, fontWeight: '800', marginTop: 3 },
  update: { fontSize: 11, color: theme.colors.warning, fontWeight: '800', marginTop: 3 },
  downloadButton: { padding: 8 },
  bottom: { borderTopWidth: 1, borderTopColor: theme.colors.border, marginTop: 10, paddingTop: 9, flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  open: { fontWeight: '800', color: theme.colors.primary },
  delete: { fontWeight: '700', color: theme.colors.danger },
  empty: { alignItems: 'center', padding: 45 },
  emptyTitle: { fontSize: 18, fontWeight: '900', color: theme.colors.text, marginTop: 10 },
  emptyText: { textAlign: 'center', color: theme.colors.textMuted, lineHeight: 18, marginTop: 5 },
  livePill:{alignSelf:'flex-start',marginTop:8,flexDirection:'row',alignItems:'center',gap:5,paddingHorizontal:8,paddingVertical:4,borderRadius:12,backgroundColor:theme.colors.success+'15'}, liveDot:{width:7,height:7,borderRadius:4,backgroundColor:theme.colors.success}, liveText:{fontSize:10,fontWeight:'900',color:theme.colors.success},
});
