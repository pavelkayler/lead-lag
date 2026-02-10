import { useEffect, useMemo, useRef, useState } from "react";
import { styles } from "../../shared/ui/styles";
import { safeJsonParse, makeId } from "../../shared/utils/format";
import { useInterval } from "../../shared/hooks/useInterval";

import { ConnectionBar } from "./components/ConnectionBar";
import { SubscriptionsBar } from "./components/SubscriptionsBar";
import { PricesCard } from "./components/PricesCard";
import { LeadLagCard } from "./components/LeadLagCard";
import { LatencyCard } from "./components/LatencyCard";
import { PrivateTradeCard } from "./components/PrivateTradeCard";
import { OrderCreateCard } from "./components/OrderCreateCard";
import { BracketCard } from "./components/BracketCard";
import { RiskActionsCard } from "./components/RiskActionsCard";
import { TradeStateCard } from "./components/TradeStateCard";
import { LogConsoleCard } from "./components/LogConsoleCard";
import { ChartCard } from "./components/ChartCard";
import { PaperTradingCard } from "./components/PaperTradingCard";
import { RecorderCard } from "./components/RecorderCard";
import { PaperTestCard } from "./components/PaperTestCard";

const DEFAULT_WS_URL = "ws://localhost:8080";
const MAX_LOCAL_BARS = 480; // 120s @ 250ms

function toNum(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pickWalletUSDT(walletMsg) {
  const msg = walletMsg?.payload ? walletMsg.payload : walletMsg;
  const list = msg?.data || msg?.result || msg?.wallet || msg?.balance || [];
  if (!Array.isArray(list)) return null;
  for (const it of list) {
    const coin = String(it?.coin || it?.currency || "").toUpperCase();
    if (coin === "USDT") {
      const eq = toNum(it?.equity) ?? toNum(it?.walletBalance) ?? toNum(it?.availableBalance) ?? toNum(it?.totalEquity);
      return eq != null ? eq : null;
    }
  }
  return null;
}

function normalizeSymbolList(input) {
  return String(input || "")
    .split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 5);
}

