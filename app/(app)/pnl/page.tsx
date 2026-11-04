import { Suspense } from 'react';
import Link from 'next/link';
import { Card, PageHeader, PageLoading } from '@/components/ui';
import { requireCompany } from '@/lib/company';
import { eur, monthLabel } from '@/lib/format';
import { COST_LINES, getPnl } from '@/lib/reports';

export default function PnlPage() {
  return <Suspense fallback={<PageLoading />}><Pnl /></Suspense>;
}

async function Pnl() {
  const { company } = await requireCompany();
  const { months, series, groups, revenueGroups, isRevenue, get, hasReview } = await getPnl(company.id);
  const costLines = [...COST_LINES, ...groups.filter((g) => !isRevenue(g) && !(COST_LINES as readonly string[]).includes(g))];

  const cell = (group: string, m: string, value: number) => {
    const href = `/r/transactions?pnlGroup=${encodeURIComponent(group)}&period=${m.slice(0, 7)}`;
    if (!value) return <span className="text-muted">-</span>;
    return (
      <Link href={href} className="hover:underline" title="Open the entries behind this number">
        {eur(Math.abs(value))}
        {hasReview(group, m) && <span className="ml-1 text-warn-ink" title="Includes entries that need review">•</span>}
      </Link>
    );
  };
  const total = (fn: (m: string) => number) => months.reduce((a, m) => a + fn(m), 0);
  const section = (label: string) => (
    <tr><td colSpan={months.length + 2} className="pt-4 text-xs font-medium uppercase tracking-wide text-muted">{label}</td></tr>
  );
  const line = (label: string, group: string) => (
    <tr key={group}>
      <td className="sticky left-0 bg-surface whitespace-nowrap">{label}</td>
      {months.map((m) => <td key={m} className="text-right">{cell(group, m, get(group, m))}</td>)}
      <td className="text-right">{eur(Math.abs(total((m) => get(group, m))))}</td>
    </tr>
  );
  const totalRow = (label: string, values: number[], tone = false) => (
    <tr className="font-semibold">
      <td className="sticky left-0 bg-surface whitespace-nowrap">{label}</td>
      {values.map((v, i) => <td key={months[i]} className={`text-right ${tone ? (v < 0 ? 'text-bad' : 'text-good') : ''}`}>{eur(v)}</td>)}
      <td className="text-right">{eur(values.reduce((a, v) => a + v, 0))}</td>
    </tr>
  );

  return (
    <>
      <PageHeader
        title="Profit & loss"
        subtitle="Built from the ledger. Each row is a P&L line from Categories. Click a number to see the entries behind it. • marks a number that includes entries needing review."
      />
      <Card>
        <div className="overflow-x-auto">
          <table className="data-table num">
            <thead>
              <tr>
                <th className="sticky left-0 bg-surface">EUR</th>
                {months.map((m) => <th key={m} className="text-right">{monthLabel(m)}</th>)}
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {section('Revenue')}
              {revenueGroups.map((g) => line(g === 'Revenue' ? 'Staffing' : g, g))}
              {totalRow('Total revenue', series.map((s) => s.revenue))}
              {section('Costs')}
              {costLines.map((g) => line(g, g))}
              {totalRow('Total costs', series.map((s) => s.totalCosts))}
              {totalRow('Profit (loss)', series.map((s) => s.net), true)}
              <tr>
                <td className="sticky left-0 bg-surface">Accumulated</td>
                {series.map((s) => <td key={s.month} className={`text-right ${s.cumulative < 0 ? 'text-bad' : ''}`}>{eur(s.cumulative)}</td>)}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
