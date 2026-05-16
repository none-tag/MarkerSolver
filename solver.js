/**
 * solver.js — Cut Marker Ratio Solver  (global minimum edition)
 *
 * Public API:
 *   solveMarkers(sizes, maxPly, totalRatio, consumption) → result object
 *
 * ─── ALGORITHM ────────────────────────────────────────────────────────────────
 *
 * Goal: find the GLOBALLY MINIMUM number of markers that EXACTLY fills the
 * order (no shortfall, no overproduction), then among equal-marker-count
 * solutions maximise min(ply across all markers) — the most economical split.
 *
 * PHASE 1 — Can 1 marker do it?
 * ──────────────────────────────
 *   A single marker (r, p) fills order exactly iff r[i]*p = order[i] for all i.
 *   ⟹ p must divide GCD(order), and sum(order/p) ≤ totalRatio, p ≤ maxPly.
 *   Enumerate divisors of GCD(order) up to maxPly; pick the one giving
 *   sum(r) ≤ totalRatio with the highest p.
 *
 * PHASE 2 — Can 2 markers do it?
 * ────────────────────────────────
 *   Two markers (r1,p1) and (r2,p2) fill exactly iff:
 *       r1[i]*p1 + r2[i]*p2 = order[i]   for every size i
 *   This is a system of linear Diophantine equations, one per size.
 *
 *   For each pair (p1, p2) ∈ [1..maxPly]²:
 *     Let g = gcd(p1, p2).  A solution exists for size i iff g | order[i].
 *     If all sizes pass: use extended GCD to find the particular solution
 *     (r1_0[i], r2_0[i]), then the general solution is:
 *         r1[i] = r1_0[i] + (p2/g)·t[i]
 *         r2[i] = r2_0[i] − (p1/g)·t[i]
 *     Each t[i] is chosen independently per size to keep r1[i]≥0, r2[i]≥0.
 *     The coupling constraint is:
 *         sum(r1[i]) ≤ totalRatio   and   sum(r2[i]) ≤ totalRatio
 *     which translates to bounds on sum(t[i]).
 *     We greedily pick t[i] values (start at tMin[i]) and adjust the total
 *     to satisfy both ratio-sum bounds simultaneously.
 *
 *   Among all valid (p1,p2) pairs, rank by:
 *     1. Maximise min(p1, p2)  — worst-case ply utilisation
 *     2. Tie-break: maximise p1+p2 — total ply utilisation
 *
 * PHASE 3 — Greedy fallback (3+ markers)
 * ────────────────────────────────────────
 *   If no exact 1- or 2-marker solution exists, run variable-ratio-sum greedy.
 *   At each step try all ratio sums 1..totalRatio and pick the one that
 *   maximises pieces produced per step.
 */

'use strict';

// ─── MATH UTILITIES ──────────────────────────────────────────────────────────

function gcd2(a, b) { while (b) { const t = b; b = a % b; a = t; } return a; }

function gcdArr(arr) {
  const pos = arr.filter(x => x > 0);
  return pos.length ? pos.reduce(gcd2) : 0;
}

/**
 * Extended GCD: returns [g, x, y] such that a*x + b*y = g.
 */
function extGcd(a, b) {
  if (b === 0) return [a, 1, 0];
  const [g, x1, y1] = extGcd(b, a % b);
  return [g, y1, x1 - Math.floor(a / b) * y1];
}

/** Split total cuts into {ply, times} rows each ≤ maxPly. */
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

// ─── PHASE 1: EXACT 1-MARKER SEARCH ─────────────────────────────────────────

/**
 * Returns {ratios, ply, ratioSum} for the best 1-marker exact solution,
 * or null if none exists within constraints.
 */
function tryOneMarker(order, maxPly, totalRatio) {
  const g = gcdArr(order);
  if (g === 0) return null;

  let best = null;

  // Enumerate divisors of g up to maxPly
  for (let p = 1; p <= Math.min(g, maxPly); p++) {
    if (g % p !== 0) continue;
    const ratios   = order.map(o => o / p);
    const ratioSum = ratios.reduce((a, b) => a + b, 0);
    if (ratioSum > totalRatio) continue;
    // prefer highest p (best ply utilisation)
    if (!best || p > best.ply) {
      best = { ratios, ply: p, ratioSum };
    }
  }

  return best;
}

// ─── PHASE 2: EXACT 2-MARKER SEARCH ─────────────────────────────────────────

