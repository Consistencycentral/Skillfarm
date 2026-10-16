// ===========================================================================
// File builders for the report exports. No Expo / React Native imports in here
// on purpose: it only turns rows into file bytes (base64), so the same code
// runs on Android, iOS and web.
//
//   buildXlsxBase64 -> a REAL .xlsx workbook (styled header, column widths,
//                      filters, green/red P/A cells) - not a CSV.
//   buildPdfBase64  -> a real text PDF (A4 landscape, repeating header row,
//                      page numbers). Used on web, where there is no native
//                      print-to-file. Returns null when the data has characters
//                      the built-in PDF fonts cannot draw (Tamil, Hindi ...);
//                      the caller then falls back to the browser's print dialog.
// ===========================================================================

export type Cell = string | number;

export interface ReportSpec {
  sheetName: string;
  title: string;
  /** e.g. provider name */
  subtitle?: string;
  /** one line each, e.g. "Course: React Basics" */
  meta: string[];
  head: string[];
  body: Cell[][];
  /** inclusive column range holding P / A / - marks (attendance matrix) */
  markCols?: [number, number];
  /** column indexes holding a 0-100 percentage */
  percentCols?: number[];
  /** footnote under the table */
  note?: string;
}

const GREEN = '2E7D32';
const BORDER = { style: 'thin', color: { rgb: 'D9DED9' } };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

function cleanSheetName(n: string) {
  return (n.replace(/[\\/?*[\]:]/g, ' ').trim() || 'Report').slice(0, 31);
}

// ------------------------------------------------------------------- XLSX
export async function buildXlsxBase64(spec: ReportSpec): Promise<string> {
  const mod: any = await import('xlsx-js-style');
  const XLSX = mod.default ?? mod;
  const ncols = spec.head.length;

  const aoa: any[][] = [];
  aoa.push([spec.title]);
  if (spec.subtitle) aoa.push([spec.subtitle]);
  spec.meta.forEach((m) => aoa.push([m]));
  aoa.push([]);
  const headerRow = aoa.length;
  aoa.push(spec.head);
  spec.body.forEach((r) => aoa.push(r));
  if (spec.note) { aoa.push([]); aoa.push([spec.note]); }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Title block
  const setStyle = (r: number, c: number, s: any) => {
    const ref = XLSX.utils.encode_cell({ r, c });
    if (ws[ref]) ws[ref].s = s;
  };
  setStyle(0, 0, { font: { bold: true, sz: 15, color: { rgb: GREEN } } });
  for (let r = 1; r < headerRow; r++) setStyle(r, 0, { font: { sz: 11, color: { rgb: '5E6B5E' } } });

  // Header row
  for (let c = 0; c < ncols; c++) {
    setStyle(headerRow, c, {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: GREEN } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: BORDERS,
    });
  }

  // Body
  spec.body.forEach((row, i) => {
    const r = headerRow + 1 + i;
    for (let c = 0; c < ncols; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const v = row[c];
      const base: any = { border: BORDERS, alignment: { vertical: 'top', wrapText: true } };
      if (spec.markCols && c >= spec.markCols[0] && c <= spec.markCols[1]) {
        base.alignment = { horizontal: 'center', vertical: 'center' };
        if (v === 'P') { base.fill = { patternType: 'solid', fgColor: { rgb: 'E8F5E9' } }; base.font = { bold: true, color: { rgb: GREEN } }; }
        else if (v === 'A') { base.fill = { patternType: 'solid', fgColor: { rgb: 'FFEBEE' } }; base.font = { bold: true, color: { rgb: 'C62828' } }; }
        else base.font = { color: { rgb: '9AA39A' } };
      }
      if (spec.percentCols?.includes(c) && typeof v === 'number') {
        base.numFmt = '0"%"';
        base.alignment = { horizontal: 'center', vertical: 'top' };
      }
      if (!ws[ref]) ws[ref] = { t: 's', v: '' }; // keep borders on blank cells
      ws[ref].s = base;
    }
  });
  if (spec.note) setStyle(headerRow + spec.body.length + 2, 0, { font: { italic: true, sz: 10, color: { rgb: '5E6B5E' } } });

  // Column widths from the longest value in each column
  const widths = spec.head.map((h, c) => {
    let max = h.length;
    spec.body.forEach((r) => { max = Math.max(max, String(r[c] ?? '').length); });
    const isMark = spec.markCols && c >= spec.markCols[0] && c <= spec.markCols[1];
    return { wch: isMark ? Math.max(7, Math.min(max + 2, 9)) : Math.min(Math.max(max + 3, 6), 42) };
  });
  ws['!cols'] = widths;
  ws['!rows'] = [];
  ws['!rows'][headerRow] = { hpt: 24 };
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, Math.min(ncols - 1, 6)) } }];
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: { r: headerRow + Math.max(spec.body.length, 1), c: ncols - 1 } }) };

  const wb = XLSX.utils.book_new();
  wb.Props = { Title: spec.title, Author: 'SkillFarm', CreatedDate: new Date() };
  XLSX.utils.book_append_sheet(wb, ws, cleanSheetName(spec.sheetName));
  return XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
}

