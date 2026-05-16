/**
 * app.js — UI controller for the Cut Marker Ratio Planner
 *
 * Changes vs original:
 *  • No default sizes — starts with empty rows
 *  • Solver runs in a Web Worker so the UI stays responsive during long solves
 *  • Shows a "Solving…" spinner with elapsed-time counter while working
 *  • Fabric Required = total pieces × consumption  (not × ply × consumption)
 */

'use strict';

// ─── STATE ────────────────────────────────────────────────────────────────────
let sizeRows = [];
let nextId   = 1;
let lastResult   = null;
let solverWorker = null;   // active Web Worker (if any)
let spinnerTimer = null;   // setInterval for elapsed display

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
const spinnerOverlay   = document.getElementById('spinnerOverlay');
const spinnerTime      = document.getElementById('spinnerTime');

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmt   = n  => Number.isFinite(n) ? n.toLocaleString() : '—';
const pct   = (a, b) => b === 0 ? 0 : Math.round((a / b) * 10000) / 100;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
        <input type="number" class="size-qty" placeholder="e.g. 500"
               value="${row.qty || ''}" min="1" step="1" />
      </td>
      <td>
        <button class="btn-remove" title="Remove size" data-remove="${row.id}">×</button>
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
  const inputs = sizeBody.querySelectorAll('.size-name');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

addSizeBtn.addEventListener('click', () => addSize());

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

  if (new Set(validSizes.map(r => r.name)).size < validSizes.length)
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

// ─── SPINNER ─────────────────────────────────────────────────────────────────
function showSpinner() {
  if (spinnerOverlay) spinnerOverlay.style.display = 'flex';
  solveBtn.disabled = true;
  solveBtn.style.opacity = '0.5';
  const start = Date.now();
  spinnerTimer = setInterval(() => {
    const s = ((Date.now() - start) / 1000).toFixed(1);
    if (spinnerTime) spinnerTime.textContent = `${s}s`;
  }, 100);
}

function hideSpinner() {
  if (spinnerOverlay) spinnerOverlay.style.display = 'none';
  solveBtn.disabled = false;
  solveBtn.style.opacity = '';
  clearInterval(spinnerTimer);
  spinnerTimer = null;
}

