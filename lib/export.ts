// Learner / attendance report exports for the provider dashboard.
//   Excel -> a real .xlsx workbook (lib/exportFiles.ts)
//   PDF   -> phone: Expo Print (A4 landscape, any language) ; web: direct PDF
//            download (falls back to the browser print dialog for Tamil/Hindi text)
//   Web files download straight to the browser's Downloads folder; on a phone
//   the share sheet opens so the file can be saved / opened in Excel / sent.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { Platform } from 'react-native';
import type { StudentRow } from '../api/registrations';
import type { AttendanceLogRow } from './attendanceSecurity';
import { buildPdfBase64, buildXlsxBase64, type Cell, type ReportSpec } from './exportFiles';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSX_UTI = 'org.openxmlformats.spreadsheetml.sheet';

function safeName(s: string) { return (s || 'skillfarm').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'skillfarm'; }
function today() { return new Date().toISOString().slice(0, 10); }

/** Save a file: browser download on web, cache file + share sheet on a phone. */
async function deliverFile(o: { filename: string; mime: string; uti: string; dialogTitle: string; base64?: string; text?: string }): Promise<string> {
  if (Platform.OS === 'web') {
    const g: any = globalThis;
    let blob: Blob;
    if (o.base64 !== undefined) {
      const bin = g.atob(o.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blob = new g.Blob([bytes], { type: o.mime });
    } else {
      blob = new g.Blob([o.text ?? ''], { type: o.mime });
    }
    const url = g.URL.createObjectURL(blob);
    const a = g.document.createElement('a');
    a.href = url; a.download = o.filename;
    g.document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => g.URL.revokeObjectURL(url), 15000);
    return o.filename;
  }
  const dir = FileSystem.cacheDirectory;
  if (!dir) throw new Error('No writable cache directory available on this device.');
  const uri = dir + o.filename;
  if (o.base64 !== undefined) await FileSystem.writeAsStringAsync(uri, o.base64, { encoding: FileSystem.EncodingType.Base64 });
  else await FileSystem.writeAsStringAsync(uri, o.text ?? '', { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: o.mime, dialogTitle: o.dialogTitle, UTI: o.uti });
  return uri;
}

/** Phone: HTML -> PDF file (A4 landscape) with a proper file name, then share. */
async function sharePdfFromHtml(html: string, filename: string, dialogTitle: string): Promise<string> {
  const result = await Print.printToFileAsync({ html, base64: false, width: 842, height: 595 });
  let uri = result.uri;
  const dir = FileSystem.cacheDirectory;
  if (dir) {
    try {
      const target = dir + filename;
      await FileSystem.deleteAsync(target, { idempotent: true });
      await FileSystem.moveAsync({ from: result.uri, to: target });
      uri = target;
    } catch { /* keep Expo's temp name if the rename fails */ }
  }
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle, UTI: 'com.adobe.pdf' });
  return uri;
}

/** Shared PDF path for both reports. */
async function exportPdf(spec: ReportSpec, html: string, filename: string, dialogTitle: string): Promise<string> {
  if (Platform.OS === 'web') {
    const b64 = await buildPdfBase64(spec);
    if (b64) return deliverFile({ filename, mime: 'application/pdf', uti: 'com.adobe.pdf', dialogTitle, base64: b64 });
    // Non-Latin text (Tamil / Hindi ...): let the browser draw it -> "Save as PDF".
    await Print.printAsync({ html });
    return 'printed';
  }
  return sharePdfFromHtml(html, filename, dialogTitle);
}

function plain(v: unknown): Cell {
  if (v === null || v === undefined) return '';
  return typeof v === 'number' ? v : String(v);
}

function learnerSpec(filtered: StudentRow[], providerName: string, filter: ExportFilter): ReportSpec {
  const cols = exportColumns(filter.fields);
  const rangeLabel = filter.date_from || filter.date_to ? `${filter.date_from || 'Any'} to ${filter.date_to || 'Any'}` : 'All dates';
  return {
    sheetName: 'Learners',
    title: 'SkillFarm - Learner Enrollment Report',
    subtitle: providerName || 'SkillFarm',
    meta: [`Course: ${filter.course_title || 'All courses'}`, `Registration date: ${rangeLabel}`, `Learners: ${filtered.length}`, `Generated: ${new Date().toLocaleString()}`],
    head: cols.map((c) => c.label),
    body: filtered.map((s, i) => cols.map((c) => plain(c.csv(s, i)))),
  };
}

