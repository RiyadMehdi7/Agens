export interface BarSpan { left: number; width: number; negative: boolean }

/**
 * Signed bar layout on a shared zero baseline, as percentages of the track.
 * Negative values extend left of zero; nulls draw nothing.
 */
export function barSpans(values: (number | null)[]): { spans: (BarSpan | null)[]; zero: number } {
  const nums = values.filter((v): v is number => v !== null);
  const min = Math.min(0, ...nums);
  const max = Math.max(0, ...nums);
  const range = max - min || 1;
  const zero = ((0 - min) / range) * 100;
  const spans = values.map(v => v === null ? null : {
    left: ((Math.min(v, 0) - min) / range) * 100,
    width: (Math.abs(v) / range) * 100,
    negative: v < 0,
  });
  return { spans, zero };
}
