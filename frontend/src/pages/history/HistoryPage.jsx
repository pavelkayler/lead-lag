import { Button, Card, Col, Row, Table } from "react-bootstrap";

export function HistoryPage() {
  const paper = JSON.parse(localStorage.getItem("paperHistory") || "[]");
  return <Row className="g-3"><Col md={12}><Card body><h6>Lead-Lag Bot</h6><Table size="sm"><thead><tr><th>runId</th><th>netPnlUSDT</th><th></th></tr></thead><tbody>{paper.map((r,i)=><tr key={i}><td>{r.runId}</td><td>{Number(r.netPnlUSDT||0).toFixed(4)}</td><td><Button size="sm" onClick={()=>localStorage.setItem('llPreset',JSON.stringify(r.preset||{}))}>Копировать настройки</Button></td></tr>)}</tbody></Table></Card></Col><Col md={12}><Card body><h6>Hedge</h6><div>История групп хранится в localStorage при интеграции tradeState.</div></Card></Col></Row>;
}