/**
 * For a fixed (p1, p2) pair, attempt to find integer vectors (r1, r2) such that
 *   r1[i]*p1 + r2[i]*p2 = order[i]  for all i,
 *   r1[i] ≥ 0, r2[i] ≥ 0,
 *   sum(r1) ≤ totalRatio, sum(r2) ≤ totalRatio.
 *
 * Returns {r1, r2} or null.
 */
function solveForPlyPair(order, p1, p2, totalRatio) {
  const n = order.length;
  const g = gcd2(p1, p2);

  // Feasibility: g must divide every order[i]
  for (const o of order) {
    if (o % g !== 0) return null;
  }

  const p1g = p1 / g;
  const p2g = p2 / g;
  const [, x0, y0] = extGcd(p1, p2);
  // p1*x0 + p2*y0 = g  →  p1*(x0*o/g) + p2*(y0*o/g) = o

  // For each size i:
  //   particular: r1_0 = x0*(order[i]/g),  r2_0 = y0*(order[i]/g)
  //   general:    r1[i] = r1_0 + p2g*t[i], r2[i] = r2_0 - p1g*t[i]
  //   constraints: t[i] ≥ ceil(-r1_0 / p2g)  and  t[i] ≤ floor(r2_0 / p1g)

  const parts = order.map(o => {
    const scale = o / g;
    const r1_0  = x0 * scale;
    const r2_0  = y0 * scale;
    const tMin  = Math.ceil(-r1_0 / p2g);
    const tMax  = Math.floor(r2_0 / p1g);
    return { r1_0, r2_0, tMin, tMax };
  });

  // Individual feasibility
  if (parts.some(p => p.tMin > p.tMax)) return null;

  // Coupling via sum(t[i]):
  //   sum(r1) = sum(r1_0) + p2g*sum(t) ≤ totalRatio  →  sum(t) ≤ (totalRatio - sum(r1_0)) / p2g
  //   sum(r2) = sum(r2_0) - p1g*sum(t) ≤ totalRatio  →  sum(t) ≥ (sum(r2_0) - totalRatio) / p1g
  const sumR1_0     = parts.reduce((acc, p) => acc + p.r1_0, 0);
  const sumR2_0     = parts.reduce((acc, p) => acc + p.r2_0, 0);
  const globalTMax  = Math.floor((totalRatio - sumR1_0) / p2g);
  const globalTMin  = Math.ceil((sumR2_0 - totalRatio) / p1g);

  // Total t range from individual constraints
  const minSumT = parts.reduce((acc, p) => acc + p.tMin, 0);
  const maxSumT = parts.reduce((acc, p) => acc + p.tMax, 0);

  // Overall feasibility
  const feasibleMin = Math.max(globalTMin, minSumT);
  const feasibleMax = Math.min(globalTMax, maxSumT);
  if (feasibleMin > feasibleMax) return null;

  // Find a valid t[] assignment:
  // Start each t[i] at tMin[i], then adjust sum upward toward feasibleMin
  // by increasing individual t[i] values where possible.
  const ts = parts.map(p => p.tMin);
  let sumT  = ts.reduce((a, b) => a + b, 0);

  // Increase sum to at least feasibleMin
  if (sumT < feasibleMin) {
    const deficit = feasibleMin - sumT;
    let toAdd = deficit;
    for (let i = 0; i < n && toAdd > 0; i++) {
      const room  = parts[i].tMax - ts[i];
      const add   = Math.min(room, toAdd);
      ts[i]      += add;
      toAdd      -= add;
    }
    if (toAdd > 0) return null;  // couldn't meet globalTMin
    sumT = ts.reduce((a, b) => a + b, 0);
  }

  // Ensure sumT ≤ feasibleMax (it should be, but guard)
  if (sumT > feasibleMax) return null;

  const r1 = parts.map((p, i) => p.r1_0 + p2g * ts[i]);
  const r2 = parts.map((p, i) => p.r2_0 - p1g * ts[i]);

  // Final validation
  if (r1.some(v => v < 0) || r2.some(v => v < 0)) return null;
  if (r1.some(v => !Number.isInteger(v)) || r2.some(v => !Number.isInteger(v))) return null;

  // Verify sum constraints
  const s1 = r1.reduce((a, b) => a + b, 0);
  const s2 = r2.reduce((a, b) => a + b, 0);
  if (s1 > totalRatio || s2 > totalRatio) return null;

  // Verify exact fill
  for (let i = 0; i < n; i++) {
    if (r1[i] * p1 + r2[i] * p2 !== order[i]) return null;
  }

  return { r1, r2, s1, s2 };
}

/**
 * Search all (p1, p2) ∈ [1..maxPly]² for valid 2-marker exact solutions.
 * Returns the best one (maximise min-ply, then p1+p2), or null.
 */
