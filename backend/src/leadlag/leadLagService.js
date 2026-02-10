import { computeLeadLagPairs } from "./leadLag.js";

/**
 * LeadLagService (Step 7)
 * ----------------------
 * Process-wide periodic analyzer over FeedManager ring-buffers.
 * Emits:
 *   event:leadlag  (if clients subscribed)
 * RPC:
 *   server.js exposes getLeadLag from this.latest
 */
export class LeadLagService {
  /**
   * Convert internal computeLeadLagPairs() shape to a UI-stable payload.
   * Frontend consumes payload.top[] with fields:
   *   leader, follower, corr, lagMs, impulses, followerMeanAfterImpulse, samples
   */
  static toUi(res) {
    const pairs = Array.isArray(res?.pairs) ? res.pairs : [];
    const mapped = pairs.map((p) => {
      const [leaderBase = p?.leader || "", leaderSource = "BT"] = String(p?.leader || "").split("|");
      const [followerBase = p?.follower || "", followerSource = "BT"] = String(p?.follower || "").split("|");
      const leaderDisplay = `${leaderBase} (${leaderSource})`;
      const followerDisplay = `${followerBase} (${followerSource})`;
      return {
      leader: leaderDisplay,
      follower: followerDisplay,
      leaderBase,
      followerBase,
      leaderBaseSymbol: leaderBase,
      followerBaseSymbol: followerBase,
      leaderSource,
      followerSource,
      leaderDisplay,
      followerDisplay,
      corr: typeof p?.corr === "number" ? p.corr : null,
      lagMs: typeof p?.bestLagMs === "number" ? p.bestLagMs : (typeof p?.lagMs === "number" ? p.lagMs : null),
      lagBars: typeof p?.bestLagBars === "number" ? p.bestLagBars : null,
      impulses: typeof p?.impulses === "number" ? p.impulses : null,
      followerMeanAfterImpulse: typeof p?.followerMeanAfterImpulse === "number" ? p.followerMeanAfterImpulse : null,
      samples: typeof p?.samples === "number" ? p.samples : null,
      confirmScore: typeof p?.confirmScore === "number" ? p.confirmScore : null,
      confirmLabel: p?.confirmLabel || "NO_DATA",
      correlationLabel: "Корреляция",
    };
    });

    return {
      ts: typeof res?.ts === "number" ? res.ts : Date.now(),
      barMs: typeof res?.barMs === "number" ? res.barMs : null,
      windowBars: typeof res?.windowBars === "number" ? res.windowBars : null,
      maxLagBars: typeof res?.maxLagBars === "number" ? res.maxLagBars : null,
      minBars: typeof res?.minBars === "number" ? res.minBars : null,
      impulseZ: typeof res?.impulseZ === "number" ? res.impulseZ : null,
      pairs: mapped,
      top: mapped,
    };
  }

  constructor({ feed, hub, logger = null, intervalMs = 2000, windowBars = 240, maxLagBars = 20, minBars = 120 } = {}) {
    this.feed = feed;
    this.hub = hub;
    this.logger = logger;

    this.intervalMs = intervalMs;
    this.windowBars = windowBars;
    this.maxLagBars = maxLagBars;
    this.minBars = minBars;

    this.latest = { ts: null, pairs: [] };
    this._timer = null;
    this._lastLogTs = 0;
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick(), this.intervalMs);
    this._timer.unref?.();
  }

  stop() {
    if (!this._timer) return;
    clearInterval(this._timer);
    this._timer = null;
  }

  computeNow({ topK = 15, sources = ["BT", "BNB"] } = {}) {
    const allowedSources = new Set((Array.isArray(sources) ? sources : ["BT", "BNB"]).map((x) => String(x).toUpperCase()));
    const series = (Array.isArray(this.feed.listSeries?.()) ? this.feed.listSeries() : []).filter((x) => allowedSources.has(String(x?.source || "").toUpperCase()));
    const returnsBySymbol = {};

    for (const x of series) {
      const key = String(x?.key || "");
      if (!key) continue;
      const bars = this.feed.getBars(x.symbol, this.windowBars, x.source);
      const rs = [];
      for (const b of bars) {
        const v = Number(b?.r);
        if (Number.isFinite(v)) rs.push(v);
      }
      returnsBySymbol[key] = rs;
    }

    const res = computeLeadLagPairs({
      returnsBySymbol,
      barMs: this.feed.barMs || 250,
      windowBars: this.windowBars,
      maxLagBars: this.maxLagBars,
      minBars: this.minBars,
      topK,
    });

    this.latest = res;
    return res;
  }

  _tick() {
    // no point if feed not running
    if (!this.feed?.running) return;

    const res = this.computeNow({ topK: 15 });

    // broadcast to subscribed clients only
    this.hub?.broadcast?.("leadlag", LeadLagService.toUi(res));

    // log summary every ~10s
    const now = Date.now();
    if (this.logger && (now - this._lastLogTs) >= 10000) {
      this._lastLogTs = now;
      const top = (res.pairs || []).slice(0, 5).map((p) => ({
        leader: p.leader,
        follower: p.follower,
        corr: p.corr,
        lagMs: p.bestLagMs,
      }));
      this.logger.log("leadlag_top", { top, windowBars: res.windowBars, maxLagBars: res.maxLagBars });
    }
  }
}
