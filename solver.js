/**
 * solver.js — Cut Marker Ratio Solver
 *
 * Exports one function:
 *   solveMarkers(order, maxPly, totalRatio) → MarkerRow[]
 *
 * Algorithm:
 *   Greedy proportional allocation — at each step ratios are computed
 *   proportional to remaining quantities (largest-remainder rounding),
 *   ply is maximised without overproducing any size, repeated ×N times
 *   in a single row. Produces minimum marker rows.
 */

'use strict';

/**
 * Compute integer ratios summing to totalRatio,
 * proportional to the remaining[] array.
 * Returns null if nothing remains.
 *
 * @param {number[]} remaining
 * @param {number}   totalRatio
 * @returns {number[]|null}
 */
function computeRatios(remaining, totalRatio) {
  const n     = remaining.length;
  const total = remaining.reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  // proportional allocation
  const raw    = remaining.map(r => (r / total) * totalRatio);
  const floors = raw.map(r => Math.floor(r));
  let deficit  = totalRatio - floors.reduce((a, b) => a + b, 0);

  // largest-remainder: give +1 to items with biggest fractional part
  const order = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => (raw[b] - floors[b]) - (raw[a] - floors[a]));
  for (let k = 0; k < deficit; k++) floors[order[k]]++;

  // zero out finished sizes
  for (let i = 0; i < n; i++) {
    if (remaining[i] === 0) floors[i] = 0;
  }

  const s = floors.reduce((a, b) => a + b, 0);
  if (s === 0) return null;

  // fix any leftover deficit caused by zeroing
  if (s !== totalRatio) {
    const d2  = totalRatio - s;
    const idx = floors
      .map((v, i) => ({ v, i }))
      .filter(x => x.v > 0)
      .sort((a, b) => b.v - a.v)[0].i;
    floors[idx] += d2;
    if (floors[idx] <= 0) return null;
  }

  return floors;
}

/**
 * Given ratios and remaining, compute max cuts without overproduction.
 *
 * @param {number[]} ratios
 * @param {number[]} remaining
 * @returns {number}
 */
function maxCuts(ratios, remaining) {
  let min = Infinity;
  for (let i = 0; i < ratios.length; i++) {
    if (ratios[i] > 0) {
      min = Math.min(min, Math.floor(remaining[i] / ratios[i]));
    }
  }
  return isFinite(min) ? min : 0;
}

/**
 * Split total cuts into marker rows respecting maxPly.
 * Returns array of { ply, times } objects.
 *
 * @param {number} cuts
 * @param {number} maxPly
 * @returns {{ ply: number, times: number }[]}
 */
function splitIntoRows(cuts, maxPly) {
  if (cuts <= 0) return [];
  const rows = [];
  const ply   = Math.min(cuts, maxPly);
  const times = Math.floor(cuts / ply);
  const left  = cuts % ply;
  if (times > 0) rows.push({ ply, times });
  if (left  > 0) rows.push({ ply: left, times: 1 });
  return rows;
}

/**
 * Main solver.
 *
 * @param {{ name: string, qty: number }[]} sizes   - array of size objects
 * @param {number}                          maxPly
 * @param {number}                          totalRatio
 * @returns {{
 *   rows: {
 *     id:       number,
 *     ratios:   number[],
 *     ply:      number,
 *     times:    number,
 *     produced: number[],
 *     running:  number[],
 *   }[],
 *   sizes:       string[],
 *   order:       number[],
 *   maxPly:      number,
 *   totalRatio:  number,
 * }}
 */
function solveMarkers(sizes, maxPly, totalRatio) {
  const n         = sizes.length;
  const sizeNames = sizes.map(s => s.name);
  const order     = sizes.map(s => s.qty);
  const remaining = [...order];
  const running   = new Array(n).fill(0);
  const rows      = [];
  let   rowId     = 0;
  let   guard     = 0;

  while (remaining.some(r => r > 0) && guard++ < 500) {
    const ratios = computeRatios(remaining, totalRatio);
    if (!ratios) break;

    const cuts = maxCuts(ratios, remaining);
    if (cuts <= 0) break;

    const splitRows = splitIntoRows(cuts, maxPly);

    for (const { ply, times } of splitRows) {
      const produced = ratios.map(r => r * ply * times);
      for (let i = 0; i < n; i++) {
        remaining[i] -= produced[i];
        running[i]   += produced[i];
      }
      rows.push({
        id:       ++rowId,
        ratios:   [...ratios],
        ply,
        times,
        produced: [...produced],
        running:  [...running],
      });
    }
  }

  return { rows, sizes: sizeNames, order, maxPly, totalRatio };
}

// Expose globally for app.js
window.solveMarkers = solveMarkers;
