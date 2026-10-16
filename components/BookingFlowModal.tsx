import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Modal,
  KeyboardAvoidingView, Platform, TextInput, Animated, Easing,
} from 'react-native';
import type { TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Batch } from '../api/batches';
import { batchSeatsLeft, isBatchRegistrationOpen } from '../api/batches';
import { BatchSelector } from './BatchSelector';
import { BatchSeatMap, seatLabel } from './BatchSeatMap';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../constants/theme';
import { useLanguage } from '../lib/i18n';
import { addBatchToCalendar } from '../lib/calendar';
import { Alert } from '../lib/alert';

export type BookingFormValues = {
  name: string;
  phone: string;
  email: string;
  age: string;
  location: string;
  experience: boolean | null;
  additionalDetails: string;
};

type Props = {
  visible: boolean;
  batches: Batch[];
  selectedBatchId: string | null;
  bookedSeats: number[];
  /** Seats the learner has picked (1-6). */
  selectedSeats: number[];
  courseTitle: string;
  courseLocation?: string;
  bookingFee?: number;
  form: BookingFormValues;
  onChangeForm: (key: keyof BookingFormValues, value: string | boolean | null) => void;
  onSelectBatch: (batch: Batch) => Promise<void> | void;
  /** Tapping a seat toggles it in the parent's selectedSeats list. */
  onSelectSeat: (seat: number) => void;
  onConfirm: () => Promise<boolean>;
  /** Full batch: the learner joins the waitlist instead of picking a seat. */
  onJoinWaitlist?: () => Promise<boolean>;
  onViewMySeats?: () => void;
  onRefreshBatches?: () => Promise<void> | void;
  loading?: boolean;
  /** The partner published events, but every one has already started/finished. */
  onlyPastBatches?: boolean;
  onClose: () => void;
};

/**
 * BookMyShow-style registration flow: Batch -> Seat -> Details -> Pay (review).
 * Each step has exactly one primary action. The seat map is followed by a price
 * summary card, and the success screen animates a check + confetti and offers
 * "Add to calendar". The final action still delegates to
 * the booking handler of the course screen (a seat request that the Learning Partner approves).
 */
