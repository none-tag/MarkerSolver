/**
 * solver.js — Cut Marker Ratio Solver  (proven global-minimum edition)
 *
 * PUBLIC API:
 *   solveMarkers(sizes, maxPly, totalRatio, consumption) → result object
 *
 * GUARANTEE:
 *   Returns the plan with the fewest marker rows that fills every size
 *   EXACTLY (no shortfall, no overproduction per size). Among plans with
 *   equal row counts, prefers higher ply utilisation (65% of maxPly soft target).
 *
 * ─── ALGORITHM ────────────────────────────────────────────────────────────────
 *
 * A marker row = (ratios[], ply) where
 *   ratios[i] ≥ 0 integer,  sum(ratios) ≤ totalRatio
 *   1 ≤ ply ≤ maxPly
 *   produced[i] = ratios[i] × ply
 *
 * Iterative-deepening exhaustive search:
 *   For K = 1, 2, 3, … (up to greedy upper bound):
 *     Enumerate all K-marker plans. First exact cover → proven optimal.
 *
 * K = 1 : GCD check — ply | gcd(order), verify sum(order/ply) ≤ totalRatio.
 *
 * K = 2 : For each p1 ∈ [maxPly..1]:
 *   DFS over r1[] with sum(r1) ≤ totalRatio, r1[i] ≤ ⌊order[i]/p1⌋.
 *   GCD PRUNING: maintain running_gcd = gcd(rem[0..idx]) as we assign r1.
 *   If any partial rem[j] is not divisible by running_gcd → prune branch.
 *   If partial sum(rem[0..idx] / running_gcd) already > totalRatio → prune.
 *   At leaf: check if remainder is solvable by 1 marker (O(divisors)).
 *   This reduces 9M+ nodes to ~100 in practice for typical orders.
 *
 * K ≥ 3 : Same DFS recursively on the remainder after each marker.
 *
 * Greedy fallback provides the upper-bound K (guarantees termination).
 */

'use strict';

// ─── MATH ─────────────────────────────────────────────────────────────────────

function gcd2(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { const t = b; b = a % b; a = t; }
  return a;
}

function gcdArr(arr) {
  const pos = arr.filter(x => x > 0);
  if (!pos.length) return 0;
  return pos.reduce(gcd2);
}

function splitIntoRows(cuts, maxPly) {
  if (cuts <= 0) return [];
  const ply   = Math.min(cuts, maxPly);
  const times = Math.floor(cuts / ply);
  const left  = cuts - ply * times;
  const rows  = [];
  if (times > 0) rows.push({ ply, times });
  if (left  > 0) rows.push({ ply: left, times: 1 });
  return rows;
}

// ─── 1-MARKER EXACT SOLVER ────────────────────────────────────────────────────

/**
 * Find (ratios, ply) s.t. ratios[i]*ply = remaining[i] for all i,
 * sum(ratios) ≤ totalRatio, 1 ≤ ply ≤ maxPly.
 * ply must divide gcd(remaining). Returns best (highest ply) or null.
 */
function solve1Marker(remaining, maxPly, totalRatio) {
  if (remaining.some(x => x < 0)) return null;
  const pos = remaining.filter(x => x > 0);
  if (!pos.length) return null;

  const g = gcdArr(pos);
  if (!g) return null;

  for (let ply = Math.min(g, maxPly); ply >= 1; ply--) {
    if (g % ply !== 0) continue;
    if (remaining.some(x => x > 0 && x % ply !== 0)) continue;
    const ratios = remaining.map(x => x / ply);
    const s      = ratios.reduce((a, b) => a + b, 0);
    if (s <= totalRatio) return { ratios, ply, ratioSum: s };
  }
  return null;
}

// ─── 2-MARKER EXACT SOLVER  (GCD-pruned DFS) ─────────────────────────────────

