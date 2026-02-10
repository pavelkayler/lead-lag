import { useEffect, useMemo, useState } from "react";
import { Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

const FALLBACK_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

export function HedgePage() {
  const app = useApp();
  const symbols = app.symbols?.length ? app.symbols : FALLBACK_SYMBOLS;
  const [symbol, setSymbol] = useState(symbols[0]);
  const [offsetPercent, setOffsetPercent] = useState(1);
  const [tp, setTp] = useState(1);
  const [sl, setSl] = useState(2);

  useEffect(() => {
    if (!symbols.includes(symbol)) setSymbol(symbols[0]);
  }, [symbols, symbol]);

  const invalid = sl <= tp;
  const bars = app.bars[symbol] || [];
  const stats = useMemo(() => { const v = bars.map((b)=>Number(b.mid||b.close||0)).filter(Boolean); if(!v.length) return null; const avg=v.reduce((a,b)=>a+b,0)/v.length; return {min:Math.min(...v),max:Math.max(...v),avg,vol:Math.sqrt(v.reduce((a,x)=>a+(x-avg)**2,0)/v.length)}; }, [bars]);

  return <Row className="g-3"><Col md={12}><Card body>
    <div className="d-flex gap-2 flex-wrap align-items-end">
      <div>
        <Form.Label>Пара</Form.Label>
        <Form.Select value={symbol} onChange={(e)=>setSymbol(e.target.value)} style={{maxWidth:180}}>{symbols.map((s) => <option key={s} value={s}>{s}</option>)}</Form.Select>
      </div>
      <div>
        <Form.Label>Offset (%)</Form.Label>
        <Form.Control type="number" placeholder="Offset (%)" value={offsetPercent} onChange={(e)=>setOffsetPercent(Number(e.target.value))} style={{maxWidth:130}} />
      </div>
      <div>
        <Form.Label>TP (ROI %)</Form.Label>
        <Form.Control type="number" placeholder="TP (ROI %)" value={tp} onChange={(e)=>setTp(Number(e.target.value))} style={{maxWidth:130}} />
      </div>
      <div>
        <Form.Label>SL (ROI %)</Form.Label>
        <Form.Control type="number" placeholder="SL (ROI %)" value={sl} onChange={(e)=>setSl(Number(e.target.value))} style={{maxWidth:130}} />
      </div>
      <Button disabled={invalid} onClick={()=>app.createHedgeOrders({symbol,offsetPercent,takeProfit:{type:'roiPct',value:tp},stopLoss:{type:'roiPct',value:sl}})}>Открыть сделки</Button>
    </div>
    {invalid && <div className="text-danger mt-2">SL должен быть больше TP</div>}
  </Card></Col>
  <Col md={12}><Card body><h6>Статистика по паре</h6><Table size="sm" style={{ tableLayout: "fixed" }}><tbody>{stats && Object.entries(stats).map(([k,v])=><tr key={k}><td style={{ width: "40%" }}>{k}</td><td style={{ width: "60%", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Number(v).toFixed(6)}</td></tr>)}</tbody></Table></Card></Col></Row>;
}
