import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, SectionList, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { listDownloadedMaterials, deleteDownloadedMaterial } from '../../lib/materialDownloads';
import { useLanguage } from '../../lib/i18n';
import { theme } from '../../constants/theme';

export default function Downloads() {
  const { t } = useLanguage();
  const [data, setData] = useState<any[]>([]);
  const load = useCallback(() => { listDownloadedMaterials().then(setData); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const grouped: Array<{ title: string; data: any[] }> = Object.values(data.reduce<Record<string, any[]>>((groups, item) => {
    const key = String(item.course_id ?? 'other');
    (groups[key] ??= []).push(item);
    return groups;
  }, {})).map((items) => ({
    title: String(items[0]?.course_title ?? 'Course'),
    data: items,
  }));

  return (
    <SectionList
      sections={grouped}
      keyExtractor={(x) => x.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={<View><Text style={styles.title}>{t.downloadedLearning}</Text><Text style={styles.sub}>{t.downloadedSub}</Text></View>}
      renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.icon}><Ionicons name={item.type === 'video' ? 'play-circle-outline' : item.type === 'pdf' ? 'document-text-outline' : 'reader-outline'} size={21} color={theme.colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{item.title}</Text>
            <Text style={styles.meta}>{item.type.toUpperCase()} · v{item.version}</Text>
          </View>
          <View style={styles.actions}>
            <Pressable onPress={() => Linking.openURL(item.localUri).catch(() => Alert.alert('Could not open', 'This file type is not supported by another app on your device.'))} accessibilityLabel="Open downloaded file">
              <Ionicons name="open-outline" size={21} color={theme.colors.primary} />
            </Pressable>
            <Pressable onPress={() => Alert.alert('Delete download?', 'Only the offline copy will be removed.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: async () => { await deleteDownloadedMaterial(item.id); load(); } },
            ])} accessibilityLabel="Delete downloaded file">
              <Ionicons name="trash-outline" size={21} color={theme.colors.danger} />
            </Pressable>
          </View>
        </View>
      )}
      ListEmptyComponent={<View style={styles.empty}><Ionicons name="download-outline" size={42} color={theme.colors.border} /><Text style={styles.emptyTitle}>{t.noData}</Text><Text style={styles.emptySub}>Download materials from a paid course to use them offline.</Text></View>}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: '900', color: theme.colors.text },
  sub: { color: theme.colors.textMuted, lineHeight: 18, marginTop: 5 },
  section: { fontSize: 13, fontWeight: '900', color: theme.colors.textMuted, marginTop: 22, marginBottom: 8 },
  card: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 15, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  icon: { width: 40, height: 40, borderRadius: 11, backgroundColor: theme.colors.primary + '14', alignItems: 'center', justifyContent: 'center' },
  name: { fontWeight: '800', color: theme.colors.text },
  meta: { fontSize: 11, color: theme.colors.textMuted, marginTop: 3 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  empty: { alignItems: 'center', padding: 45 },
  emptyTitle: { fontSize: 18, fontWeight: '900', color: theme.colors.text, marginTop: 10 },
  emptySub: { textAlign: 'center', color: theme.colors.textMuted, lineHeight: 18, marginTop: 5 },
});
