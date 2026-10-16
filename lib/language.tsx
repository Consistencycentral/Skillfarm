import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Lang, LanguageContextValue } from './i18n';
import { LanguageContext, strings } from './i18n';
import { supabase } from './supabase';
import { getPreferredLanguageLocal, setPreferredLanguageLocal } from './localPreferences';

const validLangs = new Set<Lang>(Object.keys(strings) as Lang[]);
function normalizeLanguage(value: unknown): Lang {
  return typeof value === 'string' && validLangs.has(value as Lang) ? value as Lang : 'en';
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>('en');
  const [loading, setLoading] = useState(true);

  const loadForSession = useCallback(async (userId?: string | null) => {
    if (!userId) {
      setLang('en');
      setLoading(false);
      return;
    }
    const local = await getPreferredLanguageLocal();
    if (local) setLang(normalizeLanguage(local));
    // Language is intentionally local-first. This keeps the selector working
    // even when the connected Supabase project has not applied the optional
    // profiles.preferred_language migration yet.
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) void loadForSession(data.session?.user.id);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') setLang('en');
      setTimeout(() => { if (alive) void loadForSession(session?.user.id); }, 0);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [loadForSession]);

  const setLanguage = useCallback(async (next: Lang) => {
    const normalized = normalizeLanguage(next);
    // Do not depend on profiles.preferred_language at runtime. The DB column
    // is optional for older deployments; the app must still change language.
    await setPreferredLanguageLocal(normalized);
    setLang(normalized);
  }, []);

  const value = useMemo<LanguageContextValue>(() => ({ lang, t: strings[lang], setLanguage, loading }), [lang, setLanguage, loading]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
