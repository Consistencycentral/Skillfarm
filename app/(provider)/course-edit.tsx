// ===========================================================================
// Add / Edit Course — a form used both for creating a new course and editing
// an existing one. If ?id= is passed, we load that course and pre-fill.
// ===========================================================================
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, Pressable, Image, Linking
} from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  createCourse, updateCourse, getCourse, getDroppedOptionalColumns, autoTranslateCourseText, CATEGORY_LIST, CATEGORY_LABELS,
  type CourseCategory, type CourseTranslations, type TranslatableField,
} from '../../api/courses';
import { Button } from '../../components/Button';
import { KeyboardAwareScreen } from '../../components/KeyboardAwareScreen';
import { FocusGroup, FocusTextInput as TextInput } from '../../components/ui';
import { DateField } from '../../components/DateField';
import { supabase } from '../../lib/supabase';
import { theme } from '../../constants/theme';
import { listBatches, syncPrimaryBatchFromCourse, type Batch } from '../../api/batches';
import { BatchManageModal } from '../../components/BatchManageModal';
import { uploadImageFromUri, deleteImage, pickAndUploadCertificate } from '../../lib/storage';

import { Alert } from '../../lib/alert';

function cleanTranslations(t: CourseTranslations): CourseTranslations {
  const out: CourseTranslations = {};
  for (const lng of ['ta', 'hi'] as const) {
    const entries = Object.entries(t[lng] ?? {}).map(([k, v]) => [k, String(v ?? '').trim()] as const).filter(([, v]) => v);
    if (entries.length) out[lng] = Object.fromEntries(entries) as any;
  }
  return out;
}

