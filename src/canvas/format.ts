type Cell = string | number | boolean | null;

const isoDate = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function isIsoDate(value: Cell): value is string {
  return typeof value === 'string' && isoDate.test(value);
}

export function formatNumber(value: number, short = true): string {
  return Math.abs(value) >= 10_000 && short ? compact.format(value) : full.format(value);
}

/** Months render as "Jan 26"; other dates as "Jan 5". Always UTC, matching the evidence. */
export function formatDate(value: string): string {
  const date = new Date(value);
  const monthStart = date.getUTCDate() === 1;
  return date.toLocaleDateString('en-US', monthStart
    ? { month: 'short', year: '2-digit', timeZone: 'UTC' }
    : { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function formatCell(value: Cell, short = true): string {
  if (value === null) return '—';
  if (typeof value === 'number') return formatNumber(value, short);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return isIsoDate(value) ? formatDate(value) : value;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}
