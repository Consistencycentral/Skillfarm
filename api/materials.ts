import { supabase } from '../lib/supabase';

export type MaterialType = 'pdf' | 'note' | 'video' | 'poll'; // Excel files are stored as document materials with their original MIME type
export type CourseMaterial = {
  id: string;
  course_id: string;
  title: string;
  title_ta: string | null;
  description: string | null;
  description_ta: string | null;
  type: MaterialType;
  storage_path: string | null;
  public_url: string | null;
  file_size: number | null;
  mime_type: string | null;
  version: number;
  is_required: boolean;
  poll_options: string[] | null;
  updated_at: string;
  created_at: string;
  course_title?: string;
  course_category?: string;
};

export async function listCourseMaterials(courseId: string) {
  // course_id is the only relationship needed here. Do not use nested
  // PostgREST joins: a stale schema cache must never leave Materials spinning.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(courseId)) {
    throw new Error('Invalid course ID.');
  }
  const { data, error } = await supabase
    .from('course_materials')
    .select('*')
    .eq('course_id', courseId)
    .order('type', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((x: any) => ({ ...x, course_id: courseId })) as CourseMaterial[];
}

export async function createMaterial(input: Omit<CourseMaterial, 'id'|'updated_at'|'created_at'|'version'>) {
  const { data, error } = await supabase.from('course_materials').insert({ ...input, version: 1 }).select('*').single();
  if (error) throw error;
  return data as CourseMaterial;
}

export async function updateMaterial(id: string, patch: Partial<Pick<CourseMaterial,'title'|'title_ta'|'description'|'description_ta'|'storage_path'|'public_url'|'file_size'|'mime_type'|'poll_options'|'is_required'>>) {
  const { data: old } = await supabase.from('course_materials').select('version').eq('id', id).single();
  const { data, error } = await supabase.from('course_materials').update({ ...patch, version: (old?.version ?? 1) + 1 }).eq('id', id).select('*').single();
  if (error) throw error;
  return data as CourseMaterial;
}

export async function deleteMaterial(id: string) {
  const { error } = await supabase.from('course_materials').delete().eq('id', id);
  if (error) throw error;
}

export async function getCourseMaterial(id: string) {
  const { data, error } = await supabase.from('course_materials').select('*').eq('id', id).single();
  if (error) throw error;
  return data as CourseMaterial;
}
