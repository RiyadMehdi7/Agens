const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const MicIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
);
export const DatabaseIcon = ({ color = 'currentColor', size = 20 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} stroke={color} aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>
);
export const SheetIcon = ({ color = 'currentColor' }: { color?: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" {...stroke} stroke={color} aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13l4 5M12 13l-4 5" /></svg>
);
export const ApiIcon = ({ color = 'currentColor' }: { color?: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" {...stroke} stroke={color} aria-hidden="true"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16" /></svg>
);
export const SparkIcon = ({ color = 'currentColor' }: { color?: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" {...stroke} stroke={color} aria-hidden="true"><path d="M3 17l5-6 4 4 8-9" /><path d="M15 6h5v5" /></svg>
);
export const PlusIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
);
export const CloseIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} strokeWidth={1.8} aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const ArrowIcon = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...stroke} strokeWidth={1.8} aria-hidden="true">
    {dir === 'left' ? <path d="M15 6l-6 6 6 6" /> : <path d="M9 6l6 6-6 6" />}
  </svg>
);
export const UploadIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" /><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></svg>
);
export const LayersIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M12 3 3 8l9 5 9-5z" /><path d="m3 13 9 5 9-5" /></svg>
);

/** Glyphs for chart types; each is a tiny drawing of the chart itself. */
export const KindIcon = ({ kind }: { kind: string }) => {
  const paths: Record<string, React.ReactNode> = {
    line: <path d="M3 17l5-5 4 3 9-9" />,
    area: <><path d="M3 18l5-6 4 3 9-8v11z" fill="currentColor" fillOpacity=".25" /><path d="M3 18l5-6 4 3 9-8" /></>,
    bar: <><path d="M4 7h10M4 12h16M4 17h7" strokeWidth={2.4} /></>,
    pie: <><circle cx="12" cy="12" r="8" /><path d="M12 4v8l6 5" /></>,
    treemap: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16M12 12h9M16.5 12v8" /></>,
    metric: <path d="M4 18V6M8 18V9M20 6h-8M20 12h-8M20 18h-8" />,
    scatter: <><circle cx="6" cy="16" r="1.4" fill="currentColor" /><circle cx="10" cy="10" r="1.4" fill="currentColor" /><circle cx="14" cy="13" r="1.4" fill="currentColor" /><circle cx="18" cy="6" r="1.4" fill="currentColor" /><path d="M3 3v18h18" strokeOpacity=".5" /></>,
    heatmap: <><rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor" fillOpacity=".7" /><rect x="13" y="3" width="8" height="8" rx="1.5" fill="currentColor" fillOpacity=".25" /><rect x="3" y="13" width="8" height="8" rx="1.5" fill="currentColor" fillOpacity=".35" /><rect x="13" y="13" width="8" height="8" rx="1.5" fill="currentColor" fillOpacity=".9" /></>,
    sankey: <><path d="M3 6c9 0 9 8 18 8M3 12c9 0 9-6 18-6M3 18c9 0 9 0 18 0" /></>,
    table: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M10 4v16" /></>,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">{paths[kind]}</svg>;
};
export const RefreshIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} strokeWidth={1.8} aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>
);
export const ArrowRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...stroke} strokeWidth={1.8} aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
