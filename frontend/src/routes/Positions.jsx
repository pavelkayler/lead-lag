import { Card } from 'react-bootstrap';
import { PositionsTable } from '../components/PositionsTable';

export function PositionsRoute({ positions, orders }) {
  return (
    <>
      <Card className="mb-3"><Card.Body><Card.Title>Positions</Card.Title><PositionsTable positions={positions} /></Card.Body></Card>
      <Card><Card.Body><Card.Title>Open Orders</Card.Title><pre>{JSON.stringify(orders, null, 2)}</pre></Card.Body></Card>
    </>
  );
}
