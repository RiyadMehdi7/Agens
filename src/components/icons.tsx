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
