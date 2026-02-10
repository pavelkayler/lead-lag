/**
 * Lead-Lag analytics (Step 7)
 * ---------------------------
 * Uses 250ms log returns (r) from microbars.
 *
 * computeLeadLagPairs:
 *  - For each ordered pair (A leads B), finds best positive Pearson corr between:
 *      rA[t] and rB[t+lag], lag=1..maxLagBars
 *  - Returns ranked list of pairs by corr.
 *
 * Also computes simple impulse response:
 *  - "impulses" are indices where |rA| >= impulseZ * std(rA)
 *  - followerMeanAfterImpulse = mean of rB at t+bestLag over impulse events.
 */

function mean(arr) {
  if (!arr.length) return 0;
  let s = 0;
  for (const x of arr) s += x;
  return s / arr.length;
}

function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let s2 = 0;
  for (const x of arr) {
    const d = x - m;
    s2 += d * d;
  }
  return Math.sqrt(s2 / (arr.length - 1));
}

function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 5) return null;

  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
  const mx = sx / n;
  const my = sy / n;

  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx;
    const b = y[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  if (!den) return null;
  return num / den;
}

function sliceAlignedForLag(leaderR, followerR, lag) {
  // corr(leader[t], follower[t+lag]) => align leader[0..N-lag-1] with follower[lag..N-1]
  const n = Math.min(leaderR.length, followerR.length);
  const m = n - lag;
  if (m < 10) return null;
  const x = new Array(m);
  const y = new Array(m);
  for (let i = 0; i < m; i++) {
    x[i] = leaderR[i];
    y[i] = followerR[i + lag];
  }
  return { x, y, samples: m };
}

export function computeLeadLagPairs({
  returnsBySymbol,
  barMs = 250,
  windowBars = 240,
  maxLagBars = 20,
  minBars = 120,
  impulseZ = 2.5,
  topK = 15,
  minCorr = 0.05,
  minSamples = 80,
  minImpulses = 3,
  minFollowerMove = 0.00005,
} = {}) {
  const symbols = Object.keys(returnsBySymbol || {}).filter(Boolean);
  const latest = {
    ts: Date.now(),
    barMs,
    windowBars,
    maxLagBars,
    minBars,
    impulseZ,
    pairs: [],
  };

  if (symbols.length < 2) return latest;

  // prepare trimmed arrays (same window length per symbol)
  const r = {};
  for (const s of symbols) {
    const arr = returnsBySymbol[s] || [];
    const trimmed = arr.length > windowBars ? arr.slice(arr.length - windowBars) : arr.slice();
    r[s] = trimmed;
  }

  const pairs = [];

  for (let i = 0; i < symbols.length; i++) {
    for (let j = 0; j < symbols.length; j++) {
      if (i === j) continue;
      const leader = symbols[i];
      const follower = symbols[j];

      const leaderR = r[leader] || [];
      const followerR = r[follower] || [];
      const n = Math.min(leaderR.length, followerR.length);
      if (n < minBars) continue;

      let best = { corr: null, lagBars: null, samples: null };
      for (let lag = 1; lag <= maxLagBars; lag++) {
        const aligned = sliceAlignedForLag(leaderR, followerR, lag);
        if (!aligned) continue;
        const c = pearson(aligned.x, aligned.y);
        if (c == null) continue;
        if (best.corr == null || c > best.corr) best = { corr: c, lagBars: lag, samples: aligned.samples };
      }

      if (best.corr == null || best.corr < minCorr) continue;
      if (!Number.isFinite(best.samples) || best.samples < minSamples) continue;

      // impulse response (simple): mean follower return at t+bestLag when leader has impulse
      const leaderStd = std(leaderR);
      let impulses = 0;
      let sumFollower = 0;

      if (leaderStd > 0) {
        const thr = impulseZ * leaderStd;
        const lag = best.lagBars;
        // use same alignment: impulse at t -> read follower at t+lag
        const m = Math.min(leaderR.length, followerR.length) - lag;
        for (let t = 0; t < m; t++) {
          if (Math.abs(leaderR[t]) >= thr) {
            impulses++;
            sumFollower += followerR[t + lag];
          }
        }
      }

      const followerMeanAfterImpulse = impulses ? (sumFollower / impulses) : null;

      let confirmScore = 0;
      if (best.samples >= minSamples) confirmScore += 1;
      if (impulses >= minImpulses) confirmScore += 1;
      if (Number.isFinite(followerMeanAfterImpulse) && Math.abs(followerMeanAfterImpulse) >= minFollowerMove) confirmScore += 1;
      const confirmLabel = confirmScore >= 3 ? "OK" : (confirmScore >= 2 ? "WEAK" : "NO_DATA");

      pairs.push({
        leader,
        follower,
        corr: best.corr,
        bestLagBars: best.lagBars,
        bestLagMs: best.lagBars * barMs,
        samples: best.samples,
        impulses,
        followerMeanAfterImpulse,
        confirmScore,
        confirmLabel,
      });
    }
  }

  pairs.sort((a, b) => (b.corr - a.corr));
  latest.pairs = pairs.slice(0, topK);
  return latest;
}
