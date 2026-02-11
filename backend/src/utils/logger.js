import fs from "fs";
import path from "path";

export class JsonlLogger {
  constructor({ dir = process.env.LOG_DIR || "logs", maxBytes = Number(process.env.LOG_MAX_BYTES) || 50 * 1024 * 1024 } = {}) {
    this.dir = dir;
    this.maxBytes = maxBytes;
    this._stream = null;
    this._bytes = 0;
    this._filePath = null;

    fs.mkdirSync(this.dir, { recursive: true });
    this._openNewFile();
  }

  _stamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  _openNewFile() {
    const name = `bot-${this._stamp()}-${Math.random().toString(16).slice(2, 8)}.jsonl`;
    this._filePath = path.join(this.dir, name);
    this._stream = fs.createWriteStream(this._filePath, { flags: "a" });
    this._bytes = 0;
  }

  log(type, payload = {}) {
    const rec = { ts: Date.now(), type, ...payload };
    const line = JSON.stringify(rec) + "\n";

    if (this._bytes + Buffer.byteLength(line) > this.maxBytes) this.rotate();

    try {
      this._stream.write(line);
      this._bytes += Buffer.byteLength(line);
    } catch {}
  }

  rotate() {
    try { this._stream?.end(); } catch {}
    this._openNewFile();
  }

  close() {
    try { this._stream?.end(); } catch {}
    this._stream = null;
  }
}

export class DailyJsonlLogger {
  constructor({ dir = process.env.LOG_DIR || "logs", prefix = "events" } = {}) {
    this.dir = dir;
    this.prefix = prefix;
    this._stream = null;
    this._filePath = null;
    this._currentDay = "";
    fs.mkdirSync(this.dir, { recursive: true });
  }

  _dayStamp(ts = Date.now()) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  }

  _ensureStream(ts = Date.now()) {
    const day = this._dayStamp(ts);
    if (this._stream && this._currentDay === day) return;
    try { this._stream?.end(); } catch {}
    this._currentDay = day;
    this._filePath = path.join(this.dir, `${this.prefix}-${day}.jsonl`);
    this._stream = fs.createWriteStream(this._filePath, { flags: "a" });
  }

  log(type, payload = {}) {
    const ts = Date.now();
    this._ensureStream(ts);
    try {
      this._stream?.write(`${JSON.stringify({ ts, type, ...payload })}\n`);
    } catch {}
  }

  logRecord(record = {}) {
    const ts = Number(record?.ts) || Date.now();
    this._ensureStream(ts);
    try {
      this._stream?.write(`${JSON.stringify({ ...record, ts })}\n`);
    } catch {}
  }

  close() {
    try { this._stream?.end(); } catch {}
    this._stream = null;
  }
}

export function readLastJsonlLines(filePath, maxLines = 200) {
  const linesLimit = Math.max(1, Math.min(2000, Number(maxLines) || 200));
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean).slice(-linesLimit);
    return lines.map((line) => {
      try { return JSON.parse(line); } catch { return { raw: line }; }
    });
  } catch {
    return [];
  }
}

export function readLastJsonlLinesTail(filePath, maxLines = 200) {
  const linesLimit = Math.max(1, Math.min(2000, Number(maxLines) || 200));
  if (!filePath || !fs.existsSync(filePath)) return [];
  const fd = fs.openSync(filePath, "r");
  try {
    const stat = fs.fstatSync(fd);
    let pos = stat.size;
    const chunkSize = 64 * 1024;
    let collected = "";
    let lineCount = 0;
    while (pos > 0 && lineCount <= linesLimit + 2) {
      const readSize = Math.min(chunkSize, pos);
      pos -= readSize;
      const buf = Buffer.allocUnsafe(readSize);
      fs.readSync(fd, buf, 0, readSize, pos);
      collected = `${buf.toString("utf8")}${collected}`;
      lineCount = collected.split(/\r?\n/).length - 1;
    }
    const lines = collected.split(/\r?\n/).filter(Boolean).slice(-linesLimit);
    return lines.map((line) => {
      try { return JSON.parse(line); } catch { return { raw: line }; }
    });
  } catch {
    return [];
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}
