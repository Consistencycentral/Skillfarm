import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import type { CourseMaterial } from '../api/materials';
import { createMaterialDownloadUrl } from './materialStorage';

export type DownloadedMaterial = CourseMaterial & { localUri: string; downloadedAt: string };
const KEY = 'skillfarm.downloaded-materials.v1';

async function readAll(): Promise<DownloadedMaterial[]> {
  try { return JSON.parse((await AsyncStorage.getItem(KEY)) || '[]'); } catch { return []; }
}
async function writeAll(items: DownloadedMaterial[]) { await AsyncStorage.setItem(KEY, JSON.stringify(items)); }

export async function listDownloadedMaterials() { return readAll(); }
export async function getDownloadedMaterial(id: string) { return (await readAll()).find(x => x.id === id) ?? null; }

export async function downloadMaterial(material: CourseMaterial, onProgress?: (p:number)=>void) {
  if (material.type === 'poll' || !material.storage_path) throw new Error('This material cannot be downloaded.');
  const signedUrl = await createMaterialDownloadUrl(material.storage_path);
  const base = (FileSystem.documentDirectory ?? FileSystem.cacheDirectory);
  if (!base) throw new Error('Local storage is unavailable on this device.');
  const ext = material.type === 'pdf' ? 'pdf' : material.type === 'video' ? 'mp4' : 'txt';
  const localUri = `${base}skillfarm-material-${material.id}-v${material.version}.${ext}`;
  const result = await FileSystem.downloadAsync(signedUrl, localUri, {
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (onProgress) onProgress(1);
  const all = await readAll();
  const previous = all.find(x => x.id === material.id);
  if (previous?.localUri && previous.localUri !== result.uri) await FileSystem.deleteAsync(previous.localUri, { idempotent: true }).catch(() => {});
  const next = all.filter(x => x.id !== material.id);
  next.push({ ...material, localUri: result.uri, downloadedAt: new Date().toISOString() });
  await writeAll(next);
  return result.uri;
}

export async function deleteDownloadedMaterial(id: string) {
  const current = await getDownloadedMaterial(id);
  if (current?.localUri) await FileSystem.deleteAsync(current.localUri, { idempotent: true }).catch(() => {});
  await writeAll((await readAll()).filter(x => x.id !== id));
}
