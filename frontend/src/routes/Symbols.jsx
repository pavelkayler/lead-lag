import { Card, ListGroup } from 'react-bootstrap';
import { CandidatesTable } from '../components/CandidatesTable';

export function SymbolsRoute({ universe, candidates }) {
  return (
    <>
      <Card className="mb-3"><Card.Body><Card.Title>Universe</Card.Title><ListGroup>{universe.map((s) => <ListGroup.Item key={s}>{s}</ListGroup.Item>)}</ListGroup></Card.Body></Card>
      <Card><Card.Body><Card.Title>Candidates</Card.Title><CandidatesTable candidates={candidates} /></Card.Body></Card>
    </>
  );
}