export function DashboardPage() {
  const wsRef = useRef(null);
  const pendingRef = useRef(new Map());
  const inboxQueueRef = useRef([]);
  const consumerRunningRef = useRef(false);

  const [wsUrl, setWsUrl] = useState(DEFAULT_WS_URL);
  const [status, setStatus] = useState("disconnected");
  const [clientId, setClientId] = useState(null);

  const [prices, setPrices] = useState({});
  const [metrics, setMetrics] = useState(null);

  const [symbolsInput, setSymbolsInput] = useState("BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,DOGEUSDT,ADAUSDT,TRXUSDT,AVAXUSDT,LINKUSDT,TONUSDT,DOTUSDT,LTCUSDT,BCHUSDT,ETCUSDT,ATOMUSDT,NEARUSDT,INJUSDT,SEIUSDT,APTUSDT,OPUSDT,ARBUSDT,ICPUSDT,FILUSDT,RUNEUSDT,UNIUSDT,IMXUSDT,STXUSDT,PEPEUSDT,MKRUSDT");
  const knownSymbols = useMemo(() => normalizeSymbolList(symbolsInput), [symbolsInput]);

  const [selectedSymbol, setSelectedSymbol] = useState(knownSymbols[0] || "BTCUSDT");
  const [chartBars, setChartBars] = useState([]);

  const [subs, setSubs] = useState({
    metrics: true,
    price: true,
    bar: true,
    leadlag: true,
    tradeState: true,
    paper: true,
    record: true,
    "priv.order": false,
    "priv.execution": false,
    "priv.position": false,
    "priv.wallet": false,
    paperTest: true,
  });

  const [leadLag, setLeadLag] = useState([]);
  const [tradeState, setTradeState] = useState(null);
  const [paperTestStatus, setPaperTestStatus] = useState(null);
  const [paperMsg, setPaperMsg] = useState(null);
  const [paperParams, setPaperParams] = useState({
    qtyUSDT: "80",
    minCorr: "0.25",
    stdBars: "240",
    impulseZ: "6.0",
    tpSigma: "25",
    slSigma: "18",
    maxHoldBars: "360",
    cooldownBars: "120",
    minTpBps: "25",
    minSlBps: "20",
  });

  const [recordMsg, setRecordMsg] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [recordFile, setRecordFile] = useState("session.jsonl");
  const [replayFile, setReplayFile] = useState("");
  const [replaySpeed, setReplaySpeed] = useState("1");

  const [log, setLog] = useState([]);

  const [demoAmountUSDT, setDemoAmountUSDT] = useState("1000");
  const [demoCoin, setDemoCoin] = useState("USDT");

  const [orderSymbol, setOrderSymbol] = useState("BTCUSDT");
  const [orderSide, setOrderSide] = useState("Buy");
  const [orderType, setOrderType] = useState("Limit");
  const [orderQty, setOrderQty] = useState("0.001");
  const [orderPrice, setOrderPrice] = useState("0");

  const [brSymbol, setBrSymbol] = useState("BTCUSDT");
  const [brSide, setBrSide] = useState("Buy");
  const [brQtyUSDT, setBrQtyUSDT] = useState("25");
  const [brTpPct, setBrTpPct] = useState("0.6");
  const [brSlPct, setBrSlPct] = useState("0.4");
  const [brTriggerBy, setBrTriggerBy] = useState("MarkPrice");

  const [killReason, setKillReason] = useState("");

  const risk = metrics?.risk || null;
  const privStats = metrics?.private || null;
  const tradeStats = metrics?.trade || null;

  function pushLog(line) {
    setLog((prev) => {
      const next = [...prev, line];
      return next.slice(-120);
    });
  }

  function wsSend(obj) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify(obj));
    return true;
  }

  async function rpc(type, payload = {}, timeoutMs = 5000) {
    const id = makeId(type);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        pendingRef.current.delete(id);
        reject(new Error(`RPC timeout: ${type}`));
      }, timeoutMs);

      pendingRef.current.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          pendingRef.current.delete(id);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(t);
          pendingRef.current.delete(id);
          reject(e);
        },
      });

      const ok = wsSend({ type, id, payload });
      if (!ok) {
        clearTimeout(t);
        pendingRef.current.delete(id);
        reject(new Error("WS not connected"));
      }
    });
  }

  function connect() {
    try {
      if (wsRef.current) wsRef.current.close();
    } catch {}

    setStatus("connecting");
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      pushLog("WS open");
      for (const [k, v] of Object.entries(subs)) {
        if (v) wsSend({ type: "subscribe", id: makeId("sub"), payload: { topic: k } });
      }
      setTimeout(() => { refreshRecordings(); }, 0);
    };

    ws.onclose = () => {
      setStatus("disconnected");
      pushLog("WS close");
      setClientId(null);
    };

    ws.onerror = () => {
      pushLog("WS error");
    };

    ws.onmessage = (ev) => {
      const parsed = safeJsonParse(ev.data);
      if (!parsed.ok) return;
      inboxQueueRef.current.push(parsed.value);
      if (!consumerRunningRef.current) consumeInbox();
    };
  }

  function disconnect() {
    try {
      wsRef.current?.close();
    } catch {}
  }

  async function consumeInbox() {
    consumerRunningRef.current = true;
    const MAX_PER_TICK = 100;

    while (inboxQueueRef.current.length) {
      const batch = inboxQueueRef.current.splice(0, MAX_PER_TICK);
      for (const msg of batch) {
        if (msg?.type === "response" && msg?.id) {
          const p = pendingRef.current.get(msg.id);
          if (p) {
            if (msg.ok) p.resolve(msg.payload);
            else p.reject(new Error(msg.error || "RPC failed"));
          }
          continue;
        }

        if (msg?.type === "event") {
          const topic = msg.topic;
          const payload = msg.payload;

          if (topic === "hello") setClientId(payload?.clientId || null);
          if (topic === "metrics") setMetrics(payload);

          if (topic === "price") {
            const sym = payload?.symbol;
            if (sym) setPrices((prev) => ({ ...prev, [sym]: payload }));
          }

          if (topic === "bar") {
            const sym = payload?.symbol;
            if (sym === selectedSymbol) {
              setChartBars((prev) => [...prev, { ts: payload?.ts || Date.now(), mid: payload?.mid }].slice(-MAX_LOCAL_BARS));
            }
          }

          if (topic === "leadlag") {
            if (Array.isArray(payload?.top)) setLeadLag(payload.top);
          }

          if (topic === "tradeState") setTradeState(payload);

          if (topic === "paperTest") setPaperTestStatus(payload);
          if (topic === "paper") setPaperMsg(payload);
          if (topic === "record") {
            setRecordMsg(payload);
            if (Array.isArray(payload?.recordings)) setRecordings(payload.recordings);
          }
        }
      }
      await new Promise((r) => setTimeout(r, 0));
    }

    consumerRunningRef.current = false;
  }

  async function toggleSub(topic, on) {
    setSubs((prev) => ({ ...prev, [topic]: on }));
    try {
      await rpc(on ? "subscribe" : "unsubscribe", { topic }, 2000);
    } catch (e) {
      pushLog(`sub ${topic} FAIL: ${e.message}`);
    }
  }

  async function setSymbols() {
    try {
      const symbols = normalizeSymbolList(symbolsInput);
      await rpc("setSymbols", { symbols }, 3000);
      pushLog(`setSymbols OK: ${symbols.join(",")}`);
      if (symbols.length && !symbols.includes(selectedSymbol)) setSelectedSymbol(symbols[0]);
      if (symbols.length && !symbols.includes(orderSymbol)) setOrderSymbol(symbols[0]);
      if (symbols.length && !symbols.includes(brSymbol)) setBrSymbol(symbols[0]);
    } catch (e) {
      pushLog(`setSymbols FAIL: ${e.message}`);
    }
  }

  async function startFeed() {
    try {
      await rpc("startFeed", {}, 3000);
      pushLog("startFeed OK");
    } catch (e) {
      pushLog(`startFeed FAIL: ${e.message}`);
    }
  }

  async function stopFeed() {
    try {
      await rpc("stopFeed", {}, 3000);
      pushLog("stopFeed OK");
    } catch (e) {
      pushLog(`stopFeed FAIL: ${e.message}`);
    }
  }

  async function connectPrivate() {
    try {
      await rpc("connectPrivate", {}, 7000);
      pushLog("connectPrivate OK");
    } catch (e) {
      pushLog(`connectPrivate FAIL: ${e.message}`);
    }
  }

  async function disconnectPrivate() {
    try {
      await rpc("disconnectPrivate", {}, 3000);
      pushLog("disconnectPrivate OK");
    } catch (e) {
      pushLog(`disconnectPrivate FAIL: ${e.message}`);
    }
  }

  async function connectTrade() {
    try {
      await rpc("connectTrade", {}, 7000);
      pushLog("connectTrade OK");
    } catch (e) {
      pushLog(`connectTrade FAIL: ${e.message}`);
    }
  }

  async function disconnectTrade() {
    try {
      await rpc("disconnectTrade", {}, 3000);
      pushLog("disconnectTrade OK");
    } catch (e) {
      pushLog(`disconnectTrade FAIL: ${e.message}`);
    }
  }

