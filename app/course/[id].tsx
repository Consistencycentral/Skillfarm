// ===========================================================================
// Course Detail — full course info + Get Directions (Google Maps) +
// Course detail + batch selection + seat request. Dynamic route /course/[id].
// ===========================================================================
import { useState, useCallback, useEffect, type ReactNode } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Linking, Pressable, Image, useWindowDimensions,
  type NativeSyntheticEvent, type NativeScrollEvent,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getCourse, CATEGORY_LABELS, sectorColor, netFee, type CourseWithProvider } from '../../api/courses';
import { getCourseRating } from '../../api/reviews';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SECTOR_ICONS } from '../../lib/sectorIcons';
import { getPublicCourse } from '../../api/landing';
import { courseShareUrl } from '../../lib/deeplink';
import { bookSeats, joinWaitlist, listBookedSeatNumbers, MAX_SEATS_PER_BOOKING, type EnrollmentCapture } from '../../api/registrations';
import { listBatches, ensureLearnerVisibleBatch, type Batch, batchSeatsLeft, isBatchRegistrationOpen } from '../../api/batches';
import { BatchSelector } from '../../components/BatchSelector';
import { useSession } from '../../lib/session';
import { Button } from '../../components/Button';
import { OrganizationCard } from '../../components/OrganizationCard';
import { Reviews } from '../../components/Reviews';
import { ShareButton } from '../../components/ShareButton';
import { theme } from '../../constants/theme';
import { useFocusEffect } from 'expo-router';
import { getMyProfile } from '../../api/profile';
import { supabase } from '../../lib/supabase';
import { SaveCourseButton } from '../../components/SaveCourseButton';
import { addBatchToCalendar } from '../../lib/calendar';
import { rememberRecentCourse } from '../../lib/localPreferences';
import { Alert } from '../../lib/alert';
import { useLanguage } from '../../lib/i18n';
import { localizeCourse } from '../../lib/courseText';
import { BookingFlowModal } from '../../components/BookingFlowModal';