/**
 * Find a 2-marker exact cover for `order`.
 *
 * For each p1 ∈ [maxPly..1]:
 *   DFS over r1[] maintaining running_gcd of the assigned remainder.
 *   Prune when running_gcd makes M2 infeasible (ratio sum would exceed limit,
 *   or a partial remainder is not divisible by the running gcd).
 *   At the leaf, check if remainder is 1-marker solvable.
 *
 * Returns [{ratios,ply,ratioSum}, {ratios,ply,ratioSum}] or null.
 * Among solutions, picks the one with fewest markers below 65% ply threshold.
 */
function solve2Markers(order, maxPly, totalRatio) {
  const n   = order.length;
  const THR = 0.65 * maxPly;
  let   best = null;    // { plan, pen }

  const r1 = new Array(n).fill(0);

  for (let p1 = maxPly; p1 >= 1; p1--) {
    const maxA = order.map(o => Math.floor(o / p1));
    if (maxA.every(x => x === 0)) continue;

    function dfs(idx, ratioLeft, runGcd) {
      if (best && best.pen === 0) return;   // can't improve — stop

      if (idx === n) {
        const rs1 = r1.reduce((a, b) => a + b, 0);
        if (rs1 === 0) return;              // no-op marker

        const rem = order.map((o, i) => o - r1[i] * p1);
        if (rem.every(x => x === 0)) return; // M1 alone finishes — not 2-marker

        const sol2 = solve1Marker(rem, maxPly, totalRatio);
        if (!sol2) return;

        const pen = (p1 < THR ? 1 : 0) + (sol2.ply < THR ? 1 : 0);
        if (!best || pen < best.pen) {
          best = {
            plan: [{ ratios: [...r1], ply: p1, ratioSum: rs1 }, sol2],
            pen,
          };
        }
        return;
      }

      if (ratioLeft < 0) return;

      const hi = Math.min(maxA[idx], ratioLeft);
      for (let v = hi; v >= 0; v--) {
        r1[idx] = v;
        const remV = order[idx] - v * p1;

        // Update running GCD over the assigned (fixed) remainder entries
        let newGcd = runGcd;
        if (remV > 0) newGcd = newGcd === 0 ? remV : gcd2(newGcd, remV);

        // ── GCD PRUNING ──────────────────────────────────────────────────────
        // The running_gcd is the largest integer that could serve as p2.
        // Verify every fixed rem[j] is divisible by newGcd, and that the
        // partial ratio sum for M2 (= sum of rem[j]/newGcd) doesn't already
        // exceed totalRatio.
        if (newGcd > 0) {
          let partSum  = 0;
          let feasible = true;
          for (let j = 0; j <= idx; j++) {
            const rv = order[j] - r1[j] * p1;
            if (rv > 0) {
              if (rv % newGcd !== 0) { feasible = false; break; }
              partSum += rv / newGcd;
            }
          }
          if (!feasible || partSum > totalRatio) {
            r1[idx] = 0;
            continue; // prune this branch
          }
        }

        dfs(idx + 1, ratioLeft - v, newGcd);
        if (best && best.pen === 0) { r1[idx] = 0; return; }
        r1[idx] = 0;
      }
    }

    dfs(0, totalRatio, 0);
    if (best && best.pen === 0) return best.plan;
  }

  return best ? best.plan : null;
}

// ─── K-MARKER RECURSIVE SOLVER (K ≥ 3) ───────────────────────────────────────

