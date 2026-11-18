import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  createBatch, deleteBatch, listBatches, updateBatch, type Batch, type BatchInput,
} from '../api/batches';
import { theme } from '../constants/theme';
import { DateField } from './DateField';
import { FocusGroup, FocusTextInput as TextInput } from './ui';
import { Alert } from '../lib/alert';

type Props = {
  visible: boolean;
  courseId: string;
  onClose: () => void;
  onChanged?: () => void;
};

const blank = (index = 1): BatchInput => ({
  name: `Batch ${index}`,
  start_date: null,
  end_date: null,
  duration_weeks: null,
  timings: null,
  seats_total: 40,
  registration_deadline: null,
});

export function BatchManageModal({ visible, courseId, onClose, onChanged }: Props) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BatchInput>(blank());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setBatches(await listBatches(courseId));
    } catch (e: any) {
      Alert.alert('Could not load batches', e?.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  function startNew() {
    setEditingId(null);
    setForm(blank(batches.length + 1));
  }

  function startEdit(batch: Batch) {
    setEditingId(batch.id);
    setForm({
      name: batch.name,
      start_date: batch.start_date,
      end_date: batch.end_date,
      duration_weeks: batch.duration_weeks,
      timings: batch.timings,
      seats_total: batch.seats_total || 40,
      registration_deadline: batch.registration_deadline,
    });
  }

  async function save() {
    if (!form.name?.trim()) {
      Alert.alert('Batch name required', 'Give this batch a name, such as “September Morning”.');
      return;
    }
    const seatCount = Number(form.seats_total);
    if (!Number.isInteger(seatCount) || seatCount < 1 || seatCount > 200) {
      Alert.alert('Invalid seats', 'Number of seats must be a whole number from 1 to 200.');
      return;
    }

    try {
      setSaving(true);
      if (editingId) {
        await updateBatch(editingId, form);
      } else {
        await createBatch(courseId, form);
      }
      setForm(blank());
      setEditingId(null);
      await load();
      onChanged?.();
    } catch (e: any) {
      Alert.alert('Could not save batch', e?.message ?? 'Please check the dates and capacity.');
    } finally {
      setSaving(false);
    }
  }

  function remove(batch: Batch) {
    Alert.alert(
      'Delete batch?',
      'A batch with registrations cannot be deleted. This protects learner history.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteBatch(batch.id);
              await load();
              onChanged?.();
            } catch (e: any) {
              Alert.alert('Cannot delete batch', e?.message ?? 'This batch may still have registrations.');
            }
          },
        },
      ],
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Manage batches</Text>
            <Text style={styles.subtitle}>Each batch has its own dates, capacity and deadline.</Text>
          </View>
          <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={theme.colors.text} />
          </Pressable>
        </View>

        <FocusGroup>
        <ScrollView contentContainerStyle={styles.content}>
          {loading ? (
            <ActivityIndicator size="large" color={theme.colors.primary} />
          ) : (
            batches.map((batch) => (
              <View key={batch.id} style={styles.batchCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.batchName}>{batch.name}</Text>
                  <Text style={styles.meta}>
                    {batch.start_date ?? 'No start date'}
                    {batch.end_date ? ` → ${batch.end_date}` : ''}
                  </Text>
                  <Text style={styles.meta}>
                    {batch.seats_filled}/{batch.seats_total} seats filled
                  </Text>
                </View>
                <Pressable onPress={() => startEdit(batch)} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Edit">
                  <Ionicons name="create-outline" size={20} color={theme.colors.primary} />
                </Pressable>
                <Pressable onPress={() => remove(batch)} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Delete">
                  <Ionicons name="trash-outline" size={20} color={theme.colors.danger} />
                </Pressable>
              </View>
            ))
          )}

          <Text style={styles.formTitle}>{editingId ? 'Edit batch' : 'Add batch'}</Text>

          <Text style={styles.label}>Batch name</Text>
          <TextInput
            style={styles.input}
            value={form.name}
            onChangeText={(name) => setForm((x) => ({ ...x, name }))}
            placeholder="e.g. October Evening"
          />

          <Text style={styles.label}>Start date</Text>
          <DateField
            value={form.start_date ?? ''}
            onChange={(start_date) => setForm((x) => ({ ...x, start_date: start_date || null }))}
            placeholder="Tap to pick start date"
            maxDate={form.end_date || undefined}
          />

          <Text style={styles.label}>End date</Text>
          <DateField
            value={form.end_date ?? ''}
            onChange={(end_date) => setForm((x) => ({ ...x, end_date: end_date || null }))}
            placeholder="Tap to pick end date"
            minDate={form.start_date || undefined}
          />

          <Text style={styles.label}>Duration (weeks, optional)</Text>
          <TextInput
            style={styles.input}
            value={form.duration_weeks == null ? '' : String(form.duration_weeks)}
            onChangeText={(v) => setForm((x) => ({ ...x, duration_weeks: v ? Number(v) : null }))}
            placeholder="4"
            keyboardType="numeric"
          />

          <Text style={styles.label}>Timings</Text>
          <TextInput
            style={styles.input}
            value={form.timings ?? ''}
            onChangeText={(timings) => setForm((x) => ({ ...x, timings: timings || null }))}
            placeholder="Mon–Fri, 9am–12pm"
          />

          <Text style={styles.label}>Number of seats (1 – 200)</Text>
          <TextInput
            style={styles.input}
            value={form.seats_total ? String(form.seats_total) : ''}
            onChangeText={(v) => setForm((x) => ({ ...x, seats_total: Number(v.replace(/[^0-9]/g, '').slice(0, 3)) || 0 }))}
            placeholder="40"
            keyboardType="number-pad"
          />
          <Text style={{ fontSize: 11.5, color: theme.colors.textMuted, marginTop: 5 }}>
            Learners will see a seat map with exactly this many seats.
          </Text>

          <Text style={styles.label}>Registration deadline (ISO/date)</Text>
          <TextInput
            style={styles.input}
            value={form.registration_deadline ?? ''}
            onChangeText={(registration_deadline) =>
              setForm((x) => ({ ...x, registration_deadline: registration_deadline || null }))
            }
            placeholder="2026-09-25T23:59:59+05:30"
          />

          <View style={styles.actions}>
            <Pressable style={styles.secondary} onPress={startNew}>
              <Text style={styles.secondaryText}>Clear</Text>
            </Pressable>
            <Pressable style={styles.primary} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{editingId ? 'Save batch' : 'Add batch'}</Text>}
            </Pressable>
          </View>
        </ScrollView>
        </FocusGroup>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    padding: 18, paddingTop: 24, borderBottomWidth: 1, borderBottomColor: theme.colors.border,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  title: { fontSize: 22, fontWeight: '800', color: theme.colors.text },
  subtitle: { marginTop: 4, color: theme.colors.textMuted, fontSize: 13, maxWidth: 320 },
  close: { padding: 6 },
  content: { padding: 16, paddingBottom: 40 },
  batchCard: {
    flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 10,
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  batchName: { fontWeight: '700', color: theme.colors.text, fontSize: 15 },
  meta: { marginTop: 4, color: theme.colors.textMuted, fontSize: 12 },
  iconButton: { padding: 8, marginLeft: 4 },
  formTitle: { fontSize: 18, fontWeight: '800', color: theme.colors.text, marginTop: 16 },
  label: { fontSize: 13, fontWeight: '600', color: theme.colors.textMuted, marginTop: 12, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md,
    paddingHorizontal: 12, paddingVertical: 11, backgroundColor: theme.colors.surface,
    color: theme.colors.text, fontSize: 15,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  secondary: {
    flex: 1, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius.md, padding: 13, alignItems: 'center',
  },
  secondaryText: { color: theme.colors.text, fontWeight: '700' },
  primary: {
    flex: 2, backgroundColor: theme.colors.primary, borderRadius: theme.radius.md,
    padding: 13, alignItems: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '800' },
});