// ─── SOLVE ────────────────────────────────────────────────────────────────────
solveBtn.addEventListener('click', () => {
  solveNote.textContent = '';
  const { errors, validSizes, totalRatio, maxPly } = validate();

  if (errors.length) {
    solveNote.textContent = errors[0];
    return;
  }

  const consumption = parseFloat(consumptionInput.value) || 0;

  // Abort any in-progress solve
  if (solverWorker) {
    solverWorker.terminate();
    solverWorker = null;
    hideSpinner();
  }

  showSpinner();

  // Try to run in a Web Worker (avoids UI freeze on long solves)
  // Worker is the same solver.js file — it detects the Worker context via
  // the absence of `window` and registers a message handler.
  try {
    const workerBlob = new Blob(
      [document.getElementById('solverScript').textContent],
      { type: 'application/javascript' }
    );
    const workerUrl = URL.createObjectURL(workerBlob);
    solverWorker = new Worker(workerUrl);
    URL.revokeObjectURL(workerUrl);

    solverWorker.onmessage = function(e) {
      hideSpinner();
      solverWorker = null;
      if (e.data.ok) {
        lastResult = e.data.result;
        renderResults(lastResult);
        resultsSection.style.display = 'flex';
        setTimeout(() => resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      } else {
        solveNote.textContent = 'Solver error: ' + e.data.error;
      }
    };

    solverWorker.onerror = function(err) {
      hideSpinner();
      solverWorker = null;
      // Fallback to main thread
      runSolveMainThread(validSizes, maxPly, totalRatio, consumption);
    };

    solverWorker.postMessage({ sizes: validSizes, maxPly, totalRatio, consumption });

  } catch (e) {
    // Web Workers not available — run on main thread
    runSolveMainThread(validSizes, maxPly, totalRatio, consumption);
  }
});

function runSolveMainThread(validSizes, maxPly, totalRatio, consumption) {
  // Small delay to allow spinner to render before blocking
  setTimeout(() => {
    try {
      const result = solveMarkers(validSizes, maxPly, totalRatio, consumption);
      hideSpinner();
      lastResult = result;
      renderResults(result);
      resultsSection.style.display = 'flex';
      setTimeout(() => resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (err) {
      hideSpinner();
      solveNote.textContent = 'Solver error: ' + err.message;
    }
  }, 50);
}

// ─── RESET ────────────────────────────────────────────────────────────────────
resetBtn.addEventListener('click', () => {
  if (solverWorker) { solverWorker.terminate(); solverWorker = null; hideSpinner(); }
  resultsSection.style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ─── DOWNLOAD ─────────────────────────────────────────────────────────────────
downloadBtn.addEventListener('click', () => {
  if (!lastResult) return;
  if (typeof downloadExcel === 'function') downloadExcel(lastResult);
});

// ─── RENDER RESULTS ───────────────────────────────────────────────────────────
function renderResults(result) {
  const { rows, sizes, order, maxPly, totalRatio, consumption } = result;
  const n = sizes.length;

  const totalProduced = new Array(n).fill(0);
  rows.forEach(row => row.produced.forEach((p, i) => { totalProduced[i] += p; }));

  const allExact  = totalProduced.every((p, i) => p === order[i]);
  const totalRuns = rows.reduce((a, r) => a + r.times, 0);

  resultsMeta.innerHTML = `
    <div class="meta-item"><span class="meta-dot"></span><span>${rows.length} marker row${rows.length !== 1 ? 's' : ''}</span></div>
    <div class="meta-item"><span class="meta-dot"></span><span>${totalRuns} total cutting run${totalRuns !== 1 ? 's' : ''}</span></div>
    <div class="meta-item"><span class="meta-dot ${allExact ? 'green' : ''}"></span><span>${allExact ? '100% fill' : 'Partial fill'}</span></div>
    <div class="meta-item"><span class="meta-dot"></span><span>Max Ratio ${totalRatio} · Max Ply ${maxPly}</span></div>`;

  markerPlanSub.textContent =
    `${rows.length} row${rows.length !== 1 ? 's' : ''} · ratio sum ≤ ${totalRatio} · ply ≤ ${maxPly}`;

  // ── Marker Plan table ────────────────────────────────────────────────────
  markerTableHead.innerHTML = '';
  const headRow = document.createElement('tr');
  const addTh = (tr, text) => {
    const th = document.createElement('th');
    th.innerHTML = text;
    tr.appendChild(th);
  };

  addTh(headRow, 'Marker');
  sizes.forEach(sz => addTh(headRow, `${sz}<br><span style="font-weight:300;color:#aaa;font-size:10px">ratio</span>`));
  addTh(headRow, 'Ratio ∑');
  addTh(headRow, 'Ply');
  addTh(headRow, '× Times');
  sizes.forEach(sz => addTh(headRow, `${sz}<br><span style="font-weight:300;color:#aaa;font-size:10px">pieces</span>`));
  addTh(headRow, 'Total Pcs');
  addTh(headRow, 'Fabric Required<br><span style="font-weight:300;color:#aaa;font-size:10px">metres</span>');
  markerTableHead.appendChild(headRow);

  markerTableBody.innerHTML = '';

  rows.forEach((row, mi) => {
    const tr          = document.createElement('tr');
    tr.style.background = mi % 2 === 0 ? '#fff' : '#fafafa';

    const ratioSum    = row.ratios.reduce((a, b) => a + b, 0);
    const ratioOk     = ratioSum <= totalRatio;
    const plyOk       = row.ply   <= maxPly;
    const totalPieces = row.produced.reduce((a, b) => a + b, 0);

    // Fabric required = total pieces produced by this row × consumption per garment
    // (row.produced already accounts for ply and times)
    const fabricM = consumption > 0
      ? (totalPieces * consumption).toFixed(2)
      : null;

    let html = `<td><span class="marker-id">M${row.id}</span></td>`;
    row.ratios.forEach(r => {
      html += `<td class="ratio-cell ${r === 0 ? 'ratio-zero' : ''}">${r}</td>`;
    });
    html += `<td style="font-family:var(--font-mono);font-size:12px;">
      <span class="badge ${ratioOk ? 'badge-pass' : 'badge-fail'}">${ratioSum}</span></td>`;
    html += `<td style="font-family:var(--font-mono);">
      <span class="badge ${plyOk ? 'badge-pass' : 'badge-fail'}">${row.ply}</span></td>`;
    html += `<td style="font-family:var(--font-mono);font-weight:500;">×${row.times}</td>`;
    row.produced.forEach(p => {
      html += `<td style="font-family:var(--font-mono);font-size:12px;">${fmt(p)}</td>`;
    });
    html += `<td style="font-family:var(--font-mono);font-size:12px;font-weight:600;">${fmt(totalPieces)}</td>`;
    html += `<td style="font-family:var(--font-mono);font-size:12px;">${fabricM !== null ? fabricM + ' m' : '—'}</td>`;

    tr.innerHTML = html;
    markerTableBody.appendChild(tr);
  });

  // Total row
  const totalTr = document.createElement('tr');
  totalTr.className = 'total-row';
  const totalPcsAll   = totalProduced.reduce((a, b) => a + b, 0);
  const totalFabricM  = consumption > 0 ? (totalPcsAll * consumption).toFixed(2) + ' m' : '—';
  let totalHtml = `<td colspan="${1 + n + 3}">Total Produced</td>`;
  totalProduced.forEach(p => { totalHtml += `<td>${fmt(p)}</td>`; });
  totalHtml += `<td>${fmt(totalPcsAll)}</td>`;
  totalHtml += `<td>${totalFabricM}</td>`;
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
    addCheck('Ply ≤ Max Ply',         `M${row.id}`, row.ply,  maxPly,     row.ply <= maxPly);
  });
  sizes.forEach((sz, i) => {
    const over = totalProduced[i] > order[i];
    addCheck('No overproduction', sz, fmt(totalProduced[i]), fmt(order[i]), !over);
  });
}
