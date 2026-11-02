// Teacher page: export the (filtered) student list with scores.
//  - Excel: a UTF-8 CSV with a byte-order mark, which Excel opens with Thai intact
//  - Word: built in the browser with the docx library (loaded only when used)
//  - PDF: a print-ready page the browser lays out, then "Save as PDF" in the print
//    dialog — the browser shapes Thai correctly, which PDF libraries tend not to
// (browser-only: lives outside src/lib, which the server also compiles)

export interface ExportRow {
  studentId: string;
  name: string;
  section: string;
  passed: number;
  points: number;
  /** assignments solved by their deadline / assignments set for the class */
  onTime?: number;
  assigned?: number;
}

export interface ExportInfo {
  /** what the list is: "SEC 1 · 2/2569", "ทุกห้อง", … */
  title: string;
  /** extra line, e.g. the search text used */
  note?: string;
  totalProblems: number;
  rows: ExportRow[];
}

const HEAD = ['ลำดับ', 'รหัสนักศึกษา', 'ชื่อ–นามสกุล', 'ห้อง', 'ผ่าน (ข้อ)', 'คะแนน'];
/** the assignments column only appears when some student has assignments */
const withWork = (info: ExportInfo) => info.rows.some((r) => (r.assigned ?? 0) > 0);
const headFor = (info: ExportInfo) => (withWork(info) ? [...HEAD.slice(0, 5), 'งานตรงเวลา', HEAD[5]] : HEAD);
const cellsFor = (info: ExportInfo, r: ExportRow, k: number) => {
  const base = [String(k + 1), r.studentId, r.name, r.section || '—', `${r.passed}/${info.totalProblems}`];
  const work = r.assigned ? `${r.onTime ?? 0}/${r.assigned}` : '—';
  return withWork(info) ? [...base, work, r.points.toLocaleString()] : [...base, r.points.toLocaleString()];
};
const today = () => new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
const now = () => new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
const avg = (rows: ExportRow[]) => (rows.length ? rows.reduce((s, r) => s + r.points, 0) / rows.length : 0);

/** "รายชื่อนักศึกษา_SEC_1_2-2569_2026-11-02" */
function fileName(info: ExportInfo, ext: string) {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `รายชื่อนักศึกษา_${info.title.replace(/[·/\\:*?"<>|]+/g, '-').replace(/\s+/g, '_')}_${stamp}.${ext}`;
}

function summary(info: ExportInfo) {
  return `นักศึกษา ${info.rows.length} คน · คะแนนเฉลี่ย ${avg(info.rows).toFixed(1)} · โจทย์ทั้งหมด ${info.totalProblems} ข้อ · ส่งออกเมื่อ ${today()} ${now()} น.`;
}

// ---------- Word ----------

export async function exportDocx(info: ExportInfo) {
  const { AlignmentType, BorderStyle, Document, Packer, PageOrientation, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } = await import('docx');
  // TH Sarabun New is the standard Thai document font; Word substitutes if it isn't installed
  const FONT = { ascii: 'TH Sarabun New', hAnsi: 'TH Sarabun New', cs: 'TH Sarabun New', eastAsia: 'TH Sarabun New' };
  const run = (text: string, o: { bold?: boolean; size?: number; color?: string } = {}) =>
    new TextRun({ text, font: FONT, bold: o.bold, boldComplexScript: o.bold, size: o.size ?? 28, sizeComplexScript: o.size ?? 28, color: o.color });
  const line = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
  const borders = { top: line, bottom: line, left: line, right: line };
  // column widths (twips)
  const work = withWork(info);
  const widths = work ? [700, 1700, 3300, 2100, 1100, 1200, 1100] : [800, 1900, 3800, 2300, 1300, 1300];
  const right = work ? [false, false, false, false, true, true, true] : [false, false, false, false, true, true];
  const center = widths.map((_, i) => i === 0);
  const cell = (text: string, i: number, header = false) =>
    new TableCell({
      width: { size: widths[i], type: WidthType.DXA },
      borders,
      shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F2E6E6' } : undefined,
      margins: { top: 40, bottom: 40, left: 100, right: 100 },
      children: [
        new Paragraph({
          alignment: header ? AlignmentType.CENTER : right[i] ? AlignmentType.RIGHT : center[i] ? AlignmentType.CENTER : AlignmentType.LEFT,
          children: [run(text, { bold: header })],
        }),
      ],
    });

  const table = new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: headFor(info).map((h, i) => cell(h, i, true)) }),
      ...info.rows.map((r, k) => new TableRow({ cantSplit: true, children: cellsFor(info, r, k).map((t, i) => cell(t, i)) })),
    ],
  });

  const doc = new Document({
    creator: 'MIPS Lab',
    title: `รายชื่อนักศึกษา — ${info.title}`,
    sections: [
      {
        properties: { page: { size: { orientation: PageOrientation.PORTRAIT }, margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [run('รายชื่อนักศึกษาและคะแนน', { bold: true, size: 40 })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [run(info.title, { bold: true, size: 32 })] }),
          ...(info.note ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(info.note, { size: 26, color: '666666' })] })] : []),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [run(summary(info), { size: 26, color: '666666' })] }),
          table,
        ],
      },
    ],
  });

  download(await Packer.toBlob(doc), fileName(info, 'docx'));
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------- Excel (CSV) ----------

