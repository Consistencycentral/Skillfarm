import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Linking, RefreshControl, ScrollView, Modal } from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { listMyRegistrations, createRazorpayPayment, type RegistrationWithCourse } from '../../api/registrations';
import { supabase } from '../../lib/supabase';
import { theme } from '../../constants/theme';
import { Alert } from '../../lib/alert';

export default function PaymentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [registration, setRegistration] = useState<RegistrationWithCourse | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingLink, setCreatingLink] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPaymentSuccess, setShowPaymentSuccess] = useState(false);
  const autoCreateRef = useRef(false);

  const load = useCallback(async (refresh = false) => {
    if (!id) return;
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) throw new Error('Please sign in again.');
      const rows = await listMyRegistrations(data.user.id);
      const found = rows.find((r) => r.id === id) ?? null;
      setRegistration(found);
      if (found && (found.payment_status === 'paid' || found.payment_status === 'not_required')) {
        setShowPaymentSuccess(true);
      }
      return found;
    } catch (e: any) {
      setError(e?.message ?? 'Could not load payment details.');
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const preparePayment = useCallback(async (reg: RegistrationWithCourse) => {
    if (creatingLink || reg.payment_status === 'paid' || reg.payment_status === 'not_required' || reg.status !== 'pending') return;
    setCreatingLink(true);
    try {
      const result = await createRazorpayPayment(reg.id);
      if (!result.ok) throw new Error(result.error ?? 'Could not prepare Razorpay payment.');
      await load(true);
    } catch (e: any) {
      setError(e?.message ?? 'Could not prepare Razorpay payment.');
    } finally {
      setCreatingLink(false);
    }
  }, [creatingLink, load]);

  useEffect(() => {
    if (!registration || autoCreateRef.current) return;
    if (registration.status === 'pending' && registration.payment_status !== 'paid' && registration.payment_status !== 'not_required') {
      autoCreateRef.current = true;
      void preparePayment(registration);
    }
  }, [registration, preparePayment]);

  // The webhook is authoritative. Poll while this screen is open so the learner
  // does not need to manually guess whether Razorpay finished processing.
  useEffect(() => {
    if (!registration || registration.payment_status === 'paid' || registration.payment_status === 'not_required') return;
    const timer = setInterval(() => { void load(true); }, 3000);
    return () => clearInterval(timer);
  }, [registration?.id, registration?.payment_status, load]);

  async function payWithRazorpay() {
    if (!registration) return;
    let url = registration.payment_link_url;
    if (!url) {
      setCreatingLink(true);
      try {
        const result = await createRazorpayPayment(registration.id);
        if (!result.ok || !result.payment_url) throw new Error(result.error ?? 'Could not create the payment link.');
        url = result.payment_url;
        await load(true);
      } catch (e: any) {
        Alert.alert('Razorpay unavailable', e?.message ?? 'Please try again.');
        return;
      } finally {
        setCreatingLink(false);
      }
    }
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Could not open Razorpay', 'Please try again or open the payment link from your browser.');
    }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
  if (error && !registration) return <View style={styles.center}><Ionicons name="alert-circle-outline" size={46} color={theme.colors.border} /><Text style={styles.errorTitle}>Payment details unavailable</Text><Text style={styles.errorText}>{error}</Text><Pressable style={styles.outline} onPress={() => load()}><Text style={styles.outlineText}>Retry</Text></Pressable></View>;
  if (!registration) return <View style={styles.center}><Text style={styles.errorTitle}>Booking not found</Text><Text style={styles.errorText}>This booking may belong to another account.</Text></View>;

  const fee = Math.max(0, Number(registration.payment_amount ?? Number(registration.course.fee ?? 0) - Number(registration.course.discount ?? 0)));
  const paid = registration.payment_status === 'paid' || registration.payment_status === 'not_required';
  const seat = (registration as any).assigned_seat_number ?? (registration as any).preferred_seat_number;

  if (paid) {
    return (
      <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.successHero}>
          <View style={styles.successIcon}><Ionicons name="checkmark" size={34} color="#fff" /></View>
          <Text style={styles.title}>Booking confirmed</Text>
          <Text style={styles.sub}>Your seat is booked successfully. Your payment has been verified by Razorpay.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.course}>{registration.course.title}</Text>
          <View style={styles.row}><Text style={styles.label}>Batch</Text><Text style={styles.value}>{registration.batch?.name ?? 'Training batch'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Seat</Text><Text style={styles.value}>{seat ? `Seat ${seat}` : 'Assigned'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Amount</Text><Text style={styles.value}>{fee > 0 ? `₹${fee.toLocaleString('en-IN')}` : 'Free'}</Text></View>
          <View style={styles.paidBadge}><Ionicons name="shield-checkmark-outline" size={17} color={theme.colors.success} /><Text style={styles.paidText}>{fee > 0 ? 'Payment verified' : 'No payment required'}</Text></View>
        </View>
        <Pressable style={styles.payButton} onPress={() => router.replace(`/ticket/${registration.id}`)}><Ionicons name="ticket-outline" size={19} color="#fff" /><Text style={styles.payButtonText}>View my ticket</Text></Pressable>
      </ScrollView>
      <Modal visible={showPaymentSuccess} transparent animationType="fade" onRequestClose={() => setShowPaymentSuccess(false)}>
        <View style={styles.popupOverlay}>
          <View style={styles.successPopup}>
            <View style={styles.popupIcon}><Ionicons name="checkmark" size={34} color="#fff" /></View>
            <Text style={styles.popupTitle}>Payment successful</Text>
            <Text style={styles.popupSub}>Your Razorpay payment is verified. Your seat is now confirmed.</Text>
            <View style={styles.popupSummary}>
              <Text style={styles.popupCourse}>{registration.course.title}</Text>
              <View style={styles.popupRow}><Text style={styles.popupLabel}>Batch</Text><Text style={styles.popupValue}>{registration.batch?.name ?? 'Training batch'}</Text></View>
              <View style={styles.popupRow}><Text style={styles.popupLabel}>Seat</Text><Text style={styles.popupValue}>{seat ? `Seat ${seat}` : 'Assigned'}</Text></View>
              <View style={styles.popupRow}><Text style={styles.popupLabel}>Paid</Text><Text style={styles.popupValue}>{fee > 0 ? `₹${fee.toLocaleString('en-IN')}` : 'Free'}</Text></View>
            </View>
            <Pressable style={styles.payButton} onPress={() => { setShowPaymentSuccess(false); router.replace(`/ticket/${registration.id}`); }}>
              <Ionicons name="ticket-outline" size={19} color="#fff" /><Text style={styles.payButtonText}>View my booking</Text>
            </Pressable>
            <Pressable style={styles.popupDismiss} onPress={() => setShowPaymentSuccess(false)}><Text style={styles.popupDismissText}>Close</Text></Pressable>
          </View>
        </View>
      </Modal>
      </>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}>
      <Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="arrow-back" size={20} color={theme.colors.text} /><Text style={styles.backText}>Back</Text></Pressable>
      <Text style={styles.kicker}>STEP 4 · SECURE PAYMENT</Text>
      <Text style={styles.title}>Complete your booking</Text>
      <Text style={styles.sub}>Your selected seat is being held while you complete the Razorpay payment.</Text>

      <View style={styles.card}>
        <Text style={styles.course}>{registration.course.title}</Text>
        <View style={styles.row}><Text style={styles.label}>Batch</Text><Text style={styles.value}>{registration.batch?.name ?? 'Training batch'}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Seat</Text><Text style={styles.value}>{seat ? `Seat ${seat}` : 'Selected seat'}</Text></View>
        <View style={styles.totalRow}><Text style={styles.totalLabel}>Pay now</Text><Text style={styles.total}>₹{fee.toLocaleString('en-IN')}</Text></View>
      </View>

      <View style={styles.payCard}>
        <View style={styles.razor}><Text style={styles.razorText}>Razorpay</Text></View>
        <Text style={styles.payTitle}>Secure payment</Text>
        <Text style={styles.payText}>Pay using UPI, cards, net banking or other methods supported by Razorpay. Your seat becomes confirmed only after the payment is verified.</Text>
        <Pressable style={[styles.payButton, (creatingLink || !registration.payment_link_url && !!error) && styles.disabled]} onPress={payWithRazorpay} disabled={creatingLink}>
          {creatingLink ? <ActivityIndicator color="#fff" /> : <Ionicons name="lock-closed-outline" size={18} color="#fff" />}
          <Text style={styles.payButtonText}>{creatingLink ? 'Preparing payment…' : `Pay ₹${fee.toLocaleString('en-IN')} with Razorpay`}</Text>
        </Pressable>
        {error ? <Text style={styles.warning}>{error}</Text> : null}
        <View style={styles.waiting}><View style={styles.liveDot} /><Text style={styles.waitingText}>Waiting for verified payment confirmation…</Text></View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: 18, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: theme.colors.background },
  back: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 20 },
  backText: { fontWeight: '800', color: theme.colors.text },
  kicker: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2, color: theme.colors.primary },
  title: { fontSize: 27, fontWeight: '900', color: theme.colors.text, marginTop: 5 },
  sub: { fontSize: 13, color: theme.colors.textMuted, lineHeight: 19, marginTop: 7 },
  successHero: { alignItems: 'center', paddingVertical: 18 },
  successIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  card: { marginTop: 18, padding: 17, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff' },
  course: { fontSize: 18, fontWeight: '900', color: theme.colors.text, marginBottom: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  label: { fontSize: 12, color: theme.colors.textMuted },
  value: { fontSize: 13, fontWeight: '700', color: theme.colors.text, maxWidth: '65%', textAlign: 'right' },
  totalRow: { borderTopWidth: 1, borderTopColor: theme.colors.border, marginTop: 8, paddingTop: 14, flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { fontSize: 14, fontWeight: '800', color: theme.colors.text },
  total: { fontSize: 20, fontWeight: '900', color: theme.colors.primary },
  payCard: { marginTop: 14, padding: 17, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff' },
  razor: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.surfaceAlt },
  razorText: { fontWeight: '900', color: theme.colors.primary },
  payTitle: { fontSize: 17, fontWeight: '900', color: theme.colors.text, marginTop: 12 },
  payText: { fontSize: 12, color: theme.colors.textMuted, lineHeight: 18, marginTop: 5 },
  payButton: { marginTop: 16, minHeight: 50, borderRadius: 13, backgroundColor: theme.colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14 },
  payButtonText: { color: '#fff', fontWeight: '900' },
  disabled: { opacity: 0.55 },
  warning: { color: theme.colors.warning, fontSize: 12, fontWeight: '700', marginTop: 10, lineHeight: 17 },
  waiting: { marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.success },
  waitingText: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '700' },
  paidBadge: { marginTop: 12, padding: 10, borderRadius: 10, backgroundColor: '#eef8ef', flexDirection: 'row', alignItems: 'center', gap: 7 },
  paidText: { color: theme.colors.success, fontWeight: '800', fontSize: 12 },
  errorTitle: { fontSize: 18, fontWeight: '900', marginTop: 10, color: theme.colors.text },
  errorText: { fontSize: 13, color: theme.colors.textMuted, textAlign: 'center', marginTop: 5, lineHeight: 18 },
  outline: { marginTop: 15, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 11, paddingHorizontal: 16, paddingVertical: 10 },
  outlineText: { fontWeight: '800', color: theme.colors.text },
  popupOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  successPopup: { width: '100%', maxWidth: 430, borderRadius: 24, padding: 22, backgroundColor: '#fff', alignItems: 'center' },
  popupIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  popupTitle: { marginTop: 14, fontSize: 23, fontWeight: '900', color: theme.colors.text, textAlign: 'center' },
  popupSub: { marginTop: 6, fontSize: 13, lineHeight: 19, color: theme.colors.textMuted, textAlign: 'center' },
  popupSummary: { width: '100%', marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border },
  popupCourse: { fontSize: 15, fontWeight: '900', color: theme.colors.text, marginBottom: 7 },
  popupRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: 10 },
  popupLabel: { fontSize: 12, color: theme.colors.textMuted },
  popupValue: { flex: 1, textAlign: 'right', fontSize: 12.5, fontWeight: '800', color: theme.colors.text },
  popupDismiss: { paddingVertical: 12, paddingHorizontal: 20 },
  popupDismissText: { fontSize: 13, fontWeight: '800', color: theme.colors.textMuted },
});