export function BookingFlowModal({
  visible, batches, selectedBatchId, bookedSeats, selectedSeats, courseTitle, courseLocation,
  form, onChangeForm, onSelectBatch, onSelectSeat, onConfirm, onJoinWaitlist, onRefreshBatches, onViewMySeats, loading = false, onlyPastBatches = false, onClose, bookingFee = 0,
}: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [complete, setComplete] = useState(false);
  const selectedBatch = batches.find((b) => b.id === selectedBatchId) ?? null;
  // A full batch has no seats to pick: the learner joins the waitlist instead.
  const waitlistMode = !!selectedBatch && batchSeatsLeft(selectedBatch) === 0 && !!onJoinWaitlist;
  const [wasWaitlist, setWasWaitlist] = useState(false);
  // Seats shown on the success screen are snapshotted at submit time: the
  // parent clears its selection when it reloads the course after booking.
  const [bookedSnapshot, setBookedSnapshot] = useState<number[]>([]);
  const seatTotal = selectedBatch?.seats_total ?? 40;
  const seatCount = selectedSeats.length;
  const seatsText = selectedSeats.map((n) => seatLabel(n, seatTotal)).join(', ');
  const snapshotText = bookedSnapshot.map((n) => seatLabel(n, seatTotal)).join(', ');
  const money = (n: number) => `₹${n.toLocaleString('en-IN')}`;

  useEffect(() => {
    if (visible) {
      setStep(1);
      setComplete(false);
      setWasWaitlist(false);
    }
  }, [visible]);

  function close() {
    setStep(1);
    setComplete(false);
    setWasWaitlist(false);
    onClose();
  }

  async function selectBatch(batch: Batch) {
    await onSelectBatch(batch);
  }

  // Same checks the course screen runs at submit time, done one step earlier so
  // the learner fixes a missing field on the details step, not on the last one.
  function goToReview() {
    if (!form.name.trim()) { Alert.alert(t.nameRequired, t.nameRequiredSub); return; }
    if (!form.phone.trim()) { Alert.alert(t.contactRequired, t.contactRequiredSub); return; }
    if (!form.email.trim() || !/.+@.+\..+/.test(form.email.trim())) { Alert.alert(t.emailRequired, t.emailRequiredSub); return; }
    if (form.experience === null) { Alert.alert(t.previousExperience, t.previousExperienceSub); return; }
    setStep(4);
  }

  function addToCalendar() {
    if (!selectedBatch) return;
    addBatchToCalendar(courseTitle, selectedBatch, courseLocation ?? form.location)
      .catch((e) => Alert.alert('Calendar unavailable', e?.message ?? 'Could not open your calendar.'));
  }

  async function finishBooking() {
    if (waitlistMode) {
      const joined = await onJoinWaitlist!();
      if (joined) { setWasWaitlist(true); setBookedSnapshot([]); setComplete(true); }
      return;
    }
    const snap = [...selectedSeats];
    const ok = await onConfirm();
    if (ok) { setWasWaitlist(false); setBookedSnapshot(snap); setComplete(true); }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.card, { paddingTop: Math.max(insets.top, 12) }, complete && styles.cardDone]}>
          <View style={[styles.headerRow, complete && { display: 'none' }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.kicker}>BOOK YOUR SEAT</Text>
              <Text style={styles.courseTitle} numberOfLines={1}>{courseTitle}</Text>
              {selectedBatch ? (
                <Text style={styles.eventLine} numberOfLines={1}>
                  {formatDate(selectedBatch.start_date)}{selectedBatch.timings ? ` · ${selectedBatch.timings}` : ''}{courseLocation ? ` · ${courseLocation}` : ''}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={close} style={styles.closeBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close booking">
              <Ionicons name="close" size={21} color={theme.colors.text} />
            </Pressable>
          </View>

          {!complete && (
            <StepIndicator
              step={step}
              labels={['Batch', 'Seat', 'Details', waitlistMode || bookingFee <= 0 ? 'Confirm' : 'Pay']}
              onJump={(n) => { if (n < step) setStep(n as 1 | 2 | 3 | 4); }}
            />
          )}

          {complete ? (
            <View style={styles.popupBackdrop}>
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.popupScroll}
              >
                <View style={styles.popupCard}>
                  {/* Rainbow stripe + coloured hero = the "celebration" look. */}
                  <View style={styles.rainbow}>
                    {CONFETTI_COLORS.map((c) => <View key={c} style={{ flex: 1, backgroundColor: c }} />)}
                  </View>
                  <View style={styles.popupHero}>
                    <SuccessCheck onDark />
                    <Text style={styles.popupTitle}>{wasWaitlist ? t.wl_doneTitle : 'Seat requested! 🎉'}</Text>
                    <Text style={styles.popupSub}>
                      {wasWaitlist
                        ? t.wl_doneBody
                        : `${bookedSnapshot.length > 1 ? `Seats ${snapshotText} are` : `Seat ${snapshotText} is`} held for you. The Learning Partner will approve ${bookedSnapshot.length > 1 ? 'them' : 'it'} shortly.`}
                    </Text>
                  </View>

                  <View style={styles.popupBody}>
                    <View style={styles.successTicket}>
                      <View style={styles.ticketBlock}><Text style={styles.smallLabel}>BATCH</Text><Text style={styles.ticketValue} numberOfLines={2}>{selectedBatch?.name ?? '—'}</Text></View>
                      <View style={styles.ticketBlock}><Text style={styles.smallLabel}>{bookedSnapshot.length > 1 ? 'SEATS' : 'SEAT'}</Text><Text style={styles.ticketValue}>{wasWaitlist ? 'Waitlist' : (snapshotText || '—')}</Text></View>
                      <View style={styles.ticketBlock}><Text style={styles.smallLabel}>STATUS</Text><Text style={styles.ticketValue}>{wasWaitlist ? 'On waitlist' : 'Pending'}</Text></View>
                    </View>

                    <View style={styles.registeredDetailsCard}>
                      <View style={styles.bookingSummaryHeader}>
                        <Ionicons name="person-outline" size={18} color={theme.colors.primary} />
                        <Text style={styles.bookingSummaryTitle}>Registered details</Text>
                      </View>
                      <SummaryRow label="Name" value={form.name.trim() || '—'} />
                      <SummaryRow label="Phone" value={form.phone.trim() || '—'} />
                      <SummaryRow label="Email" value={form.email.trim() || '—'} />
                      {form.age.trim() ? <SummaryRow label="Age" value={form.age.trim()} /> : null}
                      {form.location.trim() ? <SummaryRow label="Location" value={form.location.trim()} /> : null}
                      <SummaryRow label="Experience" value={form.experience === true ? 'Yes' : form.experience === false ? 'No' : '—'} />
                    </View>

                    {onViewMySeats ? (
                      <Pressable onPress={onViewMySeats} style={[styles.primaryBtn, { alignSelf: 'stretch', flex: 0 }]} accessibilityRole="button">
                        <Ionicons name="ticket-outline" size={18} color="#fff" />
                        <Text style={styles.primaryBtnText}>View my seats</Text>
                      </Pressable>
                    ) : null}
                    {!wasWaitlist && selectedBatch?.start_date ? (
                      <Pressable onPress={addToCalendar} style={styles.calendarBtn} accessibilityRole="button" accessibilityLabel="Add to calendar">
                        <Ionicons name="calendar-outline" size={18} color={theme.colors.primary} />
                        <Text style={styles.calendarBtnText}>Add to calendar</Text>
                      </Pressable>
                    ) : null}
                    <Pressable onPress={close} style={styles.doneLink} accessibilityRole="button">
                      <Text style={styles.doneLinkText}>Done</Text>
                    </Pressable>
                  </View>
                </View>
              </ScrollView>
              <ConfettiBurst />
            </View>
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.scrollContent}
            >
              {step === 1 && (
                <View>
                  <Text style={styles.heading}>Choose your batch</Text>
                  <Text style={styles.subheading}>Choose an upcoming event published by the Learning Partner. The event date, timing and exact seat capacity come from that batch.</Text>

                  <BatchSelector
                    batches={batches}
                    selectedBatchId={selectedBatchId}
                    onSelect={selectBatch}
                    location={courseLocation}
                  />

                  {batches.length > 0 && !batches.some((b) => batchSeatsLeft(b) > 0 && isBatchRegistrationOpen(b)) ? (
                    <View style={styles.emptyBatchBox}>
                      <Ionicons name="lock-closed-outline" size={20} color={theme.colors.textMuted} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.emptyBatchText}>Booking is not open for any batch right now.</Text>
                        <Text style={styles.emptyBatchHint}>Every batch of this course is either full or past its registration deadline / start date. Ask the Learning Partner to publish a new date.</Text>
                      </View>
                    </View>
                  ) : null}
                  {selectedBatch ? null : (
                    <View style={styles.emptyBatchBox}>
                      <Ionicons name="calendar-outline" size={20} color={theme.colors.textMuted} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.emptyBatchText}>{onlyPastBatches ? 'This course has no upcoming event right now.' : 'No upcoming event has been published by the Learning Partner yet.'}</Text>
                        <Text style={styles.emptyBatchHint}>{onlyPastBatches ? 'The last published event date has already passed. When the Learning Partner publishes a new date, it will appear here with its seats.' : 'Once the partner publishes the event, its date, timing and seats will appear here automatically.'}</Text>
                        {onRefreshBatches ? (
                          <Pressable onPress={() => void onRefreshBatches()} style={styles.refreshEventBtn}>
                            <Ionicons name="refresh-outline" size={15} color={theme.colors.primary} />
                            <Text style={styles.refreshEventText}>Refresh event</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  )}

                  <View style={styles.actions}>
                    <Pressable onPress={close} style={styles.secondaryBtn}>
                      <Text style={styles.secondaryText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setStep(2)}
                      disabled={!selectedBatch || !isBatchRegistrationOpen(selectedBatch)}
                      style={[styles.primaryBtn, (!selectedBatch || !isBatchRegistrationOpen(selectedBatch)) && styles.disabledBtn]}
                    >
                      <Text style={styles.primaryBtnText}>Continue to seat selection</Text>
                      <Ionicons name="arrow-forward" size={17} color="#fff" />
                    </Pressable>
                  </View>
                </View>
              )}

              {step === 2 && selectedBatch && (
                <View>
                  <Text style={styles.heading}>Select your seat</Text>
                  <Text style={styles.subheading}>
                    {formatDate(selectedBatch.start_date)}{selectedBatch.timings ? ` · ${selectedBatch.timings}` : ''} · {selectedBatch.seats_total} total seats. Tap up to 6 seats for this event (for family or friends).
                  </Text>

                  {batchSeatsLeft(selectedBatch) > 0 ? (
                    <>
                      <BatchSeatMap
                        seatsTotal={selectedBatch.seats_total}
                        seatsFilled={selectedBatch.seats_filled}
                        bookedSeats={bookedSeats}
                        selectedSeats={selectedSeats}
                        onSelect={onSelectSeat}
                      />
                      <PriceSummary seats={seatCount} seatsText={seatsText} unit={bookingFee} />
                    </>
                  ) : (
                    <View style={styles.waitlistBox}>
                      <Ionicons name="hourglass-outline" size={20} color={theme.colors.primary} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.waitlistTitle}>{onJoinWaitlist ? t.wl_fullTitle : 'This batch is full'}</Text>
                        <Text style={styles.waitlistText}>{onJoinWaitlist ? t.wl_fullBody : 'No seat can be selected for this batch.'}</Text>
                      </View>
                    </View>
                  )}

                </View>
              )}

              {step === 3 && selectedBatch && (
                <View>
                  <Text style={styles.heading}>Your details</Text>
                  <Text style={styles.subheading}>
                    {waitlistMode
                      ? 'Tell us who is joining. You join the waitlist for this batch; the first free seat is held for you in order.'
                      : 'Tell us who is joining. We’ll send this batch and seat request to the Learning Partner for approval.'}
                  </Text>

                  <Label text="Name *" />
                  <Input value={form.name} onChangeText={(v) => onChangeForm('name', v)} placeholder="Your full name" />

                  <Label text="Contact number *" />
                  <Input value={form.phone} onChangeText={(v) => onChangeForm('phone', v)} placeholder="+91…" keyboardType="phone-pad" />

                  <Label text="Email *" />
                  <Input value={form.email} onChangeText={(v) => onChangeForm('email', v)} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" editable={false} muted />

                  <Label text="Age" />
                  <Input value={form.age} onChangeText={(v) => onChangeForm('age', v)} placeholder="e.g. 24" keyboardType="numeric" />

                  <Label text="Location" />
                  <Input value={form.location} onChangeText={(v) => onChangeForm('location', v)} placeholder="City / District" />

                  <Label text="Previous experience? *" />
                  <Text style={styles.fieldHint}>Choose one option so the partner can understand your background.</Text>
                  <View style={styles.ynRow}>
                    <Pressable onPress={() => onChangeForm('experience', true)} style={[styles.ynBtn, form.experience === true && styles.ynOn]}>
                      <Text style={[styles.ynText, form.experience === true && styles.ynTextOn]}>Yes</Text>
                    </Pressable>
                    <Pressable onPress={() => onChangeForm('experience', false)} style={[styles.ynBtn, form.experience === false && styles.ynOff]}>
                      <Text style={[styles.ynText, form.experience === false && styles.ynTextOn]}>No</Text>
                    </Pressable>
                  </View>

                  <Label text="Additional details" />
                  <Input value={form.additionalDetails} onChangeText={(v) => onChangeForm('additionalDetails', v)} placeholder="Anything the Learning Partner should know? (optional)" multiline />

                  <View style={styles.actions}>
                    <Pressable onPress={() => setStep(2)} style={styles.secondaryBtn}>
                      <Text style={styles.secondaryText}>Back</Text>
                    </Pressable>
                    <Pressable onPress={goToReview} style={styles.primaryBtn}>
                      <Text style={styles.primaryBtnText}>{waitlistMode || bookingFee <= 0 ? 'Review request' : 'Review & pay'}</Text>
                      <Ionicons name="arrow-forward" size={17} color="#fff" />
                    </Pressable>
                  </View>
                </View>
              )}

              {step === 4 && selectedBatch && (
                <View>
                  <Text style={styles.heading}>{waitlistMode || bookingFee <= 0 ? 'Review & confirm' : 'Review & pay'}</Text>
                  <Text style={styles.subheading}>
                    {waitlistMode
                      ? 'Check everything once more. You will be added to the waitlist for this batch.'
                      : 'Check everything once more, then submit. The Learning Partner approves your seat request.'}
                  </Text>

                  <View style={styles.bookingSummaryCard}>
                    <View style={styles.bookingSummaryHeader}>
                      <Ionicons name="ticket-outline" size={18} color={theme.colors.primary} />
                      <Text style={styles.bookingSummaryTitle}>Booking summary</Text>
                    </View>
                    <SummaryRow label="Batch" value={selectedBatch.name || formatDate(selectedBatch.start_date)} />
                    <SummaryRow label="Date" value={formatDate(selectedBatch.start_date)} />
                    {selectedBatch.timings ? <SummaryRow label="Time" value={selectedBatch.timings} /> : null}
                    <SummaryRow label={waitlistMode ? 'Status' : (seatCount > 1 ? `Seats (${seatCount})` : 'Seat')} value={waitlistMode ? 'Waitlist' : (seatCount ? seatsText : '—')} />
                    <SummaryRow label="Location" value={courseLocation || form.location || '—'} />
                  </View>

                  {!waitlistMode ? <PriceSummary seats={seatCount} seatsText={seatsText} unit={bookingFee} detailed /> : null}

                  <View style={styles.registeredPreview}>
                    <View style={styles.bookingSummaryHeader}>
                      <Ionicons name="person-circle-outline" size={18} color={theme.colors.primary} />
                      <Text style={styles.bookingSummaryTitle}>Details to be registered</Text>
                    </View>
                    <SummaryRow label="Name" value={form.name.trim() || 'Not entered'} />
                    <SummaryRow label="Phone" value={form.phone.trim() || 'Not entered'} />
                    <SummaryRow label="Email" value={form.email.trim() || 'Not entered'} />
                    <SummaryRow label="Age" value={form.age.trim() || '—'} />
                    <SummaryRow label="Location" value={form.location.trim() || '—'} />
                    <SummaryRow label="Experience" value={form.experience === true ? 'Yes' : form.experience === false ? 'No' : 'Not selected'} />
                    {form.additionalDetails.trim() ? <SummaryRow label="Additional" value={form.additionalDetails.trim()} /> : null}
                  </View>

                  <View style={styles.actions}>
                    <Pressable onPress={() => setStep(3)} style={styles.secondaryBtn}>
                      <Text style={styles.secondaryText}>Back</Text>
                    </Pressable>
                    <Pressable onPress={finishBooking} disabled={loading} style={[styles.primaryBtn, loading && styles.disabledBtn]}>
                      <Text style={styles.primaryBtnText}>
                        {loading ? 'Sending…' : (waitlistMode ? t.cd_joinWaitlist : (seatCount > 1 ? `Submit ${seatCount} seat requests` : 'Submit seat request'))}
                      </Text>
                      {!loading && <Ionicons name="arrow-forward" size={17} color="#fff" />}
                    </Pressable>
                  </View>

                  <View style={styles.secureNote}>
                    <Ionicons name="lock-closed-outline" size={14} color={theme.colors.textMuted} />
                    <Text style={styles.secureNoteText}>Your information is secure and only shared with the Learning Partner for this registration.</Text>
                  </View>
                </View>
              )}
            </ScrollView>
          )}
          {!complete && step === 2 && selectedBatch ? (
            <View style={[styles.seatBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <Pressable onPress={() => setStep(1)} style={styles.barBack} accessibilityRole="button" accessibilityLabel="Back to batch">
                <Ionicons name="arrow-back" size={20} color={theme.colors.text} />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={styles.barSeat} numberOfLines={1}>{waitlistMode ? t.wl_fullTitle : (seatCount ? `${seatCount > 1 ? 'Seats' : 'Seat'} ${seatsText}` : 'No seat selected')}</Text>
                <Text style={styles.barSub} numberOfLines={1}>
                  {waitlistMode
                    ? t.cd_joinWaitlist
                    : seatCount
                    ? (bookingFee > 0
                        ? (seatCount > 1 ? `${money(bookingFee)} × ${seatCount} = ${money(bookingFee * seatCount)}` : `${money(bookingFee)} · partner approves`)
                        : 'Free · partner approves your request')
                    : 'Tap green seats to choose (up to 6)'}
                </Text>
              </View>
              <Pressable
                onPress={() => setStep(3)}
                disabled={batchSeatsLeft(selectedBatch) > 0 && seatCount === 0}
                style={[styles.barProceed, batchSeatsLeft(selectedBatch) > 0 && seatCount === 0 && styles.disabledBtn]}
              >
                <Text style={styles.primaryBtnText}>{waitlistMode ? t.cd_joinWaitlist : 'Proceed'}</Text>
                <Ionicons name="arrow-forward" size={17} color="#fff" />
              </Pressable>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------------------------------------------------- Step indicator
function StepIndicator({ step, labels, onJump }: { step: number; labels: string[]; onJump: (n: number) => void }) {
  return (
    <View style={styles.steps} accessibilityRole="progressbar" accessibilityLabel={`Step ${step} of ${labels.length}: ${labels[step - 1]}`}>
      {labels.map((label, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        return (
          <View key={label} style={styles.stepCol}>
            <View style={styles.stepTrack}>
              <View style={[styles.stepLineHalf, i === 0 && { opacity: 0 }, (done || active) && styles.stepLineDone]} />
              <Pressable disabled={!done} onPress={() => onJump(n)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${label}${done ? ', completed' : ''}`}>
                <View style={[styles.stepDot, active && styles.stepDotActive, done && styles.stepDotDone]}>
                  {done
                    ? <Ionicons name="checkmark" size={14} color="#fff" />
                    : <Text style={[styles.stepNumber, active && styles.stepNumberActive]}>{n}</Text>}
                </View>
              </Pressable>
              <View style={[styles.stepLineHalf, i === labels.length - 1 && { opacity: 0 }, done && styles.stepLineDone]} />
            </View>
            <Text style={[styles.stepLabel, (active || done) && styles.stepLabelActive]} numberOfLines={1}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------ Price summary
function PriceSummary({ seats, seatsText, unit, detailed = false }: { seats: number; seatsText: string; unit: number; detailed?: boolean }) {
  const money = (n: number) => `₹${n.toLocaleString('en-IN')}`;
  const total = unit * seats;
  return (
    <View style={styles.priceCard}>
      <View style={styles.bookingSummaryHeader}>
        <Ionicons name="receipt-outline" size={18} color={theme.colors.primary} />
        <Text style={styles.bookingSummaryTitle}>Price summary</Text>
      </View>
      {seats === 0 ? (
        <Text style={styles.priceEmpty}>Pick a seat to see the price.</Text>
      ) : (
        <>
          <SummaryRow label={seats > 1 ? `${seats} seats` : 'Seat'} value={seatsText} />
          <SummaryRow label="Price per seat" value={unit > 0 ? money(unit) : 'Free'} />
          {seats > 1 && unit > 0 ? <SummaryRow label={`${money(unit)} × ${seats}`} value={money(total)} /> : null}
          <View style={styles.priceDivider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{total > 0 ? money(total) : 'Free'}</Text>
          </View>
          {detailed ? (
            <Text style={styles.priceNote}>
              {total > 0
                ? 'Nothing is charged on this screen. If the course has a fee, you complete payment from My Seats once your request is approved.'
                : 'This course is free — no payment is needed.'}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

// -------------------------------------------------- Success check + confetti
const native = Platform.OS !== 'web';

function SuccessCheck({ onDark = false }: { onDark?: boolean }) {
  const pop = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.spring(pop, { toValue: 1, friction: 4, tension: 120, useNativeDriver: native }),
      Animated.timing(ring, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
    ]).start();
  }, [pop, ring]);
  return (
    <View style={styles.checkWrap}>
      <Animated.View style={[styles.checkRing, onDark && { backgroundColor: '#fff' }, {
        opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
        transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }],
      }]} />
      <Animated.View style={[styles.successIcon, onDark && { backgroundColor: '#fff' }, { transform: [{ scale: pop }] }]}>
        <Ionicons name="checkmark" size={38} color={onDark ? theme.colors.primary : '#fff'} />
      </Animated.View>
    </View>
  );
}

const CONFETTI_COLORS = ['#1F6B45', '#E9A21B', '#2B7A9B', '#C0392B', '#8BC34A', '#7E57C2'];

function ConfettiBurst() {
  const pieces = useMemo(() => Array.from({ length: 26 }, (_, i) => ({
    key: i,
    left: 6 + Math.random() * 88,           // % across the screen
    size: 6 + Math.random() * 6,
    drift: (Math.random() - 0.5) * 90,
    spin: (Math.random() > 0.5 ? 1 : -1) * (180 + Math.random() * 360),
    delay: Math.random() * 350,
    duration: 1400 + Math.random() * 900,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    round: i % 3 === 0,
    v: new Animated.Value(0),
  })), []);
  useEffect(() => {
    const anims = pieces.map((p) => Animated.timing(p.v, { toValue: 1, duration: p.duration, delay: p.delay, easing: Easing.out(Easing.quad), useNativeDriver: native }));
    Animated.parallel(anims).start();
    return () => anims.forEach((a) => a.stop());
  }, [pieces]);
  return (
    <View pointerEvents="none" style={styles.confetti}>
      {pieces.map((p) => (
        <Animated.View
          key={p.key}
          style={{
            position: 'absolute', top: 0, left: `${p.left}%`,
            width: p.size, height: p.round ? p.size : p.size * 1.6, borderRadius: p.round ? p.size / 2 : 2,
            backgroundColor: p.color,
            opacity: p.v.interpolate({ inputRange: [0, 0.1, 0.8, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { translateY: p.v.interpolate({ inputRange: [0, 1], outputRange: [-20, 360] }) },
              { translateX: p.v.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] }) },
              { rotate: p.v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.spin}deg`] }) },
            ],
          }}
        />
      ))}
    </View>
  );
}

