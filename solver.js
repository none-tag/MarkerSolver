/**
 * solver.js — Cut Marker Ratio Solver  (GCD exact-coverage + ply-efficiency edition)
 *
 * Public API (unchanged):
 *   solveMarkers(sizes, maxPly, totalRatio) → result object
 *
 * ─── WHAT CHANGED ─────────────────────────────────────────────────────────────
 *
 * Previous approach: search only markers where ply = k × maxPly (exact multiples).
 * This missed solutions like ply=81 or ply=15 which are the most economical split.
 *
 * New approach — three phases, tried in order:
 *
 * PHASE 1 · GCD exact 1-row check
 *   Try every ratio sum s1 from totalRatio down to 1. For each proportional
 *   ratio vector r1, try every ply p1 in [1..maxPly]. If r1*p1 = order exactly
 *   → done in 1 marker.
 *
 * PHASE 2 · GCD exact 2-row search  (main optimizer)
 *   For each (r1, p1): compute remainder = order - r1*p1.
 *   Use GCD of remainder to find r2,p2 such that r2*p2 = remainder exactly
 *   (i.e. each rem[i] / p2 = integer, p2 ≤ maxPly, sum(r2) ≤ totalRatio).
 *   Score = rows*1000 + softPenalty(ply utilisation < 65%).
 *   Keep best score. Time budget: 800 ms.
 *
 * PHASE 3 · Variable-sum greedy fallback (guaranteed to terminate)
 *   Used when no exact solution is found in budget, and as the sub-solver
 *   for 3+ marker plans. Tries all ratio sums at each greedy step.
 *
 * ─── 65% PLY RULE ─────────────────────────────────────────────────────────────
 * "Soft preference": using < 65% of maxPly adds a penalty to the score but does
 * not eliminate the solution. The last cleanup marker is often below 65% — this
 * is acceptable when no better plan exists.
 */

'use strict';

const PLY_THRESHOLD = 0.65;   // 65% of maxPly = preferred minimum
const PLY_PENALTY   = 60;     // score penalty per marker below threshold

// ─── MATH UTILITIES ───────────────────────────────────────────────────────────

function gcd2(a, b) { while (b) { [a, b] = [b, a % b]; } return a; }
function gcdArr(arr) { return arr.filter(x => x > 0).reduce(gcd2); }

/**
 * Proportional integer ratios summing exactly to ratioSum (largest-remainder).
 * Zeros out sizes that are already fulfilled. Returns null if nothing remains.
 */
function computeRatiosForSum(remaining, ratioSum) {
  const n     = remaining.length;
  const total = remaining.reduce((a, b) => a + b, 0);
  if (total === 0 || ratioSum <= 0) return null;

  const raw    = remaining.map(r => (r / total) * ratioSum);
  const floors = raw.map(Math.floor);
  let deficit  = ratioSum - floors.reduce((a, b) => a + b, 0);

  const byFrac = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => (raw[b] - floors[b]) - (raw[a] - floors[a]));
  for (let k = 0; k < deficit; k++) floors[byFrac[k]]++;

  for (let i = 0; i < n; i++) if (remaining[i] === 0) floors[i] = 0;

  const s = floors.reduce((a, b) => a + b, 0);
  if (s === 0) return null;

  if (s !== ratioSum) {
    const d   = ratioSum - s;
    const big = floors.map((v, i) => ({ v, i }))
                      .filter(x => x.v > 0)
                      .sort((a, b) => b.v - a.v)[0];
    if (!big || big.v + d <= 0) return null;
    floors[big.i] += d;
  }

  return floors;
}

/** Max cuts without overproducing any size. */
function maxCuts(ratios, remaining) {
  let min = Infinity;
  for (let i = 0; i < ratios.length; i++) {
    if (ratios[i] > 0) min = Math.min(min, Math.floor(remaining[i] / ratios[i]));
  }
  return isFinite(min) ? min : 0;
}

/** Split total cuts into {ply, times} rows, each ≤ maxPly. */
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

/**
 * Soft ply-efficiency penalty for the scoring function.
 * Returns 0 if ply >= 65% of maxPly, else proportional penalty.
 */
