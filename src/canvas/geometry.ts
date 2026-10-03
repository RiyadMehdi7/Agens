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

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * Squarified treemap. Returns one rectangle per input value, in input order, inside `bounds`.
 * Values must be non-negative; zero values get an empty rectangle.
 */
export function squarify(values: number[], bounds: Rect = { x: 0, y: 0, w: 100, h: 100 }): Rect[] {
  const total = values.reduce((a, v) => a + v, 0);
  const out: Rect[] = values.map(() => ({ x: bounds.x, y: bounds.y, w: 0, h: 0 }));
  if (total <= 0) return out;
  const scale = (bounds.w * bounds.h) / total;
  const order = values.map((v, i) => ({ i, a: v * scale })).filter(d => d.a > 0).sort((a, b) => b.a - a.a);
  let rect = { ...bounds };
  const worst = (row: number[], side: number) => {
    const sum = row.reduce((a, v) => a + v, 0);
    return Math.max(...row.map(v => Math.max((side * side * v) / (sum * sum), (sum * sum) / (side * side * v))));
  };
  const place = (row: typeof order) => {
    const sum = row.reduce((a, d) => a + d.a, 0);
    if (rect.w >= rect.h) {
      const w = sum / rect.h;
      let y = rect.y;
      for (const d of row) { const h = d.a / w; out[d.i] = { x: rect.x, y, w, h }; y += h; }
      rect = { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h };
    } else {
      const h = sum / rect.w;
      let x = rect.x;
      for (const d of row) { const w = d.a / h; out[d.i] = { x, y: rect.y, w, h }; x += w; }
      rect = { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h };
    }
  };
  let row: typeof order = [];
  for (const d of order) {
    const side = Math.min(rect.w, rect.h);
    if (!row.length || worst([...row, d].map(r => r.a), side) <= worst(row.map(r => r.a), side)) row.push(d);
    else { place(row); row = [d]; }
  }
  if (row.length) place(row);
  return out;
}

export interface Arc { start: number; length: number }
/** Donut slices as fractions of the circle (0..1). Values must be non-negative. */
export function pieArcs(values: number[]): Arc[] {
  const total = values.reduce((a, v) => a + v, 0) || 1;
  let start = 0;
  return values.map(v => { const arc = { start, length: v / total }; start += arc.length; return arc; });
}

export interface SankeyNode { name: string; y: number; h: number; total: number }
export interface SankeyLink { source: number; target: number; value: number; sy: number; sh: number; ty: number; th: number }

/**
 * Two-column sankey in a 0..100 vertical space: sources left, targets right.
 * Node heights and link bands are proportional to value; `gap` separates nodes on each side.
 */
export function sankeyLayout(input: { source: string; target: string; value: number }[], gap = 3) {
  const total = input.reduce((a, l) => a + l.value, 0);
  const column = (key: 'source' | 'target') => {
    const totals = new Map<string, number>();
    for (const l of input) totals.set(l[key], (totals.get(l[key]) ?? 0) + l.value);
    const scale = total > 0 ? Math.max(0, 100 - gap * (totals.size - 1)) / total : 0;
    let y = 0;
    const nodes: SankeyNode[] = [...totals].map(([name, t]) => {
      const node = { name, y, h: t * scale, total: t };
      y += node.h + gap;
      return node;
    });
    return { nodes, scale, cursor: nodes.map(n => n.y) };
  };
  const left = column('source');
  const right = column('target');
  const links: SankeyLink[] = input.map(l => ({
    source: left.nodes.findIndex(n => n.name === l.source), target: right.nodes.findIndex(n => n.name === l.target),
    value: l.value, sy: 0, sh: l.value * left.scale, ty: 0, th: l.value * right.scale,
  }));
  // Stack bands in the order of the node they lead to, which keeps crossings to a minimum.
  for (const l of [...links].sort((a, b) => a.source - b.source || a.target - b.target)) { l.sy = left.cursor[l.source]!; left.cursor[l.source]! += l.sh; }
  for (const l of [...links].sort((a, b) => a.target - b.target || a.source - b.source)) { l.ty = right.cursor[l.target]!; right.cursor[l.target]! += l.th; }
  return { left: left.nodes, right: right.nodes, links };
}
