/**
 * solver.js — Cut Marker Ratio Solver  (minimum-marker edition)
 *
 * Public API (unchanged):
 *   solveMarkers(sizes, maxPly, totalRatio) → result object
 *
 * ─── ALGORITHM ────────────────────────────────────────────────────────────────
 *
 * PHASE 1 · Branch-and-bound search (500 ms budget)
 * ──────────────────────────────────────────────────
 * Goal: find the fewest marker ROWS that fill the order without overproduction.
 *
 * A "row" = one (ratios, ply, times) triple where ply ≤ maxPly.
 * Key insight: if a marker type's total_cuts is an exact multiple of maxPly
 * it costs exactly 1 row (ply=maxPly, times=N). Otherwise it costs 2 rows.
 *
 * Search strategy:
 *   For each candidate ratio vector r1 (near proportional allocation ±slack):
 *     For each valid multiple-of-maxPly cut count c1 that r1 can sustain,
 *     sorted by how well it balances remaining quantities (heuristic):
 *       • M1 always costs exactly 1 row
 *       • Run greedy on the remainder → count sub-rows
 *       • Track the plan with the fewest total rows
 *
 * PHASE 2 · Greedy fallback
 * ─────────────────────────
 * Used as the starting upper bound and to finish remainders.
 * Guaranteed correct (no overproduction, all constraints respected).
 */

'use strict';

// ─── SHARED UTILITIES ─────────────────────────────────────────────────────────

/**
 * Proportional integer ratios summing exactly to totalRatio.
 * Uses largest-remainder rounding. Returns null if remaining is all-zero.
 */
function computeRatios(remaining, totalRatio) {
  const n     = remaining.length;
  const total = remaining.reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  const raw    = remaining.map(r => (r / total) * totalRatio);
  const floors = raw.map(Math.floor);
  let deficit  = totalRatio - floors.reduce((a, b) => a + b, 0);

  // give +1 to slots with the largest fractional remainder
  const byFrac = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => (raw[b] - floors[b]) - (raw[a] - floors[a]));
  for (let k = 0; k < deficit; k++) floors[byFrac[k]]++;

  // zero out already-fulfilled sizes
  for (let i = 0; i < n; i++) if (remaining[i] === 0) floors[i] = 0;

  const s = floors.reduce((a, b) => a + b, 0);
  if (s === 0) return null;

  // re-balance if zeroing broke the sum
  if (s !== totalRatio) {
    const d   = totalRatio - s;
    const big = floors.map((v, i) => ({ v, i }))
                      .filter(x => x.v > 0)
                      .sort((a, b) => b.v - a.v)[0];
    if (!big || big.v + d <= 0) return null;
    floors[big.i] += d;
  }

  return floors;
}

/** Maximum cuts a ratio vector can make without overproducing any size. */
function maxCuts(ratios, remaining) {
  let min = Infinity;
  for (let i = 0; i < ratios.length; i++) {
    if (ratios[i] > 0) min = Math.min(min, Math.floor(remaining[i] / ratios[i]));
  }
  return isFinite(min) ? min : 0;
}

/**
 * Split total cuts into {ply, times} entries, each respecting maxPly.
 *   cuts=1206, maxPly=100  →  [{ply:100,times:12}, {ply:6,times:1}]
 */
function splitIntoRows(cuts, maxPly) {
  if (cuts <= 0) return [];
  const ply   = Math.min(cuts, maxPly);
  const times = Math.floor(cuts / ply);
  const left  = cuts % ply;
  const rows  = [];
  if (times > 0) rows.push({ ply, times });
  if (left  > 0) rows.push({ ply: left, times: 1 });
  return rows;
}

// ─── GREEDY SOLVER ────────────────────────────────────────────────────────────

/**
 * Classic greedy: always take max cuts at each step.
 * Returns flat array of row entries with running totals.
 *
 * @param {number[]} order       - quantities to fill (may be remainder)
 * @param {number}   maxPly
 * @param {number}   totalRatio
 * @param {number}   [startId=1]           - starting row id
 * @param {number[]} [startRunning=null]   - running totals carried in from prior rows
 */
function greedySolve(order, maxPly, totalRatio, startId = 1, startRunning = null) {
  const n         = order.length;
  const remaining = [...order];
  const running   = startRunning ? [...startRunning] : new Array(n).fill(0);
  const entries   = [];
  let   id        = startId - 1;
  let   guard     = 0;

  while (remaining.some(r => r > 0) && guard++ < 600) {
    const ratios = computeRatios(remaining, totalRatio);
    if (!ratios) break;
    const cuts = maxCuts(ratios, remaining);
    if (cuts <= 0) break;

    for (const { ply, times } of splitIntoRows(cuts, maxPly)) {
      const produced = ratios.map(r => r * ply * times);
      for (let i = 0; i < n; i++) {
        remaining[i] -= produced[i];
        running[i]   += produced[i];
      }
      entries.push({
        id:       ++id,
        ratios:   [...ratios],
        ply,
        times,
        produced: [...produced],
        running:  [...running],
      });
    }
  }

  return entries;
}

// ─── CANDIDATE RATIO GENERATOR ────────────────────────────────────────────────

/**
 * Enumerate ratio vectors summing to totalRatio within ±slack of the
 * proportional allocation for `remaining`.  Yields number[] arrays.
 */
