/**
 * app.js — UI controller for the Cut Marker Ratio Planner
 * Handles: dynamic size rows, derived ratio calc, solve trigger, results render
 */

'use strict';

// ─── STATE ────────────────────────────────────────────────────────────────────
let sizeRows = [];      // [{ id, name, qty }]
let nextId   = 1;

// ─── DOM REFS ─────────────────────────────────────────────────────────────────
const sizeBody         = document.getElementById('sizeBody');
const addSizeBtn       = document.getElementById('addSizeBtn');
const tableLengthInput = document.getElementById('tableLength');
const consumptionInput = document.getElementById('consumption');
const totalRatioDisp   = document.getElementById('totalRatioDisplay');
const maxPlyInput      = document.getElementById('maxPly');
const solveBtn         = document.getElementById('solveBtn');
const solveNote        = document.getElementById('solveNote');
const resultsSection   = document.getElementById('resultsSection');
const resultsMeta      = document.getElementById('resultsMeta');
const markerPlanSub    = document.getElementById('markerPlanSub');
const markerTableHead  = document.getElementById('markerTableHead');
const markerTableBody  = document.getElementById('markerTableBody');
const fulfillBody      = document.getElementById('fulfillBody');
const checkBody        = document.getElementById('checkBody');
const resetBtn         = document.getElementById('resetBtn');
const downloadBtn      = document.getElementById('downloadBtn');

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmt  = n => Number.isFinite(n) ? n.toLocaleString() : '—';
const pct  = (a, b) => b === 0 ? 0 : Math.round((a / b) * 10000) / 100;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function getTotalRatio() {
  const tl = parseFloat(tableLengthInput.value);
  const co = parseFloat(consumptionInput.value);
  if (!tl || !co || co === 0) return null;
  return Math.floor(tl / co);
}

// ─── SIZE ROWS ────────────────────────────────────────────────────────────────
function renderSizeRows() {
  sizeBody.innerHTML = '';
  sizeRows.forEach(row => {
    const tr = document.createElement('tr');
    tr.dataset.id = row.id;
    tr.innerHTML = `
      <td>
        <input type="text" class="size-name" placeholder="e.g. S"
               value="${escHtml(row.name)}" maxlength="10" />
      </td>
      <td>
        <input type="number" class="size-qty" placeholder="e.g. 5000"
               value="${row.qty || ''}" min="1" step="1" />
      </td>
      <td>
        <button class="btn-remove" title="Remove size" data-remove="${row.id}">
          ×
        </button>
      </td>`;
    sizeBody.appendChild(tr);

    tr.querySelector('.size-name').addEventListener('input', e => {
      const r = sizeRows.find(x => x.id === row.id);
      if (r) r.name = e.target.value.trim();
    });
    tr.querySelector('.size-qty').addEventListener('input', e => {
      const r = sizeRows.find(x => x.id === row.id);
      if (r) r.qty = parseInt(e.target.value, 10) || 0;
    });
    tr.querySelector('.btn-remove').addEventListener('click', () => {
      sizeRows = sizeRows.filter(x => x.id !== row.id);
      renderSizeRows();
    });
  });
}

