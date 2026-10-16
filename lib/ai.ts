import { supabase } from './supabase';

const AI_TIMEOUT_MS = 25_000;

export async function askSkillFarm(question: string, courseId?: string | null) {
  const trimmed = question.trim();
  if (!trimmed) throw new Error('Ask a question first.');

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) throw new Error('Please sign in again to use SkillFarm AI.');

  const invoke = supabase.functions.invoke('skillfarm-ai', {
    body: { question: trimmed, courseId: courseId ?? null },
  });

  let result: { data: any; error: any };
  try {
    result = await Promise.race([
      invoke,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('AI request timed out. Please try again.')), AI_TIMEOUT_MS)
      ),
    ]);
  } catch (e: any) {
    const message = String(e?.message || '');
    if (/timed out/i.test(message)) throw e;
    throw new Error('AI service is not reachable. Make sure the SkillFarm AI Edge Function is deployed in Supabase.');
  }

  const { data, error } = result;
  if (error) {
    const message = String(error.message || '');
    if (/404|not found|function.*not.*found|relay/i.test(message)) {
      throw new Error('SkillFarm AI backend is not deployed. Deploy the skillfarm-ai Edge Function in Supabase, then try again.');
    }
    if (/401|403|unauthor/i.test(message)) {
      throw new Error('Your session is not authorized for SkillFarm AI. Sign in again and retry.');
    }
    if (/429|rate limit|busy/i.test(message)) {
      throw new Error('AI is busy right now. Please try again in a moment.');
    }
    throw new Error(message || 'AI could not answer right now.');
  }
  if (!data?.answer) throw new Error(data?.error || 'AI returned an empty answer.');
  return data.answer as string;
}
