import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, Form, Row } from 'react-bootstrap';
import { useApp } from '../../app/providers/AppProviders';

export function RangeConfigPage() {
  const app = useApp();
  const [schema, setSchema] = useState([]);
  const [cfg, setCfg] = useState({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await app.sendCommand('getRangeConfigSchema');
      const c = await app.sendCommand('getRangeConfig');
      setSchema(s?.fields || []);
      setCfg(c || {});
    })().catch((e) => app.setUiError(String(e?.message || e)));
  }, [app]);

  const grouped = useMemo(() => (schema || []).reduce((acc, f) => {
    if (f.advanced && !showAdvanced) return acc;
    const key = f.group || 'Other';
    acc[key] ||= [];
    acc[key].push(f);
    return acc;
  }, {}), [schema, showAdvanced]);

  const onSave = async () => {
    const next = await app.sendCommand('setRangeConfig', cfg);
    setCfg(next);
  };

  return <Card body>
    <div className='d-flex justify-content-between align-items-center mb-3'>
      <h5 className='mb-0'>Range Liquidity Bot — Config</h5>
      <Form.Check type='switch' label='Advanced' checked={showAdvanced} onChange={(e) => setShowAdvanced(e.target.checked)} />
    </div>
    {Object.entries(grouped).map(([group, fields]) => <div key={group} className='mb-3'>
      <h6>{group}</h6>
      <Row>
        {fields.map((f) => <Col md={6} key={f.key} className='mb-2'>
          <Form.Label>{f.label}</Form.Label>
          {f.enum ? <Form.Select value={cfg[f.key] ?? f.default} onChange={(e) => setCfg((p) => ({ ...p, [f.key]: e.target.value }))}>{f.enum.map((v) => <option key={v}>{v}</option>)}</Form.Select> : typeof f.default === 'boolean' ? <Form.Check type='switch' checked={Boolean(cfg[f.key] ?? f.default)} onChange={(e) => setCfg((p) => ({ ...p, [f.key]: e.target.checked }))} /> : <Form.Control type='number' value={cfg[f.key] ?? f.default ?? ''} onChange={(e) => setCfg((p) => ({ ...p, [f.key]: Number(e.target.value) }))} />}
          <div className='small text-muted'>{f.description}</div>
        </Col>)}
      </Row>
    </div>)}
    <Button onClick={onSave}>Сохранить конфиг</Button>
  </Card>;
}
