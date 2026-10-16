import { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Switch } from 'react-native';
import { theme } from '../constants/theme';
import { FocusGroup, FocusTextInput as TextInput } from './ui';
import { EMPTY_COURSE_FILTERS, type CourseFilterState } from '../lib/courseFilters';

export function CourseFilterSheet({ visible, value, onClose, onApply }: { visible: boolean; value: CourseFilterState; onClose: () => void; onApply: (v: CourseFilterState) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (visible) setDraft(value); }, [visible, value]);
  const update = (patch: Partial<CourseFilterState>) => setDraft((x) => ({ ...x, ...patch }));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}><View style={styles.sheet}>
        <FocusGroup>
        <View style={styles.head}><Text style={styles.title}>Filters</Text><Pressable onPress={() => setDraft(EMPTY_COURSE_FILTERS)}><Text style={styles.reset}>Reset</Text></Pressable></View>
        <Text style={styles.label}>Location</Text>
        <TextInput style={styles.input} value={draft.city} onChangeText={(city) => update({ city })} placeholder="City or state" placeholderTextColor={theme.colors.textMuted} />
        <Text style={styles.label}>Fee range</Text>
        <View style={styles.row}><TextInput style={[styles.input, styles.half]} value={draft.minFee} onChangeText={(minFee) => update({ minFee })} keyboardType="numeric" placeholder="Min fee" placeholderTextColor={theme.colors.textMuted} /><TextInput style={[styles.input, styles.half]} value={draft.maxFee} onChangeText={(maxFee) => update({ maxFee })} keyboardType="numeric" placeholder="Max fee" placeholderTextColor={theme.colors.textMuted} /></View>
        <Toggle label="Upcoming batches only" value={draft.upcomingOnly} onValueChange={(upcomingOnly) => update({ upcomingOnly })} />
        <Toggle label="Seats available" value={draft.seatsAvailable} onValueChange={(seatsAvailable) => update({ seatsAvailable })} />
        <Pressable style={styles.apply} onPress={() => { onApply(draft); onClose(); }}><Text style={styles.applyText}>Apply filters</Text></Pressable>
        </FocusGroup>
      </View></View>
    </Modal>
  );
}
function Toggle({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (v: boolean) => void }) {
  return <View style={styles.toggle}><Text style={styles.toggleText}>{label}</Text><Switch value={value} onValueChange={onValueChange} trackColor={{ true: theme.colors.primaryLight }} thumbColor={value ? theme.colors.primary : undefined} /></View>;
}
const styles = StyleSheet.create({ overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000055' }, sheet: { backgroundColor: theme.colors.surface, padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20 }, head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }, title: { fontSize: 22, fontWeight: '700', color: theme.colors.text }, reset: { color: theme.colors.primary, fontWeight: '700' }, label: { fontSize: 13, fontWeight: '700', color: theme.colors.text, marginBottom: 7, marginTop: 8 }, input: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, paddingHorizontal: 12, paddingVertical: 11, color: theme.colors.text, backgroundColor: theme.colors.background }, row: { flexDirection: 'row', gap: 10 }, half: { flex: 1 }, toggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 }, toggleText: { fontSize: 15, color: theme.colors.text }, apply: { backgroundColor: theme.colors.primary, padding: 14, borderRadius: theme.radius.md, alignItems: 'center', marginTop: 10 }, applyText: { color: '#fff', fontWeight: '700', fontSize: 15 } });
