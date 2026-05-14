/**
 * export.js — Excel download for the Cut Marker Ratio Planner
 *
 * Uses SheetJS (loaded from CDN in index.html).
 * Creates a workbook with 3 sheets:
 *   1. Marker Plan       — one row per marker, ratios + ply + times + pieces
 *   2. Fulfillment       — order vs produced, shortfall, fill rate per size
 *   3. Constraint Checks — ratio sum ≤ max, ply ≤ max, no overproduction
 */

'use strict';

// ─── STYLE HELPERS ────────────────────────────────────────────────────────────

const STYLES = {
  headerFill:  { fgColor: { rgb: '1F3864' } },
  headerFont:  { name: 'Arial', bold: true, color: { rgb: 'FFFFFF' }, sz: 10 },
  sectionFill: { fgColor: { rgb: 'D6E4F0' } },
  sectionFont: { name: 'Arial', bold: true, color: { rgb: '1F3864' }, sz: 10 },
  passFont:    { name: 'Arial', bold: true, color: { rgb: '276221' }, sz: 10 },
  failFont:    { name: 'Arial', bold: true, color: { rgb: '9C0006' }, sz: 10 },
  warnFont:    { name: 'Arial', bold: true, color: { rgb: '9C5700' }, sz: 10 },
  monoFont:    { name: 'Courier New', sz: 10 },
  bodyFont:    { name: 'Arial', sz: 10 },
  boldFont:    { name: 'Arial', bold: true, sz: 10 },
  thinBorder: {
    top:    { style: 'thin', color: { rgb: 'BFBFBF' } },
    bottom: { style: 'thin', color: { rgb: 'BFBFBF' } },
    left:   { style: 'thin', color: { rgb: 'BFBFBF' } },
    right:  { style: 'thin', color: { rgb: 'BFBFBF' } },
  },
};

function cell(value, opts = {}) {
  const c = { v: value, t: typeof value === 'number' ? 'n' : 's' };
  if (opts.bold || opts.header || opts.section)
    c.s = {
      font:      opts.header  ? STYLES.headerFont
               : opts.section ? STYLES.sectionFont
               : STYLES.boldFont,
      fill:      opts.header  ? { patternType: 'solid', ...STYLES.headerFill }
               : opts.section ? { patternType: 'solid', ...STYLES.sectionFill }
               : undefined,
      alignment: { horizontal: opts.left ? 'left' : 'center', vertical: 'center', wrapText: !!opts.wrap },
      border:    STYLES.thinBorder,
    };
  else
    c.s = {
      font:      opts.mono ? STYLES.monoFont : STYLES.bodyFont,
      alignment: { horizontal: opts.right ? 'right' : opts.left ? 'left' : 'center', vertical: 'center' },
      border:    STYLES.thinBorder,
      fill:      opts.bg ? { patternType: 'solid', fgColor: { rgb: opts.bg } } : undefined,
    };
  if (opts.pct) { c.t = 'n'; c.z = '0.00%'; }
  if (opts.numFmt) c.z = opts.numFmt;
  if (opts.passStatus) {
    const font = value === 'PASS' ? STYLES.passFont : STYLES.failFont;
    c.s.font = font;
    c.s.fill = { patternType: 'solid', fgColor: { rgb: value === 'PASS' ? 'C6EFCE' : 'FFC7CE' } };
  }
  if (opts.statusBadge) {
    const map = { 'EXACT': { font: STYLES.passFont, bg: 'C6EFCE' },
                  'SHORT': { font: STYLES.warnFont,  bg: 'FFEB9C' },
                  'OVER':  { font: STYLES.failFont,  bg: 'FFC7CE' } };
    const m = map[value] || {};
    if (m.font) c.s.font = m.font;
    if (m.bg)   c.s.fill = { patternType: 'solid', fgColor: { rgb: m.bg } };
  }
  return c;
}

/** Place an array of cell values into a SheetJS aoa (array-of-arrays) */
function aoa2sheet(aoa) {
  return XLSX.utils.aoa_to_sheet(aoa);
}

/** Set column widths on a worksheet */
function setColWidths(ws, widths) {
  ws['!cols'] = widths.map(w => ({ wch: w }));
}

/** Set row heights */
function setRowHeights(ws, heights) {
  ws['!rows'] = heights.map(h => h ? { hpx: h } : {});
}

// ─── SHEET 1: MARKER PLAN ─────────────────────────────────────────────────────

