// ===========================================================================
// Storage helper — pick an image from the device and upload it to a Supabase
// Storage bucket, returning its public URL. Shared by the Organization logo
// picker and the course image picker.
//
// Buckets are created by the Supabase migration (supabase/migrations/...):
//   - 'org-logos'      (public read, upload to <uid>/<anything>)
//   - 'course-images'  (public read, upload to <uid>/<anything>)
//   - 'avatars'        (public read, upload to <uid>/<anything>)
// Storage RLS namespaces uploads by the first path segment = auth.uid().
// ===========================================================================
import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';

// Every bucket in the project. Kept as a union so a typo becomes a type error
// rather than a 404 at upload time.
export type ImageBucket = 'org-logos' | 'course-images' | 'avatars';

export interface UploadedImage {
  url: string;
  path: string;
}

// Pick a single image from the library and upload it. Returns null if the
// user cancels. Throws on permission denial or upload failure.
// `aspect` sets the crop frame — square for logos and avatars.
export async function pickAndUploadImage(
  bucket: ImageBucket,
  uid: string,
  aspect: [number, number] = [1, 1],
): Promise<UploadedImage | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Photo permission is needed to upload an image.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect,
    quality: 0.8,
  });
  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }

  const local = result.assets[0];
  return uploadImageFromUri(bucket, uid, local.uri);
}

// Upload an arbitrary image URI (used for the multi-image course picker).
export async function uploadImageFromUri(
  bucket: ImageBucket,
  uid: string,
  uri: string,
): Promise<UploadedImage> {
  // Stable-ish object name: <uid>/<timestamp-ish>.jpg. The first segment MUST
  // be the uid so the storage RLS policy accepts the upload.
  const ext = (uri.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeExt = ext || 'jpg';
  const path = `${uid}/${Date.now()}.${safeExt}`;
  // Infer a real MIME from the extension (blob.type is often empty on RN).
  const mimeByExt: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  };
  const contentType = mimeByExt[safeExt] ?? 'image/jpeg';

  try {
    // Read the bytes as an ArrayBuffer — more reliable than .blob() on RN,
    // and the storage client uploads it as a raw body with our contentType.
    const fileResp = await fetch(uri);
    if (!fileResp.ok) {
      throw new Error(`Could not read the image from device (HTTP ${fileResp.status}).`);
    }
    const arrayBuffer = await fileResp.arrayBuffer();

    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, arrayBuffer, { contentType, upsert: false, cacheControl: '3600' });
    if (error) throw error;

    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    if (!data?.publicUrl) throw new Error('Could not get a public URL for the image.');
    return { url: data.publicUrl, path };
  } catch (e: any) {
    // Explain the common causes so the UI shows something actionable.
    const code = e?.statusCode ?? e?.status;
    const raw = e?.message || String(e);
    if (code === 403) {
      throw new Error('Upload denied by storage rules. Make sure the bucket allows uploads to a folder named with your user id.');
    }
    if (code === 404 || /not found|does not exist/i.test(raw)) {
      throw new Error('Storage bucket not found. An admin needs to run the storage SQL once in Supabase.');
    }
    if (/network request failed|Failed to fetch|Network error/i.test(raw)) {
      throw new Error('Network error during upload. Check your internet connection and try again, or the bucket may not exist yet.');
    }
    throw new Error(`Upload failed: ${raw}`);
  }
}

// Delete an uploaded object by its storage path (used when a course image or
// an avatar is replaced). Silently ignores "not found" errors.
export async function deleteImage(
  bucket: ImageBucket,
  path: string,
): Promise<void> {
  if (!path) return;
  try {
    await supabase.storage.from(bucket).remove([path]);
  } catch {
    // best-effort
  }
}

// Recover the object path from a public URL, e.g.
//   https://<ref>.supabase.co/storage/v1/object/public/avatars/<uid>/123.jpg
//   -> "<uid>/123.jpg"
// Returns null if the URL does not belong to this bucket. Lets a screen delete
// the object a *previous* session uploaded, instead of only the one it just
// picked (which is why replaced logos have been piling up in the bucket).
export function storagePathFromUrl(bucket: ImageBucket, url: string | null): string | null {
  if (!url) return null;
  const marker = `/object/public/${bucket}/`;
  const at = url.indexOf(marker);
  if (at === -1) return null;
  const path = url.slice(at + marker.length).split(/[?#]/)[0];
  return path ? decodeURIComponent(path) : null;
}

