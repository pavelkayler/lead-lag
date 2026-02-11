export function supportResistance(closes: number[]) {
  const sorted = [...closes].sort((a, b) => a - b);
  return { support: sorted[Math.floor(sorted.length * 0.2)] ?? 0, resistance: sorted[Math.floor(sorted.length * 0.8)] ?? 0 };
}
