import { Table } from 'react-bootstrap';

export function CandidatesTable({ candidates = [] }) {
  return (
    <Table striped bordered size="sm">
      <thead><tr><th>Symbol</th><th>Side</th><th>Reason</th><th>volZ</th><th>LiqL</th><th>LiqS</th></tr></thead>
      <tbody>
        {candidates.map((c, i) => (
          <tr key={`${c.symbol}-${i}`}>
            <td>{c.symbol}</td><td>{c.side}</td><td>{c.reason}</td>
            <td>{c.features?.volZ?.toFixed?.(2)}</td><td>{Math.round(c.features?.liqLong15m || 0)}</td><td>{Math.round(c.features?.liqShort15m || 0)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
