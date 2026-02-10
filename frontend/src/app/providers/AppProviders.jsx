import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const AppContext = createContext(null);
const DEFAULT_WS_URL = "ws://localhost:8080";

function makeId(type) { return `${type}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`; }

export function AppProviders({ children }) {
  const wsRef = useRef(null);
  const pendingRef = useRef(new Map());
  const pollRef = useRef(null);

  const [wsUrl, setWsUrl] = useState(DEFAULT_WS_URL);
  const [status, setStatus] = useState("disconnected");
  const [clientId, setClientId] = useState(null);
  const [feedMaxSymbols, setFeedMaxSymbols] = useState(50);
  const [symbols, setSymbolsState] = useState([]);
  const [prices, setPrices] = useState({});
  const [leadlag, setLeadlag] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [bars, setBars] = useState({});
  const [paperTest, setPaperTest] = useState(null);
  const [tradeState, setTradeState] = useState(null);
  const [tradingStatus, setTradingStatus] = useState({ trading: false, mode: "demo" });
  const [uiError, setUiError] = useState("");

  const sendCommand = useCallback((type, payload = {}, timeoutMs = 8000) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return Promise.reject(new Error("WS не подключён"));
    const id = makeId(type);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        pendingRef.current.delete(id);
        reject(new Error(`Timeout ${type}`));
      }, timeoutMs);
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
        setFeedMaxSymbols(st.feedMaxSymbols || 50);
        setSymbolsState(st.feed?.symbols || []);
      } catch (e) { console.error("[ACTION] getStatus error", e); }
    };
    ws.onclose = () => { setStatus("disconnected"); setClientId(null); };
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
      if (msg.topic === "price") setPrices((prev) => ({ ...prev, [msg.payload.symbol]: msg.payload }));
      if (msg.topic === "leadlag") setLeadlag(msg.payload?.top || []);
      if (msg.topic === "metrics") setMetrics(msg.payload || null);
      if (msg.topic === "bar") {
        const s = msg.payload?.symbol;
        if (!s) return;
        setBars((prev) => ({ ...prev, [s]: [...(prev[s] || []), msg.payload].slice(-480) }));
      }
      if (msg.topic === "paperTest") setPaperTest(msg.payload);
      if (msg.topic === "tradeState") setTradeState(msg.payload);
    };
  }, [sendCommand, wsUrl]);

  const disconnect = useCallback(() => { try { wsRef.current?.close(); } catch {} }, []);

  const action = useCallback(async (name, fn) => {
    try {
      const res = await fn();
      console.log(`[ACTION] ${name} success`, res);
      setUiError("");
      return res;
    } catch (e) {
      console.error(`[ACTION] ${name} error`, e);
      setUiError(e.message || "Ошибка");
      throw e;
    }
  }, []);

  const subscribe = (topic) => action("subscribe", () => sendCommand("subscribe", { topic }));
  const unsubscribe = (topic) => action("unsubscribe", () => sendCommand("unsubscribe", { topic }));
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

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      if (status !== "connected") return;
      try {
        const res = await fetch("http://localhost:8080/results/latest");
        if (res.ok) setPaperTest(await res.json());
      } catch {}
    }, 10000);
    return () => clearInterval(pollRef.current);
  }, [status]);

  const value = useMemo(() => ({
    wsUrl, setWsUrl, status, clientId, feedMaxSymbols, symbols, prices, leadlag, metrics, bars, paperTest, tradeState, tradingStatus, uiError, setUiError,
    connect, disconnect, sendCommand, subscribe, unsubscribe, setSymbols, startFeed, stopFeed, startPaperTest, stopPaperTest,
    startTrading, stopTrading, createHedgeOrders, getOpenOrders, cancelAllOrders, closeAllPositions, getTradingStatus,
  }), [wsUrl, status, clientId, feedMaxSymbols, symbols, prices, leadlag, metrics, bars, paperTest, tradeState, tradingStatus, uiError, connect, disconnect, sendCommand]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() { return useContext(AppContext); }
