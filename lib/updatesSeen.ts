// "What's new" badge state (restored — referenced by app/(student)/_layout.tsx
// and notifications.tsx but missing from the repository upload; see AUDIT.md).
//
// The student notifications screen lists release notes / announcements. The
// (student) tab bar shows a dot until the user opens the screen, then
// markUpdatesSeen() persists the latest announcement id under a per-user
// localStorage key so the dot never comes back for the same content.

import { Platform } from 'react-native';
import { useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

type UpdateRow = { id: string | number; created_at?: string };

const keyFor = (userId: string) => `skillfarm.updates.seen.${userId}`;

function readSeen(userId: string): string {
  try {
    if (Platform.OS === 'web') return window.localStorage.getItem(keyFor(userId)) ?? '';
    return '';
  } catch { return ''; }
}

function writeSeen(userId: string, value: string): void {
  try {
    if (Platform.OS === 'web') window.localStorage.setItem(keyFor(userId), value);
  } catch { /* private mode: badge will re-show, harmless */ }
}

/** Fetch the newest announcement timestamp (null when none). */
async function latestUpdateAt(): Promise<string | null> {
  const { data } = await supabase
    .from('app_updates')
    .select('id, created_at')
    .order('created_at', { ascending: false })
    .limit(1);
  return data?.[0]?.created_at ?? null;
}

/** Dot on the Notifications tab: true while unseen announcements exist. */
export function useUnreadUpdates(userId: string | undefined): number {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let alive = true;
    if (!userId) { setUnread(0); return; }
    (async () => {
      const latest = await latestUpdateAt();
      if (!alive) return;
      if (!latest) { setUnread(0); return; }
      const seen = readSeen(userId);
      // The badge on the Updates tab reads this as a count (0 = no dot).
      setUnread(seen !== latest ? 1 : 0);
    })();
    return () => { alive = false; };
  }, [userId]);

  return unread;
}

/**
 * Called by the notifications screen after rendering the list.
 * Accepts either full rows (with created_at) or bare ids; when only ids are
 * available the newest announcement timestamp is looked up instead, so the
 * badge still clears.
 */
export async function markUpdatesSeen(
  userId: string,
  rows: Array<UpdateRow | string>
): Promise<void> {
  if (!userId || rows.length === 0) return;

  if (typeof rows[0] === 'string') {
    const latest = await latestUpdateAt();
    if (latest) writeSeen(userId, latest);
    return;
  }
  const typed = rows as UpdateRow[];
  const newest = typed.reduce<string | null>((acc, r) => {
    if (!r.created_at) return acc;
    return !acc || r.created_at > acc ? r.created_at : acc;
  }, null);
  if (newest) writeSeen(userId, newest);
}