// Build a Google Maps directions URL from a free-text address.
function mapsUrl(c: CourseWithProvider) {
  const parts = [c.address, c.city, c.state].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(parts)}`;
}

function formatDate(d: string | null, fallback = 'Date not set') {
  if (!d) return fallback;
  try { return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

export default function CourseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const { t, lang } = useLanguage();
  // A shared course link opened by someone with no session renders this screen
  // read-only off the anon-safe public view: everything a visitor needs to
  // decide (what, where, when, price, seats, partner) is shown; only the
  // authenticated actions — reviews, enrollment form, partner phone — swap for
  // a "Sign in to register" CTA that returns them here after login.
  const readOnly = !session;
  const [course, setCourse] = useState<CourseWithProvider | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  // True when the partner HAS published events but every one is already over.
  const [onlyPastBatches, setOnlyPastBatches] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  // Up to 6 seats per booking (v8). Tapping a seat toggles it.
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  function toggleSeat(seat: number) {
    if (selectedSeats.includes(seat)) {
      setSelectedSeats(selectedSeats.filter((n) => n !== seat));
      return;
    }
    if (selectedSeats.length >= MAX_SEATS_PER_BOOKING) {
      Alert.alert(t.seatsPickedMax ?? 'You can pick up to 6 seats.');
      return;
    }
    setSelectedSeats([...selectedSeats, seat].sort((a, b) => a - b));
  }
  const [bookedSeats, setBookedSeats] = useState<number[]>([]);
  const [myRegistrationStatus, setMyRegistrationStatus] = useState<string | null>(null);
  const [myRegistrationId, setMyRegistrationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Enrollment-form modal state.
  const [formOpen, setFormOpen] = useState(false);
  const [fName, setFName] = useState('');
  const [fPhone, setFPhone] = useState('');
  const [fEmail, setFEmail] = useState('');
  const [fAge, setFAge] = useState('');
  const [fLocation, setFLocation] = useState('');
  const [fExperience, setFExperience] = useState<boolean | null>(null);
  const [fAdditionalDetails, setFAdditionalDetails] = useState('');
  // Bumped after a successful seat request so <Reviews> re-reads my registration
  // status and offers the rating form without needing a screen change.
  const [reviewsKey, setReviewsKey] = useState(0);
  const [rating, setRating] = useState<{ avg: number; count: number } | null>(null);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!course?.id) return;
    let alive = true;
    getCourseRating(course.id).then((r) => { if (alive) setRating(r); }).catch(() => { if (alive) setRating(null); });
    return () => { alive = false; };
  }, [course?.id, reviewsKey]);

  async function loadMyRegistration(courseId: string, batchId: string | null): Promise<string | null> {
    // Always clear the previous batch/user state before querying. This prevents
    // a previous learner/batch's status from flashing as 'Registered'.
    setMyRegistrationStatus(null);
    setMyRegistrationId(null);
    // IMPORTANT: registration belongs to the authenticated user id, not the
    // email typed into the form. Never infer 'registered' from course/batch
    // capacity or another learner's email.
    if (!session?.user?.id || !batchId) { setMyRegistrationStatus(null); setMyRegistrationId(null); return null; }
    try {
      const { data, error } = await supabase
        .from('registrations')
        .select('id,status,registered_at')
        .eq('course_id', courseId)
        .eq('batch_id', batchId)
        .eq('student_id', session.user.id)
        .limit(1)
        .in('status', ['pending','registered','waitlist','completed'])
        .order('registered_at', { ascending: false });
      if (error) throw error;
      const status = Array.isArray(data) && data.length ? String(data[0]?.status ?? '') : null;
      const registrationId = Array.isArray(data) && data.length ? String(data[0]?.id ?? '') : null;
      const normalized = status && ['pending','registered','waitlist','completed'].includes(status) ? status : null;
      setMyRegistrationStatus(normalized);
      setMyRegistrationId(registrationId || null);
      return normalized;
    } catch {
      // A missing/older registrations view must NEVER make a new learner look registered.
      setMyRegistrationStatus(null);
      setMyRegistrationId(null);
      return null;
    }
  }

  // `silent` refreshes the data WITHOUT the full-screen spinner. The booking modal lives
  // inside this screen, so showing the spinner unmounts it and wipes its "Seat request sent"
  // state — the learner would be dumped back on step 1 even though the booking succeeded.
  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!id) return;
    try {
      setError(null); if (!opts?.silent) setLoading(true);
      if (readOnly) {
        const pub = await getPublicCourse(id as string);
        if (!pub) {
          setCourse(null);
          setBatches([]);
          setSelectedBatchId(null);
          setError('This course is no longer listed — it may have been removed or the partner went inactive.');
        } else {
          setCourse(pub);
          try {
            // Prefer the real published batch. If an older course was saved
            // before the batch system was deployed, ask the server-side
            // compatibility RPC to materialize its published event as Batch 1.
            // This is still a real DB batch (not a local/fake seat map).
            let dbBatches = await listBatches(pub.id);
            if (dbBatches.length === 0) {
              try { await ensureLearnerVisibleBatch(pub.id); } catch {}
              dbBatches = await listBatches(pub.id);
            }
            const nextBatches = dbBatches.filter((b) => !b.start_date || new Date(`${b.start_date}T23:59:59`).getTime() >= Date.now());
            setBatches(nextBatches);
            setOnlyPastBatches(dbBatches.length > 0 && nextBatches.length === 0);
            const nextSelectedId = (selectedBatchId && nextBatches.some((b) => b.id === selectedBatchId)) ? selectedBatchId : (nextBatches[0]?.id ?? null);
            setSelectedBatchId(nextSelectedId);
            setSelectedSeats([]);
            if (nextSelectedId) { const b = nextBatches.find((x) => x.id === nextSelectedId); try { setBookedSeats(await listBookedSeatNumbers(nextSelectedId, b?.seats_total ?? 200)); } catch { setBookedSeats([]); } await loadMyRegistration(pub.id, nextSelectedId); } else { setBookedSeats([]); setMyRegistrationStatus(null); }
          } catch {
            setBatches([]);
            setSelectedBatchId(null);
          }
        }
      } else {
        const nextCourse = await getCourse(id as string);
        setCourse(nextCourse);
        try {
          // Prefer the real published batch. For legacy courses, the
          // security-definer compatibility RPC creates/syncs a real Batch 1
          // from the Learning Partner's published event fields.
          let dbBatches = await listBatches(nextCourse.id);
          if (dbBatches.length === 0) {
            try { await ensureLearnerVisibleBatch(nextCourse.id); } catch {}
            dbBatches = await listBatches(nextCourse.id);
          }
          const nextBatches = dbBatches.filter((b) => !b.start_date || new Date(`${b.start_date}T23:59:59`).getTime() >= Date.now());
          setBatches(nextBatches);
          setOnlyPastBatches(dbBatches.length > 0 && nextBatches.length === 0);
          const nextSelectedId = (selectedBatchId && nextBatches.some((b) => b.id === selectedBatchId)) ? selectedBatchId : (nextBatches[0]?.id ?? null);
            setSelectedBatchId(nextSelectedId);
            setSelectedSeats([]);
            if (nextSelectedId) { const b = nextBatches.find((x) => x.id === nextSelectedId); try { setBookedSeats(await listBookedSeatNumbers(nextSelectedId, b?.seats_total ?? 200)); } catch { setBookedSeats([]); } await loadMyRegistration(nextCourse.id, nextSelectedId); } else { setBookedSeats([]); setMyRegistrationStatus(null); }
        } catch {
          setBatches([]);
          setSelectedBatchId(null);
        }
      }
    } catch (e: any) {
      setError(e?.message ?? 'Could not load this course.');
    } finally {
      setLoading(false);
    }
  }, [id, readOnly]);

  useFocusEffect(useCallback(() => { load(); if (id) rememberRecentCourse(id as string); }, [load, id]));

  // Keep the seat map fresh while the learner is choosing. The final booking
  // RPC is still atomic, so this polling is only a UX refresh and never the
  // authority for whether a seat is actually available.
  useEffect(() => {
    if (!formOpen || !selectedBatchId) return;
    const timer = setInterval(async () => {
      const batch = batches.find((b) => b.id === selectedBatchId);
      if (!batch) return;
      try {
        const latest = await listBookedSeatNumbers(selectedBatchId, batch.seats_total);
        setBookedSeats(latest);
      } catch {}
    }, 3000);
    return () => clearInterval(timer);
  }, [formOpen, selectedBatchId, batches]);

  async function openEnrollmentForm() {
    try {
      const profile = await getMyProfile();
      const { data } = await supabase.auth.getUser();
      setFName(profile?.full_name ?? profile?.first_name ?? '');
      setFPhone(profile?.phone ?? '');
      setFEmail(data.user?.email ?? '');
      setFLocation((profile as any)?.location ?? (profile as any)?.city ?? course?.city ?? '');
      setFAge((profile as any)?.age != null ? String((profile as any).age) : '');
      const savedExperience = (profile as any)?.previous_experience;
      setFExperience(typeof savedExperience === 'boolean' ? savedExperience : null);
      setFAdditionalDetails('');
      setFormOpen(true);
    } catch {
      setFormOpen(true);
    }
  }

  // Opens the BookMyShow-style 3-step flow: Batch -> Seat -> Your details.
  async function handleRegister() {
    if (!course) return;
    if (selectedBatchId) {
      const existingStatus = await loadMyRegistration(course.id, selectedBatchId);
      if (existingStatus) return;
    }
    if (batches.length > 0) {
      const selected = batches.find((b) => b.id === selectedBatchId);
      if (!selected) {
        Alert.alert(t.selectBatch, t.selectBatchSub);
        return;
      }
      if (!isBatchRegistrationOpen(selected)) {
        Alert.alert(t.registrationClosed ?? 'Registration closed', t.tryAgain);
        return;
      }
    }
    setFAge(''); setFLocation(''); setFExperience(null); setFAdditionalDetails('');
    await openEnrollmentForm();
  }

  async function confirmRegister(): Promise<boolean> {
    if (!course) return false;
    const selectedBatch = selectedBatchId ? batches.find((b) => b.id === selectedBatchId) : null;
    if (batches.length > 0 && !selectedBatch) {
      Alert.alert(t.selectBatch, t.selectBatchSub);
      return false;
    }
    if (selectedBatch && !isBatchRegistrationOpen(selectedBatch)) {
      Alert.alert(t.registrationClosed ?? 'Registration closed', t.tryAgain);
      return false;
    }
    if (selectedSeats.length === 0) {
      Alert.alert('Choose a seat', 'Please select at least one available seat before booking.');
      return false;
    }
    if (selectedSeats.some((n) => bookedSeats.includes(n))) {
      setSelectedSeats((prev) => prev.filter((n) => !bookedSeats.includes(n)));
      Alert.alert(t.seatUnavailable ?? 'Seat unavailable', t.seatUnavailableSub ?? 'That seat has just been booked. Please choose another available seat.');
      if (selectedBatchId) setBookedSeats(await listBookedSeatNumbers(selectedBatchId, selectedBatch?.seats_total ?? 200));
      return false;
    }
    if (!fName.trim()) { Alert.alert(t.nameRequired, t.nameRequiredSub); return false; }
    if (!fPhone.trim()) { Alert.alert(t.contactRequired, t.contactRequiredSub); return false; }
    if (!fEmail.trim() || !/.+@.+\..+/.test(fEmail.trim())) { Alert.alert(t.emailRequired, t.emailRequiredSub); return false; }
    if (fExperience === null) { Alert.alert(t.previousExperience, t.previousExperienceSub); return false; }

    const capture: EnrollmentCapture = {
      name: fName.trim(), phone: fPhone.trim(), email: fEmail.trim(), age: fAge.trim(),
      location: fLocation.trim(), experience: fExperience, additionalDetails: fAdditionalDetails.trim(),
      preferredSeatNumber: selectedSeats[0] ?? null,
    };

    setRegistering(true);
    try {
      if (!selectedBatchId) return false;
      const result = await bookSeats(course.id, selectedBatchId, selectedSeats, capture);
      if (!result.ok) {
        Alert.alert('Seats could not be booked', result.error ?? 'Please choose again and try again.');
        setBookedSeats(await listBookedSeatNumbers(selectedBatchId, selectedBatch?.seats_total ?? 200));
        return false;
      }
      // A new booking is a seat request: the seat is held and waits for the
      // Learning Partner to approve it. There is no payment step.
      setMyRegistrationStatus(result.status === 'registered' ? 'registered' : 'pending');
      setReviewsKey((k) => k + 1);
      setBookedSeats(await listBookedSeatNumbers(selectedBatchId, selectedBatch?.seats_total ?? 200));
      await load({ silent: true });
      return true;
    } catch (e: any) {
      Alert.alert('Booking failed', e?.message ?? 'Please try again.');
      return false;
    } finally {
      setRegistering(false);
    }
  }

  // Full batch: join the waitlist instead of booking a seat. No seat is held; if a seat
  // is released the oldest waitlisted learner is promoted automatically (server side).
  // Deliberately does NOT call load(): that shows the full-screen spinner and would
  // unmount the booking modal before it can show the "You're on the waitlist" screen.
  async function confirmJoinWaitlist(): Promise<boolean> {
    if (!course || !selectedBatchId) return false;
    const batch = batches.find((b) => b.id === selectedBatchId);
    if (!batch) { Alert.alert(t.selectBatch, t.selectBatchSub); return false; }
    if (!isBatchRegistrationOpen(batch)) { Alert.alert(t.registrationClosed ?? 'Registration closed', t.tryAgain); return false; }
    if (!fName.trim()) { Alert.alert(t.nameRequired, t.nameRequiredSub); return false; }
    if (!fPhone.trim()) { Alert.alert(t.contactRequired, t.contactRequiredSub); return false; }
    if (!fEmail.trim() || !/.+@.+\..+/.test(fEmail.trim())) { Alert.alert(t.emailRequired, t.emailRequiredSub); return false; }
    if (fExperience === null) { Alert.alert(t.previousExperience, t.previousExperienceSub); return false; }

    const capture: EnrollmentCapture = {
      name: fName.trim(), phone: fPhone.trim(), email: fEmail.trim(), age: fAge.trim(),
      location: fLocation.trim(), experience: fExperience, additionalDetails: fAdditionalDetails.trim(),
    };

    setRegistering(true);
    try {
      const result = await joinWaitlist(course.id, selectedBatchId, capture);
      if (!result.ok) {
        Alert.alert('Could not join the waitlist', result.error ?? 'Please try again.');
        return false;
      }
      setMyRegistrationStatus('waitlist');
      setMyRegistrationId(result.registration_id ?? null);
      return true;
    } catch (e: any) {
      Alert.alert('Could not join the waitlist', e?.message ?? 'Please try again.');
      return false;
    } finally {
      setRegistering(false);
    }
  }

  function handleDirections() {
    if (!course) return;
    Linking.openURL(mapsUrl(course)).catch(() =>
      Alert.alert('Maps', t.cd_directionsFail)
    );
  }

  function handleCall() {
    if (!course?.contact_phone) return;
    Linking.openURL(`tel:${course.contact_phone}`).catch(() => {});
  }

  const selectedBatch = selectedBatchId ? batches.find((b) => b.id === selectedBatchId) : null;
  const nextBatch = batches.find((b) => !b.start_date || new Date(`${b.start_date}T23:59:59`).getTime() >= Date.now()) ?? null;
  const selectedBatchFull = !!selectedBatch && batchSeatsLeft(selectedBatch) === 0;
  const selectedBatchClosed = !!selectedBatch && !isBatchRegistrationOpen(selectedBatch);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
  }
  if (error || !course) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={48} color={theme.colors.border} />
        <Text style={styles.errTitle}>Could not load course</Text>
        <Text style={styles.errMsg}>{error ?? 'Unknown error'}</Text>
        <Button label="Go to SkillFarm" variant="outline" onPress={() => router.replace('/')} />
      </View>
    );
  }

  // The published batch is the single source of truth for booking capacity.
  // Never fall back to course-level seats for an actual booking decision; doing
  // so can make the course card say 39 left while the booking batch says full.
  const view = localizeCourse(course, lang);
  const bookingBatch = selectedBatch ?? nextBatch;
  const batchLeft = bookingBatch ? batchSeatsLeft(bookingBatch) : null;
  const full = bookingBatch ? batchLeft === 0 : false;
  const left = bookingBatch ? batchLeft ?? 0 : null;

  const price = netFee(course);
  const hasDiscount = Number(course.discount ?? 0) > 0 && Number(course.fee ?? 0) > price;
  const place = [course.city, course.state].filter(Boolean).join(', ') || course.address || '';
  const registered = myRegistrationStatus === 'registered' || myRegistrationStatus === 'completed';
  const ctaLabel = readOnly
    ? (full ? t.cd_joinWaitlist : 'Sign in to book')
    : registered ? t.cd_seatBooked
    : myRegistrationStatus === 'pending' ? t.cd_requestSent
    : myRegistrationStatus === 'waitlist' ? t.alreadyWaitlist
    : selectedBatchClosed ? t.registrationClosed
    : (selectedBatchFull ? t.cd_joinWaitlist : t.cd_bookSeat);
  const statusHint = readOnly
    ? `You're viewing a shared link. Sign in or create a free account to book a seat with ${course.provider_name ?? 'this Learning Partner'}.`
    : registered ? t.cd_hintConfirmed
    : myRegistrationStatus === 'pending' ? t.cd_hintPending
    : myRegistrationStatus === 'waitlist' ? t.wl_doneBody
    : selectedBatchFull ? t.wl_fullBody
    : null;

  function onCta() {
    if (readOnly) { router.push({ pathname: '/login', params: { next: `/course/${course!.id}` } }); return; }
    if (registered) { router.push(`/materials/${course!.id}`); return; }
    if (myRegistrationStatus === 'pending') { router.push('/(student)/my-registrations'); return; }
    void handleRegister();
  }

  return (
    <View style={styles.root}>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 120 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <HeroCarousel
          course={course}
          topInset={insets.top}
          onBack={() => { if (router.canGoBack()) router.back(); else router.replace('/'); }}
          right={
            <>
              <View style={styles.heroBtn}><SaveCourseButton courseId={course.id} size={20} /></View>
              <View style={styles.heroBtn}>
                <ShareButton
                  message={`Check out this course: ${course.title} by ${course.provider_name ?? 'our Learning Partner'}`}
                  url={courseShareUrl(course.id)}
                  variant="ghost"
                  size={22}
                  color={theme.colors.text}
                />
              </View>
            </>
          }
        />

        {/* Title block: title, partner (verified), rating, price — one unit. */}
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{view.title}</Text>
          <View style={styles.providerRow}>
            <Ionicons name="business-outline" size={15} color={theme.colors.textMuted} />
            <Text style={styles.provider} numberOfLines={1}>{course.provider_name ?? 'Learning Partner'}</Text>
            {course.provider_active !== false ? (
              <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} accessibilityLabel="Verified partner" />
            ) : null}
          </View>
          <View style={styles.ratingPriceRow}>
            <View style={styles.ratingWrap}>
              {rating && rating.count > 0 ? (
                <>
                  <Ionicons name="star" size={15} color="#E9A21B" />
                  <Text style={styles.ratingValue}>{rating.avg.toFixed(1)}</Text>
                  <Text style={styles.ratingCount}>({rating.count} {rating.count === 1 ? 'review' : 'reviews'})</Text>
                </>
              ) : (
                <Text style={styles.ratingCount}>No reviews yet</Text>
              )}
            </View>
            <View style={styles.priceWrap}>
              {hasDiscount ? <Text style={styles.priceStrike}>₹{Number(course.fee).toLocaleString('en-IN')}</Text> : null}
              <Text style={styles.priceMain}>{price === 0 ? t.cd_free : `₹${price.toLocaleString('en-IN')}`}</Text>
            </View>
          </View>
        </View>

        {/* Key facts: date, time, seats left (+ duration under the date). */}
        <View style={styles.factsRow}>
          <FactTile
            icon="calendar-outline"
            label={t.cd_starts}
            value={formatShortDate(bookingBatch?.start_date ?? course.start_date, t.cd_dateNotSet)}
            sub={bookingBatch?.duration_weeks ? `${bookingBatch.duration_weeks} week${bookingBatch.duration_weeks === 1 ? '' : 's'}` : undefined}
          />
          <FactTile icon="time-outline" label={t.cd_timing} value={bookingBatch?.timings ?? view.batch_timings ?? t.cd_notSet} />
          <FactTile
            icon="ticket-outline"
            label={t.cd_seatsLeft}
            value={bookingBatch ? (batchLeft === 0 ? t.cd_full : String(batchLeft)) : '—'}
            sub={bookingBatch ? `${t.cd_of} ${bookingBatch.seats_total}` : t.cd_eventNotPublished}
            tone={!bookingBatch ? 'neutral' : full ? 'teal' : (batchLeft ?? 99) <= 5 ? 'warning' : 'success'}
          />
        </View>

        {statusHint ? (
          <View style={styles.hintBanner}>
            <Ionicons name="information-circle-outline" size={18} color={theme.colors.primary} />
            <Text style={styles.hintBannerText}>{statusHint}</Text>
          </View>
        ) : null}

        {/* Batch choice stays on the page so date/time/seats above follow it. */}
        {batches.length > 0 && (
          <View style={styles.blockPad}>
            <Text style={styles.blockTitle}>{t.cd_chooseBatch}</Text>
            <Text style={styles.batchHint}>{t.cd_chooseBatchHint}</Text>
            <BatchSelector
              batches={batches}
              selectedBatchId={selectedBatchId}
              onSelect={async (batch) => { setSelectedBatchId(batch.id); setSelectedSeats([]); setBookedSeats(await listBookedSeatNumbers(batch.id, batch.seats_total)); await loadMyRegistration(course.id, batch.id); }}
            />
            {selectedBatch?.start_date ? (
              <Pressable
                style={styles.calendarBtn}
                onPress={() => addBatchToCalendar(course.title, selectedBatch, [course.address, course.city, course.state].filter(Boolean).join(', ')).catch((e) => Alert.alert('Calendar unavailable', e?.message ?? 'Could not open your calendar.'))}
                accessibilityRole="button"
                accessibilityLabel="Add selected batch to calendar"
              >
                <Ionicons name="calendar-outline" size={18} color={theme.colors.primary} />
                <Text style={styles.calendarText}>{t.cd_addCalendar}</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        {/* Collapsible sections */}
        <View style={styles.blockPad}>
          <Collapsible title="About" icon="information-circle-outline" defaultOpen>
            {view.description ? <Text style={styles.bodyText}>{view.description}</Text> : null}
            <View style={styles.detailList}>
              {course.language ? <InfoRow icon="language-outline" label={t.cd_language} value={course.language} /> : null}
              {course.certificate_available ? <InfoRow icon="ribbon-outline" label={t.cd_certificate} value={t.cd_availableOnCompletion} /> : null}
              {view.trainer_name ? <InfoRow icon="person-outline" label={t.cd_trainer ?? 'Trainer'} value={view.trainer_name} /> : null}
              {course.registration_deadline ? <InfoRow icon="alarm-outline" label={t.cd_regDeadline} value={formatDate(course.registration_deadline, t.cd_dateNotSet)} /> : null}
              {hasDiscount ? <InfoRow icon="pricetag-outline" label={t.cd_discount} value={`₹${course.discount} ${t.cd_off}`} /> : null}
              <InfoRow icon="call-outline" label={t.cd_contact} value={course.contact_phone ?? t.cd_notProvided} />
            </View>
            {view.eligibility ? (<><Text style={styles.subTitle}>{t.cd_eligibility}</Text><Text style={styles.bodyText}>{view.eligibility}</Text></>) : null}
            {view.agenda ? (<><Text style={styles.subTitle}>{t.cd_agenda}</Text><Text style={styles.bodyText}>{view.agenda}</Text></>) : null}
            {view.batch_timings ? (<><Text style={styles.subTitle}>{t.cd_batchTimings}</Text><Text style={styles.bodyText}>{view.batch_timings}</Text></>) : null}
            {view.trainer_bio ? (<><Text style={styles.subTitle}>{t.cd_trainer ?? 'Trainer'}</Text><Text style={styles.bodyText}>{view.trainer_bio}</Text></>) : null}
            {course.certificate_available && course.certificate_url ? (
              <Pressable
                onPress={() => Linking.openURL(course.certificate_url as string).catch(() => Alert.alert('Certificate', 'Could not open the certificate file.'))}
                style={styles.callBtn}
                accessibilityRole="link"
              >
                <Ionicons name="ribbon-outline" size={16} color={theme.colors.primary} />
                <Text style={styles.callText}>{t.cd_viewCertificate ?? 'View sample certificate'}</Text>
              </Pressable>
            ) : null}
            <Text style={styles.subTitle}>{t.cd_aboutPartner}</Text>
            <OrganizationCard providerId={course.provider_id} />
          </Collapsible>

          {view.learning_outcomes ? (
            <Collapsible title="What you’ll learn" icon="bulb-outline" defaultOpen>
              <Text style={styles.bodyText}>{view.learning_outcomes}</Text>
            </Collapsible>
          ) : null}

          <Collapsible title={t.cd_location} icon="location-outline">
            <View style={styles.addressRow}>
              <Ionicons name="location" size={20} color={theme.colors.primary} />
              <Text style={styles.address}>
                {course.address}{course.city ? `\n${course.city}` : ''}{course.state ? `, ${course.state}` : ''}
              </Text>
            </View>
            <Button label={t.cd_getDirections} variant="outline" size="lg" fullWidth icon="navigate-outline" onPress={handleDirections} />
            {course.contact_phone ? (
              <Pressable onPress={handleCall} style={styles.callBtn}>
                <Ionicons name="call" size={16} color={theme.colors.primary} />
                <Text style={styles.callText}>{t.cd_callPartner}</Text>
              </Pressable>
            ) : null}
          </Collapsible>

          {/* Reviews & ratings. Signed-in learners can review without an approved seat. */}
          {!readOnly ? (
            <Collapsible title={t.cd_reviews} icon="star-outline" badge={rating && rating.count > 0 ? rating.avg.toFixed(1) : undefined}>
              <Reviews courseId={course.id} providerId={course.provider_id} reloadKey={reviewsKey} />
            </Collapsible>
          ) : null}
        </View>
      </ScrollView>

      {/* Sticky booking bar — the action is always one thumb-tap away. */}
      <View style={[styles.stickyBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.stickyPrice}>
          <Text style={styles.stickyLabel}>{price === 0 ? 'Entry' : 'Price per seat'}</Text>
          <View style={styles.stickyPriceRow}>
            <Text style={styles.stickyAmount}>{price === 0 ? t.cd_free : `₹${price.toLocaleString('en-IN')}`}</Text>
            {hasDiscount ? <Text style={styles.stickyStrike}>₹{Number(course.fee).toLocaleString('en-IN')}</Text> : null}
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label={ctaLabel}
            size="lg"
            fullWidth
            loading={registering}
            disabled={registering || myRegistrationStatus === 'waitlist' || (!readOnly && !registered && myRegistrationStatus !== 'pending' && selectedBatchClosed)}
            onPress={onCta}
          />
        </View>
      </View>

      <BookingFlowModal
        visible={formOpen}
        batches={batches}
        selectedBatchId={selectedBatchId}
        bookedSeats={bookedSeats}
        selectedSeats={selectedSeats}
        courseTitle={view.title}
        courseLocation={[course.city, course.state].filter(Boolean).join(', ') || course.address || ''}
        bookingFee={Math.max(0, Number(course.fee ?? 0) - Number(course.discount ?? 0))}
        loading={registering}
        onlyPastBatches={onlyPastBatches}
        form={{
          name: fName, phone: fPhone, email: fEmail, age: fAge, location: fLocation,
          experience: fExperience, additionalDetails: fAdditionalDetails,
        }}
        onChangeForm={(key, value) => {
          if (key === 'name') setFName(String(value));
          if (key === 'phone') setFPhone(String(value));
          if (key === 'email') setFEmail(String(value));
          if (key === 'age') setFAge(String(value));
          if (key === 'location') setFLocation(String(value));
          if (key === 'experience') setFExperience(value as boolean | null);
          if (key === 'additionalDetails') setFAdditionalDetails(String(value));
        }}
        onSelectBatch={async (batch) => {
          setSelectedBatchId(batch.id);
          setSelectedSeats([]);
          setBookedSeats(await listBookedSeatNumbers(batch.id, batch.seats_total));
          await loadMyRegistration(course.id, batch.id);
        }}
        onSelectSeat={toggleSeat}
        onConfirm={confirmRegister}
        onJoinWaitlist={confirmJoinWaitlist}
        onRefreshBatches={() => load({ silent: true })}
        onViewMySeats={() => { setFormOpen(false); router.push('/(student)/my-registrations'); }}
        onClose={() => { setFormOpen(false); }}
      />
    </View>
  );
}

function formatShortDate(d: string | null, fallback = 'Date not set') {
  if (!d) return fallback;
  try { return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }
  catch { return d; }
}

function InfoRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={18} color={theme.colors.primary} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

// ------------------------------------------------------------ Key fact tile
function FactTile({ icon, label, value, sub, tone = 'neutral' }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; value: string; sub?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'teal';
}) {
  const fg = tone === 'success' ? theme.colors.success : tone === 'warning' ? theme.colors.warning : tone === 'teal' ? theme.colors.teal : theme.colors.primary;
  const bg = tone === 'success' ? theme.colors.successBg : tone === 'warning' ? theme.colors.warningBg : tone === 'teal' ? theme.colors.tealBg : theme.colors.primaryTint;
  return (
    <View style={styles.fact}>
      <View style={[styles.factIcon, { backgroundColor: bg }]}><Ionicons name={icon} size={17} color={fg} /></View>
      <Text style={styles.factLabel} numberOfLines={1}>{label}</Text>
      <Text style={styles.factValue} numberOfLines={2}>{value}</Text>
      {sub ? <Text style={styles.factSub} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

// -------------------------------------------------------------- Collapsible
function Collapsible({ title, icon, badge, defaultOpen = false, children }: {
  title: string; icon: keyof typeof Ionicons.glyphMap; badge?: string; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={styles.collapsible}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={styles.collapsibleHead}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
      >
        <View style={styles.collapsibleIcon}><Ionicons name={icon} size={17} color={theme.colors.primary} /></View>
        <Text style={styles.collapsibleTitle}>{title}</Text>
        {badge ? (
          <View style={styles.badge}><Ionicons name="star" size={11} color="#E9A21B" /><Text style={styles.badgeText}>{badge}</Text></View>
        ) : null}
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={theme.colors.textMuted} />
      </Pressable>
      {open ? <View style={styles.collapsibleBody}>{children}</View> : null}
    </View>
  );
}

// ------------------------------------------------------------ Hero carousel
// Full-width paging photo carousel. Back / save / share float over the photo on
// translucent circles. No photos -> sector colour + icon.
function HeroCarousel({ course, topInset, onBack, right }: {
  course: CourseWithProvider; topInset: number; onBack: () => void; right: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const height = Math.round(Math.min(width * 0.72, 380));
  const photos = (course.images && course.images.length > 0 ? course.images : course.image_url ? [course.image_url] : []).filter(Boolean) as string[];
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Record<number, boolean>>({});
  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  }
  const fallback = (
    <View style={[{ width, height }, styles.heroFallback, { backgroundColor: sectorColor(course.category) }]}>
      <Ionicons name={SECTOR_ICONS[course.category]} size={72} color="rgba(255,255,255,0.9)" />
    </View>
  );
  return (
    <View style={{ width, height, backgroundColor: theme.colors.surfaceAlt }}>
      {photos.length === 0 ? fallback : (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={16}>
          {photos.map((uri, i) => failed[i]
            ? <View key={i}>{fallback}</View>
            : <Image key={i} source={{ uri }} style={{ width, height }} resizeMode="cover" onError={() => setFailed((f) => ({ ...f, [i]: true }))} />)}
        </ScrollView>
      )}
      <View pointerEvents="none" style={styles.heroScrim} />
      <View style={[styles.heroTop, { paddingTop: Math.max(topInset, 10) + 4 }]}>
        <Pressable onPress={onBack} style={styles.heroBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={22} color={theme.colors.text} />
        </Pressable>
        <View style={styles.heroRight}>{right}</View>
      </View>
      <View style={styles.heroBottom} pointerEvents="none">
        <View style={styles.heroChip}><Text style={styles.heroChipText} numberOfLines={1}>{CATEGORY_LABELS[course.category]}</Text></View>
        {photos.length > 1 ? (
          <View style={styles.dots}>
            {photos.map((_, i) => <View key={i} style={[styles.dot, i === index && styles.dotOn]} />)}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  container: { flex: 1, backgroundColor: theme.colors.background },
  heroScrim: { position: 'absolute', left: 0, right: 0, top: 0, height: 110, backgroundColor: 'rgba(0,0,0,0.22)' },
  heroFallback: { alignItems: 'center', justifyContent: 'center' },
  heroTop: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  heroRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.88)', alignItems: 'center', justifyContent: 'center' },
  heroBottom: { position: 'absolute', left: 16, right: 16, bottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroChip: { maxWidth: '70%', backgroundColor: 'rgba(255,255,255,0.94)', paddingHorizontal: 11, paddingVertical: 5, borderRadius: theme.radius.pill },
  heroChipText: { fontSize: 12, fontWeight: '700', color: theme.colors.primaryDark },
  dots: { flexDirection: 'row', gap: 5, backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 8, paddingVertical: 5, borderRadius: theme.radius.pill },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotOn: { width: 16, backgroundColor: '#fff' },
  titleBlock: { backgroundColor: theme.colors.surface, marginTop: -18, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  title: { fontSize: 23, fontWeight: '800', color: theme.colors.text, lineHeight: 31, letterSpacing: -0.3 },
  providerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  provider: { fontSize: 14.5, color: theme.colors.textMuted, fontWeight: '600', flexShrink: 1 },
  ratingPriceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, gap: 12 },
  ratingWrap: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  ratingValue: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  ratingCount: { fontSize: 13, color: theme.colors.textMuted },
  priceWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  priceStrike: { fontSize: 14, color: theme.colors.textSubtle, textDecorationLine: 'line-through' },
  priceMain: { fontSize: 24, fontWeight: '800', color: theme.colors.primary },
  factsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginTop: 14 },
  fact: { flex: 1, backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, padding: 12, ...theme.shadow.card },
  factIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  factLabel: { fontSize: 11.5, color: theme.colors.textMuted, fontWeight: '600' },
  factValue: { fontSize: 15, fontWeight: '800', color: theme.colors.text, marginTop: 2 },
  factSub: { fontSize: 11.5, color: theme.colors.textMuted, marginTop: 2 },
  hintBanner: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginHorizontal: 16, marginTop: 14, padding: 12, borderRadius: theme.radius.md, backgroundColor: theme.colors.primaryTint, borderWidth: 1, borderColor: theme.colors.primaryLight },
  hintBannerText: { flex: 1, fontSize: 13.5, color: theme.colors.text, lineHeight: 20 },
  blockPad: { paddingHorizontal: 16, marginTop: 18 },
  blockTitle: { fontSize: 18, fontWeight: '800', color: theme.colors.text, marginBottom: 6 },
  subTitle: { fontSize: 15, fontWeight: '800', color: theme.colors.text, marginTop: 14, marginBottom: 6 },
  detailList: { marginTop: 6 },
  collapsible: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 12, overflow: 'hidden' },
  collapsibleHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 14 },
  collapsibleIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: theme.colors.primaryTint, alignItems: 'center', justifyContent: 'center' },
  collapsibleTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: theme.colors.text },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: theme.colors.warningBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill },
  badgeText: { fontSize: 12, fontWeight: '700', color: theme.colors.warning },
  collapsibleBody: { paddingHorizontal: 14, paddingBottom: 16, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 12 },
  stickyBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingTop: 12, backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border, ...theme.shadow.raised },
  stickyPrice: { minWidth: 96 },
  stickyLabel: { fontSize: 11.5, color: theme.colors.textMuted, fontWeight: '600' },
  stickyPriceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 1 },
  stickyAmount: { fontSize: 21, fontWeight: '800', color: theme.colors.text },
  stickyStrike: { fontSize: 12.5, color: theme.colors.textSubtle, textDecorationLine: 'line-through' },
  seatSummary:{marginTop:12,flexDirection:'row',justifyContent:'space-between',padding:16,borderRadius:22,backgroundColor:'rgba(255,255,255,0.72)',borderWidth:1,borderColor:'rgba(255,255,255,0.92)',shadowColor:'#16351D',shadowOpacity:0.08,shadowRadius:18,shadowOffset:{width:0,height:8},elevation:4},
  seatSummaryValue:{fontSize:19,fontWeight:'900',color:theme.colors.text},seatSummaryLabel:{fontSize:11,color:theme.colors.textMuted,marginTop:2},
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: theme.colors.background },
  errTitle: { fontSize: theme.font.title, fontWeight: '800', color: theme.colors.text, marginTop: 12 },
  errMsg: { fontSize: 14, color: theme.colors.textMuted, marginTop: 4, marginBottom: 16, textAlign: 'center' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: -16, paddingHorizontal: 16, paddingVertical: 8,
    marginBottom: 6, backgroundColor: theme.colors.background,
  },
  topBarLogo: { fontSize: 16, fontWeight: '900', color: theme.colors.primary },
  chip: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor:'rgba(255,255,255,0.72)', borderWidth:1, borderColor:'rgba(255,255,255,0.9)' },
  emailHeaderRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  changeAccountText:{fontSize:12,fontWeight:'800',color:theme.colors.primary,marginTop:10,marginBottom:6},
  identityHint:{fontSize:11,color:theme.colors.textMuted,marginTop:6,lineHeight:16},
  readOnlyInput:{backgroundColor:theme.colors.surfaceAlt,borderColor:theme.colors.border},
  chipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  description: { fontSize: 15, color: theme.colors.text, lineHeight: 22, marginBottom: 16 },
  sectionTitle: { fontSize: theme.font.title, fontWeight: '800', color: theme.colors.text, marginTop: 16, marginBottom: 8 },
  infoCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: 16, borderWidth: 1, borderColor: theme.colors.border, ...theme.shadow.card },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  infoLabel: { fontSize: 14, color: theme.colors.textMuted, width: 90 },
  infoValue: { fontSize: 15, color: theme.colors.text, fontWeight: '600', flex: 1 },
  addressRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  address: { fontSize: 15, color: theme.colors.text, flex: 1, lineHeight: 22 },
  callBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 12, paddingVertical: 8 },
  callText: { color: theme.colors.primary, fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 12, color: theme.colors.textMuted, textAlign: 'center', marginTop: 10 },
  visitorNote: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: theme.colors.border,
  },
  visitorNoteText: { flex: 1, fontSize: 13.5, color: theme.colors.text, lineHeight: 19 },
  gallery: { marginHorizontal: -16, marginBottom: 12 },
  galleryImage: { width: 260, height: 170, borderRadius: theme.radius.md, marginRight: 10 },
  bodyText: { fontSize: 15, color: theme.colors.text, lineHeight: 22, marginBottom: 8 },
  batchHint: { fontSize: 13, color: theme.colors.textMuted, lineHeight: 19, marginTop: -8, marginBottom: 8 },
  calendarBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10, paddingVertical: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  calendarText: { fontSize: 13, fontWeight: '800', color: theme.colors.primary },
  reviewCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.primaryLight, padding: 16, marginTop: 16 },
  reviewTitle: { fontSize: 12, fontWeight: '700', color: theme.colors.primary, letterSpacing: 0.5, marginBottom: 4 },
  reviewCourse: { fontSize: 18, fontWeight: '800', color: theme.colors.text, marginBottom: 12 },
  reviewMeta: { gap: 8 },
  reviewFact: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reviewFactLabel: { fontSize: 13, color: theme.colors.textMuted, width: 64 },
  reviewFactValue: { flex: 1, fontSize: 14, fontWeight: '600', color: theme.colors.text },
  modalCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, marginHorizontal: 24, maxHeight: '82%', padding: 20 },
  modalTitle: { fontSize: theme.font.title, fontWeight: '800', color: theme.colors.text, marginBottom: 4 },
  modalSub: { fontSize: 13, color: theme.colors.textMuted, marginBottom: 14, lineHeight: 18 },
  modalLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.text, marginBottom: 6, marginTop: 10 },
  modalTextarea: { minHeight: 90 },
  modalInput: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, backgroundColor: theme.colors.background, color: theme.colors.text },
  ynRow: { flexDirection: 'row', gap: 10 },
  ynBtn: { flex: 1, paddingVertical: 12, borderRadius: theme.radius.md, borderWidth: 1.5, borderColor: theme.colors.border, alignItems: 'center', backgroundColor: theme.colors.background },
  ynOn: { borderColor: theme.colors.success, backgroundColor: theme.colors.success },
  ynOff: { borderColor: theme.colors.danger, backgroundColor: theme.colors.danger },
  ynText: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  ynTextOn: { color: '#fff' },
  modalActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 22 },
  modalCancel: { paddingVertical: 10, paddingHorizontal: 8 },
  modalCancelText: { fontSize: 16, fontWeight: '600', color: theme.colors.textMuted },
});