function plyPenalty(ply, maxPly) {
  const pct = ply / maxPly;
  return pct < PLY_THRESHOLD ? (PLY_THRESHOLD - pct) * PLY_PENALTY : 0;
}

// ─── EXACT SINGLE-ROW COVERAGE CHECK ─────────────────────────────────────────

/**
 * Given a remainder vector, find (r2, p2) such that r2[i]*p2 = rem[i] exactly,
 * p2 ≤ maxPly, sum(r2) ≤ totalRatio.
 *
 * Uses GCD: p2 must divide every rem[i], so p2 must divide gcd(rem).
 * Returns the highest valid p2 (most economical), or null.
 */
function findExactSingleRow(rem, maxPly, totalRatio) {
  if (rem.every(r => r === 0)) return null;
  if (rem.some(r => r < 0))   return null;

  const g = gcdArr(rem.filter(r => r > 0));

  // Try divisors of g from largest to smallest (prefer high ply)
  let best = null;
  for (let p2 = Math.min(g, maxPly); p2 >= 1; p2--) {
    if (g % p2 !== 0) continue;
    if (rem.some(r => r > 0 && r % p2 !== 0)) continue;

    const r2 = rem.map(r => r / p2);
    const s2 = r2.reduce((a, b) => a + b, 0);
    if (s2 > totalRatio) continue;

    // among valid p2 values, prefer higher (better ply utilisation)
    if (!best || p2 > best.p2) {
      best = { ratios: r2, ply: p2, ratioSum: s2 };
    }
  }
  return best;
}

// ─── VARIABLE-SUM GREEDY (fallback sub-solver) ────────────────────────────────

/**
 * At each greedy step, try all ratio sums from totalRatio down to 1.
 * Pick the ratio sum that maximises pieces produced; tie-break by fill rate.
 */
function bestGreedyStep(remaining, maxPly, totalRatio) {
  const total = remaining.reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  let bestRatios = null, bestCuts = 0, bestRatioSum = 0, bestCoverage = -1;

  for (let s = totalRatio; s >= 1; s--) {
    const ratios = computeRatiosForSum(remaining, s);
    if (!ratios) continue;
    const cuts     = maxCuts(ratios, remaining);
    if (cuts <= 0) continue;
    const coverage = ratios.reduce((acc, r) => acc + r * cuts, 0);
    if (coverage > bestCoverage) {
      bestCoverage = coverage;
      bestRatios   = ratios;
      bestCuts     = cuts;
      bestRatioSum = s;
    }
  }

  return bestRatios ? { ratios: bestRatios, cuts: bestCuts, ratioSum: bestRatioSum } : null;
}

function greedySolve(order, maxPly, totalRatio, startId = 1, startRunning = null) {
  const n         = order.length;
  const remaining = [...order];
  const running   = startRunning ? [...startRunning] : new Array(n).fill(0);
  const entries   = [];
  let   id        = startId - 1;
  let   guard     = 0;

  while (remaining.some(r => r > 0) && guard++ < 600) {
    const best = bestGreedyStep(remaining, maxPly, totalRatio);
    if (!best) break;

    const { ratios, cuts } = best;
    for (const { ply, times } of splitIntoRows(cuts, maxPly)) {
      const produced = ratios.map(r => r * ply * times);
      for (let i = 0; i < n; i++) { remaining[i] -= produced[i]; running[i] += produced[i]; }
      entries.push({
        id:       ++id,
        ratios:   [...ratios],
        ratioSum: ratios.reduce((a, b) => a + b, 0),
        ply, times,
        produced: [...produced],
        running:  [...running],
      });
    }
  }
  return entries;
}

// ─── MAIN OPTIMIZER ───────────────────────────────────────────────────────────

/**
 * Score a plan: fewer rows wins; among equal rows, prefer higher ply utilisation.
 * Lower score = better.
 */
function planScore(entries, maxPly) {
  const rowPenalty = entries.length * 1000;
  const plyPen     = entries.reduce((acc, e) => acc + plyPenalty(e.ply, maxPly), 0);
  return rowPenalty + plyPen;
}

