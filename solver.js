/**
 * solver.js — Cut Marker Ratio Solver  (variable ratio sum + minimum-marker edition)
 *
 * Public API (unchanged):
 *   solveMarkers(sizes, maxPly, totalRatio) → result object
 *
 * ─── KEY CHANGE FROM PREVIOUS VERSION ────────────────────────────────────────
 * Previously every marker was forced to use exactly `totalRatio` pieces per ply.
 * Now markers may use ANY ratio sum from 1 up to totalRatio.
 *
 * Why this helps:
 *   For certain order proportions a smaller ratio sum may exactly divide all
 *   remaining quantities, covering the whole remainder in a single row instead
 *   of 2-3 rows with a forced full ratio sum.
 *   e.g. order=[100,150,200], totalRatio=40:
 *     fixed sum=40 → ratios=[8,12,16?] don't divide evenly → multiple rows
 *     variable sum=18 → ratios=[4,6,8] → cuts=25 → exact 1-row solution!
 *
 * ─── ALGORITHM ────────────────────────────────────────────────────────────────
 *
 * PHASE 1 · Variable-sum greedy (baseline + remainder finisher)
 *   At each step try ALL ratio sums from totalRatio down to 1.
 *   For each sum compute proportional ratios, then compute max cuts.
 *   Pick the sum that maximises total pieces produced this step.
 *   Tie-break: higher fill rate preferred.
 *
 * PHASE 2 · Branch-and-bound search (500 ms budget)
 *   Same structure as before but candidate ratio vectors are now generated
 *   for every ratio sum from totalRatio down to 1 (not just = totalRatio).
 *   For each candidate: try all valid multiples-of-maxPly cut counts (1 row),
 *   run variable-sum greedy on remainder, keep best (fewest rows, then
 *   highest fill rate).
 */

'use strict';

// ─── RATIO UTILITIES ──────────────────────────────────────────────────────────

/**
 * Proportional integer ratios summing exactly to ratioSum.
 * Largest-remainder rounding. Returns null if remaining is all-zero.
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

  // zero out already-fulfilled sizes
  for (let i = 0; i < n; i++) if (remaining[i] === 0) floors[i] = 0;

  const s = floors.reduce((a, b) => a + b, 0);
  if (s === 0) return null;

  // re-balance if zeroing broke the sum
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

/** Maximum cuts without overproducing any size. */
function maxCuts(ratios, remaining) {
  let min = Infinity;
  for (let i = 0; i < ratios.length; i++) {
    if (ratios[i] > 0) min = Math.min(min, Math.floor(remaining[i] / ratios[i]));
  }
  return isFinite(min) ? min : 0;
}

/**
 * Split total cuts into {ply, times} entries each ≤ maxPly.
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

/**
 * For a given remaining vector, find the best (ratios, cuts) pair across
 * all ratio sums 1..maxRatioSum.
 * "Best" = maximises total pieces produced; ties broken by higher fill rate.
 *
 * Returns { ratios, cuts, ratioSum } or null.
 */
function bestVariableRatioStep(remaining, maxPly, maxRatioSum) {
  const order      = remaining;     // alias for clarity
  const orderTotal = order.reduce((a, b) => a + b, 0);
  if (orderTotal === 0) return null;

  let bestRatios   = null;
  let bestCuts     = 0;
  let bestRatioSum = 0;
  let bestCoverage = -1;
  let bestFill     = -1;

  for (let s = maxRatioSum; s >= 1; s--) {
    const ratios = computeRatiosForSum(remaining, s);
    if (!ratios) continue;
    const cuts = maxCuts(ratios, remaining);
    if (cuts <= 0) continue;

    // coverage = total pieces this step would produce
    const coverage = ratios.reduce((acc, r, i) => acc + r * cuts, 0);
    // fill rate = min(produced/remaining) across active sizes
    const fill = Math.min(
      ...ratios.map((r, i) => r > 0 ? (r * cuts) / remaining[i] : 1)
    );

    if (coverage > bestCoverage || (coverage === bestCoverage && fill > bestFill)) {
      bestCoverage = coverage;
      bestFill     = fill;
      bestRatios   = ratios;
      bestCuts     = cuts;
      bestRatioSum = s;
    }
  }

  return bestRatios ? { ratios: bestRatios, cuts: bestCuts, ratioSum: bestRatioSum } : null;
}

