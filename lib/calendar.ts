import { Linking } from 'react-native';
import type { Batch } from '../api/batches';

function compactDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}

export async function addBatchToCalendar(courseTitle: string, batch: Batch, location?: string | null) {
  if (!batch.start_date) throw new Error('This batch does not have a start date yet.');
  const start = compactDate(batch.start_date);
  if (!start) throw new Error('This batch has an invalid start date.');
  const end = batch.end_date ? compactDate(batch.end_date) : null;
  const startDate = new Date(batch.start_date);
  const endDate = batch.end_date ? new Date(batch.end_date) : new Date(startDate.getTime() + 60 * 60 * 1000);
  const endValue = end ?? compactDate(endDate.toISOString());
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${courseTitle} — ${batch.name}`,
    dates: `${start}/${endValue}`,
    details: `SkillFarm course batch${batch.timings ? `\nTimings: ${batch.timings}` : ''}`,
    location: location ?? '',
  });
  const url = `https://calendar.google.com/calendar/render?${params.toString()}`;
  const supported = await Linking.canOpenURL(url);
  if (!supported) throw new Error('Could not open your calendar.');
  await Linking.openURL(url);
}
