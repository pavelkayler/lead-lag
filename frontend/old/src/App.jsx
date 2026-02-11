import { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_WS_URL = "ws://localhost:8080";
const MAX_LOCAL_BARS = 480; // 120s @ 250ms

function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
}

function makeId(prefix = "req") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toNum(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fmtMs(v) {
  const n = toNum(v);
  if (n == null) return "-";
  if (n < 1) return `${n.toFixed(3)}ms`;
  if (n < 1000) return `${n.toFixed(1)}ms`;
  return `${(n / 1000).toFixed(2)}s`;
}

function pickWalletUSDT(walletMsg) {
  const msg = walletMsg?.payload ? walletMsg.payload : walletMsg;
  const coins =
      msg?.result?.list?.[0]?.coin ||
      msg?.result?.list?.[0]?.coins ||
      msg?.data?.[0]?.coin ||
      msg?.data?.coin ||
      [];
  const arr = Array.isArray(coins) ? coins : [];
  const usdt = arr.find((c) => String(c?.coin || c?.currency || "").toUpperCase() === "USDT");
  return usdt || null;
}

function normalizeOrderRow(o) {
  if (!o) return null;
  return {
    symbol: o.symbol,
    side: o.side,
    orderId: o.orderId || o.order_id || o.id,
    orderType: o.orderType || o.order_type,
    orderStatus: o.orderStatus || o.order_status,
    price: o.price,
    qty: o.qty,
    reduceOnly: o.reduceOnly,
    positionIdx: o.positionIdx ?? o.position_idx,
    createdTime: o.createdTime || o.created_time,
    updatedTime: o.updatedTime || o.updated_time,
  };
}

function normalizePosRow(p) {
  if (!p) return null;
  return {
    symbol: p.symbol,
    side: p.side,
    positionIdx: p.positionIdx ?? p.position_idx,
    size: p.size,
    avgPrice: p.avgPrice,
    liqPrice: p.liqPrice,
    markPrice: p.markPrice,
    unrealisedPnl: p.unrealisedPnl,
  };
}

function normalizeExecRow(e) {
  if (!e) return null;
  return {
    symbol: e.symbol,
    side: e.side,
    execId: e.execId || e.exec_id || e._localId,
    orderId: e.orderId || e.order_id,
    execPrice: e.execPrice,
    execQty: e.execQty,
    execTime: e.execTime || e.exec_time,
    fee: e.execFee || e.fee,
    positionIdx: e.positionIdx ?? e.position_idx,
  };
}


function drawLineChart(canvas, bars, { mode = "mid" } = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const DPR = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 900;
  const cssH = canvas.clientHeight || 240;

  canvas.width = Math.floor(cssW * DPR);
  canvas.height = Math.floor(cssH * DPR);

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  ctx.fillStyle = "#0f1115";
  ctx.fillRect(0, 0, cssW, cssH);

  const pad = 10;
  const W = cssW - pad * 2;
  const H = cssH - pad * 2;

  const series = (bars || []).map((b) =>
      mode === "r" ? (typeof b.r === "number" ? b.r : 0) : (typeof b.mid === "number" ? b.mid : 0)
  );

  if (series.length < 2) {
    ctx.fillStyle = "#aab2bf";
    ctx.font = "12px system-ui";
    ctx.fillText("No bars yet (subscribe bar + startFeed)", pad, pad + 14);
    return;
  }

  let minV = Infinity;
  let maxV = -Infinity;
  for (const v of series) {
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  if (minV === maxV) {
    minV -= 1;
    maxV += 1;
  }

  const xStep = W / (series.length - 1);
  const yOf = (v) => pad + (H - ((v - minV) / (maxV - minV)) * H);

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad + (H * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(pad + W, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(120,200,255,0.9)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pad, yOf(series[0]));
  for (let i = 1; i < series.length; i++) ctx.lineTo(pad + xStep * i, yOf(series[i]));
  ctx.stroke();

  ctx.fillStyle = "#aab2bf";
  ctx.font = "12px system-ui";
  const last = series[series.length - 1];
  const label = mode === "r" ? `r(last)=${last.toFixed(6)}` : `mid(last)=${last.toFixed(4)}`;
  ctx.fillText(label, pad, pad + 14);
}

const styles = {
  card: { border: "1px solid rgba(0,0,0,0.08)", borderRadius: 10, padding: 12, background: "#fff" },
  tableWrap: { border: "1px solid rgba(0,0,0,0.08)", borderRadius: 10, overflow: "hidden", background: "#fff" },
  thead: { background: "#111827" },
  th: { textAlign: "left", padding: 10, color: "#ffffff", fontWeight: 700, fontSize: 12, letterSpacing: 0.2 },
  td: { padding: 10 },
  tr: { borderTop: "1px solid rgba(0,0,0,0.06)" },
  btn: { padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)", background: "#ffffff", color: "#111827", cursor: "pointer" },
  btnPrimary: { padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)", background: "#111827", color: "#ffffff", cursor: "pointer" },
  input: { padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.18)", background: "#ffffff", color: "#111827", outline: "none" },
};

export default function App() {
  const wsRef = useRef(null);
  const pendingRef = useRef(new Map());
  const inboxQueueRef = useRef([]);
  const consumerTimerRef = useRef(null);

  const barsRef = useRef(new Map());
  const canvasRef = useRef(null);

  const [wsUrl, setWsUrl] = useState(DEFAULT_WS_URL);
  const [status, setStatus] = useState("disconnected");
  const [clientId, setClientId] = useState(null);

  const [prices, setPrices] = useState({});
  const [barsInfo, setBarsInfo] = useState({});
  const [metrics, setMetrics] = useState(null);

  const [symbolsInput, setSymbolsInput] = useState("BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,DOGEUSDT");
  const [selectedSymbol, setSelectedSymbol] = useState("BTCUSDT");
  const [chartMode, setChartMode] = useState("mid");
  const [chartBars, setChartBars] = useState([]);

  const [subs, setSubs] = useState({
    metrics: true,
    price: true,
    bar: true,
    leadlag: true,
    paper: true,
    "priv.order": false,
    "priv.execution": false,
    "priv.position": false,
    "priv.wallet": false,
    tradeState: true,
  });

  const [leadLag, setLeadLag] = useState(null);

  const [paper, setPaper] = useState(null);
  const [paperParams, setPaperParams] = useState({
    qtyUSDT: "25",
    minCorr: "0.15",
    impulseZ: "2.5",
    tpSigma: "1.5",
    slSigma: "1.0",
    maxHoldBars: "20",
    cooldownBars: "20",
  });



  const [demoAmountUSDT, setDemoAmountUSDT] = useState("1000");
  const [demoCoin, setDemoCoin] = useState("USDT");
  const [privMsgs, setPrivMsgs] = useState([]);
  const [tradeState, setTradeState] = useState(null);
  const [log, setLog] = useState([]);

  // Step 8: simple order form (gated by ENABLE_TRADING on server)
  const [orderSymbol, setOrderSymbol] = useState("BTCUSDT");
  const [orderSide, setOrderSide] = useState("Buy");
  const [orderType, setOrderType] = useState("Limit");
  const [orderQty, setOrderQty] = useState("0.001");
  const [orderPrice, setOrderPrice] = useState("0");

  // Step 14: bracket (market) order + risk actions
  const [brSymbol, setBrSymbol] = useState("BTCUSDT");
  const [brSide, setBrSide] = useState("Buy");
  const [brQtyUSDT, setBrQtyUSDT] = useState("25");
  const [brTpPct, setBrTpPct] = useState("0.6");
  const [brSlPct, setBrSlPct] = useState("0.4");
  const [brTriggerBy, setBrTriggerBy] = useState("MarkPrice");
  const [killReason, setKillReason] = useState("");


  function pushLog(line) {
    setLog((prev) => [line, ...prev].slice(0, 120));
  }

  function rpc(type, payload = null, timeoutMs = 2500) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("WS not connected"));

    const id = makeId(type);
    ws.send(JSON.stringify({ type, id, payload }));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRef.current.delete(id);
        reject(new Error(`RPC timeout: ${type}`));
      }, timeoutMs);
      pendingRef.current.set(id, { resolve, reject, timer });
    });
  }

  function processIncomingBatch(batch) {
    const priceUpdates = {};
    const barLastUpdates = {};
    const barAppend = [];

    for (const msg of batch) {
      if (msg?.type === "event") {
        if (msg.topic === "hello") {
          setClientId(msg.payload?.clientId ?? null);
          continue;
        }

        if (msg.topic === "price") {
          const { symbol, mid, t } = msg.payload || {};
          if (symbol) priceUpdates[symbol] = { mid, t: t ?? Date.now() };
          continue;
        }

        if (msg.topic === "bar") {
          const { symbol, mid, r, t } = msg.payload || {};
          if (symbol) {
            barLastUpdates[symbol] = { lastMid: mid, lastR: r, lastT: t ?? Date.now() };
            barAppend.push({ t: t ?? Date.now(), symbol, mid, r });
          }
          continue;
        }

        if (msg.topic === "metrics") {
          setMetrics(msg.payload || null);
          continue;
        }

        if (msg.topic === "leadlag") {
          setLeadLag(msg.payload || null);
          continue;
        }

        if (msg.topic === "paper") {
          setPaper(msg.payload || null);
          continue;
        }


        if (msg.topic === "tradeState") {
          setTradeState(msg.payload || null);
          continue;
        }

// Step 8 private streams: priv.order / priv.execution / priv.position / priv.wallet
        if (typeof msg.topic === "string" && msg.topic.startsWith("priv.")) {
          setPrivMsgs((prev) => {
            const next = [{ t: Date.now(), topic: msg.topic, payload: msg.payload }, ...prev];
            return next.slice(0, 30);
          });
          continue;
        }

        continue;
      }

      if (msg?.type === "response" && typeof msg.id === "string") {
        const pending = pendingRef.current.get(msg.id);
        if (!pending) continue;
        clearTimeout(pending.timer);
        pendingRef.current.delete(msg.id);
        if (msg.ok) pending.resolve(msg.payload);
        else pending.reject(new Error(msg.error || "RPC error"));
      }
    }

    const pKeys = Object.keys(priceUpdates);
    if (pKeys.length) setPrices((prev) => ({ ...prev, ...priceUpdates }));

    const bKeys = Object.keys(barLastUpdates);
    if (bKeys.length) {
      setBarsInfo((prev) => {
        const next = { ...prev };
        for (const k of bKeys) {
          const prevCount = next[k]?.count || 0;
          next[k] = { ...(next[k] || {}), ...barLastUpdates[k], count: prevCount + 1 };
        }
        return next;
      });
    }

    if (barAppend.length) {
      let selectedTouched = false;
      let selectedNext = null;

      for (const bar of barAppend) {
        const sym = bar.symbol;
        const prevArr = barsRef.current.get(sym) || [];
        const nextArr =
            prevArr.length >= MAX_LOCAL_BARS ? prevArr.slice(prevArr.length - (MAX_LOCAL_BARS - 1)) : prevArr.slice();
        nextArr.push(bar);
        barsRef.current.set(sym, nextArr);

        if (sym === selectedSymbol) {
          selectedTouched = true;
          selectedNext = nextArr;
        }
      }
      if (selectedTouched && selectedNext) setChartBars(selectedNext);
    }
  }

  function startConsumerLoop() {
    if (consumerTimerRef.current) return;
    consumerTimerRef.current = setInterval(() => {
      const q = inboxQueueRef.current;
      if (!q.length) return;
      const batch = q.splice(0, 250);
      processIncomingBatch(batch);
    }, 50);
  }

  function stopConsumerLoop() {
    if (consumerTimerRef.current) {
      clearInterval(consumerTimerRef.current);
      consumerTimerRef.current = null;
    }
  }

  function connect() {
    disconnect();
    setStatus("connecting");

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    startConsumerLoop();

    ws.onopen = async () => {
      setStatus("connected");
      pushLog("WS open");

      for (const t of Object.keys(subs)) {
        if (!subs[t]) continue;
        try {
          await rpc("subscribe", { topic: t }, 1500);
        } catch {}
      }
      // initial snapshot
      if (subs.paper) {
        try { await rpc("paperState", null, 2000); } catch {}
      }

    };

    ws.onmessage = (evt) => {
      const parsed = safeJsonParse(evt.data);
      if (!parsed.ok) return;
      inboxQueueRef.current.push(parsed.value);
      const MAX_QUEUE = 5000;
      if (inboxQueueRef.current.length > MAX_QUEUE) {
        inboxQueueRef.current.splice(0, inboxQueueRef.current.length - MAX_QUEUE);
      }
    };

    ws.onerror = () => pushLog("WS error");
    ws.onclose = () => {
      setStatus("disconnected");
      pushLog("WS close");
      for (const [id, p] of pendingRef.current.entries()) {
        clearTimeout(p.timer);
        p.reject(new Error("WS closed"));
        pendingRef.current.delete(id);
      }
    };
  }

  function disconnect() {
    const ws = wsRef.current;
    if (ws) {
      try {
        ws.close();
      } catch {}
    }
    wsRef.current = null;
    setStatus("disconnected");
  }

  useEffect(() => {
    connect();
    return () => {
      stopConsumerLoop();
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    drawLineChart(canvasRef.current, chartBars, { mode: chartMode });
  }, [chartBars, chartMode]);

  useEffect(() => {
    const cached = barsRef.current.get(selectedSymbol) || [];
    setChartBars(cached);
    if (status !== "connected") return;

    (async () => {
      try {
        const res = await rpc("getBars", { symbol: selectedSymbol, n: 240 }, 2000);
        const bars = Array.isArray(res?.bars) ? res.bars : [];
        barsRef.current.set(selectedSymbol, bars);
        setChartBars(bars);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSymbol, status]);

  async function toggleSub(topic, on) {
    try {
      await rpc(on ? "subscribe" : "unsubscribe", { topic }, 1500);
      setSubs((p) => ({ ...p, [topic]: on }));
    } catch (e) {
      pushLog(`${on ? "SUB" : "UNSUB"} FAIL ${topic}: ${e.message}`);
    }
  }

  async function setSymbols() {
    const symbols = (symbolsInput || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 5);
    if (!symbols.length) return;
    try {
      await rpc("setSymbols", { symbols }, 2000);
      if (!symbols.includes(selectedSymbol)) setSelectedSymbol(symbols[0]);
    } catch (e) {
      pushLog(`setSymbols FAIL: ${e.message}`);
    }
  }

  async function startFeed() {
    try {
      await rpc("startFeed", null, 1500);
    } catch (e) {
      pushLog(`startFeed FAIL: ${e.message}`);
    }
  }

  async function stopFeed() {
    try {
      await rpc("stopFeed", null, 1500);
    } catch (e) {
      pushLog(`stopFeed FAIL: ${e.message}`);
    }
  }

  async function refreshLeadLag() {
    try {
      const res = await rpc("getLeadLag", { fresh: true, topK: 15 }, 4000);
      setLeadLag(res);
    } catch (e) {
      pushLog(`getLeadLag FAIL: ${e.message}`);
    }
  }

  // Step 9: paper controls
  async function paperStart() {
    try {
      const payload = {
        qtyUSDT: Number(paperParams.qtyUSDT),
        minCorr: Number(paperParams.minCorr),
        impulseZ: Number(paperParams.impulseZ),
        tpSigma: Number(paperParams.tpSigma),
        slSigma: Number(paperParams.slSigma),
        maxHoldBars: Number(paperParams.maxHoldBars),
        cooldownBars: Number(paperParams.cooldownBars),
      };
      const res = await rpc("paperStart", payload, 4000);
      setPaper({ ts: Date.now(), params: res?.params, state: res?.state });
      pushLog("paperStart: ok");
    } catch (e) {
      pushLog(`paperStart FAIL: ${e.message}`);
    }
  }

  async function paperStop() {
    try {
      const res = await rpc("paperStop", null, 2500);
      setPaper({ ts: Date.now(), params: res?.params, state: res?.state });
      pushLog("paperStop: ok");
    } catch (e) {
      pushLog(`paperStop FAIL: ${e.message}`);
    }
  }

  async function paperReset() {
    try {
      const res = await rpc("paperReset", null, 2500);
      setPaper({ ts: Date.now(), params: res?.params, state: res?.state });
      pushLog("paperReset: ok");
    } catch (e) {
      pushLog(`paperReset FAIL: ${e.message}`);
    }
  }



  // Step 12: demo funds (Bybit demo trading)
  async function demoApplyMoney() {
    try {
      const items = [{ coin: demoCoin, amountStr: String(demoAmountUSDT || "0") }];
      const res = await rpc("demoApplyMoney", { items, adjustType: 0 }, 10000);
      pushLog(`demoApplyMoney: ok retCode=${res?.retCode ?? "?"}`);
    } catch (e) {
      pushLog(`demoApplyMoney FAIL: ${e.message}`);
    }
  }

  async function paperState() {
    try {
      const res = await rpc("paperState", null, 2500);
      setPaper({ ts: Date.now(), params: res?.params, state: res?.state });
    } catch {}
  }



  // Step 8 controls
  async function connectPrivate() {
    try {
      const res = await rpc("connectPrivate", null, 6000);
      pushLog(`connectPrivate: authed=${res?.authed ? "yes" : "no"}`);
    } catch (e) {
      pushLog(`connectPrivate FAIL: ${e.message}`);
    }
  }
  async function disconnectPrivate() {
    try {
      await rpc("disconnectPrivate", null, 2500);
      pushLog("disconnectPrivate: ok");
    } catch (e) {
      pushLog(`disconnectPrivate FAIL: ${e.message}`);
    }
  }
  async function connectTrade() {
    try {
      const res = await rpc("connectTrade", null, 6000);
      pushLog(`connectTrade: authed=${res?.authed ? "yes" : "no"}`);
    } catch (e) {
      pushLog(`connectTrade FAIL: ${e.message}`);
    }
  }
  async function disconnectTrade() {
    try {
      await rpc("disconnectTrade", null, 2500);
      pushLog("disconnectTrade: ok");
    } catch (e) {
      pushLog(`disconnectTrade FAIL: ${e.message}`);
    }
  }

  async function placeOrder() {
    try {
      const payload = {
        symbol: orderSymbol,
        side: orderSide,
        orderType: orderType,
        qty: orderQty,
        price: orderType === "Limit" ? orderPrice : undefined,
        timeInForce: orderType === "Limit" ? "GTC" : undefined,
      };
      const res = await rpc("placeOrder", payload, 6000);
      pushLog(`order.create OK reqId=${res?.reqId || "-"} orderId=${res?.data?.orderId || "-"}`);
    } catch (e) {
      pushLog(`order.create FAIL: ${e.message}`);
    }
  }

  async function placeBracket() {
    try {
      const payload = {
        symbol: brSymbol,
        side: brSide,
        qtyUSDT: brQtyUSDT,
        tpPct: brTpPct,
        slPct: brSlPct,
        triggerBy: brTriggerBy,
      };
      const res = await rpc("placeBracket", payload, 8000);
      const oid = res?.data?.orderId || res?.data?.result?.orderId || res?.data?.result?.order_id || "-";
      pushLog(`placeBracket OK orderId=${oid}`);
    } catch (e) {
      pushLog(`placeBracket FAIL: ${e.message}`);
    }
  }

  async function cancelAll(symbol = null) {
    try {
      const res = await rpc("cancelAll", symbol ? { symbol } : {}, 8000);
      pushLog(`cancelAll OK retCode=${res?.data?.retCode ?? "?"}`);
    } catch (e) {
      pushLog(`cancelAll FAIL: ${e.message}`);
    }
  }

  async function closeAll(symbol = null) {
    try {
      const res = await rpc("closeAll", symbol ? { symbol } : {}, 15000);
      const ok = res?.data?.results?.filter?.((x) => x.ok)?.length ?? 0;
      const n = res?.data?.results?.length ?? 0;
      pushLog(`closeAll OK closed=${ok}/${n}`);
    } catch (e) {
      pushLog(`closeAll FAIL: ${e.message}`);
    }
  }

  async function killSwitch(on) {
    try {
      const res = await rpc("killSwitch", { on, reason: killReason }, 8000);
      pushLog(`killSwitch OK haltTrading=${res?.data?.haltTrading}`);
    } catch (e) {
      pushLog(`killSwitch FAIL: ${e.message}`);
    }
  }

}

const knownSymbols = useMemo(() => {
  const set = new Set([
    ...Object.keys(prices || {}),
    ...Object.keys(barsInfo || {}),
    ...(symbolsInput || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
  ]);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}, [prices, barsInfo, symbolsInput]);

useEffect(() => {
  if (knownSymbols.includes(orderSymbol)) return;
  if (knownSymbols.length) setOrderSymbol(knownSymbols[0]);
}, [knownSymbols, orderSymbol]);


useEffect(() => {
  if (knownSymbols.includes(brSymbol)) return;
  if (knownSymbols.length) setBrSymbol(knownSymbols[0]);
}, [knownSymbols, brSymbol]);


const priceRows = useMemo(() => {
  return Object.entries(prices || {})
      .map(([symbol, v]) => ({ symbol, mid: v?.mid, t: v?.t }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
}, [prices]);

const feedStats = metrics?.feedStats || null;
const hubStats = metrics?.hubStats || null;
const privStats = metrics?.privateWs || null;
const tradeStats = metrics?.tradeWs || null;
const risk = metrics?.risk || null;

return (
    <div style={{ padding: 16, fontFamily: "system-ui", width: "100%", maxWidth: "none", background: "#ffffff", color: "#111827", minHeight: "100vh", colorScheme: "light" }}>
      <style>{`
                /* Layout stability (avoid width jump due to scrollbar) */
        html, body, #root { width: 100%; height: 100%; }
        body { margin: 0; overflow-y: scroll; background: #ffffff; }
        * { box-sizing: border-box; }
        /* If supported: reserve scrollbar gutter */
        :root { scrollbar-gutter: stable; }
        /* Force readable form controls even if global CSS/theme sets dark inputs */
        input, select, textarea {
          background: #ffffff !important;
          color: #111827 !important;
        }
        ::placeholder { color: rgba(17,24,39,0.55) !important; }
      `}</style>

      <h2 style={{ margin: 0, color: "#111" }}>Step 8 UI: Lead–Lag + Private/Trade WS skeleton</h2>

      <div style={{ marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          Status: <b>{status}</b>
        </div>
        <div>
          ClientId: <b>{clientId ?? "-"}</b>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          WS URL
          <input value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} style={{ ...styles.input, width: 260 }} />
        </label>
        <button style={styles.btnPrimary} onClick={connect} disabled={status === "connected" || status === "connecting"}>
          Connect
        </button>
        <button style={styles.btn} onClick={disconnect} disabled={status !== "connected"}>
          Disconnect
        </button>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Symbols (≤5)
          <input
              value={symbolsInput}
              onChange={(e) => setSymbolsInput(e.target.value)}
              style={{ ...styles.input, width: 420 }}
          />
        </label>
        <button style={styles.btn} onClick={setSymbols} disabled={status !== "connected"}>
          setSymbols
        </button>
        <button style={styles.btn} onClick={startFeed} disabled={status !== "connected"}>
          startFeed
        </button>
        <button style={styles.btn} onClick={stopFeed} disabled={status !== "connected"}>
          stopFeed
        </button>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontWeight: 700 }}>Subscriptions:</div>
        {Object.keys(subs).map((topic) => (
            <label key={topic} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                  type="checkbox"
                  checked={!!subs[topic]}
                  onChange={(e) => toggleSub(topic, e.target.checked)}
                  disabled={status !== "connected"}
              />
              {topic}
            </label>
        ))}
        <button style={styles.btn} onClick={refreshLeadLag} disabled={status !== "connected"}>
          getLeadLag (fresh)
        </button>
      </div>

      <h3 style={{ marginTop: 18, marginBottom: 8, color: "#111" }}>Lead–Lag Top</h3>
      <div style={styles.tableWrap}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={styles.thead}>
          <tr>
            <th style={styles.th}>Leader</th>
            <th style={styles.th}>Follower</th>
            <th style={styles.th}>corr</th>
            <th style={styles.th}>lag</th>
            <th style={styles.th}>impulses</th>
            <th style={styles.th}>mean follower r @ lag</th>
            <th style={styles.th}>samples</th>
          </tr>
          </thead>
          <tbody>
          {(leadLag?.pairs || []).length ? (
              leadLag.pairs.map((p, idx) => (
                  <tr key={`${p.leader}-${p.follower}-${idx}`} style={styles.tr}>
                    <td style={{ ...styles.td, fontWeight: 800 }}>{p.leader}</td>
                    <td style={{ ...styles.td, fontWeight: 700 }}>{p.follower}</td>
                    <td style={styles.td}>{toNum(p.corr)?.toFixed(3) ?? "-"}</td>
                    <td style={styles.td}>
                      {p.bestLagBars} bars ({fmtMs(p.bestLagMs)})
                    </td>
                    <td style={styles.td}>{p.impulses ?? "-"}</td>
                    <td style={styles.td}>{toNum(p.followerMeanAfterImpulse)?.toFixed(6) ?? "-"}</td>
                    <td style={styles.td}>{p.samples ?? "-"}</td>
                  </tr>
              ))
          ) : (
              <tr>
                <td colSpan={7} style={{ padding: 10, opacity: 0.7 }}>
                  No leadlag yet: subscribe <b>leadlag</b> + startFeed and wait ~30–60s
                </td>
              </tr>
          )}
          </tbody>
        </table>
      </div>


      <h3 style={{ marginTop: 18, marginBottom: 8, color: "#111" }}>Paper trading (Step 9)</h3>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={styles.card}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Controls</div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              qtyUSDT
              <input value={paperParams.qtyUSDT} onChange={(e) => setPaperParams((p) => ({ ...p, qtyUSDT: e.target.value }))} style={{ ...styles.input, width: 90 }} />
            </label>

            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              minCorr
              <input value={paperParams.minCorr} onChange={(e) => setPaperParams((p) => ({ ...p, minCorr: e.target.value }))} style={{ ...styles.input, width: 90 }} />
            </label>

            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              impulseZ
              <input value={paperParams.impulseZ} onChange={(e) => setPaperParams((p) => ({ ...p, impulseZ: e.target.value }))} style={{ ...styles.input, width: 90 }} />
            </label>

            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              tpSigma
              <input value={paperParams.tpSigma} onChange={(e) => setPaperParams((p) => ({ ...p, tpSigma: e.target.value }))} style={{ ...styles.input, width: 90 }} />
            </label>

            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              slSigma
              <input value={paperParams.slSigma} onChange={(e) => setPaperParams((p) => ({ ...p, slSigma: e.target.value }))} style={{ ...styles.input, width: 90 }} />
            </label>

            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              holdBars
              <input value={paperParams.maxHoldBars} onChange={(e) => setPaperParams((p) => ({ ...p, maxHoldBars: e.target.value }))} style={{ ...styles.input, width: 90 }} />
            </label>

            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              cooldown
              <input value={paperParams.cooldownBars} onChange={(e) => setPaperParams((p) => ({ ...p, cooldownBars: e.target.value }))} style={{ ...styles.input, width: 90 }} />
            </label>
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={styles.btnPrimary} onClick={paperStart} disabled={status !== "connected"}>
              paperStart
            </button>
            <button style={styles.btn} onClick={paperStop} disabled={status !== "connected"}>
              paperStop
            </button>
            <button style={styles.btn} onClick={paperReset} disabled={status !== "connected"}>
              paperReset
            </button>
          </div>

          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9 }}>
            Subscribe <b>paper</b> to see live updates. Feed must be running.
          </div>
        </div>

        <div style={styles.card}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>State</div>
          <div>
            enabled: <b>{paper?.params?.enabled ? "yes" : "no"}</b> / open: <b>{paper?.state?.position ? "yes" : "no"}</b>
          </div>
          <div>
            cash: <b>{toNum(paper?.state?.cashUSDT)?.toFixed(2) ?? "-"}</b> / equity: <b>{toNum(paper?.state?.equityUSDT)?.toFixed(2) ?? "-"}</b>
          </div>
          <div>
            trades: <b>{paper?.state?.stats?.trades ?? "-"}</b> / pnl: <b>{toNum(paper?.state?.stats?.pnlUSDT)?.toFixed(2) ?? "-"}</b> / W/L:{" "}
            <b>
              {paper?.state?.stats?.wins ?? "-"} / {paper?.state?.stats?.losses ?? "-"}
            </b>
          </div>

          <div style={{ marginTop: 10, fontWeight: 700 }}>Open position</div>
          <pre style={{ marginTop: 6, maxHeight: 140, overflow: "auto", background: "#0b0d10", color: "#e5e7eb", padding: 10, borderRadius: 10, whiteSpace: "pre-wrap" }}>
            {paper?.state?.position ? JSON.stringify(paper.state.position, null, 2) : "—"}
          </pre>
        </div>
      </div>

      <div style={{ marginTop: 12, ...styles.tableWrap }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={styles.thead}>
          <tr>
            <th style={styles.th}>ts</th>
            <th style={styles.th}>symbol</th>
            <th style={styles.th}>side</th>
            <th style={styles.th}>entry</th>
            <th style={styles.th}>exit</th>
            <th style={styles.th}>qtyUSDT</th>
            <th style={styles.th}>pnlUSDT</th>
            <th style={styles.th}>reason</th>
            <th style={styles.th}>holdBars</th>
          </tr>
          </thead>
          <tbody>
          {(paper?.state?.trades || []).length ? (
              paper.state.trades.map((t, idx) => (
                  <tr key={idx} style={styles.tr}>
                    <td style={styles.td}>{t.ts ? new Date(t.ts).toLocaleTimeString() : "-"}</td>
                    <td style={{ ...styles.td, fontWeight: 700 }}>{t.symbol}</td>
                    <td style={styles.td}>{t.side}</td>
                    <td style={styles.td}>{toNum(t.entryMid)?.toFixed(6) ?? "-"}</td>
                    <td style={styles.td}>{toNum(t.exitMid)?.toFixed(6) ?? "-"}</td>
                    <td style={styles.td}>{toNum(t.qtyUSDT)?.toFixed(2) ?? "-"}</td>
                    <td style={{ ...styles.td, fontWeight: 700 }}>{toNum(t.pnlUSDT)?.toFixed(2) ?? "-"}</td>
                    <td style={styles.td}>{t.reason}</td>
                    <td style={styles.td}>{t.holdBars ?? "-"}</td>
                  </tr>
              ))
          ) : (
              <tr>
                <td colSpan={9} style={{ padding: 10, opacity: 0.7 }}>
                  No paper trades yet. Start feed + wait for lead-lag + paperStart.
                </td>
              </tr>
          )}
          </tbody>
        </table>
      </div>


      <h3 style={{ marginTop: 18, marginBottom: 8, color: "#111" }}>Latency / Backpressure</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={styles.card}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Feed</div>
          <div>
            WS up: <b>{feedStats?.wsUp ? "yes" : "no"}</b>
          </div>
          <div>
            Last WS msg age: <b>{fmtMs(feedStats?.lastWsMsgAgeMs)}</b>
          </div>
          <div>
            Reconnects: <b>{feedStats?.reconnects ?? "-"}</b>
          </div>

          <div style={{ marginTop: 10, fontWeight: 700 }}>Bar latency (bar_emit - last_tick_recv)</div>
          <div>
            p50: <b>{fmtMs(feedStats?.barLatency?.p50)}</b> / p90: <b>{fmtMs(feedStats?.barLatency?.p90)}</b> / p99:{" "}
            <b>{fmtMs(feedStats?.barLatency?.p99)}</b>
          </div>

          <div style={{ marginTop: 10, fontWeight: 700 }}>WS delay (tick_recv - exch_ts)</div>
          <div>
            p50: <b>{fmtMs(feedStats?.wsDelay?.p50)}</b> / p90: <b>{fmtMs(feedStats?.wsDelay?.p90)}</b> / p99:{" "}
            <b>{fmtMs(feedStats?.wsDelay?.p99)}</b>
          </div>
        </div>

        <div style={styles.card}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>WS Hub</div>
          <div>
            Clients: <b>{hubStats?.clients ?? "-"}</b>
          </div>
          <div>
            Sent events: <b>{hubStats?.sent ?? "-"}</b>
          </div>
          <div>
            Dropped (backpressure): <b>{hubStats?.dropped_backpressure ?? "-"}</b>
          </div>
        </div>
      </div>

      <h3 style={{ marginTop: 18, marginBottom: 8, color: "#111" }}>Step 8: Private / Trade WS</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={styles.card}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Private stream</div>
          <div>
            connected: <b>{privStats?.connected ? "yes" : "no"}</b> / authed: <b>{privStats?.authed ? "yes" : "no"}</b>
          </div>
          <div>
            last msg age: <b>{fmtMs(privStats?.lastMsgAgeMs)}</b> / reconnects: <b>{privStats?.reconnects ?? "-"}</b>
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={styles.btnPrimary} onClick={connectPrivate} disabled={status !== "connected"}>
              connectPrivate
            </button>
            <button style={styles.btn} onClick={disconnectPrivate} disabled={status !== "connected"}>
              disconnectPrivate
            </button>
          </div>
        </div>

        <div style={styles.card}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Trade stream</div>
          <div>
            connected: <b>{tradeStats?.connected ? "yes" : "no"}</b> / authed: <b>{tradeStats?.authed ? "yes" : "no"}</b>
          </div>
          <div>
            last msg age: <b>{fmtMs(tradeStats?.lastMsgAgeMs)}</b> / reconnects: <b>{tradeStats?.reconnects ?? "-"}</b>
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={styles.btnPrimary} onClick={connectTrade} disabled={status !== "connected" || metrics?.env?.tradeTransport !== "ws"}>
              connectTrade
            </button>
            <button style={styles.btn} onClick={disconnectTrade} disabled={status !== "connected"}>
              disconnectTrade
            </button>
          </div>
        </div>
      </div>


      <div style={{ marginTop: 12, ...styles.card }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Demo funds (apply)</div>
        <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 10 }}>
          Requires DEMO API key/secret. Public market data does not need a key.
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            coin
            <input value={demoCoin} onChange={(e) => setDemoCoin(e.target.value)} style={{ ...styles.input, width: 80 }} />
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            amount
            <input value={demoAmountUSDT} onChange={(e) => setDemoAmountUSDT(e.target.value)} style={{ ...styles.input, width: 120 }} />
          </label>

          <button style={styles.btnPrimary} onClick={demoApplyMoney} disabled={status !== "connected"}>
            demoApplyMoney
          </button>
        </div>
      </div>

      <h3 style={{ marginTop: 18, marginBottom: 8, color: "#111" }}>Trade State (snapshot)</h3>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <button
            style={styles.btn}
            onClick={async () => {
              try {
                const r = await rpc("getTradeState", { maxOrders: 50, maxExecutions: 30 }, 6000);
                pushLog(`getTradeState OK: orders=${r?.orders?.length ?? "-"} pos=${r?.positions?.length ?? "-"}`);
                setTradeState(r || null);
              } catch (e) {
                pushLog(`getTradeState FAIL: ${e.message}`);
              }
            }}
            disabled={status !== "connected"}
        >
          getTradeState
        </button>

        <button
            style={styles.btn}
            onClick={async () => {
              try {
                const r = await rpc("reconcileTradeState", null, 9000);
                pushLog(`reconcileTradeState OK: ${JSON.stringify(r?.summary || {})}`);
              } catch (e) {
                pushLog(`reconcileTradeState FAIL: ${e.message}`);
              }
            }}
            disabled={status !== "connected"}
        >
          reconcileTradeState
        </button>

        <div style={{ fontSize: 12, color: "#374151" }}>
          {tradeState?.summary ? (
              <>
                orders: <b>{tradeState.summary.orders}</b> · positions: <b>{tradeState.summary.positions}</b> · executions: <b>{tradeState.summary.executions}</b>
              </>
          ) : (
              <>no tradeState yet (subscribe tradeState + connectPrivate)</>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={styles.card}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Wallet (USDT)</div>
          {(() => {
            const usdt = pickWalletUSDT(tradeState?.wallet);
            if (!usdt) return <div style={{ color: "#6B7280", fontSize: 12 }}>no wallet data</div>;
            return (
                <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                  <div>equity: <b>{usdt.equity ?? usdt.walletBalance ?? "-"}</b></div>
                  <div>available: <b>{usdt.availableToWithdraw ?? usdt.availableBalance ?? "-"}</b></div>
                  <div>upl: <b>{usdt.unrealisedPnl ?? "-"}</b></div>
                </div>
            );
          })()}
        </div>

        <div style={styles.card}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>UpdatedAt</div>
          <div style={{ fontSize: 12, lineHeight: 1.6, color: "#374151" }}>
            <div>wallet: <b>{fmtMs(tradeState?.summary?.updatedAt?.wallet ? (Date.now() - tradeState.summary.updatedAt.wallet) : null)}</b></div>
            <div>order: <b>{fmtMs(tradeState?.summary?.updatedAt?.order ? (Date.now() - tradeState.summary.updatedAt.order) : null)}</b></div>
            <div>execution: <b>{fmtMs(tradeState?.summary?.updatedAt?.execution ? (Date.now() - tradeState.summary.updatedAt.execution) : null)}</b></div>
            <div>position: <b>{fmtMs(tradeState?.summary?.updatedAt?.position ? (Date.now() - tradeState.summary.updatedAt.position) : null)}</b></div>
            <div>reconcile: <b>{fmtMs(tradeState?.summary?.updatedAt?.reconcile ? (Date.now() - tradeState.summary.updatedAt.reconcile) : null)}</b></div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginTop: 12 }}>
        <div style={styles.tableWrap}>
          <div style={{ padding: 10, fontWeight: 800 }}>Positions</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={styles.thead}>
            <tr>
              <th style={styles.th}>symbol</th>
              <th style={styles.th}>side</th>
              <th style={styles.th}>posIdx</th>
              <th style={styles.th}>size</th>
              <th style={styles.th}>avg</th>
              <th style={styles.th}>liq</th>
              <th style={styles.th}>mark</th>
              <th style={styles.th}>uPnL</th>
            </tr>
            </thead>
            <tbody>
            {(Array.isArray(tradeState?.positions) ? tradeState.positions : []).map((p, i) => {
              const r = normalizePosRow(p);
              if (!r) return null;
              return (
                  <tr key={i} style={styles.tr}>
                    <td style={styles.td}><b>{r.symbol}</b></td>
                    <td style={styles.td}>{r.side ?? "-"}</td>
                    <td style={styles.td}>{r.positionIdx ?? "-"}</td>
                    <td style={styles.td}>{r.size ?? "-"}</td>
                    <td style={styles.td}>{r.avgPrice ?? "-"}</td>
                    <td style={styles.td}>{r.liqPrice ?? "-"}</td>
                    <td style={styles.td}>{r.markPrice ?? "-"}</td>
                    <td style={styles.td}>{r.unrealisedPnl ?? "-"}</td>
                  </tr>
              );
            })}
            {!tradeState?.positions?.length && (
                <tr style={styles.tr}><td style={styles.td} colSpan={8}><span style={{ color: "#6B7280" }}>no positions</span></td></tr>
            )}
            </tbody>
          </table>
        </div>

        <div style={styles.tableWrap}>
          <div style={{ padding: 10, fontWeight: 800 }}>Open Orders (latest)</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={styles.thead}>
            <tr>
              <th style={styles.th}>symbol</th>
              <th style={styles.th}>side</th>
              <th style={styles.th}>type</th>
              <th style={styles.th}>status</th>
              <th style={styles.th}>qty</th>
              <th style={styles.th}>price</th>
              <th style={styles.th}>reduce</th>
              <th style={styles.th}>posIdx</th>
            </tr>
            </thead>
            <tbody>
            {(Array.isArray(tradeState?.orders) ? tradeState.orders : []).map((o, i) => {
              const r = normalizeOrderRow(o);
              if (!r) return null;
              return (
                  <tr key={i} style={styles.tr}>
                    <td style={styles.td}><b>{r.symbol}</b></td>
                    <td style={styles.td}>{r.side ?? "-"}</td>
                    <td style={styles.td}>{r.orderType ?? "-"}</td>
                    <td style={styles.td}>{r.orderStatus ?? "-"}</td>
                    <td style={styles.td}>{r.qty ?? "-"}</td>
                    <td style={styles.td}>{r.price ?? "-"}</td>
                    <td style={styles.td}>{String(!!r.reduceOnly)}</td>
                    <td style={styles.td}>{r.positionIdx ?? "-"}</td>
                  </tr>
              );
            })}
            {!tradeState?.orders?.length && (
                <tr style={styles.tr}><td style={styles.td} colSpan={8}><span style={{ color: "#6B7280" }}>no open orders</span></td></tr>
            )}
            </tbody>
          </table>
        </div>

        <div style={styles.tableWrap}>
          <div style={{ padding: 10, fontWeight: 800 }}>Executions (last)</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={styles.thead}>
            <tr>
              <th style={styles.th}>symbol</th>
              <th style={styles.th}>side</th>
              <th style={styles.th}>qty</th>
              <th style={styles.th}>price</th>
              <th style={styles.th}>fee</th>
              <th style={styles.th}>posIdx</th>
              <th style={styles.th}>time</th>
            </tr>
            </thead>
            <tbody>
            {(Array.isArray(tradeState?.executions) ? tradeState.executions : []).map((e, i) => {
              const r = normalizeExecRow(e);
              if (!r) return null;
              return (
                  <tr key={i} style={styles.tr}>
                    <td style={styles.td}><b>{r.symbol}</b></td>
                    <td style={styles.td}>{r.side ?? "-"}</td>
                    <td style={styles.td}>{r.execQty ?? "-"}</td>
                    <td style={styles.td}>{r.execPrice ?? "-"}</td>
                    <td style={styles.td}>{r.fee ?? "-"}</td>
                    <td style={styles.td}>{r.positionIdx ?? "-"}</td>
                    <td style={styles.td}>{r.execTime ? new Date(Number(r.execTime)).toLocaleTimeString() : "-"}</td>
                  </tr>
              );
            })}
            {!tradeState?.executions?.length && (
                <tr style={styles.tr}><td style={styles.td} colSpan={7}><span style={{ color: "#6B7280" }}>no executions</span></td></tr>
            )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 12, ...styles.card }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Order.create test (server-gated)</div>
        <div style={{ opacity: 0.8, fontSize: 13 }}>
          Requires backend env: <b>BYBIT_API_KEY</b>, <b>BYBIT_API_SECRET</b>, and <b>ENABLE_TRADING=1</b>. Limit orders also checked against{" "}
          <b>MAX_NOTIONAL_USDT</b>.
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            symbol
            <select value={orderSymbol} onChange={(e) => setOrderSymbol(e.target.value)} style={styles.input}>
              {knownSymbols.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
              ))}
            </select>
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            side
            <select value={orderSide} onChange={(e) => setOrderSide(e.target.value)} style={styles.input}>
              <option value="Buy">Buy</option>
              <option value="Sell">Sell</option>
            </select>
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            type
            <select value={orderType} onChange={(e) => setOrderType(e.target.value)} style={styles.input}>
              <option value="Limit">Limit</option>
              <option value="Market">Market</option>
            </select>
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            qty
            <input value={orderQty} onChange={(e) => setOrderQty(e.target.value)} style={{ ...styles.input, width: 110 }} />
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center", opacity: orderType === "Limit" ? 1 : 0.45 }}>
            price
            <input
                value={orderPrice}
                onChange={(e) => setOrderPrice(e.target.value)}
                style={{ ...styles.input, width: 140 }}
                disabled={orderType !== "Limit"}
            />
          </label>

          <button style={styles.btnPrimary} onClick={placeOrder} disabled={status !== "connected"}>
            placeOrder
          </button>

          <div style={{ marginLeft: "auto", fontSize: 13, opacity: 0.85 }}>
            trading enabled: <b>{risk?.enableTrading ? "yes" : "no"}</b> / maxNotional: <b>{risk?.maxNotionalUSDT ?? "-"}</b>
          </div>
        </div>
      </div>


      <div style={{ marginTop: 12, ...styles.card }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Bracket (Market) order</div>
        <div style={{ opacity: 0.8, fontSize: 13 }}>
          Market entry + attached TP/SL. Requires <b>ENABLE_TRADING=1</b>. Uses <b>{brTriggerBy}</b> for triggers.
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            symbol
            <select value={brSymbol} onChange={(e) => setBrSymbol(e.target.value)} style={styles.input}>
              {knownSymbols.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
              ))}
            </select>
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            side
            <select value={brSide} onChange={(e) => setBrSide(e.target.value)} style={styles.input}>
              <option value="Buy">Buy</option>
              <option value="Sell">Sell</option>
            </select>
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            qtyUSDT
            <input value={brQtyUSDT} onChange={(e) => setBrQtyUSDT(e.target.value)} style={{ ...styles.input, width: 110 }} />
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            TP %
            <input value={brTpPct} onChange={(e) => setBrTpPct(e.target.value)} style={{ ...styles.input, width: 90 }} />
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            SL %
            <input value={brSlPct} onChange={(e) => setBrSlPct(e.target.value)} style={{ ...styles.input, width: 90 }} />
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            triggerBy
            <select value={brTriggerBy} onChange={(e) => setBrTriggerBy(e.target.value)} style={styles.input}>
              <option value="MarkPrice">MarkPrice</option>
              <option value="LastPrice">LastPrice</option>
              <option value="IndexPrice">IndexPrice</option>
            </select>
          </label>

          <button style={styles.btnPrimary} onClick={placeBracket} disabled={status !== "connected"}>
            placeBracket
          </button>

          <div style={{ marginLeft: "auto", fontSize: 13, opacity: 0.85 }}>
            trading enabled: <b>{risk?.enableTrading ? "yes" : "no"}</b> / halted: <b>{risk?.haltTrading ? "yes" : "no"}</b>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, ...styles.card }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Risk actions</div>
        <div style={{ opacity: 0.8, fontSize: 13 }}>cancelAll / closeAll / killSwitch (server-side runtime halt)</div>

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button style={styles.btn} onClick={() => cancelAll()} disabled={status !== "connected"}>
            cancelAll (all)
          </button>
          <button style={styles.btn} onClick={() => cancelAll(brSymbol)} disabled={status !== "connected"}>
            cancelAll ({brSymbol})
          </button>
          <button style={styles.btn} onClick={() => closeAll()} disabled={status !== "connected"}>
            closeAll (all)
          </button>
          <button style={styles.btn} onClick={() => closeAll(brSymbol)} disabled={status !== "connected"}>
            closeAll ({brSymbol})
          </button>

          <label style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: 10 }}>
            reason
            <input value={killReason} onChange={(e) => setKillReason(e.target.value)} style={{ ...styles.input, width: 220 }} />
          </label>

          <button style={{ ...styles.btnDanger }} onClick={() => killSwitch(true)} disabled={status !== "connected"}>
            killSwitch ON
          </button>
          <button style={styles.btn} onClick={() => killSwitch(false)} disabled={status !== "connected"}>
            killSwitch OFF
          </button>
        </div>
      </div>

      <h3 style={{ marginTop: 18, color: "#111" }}>Chart</h3>
      <div style={{ marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Selected
          <select value={selectedSymbol} onChange={(e) => setSelectedSymbol(e.target.value)} style={styles.input}>
            {knownSymbols.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Chart
          <select value={chartMode} onChange={(e) => setChartMode(e.target.value)} style={styles.input}>
            <option value="mid">mid</option>
            <option value="r">log return (r)</option>
          </select>
        </label>

        <div style={{ opacity: 0.75 }}>
          bars: <b>{chartBars?.length || 0}</b>
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <canvas
            ref={canvasRef}
            style={{
              width: "100%",
              height: 240,
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.08)",
              display: "block",
            }}
        />
      </div>

      <h3 style={{ marginTop: 18, color: "#111" }}>Prices (last)</h3>
      <div style={styles.tableWrap}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={styles.thead}>
          <tr>
            <th style={styles.th}>Symbol</th>
            <th style={styles.th}>Mid</th>
            <th style={styles.th}>Time</th>
          </tr>
          </thead>
          <tbody>
          {priceRows.length ? (
              priceRows.map((r) => (
                  <tr key={r.symbol} style={styles.tr}>
                    <td style={{ ...styles.td, fontWeight: 700 }}>{r.symbol}</td>
                    <td style={styles.td}>{typeof r.mid === "number" ? r.mid.toFixed(6) : String(r.mid ?? "-")}</td>
                    <td style={styles.td}>{r.t ? new Date(r.t).toLocaleTimeString() : "-"}</td>
                  </tr>
              ))
          ) : (
              <tr>
                <td colSpan={3} style={{ padding: 10, opacity: 0.7 }}>
                  No prices (subscribe price + startFeed)
                </td>
              </tr>
          )}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 18, color: "#111" }}>Private events (last 30)</h3>
      <div style={{ ...styles.card, background: "#0b0d10", color: "#e5e7eb" }}>
        <div style={{ opacity: 0.8, fontSize: 13 }}>
          Enable subscriptions: <b>priv.order / priv.execution / priv.position / priv.wallet</b>
        </div>
        <pre style={{ marginTop: 10, maxHeight: 280, overflow: "auto", whiteSpace: "pre-wrap" }}>
          {privMsgs
              .map((m) => {
                const summary = {
                  t: new Date(m.t).toLocaleTimeString(),
                  topic: m.topic,
                  creationTime: m.payload?.creationTime,
                  dataLen: Array.isArray(m.payload?.data) ? m.payload.data.length : null,
                };
                return JSON.stringify(summary);
              })
              .join("\n")}
        </pre>
      </div>

      <h3 style={{ marginTop: 18, color: "#111" }}>Log</h3>
      <pre
          style={{
            background: "#0b0d10",
            color: "#9ef7a9",
            padding: 12,
            borderRadius: 10,
            maxHeight: 260,
            overflow: "auto",
            whiteSpace: "pre-wrap",
          }}
      >
        {log.join("\n")}
      </pre>
    </div>
);
}