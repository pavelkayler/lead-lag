import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const AppContext = createContext(null);
const DEFAULT_WS_URL = "ws://localhost:8080";

function makeId(type) { return `${type}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`; }

const ROUTE_TOPICS = {
  "/": ["price", "leadlag", "metrics", "feedStatus"],
  "/paper": ["paperTest"],
  "/presets": [],
  "/range-metrics": ["rangeMetrics"],
  "/boundary-flip": ["boundaryFlipBot"],
};

function topicsForPath(pathname = "/") {
  return ROUTE_TOPICS[pathname] || [];
}


export function AppProviders({ children }) {
  const wsRef = useRef(null);
  const pendingRef = useRef(new Map());
  const pollRef = useRef(null);
  const wsTopicsRef = useRef(new Set());

  const [wsUrl, setWsUrl] = useState(DEFAULT_WS_URL);
  const [status, setStatus] = useState("disconnected");
  const [clientId, setClientId] = useState(null);
  const [feedMaxSymbols, setFeedMaxSymbols] = useState(100);
  const [symbols, setSymbolsState] = useState([]);
  const [prices, setPrices] = useState({});
  const [leadlag, setLeadlag] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [feedStatus, setFeedStatus] = useState(null);
  const [bars, setBars] = useState({});
  const [paperTest, setPaperTest] = useState(null);
  const [presets, setPresets] = useState([]);
  const [presetStats, setPresetStats] = useState({});
  const [tradeState, setTradeState] = useState(null);
  const [tradingStatus, setTradingStatus] = useState({ trading: false, mode: "demo" });
  const [rangeMetrics, setRangeMetrics] = useState({ status: null, candidates: [], logs: [], lastPlan: null, noTrade: [] });
  const [boundaryFlip, setBoundaryFlip] = useState({ status: null, logs: [] });
  const [uiError, setUiError] = useState("");
  const [activePath, setActivePath] = useState(() => window.location.pathname || "/");
  const [wsTopics, setWsTopics] = useState([]);

  const sendCommand = useCallback((type, payload = {}, timeoutMs = null) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return Promise.reject(new Error("WS не подключён"));
    const id = makeId(type);
    return new Promise((resolve, reject) => {
      const effectiveTimeout = Number(timeoutMs ?? ({ createHedgeOrders: 3000, startPaperTest: 3000 }[type] ?? 8000));
      const t = setTimeout(() => {
        pendingRef.current.delete(id);
        reject(new Error(`Timeout ${type}`));
      }, effectiveTimeout);
      pendingRef.current.set(id, { resolve, reject, t });
      ws.send(JSON.stringify({ type, id, payload }));
    });
  }, []);

  const connect = useCallback(() => {
    try { wsRef.current?.close(); } catch {}
    setStatus("connecting");
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = async () => {
      setStatus("connected");
      try {
        const st = await sendCommand("getStatus", {});
        setFeedMaxSymbols(st.feedMaxSymbols || 100);
        setSymbolsState(st.feed?.symbols || []);
        try { const p = await sendCommand("listPresets", {}); setPresets(p.presets || []); setPresetStats(p.presetStats || {}); } catch {}
        for (const topic of topicsForPath(window.location.pathname || "/")) {
          try { await sendCommand("subscribe", { topic }); wsTopicsRef.current.add(topic); setWsTopics(Array.from(wsTopicsRef.current)); } catch {}
        }
      } catch (e) { console.error("[ACTION] getStatus error", e); }
    };
    ws.onclose = () => { setStatus("disconnected"); setClientId(null); wsTopicsRef.current.clear(); setWsTopics([]); };
    ws.onerror = (e) => console.error("WS error", e);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "response" && msg.id) {
        const p = pendingRef.current.get(msg.id);
        if (!p) return;
        clearTimeout(p.t);
        pendingRef.current.delete(msg.id);
        if (msg.ok) p.resolve(msg.payload); else p.reject(new Error(msg.error || "RPC error"));
        return;
      }
      if (msg.type !== "event") return;
      if (msg.topic === "hello") setClientId(msg.payload?.clientId || null);
      if (msg.topic === "price") {
        const symbol = String(msg.payload?.symbol || "").toUpperCase();
        const source = String(msg.payload?.source || "BT").toUpperCase();
        if (!symbol) return;
        setPrices((prev) => ({
          ...prev,
          [symbol]: { ...(prev[symbol] || {}), symbol, [source]: msg.payload },
        }));
      }
      if (msg.topic === "leadlag") setLeadlag(msg.payload?.top || []);
      if (msg.topic === "metrics") setMetrics(msg.payload || null);
      if (msg.topic === "feedStatus") setFeedStatus(msg.payload || null);
      if (msg.topic === "bar") {
        const symbol = String(msg.payload?.symbol || "").toUpperCase();
        const source = String(msg.payload?.source || "BT").toUpperCase();
        if (!symbol) return;
        const key = `${symbol}|${source}`;
        setBars((prev) => ({ ...prev, [key]: [...(prev[key] || []), msg.payload].slice(-480) }));
      }
      if (msg.topic === "paperTest") {
        setPaperTest(msg.payload);
        if (Array.isArray(msg.payload?.presets) && msg.payload.presets.length) {
          setPresets((prev) => {
            const map = new Map(prev.map((p) => [p.name, p]));
            for (const x of msg.payload.presets) map.set(x.name, { ...(map.get(x.name) || {}), ...x });
            return Array.from(map.values());
          });
        }
        if (msg.payload?.presetStats) setPresetStats(msg.payload.presetStats);
      }
      if (msg.topic === "boundaryFlipBot") {
        const evt = msg.payload || {};
        setBoundaryFlip((prev) => {
          if (evt.kind === "status") return { ...prev, status: evt.payload || null };
          if (evt.kind === "log") return { ...prev, logs: [evt.payload, ...(prev.logs || [])].slice(0, 400) };
          return prev;
        });
      }
      if (msg.topic === "rangeMetrics") {
        const evt = msg.payload || {};
        setRangeMetrics((prev) => {
          if (evt.kind === "status") return { ...prev, status: evt.payload || null };
          if (evt.kind === "candidates") return { ...prev, candidates: evt.payload || [] };
          if (evt.kind === "plan") return { ...prev, lastPlan: evt.payload || null };
          if (evt.kind === "noTrade") return { ...prev, noTrade: [evt.payload, ...(prev.noTrade || [])].slice(0, 200) };
          if (evt.kind === "log" || evt.kind === "error") return { ...prev, logs: [{ kind: evt.kind, ...(evt.payload || {}), ts: evt.ts }, ...(prev.logs || [])].slice(0, 400) };
          return prev;
        });
      }
      if (msg.topic === "tradeState") {
        const payload = msg.payload || {};
        const normalizeOrder = (o = {}) => ({ ...o, linkId: o.linkId || o.orderLinkId || o.order_link_id || o.order_linkId || null, orderStatus: o.orderStatus || o.order_status || o.status || null });
        setTradeState({
          ...payload,
          openOrders: (payload.openOrders || payload.orders || []).map(normalizeOrder),
          orders: (payload.orders || payload.openOrders || []).map(normalizeOrder),
          positions: payload.positions || [],
          executions: payload.executions || [],
        });
      }
    };
  }, [sendCommand, wsUrl, activePath]);

  const disconnect = useCallback(() => { try { wsRef.current?.close(); } catch {} }, []);

  const action = useCallback(async (name, fn) => {
    try {
      const res = await fn();
      console.log(`[ACTION] ${name} success`, res);
      setUiError("");
      return res;
    } catch (e) {
      console.error(`[ACTION] ${name} error`, e);
      setUiError((prev) => (prev === (e.message || "Ошибка") ? prev : (e.message || "Ошибка")));
      throw e;
    }
  }, []);

  const subscribe = (topic) => action("subscribe", async () => {
    const res = await sendCommand("subscribe", { topic });
    wsTopicsRef.current.add(topic);
    setWsTopics(Array.from(wsTopicsRef.current));
    return res;
  });
  const unsubscribe = (topic) => action("unsubscribe", async () => {
    const res = await sendCommand("unsubscribe", { topic });
    wsTopicsRef.current.delete(topic);
    setWsTopics(Array.from(wsTopicsRef.current));
    return res;
  });
  const setSymbols = (list) => action("setSymbols", () => sendCommand("setSymbols", { symbols: list })).then((r) => { setSymbolsState(r.symbols || list); setFeedMaxSymbols(r.feedMaxSymbols || feedMaxSymbols); return r; });
  const startFeed = () => action("startFeed", () => sendCommand("startFeed", {}));
  const stopFeed = () => action("stopFeed", () => sendCommand("stopFeed", {}));

  const startPaperTest = (payload) => action("startPaperTest", () => sendCommand("startPaperTest", payload));
  const stopPaperTest = () => action("stopPaperTest", () => sendCommand("stopPaperTest", {}));

  const startTrading = (mode, params) => action("startTrading", () => sendCommand("startTrading", { mode, params })).then((r) => { setTradingStatus({ trading: true, mode, params }); return r; });
  const stopTrading = () => action("stopTrading", () => sendCommand("stopTrading", {})).then((r) => { setTradingStatus({ trading: false }); return r; });
  const getOpenOrders = () => action("getOpenOrders", () => sendCommand("getOpenOrders", {}));
  const cancelAllOrders = () => action("cancelAllOrders", () => sendCommand("cancelAllOrders", {}));
  const closeAllPositions = () => action("closeAllPositions", () => sendCommand("closeAllPositions", {}));
  const createHedgeOrders = (payload) => action("createHedgeOrders", () => sendCommand("createHedgeOrders", payload));
  const getTradingStatus = () => action("getTradingStatus", () => sendCommand("getTradingStatus", {})).then((s) => (setTradingStatus(s), s));
  const getTradeState = (opts = {}) => action("getTradeState", () => sendCommand("getTradeState", opts)).then((r) => {
    const payload = r || {};
    const normalizeOrder = (o = {}) => ({ ...o, linkId: o.linkId || o.orderLinkId || o.order_link_id || o.order_linkId || null, orderStatus: o.orderStatus || o.order_status || o.status || null });
    setTradeState({
      ...payload,
      openOrders: (payload.openOrders || payload.orders || []).map(normalizeOrder),
      orders: (payload.orders || payload.openOrders || []).map(normalizeOrder),
      positions: payload.positions || [],
      executions: payload.executions || [],
    });
    return r;
  });

  const listPresets = () => action("listPresets", () => sendCommand("listPresets", {})).then((r) => { setPresets(r.presets || []); setPresetStats(r.presetStats || {}); return r; });
  const savePreset = (preset, opts = {}) => action("savePreset", () => sendCommand("savePreset", { preset, name: opts?.name || preset?.name || "" })).then((r) => { setPresets(r.presets || []); return r; });
  const deletePreset = (name) => action("deletePreset", () => sendCommand("deletePreset", { name })).then((r) => { setPresets(r.presets || []); return r; });

  const startRangeMetrics = (cfg) => action("startRangeMetrics", () => sendCommand("startRangeMetrics", cfg || {}));
  const stopRangeMetrics = () => action("stopRangeMetrics", () => sendCommand("stopRangeMetrics", {}));
  const setRangeMetricsConfig = (cfg) => action("setRangeMetricsConfig", () => sendCommand("setRangeMetricsConfig", cfg || {}));
  const getRangeMetricsStatus = () => action("getRangeMetricsStatus", () => sendCommand("getRangeMetricsStatus", {}));
  const getRangeMetricsCandidates = () => action("getRangeMetricsCandidates", () => sendCommand("getRangeMetricsCandidates", {}));
  const startBoundaryFlipBot = (cfg) => action("startBoundaryFlipBot", () => sendCommand("startBoundaryFlipBot", cfg || {}));
  const stopBoundaryFlipBot = () => action("stopBoundaryFlipBot", () => sendCommand("stopBoundaryFlipBot", {}));
  const getBoundaryFlipBotStatus = () => action("getBoundaryFlipBotStatus", () => sendCommand("getBoundaryFlipBotStatus", {}));
  const getLogTail = (bot, lines = 200) => action("getLogTail", () => sendCommand("getLogTail", { bot, lines }));
  const getBotLogs = (bot, lines = 200) => getLogTail(bot, lines);

  useEffect(() => {
    const onNav = () => setActivePath(window.location.pathname || "/");
    window.addEventListener("popstate", onNav);
    window.addEventListener("hashchange", onNav);
    const click = () => setTimeout(onNav, 0);
    window.addEventListener("click", click);
    return () => {
      window.removeEventListener("popstate", onNav);
      window.removeEventListener("hashchange", onNav);
      window.removeEventListener("click", click);
    };
  }, []);

  useEffect(() => {
    if (status !== "connected") return;
    const desired = new Set(topicsForPath(activePath));
    const current = wsTopicsRef.current;
    for (const t of Array.from(current)) {
      if (!desired.has(t)) {
        sendCommand("unsubscribe", { topic: t }).then(() => { current.delete(t); setWsTopics(Array.from(current)); }).catch(() => {});
      }
    }
    for (const t of Array.from(desired)) {
      if (!current.has(t)) {
        sendCommand("subscribe", { topic: t }).then(() => { current.add(t); setWsTopics(Array.from(current)); }).catch(() => {});
      }
    }
  }, [status, activePath, sendCommand]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      if (status !== "connected") return;
      try {
        if (activePath === "/paper") {
          const res = await fetch("http://localhost:8080/results/latest");
          if (res.ok) setPaperTest(await res.json());
          return;
        }
        if (activePath === "/range-metrics") {
          const st = await sendCommand("getRangeMetricsStatus", {});
          const c = await sendCommand("getRangeMetricsCandidates", {});
          setRangeMetrics((prev) => ({ ...prev, status: st, candidates: c.candidates || prev.candidates }));
        }
        if (activePath === "/boundary-flip") {
          const st = await sendCommand("getBoundaryFlipBotStatus", {});
          const logs = await sendCommand("getLogTail", { bot: "flip", lines: 200 });
          setBoundaryFlip((prev) => ({ ...prev, status: st, logs: logs.lines || prev.logs }));
        }
      } catch {}
    }, 10000);
    return () => clearInterval(pollRef.current);
  }, [status, activePath]);

  const value = useMemo(() => ({
    wsUrl, setWsUrl, status, clientId, feedMaxSymbols, symbols, prices, leadlag, metrics, feedStatus, bars, paperTest, presets, presetStats, tradeState, tradingStatus, rangeMetrics, boundaryFlip, uiError, setUiError, activePath, wsTopics,
    connect, disconnect, sendCommand, subscribe, unsubscribe, setSymbols, startFeed, stopFeed, startPaperTest, stopPaperTest,
    startTrading, stopTrading, createHedgeOrders, getOpenOrders, cancelAllOrders, closeAllPositions, getTradingStatus, getTradeState, listPresets, savePreset, deletePreset,
    startRangeMetrics, stopRangeMetrics, setRangeMetricsConfig, getRangeMetricsStatus, getRangeMetricsCandidates, startBoundaryFlipBot, stopBoundaryFlipBot, getBoundaryFlipBotStatus, getBotLogs, getLogTail,
  }), [wsUrl, status, clientId, feedMaxSymbols, symbols, prices, leadlag, metrics, feedStatus, bars, paperTest, presets, presetStats, tradeState, tradingStatus, rangeMetrics, boundaryFlip, uiError, activePath, wsTopics, connect, disconnect, sendCommand]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() { return useContext(AppContext); }