// ─── VARIABLE-SUM GREEDY SOLVER ───────────────────────────────────────────────

/**
 * Greedy solver that tries all ratio sums at each step.
 * Returns flat array of row entries with running totals.
 *
 * @param {number[]} order
 * @param {number}   maxPly
 * @param {number}   maxRatioSum   - upper bound (= totalRatio from inputs)
 * @param {number}   [startId=1]
 * @param {number[]} [startRunning=null]
 */
function greedySolve(order, maxPly, maxRatioSum, startId = 1, startRunning = null) {
  const n         = order.length;
  const remaining = [...order];
  const running   = startRunning ? [...startRunning] : new Array(n).fill(0);
  const entries   = [];
  let   id        = startId - 1;
  let   guard     = 0;

  while (remaining.some(r => r > 0) && guard++ < 600) {
    const best = bestVariableRatioStep(remaining, maxPly, maxRatioSum);
    if (!best) break;

    const { ratios, cuts } = best;

    for (const { ply, times } of splitIntoRows(cuts, maxPly)) {
      const produced = ratios.map(r => r * ply * times);
      for (let i = 0; i < n; i++) {
        remaining[i] -= produced[i];
        running[i]   += produced[i];
      }
      entries.push({
        id:       ++id,
        ratios:   [...ratios],
        ratioSum: ratios.reduce((a, b) => a + b, 0),
        ply,
        times,
        produced: [...produced],
        running:  [...running],
      });
    }
  }

  return entries;
}

// ─── CANDIDATE GENERATOR ─────────────────────────────────────────────────────

/**
 * Enumerate ratio vectors for a given ratioSum, within ±slack of the
 * proportional allocation. Yields number[] arrays.
 */
function* genCandidatesForSum(remaining, ratioSum, slack) {
  const n     = remaining.length;
  const total = remaining.reduce((a, b) => a + b, 0);
  if (total === 0) return;

  const base   = remaining.map(r => Math.floor((r / total) * ratioSum));
  const ranges = base.map(b => [
    Math.max(0, b - slack),
    Math.min(ratioSum, b + slack),
  ]);

  function* recurse(dim, partial, usedSum) {
    if (dim === n - 1) {
      const last = ratioSum - usedSum;
      if (last >= ranges[dim][0] && last <= ranges[dim][1]) {
        yield [...partial, last];
      }
      return;
    }
    for (let v = ranges[dim][0]; v <= ranges[dim][1]; v++) {
      if (usedSum + v > ratioSum) break;
      partial.push(v);
      yield* recurse(dim + 1, partial, usedSum + v);
      partial.pop();
    }
  }

  yield* recurse(0, [], 0);
}

// ─── BRANCH-AND-BOUND OPTIMIZER ───────────────────────────────────────────────

/**
 * Fill-rate score for a plan: min(produced/order) across all sizes.
 * Higher = better (1.0 = perfect).
 */
function planFillRate(entries, order) {
  const n    = order.length;
  const prod = new Array(n).fill(0);
  entries.forEach(e => e.produced.forEach((p, i) => { prod[i] += p; }));
  return Math.min(...order.map((o, i) => o > 0 ? prod[i] / o : 1));
}

/**
 * Branch-and-bound: search for fewest rows across all ratio sums 1..totalRatio.
 * For each candidate first-marker (ratio, ratioSum, mult):
 *   - M1 = exactly 1 row (ply=maxPly, times=mult)
 *   - Run variable-sum greedy on remainder
 *   - Track plan with fewest rows; tie-break on fill rate
 */
