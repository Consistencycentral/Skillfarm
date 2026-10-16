import * as DocumentPicker from 'expo-document-picker';
import { supabase } from './supabase';

export async function pickMaterialFile() {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','text/csv','text/plain','video/*'], copyToCacheDirectory: true, multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  return result.assets[0];
}


export async function pickPdfFile() {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  return result.assets[0];
}

async function uriToDataUri(uri: string): Promise<string> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Could not read the captured paper image.');
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not prepare the captured paper image.'));
    reader.readAsDataURL(blob);
  });
}

export async function paperPhotoToPdf(photoUri: string) {
  const [Print, dataUri] = await Promise.all([
    import('expo-print'),
    uriToDataUri(photoUri),
  ]);
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"/><style>html,body{margin:0;padding:0;background:#fff;}img{display:block;width:100%;height:auto;}</style></head><body><img src="${dataUri}" /></body></html>`;
  const result = await Print.printToFileAsync({ html });
  return { uri: result.uri, name: `SkillFarm-paper-scan-${Date.now()}.pdf`, mimeType: 'application/pdf' as const, size: null };
}

export async function uploadMaterialFile(uid: string, courseId: string, asset: { uri:string; name:string; mimeType?:string|null; size?:number|null }) {
  const safe = asset.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${uid}/${courseId}/${Date.now()}-${safe}`;
  const resp = await fetch(asset.uri); if (!resp.ok) throw new Error('Could not read the selected file.');
  const bytes = await resp.arrayBuffer();
  const { error } = await supabase.storage.from('course-materials').upload(path, bytes, { contentType: asset.mimeType || 'application/octet-stream', upsert:false });
  if (error) throw error;
  return { path, size: asset.size ?? null, mimeType: asset.mimeType ?? null };
}

export async function createMaterialDownloadUrl(path: string) {
  const { data, error } = await supabase.storage.from('course-materials').createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) throw error ?? new Error('Could not create a secure download URL.');
  return data.signedUrl;
}
export async function deleteMaterialFile(path: string) { if (path) await supabase.storage.from('course-materials').remove([path]); }