function optimizedSolve(order, maxPly, totalRatio, timeLimitMs = 800) {
  const n        = order.length;
  const deadline = Date.now() + timeLimitMs;

  // ── Phase 3 baseline (greedy, always valid) ────────────────────────────────
  let bestEntries = greedySolve(order, maxPly, totalRatio);
  let bestScore   = planScore(bestEntries, maxPly);

  if (bestEntries.length <= 1) return bestEntries;

  // ── Phase 1 & 2: exact search over all (ratioSum, ply) for M1 ─────────────
  // Outer loop: ratio sums from totalRatio down to 1
  for (let s1 = totalRatio; s1 >= 1; s1--) {
    if (Date.now() > deadline) break;

    const r1 = computeRatiosForSum(order, s1);
    if (!r1) continue;

    // Inner loop: ply from maxPly down to 1
    // We iterate high-to-low so we discover high-ply (economical) solutions first
    for (let p1 = maxPly; p1 >= 1; p1--) {
      if (Date.now() > deadline) break;

      const rem = order.map((o, i) => o - r1[i] * p1);
      if (rem.some(r => r < 0)) continue;

      const running1 = new Array(n).fill(0);
      const prod1    = r1.map(r => r * p1);
      for (let i = 0; i < n; i++) running1[i] = prod1[i];

      const m1base = {
        id: 1, ratios: [...r1], ratioSum: s1,
        ply: p1, times: 1, produced: [...prod1], running: [...running1],
      };

      // ── Phase 1: 1-row exact ──────────────────────────────────────────────
      if (rem.every(r => r === 0)) {
        const score = planScore([m1base], maxPly);
        if (score < bestScore) {
          bestScore   = score;
          bestEntries = [{ ...m1base, id: 1 }];
        }
        continue;
      }

      // ── Phase 2: 2-row exact ──────────────────────────────────────────────
      const cov = findExactSingleRow(rem, maxPly, totalRatio);
      if (cov) {
        const running2 = running1.map((v, i) => v + cov.ratios[i] * cov.ply);
        const m2 = {
          id: 2, ratios: cov.ratios, ratioSum: cov.ratioSum,
          ply: cov.ply, times: 1,
          produced: cov.ratios.map(r => r * cov.ply),
          running: [...running2],
        };
        const candidate = [m1base, m2];
        const score     = planScore(candidate, maxPly);
        if (score < bestScore) {
          bestScore   = score;
          bestEntries = candidate;
        }
        // Early exit: if we found 2-rows with both plies ≥ 65% → optimal
        if (bestEntries.length <= 2 &&
            bestEntries.every(e => e.ply >= PLY_THRESHOLD * maxPly)) break;
        continue;
      }

      // ── Phase 2b: M1 (1 row) + greedy remainder ───────────────────────────
      // Only try this if it could beat current best
      const minPossibleRows = 1 + 1; // M1 + at least 1 more
      if (minPossibleRows * 1000 >= bestScore) continue;

      const subEntries = greedySolve(rem, maxPly, totalRatio, 2, running1);
      const candidate  = [m1base, ...subEntries];
      const score      = planScore(candidate, maxPly);
      if (score < bestScore) {
        bestScore   = score;
        bestEntries = candidate;
      }
    }

    // If we already have a 1-row solution, stop searching
    if (bestEntries.length === 1) break;
  }

  // Re-number ids sequentially
  bestEntries.forEach((e, i) => { e.id = i + 1; });
  return bestEntries;
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * @param {{ name: string, qty: number }[]} sizes
 * @param {number} maxPly
 * @param {number} totalRatio   - maximum ratio sum per marker
 * @param {number} consumption  - fabric per piece in metres (passed through for UI)
 * @returns {{ rows, sizes, order, maxPly, totalRatio, consumption }}
 */
function solveMarkers(sizes, maxPly, totalRatio, consumption) {
  const sizeNames = sizes.map(s => s.name);
  const order     = sizes.map(s => s.qty);
  const entries   = optimizedSolve(order, maxPly, totalRatio, 800);
  return { rows: entries, sizes: sizeNames, order, maxPly, totalRatio, consumption: consumption || 0 };
}

window.solveMarkers = solveMarkers;