// Which learner "additional details" go into the report. All on by default.
export interface ExportFields {
  age: boolean;
  location: boolean;
  experience: boolean;
  additional: boolean;
}
export const DEFAULT_EXPORT_FIELDS: ExportFields = { age: true, location: true, experience: true, additional: true };

export interface ExportFilter {
  course_id?: string;
  course_title?: string;
  date_from?: string;
  date_to?: string;
  fields?: ExportFields;
}

function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function csv(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

function fmtDate(d: string | null): string {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

function filterStudents(students: StudentRow[], filter: ExportFilter): StudentRow[] {
  const within = (d: string | null, from?: string, to?: string) => {
    if (!d) return true;
    const day = new Date(d).toISOString().slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  };
  return students.filter((s) => {
    if (filter.course_id && s.course_id !== filter.course_id) return false;
    return within(s.registered_at, filter.date_from, filter.date_to);
  });
}

function statusLabel(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function attendanceLabel(a: string) { return a === 'present' ? 'Present' : a === 'absent' ? 'Absent' : 'Pending'; }
function experienceLabel(e: boolean | null) { return e === true ? 'Yes' : e === false ? 'No' : ''; }

type Col = { label: string; html: (s: StudentRow, i: number) => string; csv: (s: StudentRow, i: number) => unknown };

function exportColumns(fields: ExportFields = DEFAULT_EXPORT_FIELDS): Col[] {
  const list: Col[] = [
    { label: '#', html: (_s, i) => String(i + 1), csv: (_s, i) => i + 1 },
    { label: 'Learner', html: (s) => esc(s.learner_name || s.student_name) || '—', csv: (s) => s.learner_name ?? s.student_name ?? '' },
    { label: 'Phone', html: (s) => esc(s.learner_phone || s.student_phone) || '—', csv: (s) => s.learner_phone ?? s.student_phone ?? '' },
    { label: 'Email', html: (s) => esc(s.learner_email) || '—', csv: (s) => s.learner_email ?? '' },
  ];
  if (fields.age) list.push({ label: 'Age', html: (s) => String(s.learner_age ?? '—'), csv: (s) => s.learner_age ?? '' });
  if (fields.additional) list.push({ label: 'Additional details', html: (s) => esc(s.learner_additional_details) || '—', csv: (s) => s.learner_additional_details ?? '' });
  if (fields.location) list.push({ label: 'Location', html: (s) => esc(s.learner_location) || '—', csv: (s) => s.learner_location ?? '' });
  if (fields.experience) list.push({ label: 'Experience', html: (s) => esc(experienceLabel(s.learner_experience)) || '—', csv: (s) => experienceLabel(s.learner_experience) });
  list.push(
    { label: 'Course', html: (s) => esc(s.course_title) || '—', csv: (s) => s.course_title },
    { label: 'Batch', html: (s) => esc(s.batch_name) || '—', csv: (s) => s.batch_name ?? '' },
    { label: 'Batch start', html: (s) => esc(fmtDate(s.batch_start_date)) || '—', csv: (s) => fmtDate(s.batch_start_date) },
    { label: 'Batch end', html: (s) => esc(fmtDate(s.batch_end_date)) || '—', csv: (s) => fmtDate(s.batch_end_date) },
    { label: 'Status', html: (s) => esc(statusLabel(s.status)), csv: (s) => statusLabel(s.status) },
    { label: 'Attendance', html: (s) => esc(attendanceLabel(s.attendance_status ?? 'pending')), csv: (s) => attendanceLabel(s.attendance_status ?? 'pending') },
    { label: 'Registered on', html: (s) => esc(fmtDate(s.registered_at)), csv: (s) => fmtDate(s.registered_at) },
  );
  return list;
}

function reportHtml(filtered: StudentRow[], providerName: string, filter: ExportFilter): string {
  const rangeLabel = filter.date_from || filter.date_to
    ? `${filter.date_from || 'Any'} → ${filter.date_to || 'Any'}` : 'All dates';
  const courseLabel = filter.course_title || 'All courses';
  const cols = exportColumns(filter.fields);
  const rowsHtml = filtered
    .map((s, i) => `<tr>${cols.map((c) => `<td>${c.html(s, i)}</td>`).join('')}</tr>`)
    .join('\n');
  const headHtml = cols.map((c) => `<th>${c.label}</th>`).join('');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>SkillFarm — Learner Enrollment Report</title>
<style>
*{box-sizing:border-box}body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1E2A1E;padding:24px;background:#fff}
h1{margin:0 0 4px;font-size:22px;color:#2E7D32}.sub{color:#5E6B5E;font-size:13px;margin-bottom:16px}.meta{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:16px;font-size:13px;color:#5E6B5E}.meta b{color:#1E2A1E}
table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #D9DED9;padding:7px 8px;text-align:left;vertical-align:top}th{background:#EFF3EF;font-weight:700;white-space:nowrap}
@media print{body{padding:0}table{font-size:9px}@page{size:landscape;margin:12mm}}
</style></head><body>
<h1>SkillFarm — Learner Enrollment Report</h1><div class="sub">${esc(providerName || 'SkillFarm')}</div>
<div class="meta"><div>Course: <b>${esc(courseLabel)}</b></div><div>Registration date: <b>${esc(rangeLabel)}</b></div><div>Learners: <b>${filtered.length}</b></div><div>Generated: <b>${esc(new Date().toLocaleString())}</b></div></div>
<table><thead><tr>${headHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
</body></html>`;
}

export async function exportStudentsToHtml(students: StudentRow[], providerName = 'skillfarm', filter: ExportFilter = {}) {
  const filtered = filterStudents(students, filter);
  if (!filtered.length) throw new Error('No learners match the selected course/date filter.');
  const html = reportHtml(filtered, providerName, filter);
  return deliverFile({ filename: `SkillFarm_${safeName(providerName)}_${today()}.html`, mime: 'text/html', uti: 'public.html', dialogTitle: 'Learner HTML report', text: html });
}

export async function exportLearnerReportAsPdf(students: StudentRow[], providerName = 'skillfarm', filter: ExportFilter = {}) {
  const filtered = filterStudents(students, filter);
  if (!filtered.length) throw new Error('No learners match the selected course/date filter.');
  const html = reportHtml(filtered, providerName, filter);
  const spec = learnerSpec(filtered, providerName, filter);
  return exportPdf(spec, html, `SkillFarm_Learners_${safeName(providerName)}_${today()}.pdf`, 'SkillFarm learner report - PDF');
}

export async function exportLearnerReportAsExcel(students: StudentRow[], providerName = 'skillfarm', filter: ExportFilter = {}) {
  const filtered = filterStudents(students, filter);
  if (!filtered.length) throw new Error('No learners match the selected course/date filter.');
  const base64 = await buildXlsxBase64(learnerSpec(filtered, providerName, filter));
  return deliverFile({ filename: `SkillFarm_Learners_${safeName(providerName)}_${today()}.xlsx`, mime: XLSX_MIME, uti: XLSX_UTI, dialogTitle: 'SkillFarm learner report - Excel', base64 });
}

// Backwards-compatible default export action: PDF.
export async function exportLearnerReport(students: StudentRow[], providerName = 'skillfarm', filter: ExportFilter = {}) {
  return exportLearnerReportAsPdf(students, providerName, filter);
}


// ---------------------------------------------------------------------------
// Day-wise attendance report: one row per approved learner, one column per
// training day that has any attendance recorded. P = present, A = absent,
// "-" = nothing recorded for that learner on that day.
// ---------------------------------------------------------------------------
type AttendanceMatrix = { dates: string[]; rows: { s: StudentRow; marks: string[]; present: number; percent: number }[] };

function buildAttendanceMatrix(students: StudentRow[], logs: AttendanceLogRow[], filter: ExportFilter): AttendanceMatrix {
  const learners = students.filter((s) => (s.status === 'registered' || s.status === 'completed') && (!filter.course_id || s.course_id === filter.course_id));
  const ids = new Set(learners.map((s) => s.registration_id));
  const byReg = new Map<string, Map<string, string>>();
  const dateSet = new Set<string>();
  for (const l of logs) {
    if (!ids.has(l.registration_id)) continue;
    dateSet.add(l.attendance_date);
    if (!byReg.has(l.registration_id)) byReg.set(l.registration_id, new Map());
    byReg.get(l.registration_id)!.set(l.attendance_date, l.status);
  }
  const dates = Array.from(dateSet).sort();
  const rows = learners
    .sort((a, b) => (a.course_title + (a.batch_name ?? '') + (a.learner_name ?? '')).localeCompare(b.course_title + (b.batch_name ?? '') + (b.learner_name ?? '')))
    .map((s) => {
      const m = byReg.get(s.registration_id);
      const marks = dates.map((d) => { const v = m?.get(d); return v === 'present' ? 'P' : v === 'absent' ? 'A' : '-'; });
      const present = marks.filter((x) => x === 'P').length;
      return { s, marks, present, percent: dates.length ? Math.round((present / dates.length) * 100) : 0 };
    });
  return { dates, rows };
}

function shortDate(d: string) {
  try { return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short' }); } catch { return d; }
}

function attendanceHtml(matrix: AttendanceMatrix, providerName: string, filter: ExportFilter): string {
  const head = ['#', 'Learner', 'Phone', 'Course', 'Batch', ...matrix.dates.map(shortDate), 'Days present', '%'].map((h) => `<th>${esc(h)}</th>`).join('');
  const body = matrix.rows.map((r, i) => {
    const cells = [String(i + 1), esc(r.s.learner_name || r.s.student_name) || '—', esc(r.s.learner_phone || r.s.student_phone) || '—', esc(r.s.course_title), esc(r.s.batch_name) || '—']
      .map((c) => `<td>${c}</td>`).join('');
    const marks = r.marks.map((m) => `<td class="m ${m === 'P' ? 'p' : m === 'A' ? 'a' : ''}">${m}</td>`).join('');
    return `<tr>${cells}${marks}<td><b>${r.present}</b></td><td>${r.percent}%</td></tr>`;
  }).join('\n');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>SkillFarm — Attendance Report</title>
<style>
*{box-sizing:border-box}body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1E2A1E;padding:24px;background:#fff}
h1{margin:0 0 4px;font-size:22px;color:#2E7D32}.sub{color:#5E6B5E;font-size:13px;margin-bottom:12px}.meta{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:16px;font-size:13px;color:#5E6B5E}.meta b{color:#1E2A1E}
table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #D9DED9;padding:6px 7px;text-align:left}th{background:#EFF3EF;white-space:nowrap}
td.m{text-align:center;font-weight:700}td.p{background:#E8F5E9;color:#2E7D32}td.a{background:#FFEBEE;color:#C62828}
@media print{body{padding:0}table{font-size:9px}@page{size:landscape;margin:12mm}}
</style></head><body>
<h1>SkillFarm — Attendance Report</h1><div class="sub">${esc(providerName || 'SkillFarm')}</div>
<div class="meta"><div>Course: <b>${esc(filter.course_title || 'All courses')}</b></div><div>Training days recorded: <b>${matrix.dates.length}</b></div><div>Learners: <b>${matrix.rows.length}</b></div><div>Generated: <b>${esc(new Date().toLocaleString())}</b></div></div>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<p style="font-size:11px;color:#5E6B5E;margin-top:10px">P = present · A = absent · - = not recorded. Percentage = present days ÷ training days recorded.</p>
</body></html>`;
}

function attendanceSpec(matrix: AttendanceMatrix, providerName: string, filter: ExportFilter): ReportSpec {
  const first = 5;
  return {
    sheetName: 'Attendance',
    title: 'SkillFarm - Attendance Report',
    subtitle: providerName || 'SkillFarm',
    meta: [`Course: ${filter.course_title || 'All courses'}`, `Training days recorded: ${matrix.dates.length}`, `Learners: ${matrix.rows.length}`, `Generated: ${new Date().toLocaleString()}`],
    head: ['#', 'Learner', 'Phone', 'Course', 'Batch', ...matrix.dates.map(shortDate), 'Days present', 'Attendance %'],
    body: matrix.rows.map((r, i) => [
      i + 1, r.s.learner_name ?? r.s.student_name ?? '', r.s.learner_phone ?? r.s.student_phone ?? '',
      r.s.course_title, r.s.batch_name ?? '', ...r.marks, r.present, r.percent,
    ]),
    markCols: [first, first + matrix.dates.length - 1],
    percentCols: [first + matrix.dates.length + 1],
    note: 'P = present, A = absent, - = not recorded. Attendance % = present days / training days recorded.',
  };
}

export async function exportAttendanceReport(
  kind: 'pdf' | 'excel',
  students: StudentRow[],
  logs: AttendanceLogRow[],
  providerName = 'skillfarm',
  filter: ExportFilter = {},
) {
  const matrix = buildAttendanceMatrix(students, logs, filter);
  if (!matrix.rows.length) throw new Error('No approved learners match the selected course.');
  if (!matrix.dates.length) throw new Error('No attendance has been recorded yet for the selected course.');
  const spec = attendanceSpec(matrix, providerName, filter);
  const base = `SkillFarm_Attendance_${safeName(filter.course_title || providerName)}_${today()}`;

  if (kind === 'pdf') {
    return exportPdf(spec, attendanceHtml(matrix, providerName, filter), `${base}.pdf`, 'SkillFarm attendance report - PDF');
  }
  const base64 = await buildXlsxBase64(spec);
  return deliverFile({ filename: `${base}.xlsx`, mime: XLSX_MIME, uti: XLSX_UTI, dialogTitle: 'SkillFarm attendance report - Excel', base64 });
}