function buildMarkerSheet(result) {
  const { rows, sizes, order, maxPly, totalRatio, consumption } = result;
  const n   = sizes.length;
  const hasFabric = consumption > 0;
  const aoa = [];

  // Title
  aoa.push([`MARKER PLAN — ${rows.length} row${rows.length !== 1 ? 's' : ''} · Max Ratio ${totalRatio} · Max Ply ${maxPly}`]);
  aoa.push([]);

  // Header row
  const hdr = ['Marker', ...sizes.map(s => `${s} Ratio`), 'Ratio Sum', 'Ply', '× Times',
                ...sizes.map(s => `${s} Pieces`), 'Total Pieces'];
  if (hasFabric) hdr.push('Fabric Required (m)');
  aoa.push(hdr);

  // Data rows
  rows.forEach((row, mi) => {
    const ratioSum    = row.ratioSum !== undefined ? row.ratioSum : row.ratios.reduce((a, b) => a + b, 0);
    const totalPieces = row.produced.reduce((a, b) => a + b, 0);
    const dataRow = [
      `M${row.id}`,
      ...row.ratios,
      ratioSum,
      row.ply,
      `×${row.times}`,
      ...row.produced,
      totalPieces,
    ];
    if (hasFabric) dataRow.push(parseFloat((totalPieces * row.ply * consumption).toFixed(4)));
    aoa.push(dataRow);
  });

  // Totals row
  const totalProduced = new Array(n).fill(0);
  rows.forEach(r => r.produced.forEach((p, i) => { totalProduced[i] += p; }));
  const totalPcsAll = totalProduced.reduce((a, b) => a + b, 0);
  const totRow = [
    'TOTAL',
    ...new Array(n).fill(''),
    '', '', '',
    ...totalProduced,
    totalPcsAll,
  ];
  if (hasFabric) totRow.push(parseFloat((totalPcsAll * consumption).toFixed(4)));
  aoa.push(totRow);

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Format fabric column as number with 2 decimal places
  if (hasFabric) {
    const fabricCol = 1 + n + 3 + n + 1; // 0-indexed
    rows.forEach((_, ri) => {
      const addr = XLSX.utils.encode_cell({ r: 3 + ri, c: fabricCol });
      if (ws[addr]) ws[addr].z = '0.00';
    });
  }

  const widths = [10, ...Array(n).fill(9), 10, 8, 8, ...Array(n).fill(12), 13];
  if (hasFabric) widths.push(18);
  setColWidths(ws, widths);

  return ws;
}

// ─── SHEET 2: FULFILLMENT SUMMARY ─────────────────────────────────────────────

function buildFulfillmentSheet(result) {
  const { rows, sizes, order } = result;
  const n = sizes.length;

  const totalProduced = new Array(n).fill(0);
  rows.forEach(r => r.produced.forEach((p, i) => { totalProduced[i] += p; }));

  const aoa = [];
  aoa.push(['ORDER FULFILLMENT SUMMARY']);
  aoa.push([]);
  aoa.push(['Size', 'Order Qty', 'Produced', 'Shortfall', 'Fill Rate', 'Status']);

  sizes.forEach((sz, i) => {
    const produced  = totalProduced[i];
    const qty       = order[i];
    const shortfall = qty - produced;
    const fillRate  = qty > 0 ? produced / qty : 0;
    const status    = produced > qty ? 'OVER' : produced === qty ? 'EXACT' : 'SHORT';
    aoa.push([sz, qty, produced, shortfall, fillRate, status]);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Format fill rate column (E, index 4) as percentage
  sizes.forEach((_, i) => {
    const addr = XLSX.utils.encode_cell({ r: 3 + i, c: 4 });
    if (ws[addr]) ws[addr].z = '0.00%';
  });

  setColWidths(ws, [10, 12, 12, 12, 12, 10]);
  return ws;
}

// ─── SHEET 3: CONSTRAINT CHECKS ───────────────────────────────────────────────

function buildConstraintSheet(result) {
  const { rows, sizes, order, maxPly, totalRatio } = result;
  const n = sizes.length;

  const totalProduced = new Array(n).fill(0);
  rows.forEach(r => r.produced.forEach((p, i) => { totalProduced[i] += p; }));

  const aoa = [];
  aoa.push(['CONSTRAINT CHECKS']);
  aoa.push([]);
  aoa.push(['Constraint', 'Marker / Size', 'Value', 'Limit', 'Status']);

  rows.forEach(row => {
    const ratioSum = row.ratioSum !== undefined ? row.ratioSum : row.ratios.reduce((a, b) => a + b, 0);
    aoa.push(['Ratio sum ≤ Max Ratio', `M${row.id}`, ratioSum, totalRatio,
              ratioSum <= totalRatio ? 'PASS' : 'FAIL']);
    aoa.push(['Ply ≤ Max Ply', `M${row.id}`, row.ply, maxPly,
              row.ply <= maxPly ? 'PASS' : 'FAIL']);
  });

  sizes.forEach((sz, i) => {
    const over = totalProduced[i] > order[i];
    aoa.push(['No overproduction', sz, totalProduced[i], order[i], over ? 'FAIL' : 'PASS']);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  setColWidths(ws, [24, 14, 10, 10, 10]);
  return ws;
}

// ─── MAIN EXPORT FUNCTION ─────────────────────────────────────────────────────

/**
 * Build and trigger download of the Excel workbook.
 * Called from app.js with the current result object.
 *
 * @param {{ rows, sizes, order, maxPly, totalRatio }} result
 */
function downloadExcel(result) {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, buildMarkerSheet(result),      'Marker Plan');
  XLSX.utils.book_append_sheet(wb, buildFulfillmentSheet(result), 'Fulfillment');
  XLSX.utils.book_append_sheet(wb, buildConstraintSheet(result),  'Constraints');

  const filename = `marker_plan_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// Expose globally
window.downloadExcel = downloadExcel;