function addSize(name = '', qty = '') {
  sizeRows.push({ id: nextId++, name, qty: parseInt(qty, 10) || 0 });
  renderSizeRows();
  // focus last name input
  const inputs = sizeBody.querySelectorAll('.size-name');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

addSizeBtn.addEventListener('click', () => addSize());

// Seed with default sizes
const DEFAULTS = [
  ['S', 10858], ['M', 13992], ['L', 13090], ['XL', 7701], ['XXL', 5719]
];
DEFAULTS.forEach(([n, q]) => addSize(n, q));

// ─── TOTAL RATIO (live) ───────────────────────────────────────────────────────
function updateTotalRatioDisplay() {
  const tr = getTotalRatio();
  if (tr === null || tr <= 0) {
    totalRatioDisp.textContent = '—';
    totalRatioDisp.style.color = '#ccc';
  } else {
    totalRatioDisp.textContent = tr;
    totalRatioDisp.style.color = '';
  }
}

tableLengthInput.addEventListener('input', updateTotalRatioDisplay);
consumptionInput.addEventListener('input', updateTotalRatioDisplay);
updateTotalRatioDisplay();

// ─── VALIDATION ───────────────────────────────────────────────────────────────
function validate() {
  const errors = [];

  const validSizes = sizeRows.filter(r => r.name && r.qty > 0);
  if (validSizes.length === 0)
    errors.push('Add at least one size with a name and order quantity.');

  const hasDuplicates = new Set(validSizes.map(r => r.name)).size < validSizes.length;
  if (hasDuplicates)
    errors.push('Size names must be unique.');

  const totalRatio = getTotalRatio();
  if (!totalRatio || totalRatio <= 0)
    errors.push('Enter valid Table Length and Consumption to compute Total Ratio.');

  const maxPly = parseInt(maxPlyInput.value, 10);
  if (!maxPly || maxPly < 1)
    errors.push('Enter a valid Max Ply Quantity (≥ 1).');

  if (totalRatio && validSizes.length > 0 && totalRatio < validSizes.length)
    errors.push(`Total Ratio (${totalRatio}) is less than the number of sizes (${validSizes.length}). Each size needs at least ratio 1.`);

  return { errors, validSizes, totalRatio, maxPly };
}

// ─── SOLVE ───────────────────────────────────────────────────────────────────
solveBtn.addEventListener('click', () => {
  solveNote.textContent = '';
  const { errors, validSizes, totalRatio, maxPly } = validate();

  if (errors.length) {
    solveNote.textContent = errors[0];
    return;
  }

  const consumption = parseFloat(consumptionInput.value) || 0;
  const result = solveMarkers(validSizes, maxPly, totalRatio, consumption);
  lastResult = result;
  renderResults(result);

  resultsSection.style.display = 'flex';
  setTimeout(() => {
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
});

// ─── RESET ───────────────────────────────────────────────────────────────────
resetBtn.addEventListener('click', () => {
  resultsSection.style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ─── DOWNLOAD ────────────────────────────────────────────────────────────────
let lastResult = null;

downloadBtn.addEventListener('click', () => {
  if (!lastResult) return;
  if (typeof downloadExcel === 'function') {
    downloadExcel(lastResult);
  }
});

// ─── RENDER RESULTS ───────────────────────────────────────────────────────────
function renderResults(result) {
  const { rows, sizes, order, maxPly, totalRatio, consumption } = result;
  const n = sizes.length;

  // total produced
  const totalProduced = new Array(n).fill(0);
  rows.forEach(row => row.produced.forEach((p, i) => totalProduced[i] += p));

  // meta
  const allExact = totalProduced.every((p, i) => p === order[i]);
  const totalRuns = rows.reduce((a, r) => a + r.times, 0);
  resultsMeta.innerHTML = `
    <div class="meta-item">
      <span class="meta-dot"></span>
      <span>${rows.length} marker row${rows.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="meta-item">
      <span class="meta-dot"></span>
      <span>${totalRuns} total cutting run${totalRuns !== 1 ? 's' : ''}</span>
    </div>
    <div class="meta-item">
      <span class="meta-dot ${allExact ? 'green' : ''}"></span>
      <span>${allExact ? '100% fill' : 'Partial fill'}</span>
    </div>
    <div class="meta-item">
      <span class="meta-dot"></span>
      <span>Max Ratio ${totalRatio} · Max Ply ${maxPly}</span>
    </div>`;

  markerPlanSub.textContent =
    `${rows.length} row${rows.length !== 1 ? 's' : ''} · ratio sum ≤ ${totalRatio} · ply ≤ ${maxPly}`;

  // ── Marker Plan table ────────────────────────────────────────────────────
  // Build dynamic columns: marker | sizes ratios... | ratio∑ | ply | ×times | pcs per size... | total pcs
  const headRow1 = document.createElement('tr');
  const headRow2 = document.createElement('tr');

  const addTh = (tr, text, sub = '') => {
    const th = document.createElement('th');
    th.innerHTML = text + (sub ? `<br><span style="font-weight:300;color:#bbb;font-size:10px;letter-spacing:0">${sub}</span>` : '');
    tr.appendChild(th);
    return th;
  };

  addTh(headRow1, 'Marker');
  sizes.forEach(sz => addTh(headRow1, `${sz}<br><span style="font-weight:300;color:#aaa;font-size:10px">ratio</span>`));
  addTh(headRow1, 'Ratio ∑');
  addTh(headRow1, 'Ply');
  addTh(headRow1, '× Times');
  sizes.forEach(sz => addTh(headRow1, `${sz}<br><span style="font-weight:300;color:#aaa;font-size:10px">pieces</span>`));
  addTh(headRow1, 'Total Pcs');
  addTh(headRow1, 'Fabric Required<br><span style="font-weight:300;color:#aaa;font-size:10px">metres</span>');

  markerTableHead.innerHTML = '';
  markerTableHead.appendChild(headRow1);

  markerTableBody.innerHTML = '';

  rows.forEach((row, mi) => {
    const tr = document.createElement('tr');
    tr.style.background = mi % 2 === 0 ? '#fff' : '#fafafa';

    const ratioSum    = row.ratios.reduce((a, b) => a + b, 0);
    const ratioOk     = ratioSum <= totalRatio;
    const plyOk       = row.ply  <= maxPly;
    const totalPieces = row.produced.reduce((a, b) => a + b, 0);

    let html = `<td><span class="marker-id">M${row.id}</span></td>`;

    // ratios
    row.ratios.forEach(r => {
      html += `<td class="ratio-cell ${r === 0 ? 'ratio-zero' : ''}">${r}</td>`;
    });

    // ratio sum
    html += `<td style="font-family:var(--font-mono);font-size:12px;">
      <span class="badge ${ratioOk ? 'badge-pass' : 'badge-fail'}">${ratioSum}</span>
    </td>`;

    // ply
    html += `<td style="font-family:var(--font-mono);">
      <span class="badge ${plyOk ? 'badge-pass' : 'badge-fail'}">${row.ply}</span>
    </td>`;

    // times
    html += `<td style="font-family:var(--font-mono);font-weight:500;">×${row.times}</td>`;

    // pieces per size
    row.produced.forEach(p => {
      html += `<td style="font-family:var(--font-mono);font-size:12px;">${fmt(p)}</td>`;
    });

    // total pieces
    html += `<td style="font-family:var(--font-mono);font-size:12px;font-weight:600;">${fmt(totalPieces)}</td>`;

    // fabric required = totalPieces × consumption
    const fabricM  = consumption > 0 ? (totalPieces * consumption).toFixed(2) : null;
    html += `<td style="font-family:var(--font-mono);font-size:12px;">${fabricM !== null ? fabricM + ' m' : '—'}</td>`;

    tr.innerHTML = html;
    markerTableBody.appendChild(tr);
  });

  // total row
  const totalTr = document.createElement('tr');
  totalTr.className = 'total-row';
  let totalHtml = `<td colspan="${1 + n + 3}">Total Produced</td>`;
  totalProduced.forEach(p => { totalHtml += `<td>${fmt(p)}</td>`; });
  totalHtml += `<td>${fmt(totalProduced.reduce((a, b) => a + b, 0))}</td>`;
  // fabric required total
  const totalPcsAll = totalProduced.reduce((a,b)=>a+b,0);
  const totalFabric = consumption > 0 ? (totalPcsAll * consumption).toFixed(2) + ' m' : '—';
  totalHtml += `<td>${totalFabric}</td>`;
  totalTr.innerHTML = totalHtml;
  markerTableBody.appendChild(totalTr);

  // ── Fulfillment Summary ──────────────────────────────────────────────────
  fulfillBody.innerHTML = '';
  sizes.forEach((sz, i) => {
    const produced  = totalProduced[i];
    const qty       = order[i];
    const shortfall = qty - produced;
    const fillPct   = pct(produced, qty);
    const over      = produced > qty;
    const exact     = produced === qty;
    const barClass  = over ? 'over' : fillPct < 90 ? 'warn' : '';
    const barW      = clamp(fillPct, 0, 100);
    const status    = over ? 'OVER' : exact ? 'EXACT' : 'SHORT';
    const badgeCls  = over ? 'badge-over' : exact ? 'badge-exact' : 'badge-short';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${sz}</td>
      <td style="font-family:var(--font-mono)">${fmt(qty)}</td>
      <td style="font-family:var(--font-mono)">${fmt(produced)}</td>
      <td style="font-family:var(--font-mono);color:${over ? 'var(--red-fg)' : shortfall === 0 ? 'var(--green-fg)' : 'var(--amber-fg)'}">
        ${over ? '+' + fmt(produced - qty) : shortfall === 0 ? '—' : fmt(shortfall)}
      </td>
      <td>
        <div class="fill-bar-wrap">
          <div class="fill-bar-track">
            <div class="fill-bar-fill ${barClass}" style="width:${barW}%"></div>
          </div>
          <span class="fill-pct">${fillPct.toFixed(1)}%</span>
        </div>
      </td>
      <td><span class="badge ${badgeCls}">${status}</span></td>`;
    fulfillBody.appendChild(tr);
  });

  // ── Constraint Checks ────────────────────────────────────────────────────
  checkBody.innerHTML = '';

  const addCheck = (constraint, marker, value, limit, pass) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${constraint}</td>
      <td>${marker}</td>
      <td style="font-family:var(--font-mono)">${value}</td>
      <td style="font-family:var(--font-mono)">${limit}</td>
      <td><span class="badge ${pass ? 'badge-pass' : 'badge-fail'}">${pass ? 'PASS' : 'FAIL'}</span></td>`;
    checkBody.appendChild(tr);
  };

  rows.forEach(row => {
    const ratioSum = row.ratioSum !== undefined ? row.ratioSum : row.ratios.reduce((a, b) => a + b, 0);
    addCheck('Ratio sum ≤ Max Ratio', `M${row.id}`, ratioSum, totalRatio, ratioSum <= totalRatio);
    addCheck('Ply ≤ Max Ply',           `M${row.id}`, row.ply,  maxPly,     row.ply <= maxPly);
  });

  sizes.forEach((sz, i) => {
    const over = totalProduced[i] > order[i];
    addCheck('No overproduction', sz, fmt(totalProduced[i]), fmt(order[i]), !over);
  });
}

// ─── UTILITY ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