function parsePaperParams() {
  const out = {};
  for (const [k, v] of Object.entries(paperParams || {})) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

async function paperStart() {
  try {
    const p = parsePaperParams();
    await rpc("paperStart", p, 5000);
    pushLog("paperStart OK");
  } catch (e) {
    pushLog(`paperStart FAIL: ${e.message}`);
  }
}

async function paperStop() {
  try {
    await rpc("paperStop", {}, 5000);
    pushLog("paperStop OK");
  } catch (e) {
    pushLog(`paperStop FAIL: ${e.message}`);
  }
}

async function paperReset() {
  try {
    await rpc("paperReset", {}, 5000);
    pushLog("paperReset OK");
  } catch (e) {
    pushLog(`paperReset FAIL: ${e.message}`);
  }
}



  
async function recordStatus() {
  try {
    const st = await rpc("recordStatus", {}, 5000);
    setRecordMsg(st);
    if (Array.isArray(st?.recordings)) setRecordings(st.recordings);
    if (!replayFile && Array.isArray(st?.recordings) && st.recordings.length) {
      setReplayFile(st.recordings[st.recordings.length - 1]);
    }
    return st;
  } catch (e) {
    pushLog(`recordStatus FAIL: ${e.message}`);
    return null;
  }
}

async function refreshRecordings() {
  const st = await recordStatus();
  if (st) pushLog(`recordings: ${st.recordings?.length ?? 0}`);
}

async function recordStart() {
  try {
    await rpc("recordStart", { file: recordFile }, 5000);
    pushLog("recordStart OK");
    await recordStatus();
  } catch (e) {
    pushLog(`recordStart FAIL: ${e.message}`);
  }
}

async function recordStop() {
  try {
    await rpc("recordStop", {}, 5000);
    pushLog("recordStop OK");
    await recordStatus();
  } catch (e) {
    pushLog(`recordStop FAIL: ${e.message}`);
  }
}

async function replayStart() {
  try {
    const sp = Number(replaySpeed);
    await rpc("replayStart", { file: replayFile, speed: Number.isFinite(sp) ? sp : 1 }, 10000);
    pushLog("replayStart OK");
    await recordStatus();
  } catch (e) {
    pushLog(`replayStart FAIL: ${e.message}`);
  }
}

async function replayStop() {
  try {
    await rpc("replayStop", {}, 5000);
    pushLog("replayStop OK");
    await recordStatus();
  } catch (e) {
    pushLog(`replayStop FAIL: ${e.message}`);
  }
}

async function demoApplyMoney() {
    try {
      const payload = { amountUSDT: demoAmountUSDT, coin: demoCoin };
      const res = await rpc("demoApplyMoney", payload, 8000);
      pushLog(`demoApplyMoney OK: ${res?.retMsg || "ok"}`);
    } catch (e) {
      pushLog(`demoApplyMoney FAIL: ${e.message}`);
    }
  }

  
async function startPaperTest() {
  try {
    const payload = { durationHours: 8, rotateEveryMinutes: 60, symbolsCount: 30, minMarketCapUsd: 10_000_000 };
    const res = await rpc("startPaperTest", payload, 15000);
    setPaperTestStatus(res);
    pushLog("startPaperTest OK");
  } catch (e) {
    pushLog(`startPaperTest FAIL: ${e.message}`);
  }
}

async function stopPaperTest() {
  try {
    const res = await rpc("stopPaperTest", { reason: "ui" }, 8000);
    setPaperTestStatus(res);
    pushLog("stopPaperTest OK");
  } catch (e) {
    pushLog(`stopPaperTest FAIL: ${e.message}`);
  }
}

async function refreshPaperTest() {
  try {
    const res = await rpc("getPaperTestStatus", {}, 5000);
    setPaperTestStatus(res);
    pushLog("getPaperTestStatus OK");
  } catch (e) {
    pushLog(`getPaperTestStatus FAIL: ${e.message}`);
  }
}

async function placeOrder() {
    try {
      const payload = { symbol: orderSymbol, side: orderSide, orderType, qty: orderQty, price: orderPrice };
      const res = await rpc("placeOrder", payload, 8000);
      const oid = res?.result?.orderId || res?.result?.order_id || "-";
      pushLog(`order.create OK orderId=${oid}`);
    } catch (e) {
      pushLog(`order.create FAIL: ${e.message}`);
    }
  }

  async function placeBracket() {
    try {
      const payload = { symbol: brSymbol, side: brSide, qtyUSDT: brQtyUSDT, tpPct: brTpPct, slPct: brSlPct, triggerBy: brTriggerBy };
      const res = await rpc("placeBracket", payload, 8000);
      const oid = res?.result?.orderId || res?.result?.order_id || "-";
      pushLog(`placeBracket OK orderId=${oid}`);
    } catch (e) {
      pushLog(`placeBracket FAIL: ${e.message}`);
    }
  }

  async function cancelAll(symbol = null) {
    try {
      const res = await rpc("cancelAll", symbol ? { symbol } : {}, 8000);
      pushLog(`cancelAll OK retCode=${res?.retCode ?? "?"}`);
    } catch (e) {
      pushLog(`cancelAll FAIL: ${e.message}`);
    }
  }

  async function closeAll(symbol = null) {
    try {
      const res = await rpc("closeAll", symbol ? { symbol } : {}, 15000);
      const ok = res?.results?.filter?.((x) => x.ok)?.length ?? 0;
      const n = res?.results?.length ?? 0;
      pushLog(`closeAll OK closed=${ok}/${n}`);
    } catch (e) {
      pushLog(`closeAll FAIL: ${e.message}`);
    }
  }

  async function killSwitch(on) {
    try {
      const res = await rpc("killSwitch", { on, reason: killReason }, 8000);
      pushLog(`killSwitch OK haltTrading=${res?.haltTrading}`);
    } catch (e) {
      pushLog(`killSwitch FAIL: ${e.message}`);
    }
  }

  useInterval(async () => {
    if (status !== "connected") return;
    if (!subs.leadlag) return;
    try {
      await rpc("refreshLeadLag", {}, 2500);
    } catch {}
  }, 5000);

  useEffect(() => {
    if (!knownSymbols.length) return;
    if (!knownSymbols.includes(selectedSymbol)) setSelectedSymbol(knownSymbols[0]);
  }, [knownSymbols, selectedSymbol]);

  useEffect(() => {
    if (!knownSymbols.length) return;
    if (!knownSymbols.includes(orderSymbol)) setOrderSymbol(knownSymbols[0]);
  }, [knownSymbols, orderSymbol]);

  useEffect(() => {
    if (!knownSymbols.length) return;
    if (!knownSymbols.includes(brSymbol)) setBrSymbol(knownSymbols[0]);
  }, [knownSymbols, brSymbol]);

  useEffect(() => {
    setChartBars([]);
  }, [selectedSymbol]);

  return (
    <div style={{ ...styles.page, background: "#ffffff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={styles.h1}>Lead–Lag + Demo Trading Console</div>
          <div style={styles.sub}>Feature-sliced layout (app/pages/features/shared). Replace your frontend/src with this bundle.</div>
        </div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>
          wallet USDT: <b>{pickWalletUSDT(tradeState?.wallet) ?? "-"}</b>
        </div>
      </div>

      <ConnectionBar
        wsUrl={wsUrl}
        setWsUrl={setWsUrl}
        status={status}
        clientId={clientId}
        onConnect={connect}
        onDisconnect={disconnect}
        symbolsInput={symbolsInput}
        setSymbolsInput={setSymbolsInput}
        onSetSymbols={setSymbols}
        onStartFeed={startFeed}
        onStopFeed={stopFeed}
      />

      <SubscriptionsBar subs={subs} onToggle={toggleSub} />

      <PricesCard prices={prices} />
      <LeadLagCard leadLag={leadLag} />

      <LatencyCard metrics={metrics} />

      <PrivateTradeCard
        privStats={{
          connected: !!privStats?.connected,
          authed: !!privStats?.authed,
          lastMsgAge: privStats?.lastMsgAge,
          reconnects: privStats?.reconnects,
        }}
        tradeStats={{
          connected: !!tradeStats?.connected,
          authed: !!tradeStats?.authed,
          lastMsgAge: tradeStats?.lastMsgAge,
          reconnects: tradeStats?.reconnects,
        }}
        onConnectPrivate={connectPrivate}
        onDisconnectPrivate={disconnectPrivate}
        onConnectTrade={connectTrade}
        onDisconnectTrade={disconnectTrade}
        status={status}
      />

      <div style={{ marginTop: 12, ...styles.card }}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Demo funds (apply)</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            coin
            <input value={demoCoin} onChange={(e) => setDemoCoin(e.target.value)} style={{ ...styles.input, width: 90 }} />
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            amountUSDT
            <input value={demoAmountUSDT} onChange={(e) => setDemoAmountUSDT(e.target.value)} style={{ ...styles.input, width: 120 }} />
          </label>
          <button style={styles.btnPrimary} onClick={demoApplyMoney} disabled={status !== "connected"}>demoApplyMoney</button>
        </div>
      </div>

      <OrderCreateCard
        knownSymbols={knownSymbols}
        orderSymbol={orderSymbol}
        setOrderSymbol={setOrderSymbol}
        orderSide={orderSide}
        setOrderSide={setOrderSide}
        orderType={orderType}
        setOrderType={setOrderType}
        orderQty={orderQty}
        setOrderQty={setOrderQty}
        orderPrice={orderPrice}
        setOrderPrice={setOrderPrice}
        onPlaceOrder={placeOrder}
        status={status}
        risk={risk}
      />

      <BracketCard
        knownSymbols={knownSymbols}
        brSymbol={brSymbol}
        setBrSymbol={setBrSymbol}
        brSide={brSide}
        setBrSide={setBrSide}
        brQtyUSDT={brQtyUSDT}
        setBrQtyUSDT={setBrQtyUSDT}
        brTpPct={brTpPct}
        setBrTpPct={setBrTpPct}
        brSlPct={brSlPct}
        setBrSlPct={setBrSlPct}
        brTriggerBy={brTriggerBy}
        setBrTriggerBy={setBrTriggerBy}
        onPlaceBracket={placeBracket}
        status={status}
        risk={risk}
      />

      <RiskActionsCard
        killReason={killReason}
        setKillReason={setKillReason}
        onCancelAll={cancelAll}
        onCloseAll={closeAll}
        onKillSwitchOn={() => killSwitch(true)}
        onKillSwitchOff={() => killSwitch(false)}
        status={status}
        symbolHint={brSymbol}
      />

      <PaperTradingCard
        metricsPaper={metrics?.paper}
        paperMsg={paperMsg}
        paperParams={paperParams}
        setPaperParams={setPaperParams}
        onPaperStart={paperStart}
        onPaperStop={paperStop}
        onPaperReset={paperReset}
        status={status}
      />

      <RecorderCard
        recordMsg={recordMsg}
        recordFile={recordFile}
        setRecordFile={setRecordFile}
        replayFile={replayFile}
        setReplayFile={setReplayFile}
        replaySpeed={replaySpeed}
        setReplaySpeed={setReplaySpeed}
        recordings={recordings}
        onRefreshList={refreshRecordings}
        onRecordStart={recordStart}
        onRecordStop={recordStop}
        onReplayStart={replayStart}
        onReplayStop={replayStop}
      />


      
<PaperTestCard
  status={paperTestStatus || metrics?.paperTest || null}
  onStart={startPaperTest}
  onStop={stopPaperTest}
  onRefresh={refreshPaperTest}
  canRun={status === "connected"}
/>

<TradeStateCard tradeState={tradeState} />

      <ChartCard selectedSymbol={selectedSymbol} chartBars={chartBars} onSelectSymbol={setSelectedSymbol} symbols={knownSymbols} />

      <LogConsoleCard log={log} />
    </div>
  );
}
