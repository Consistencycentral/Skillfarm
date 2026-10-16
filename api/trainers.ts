// ===========================================================================
// Trainer helpers — CRUD for a Learning Partner's trainers. A partner can
// have many trainers (name, qualification, experience, expertise). Trainers
// are public-read so learners can see them on the course detail org card.
// ===========================================================================
import { supabase } from '../lib/supabase';

export interface Trainer {
  id: string;
  provider_id: string;
  name: string;
  qualification: string | null;
  experience: string | null;
  expertise: string | null;
  created_at?: string;
}

export type TrainerInput = Omit<Trainer, 'id' | 'provider_id' | 'created_at'>;

// Public: list trainers for a given Learning Partner (userId = provider_id).
export async function listTrainersByProvider(providerId: string): Promise<Trainer[]> {
  const { data, error } = await supabase
    .from('trainers')
    .select('id, provider_id, name, qualification, experience, expertise, created_at')
    .eq('provider_id', providerId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Trainer[];
}

// Partner: list my own trainers.
export async function listMyTrainers(): Promise<Trainer[]> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return [];
  return listTrainersByProvider(u.user.id);
}

// Partner: create a trainer under my account. provider_id is taken from the
// authenticated session via RLS (insert with check provider_id = auth.uid()).
export async function createTrainer(providerId: string, input: TrainerInput): Promise<Trainer> {
  const { data, error } = await supabase
    .from('trainers')
    .insert({ provider_id: providerId, ...input })
    .select()
    .single();
  if (error) throw error;
  return data as Trainer;
}

// Partner: update one of my trainers.
export async function updateTrainer(id: string, changes: Partial<TrainerInput>): Promise<void> {
  const { error } = await supabase.from('trainers').update(changes as Record<string, any>).eq('id', id);
  if (error) throw error;
}

// Partner: delete one of my trainers.
export async function deleteTrainer(id: string): Promise<void> {
  const { error } = await supabase.from('trainers').delete().eq('id', id);
  if (error) throw error;
}