function LegendItem({ label, style }: { label: string; style: object }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, style]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function Label({ text }: { text: string }) { return <Text style={styles.label}>{text}</Text>; }
type BookingInputProps = TextInputProps & { muted?: boolean };
function Input(props: BookingInputProps) {
  return <TextInput {...props} placeholderTextColor={theme.colors.textMuted} style={[styles.input, props.muted && styles.inputMuted, props.multiline && styles.textarea]} />;
}

function formatDate(value: string | null) {
  if (!value) return 'Date not set';
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const styles = StyleSheet.create({
  cardDone: { backgroundColor: theme.colors.primaryDark, paddingTop: 0 },
  popupBackdrop: { flex: 1, backgroundColor: theme.colors.primaryDark },
  popupScroll: { flexGrow: 1, justifyContent: 'center', padding: 20, paddingVertical: 40 },
  popupCard: { backgroundColor: theme.colors.surface, borderRadius: 26, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 24, shadowOffset: { width: 0, height: 14 }, elevation: 12 },
  rainbow: { flexDirection: 'row', height: 6 },
  popupHero: { alignItems: 'center', backgroundColor: theme.colors.primary, paddingHorizontal: 22, paddingTop: 26, paddingBottom: 26 },
  popupTitle: { fontSize: 26, fontWeight: '900', color: '#fff', textAlign: 'center', marginTop: 4 },
  popupSub: { fontSize: 14.5, lineHeight: 22, color: 'rgba(255,255,255,0.92)', textAlign: 'center', marginTop: 8 },
  popupBody: { padding: 18, paddingTop: 16 },
  doneLink: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  doneLinkText: { fontSize: 15, fontWeight: '700', color: theme.colors.textMuted },
  steps: { flexDirection: 'row', paddingHorizontal: 12, paddingBottom: 14, paddingTop: 2 },
  stepCol: { flex: 1, alignItems: 'center' },
  stepTrack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  stepLineHalf: { flex: 1, height: 2, backgroundColor: theme.colors.border },
  stepLineDone: { backgroundColor: theme.colors.primary },
  stepDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: theme.colors.surfaceAlt, borderWidth: 1.5, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  stepDotActive: { backgroundColor: theme.colors.surface, borderColor: theme.colors.primary, borderWidth: 2 },
  stepDotDone: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  stepNumber: { fontSize: 12, fontWeight: '700', color: theme.colors.textMuted },
  stepNumberActive: { color: theme.colors.primary },
  stepLabel: { fontSize: 11.5, fontWeight: '600', color: theme.colors.textSubtle, marginTop: 6 },
  stepLabelActive: { color: theme.colors.text, fontWeight: '700' },
  priceCard: { marginTop: 14, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.primaryLight, backgroundColor: theme.colors.primaryTint },
  priceEmpty: { fontSize: 12.5, color: theme.colors.textMuted },
  priceDivider: { height: 1, backgroundColor: theme.colors.primaryLight, marginVertical: 8 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalLabel: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  totalValue: { fontSize: 20, fontWeight: '800', color: theme.colors.primary },
  priceNote: { fontSize: 11.5, lineHeight: 17, color: theme.colors.textMuted, marginTop: 10 },
  confetti: { position: 'absolute', top: 0, left: 0, right: 0, height: 560, overflow: 'hidden' },
  checkWrap: { width: 90, height: 90, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  checkRing: { position: 'absolute', width: 70, height: 70, borderRadius: 35, backgroundColor: theme.colors.primary },
  successIcon: { width: 70, height: 70, borderRadius: 35, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: theme.colors.primary, shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  calendarBtn: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, minHeight: 50, borderRadius: 13, borderWidth: 1.5, borderColor: theme.colors.primary, backgroundColor: theme.colors.surface },
  calendarBtnText: { fontSize: 14.5, fontWeight: '700', color: theme.colors.primary },
  overlay: { flex: 1, backgroundColor: theme.colors.surface },
  card: { flex: 1, backgroundColor: theme.colors.surface },
  eventLine: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
  seatBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface },
  barBack: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  barSeat: { fontSize: 16, fontWeight: '900', color: theme.colors.text },
  barSub: { fontSize: 11.5, color: theme.colors.textMuted, marginTop: 2 },
  barProceed: { minHeight: 48, borderRadius: 13, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 18 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 12 },
  kicker: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4, color: theme.colors.primary },
  courseTitle: { fontSize: 18, fontWeight: '900', color: theme.colors.text, marginTop: 3 },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { paddingHorizontal: 18, paddingBottom: 22 },
  heading: { fontSize: 21, fontWeight: '900', color: theme.colors.text, marginTop: 6, marginBottom: 4 },
  subheading: { fontSize: 13, color: theme.colors.textMuted, lineHeight: 19, marginBottom: 14 },
  selectedBatchCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.primaryLight, backgroundColor: theme.colors.surfaceAlt },
  selectedBatchIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  selectedBatchTitle: { fontSize: 14, fontWeight: '800', color: theme.colors.text },
  selectedBatchMeta: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
  emptyBatchBox: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 14, marginTop: 8, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceAlt },
  emptyBatchText: { flex: 1, fontSize: 13, color: theme.colors.textMuted },
  seatLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1 },
  legendAvailable: { backgroundColor: theme.colors.surface, borderColor: theme.colors.primary },
  legendSelected: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  legendBooked: { backgroundColor: theme.colors.border, borderColor: theme.colors.border },
  legendText: { fontSize: 11.5, color: theme.colors.textMuted },
  selectedSeatCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.primary, backgroundColor: theme.colors.surfaceAlt },
  selectedSeatLabel: { fontSize: 13, fontWeight: '800', color: theme.colors.text },
  selectedSeatHint: { fontSize: 11.5, color: theme.colors.textMuted, marginTop: 2 },
  selectedSeatNumber: { fontSize: 16, fontWeight: '800', color: theme.colors.primary },
  waitlistBox: { flexDirection: 'row', gap: 9, alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, padding: 13, borderRadius: 14, marginTop: 10 },
  waitlistTitle: { fontSize: 14, fontWeight: '800', color: theme.colors.text, marginBottom: 2 },
  waitlistText: { flex: 1, fontSize: 13, color: theme.colors.textMuted, lineHeight: 18 },
  registeredPreview: { marginTop: 16, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.background },
  registeredDetailsCard: { width: '100%', marginTop: 18, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.primaryLight, backgroundColor: theme.colors.surfaceAlt },
  bookingSummaryCard: { marginBottom: 4, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.primaryLight, backgroundColor: theme.colors.surfaceAlt },
  bookingSummaryHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  bookingSummaryTitle: { fontSize: 14, fontWeight: '800', color: theme.colors.text },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 4 },
  summaryLabel: { fontSize: 12, color: theme.colors.textMuted },
  summaryValue: { flex: 1, textAlign: 'right', fontSize: 12.5, fontWeight: '700', color: theme.colors.text },
  label: { fontSize: 14, fontWeight: '700', color: theme.colors.text, marginTop: 12, marginBottom: 6 },
  input: { minHeight: 48, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, backgroundColor: theme.colors.background, color: theme.colors.text, fontSize: 15 },
  inputMuted: { backgroundColor: theme.colors.surfaceAlt },
  textarea: { minHeight: 88, textAlignVertical: 'top' },
  fieldHint: { fontSize: 12, color: theme.colors.textMuted, marginTop: -2, marginBottom: 7 },
  ynRow: { flexDirection: 'row', gap: 10 },
  ynBtn: { flex: 1, minHeight: 46, borderRadius: 12, borderWidth: 1.5, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background },
  ynOn: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary },
  ynOff: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary },
  ynText: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  ynTextOn: { color: '#fff' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 22 },
  secondaryBtn: { minHeight: 50, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 15, fontWeight: '800', color: theme.colors.textMuted },
  primaryBtn: { flex: 1, minHeight: 50, borderRadius: 13, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, paddingHorizontal: 15 },
  primaryBtnText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  disabledBtn: { opacity: 0.5 },
  secureNote: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  secureNoteText: { fontSize: 11.5, color: theme.colors.textMuted, textAlign: 'center', flex: 1 },
  successWrap: { padding: 28, alignItems: 'center' },
  successTitle: { fontSize: 22, fontWeight: '900', color: theme.colors.text, textAlign: 'center' },
  successSub: { fontSize: 13, color: theme.colors.textMuted, textAlign: 'center', lineHeight: 19, marginTop: 7 },
  successTicket: { width: '100%', flexDirection: 'row', gap: 8, marginTop: 18, padding: 14, borderRadius: 14, backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.primaryLight },
  ticketBlock: { flex: 1, minWidth: 0 },
  smallLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1.1, color: theme.colors.textMuted },
  ticketValue: { fontSize: 12.5, fontWeight: '900', color: theme.colors.text, marginTop: 3 },
  emptyBatchHint: { fontSize: 12, lineHeight: 17, color: theme.colors.textMuted, marginTop: 4 },
  refreshEventBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.primary },
  refreshEventText: { fontSize: 12.5, fontWeight: '800', color: theme.colors.primary },
});