function* genCandidates(remaining, totalRatio, slack) {
  const n     = remaining.length;
  const total = remaining.reduce((a, b) => a + b, 0);
  if (total === 0) return;

  const base   = remaining.map(r => Math.floor((r / total) * totalRatio));
  const ranges = base.map(b => [
    Math.max(0, b - slack),
    Math.min(totalRatio, b + slack),
  ]);

  function* recurse(dim, partial, usedSum) {
    if (dim === n - 1) {
      const last = totalRatio - usedSum;
      if (last >= ranges[dim][0] && last <= ranges[dim][1]) {
        yield [...partial, last];
      }
      return;
    }
    for (let v = ranges[dim][0]; v <= ranges[dim][1]; v++) {
      if (usedSum + v > totalRatio) break;
      partial.push(v);
      yield* recurse(dim + 1, partial, usedSum + v);
      partial.pop();
    }
  }

  yield* recurse(0, [], 0);
}

// ─── BRANCH-AND-BOUND OPTIMIZER ───────────────────────────────────────────────

/**
 * Search for a plan with fewer rows than pure greedy.
 *
 * For each candidate first-marker ratio r1, we collect ALL valid
 * multiples-of-maxPly cut counts (so M1 = exactly 1 row), sort them by
 * a balance heuristic (prefer the mult that makes remaining quantities
 * most proportional), then run greedy on each remainder.
 *
 * @param {number[]} order
 * @param {number}   maxPly
 * @param {number}   totalRatio
 * @param {number}   timeLimitMs
 */
function optimizedSolve(order, maxPly, totalRatio, timeLimitMs = 500) {
  const n        = order.length;
  const deadline = Date.now() + timeLimitMs;

  // ── greedy baseline ────────────────────────────────────────────────────────
  let bestEntries = greedySolve(order, maxPly, totalRatio);
  let bestRows    = bestEntries.length;

  if (bestRows <= 1) return bestEntries;  // already optimal

  // ── search ────────────────────────────────────────────────────────────────
  // Adaptive slack: fewer candidates for more sizes → stays within time budget
  const slack = n <= 3 ? 5 : n <= 5 ? 4 : 3;

  for (const r1 of genCandidates(order, totalRatio, slack)) {
    if (Date.now() > deadline) break;
    if (bestRows <= 2)          break;  // can't improve further

    const maxC1   = maxCuts(r1, order);
    const maxMult = Math.floor(maxC1 / maxPly);
    if (maxMult < 1) continue;

    // Collect all valid multiples (all produce no overproduction)
    const validMults = [];
    for (let mult = 1; mult <= maxMult; mult++) {
      const rem = order.map((o, i) => o - r1[i] * mult * maxPly);
      if (!rem.some(r => r < 0)) validMults.push(mult);
    }
    if (validMults.length === 0) continue;

    // Sort: prefer the mult whose remainder is most proportional to original
    // order (i.e. smallest max relative-remaining → greedy finishes fastest)
    const orderTotal = order.reduce((a, b) => a + b, 0);
    const orderFrac  = order.map(o => o / orderTotal);
    validMults.sort((a, b) => {
      const remA = order.map((o, i) => o - r1[i] * a * maxPly);
      const remB = order.map((o, i) => o - r1[i] * b * maxPly);
      const totA = remA.reduce((s, v) => s + v, 0) || 1;
      const totB = remB.reduce((s, v) => s + v, 0) || 1;
      // score = max deviation from target fractions (lower = better)
      const scoreA = Math.max(...remA.map((v, i) => Math.abs(v / totA - orderFrac[i])));
      const scoreB = Math.max(...remB.map((v, i) => Math.abs(v / totB - orderFrac[i])));
      return scoreA - scoreB;
    });

    for (const mult of validMults) {
      if (Date.now() > deadline) break;

      const c1   = mult * maxPly;
      const rem1 = order.map((o, i) => o - r1[i] * c1);

      // M1 costs exactly 1 row; run greedy on remainder
      const subRows   = greedySolve(rem1, maxPly, totalRatio).length;
      const totalRows = 1 + subRows;

      if (totalRows < bestRows) {
        bestRows = totalRows;

        // Reconstruct full entry list with correct running totals
        const running1 = new Array(n).fill(0);
        const prod1    = r1.map(r => r * c1);
        for (let i = 0; i < n; i++) running1[i] += prod1[i];

        const m1 = {
          id:       1,
          ratios:   [...r1],
          ply:      maxPly,
          times:    mult,
          produced: [...prod1],
          running:  [...running1],
        };

        const subEntries = greedySolve(rem1, maxPly, totalRatio, 2, running1);
        bestEntries = [m1, ...subEntries];
      }

      if (bestRows <= 2) break;
    }
  }

  // Re-number ids sequentially 1..N
  bestEntries.forEach((e, i) => { e.id = i + 1; });
  return bestEntries;
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Solve for the minimum number of marker rows to fulfill the order.
 * Drop-in replacement — identical input/output contract to the old greedy solver.
 *
 * @param {{ name: string, qty: number }[]} sizes
 * @param {number} maxPly
 * @param {number} totalRatio
 * @returns {{ rows, sizes, order, maxPly, totalRatio }}
 */
function solveMarkers(sizes, maxPly, totalRatio) {
  const sizeNames = sizes.map(s => s.name);
  const order     = sizes.map(s => s.qty);
  const entries   = optimizedSolve(order, maxPly, totalRatio, 500);
  return { rows: entries, sizes: sizeNames, order, maxPly, totalRatio };
}

// Expose globally for app.js (contract unchanged)
window.solveMarkers = solveMarkers;