// -------------------------------------------------------------------- PDF
// Characters the standard PDF fonts (WinAnsi) can draw.
const PDF_SAFE = /^[\u0009\u000A\u0020-\u007E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026]*$/;

export function pdfCanDraw(spec: ReportSpec): boolean {
  const all = [spec.title, spec.subtitle ?? '', ...spec.meta, ...spec.head, spec.note ?? '', ...spec.body.flat().map(String)];
  return all.every((t) => PDF_SAFE.test(t));
}

export async function buildPdfBase64(spec: ReportSpec): Promise<string | null> {
  if (!pdfCanDraw(spec)) return null;
  const { jsPDF } = await import('jspdf');
  const autoTable: any = ((await import('jspdf-autotable')) as any).default;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const margin = 28;
  doc.setProperties({ title: spec.title, author: 'SkillFarm' });

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(46, 125, 50);
  doc.text(spec.title, margin, 36);
  let y = 52;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(94, 107, 94);
  if (spec.subtitle) { doc.text(spec.subtitle, margin, y); y += 14; }
  spec.meta.forEach((m) => { doc.text(m, margin, y); y += 13; });

  const ncols = spec.head.length;
  const fontSize = ncols > 14 ? 6.5 : ncols > 10 ? 7.5 : 8.5;
  const [m0, m1] = spec.markCols ?? [-1, -2];

  autoTable(doc, {
    startY: y + 4,
    head: [spec.head],
    body: spec.body.map((r) => r.map((c) => (c === '' || c == null ? '-' : String(c)))),
    margin: { left: margin, right: margin, bottom: 34 },
    styles: { fontSize, cellPadding: 3.5, lineColor: [217, 222, 217], lineWidth: 0.4, textColor: [30, 42, 30], overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: [46, 125, 50], textColor: 255, fontStyle: 'bold', halign: 'center' },
    alternateRowStyles: { fillColor: [247, 250, 247] },
    didParseCell: (d: any) => {
      if (d.section !== 'body') return;
      const c = d.column.index;
      if (c >= m0 && c <= m1) {
        d.cell.styles.halign = 'center';
        d.cell.styles.fontStyle = 'bold';
        if (d.cell.raw === 'P') { d.cell.styles.fillColor = [232, 245, 233]; d.cell.styles.textColor = [46, 125, 50]; }
        else if (d.cell.raw === 'A') { d.cell.styles.fillColor = [255, 235, 238]; d.cell.styles.textColor = [198, 40, 40]; }
        else d.cell.styles.textColor = [154, 163, 154];
      }
      if (spec.percentCols?.includes(c)) {
        d.cell.styles.halign = 'center';
        if (d.cell.raw !== '-') d.cell.text = [`${d.cell.raw}%`];
      }
    },
  });

  const pages = doc.getNumberOfPages();
  const h = doc.internal.pageSize.getHeight();
  const w = doc.internal.pageSize.getWidth();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(120, 130, 120);
    if (i === pages && spec.note) doc.text(spec.note, margin, h - 20);
    doc.text(`Page ${i} of ${pages}`, w - margin, h - 20, { align: 'right' });
  }
  const uri = doc.output('datauristring');
  return uri.slice(uri.indexOf('base64,') + 7);
}
