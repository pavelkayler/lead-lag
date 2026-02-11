import { Table } from 'react-bootstrap';

export function PositionsTable({ positions = [] }) {
  return (
    <Table striped bordered size="sm">
      <thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Opened</th></tr></thead>
      <tbody>
        {positions.map((p, i) => (
          <tr key={`${p.symbol}-${i}`}>
            <td>{p.symbol}</td><td>{p.side}</td><td>{p.qty}</td><td>{p.entryPrice}</td><td>{p.openedAt ? new Date(p.openedAt).toLocaleString() : '-'}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
