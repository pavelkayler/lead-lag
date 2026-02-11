import { useEffect, useMemo, useState } from 'react';
import { Container } from 'react-bootstrap';
import { Navigate, Route, Routes } from 'react-router-dom';
import { WsRpcClient } from './api/wsClient';
import { AppNavBar } from './components/NavBar';
import { Toasts } from './components/Toasts';
import { Dashboard } from './routes/Dashboard';
import { ConfigRoute } from './routes/Config';
import { SymbolsRoute } from './routes/Symbols';
import { PositionsRoute } from './routes/Positions';
import { LogsRoute } from './routes/Logs';

export default function App() {
  const rpc = useMemo(() => new WsRpcClient('/ws'), []);
  const [status, setStatus] = useState({});
  const [schema, setSchema] = useState(null);
  const [config, setConfig] = useState(null);
  const [universe, setUniverse] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [logs, setLogs] = useState([]);
  const [toasts, setToasts] = useState([]);

  const notify = (text, variant = 'dark') => setToasts((t) => [...t, { id: `${Date.now()}-${Math.random()}`, text, variant }]);

  useEffect(() => {
    rpc.connect();
    const unsub = rpc.onEvent((evt) => {
      const payload = evt.payload || {};
      setLogs((l) => [payload, ...l].slice(0, 200));
      if (payload.kind === 'status') setStatus(payload);
      if (payload.kind === 'candidates') setCandidates(payload.candidates || []);
      if (payload.kind === 'positionUpdate') setPositions(payload.positions || []);
      if (payload.kind === 'execution') notify(`Execution: ${JSON.stringify(payload).slice(0, 120)}`, 'info');
    });

    const load = async () => {
      setSchema(await rpc.call('getConfigSchema'));
      setConfig(await rpc.call('getConfig'));
      setStatus(await rpc.call('getStatus'));
      setUniverse(await rpc.call('getUniverse'));
      setCandidates(await rpc.call('getCandidates'));
      setPositions(await rpc.call('getPositions'));
      setOrders(await rpc.call('getOpenOrders'));
    };

    const timer = setTimeout(() => load().catch((e) => notify(e.message, 'danger')), 300);
    const poll = setInterval(() => {
      rpc.call('getStatus').then(setStatus).catch(() => {});
      rpc.call('getPositions').then(setPositions).catch(() => {});
      rpc.call('getOpenOrders').then(setOrders).catch(() => {});
      rpc.call('getUniverse').then(setUniverse).catch(() => {});
    }, 3000);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      unsub();
    };
  }, [rpc]);

  return (
    <>
      <AppNavBar />
      <Container>
        <Routes>
          <Route path="/" element={<Dashboard status={status} candidates={candidates} rpc={rpc} notify={notify} />} />
          <Route path="/config" element={<ConfigRoute schema={schema} config={config} rpc={rpc} notify={notify} />} />
          <Route path="/symbols" element={<SymbolsRoute universe={universe} candidates={candidates} />} />
          <Route path="/positions" element={<PositionsRoute positions={positions} orders={orders} />} />
          <Route path="/logs" element={<LogsRoute logs={logs} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Container>
      <Toasts toasts={toasts} remove={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </>
  );
}
