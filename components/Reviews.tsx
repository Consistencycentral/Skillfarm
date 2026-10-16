// ===========================================================================
// Reviews — shown on the course detail screen.
//   - Rating summary (avg + count) for the course.
//   - List of reviews (learner name, stars, body, date) + partner public reply.
//   - "Rate this course" form for any signed-in learner (1–5 stars + text).
//   - Reply box for the Learning Partner who owns the course.
// ---------------------------------------------------------------------------
// Any authenticated learner can review a course; the course owner cannot review
// their own course. The owning partner may post ONE public reply per review.
// Anyone logged in can read reviews.
//
// When the form is NOT available the reason is stated on screen. It used to just
// be absent: a swallowed load error, an unregistered learner and the course's own
// partner all rendered as "no rating form" with nothing to explain it.
// ===========================================================================
import { useState, useCallback } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../constants/theme';
import { Button } from './Button';
import { supabase } from '../lib/supabase';
import {
  listCourseReviews, getCourseRating, upsertReview, deleteReview,
  postReply, deleteReply,
  type Review,
} from '../api/reviews';
import { Alert } from '../lib/alert';

interface Props {
  courseId: string;
  providerId: string; // the Learning Partner who owns the course
  // Optional refresh key retained for the course screen. Review eligibility is
  // based only on authentication + course ownership, not registration status.
  reloadKey?: number;
}

