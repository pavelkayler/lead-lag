import https from "https";
import http from "http";
import { URL } from "url";

export async function httpFetch(url, { method = "GET", headers = {}, body = null, timeoutMs = 10000 } = {}) {
  const u = new URL(url);
  const lib = u.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + (u.search || ""),
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const text = buf.toString("utf8");
          resolve({ status: res.statusCode || 0, headers: res.headers, text });
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("httpFetch timeout")));
    if (body) req.write(body);
    req.end();
  });
}
