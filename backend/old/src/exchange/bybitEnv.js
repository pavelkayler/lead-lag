/**
 * bybitEnv.js
 * Centralizes Bybit environment selection (mainnet/testnet/demo).
 *
 * - mainnet:  api.bybit.com + stream.bybit.com (public/private/trade)
 * - testnet:  api-testnet.bybit.com + stream-testnet.bybit.com (public/private/trade)
 * - demo:     api-demo.bybit.com + stream-demo.bybit.com (private only), public market data = mainnet
 *
 * Note: Bybit docs: demo WS Trade is not supported, so orders should use REST for demo.
 */

export function getBybitEnvName() {
  const raw = String(process.env.BYBIT_ENV || "demo").toLowerCase().trim();
  if (raw === "mainnet" || raw === "prod" || raw === "production") return "mainnet";
  if (raw === "demo") return "demo";
  return "testnet";
}

export function resolveBybitConfig() {
  const env = getBybitEnvName();

  const httpBaseUrlDefault =
    env === "mainnet" ? "https://api.bybit.com" :
    env === "demo"   ? "https://api-demo.bybit.com" :
                       "https://api-testnet.bybit.com";

  const wsPublicDefault =
    env === "mainnet" ? "wss://stream.bybit.com/v5/public/linear" :
    env === "demo"   ? "wss://stream.bybit.com/v5/public/linear" :
                       "wss://stream-testnet.bybit.com/v5/public/linear";

  const wsPrivateDefault =
    env === "mainnet" ? "wss://stream.bybit.com/v5/private" :
    env === "demo"   ? "wss://stream-demo.bybit.com/v5/private" :
                       "wss://stream-testnet.bybit.com/v5/private";

  const wsTradeDefault =
    env === "mainnet" ? "wss://stream.bybit.com/v5/trade" :
    env === "demo"   ? null :
                       "wss://stream-testnet.bybit.com/v5/trade";

  const httpBaseUrl = process.env.BYBIT_HTTP_URL || httpBaseUrlDefault;
  const wsPublicUrl = process.env.BYBIT_PUBLIC_WS_URL || wsPublicDefault;
  const wsPrivateUrl = process.env.BYBIT_PRIVATE_WS_URL || wsPrivateDefault;
  const wsTradeUrl = process.env.BYBIT_TRADE_WS_URL || wsTradeDefault;

  const tradeTransport = (env === "demo") ? "rest" : "ws";

  // Safety: block real mainnet unless explicitly allowed
  const allowMainnet = String(process.env.BYBIT_ALLOW_MAINNET || "0") === "1";
  if (env === "mainnet" && !allowMainnet) {
    // downgrade to testnet defaults (still allowing explicit override URLs if user sets them)
    return {
      env: "testnet",
      httpBaseUrl: process.env.BYBIT_HTTP_URL || "https://api-testnet.bybit.com",
      wsPublicUrl: process.env.BYBIT_PUBLIC_WS_URL || "wss://stream-testnet.bybit.com/v5/public/linear",
      wsPrivateUrl: process.env.BYBIT_PRIVATE_WS_URL || "wss://stream-testnet.bybit.com/v5/private",
      wsTradeUrl: process.env.BYBIT_TRADE_WS_URL || "wss://stream-testnet.bybit.com/v5/trade",
      tradeTransport: "ws",
      safety: { downgradedFromMainnet: true, allowMainnet },
    };
  }

  return {
    env,
    httpBaseUrl,
    wsPublicUrl,
    wsPrivateUrl,
    wsTradeUrl,
    tradeTransport,
    safety: { downgradedFromMainnet: false, allowMainnet },
  };
}
