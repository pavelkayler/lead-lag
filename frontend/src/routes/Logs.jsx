export function LogsRoute({ logs }) {
  return <pre style={{ maxHeight: 600, overflow: 'auto' }}>{logs.map((l) => JSON.stringify(l)).join('\n')}</pre>;
}
