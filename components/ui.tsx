import Link from 'next/link';
import type { ReactNode } from 'react';
import { optionLabel, type Field } from '@/lib/resources';
import { dateLabel, eur, monthLabel, num } from '@/lib/format';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const TONES: Record<string, string> = {
  review: 'bg-warn-bg text-warn-ink',
  unknown: 'bg-warn-bg text-warn-ink',
  paid: 'bg-[color-mix(in_srgb,var(--good)_14%,transparent)] text-good',
  confirmed: 'bg-[color-mix(in_srgb,var(--good)_14%,transparent)] text-good',
  active: 'bg-[color-mix(in_srgb,var(--good)_14%,transparent)] text-good',
  applied: 'bg-[color-mix(in_srgb,var(--good)_14%,transparent)] text-good',
  undone: 'bg-surface-2 text-muted line-through',
  completed: 'bg-surface-2 text-ink-2',
  cancelled: 'bg-surface-2 text-muted line-through',
  left: 'bg-surface-2 text-ink-2',
  sent: 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent',
  partially_paid: 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent',
};

export function Badge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONES[value] ?? 'bg-surface-2 text-ink-2'}`}>
      {value === 'review' ? 'Needs review' : optionLabel(value)}
    </span>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-4 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

// Formats one field of a row for display.
export function formatValue(f: Field, row: Record<string, any>, options?: Record<string, { value: number; label: string }[]>) {
  const v = row[f.name];
  if (v === null || v === undefined || v === '') return <span className="text-muted">-</span>;
  switch (f.type) {
    case 'ref': {
      const label = options?.[f.ref!]?.find((o) => o.value === v)?.label ?? `#${v}`;
      return <Link className="text-accent hover:underline" href={`/r/${f.ref}/${v}`}>{label}</Link>;
    }
    case 'computed':
      return <span className="num">{/eur$/i.test(f.name) ? eur(Number(v), true) : num(Number(v))}</span>;
    case 'money':
      return <span className="num">{num(Number(v))}{row.currency && !/eur$/i.test(f.name) ? ` ${row.currency}` : ''}</span>;
    case 'number': case 'rate':
      return <span className="num">{num(Number(v))}</span>;
    case 'date':
      return <span className="whitespace-nowrap">{dateLabel(v)}</span>;
    case 'month':
      return <span className="whitespace-nowrap">{monthLabel(v)}</span>;
    case 'boolean':
      return v ? 'Yes' : 'No';
    case 'select':
      return <Badge value={v} />;
    case 'url': {
      const href = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
      // Show just the site and path: "kangrooo.com/blog", not the full URL.
      const short = href.replace(/^[a-z]+:\/\/(www\.)?/i, '').replace(/\/$/, '');
      return (
        <a className="text-accent hover:underline" href={href} target="_blank" rel="noreferrer" title={href}>
          {short.length > 32 ? `${short.slice(0, 31)}…` : short}
        </a>
      );
    }
    case 'phone':
      return <a className="whitespace-nowrap text-accent hover:underline" href={`tel:${String(v).replace(/[^\d+]/g, '')}`}>{v}</a>;
    case 'whatsapp': {
      const digits = String(v).replace(/\D/g, '');
      return (
        <a className="whitespace-nowrap text-accent hover:underline" href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" title="Open WhatsApp chat">
          {v}
        </a>
      );
    }
    case 'email':
      return <a className="text-accent hover:underline" href={`mailto:${v}`}>{v}</a>;
    default:
      return <span className="whitespace-pre-wrap">{String(v)}</span>;
  }
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">{children}</p>;
}

export function PageLoading() {
  return <div className="h-40 animate-pulse rounded-xl bg-surface-2" aria-label="Loading" />;
}