function tryTwoMarkers(order, maxPly, totalRatio) {
  let best     = null;
  let bestMin  = -1;
  let bestSum  = -1;

  for (let p1 = 1; p1 <= maxPly; p1++) {
    for (let p2 = 1; p2 <= maxPly; p2++) {
      const sol = solveForPlyPair(order, p1, p2, totalRatio);
      if (!sol) continue;

      const minPly = Math.min(p1, p2);
      const sumPly = p1 + p2;

      if (minPly > bestMin || (minPly === bestMin && sumPly > bestSum)) {
        bestMin  = minPly;
        bestSum  = sumPly;
        best     = { p1, p2, ...sol };
      }
    }
  }

  return best;
}

// ─── PHASE 3: VARIABLE-SUM GREEDY FALLBACK ───────────────────────────────────

/**
 * Proportional integer ratios summing exactly to ratioSum (largest-remainder).
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

function maxCuts(ratios, remaining) {
  let min = Infinity;
  for (let i = 0; i < ratios.length; i++) {
    if (ratios[i] > 0) min = Math.min(min, Math.floor(remaining[i] / ratios[i]));
  }
  return isFinite(min) ? min : 0;
}

function greedySolve(order, maxPly, totalRatio, startId = 1, startRunning = null) {
  const n         = order.length;
  const remaining = [...order];
  const running   = startRunning ? [...startRunning] : new Array(n).fill(0);
  const entries   = [];
  let   id        = startId - 1;
  let   guard     = 0;

  while (remaining.some(r => r > 0) && guard++ < 600) {
    let bestRatios = null, bestCuts = 0, bestCoverage = -1;

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
      }
    }

    if (!bestRatios) break;

    for (const { ply, times } of splitIntoRows(bestCuts, maxPly)) {
      const produced = bestRatios.map(r => r * ply * times);
      for (let i = 0; i < n; i++) { remaining[i] -= produced[i]; running[i] += produced[i]; }
      entries.push({
        id:       ++id,
        ratios:   [...bestRatios],
        ratioSum: bestRatios.reduce((a, b) => a + b, 0),
        ply, times,
        produced: [...produced],
        running:  [...running],
      });
    }
  }

  return entries;
}

// ─── ENTRY BUILDER ────────────────────────────────────────────────────────────

/** Convert a {ratios, ply, ratioSum} object into a full entry with produced + running. */
function makeEntry(id, ratios, ply, times, ratioSum, prevRunning) {
  const produced = ratios.map(r => r * ply * times);
  const running  = prevRunning.map((v, i) => v + produced[i]);
  return { id, ratios: [...ratios], ratioSum, ply, times, produced, running };
}

// ─── MAIN SOLVER ─────────────────────────────────────────────────────────────

function optimizedSolve(order, maxPly, totalRatio) {
  const n       = order.length;
  const running0 = new Array(n).fill(0);

  // ── Phase 1: try 1 marker ────────────────────────────────────────────────
  const one = tryOneMarker(order, maxPly, totalRatio);
  if (one) {
    const e = makeEntry(1, one.ratios, one.ply, 1, one.ratioSum, running0);
    return [e];
  }

  // ── Phase 2: try 2 markers ───────────────────────────────────────────────
  const two = tryTwoMarkers(order, maxPly, totalRatio);
  if (two) {
    const run1 = running0.map((_, i) => two.r1[i] * two.p1);
    const e1   = makeEntry(1, two.r1, two.p1, 1, two.s1, running0);
    const e2   = makeEntry(2, two.r2, two.p2, 1, two.s2, run1);
    return [e1, e2];
  }

  // ── Phase 3: greedy fallback (3+ markers) ───────────────────────────────
  return greedySolve(order, maxPly, totalRatio);
}

// ─── PUBLIC API ──────────────────────────────────────────────────────────────

/**
 * @param {{ name: string, qty: number }[]} sizes
 * @param {number} maxPly
 * @param {number} totalRatio
 * @param {number} [consumption=0]   metres of fabric per piece
 * @returns {{ rows, sizes, order, maxPly, totalRatio, consumption }}
 */
function solveMarkers(sizes, maxPly, totalRatio, consumption) {
  const sizeNames = sizes.map(s => s.name);
  const order     = sizes.map(s => s.qty);
  const entries   = optimizedSolve(order, maxPly, totalRatio);
  return {
    rows:        entries,
    sizes:       sizeNames,
    order,
    maxPly,
    totalRatio,
    consumption: consumption || 0,
  };
}

window.solveMarkers = solveMarkers;