function optimizedSolve(order, maxPly, totalRatio, timeLimitMs = 500) {
  const n        = order.length;
  const deadline = Date.now() + timeLimitMs;

  // ── variable-sum greedy baseline ──────────────────────────────────────────
  let bestEntries  = greedySolve(order, maxPly, totalRatio);
  let bestRows     = bestEntries.length;
  let bestFillRate = planFillRate(bestEntries, order);

  if (bestRows <= 1) return bestEntries;

  // ── adaptive slack ────────────────────────────────────────────────────────
  const slack = n <= 3 ? 5 : n <= 5 ? 4 : 3;

  // ── search over all ratio sums for the first marker ───────────────────────
  for (let s1 = totalRatio; s1 >= 1; s1--) {
    if (Date.now() > deadline) break;
    if (bestRows <= 2)          break;

    for (const r1 of genCandidatesForSum(order, s1, slack)) {
      if (Date.now() > deadline) break;
      if (bestRows <= 2)          break;

      const maxC1   = maxCuts(r1, order);
      const maxMult = Math.floor(maxC1 / maxPly);
      if (maxMult < 1) continue;

      // Collect valid multiples-of-maxPly (M1 always = 1 row)
      const validMults = [];
      for (let mult = 1; mult <= maxMult; mult++) {
        const rem = order.map((o, i) => o - r1[i] * mult * maxPly);
        if (!rem.some(r => r < 0)) validMults.push(mult);
      }
      if (validMults.length === 0) continue;

      // Sort: prefer mult whose remainder is most proportional to order
      const orderTotal = order.reduce((a, b) => a + b, 0);
      const orderFrac  = order.map(o => o / orderTotal);
      validMults.sort((a, b) => {
        const remA = order.map((o, i) => o - r1[i] * a * maxPly);
        const remB = order.map((o, i) => o - r1[i] * b * maxPly);
        const totA = remA.reduce((s, v) => s + v, 0) || 1;
        const totB = remB.reduce((s, v) => s + v, 0) || 1;
        const scoreA = Math.max(...remA.map((v, i) => Math.abs(v / totA - orderFrac[i])));
        const scoreB = Math.max(...remB.map((v, i) => Math.abs(v / totB - orderFrac[i])));
        return scoreA - scoreB;
      });

      for (const mult of validMults) {
        if (Date.now() > deadline) break;

        const c1   = mult * maxPly;
        const rem1 = order.map((o, i) => o - r1[i] * c1);

        const subEntries = greedySolve(rem1, maxPly, totalRatio);
        const totalRows  = 1 + subEntries.length;

        // compute fill rate for this candidate plan
        const running1 = new Array(n).fill(0);
        const prod1    = r1.map(r => r * c1);
        for (let i = 0; i < n; i++) running1[i] += prod1[i];

        // quick fill rate estimate
        const allProd = order.map((_, i) =>
          prod1[i] + subEntries.reduce((acc, e) => acc + e.produced[i], 0)
        );
        const fill = Math.min(...order.map((o, i) => o > 0 ? allProd[i] / o : 1));

        const better = totalRows < bestRows ||
          (totalRows === bestRows && fill > bestFillRate);

        if (better) {
          bestRows     = totalRows;
          bestFillRate = fill;

          const m1 = {
            id:       1,
            ratios:   [...r1],
            ratioSum: r1.reduce((a, b) => a + b, 0),
            ply:      maxPly,
            times:    mult,
            produced: [...prod1],
            running:  [...running1],
          };

          // rebuild sub entries with correct running totals and ids
          const subRebuilt = greedySolve(rem1, maxPly, totalRatio, 2, running1);
          bestEntries = [m1, ...subRebuilt];
        }

        if (bestRows <= 2) break;
      }
    }
  }

  // sequential id renumbering
  bestEntries.forEach((e, i) => { e.id = i + 1; });
  return bestEntries;
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Solve for the minimum marker rows to fulfill the order.
 * Now allows ratio sum < totalRatio when it produces fewer rows.
 *
 * Output shape is identical to before EXCEPT each row now also carries
 * `ratioSum` (the actual sum used, ≤ totalRatio).
 *
 * @param {{ name: string, qty: number }[]} sizes
 * @param {number} maxPly
 * @param {number} totalRatio   - MAXIMUM ratio sum per marker
 * @returns {{ rows, sizes, order, maxPly, totalRatio }}
 */
function solveMarkers(sizes, maxPly, totalRatio) {
  const sizeNames = sizes.map(s => s.name);
  const order     = sizes.map(s => s.qty);
  const entries   = optimizedSolve(order, maxPly, totalRatio, 500);
  return { rows: entries, sizes: sizeNames, order, maxPly, totalRatio };
}

window.solveMarkers = solveMarkers;
