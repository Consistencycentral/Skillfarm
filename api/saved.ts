import { supabase } from '../lib/supabase';

export async function getCloudSavedCourseIds(userId: string) {
  const { data, error } = await supabase
    .from('saved_courses')
    .select('course_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => r.course_id as string);
}

export async function toggleCloudSavedCourse(userId: string, courseId: string) {
  const { data: existing, error: readError } = await supabase
    .from('saved_courses')
    .select('course_id')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .maybeSingle();
  if (readError) throw readError;

  if (existing) {
    const { error } = await supabase
      .from('saved_courses')
      .delete()
      .eq('user_id', userId)
      .eq('course_id', courseId);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('saved_courses')
      .insert({ user_id: userId, course_id: courseId });
    if (error) throw error;
  }
  return getCloudSavedCourseIds(userId);
}
