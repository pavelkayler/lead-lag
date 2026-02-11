export function ok(id, result) {
  return { type: 'response', id, ok: true, result };
}

export function fail(id, code, message, details) {
  return { type: 'response', id, ok: false, error: { code, message, details } };
}
