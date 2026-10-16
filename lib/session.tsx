import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { supabase } from './supabase';
import { consumeAuthCallbackUrl } from './auth-callback';
import type { Role } from '../api/profile';

interface SessionState {
  session: Session | null;
  role: Role | null;
  loading: boolean;
  passwordRecovery: boolean;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState>({ session: null, role: null, loading: true, passwordRecovery: false, refresh: async () => {} });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  const loadRole = useCallback(async (s: Session | null) => {
    if (!s) { setRole(null); return; }
    const primary = await supabase.from('profiles').select('role, onboarding_complete').eq('id', s.user.id).maybeSingle();
    let data: any = primary.data;
    if (primary.error && /onboarding_complete|schema cache|column/i.test(primary.error.message ?? '')) {
      // Backward compatibility for a Supabase project where the 2026-10-06
      // migration has not been applied yet. Role remains usable; onboarding
      // is handled by the login/role-select flow until the migration is run.
      const fallback = await supabase.from('profiles').select('role').eq('id', s.user.id).maybeSingle();
      if (fallback.error || !fallback.data) { setRole(null); return; }
      data = { ...fallback.data, onboarding_complete: true };
    } else if (primary.error || !data) { setRole(null); return; }
    setRole((data.onboarding_complete !== false) && (data.role === 'provider' || data.role === 'student') ? data.role : null);
  }, []);

  function hasFutureIssuedToken(s: Session | null) {
    if (!s?.access_token) return false;
    try {
      const payload = s.access_token.split('.')[1];
      if (!payload) return false;
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const json = JSON.parse(atob(normalized.padEnd(normalized.length + (4 - normalized.length % 4) % 4, '=')));
      const iat = Number(json?.iat);
      return Number.isFinite(iat) && iat > Math.floor(Date.now() / 1000) + 120;
    } catch {
      return false;
    }
  }

  const recoverInvalidSession = useCallback(async (candidate: Session | null) => {
    if (!candidate) return null;

    // A browser/device clock that is behind the token issuer can leave a stale
    // session which Supabase rejects as `JWT issued at future`. Do not keep
    // retrying that token forever: clear only a clearly-future token, or a
    // session explicitly rejected by Supabase with that exact error.
    if (hasFutureIssuedToken(candidate)) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      return null;
    }

    try {
      const { error } = await supabase.auth.getUser(candidate.access_token);
      if (error && /jwt issued at future/i.test(error.message ?? '')) {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        return null;
      }
    } catch {
      // Network/offline errors must not log a user out.
    }
    return candidate;
  }, []);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const safeSession = await recoverInvalidSession(data.session);
    setSession(safeSession);
    setPasswordRecovery(safeSession?.user?.app_metadata?.provider === 'recovery');
    await loadRole(safeSession);
  }, [loadRole, recoverInvalidSession]);

  useEffect(() => {
    let alive = true;
    // Safety net: never leave the whole app on a blank spinner. If startup
    // (network, deep link, role lookup) stalls, let the app render anyway.
    const failSafe = setTimeout(() => { if (alive) setLoading(false); }, 8000);
    (async () => {
     try {
      const initialUrl = await Linking.getInitialURL().catch(() => null);
      if (initialUrl) await consumeAuthCallbackUrl(initialUrl).catch(() => {});
      const { data } = await supabase.auth.getSession();
      if (!alive) return;

      // Demo/client-review mode: start every cold launch from the registration
      // screen instead of silently reusing the previous browser session. This
      // is opt-in through EXPO_PUBLIC_FRESH_START so production builds can
      // keep normal session persistence.
      const freshStart = process.env.EXPO_PUBLIC_FRESH_START === 'true';
      if (freshStart && data.session) {
        await supabase.auth.signOut({ scope: 'local' });
        setSession(null);
        setRole(null);
      } else {
        const safeSession = await recoverInvalidSession(data.session);
        setSession(safeSession);
        await loadRole(safeSession);
      }
     } catch {
      // fall through to setLoading(false)
     } finally {
      clearTimeout(failSafe);
      if (alive) setLoading(false);
     }
    })();

    const linkSub = Linking.addEventListener('url', ({ url }) => { void consumeAuthCallbackUrl(url); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'SIGNED_OUT') {
        setSession(null);
        setPasswordRecovery(false);
        setRole(null);
        return;
      }
      setSession(next);
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      else if (next?.user?.app_metadata?.provider === 'recovery') setPasswordRecovery(true);
      setTimeout(() => {
        if (!alive) return;
        void (async () => {
          const safeSession = await recoverInvalidSession(next);
          if (!alive) return;
          setSession(safeSession);
          await loadRole(safeSession);
        })();
      }, 0);
    });
    return () => { alive = false; clearTimeout(failSafe); linkSub.remove(); sub.subscription.unsubscribe(); };
  }, [loadRole, recoverInvalidSession]);

  const value = useMemo(() => ({ session, role, loading, passwordRecovery, refresh }), [session, role, loading, passwordRecovery, refresh]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState { return useContext(SessionContext); }