export function Reviews({ courseId, providerId, reloadKey = 0 }: Props) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [avg, setAvg] = useState(0);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The course owner can reply but cannot review their own course.
  const [isPartner, setIsPartner] = useState(false);
  const [myUid, setMyUid] = useState<string | null>(null);

  // Review-form state.
  const [formRating, setFormRating] = useState(0);
  const [formBody, setFormBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reply-form state, keyed by review id (one reply composer at a time).
  const [replyOpenId, setReplyOpenId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [replying, setReplying] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const { data: s } = await supabase.auth.getSession();
      const uid = s.session?.user?.id ?? null;
      setMyUid(uid);
      setIsPartner(Boolean(uid) && uid === providerId);

      const [list, rating] = await Promise.all([
        listCourseReviews(courseId),
        getCourseRating(courseId),
      ]);
      setReviews(list);
      setAvg(rating.avg);
      setCount(rating.count);

      // Load my existing review into the form so the stars show what I gave and
      // posting updates it (upsertReview already updates-then-inserts). The form
      // used to open blank next to my own review, which read as "not saved".
      const mine = uid ? list.find((r) => r.learner_id === uid) : undefined;
      setFormRating(mine?.rating ?? 0);
      setFormBody(mine?.body ?? '');
    } catch (e: any) {
      setLoadError(e?.message ?? 'Could not load reviews.');
    } finally {
      setLoading(false);
    }
    // reloadKey is a dependency on purpose: bumping it re-creates `load`, which
    // re-runs the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, providerId, reloadKey]);

  // Focus effect, not mount effect: returning from My Seats (where a seat can be
  // cancelled) has to re-read the status too.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const canReview = Boolean(myUid) && !isPartner;
  const myReview = myUid ? reviews.find((r) => r.learner_id === myUid) : undefined;

  // Submit / update my review.
  async function onSubmitReview() {
    if (formRating < 1 || formRating > 5) {
      Alert.alert('Pick a rating', 'Please tap 1–5 stars.');
      return;
    }
    try {
      setSubmitting(true);
      await upsertReview(courseId, formRating, formBody);
      // load() re-reads my row back into the form, so no manual reset here.
      await load();
    } catch (e: any) {
      Alert.alert('Could not post review', e?.message ?? 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onDeleteMyReview(reviewId: string) {
    Alert.alert('Delete your review?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await deleteReview(reviewId);
            await load();
          } catch (e: any) {
            Alert.alert('Could not delete', e?.message ?? 'Please try again.');
          }
        },
      },
    ]);
  }

  async function onPostReply(reviewId: string) {
    if (!replyBody.trim()) {
      Alert.alert('Reply is empty', 'Type something to post a reply.');
      return;
    }
    try {
      setReplying(true);
      await postReply(reviewId, replyBody);
      setReplyBody('');
      setReplyOpenId(null);
      await load();
    } catch (e: any) {
      Alert.alert('Could not post reply', e?.message ?? 'Please try again.');
    } finally {
      setReplying(false);
    }
  }

  async function onDeleteReply(reviewId: string) {
    try {
      await deleteReply(reviewId);
      await load();
    } catch (e: any) {
      Alert.alert('Could not delete reply', e?.message ?? 'Please try again.');
    }
  }

  if (loading) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  const stars = Array.from({ length: 5 }, (_, i) => i + 1);

  // Why the rating form is unavailable. Only one of these can apply, and each
  // tells the learner what to do next instead of leaving a blank space.
  const blockedReason: string | null =
    isPartner
      ? 'This is your course. Learners’ ratings appear here, and you can reply to each one below.'
      : !myUid
        ? 'Sign in to rate and comment on this course.'
        : null;

  return (
    <View style={styles.container}>
      {/* Summary */}
      <View style={styles.summaryRow}>
        <Text style={styles.bigRating}>{avg > 0 ? avg.toFixed(1) : '—'}</Text>
        <Stars value={Math.round(avg)} size={22} />
        <Text style={styles.countText}>{count} review{count === 1 ? '' : 's'}</Text>
      </View>

      {/* A failed load used to be swallowed, which looked exactly like "no
          reviews and no rating form". Say so, and offer a retry. */}
      {loadError ? (
        <View style={styles.errorCard}>
          <Ionicons name="alert-circle-outline" size={18} color={theme.colors.danger} />
          <Text style={styles.errorText}>{loadError}</Text>
          <Pressable onPress={load} accessibilityLabel="Retry loading reviews">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Any signed-in learner can rate; the course owner is excluded. */}
      {canReview && !isPartner ? (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>
            {myReview ? 'Your rating' : 'Rate this course'}
          </Text>
          <View style={styles.starRow}>
            {stars.map((n) => (
              <Pressable
                key={n}
                onPress={() => setFormRating(n)}
                hitSlop={8}
                accessibilityLabel={`Rate ${n} star${n === 1 ? '' : 's'}`}
              >
                <Ionicons
                  name={n <= formRating ? 'star' : 'star-outline'}
                  size={34}
                  color={n <= formRating ? theme.colors.accent : theme.colors.border}
                />
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.bodyInput}
            placeholder="Share your experience (optional)…"
            placeholderTextColor={theme.colors.textMuted}
            value={formBody}
            onChangeText={setFormBody}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
          <View style={{ marginTop: 4 }}>
            <Button
              label={submitting ? 'Posting…' : (myReview ? 'Update my review' : 'Post review')}
              onPress={onSubmitReview}
              loading={submitting}
            />
          </View>
          <Text style={styles.formNote}>You don’t need an approved seat to leave feedback.</Text>
        </View>
      ) : blockedReason && !loadError ? (
        <View style={styles.noticeCard}>
          <Ionicons
            name={isPartner ? 'business-outline' : 'information-circle-outline'}
            size={18}
            color={theme.colors.textMuted}
          />
          <Text style={styles.noticeText}>{blockedReason}</Text>
        </View>
      ) : null}

      {/* List */}
      {reviews.length === 0 ? (
        <Text style={styles.emptyText}>No reviews yet. {canReview ? 'Be the first to review!' : ''}</Text>
      ) : (
        <View style={styles.list}>
          {reviews.map((r) => {
            const mine = myUid === r.learner_id;
            return (
              <View key={r.id} style={styles.reviewCard}>
                <View style={styles.reviewHead}>
                  <View style={styles.avatar}>
                    <Ionicons name="person" size={16} color={theme.colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reviewerName}>
                      {mine ? 'You' : (r.learner_name ?? 'Learner')}
                    </Text>
                    <Stars value={r.rating} size={14} />
                  </View>
                  <Text style={styles.dateText}>{fmtShort(r.created_at)}</Text>
                </View>

                {r.body ? <Text style={styles.reviewBody}>{r.body}</Text> : null}

                {mine ? (
                  <Pressable onPress={() => onDeleteMyReview(r.id)} style={styles.smallAction}>
                    <Text style={styles.deleteText}>Delete my review</Text>
                  </Pressable>
                ) : null}

                {/* Partner public reply */}
                {r.reply ? (
                  <View style={styles.replyBox}>
                    <Text style={styles.replyAuthor}>Learning Partner</Text>
                    <Text style={styles.replyBody}>{r.reply.body}</Text>
                    {isPartner ? (
                      <Pressable onPress={() => onDeleteReply(r.id)} style={styles.smallAction}>
                        <Text style={styles.deleteText}>Delete reply</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : isPartner ? (
                  <View style={styles.replyBox}>
                    {replyOpenId === r.id ? (
                      <View>
                        <TextInput
                          style={styles.replyInput}
                          placeholder="Write a public reply…"
                          placeholderTextColor={theme.colors.textMuted}
                          value={replyBody}
                          onChangeText={setReplyBody}
                          multiline
                          numberOfLines={2}
                          textAlignVertical="top"
                        />
                        <View style={styles.replyActions}>
                          <Pressable onPress={() => { setReplyOpenId(null); setReplyBody(''); }}>
                            <Text style={styles.cancelText}>Cancel</Text>
                          </Pressable>
                          <View style={styles.replySend}>
                            <Button label="Post reply" size="md" loading={replying} onPress={() => onPostReply(r.id)} />
                          </View>
                        </View>
                      </View>
                    ) : (
                      <Pressable onPress={() => setReplyOpenId(r.id)} style={styles.replyOpenBtn}>
                        <Ionicons name="chatbubble-outline" size={14} color={theme.colors.primary} />
                        <Text style={styles.replyOpenText}>Reply publicly</Text>
                      </Pressable>
                    )}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ---- Small helpers --------------------------------------------------------
function Stars({ value, size }: { value: number; size: number }) {
  return (
    <View style={styles.stars}>
      {Array.from({ length: 5 }, (_, i) => (
        <Ionicons
          key={i}
          name={i < value ? 'star' : 'star-outline'}
          size={size}
          color={i < value ? theme.colors.accent : theme.colors.border}
        />
      ))}
    </View>
  );
}

function fmtShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  container: { marginTop: 8 },
  loadingBox: { padding: 18, alignItems: 'center' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  bigRating: { fontSize: 26, fontWeight: '800', color: theme.colors.text },
  countText: { fontSize: 13, color: theme.colors.textMuted, marginLeft: 4 },
  stars: { flexDirection: 'row', gap: 2 },
  formCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, padding: 14, marginBottom: 14, ...theme.shadow.card },
  formTitle: { fontSize: 16, fontWeight: '800', color: theme.colors.text, marginBottom: 10 },
  formNote: { fontSize: 12, color: theme.colors.textMuted, marginTop: 8, lineHeight: 17 },
  noticeCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md,
    paddingHorizontal: 12, paddingVertical: 11, marginBottom: 14,
  },
  noticeText: { flex: 1, fontSize: 13, color: theme.colors.textMuted, lineHeight: 18 },
  errorCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12,
    backgroundColor: theme.colors.surface, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.danger, padding: 11,
  },
  errorText: { flex: 1, fontSize: 13, color: theme.colors.text },
  retryText: { fontSize: 14, fontWeight: '700', color: theme.colors.primary },
  starRow: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  bodyInput: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: theme.colors.text, backgroundColor: theme.colors.background, minHeight: 70, textAlignVertical: 'top' },
  list: { gap: 10 },
  emptyText: { fontSize: 14, color: theme.colors.textMuted, marginBottom: 8 },
  reviewCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, padding: 12, ...theme.shadow.card },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  reviewerName: { fontSize: 14, fontWeight: '700', color: theme.colors.text, marginBottom: 2 },
  dateText: { fontSize: 11, color: theme.colors.textMuted },
  reviewBody: { fontSize: 14, color: theme.colors.text, lineHeight: 20, marginTop: 4 },
  smallAction: { alignSelf: 'flex-start', marginTop: 6 },
  deleteText: { fontSize: 12, fontWeight: '600', color: theme.colors.danger },
  replyBox: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.colors.border, borderLeftWidth: 3, borderLeftColor: theme.colors.primaryLight, paddingLeft: 10 },
  replyAuthor: { fontSize: 12, fontWeight: '700', color: theme.colors.primary, marginBottom: 2 },
  replyBody: { fontSize: 13, color: theme.colors.text, lineHeight: 18 },
  replyInput: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: theme.colors.text, backgroundColor: theme.colors.background, minHeight: 56, textAlignVertical: 'top' },
  replyActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  replySend: { width: 130 },
  cancelText: { fontSize: 14, fontWeight: '600', color: theme.colors.textMuted },
  replyOpenBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  replyOpenText: { fontSize: 13, fontWeight: '600', color: theme.colors.primary },
});
