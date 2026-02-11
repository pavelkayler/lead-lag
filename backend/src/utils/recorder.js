import fs from "fs";
import path from "path";

/**
 * SessionRecorder (Step 16)
 * ------------------------
 * Records selected WS hub topics to JSONL and replays PRICE ticks back into FeedManager.
 * Purpose: reproduce sessions deterministically for paper/strategy debugging.
 *
 * JSONL format: one JSON object per line:
 *   { ts, topic, payload }
 *
 * Replay currently replays "price" events only (injects mid ticks into FeedManager).
 */
export class SessionRecorder {
  constructor({ dir = "recordings", feed = null, hub = null, logger = null } = {}) {
    this.dir = dir;
    this.feed = feed;
    this.hub = hub;
    this.logger = logger;

    this.recording = false;
    this.replaying = false;

    this.file = null;
    this.replayFile = null;

    this._stream = null;

    this._events = null;
    this._idx = 0;
    this._baseTs = null;
    this._startRealTs = null;
    this._timer = null;
    this.speed = 1;

    this._lastStatusTs = 0;

    try { fs.mkdirSync(this.dir, { recursive: true }); } catch {}
  }

  setFeed(feed) { this.feed = feed; }

  _safePath(name, fallback = "session.jsonl") {
    const base = path.basename(String(name || fallback));
    return path.join(this.dir, base);
  }

  list() {
    try {
      return fs.readdirSync(this.dir)
        .filter((f) => f.endsWith(".jsonl"))
        .sort();
    } catch {
      return [];
    }
  }

  onBroadcast(topic, payload) {
    if (!this.recording || !this._stream) return;

    // Keep files small: record only topics useful for replay/analysis.
    if (topic !== "price" && topic !== "leadlag" && topic !== "paper" && topic !== "tradeState" && topic !== "metrics") return;

    try {
      const line = JSON.stringify({ ts: Date.now(), topic, payload }) + "\n";
      this._stream.write(line);
    } catch {
      // ignore
    }
  }

  _broadcastStatus(extra = {}) {
    if (!this.hub) return;
    const now = Date.now();
    if (!extra.force && (now - this._lastStatusTs) < 300) return;
    this._lastStatusTs = now;

    this.hub.broadcast("record", {
      ts: now,
      recording: this.recording,
      replaying: this.replaying,
      file: this.file,
      replayFile: this.replayFile,
      speed: this.speed,
      idx: this._idx,
      total: this._events?.length || 0,
      ...extra,
    });
  }

  startRecord({ file = "session.jsonl" } = {}) {
    if (this.replaying) this.stopReplay();

    if (this.recording) return { ok: true, file: this.file, already: true };

    const p = this._safePath(file);
    this.file = path.basename(p);

    this._stream = fs.createWriteStream(p, { flags: "w" });
    this.recording = true;

    this.logger?.log("record_start", { file: this.file });
    this._broadcastStatus({ force: true });

    return { ok: true, file: this.file };
  }

  stopRecord() {
    if (!this.recording) return { ok: true, stopped: false };

    const file = this.file;

    this.recording = false;
    this.file = null;

    try { this._stream?.end(); } catch {}
    this._stream = null;

    this.logger?.log("record_stop", { file });
    this._broadcastStatus({ force: true });

    return { ok: true, file };
  }

  startReplay({ file, speed = 1 } = {}) {
    if (!file) throw new Error("replay: file required");
    if (this.recording) this.stopRecord();
    this.stopReplay();

    const p = this._safePath(file);
    if (!fs.existsSync(p)) throw new Error("replay: file not found");

    const raw = fs.readFileSync(p, "utf8");
    const events = [];

    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      let obj;
      try { obj = JSON.parse(s); } catch { continue; }
      if (obj?.topic !== "price") continue;

      const pl = obj?.payload || {};
      const ts = Number(pl.ts ?? obj.ts);
      const symbol = String(pl.symbol || "");
      const mid = Number(pl.mid);
      const exchTs = Number(pl.exchTs ?? NaN);

      if (!symbol) continue;
      if (!Number.isFinite(ts)) continue;
      if (!Number.isFinite(mid) || mid <= 0) continue;

      events.push({ ts, symbol, mid, exchTs: Number.isFinite(exchTs) ? exchTs : null });
    }

    if (!events.length) throw new Error("replay: no price events in file");

    events.sort((a, b) => a.ts - b.ts);

    this._events = events;
    this._idx = 0;
    this._baseTs = events[0].ts;
    this._startRealTs = Date.now();

    this.speed = Math.max(0.1, Number(speed) || 1);

    // Switch feed into replay mode: bar timer on, WS off.
    if (this.feed) {
      try { this.feed.stop(); } catch {}
      try { this.feed.start({ ws: false }); } catch {}
    }

    this.replayFile = path.basename(p);
    this.replaying = true;

    this._timer = setInterval(() => this._tick(), 20);
    this._timer.unref?.();

    this.logger?.log("replay_start", { file: this.replayFile, speed: this.speed, events: events.length });
    this._broadcastStatus({ force: true });

    return { ok: true, file: this.replayFile, speed: this.speed, events: events.length };
  }

  _tick() {
    if (!this.replaying || !this._events?.length) return;

    const now = Date.now();
    const elapsed = (now - this._startRealTs) * this.speed;

    while (this._idx < this._events.length) {
      const ev = this._events[this._idx];
      const due = (ev.ts - this._baseTs);
      if (due > elapsed) break;

      try {
        this.feed?.ingestMid(ev.symbol, ev.mid, ev.exchTs, now, { source: "replay" });
      } catch {
        // ignore
      }

      this._idx++;
    }

    if (this._idx >= this._events.length) {
      this.stopReplay({ done: true });
      return;
    }

    this._broadcastStatus();
  }

  stopReplay({ done = false } = {}) {
    if (!this.replaying) {
      if (this._timer) { try { clearInterval(this._timer); } catch {} }
      this._timer = null;
      return { ok: true, stopped: false };
    }

    const file = this.replayFile;
    const idx = this._idx;
    const total = this._events?.length || 0;

    this.replaying = false;
    this.replayFile = null;

    if (this._timer) { try { clearInterval(this._timer); } catch {} }
    this._timer = null;

    this._events = null;
    this._idx = 0;
    this._baseTs = null;
    this._startRealTs = null;

    this.logger?.log("replay_stop", { file, done, idx, total });
    this._broadcastStatus({ force: true, done, idx, total });

    return { ok: true, file, done, idx, total };
  }

  status() {
    return {
      recording: this.recording,
      replaying: this.replaying,
      file: this.file,
      replayFile: this.replayFile,
      speed: this.speed,
      idx: this._idx,
      total: this._events?.length || 0,
      recordings: this.list(),
    };
  }
}