export default function CourseEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = Boolean(id);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<CourseCategory>('crop_cultivation');
  const [startDate, setStartDate] = useState('');     // YYYY-MM-DD
  const [durationWeeks, setDurationWeeks] = useState('');
  // The Learning Partner chooses how many seats the event has (1-200, default 40).
  // The learner's seat map is drawn with exactly this many seats.
  const [seatsTotal, setSeatsTotal] = useState('40');
  const [translations, setTranslations] = useState<CourseTranslations>({});
  const [fee, setFee] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [stateField, setStateField] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  // Enriched course fields (Trust & Enrollment v2).
  const [learningOutcomes, setLearningOutcomes] = useState('');
  const [agenda, setAgenda] = useState('');
  const [batchTimings, setBatchTimings] = useState('');
  const [registrationDeadline, setRegistrationDeadline] = useState(''); // YYYY-MM-DD
  const [discount, setDiscount] = useState('');
  const [language, setLanguage] = useState('');
  const [certificateAvailable, setCertificateAvailable] = useState(false);
  const [eligibility, setEligibility] = useState('');
  // Trainer shown on the course page (v8).
  const [trainerName, setTrainerName] = useState('');
  const [trainerBio, setTrainerBio] = useState('');
  // Certificate file the partner uploads (v8): PDF or image.
  const [cert, setCert] = useState<{ url: string; path: string; name: string } | null>(null);
  const [uploadingCert, setUploadingCert] = useState(false);
  const [translating, setTranslating] = useState(false);
  // Course images (multi). Each entry keeps the public URL + storage path so we
  // can delete an image cleanly on remove.
  const [images, setImages] = useState<{ url: string; path: string }[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);
  // Dates as loaded, so an old finished course can still have its text edited
  // without being forced to pick a new date.
  const [origDates, setOrigDates] = useState<{ start: string; deadline: string }>({ start: '', deadline: '' });
  const [batchModalOpen, setBatchModalOpen] = useState(false);

  // Load existing course in edit mode.
  useFocusEffect(useCallback(() => {
    if (!id) return;
    (async () => {
      try {
        setLoading(true);
        const c = await getCourse(id as string);
        setTitle(c.title);
        setDescription(c.description ?? '');
        setCategory(c.category);
        setStartDate(c.start_date ?? '');
        setDurationWeeks(c.duration_weeks?.toString() ?? '');
        setTranslations((c.translations as CourseTranslations) ?? {});
        setFee(c.fee?.toString() ?? '');
        setAddress(c.address);
        setCity(c.city ?? '');
        setStateField(c.state ?? '');
        setContactPhone(c.contact_phone ?? '');
        setLearningOutcomes(c.learning_outcomes ?? '');
        setAgenda(c.agenda ?? '');
        setBatchTimings(c.batch_timings ?? '');
        setRegistrationDeadline(c.registration_deadline ?? '');
        setOrigDates({ start: c.start_date ?? '', deadline: c.registration_deadline ?? '' });
        setDiscount(c.discount ? String(c.discount) : '');
        setLanguage(c.language ?? '');
        setCertificateAvailable(c.certificate_available ?? false);
        setEligibility(c.eligibility ?? '');
        setTrainerName(c.trainer_name ?? '');
        setTrainerBio(c.trainer_bio ?? '');
        setCert(c.certificate_url ? { url: c.certificate_url, path: certUrlToPath(c.certificate_url), name: c.certificate_name ?? 'Certificate' } : null);
        setImages((c.images ?? []).map((url) => ({ url, path: urlToPath(url) })));
        try {
          const loaded = await listBatches(c.id);
          setBatches(loaded);
          if (loaded[0]?.seats_total) setSeatsTotal(String(loaded[0].seats_total));
        } catch {
          setBatches([]);
        }
      } catch (e: any) {
        Alert.alert('Could not load course', e?.message ?? 'Please try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]));

  function validate(): string | null {
    if (!title.trim()) return 'Title is required.';
    if (!address.trim() && !city.trim() && !stateField.trim()) return 'Please enter a venue address or at least a city/state.';
    if (!startDate) return 'Add the event start date so learners can book a seat.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return 'Start date must be YYYY-MM-DD.';
    if (registrationDeadline && !/^\d{4}-\d{2}-\d{2}$/.test(registrationDeadline)) return 'Registration deadline must be YYYY-MM-DD.';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const startD = new Date(`${startDate}T00:00:00`);
    if (Number.isNaN(startD.getTime())) return 'Start date is not a real date.';
    if ((!isEdit || startDate !== origDates.start) && startD.getTime() < today.getTime()) return 'The start date is in the past. Learners can only book upcoming events — choose a future start date.';
    if (registrationDeadline) {
      const dl = new Date(`${registrationDeadline}T00:00:00`);
      if ((!isEdit || registrationDeadline !== origDates.deadline) && !Number.isNaN(dl.getTime()) && dl.getTime() < today.getTime()) return 'The registration deadline is in the past, so nobody could book. Choose today or a later date (or leave it blank).';
      if (!Number.isNaN(dl.getTime()) && dl.getTime() > startD.getTime()) return 'The registration deadline must be on or before the start date.';
    }
    if (discount && Number(discount) < 0) return 'Discount cannot be negative.';
    if (batches.length <= 1) {
      const n = Number(seatsTotal);
      if (!Number.isInteger(n) || n < 1 || n > 200) return 'Number of seats must be a whole number from 1 to 200.';
    }
    return null;
  }

  // Derive the storage object path from a public URL so we can delete it.
  function urlToPath(url: string): string {
    try {
      const parts = url.split('/course-images/'); // [origin..., <uid>/<file>]
      return parts[1] ?? '';
    } catch {
      return '';
    }
  }

  function certUrlToPath(url: string): string {
    const marker = '/course-certificates/';
    const at = url.indexOf(marker);
    return at === -1 ? '' : decodeURIComponent(url.slice(at + marker.length).split(/[?#]/)[0]);
  }

  async function onUploadCertificate() {
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Not signed in.');
      setUploadingCert(true);
      const uploaded = await pickAndUploadCertificate(u.user.id);
      if (!uploaded) return;
      const old = cert;
      setCert(uploaded);
      setCertificateAvailable(true);
      if (old?.path) await deleteImage('course-certificates', old.path);
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? 'Please try again.');
    } finally {
      setUploadingCert(false);
    }
  }

  async function onRemoveCertificate() {
    const old = cert;
    setCert(null);
    if (old?.path) await deleteImage('course-certificates', old.path);
  }

  // Fill the Tamil / Hindi boxes from the English text. Only EMPTY boxes are
  // filled, so anything the partner already typed is never overwritten.
  async function onAutoTranslate() {
    const source = {
      title, description, agenda, learning_outcomes: learningOutcomes,
      eligibility, batch_timings: batchTimings, trainer_name: trainerName, trainer_bio: trainerBio,
    } as Record<TranslatableField, string>;
    if (!Object.values(source).some((v) => v && v.trim())) {
      Alert.alert('Nothing to translate', 'Write the English title/description first.');
      return;
    }
    setTranslating(true);
    try {
      const result = await autoTranslateCourseText(source);
      setTranslations((prev) => {
        const next: CourseTranslations = { ...prev };
        for (const lng of ['ta', 'hi'] as const) {
          const merged = { ...(prev[lng] ?? {}) } as Record<string, string>;
          for (const [k, v] of Object.entries(result[lng] ?? {})) {
            if (!String(merged[k] ?? '').trim() && v) merged[k] = v as string;
          }
          next[lng] = merged;
        }
        return next;
      });
      Alert.alert('Translated', 'Tamil and Hindi boxes are filled. Please read them once and fix anything before saving.');
    } catch (e: any) {
      Alert.alert('Auto-translate failed', e?.message ?? 'Please try again, or type the translation yourself.');
    } finally {
      setTranslating(false);
    }
  }

  // Pick + upload one more course image.
  async function onAddImage() {
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Not signed in.');
      setUploadingImage(true);
      const ImagePicker = await import('expo-image-picker');
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') throw new Error('Photo permission is needed to add images.');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [4, 3], quality: 0.8,
      });
      if (result.canceled || !result.assets?.length) return;
      const uploaded = await uploadImageFromUri('course-images', u.user.id, result.assets[0].uri);
      setImages((prev) => [...prev, { url: uploaded.url, path: uploaded.path }]);
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? 'Please try again.');
    } finally {
      setUploadingImage(false);
    }
  }

  async function onRemoveImage(idx: number) {
    const target = images[idx];
    if (!target) return;
    const next = images.filter((_, i) => i !== idx);
    setImages(next);
    if (target.path) await deleteImage('course-images', target.path);
  }

  async function handleSave() {
    const err = validate();
    if (err) { Alert.alert('Check your inputs', err); return; }
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Not signed in.');
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        category,
        start_date: startDate || null,
        duration_weeks: durationWeeks ? Number(durationWeeks) : null,
        // Capacity is owned by the batches (the partner picks it per event).
        // Sending it on edit makes the database refuse the save for a course
        // with 2+ batches, so it is applied to the batch below instead.
        ...(isEdit ? {} : { seats_total: Number(seatsTotal) }),
        fee: fee ? Number(fee) : null,
        address: address.trim() || [city.trim(), stateField.trim()].filter(Boolean).join(', '),
        city: city.trim() || null,
        state: stateField.trim() || null,
        contact_phone: contactPhone.trim() || null,
        // Enriched fields:
        learning_outcomes: learningOutcomes.trim() || null,
        agenda: agenda.trim() || null,
        batch_timings: batchTimings.trim() || null,
        registration_deadline: registrationDeadline || null,
        discount: discount ? Number(discount) : 0,
        language: language.trim() || null,
        certificate_available: certificateAvailable,
        eligibility: eligibility.trim() || null,
        trainer_name: trainerName.trim() || null,
        trainer_bio: trainerBio.trim() || null,
        certificate_url: cert?.url ?? null,
        certificate_name: cert?.name ?? null,
        images: images.map((i) => i.url),
        translations: cleanTranslations(translations),
      };
      let savedCourse: Awaited<ReturnType<typeof createCourse>>;
      if (isEdit) {
        savedCourse = await updateCourse(id as string, payload);
      } else {
        savedCourse = await createCourse(u.user.id, payload as any);
      }

      // The course form is the partner's primary publishing action. Keep the
      // booking event in the real batches table so learner-side Batch -> Seat
      // -> Details -> Payment always has a valid batch id. Multiple existing
      // batches are preserved by syncPrimaryBatchFromCourse.
      await syncPrimaryBatchFromCourse(savedCourse.id, {
        start_date: savedCourse.start_date ?? startDate,
        duration_weeks: savedCourse.duration_weeks ?? (durationWeeks ? Number(durationWeeks) : null),
        timings: savedCourse.batch_timings ?? (batchTimings.trim() || null),
        seats_total: Math.trunc(Number(seatsTotal)) || 40,
        registration_deadline: savedCourse.registration_deadline ?? (registrationDeadline || null),
      });

      const dropped = getDroppedOptionalColumns().filter((c) => c !== 'translations');
      if (dropped.length) {
        Alert.alert(
          'Saved, but trainer/certificate not stored',
          'The course was saved. Trainer details and the certificate file were skipped because the database update (supabase/migrations/20261014_client_fixes_v8.sql) has not been run yet. Run it once in the Supabase SQL Editor, then edit and save again.'
        );
      } else {
        Alert.alert('Published', isEdit ? 'Course and booking event updated.' : 'Course and booking event are now live for learners.');
      }
      router.back();
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      if (/stack depth/i.test(msg)) {
        Alert.alert('Database update needed', 'The database still has the old seat-sync trigger loop. Run supabase/migrations/20261013_client_fixes_v6.sql once in the Supabase SQL Editor, then save again.');
      } else if (/trainer_name|trainer_bio|certificate_url|certificate_name/i.test(msg)) {
        Alert.alert('Database update needed', 'Run supabase/migrations/20261014_client_fixes_v8.sql once in the Supabase SQL Editor, then save again.');
      } else if (/managed by batches/i.test(msg)) {
        Alert.alert('Could not save', 'Seat capacity is set per batch. Use "Manage batches" to change the seats of each batch.');
      } else {
        Alert.alert('Could not save', msg || 'Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
  }

  return (
    <KeyboardAwareScreen style={styles.container}>
      <FocusGroup>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>{isEdit ? 'Edit course' : 'Add a new course'}</Text>
        {isEdit && (
          <Pressable style={styles.manageBatches} onPress={() => setBatchModalOpen(true)}>
            <Ionicons name="layers-outline" size={17} color={theme.colors.primary} />
            <Text style={styles.manageBatchesText}>Manage batches</Text>
          </Pressable>
        )}
      </View>

      <Label>Title</Label>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Organic Farming Workshop" />

      <Label>Description</Label>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={description}
        onChangeText={setDescription}
        placeholder="What will learners learn? Who should attend?"
        multiline
        numberOfLines={4}
        textAlignVertical="top"
      />

      <Label>Category</Label>
      <View style={styles.chips}>
        {CATEGORY_LIST.map((cat) => (
          <Pressable
            key={cat}
            style={[styles.chip, category === cat ? styles.chipActive : {}]}
            onPress={() => setCategory(cat)}
          >
            <Text style={[styles.chipText, category === cat ? styles.chipTextActive : {}]}>
              {CATEGORY_LABELS[cat]}
            </Text>
          </Pressable>
        ))}
      </View>

      <Label>Start date</Label>
      <DateField value={startDate} onChange={setStartDate} placeholder="Tap to pick start date" minDate={isEdit && origDates.start && origDates.start < todayStr() ? undefined : todayStr()} clearable={false} />

      <Label>Duration (weeks)</Label>
      <TextInput style={styles.input} value={durationWeeks} onChangeText={setDurationWeeks} placeholder="4" keyboardType="numeric" />

      <Label>Number of seats (1 – 200)</Label>
      <TextInput
        style={[styles.input, batches.length > 1 && { backgroundColor: '#F1F3F1' }]}
        value={batches.length > 1 ? 'Set per batch — use “Manage batches”' : seatsTotal}
        onChangeText={(v) => setSeatsTotal(v.replace(/[^0-9]/g, '').slice(0, 3))}
        editable={batches.length <= 1}
        placeholder="40"
        keyboardType="number-pad"
      />
      {batches.length <= 1 ? (
        <Text style={{ fontSize: 11.5, color: theme.colors.textMuted, marginTop: 5 }}>
          Learners will see a seat map with exactly {Math.min(200, Math.max(1, Math.trunc(Number(seatsTotal)) || 40))} seats.
        </Text>
      ) : null}

      <Label>Fee (₹) — leave blank for free</Label>
      <TextInput style={styles.input} value={fee} onChangeText={setFee} placeholder="500" keyboardType="numeric" />

      <Label>Training address *</Label>
      <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="Door no, street, area" multiline numberOfLines={2} textAlignVertical="top" />

      <Label>City</Label>
      <TextInput style={styles.input} value={city} onChangeText={setCity} placeholder="Madurai" />

      <Label>State</Label>
      <TextInput style={styles.input} value={stateField} onChangeText={setStateField} placeholder="Tamil Nadu" />

      <Label>Contact phone (shown to learners)</Label>
      <TextInput style={styles.input} value={contactPhone} onChangeText={setContactPhone} placeholder="9876543210" keyboardType="phone-pad" />

      <Label>Learning outcomes</Label>
      <TextInput style={[styles.input, styles.textArea]} value={learningOutcomes} onChangeText={setLearningOutcomes} placeholder="What learners will be able to do after this course…" multiline numberOfLines={3} textAlignVertical="top" />

      <Label>Agenda / syllabus</Label>
      <TextInput style={[styles.input, styles.textArea]} value={agenda} onChangeText={setAgenda} placeholder="Day-by-day or topic-by-topic plan…" multiline numberOfLines={4} textAlignVertical="top" />

      <Label>Batch timings</Label>
      <TextInput style={styles.input} value={batchTimings} onChangeText={setBatchTimings} placeholder="e.g. Mon–Fri, 9am–12pm" />

      <Label>Registration deadline (optional)</Label>
      <DateField value={registrationDeadline} onChange={setRegistrationDeadline} placeholder="Tap to pick last day to register" minDate={isEdit && origDates.deadline && origDates.deadline < todayStr() ? undefined : todayStr()} maxDate={startDate || undefined} />

      <Label>Discount (₹) — leave blank for none</Label>
      <TextInput style={styles.input} value={discount} onChangeText={setDiscount} placeholder="100" keyboardType="numeric" />

      <Label>Language</Label>
      <TextInput style={styles.input} value={language} onChangeText={setLanguage} placeholder="Tamil" />

      <Label>Eligibility</Label>
      <TextInput style={[styles.input, styles.textArea]} value={eligibility} onChangeText={setEligibility} placeholder="Who can join? Any prerequisites?" multiline numberOfLines={2} textAlignVertical="top" />

      <Label>Trainer name</Label>
      <TextInput style={styles.input} value={trainerName} onChangeText={setTrainerName} placeholder="e.g. Dr. R. Kumar" />

      <Label>About the trainer</Label>
      <TextInput style={[styles.input, styles.textArea]} value={trainerBio} onChangeText={setTrainerBio} placeholder="Qualification, experience, expertise…" multiline numberOfLines={3} textAlignVertical="top" />

      {/* Tamil / Hindi versions of the text learners read. Anything left blank
          falls back to the English text above. */}
      <Pressable style={styles.autoTranslate} onPress={onAutoTranslate} disabled={translating}>
        {translating ? <ActivityIndicator color={theme.colors.primary} /> : <Ionicons name="language-outline" size={18} color={theme.colors.primary} />}
        <Text style={styles.autoTranslateText}>{translating ? 'Translating…' : 'Auto-translate to Tamil + Hindi'}</Text>
      </Pressable>
      <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginTop: 4 }}>Fills only the empty boxes below. You can edit the result before saving.</Text>

      {(['ta', 'hi'] as const).map((lng) => (
        <View key={lng} style={{ marginTop: 18 }}>
          <Text style={styles.heading}>{lng === 'ta' ? 'தமிழ் (Tamil) version' : 'हिन्दी (Hindi) version'}</Text>
          <Text style={{ color: theme.colors.textMuted, fontSize: 12.5, marginBottom: 4 }}>Optional. Shown to learners who choose this language.</Text>
          {([
            ['title', 'Title'], ['description', 'Description'], ['learning_outcomes', 'Learning outcomes'],
            ['agenda', 'Agenda / syllabus'], ['eligibility', 'Eligibility'], ['batch_timings', 'Batch timings'],
            ['trainer_name', 'Trainer name'], ['trainer_bio', 'About the trainer'],
          ] as [TranslatableField, string][]).map(([field, label]) => (
            <View key={field}>
              <Label>{label}</Label>
              <TextInput
                style={[styles.input, field === 'title' || field === 'batch_timings' || field === 'trainer_name' ? {} : styles.textArea]}
                value={translations[lng]?.[field] ?? ''}
                onChangeText={(v) => setTranslations((prev) => ({ ...prev, [lng]: { ...(prev[lng] ?? {}), [field]: v } }))}
                multiline={field !== 'title' && field !== 'batch_timings' && field !== 'trainer_name'}
                textAlignVertical="top"
              />
            </View>
          ))}
        </View>
      ))}

      {/* Certificate toggle */}
      <View style={styles.certRow}>
        <Text style={styles.certText}>Certificate available on completion</Text>
        <Pressable
          style={[styles.certToggle, certificateAvailable ? styles.certToggleOn : {}]}
          onPress={() => setCertificateAvailable((v) => !v)}
        >
          <Text style={styles.certToggleText}>{certificateAvailable ? 'Yes' : 'No'}</Text>
        </Pressable>
      </View>

      {certificateAvailable ? (
        <View style={{ marginTop: 6 }}>
          <Label>Certificate file (PDF or image) — learners can view it on the course page</Label>
          {cert ? (
            <View style={styles.certFile}>
              <Ionicons name="document-text-outline" size={22} color={theme.colors.primary} />
              <Pressable style={{ flex: 1 }} onPress={() => Linking.openURL(cert.url).catch(() => {})}>
                <Text style={styles.certFileName} numberOfLines={1}>{cert.name}</Text>
                <Text style={styles.certFileHint}>Tap to preview</Text>
              </Pressable>
              <Pressable onPress={onUploadCertificate} hitSlop={8} disabled={uploadingCert}><Text style={styles.certFileAction}>Replace</Text></Pressable>
              <Pressable onPress={onRemoveCertificate} hitSlop={8}><Ionicons name="trash-outline" size={20} color={theme.colors.danger} /></Pressable>
            </View>
          ) : (
            <Pressable style={styles.certUpload} onPress={onUploadCertificate} disabled={uploadingCert}>
              {uploadingCert ? <ActivityIndicator color={theme.colors.primary} /> : <Ionicons name="cloud-upload-outline" size={20} color={theme.colors.primary} />}
              <Text style={styles.certUploadText}>{uploadingCert ? 'Uploading…' : 'Upload certificate'}</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {/* Course images */}
      <Label>Course images</Label>
      <View style={styles.imagesRow}>
        {images.map((img, idx) => (
          <View key={img.path} style={styles.imageThumb}>
            <Image source={{ uri: img.url }} style={styles.imageThumb} />
            <Pressable onPress={() => onRemoveImage(idx)} style={styles.imageRemove}>
              <Ionicons name="close-circle" size={22} color={theme.colors.danger} />
            </Pressable>
          </View>
        ))}
        <Pressable style={styles.imageAdd} onPress={onAddImage} disabled={uploadingImage}>
          {uploadingImage ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : (
            <>
              <Ionicons name="add-circle-outline" size={28} color={theme.colors.primary} />
              <Text style={styles.imageAddText}>Add</Text>
            </>
          )}
        </Pressable>
      </View>

      <View style={{ marginTop: 16 }}>
        <Button label={isEdit ? 'Save changes' : 'Publish course'} size="lg" fullWidth loading={saving} onPress={handleSave} />
      </View>

      {isEdit ? (
        <BatchManageModal
          visible={batchModalOpen}
          courseId={id as string}
          onClose={() => setBatchModalOpen(false)}
          onChanged={async () => {
            try { setBatches(await listBatches(id as string)); } catch {}
          }}
        />
      ) : null}
      </FocusGroup>
    </KeyboardAwareScreen>
  );
}

function todayStr() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

function Label({ children }: { children: string }) {
  return <Text style={styles.label}>{children}</Text>;
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: theme.colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headingRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 6,
  },
  heading: { fontSize: theme.font.heading, fontWeight: '800', color: theme.colors.text, marginBottom: 10, flex: 1 },
  manageBatches: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 8,
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
  },
  manageBatchesText: { color: theme.colors.primary, fontWeight: '700', fontSize: 12 },
  label: { fontSize: 13, color: theme.colors.textMuted, marginTop: 12, marginBottom: 4, fontWeight: '600' },
  input: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, backgroundColor: theme.colors.surface,
    color: theme.colors.text,
  },
  textArea: { minHeight: 90 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: theme.colors.textMuted },
  chipTextActive: { color: '#fff' },
  certRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginBottom: 4 },
  certText: { fontSize: 15, color: theme.colors.text, fontWeight: '600', flex: 1 },
  certToggle: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: theme.radius.pill, borderWidth: 1.5, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  certToggleOn: { borderColor: theme.colors.success, backgroundColor: theme.colors.success },
  certToggleText: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  autoTranslate: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18, paddingVertical: 12, borderRadius: theme.radius.md, borderWidth: 1.5, borderColor: theme.colors.primary, backgroundColor: theme.colors.surface },
  autoTranslateText: { color: theme.colors.primary, fontWeight: '700', fontSize: 14 },
  certUpload: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: theme.radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.border },
  certUploadText: { color: theme.colors.primary, fontWeight: '700', fontSize: 14 },
  certFile: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  certFileName: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  certFileHint: { fontSize: 11.5, color: theme.colors.textMuted },
  certFileAction: { fontSize: 13, fontWeight: '700', color: theme.colors.primary },
  imagesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  imageThumb: { width: 96, height: 96, borderRadius: 10, overflow: 'hidden' },
  imageRemove: { position: 'absolute', top: -8, right: -8, backgroundColor: '#fff', borderRadius: 11 },
  imageAdd: { width: 96, height: 96, borderRadius: 10, borderWidth: 1.5, borderColor: theme.colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  imageAddText: { fontSize: 13, fontWeight: '600', color: theme.colors.primary, marginTop: 2 },
});
