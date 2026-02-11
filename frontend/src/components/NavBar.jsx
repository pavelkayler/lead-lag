import { Container, Nav, Navbar } from 'react-bootstrap';
import { Link } from 'react-router-dom';

export function AppNavBar() {
  return (
    <Navbar bg="dark" variant="dark" expand="lg" className="mb-3">
      <Container>
        <Navbar.Brand as={Link} to="/">Range Bot</Navbar.Brand>
        <Nav>
          <Nav.Link as={Link} to="/">Dashboard</Nav.Link>
          <Nav.Link as={Link} to="/config">Config</Nav.Link>
          <Nav.Link as={Link} to="/symbols">Symbols</Nav.Link>
          <Nav.Link as={Link} to="/positions">Positions</Nav.Link>
          <Nav.Link as={Link} to="/logs">Logs</Nav.Link>
        </Nav>
      </Container>
    </Navbar>
  );
}
