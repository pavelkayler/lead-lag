export function liquidationSpike(values: number[], k = 2.5) {
  if (values.length < 5) return false;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return values[values.length - 1] > mean + k * std;
}
export function volumeZScore(values: number[]) {
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
  const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(values.length, 1));
  return std === 0 ? 0 : (values[values.length - 1] - mean) / std;
}
export function oiDelta(curr: number, prev: number) { return prev === 0 ? 0 : (curr - prev) / prev; }
