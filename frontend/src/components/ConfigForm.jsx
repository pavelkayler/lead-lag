import { useMemo, useState } from 'react';
import { Button, Card, Col, Form, Row } from 'react-bootstrap';

export function ConfigForm({ schema, config, onSave }) {
  const [advanced, setAdvanced] = useState(false);
  const [draft, setDraft] = useState(config || {});

  useMemo(() => setDraft(config || {}), [config]);

  if (!schema) return null;

  return (
    <>
      <Form.Check className="mb-2" label="Show advanced" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
      {schema.groups.map((group) => (
        <Card key={group.id} className="mb-3">
          <Card.Body>
            <Card.Title>{group.title}</Card.Title>
            {group.fields.filter((f) => advanced || !f.advanced).map((field) => (
              <Form.Group as={Row} className="mb-2" key={field.key}>
                <Form.Label column sm={3}>{field.key}</Form.Label>
                <Col sm={4}>
                  {field.type === 'boolean' ? (
                    <Form.Check checked={Boolean(draft[field.key])} onChange={(e) => setDraft({ ...draft, [field.key]: e.target.checked })} />
                  ) : (
                    <Form.Control type="number" min={field.min} max={field.max} step={field.step} value={draft[field.key]} onChange={(e) => setDraft({ ...draft, [field.key]: Number(e.target.value) })} />
                  )}
                </Col>
                <Col sm={5}><small>{field.description} ({field.unit || 'flag'})</small></Col>
              </Form.Group>
            ))}
          </Card.Body>
        </Card>
      ))}
      <Button onClick={() => onSave(draft)}>Save config</Button>
    </>
  );
}
