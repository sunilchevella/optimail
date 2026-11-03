const eurFmt = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eurFmt2 = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numFmt = new Intl.NumberFormat('en-IE', { maximumFractionDigits: 2 });

export const eur = (n: number | null | undefined, cents = false) =>
  n === null || n === undefined ? '' : (cents ? eurFmt2 : eurFmt).format(n);

export const num = (n: number | null | undefined) => (n === null || n === undefined ? '' : numFmt.format(n));

export const money = (n: number | null | undefined, currency: string) => {
  if (n === null || n === undefined) return '';
  try {
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);
  } catch {
    return `${numFmt.format(n)} ${currency}`;
  }
};

// Compact axis labels: 0, 1K, 12.5K.
export const compactEur = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1000 ? `${(a / 1000).toFixed(a >= 10000 ? 0 : 1).replace(/\.0$/, '')}K` : `${Math.round(a)}`;
  return `${n < 0 ? '-' : ''}€${s}`;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// '2026-04-01' or '2026-04' -> 'Apr 2026' (or 'Apr' when short).
export const monthLabel = (d: string, short = false) => {
  const [y, m] = d.split('-');
  return short ? MONTHS[Number(m) - 1] : `${MONTHS[Number(m) - 1]} ${y}`;
};

export const dateLabel = (d: string | null | undefined) => {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}`;
};

// Every month from `from` to `to` inclusive, as 'YYYY-MM-01'.
export function monthRange(from: string, to: string) {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}-01`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export const todayMonth = () => new Date().toISOString().slice(0, 7);
