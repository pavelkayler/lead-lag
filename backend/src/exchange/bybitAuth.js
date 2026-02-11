import crypto from "crypto";

/**
 * Bybit WS auth helper (V5)
 * Signature prehash: "GET/realtime" + expires
 * args: [apiKey, expires, signature]
 *
 * Docs: https://bybit-exchange.github.io/docs/v5/ws/connect
 */
export function makeWsAuthArgs(apiKey, apiSecret, expiresMs) {
  const expires = Number(expiresMs);
  if (!apiKey || !apiSecret || !Number.isFinite(expires)) throw new Error("makeWsAuthArgs: bad inputs");
  const prehash = `GET/realtime${expires}`;
  const signature = crypto.createHmac("sha256", apiSecret).update(prehash).digest("hex");
  return [apiKey, expires, signature];
}

export function nowMs() {
  return Date.now();
}
