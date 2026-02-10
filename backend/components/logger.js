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