/** Numbers stay numbers so Excel can sum them; the student id is kept as text (leading zeros, dashes). */
export function exportCsv(info: ExportInfo) {
  const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const work = withWork(info);
  const head = ['ลำดับ', 'รหัสนักศึกษา', 'ชื่อ–นามสกุล', 'ห้อง', 'ผ่าน (ข้อ)', `โจทย์ทั้งหมด`, ...(work ? ['งานตรงเวลา', 'งานที่มอบหมาย'] : []), 'คะแนน'];
  const lines = info.rows.map((r, k) =>
    [String(k + 1), `="${r.studentId}"`, q(r.name), q(r.section || ''), String(r.passed), String(info.totalProblems), ...(work ? [String(r.onTime ?? 0), String(r.assigned ?? 0)] : []), String(r.points)].join(','),
  );
  const csv = '\uFEFF' + [head.map(q).join(','), ...lines].join('\r\n') + '\r\n';
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), fileName(info, 'csv'));
}

// ---------- PDF (print) ----------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Opens the print dialog on a clean A4 page of the list; the teacher picks "Save as PDF". */
export function exportPdf(info: ExportInfo): Promise<void> {
  const head = headFor(info);
  const cls = (i: number) => (i === 0 ? ' class="c"' : i === 1 ? ' class="m"' : i === head.length - 1 ? ' class="r b"' : i >= 4 ? ' class="r"' : '');
  const body = info.rows.map((r, k) => `<tr>${cellsFor(info, r, k).map((t, i) => `<td${cls(i)}>${esc(t)}</td>`).join('')}</tr>`).join('');
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(fileName(info, 'pdf').replace(/\.pdf$/, ''))}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600&display=swap">
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun', 'TH Sarabun New', Tahoma, sans-serif; color: #111; margin: 0; font-size: 12.5pt; }
  h1 { font-size: 18pt; text-align: center; margin: 0 0 2pt; }
  h2 { font-size: 14pt; text-align: center; margin: 0 0 4pt; font-weight: 600; }
  p { text-align: center; margin: 0 0 3pt; color: #555; font-size: 10.5pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 10pt; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td { border: 0.6pt solid #bbb; padding: 4pt 6pt; text-align: left; vertical-align: top; }
  th { background: #f2e6e6; text-align: center; font-weight: 600; }
  td.c { text-align: center; } td.r { text-align: right; } td.b { font-weight: 600; }
  td.m { font-variant-numeric: tabular-nums; }
  tbody tr:nth-child(even) td { background: #faf7f7; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style></head><body>
<h1>รายชื่อนักศึกษาและคะแนน</h1><h2>${esc(info.title)}</h2>
${info.note ? `<p>${esc(info.note)}</p>` : ''}<p>${esc(summary(info))}</p>
<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${head.length}" class="c">ไม่มีรายชื่อ</td></tr>`}</tbody></table>
</body></html>`;

  return new Promise((done) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    const win = frame.contentWindow!;
    win.document.open();
    win.document.write(html);
    win.document.close();
    const cleanup = () => {
      frame.remove();
      done();
    };
    // wait for the Thai web font (or give up after 3 s and use the fallback font)
    Promise.race([win.document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]).then(() => {
      win.addEventListener('afterprint', () => setTimeout(cleanup, 100), { once: true });
      win.focus();
      win.print();
      // some browsers don't fire afterprint for iframes
      setTimeout(() => frame.isConnected && cleanup(), 60_000);
    });
  });
}
