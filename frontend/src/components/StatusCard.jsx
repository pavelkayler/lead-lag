import { Card, Col, Row } from 'react-bootstrap';

export function StatusCard({ status }) {
  const rows = [
    ['Mode', status.tradingMode],
    ['ENABLE_TRADING', status.enableTrading],
    ['BYBIT_ENV', status.bybitEnv],
    ['Symbols', status.symbols],
    ['Candidates', status.candidates],
    ['Positions', status.positions],
    ['Last signal', status.lastSignalTime ? new Date(status.lastSignalTime).toLocaleString() : '—']
  ];
  return (
    <Card>
      <Card.Body>
        <Card.Title>Status</Card.Title>
        {rows.map(([k, v]) => (
          <Row key={k} className="mb-1">
            <Col xs={5}><strong>{k}</strong></Col>
            <Col>{String(v ?? '—')}</Col>
          </Row>
        ))}
      </Card.Body>
    </Card>
  );
}