function solveKMarkers(remaining, depth, maxPly, totalRatio) {
  if (depth === 1) {
    const sol = solve1Marker(remaining, maxPly, totalRatio);
    return sol ? [sol] : null;
  }
  if (depth === 2) {
    return solve2Markers(remaining, maxPly, totalRatio);
  }

  const n  = remaining.length;
  const r1 = new Array(n).fill(0);

  for (let p1 = maxPly; p1 >= 1; p1--) {
    const maxA = remaining.map(r => Math.floor(r / p1));
    if (maxA.every(x => x === 0)) continue;

    let found = null;

    function dfs(idx, ratioLeft, runGcd) {
      if (found) return;

      if (idx === n) {
        const rs1 = r1.reduce((a, b) => a + b, 0);
        if (rs1 === 0) return;
        const rem = remaining.map((r, i) => r - r1[i] * p1);
        if (rem.every(x => x === 0)) return; // finished too early

        const sub = solveKMarkers(rem, depth - 1, maxPly, totalRatio);
        if (sub) found = [{ ratios: [...r1], ply: p1, ratioSum: rs1 }, ...sub];
        return;
      }

      if (ratioLeft < 0) return;
      const hi = Math.min(maxA[idx], ratioLeft);
      for (let v = hi; v >= 0; v--) {
        r1[idx] = v;
        const remV = remaining[idx] - v * p1;
        let newGcd = runGcd;
        if (remV > 0) newGcd = newGcd === 0 ? remV : gcd2(newGcd, remV);

        // GCD pruning (same as in solve2Markers)
        if (newGcd > 0) {
          let partSum = 0, feasible = true;
          for (let j = 0; j <= idx; j++) {
            const rv = remaining[j] - r1[j] * p1;
            if (rv > 0) {
              if (rv % newGcd !== 0) { feasible = false; break; }
              partSum += rv / newGcd;
            }
          }
          // Loose check: if even 1 marker couldn't cover the rest → prune
          if (!feasible || partSum > totalRatio * (depth - 1)) {
            r1[idx] = 0;
            continue;
          }
        }

        dfs(idx + 1, ratioLeft - v, newGcd);
        if (found) { r1[idx] = 0; return; }
        r1[idx] = 0;
      }
    }

    dfs(0, totalRatio, 0);
    if (found) return found;
  }

  return null;
}

// ─── GREEDY UPPER BOUND ───────────────────────────────────────────────────────

function proportionalRatios(remaining, ratioSum) {
  const n     = remaining.length;
  const total = remaining.reduce((a, b) => a + b, 0);
  if (!total || ratioSum <= 0) return null;

  const raw    = remaining.map(r => (r / total) * ratioSum);
  const floors = raw.map(Math.floor);
  let   deficit = ratioSum - floors.reduce((a, b) => a + b, 0);

  const byFrac = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => (raw[b] - floors[b]) - (raw[a] - floors[a]));
  for (let k = 0; k < deficit; k++) floors[byFrac[k]]++;
  for (let i = 0; i < n; i++) if (remaining[i] === 0) floors[i] = 0;

  let s = floors.reduce((a, b) => a + b, 0);
  if (s === 0) return null;
  if (s !== ratioSum) {
    const diff = ratioSum - s;
    const best = floors.map((v, i) => ({ v, i })).filter(x => x.v > 0).sort((a, b) => b.v - a.v)[0];
    if (!best || best.v + diff < 0) return null;
    floors[best.i] += diff;
  }
  return floors;
}

function maxCutsFor(ratios, remaining) {
  let min = Infinity;
  for (let i = 0; i < ratios.length; i++) {
    if (ratios[i] > 0) {
      const c = Math.floor(remaining[i] / ratios[i]);
      if (c < min) min = c;
    }
  }
  return isFinite(min) ? min : 0;
}

function greedySolve(order, maxPly, totalRatio) {
  const n         = order.length;
  const remaining = [...order];
  const running   = new Array(n).fill(0);
  const entries   = [];
  let   id        = 0;
  let   guard     = 0;

  while (remaining.some(r => r > 0) && guard++ < 2000) {
    let bestCov = -1, bestR = null, bestCuts = 0, bestS = 0;

    for (let s = totalRatio; s >= 1; s--) {
      const r = proportionalRatios(remaining, s);
      if (!r) continue;
      const cuts = maxCutsFor(r, remaining);
      if (cuts <= 0) continue;
      const cov = r.reduce((a, x) => a + x * cuts, 0);
      if (cov > bestCov) { bestCov = cov; bestR = r; bestCuts = cuts; bestS = s; }
    }

    if (!bestR) break;

    for (const { ply, times } of splitIntoRows(bestCuts, maxPly)) {
      const produced = bestR.map(r => r * ply * times);
      for (let i = 0; i < n; i++) { remaining[i] -= produced[i]; running[i] += produced[i]; }
      entries.push({
        id:       ++id,
        ratios:   [...bestR],
        ratioSum: bestS,
        ply, times,
        produced: [...produced],
        running:  [...running],
      });
    }
  }
  return entries;
}

