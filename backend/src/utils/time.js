export function nowIso() {
  return new Date().toISOString();
}

export function minutesAgo(mins) {
  return Date.now() - mins * 60 * 1000;
}
