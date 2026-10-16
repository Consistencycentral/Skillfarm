# v12.10 - proper PDF / Excel / Attendance exports

Before: "Excel" was a .csv, web downloads failed ("No writable cache directory"), phone PDF was portrait
with a random file name.

* lib/exportFiles.ts (new): builds a REAL .xlsx (styled header, auto column widths, filters, green/red P/A cells,
  % column) and a text PDF (A4 landscape, repeating header, page numbers).
* lib/export.ts: Learner report + Attendance report, PDF and Excel
  - Web: file downloads straight to the browser Downloads folder with a proper name
    (SkillFarm_Learners_<partner>_<date>.xlsx / .pdf, SkillFarm_Attendance_<course>_<date>.xlsx / .pdf).
    PDF with Tamil/Hindi text falls back to the browser print dialog -> "Save as PDF".
  - Phone: file is saved with the proper name and the share sheet opens (Save to device / Drive / Excel / WhatsApp).
    Phone PDF is now A4 landscape and supports every language.
* package.json: + xlsx-js-style, jspdf, jspdf-autotable (pure JS, no native code).
  Run `npm install`. The phone needs a NEW APK build (eas build) because new packages were added.