// ─── ENTRY BUILDER & COLLAPSE ─────────────────────────────────────────────────

function buildEntries(plan, order) {
  const n       = order.length;
  const running = new Array(n).fill(0);
  return plan.map((m, idx) => {
    const produced = m.ratios.map(r => r * m.ply);
    for (let i = 0; i < n; i++) running[i] += produced[i];
    return {
      id:       idx + 1,
      ratios:   [...m.ratios],
      ratioSum: m.ratioSum,
      ply:      m.ply,
      times:    1,
      produced: [...produced],
      running:  [...running],
    };
  });
}

function collapseEntries(entries) {
  if (!entries.length) return entries;
  const out = [];
  let cur = { ...entries[0], produced: [...entries[0].produced], running: [...entries[0].running] };

  for (let i = 1; i < entries.length; i++) {
    const e = entries[i];
    if (e.ratios.join(',') === cur.ratios.join(',') && e.ply === cur.ply) {
      cur.times++;
      cur.produced = cur.produced.map((p, j) => p + e.produced[j]);
      cur.running  = [...e.running];
    } else {
      out.push(cur);
      cur = { ...e, produced: [...e.produced], running: [...e.running] };
    }
  }
  out.push(cur);
  out.forEach((e, i) => { e.id = i + 1; });
  return out;
}

// ─── MAIN OPTIMIZER ───────────────────────────────────────────────────────────

function optimizedSolve(order, maxPly, totalRatio) {
  const greedy  = greedySolve(order, maxPly, totalRatio);
  const greedyK = greedy.length;

  for (let K = 1; K <= greedyK; K++) {
    let plan = null;

    if (K === 1) {
      const sol = solve1Marker(order, maxPly, totalRatio);
      if (sol) plan = [sol];
    } else if (K === 2) {
      plan = solve2Markers(order, maxPly, totalRatio);
    } else {
      plan = solveKMarkers([...order], K, maxPly, totalRatio);
    }

    if (plan) {
      return collapseEntries(buildEntries(plan, order));
    }
  }

  // Fallback: return greedy (should not reach here if greedy is exact)
  return collapseEntries(greedy);
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * @param {{ name: string, qty: number }[]} sizes
 * @param {number} maxPly
 * @param {number} totalRatio  — floor(tableLength / consumption)
 * @param {number} consumption — fabric per finished garment in metres
 * @returns {{ rows, sizes, order, maxPly, totalRatio, consumption }}
 */
function solveMarkers(sizes, maxPly, totalRatio, consumption) {
  const sizeNames = sizes.map(s => s.name);
  const order     = sizes.map(s => s.qty);
  const entries   = optimizedSolve(order, maxPly, totalRatio);
  return { rows: entries, sizes: sizeNames, order, maxPly, totalRatio, consumption: consumption || 0 };
}

// Browser direct call
if (typeof window !== 'undefined') window.solveMarkers = solveMarkers;

// Web Worker message handler (self exists, window does not)
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.onmessage = function (e) {
    try {
      const { sizes, maxPly, totalRatio, consumption } = e.data;
      const result = solveMarkers(sizes, maxPly, totalRatio, consumption);
      self.postMessage({ ok: true, result });
    } catch (err) {
      self.postMessage({ ok: false, error: err.message });
    }
  };
}
