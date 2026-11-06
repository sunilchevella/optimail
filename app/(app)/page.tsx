import { Suspense } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { GroupedBars, HorizontalBars, SingleLine, StackedBars } from '@/components/charts/Charts';
import RangePicker from '@/components/RangePicker';
import { Card, PageHeader, PageLoading } from '@/components/ui';
import { requireCompany } from '@/lib/company';
import { dateLabel, eur, monthLabel, money, todayMonth } from '@/lib/format';
import { COST_LINES, getPnl, getReceivables, getTopClients, getToolStats, getTotals } from '@/lib/reports';

const RANGES = [
  { value: 'all', label: 'All time' },
  { value: '6', label: 'Last 6 months' },
  { value: '3', label: 'Last 3 months' },
  { value: 'custom', label: 'Custom range' },
];

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export default function DashboardPage(props: PageProps<'/'>) {
  return <Suspense fallback={<PageLoading />}><Dashboard {...props} /></Suspense>;
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: React.ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-ink-2">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight ${tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : ''}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

async function Dashboard({ searchParams }: PageProps<'/'>) {
  const { company } = await requireCompany();
  const sp = await searchParams;
  const range = typeof sp.range === 'string' && ['6', '3', 'custom'].includes(sp.range) ? sp.range : 'all';

  const [pnl, totals, receivables, topClients, tools] = await Promise.all([
    getPnl(company.id), getTotals(company.id), getReceivables(company.id), getTopClients(company.id), getToolStats(company.id),
  ]);
  const current = `${todayMonth()}-01`;
  const firstMonth = pnl.series[0]?.month.slice(0, 7) ?? todayMonth();
  const lastMonth = pnl.series.at(-1)?.month.slice(0, 7) ?? todayMonth();
  let from = typeof sp.from === 'string' && MONTH_RE.test(sp.from) ? sp.from : firstMonth;
  let to = typeof sp.to === 'string' && MONTH_RE.test(sp.to) ? sp.to : lastMonth;
  if (from > to) [from, to] = [to, from];
  const shown = range === 'all' ? pnl.series
    : range === 'custom' ? pnl.series.filter((s) => s.month >= `${from}-01` && s.month <= `${to}-01`)
    : pnl.series.slice(-Number(range));
  const rangeLabel = range === 'custom'
    ? (from === to ? monthLabel(from) : `${monthLabel(from)} to ${monthLabel(to)}`)
    : RANGES.find((r) => r.value === range)!.label.toLowerCase();
  const complete = pnl.series.filter((s) => s.month < current);
  const last3 = complete.slice(-3);
  const burn = last3.length ? last3.reduce((a, s) => a + (s.totalCosts - s.revenue), 0) / last3.length : 0;
  const revenue = shown.reduce((a, s) => a + s.revenue, 0);
  const costs = shown.reduce((a, s) => a + s.totalCosts, 0);
  const cumulative = pnl.series.at(-1)?.cumulative ?? 0;
  const owed = receivables.reduce((a, r) => a + Number(r.outstanding_eur), 0);
  const toolRunRate = tools.filter((t) => t.status === 'active').reduce((a, t) => a + t.monthly, 0);
  const toolUnknown = tools.filter((t) => t.status === 'unknown').reduce((a, t) => a + t.monthly, 0);
  const runway = totals.wiseBalance !== null && burn > 0 ? totals.wiseBalance / burn : null;
  const first = pnl.series[0]?.month;

  const chartData = shown.map((s) => ({
    label: monthLabel(s.month, shown.length > 6) + (s.month === current ? '*' : ''),
    revenue: Math.round(s.revenue),
    costs: Math.round(s.totalCosts),
    ...Object.fromEntries(COST_LINES.map((g) => [g, Math.round(s.costs[g])])),
  }));
  const cumulativeData = pnl.series.map((s) => ({ label: monthLabel(s.month, true), cumulative: Math.round(s.cumulative) }));
  const toolBars = tools.filter((t) => Number(t.total_paid) > 0).slice(0, 10).map((t) => ({ label: t.name, value: Number(t.total_paid) }));

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${company.name}, all amounts in EUR. ${first ? `Books start ${monthLabel(first)}.` : ''}`}
        actions={
          <RangePicker options={RANGES} range={range} from={from} to={to} min={firstMonth} max={lastMonth} />
        }
      />

      {totals.reviewCount > 0 && (
        <Link href="/r/transactions?status=review" className="mb-4 flex items-center gap-2 rounded-lg bg-warn-bg px-4 py-3 text-sm text-warn-ink hover:underline">
          <AlertTriangle size={16} aria-hidden />
          <span><strong>{totals.reviewCount} entries need review</strong> ({eur(totals.reviewEur)}): kept as recorded, with a note on what is unclear.</span>
        </Link>
      )}

      <section className="card mb-4 flex flex-wrap items-end justify-between gap-6 p-5">
        <div>
          <p className="text-sm font-medium text-ink-2">Result since {first ? monthLabel(first) : 'the start'}</p>
          <p className={`mt-1 text-5xl font-semibold tracking-tight ${cumulative < 0 ? 'text-bad' : 'text-good'}`}>{eur(cumulative)}</p>
          <p className="mt-2 text-sm text-ink-2">P&L result, every month added up.</p>
        </div>
        <dl className="text-sm">
          <div><dt className="text-xs text-muted">Refundable deposits</dt><dd className="font-semibold">{eur(totals.deposits)}</dd></div>
        </dl>
      </section>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={`Revenue, P&L (${rangeLabel})`} value={eur(revenue)} />
        <Stat label="Costs" value={eur(costs)} note={`Result ${eur(revenue - costs)}`} tone={revenue - costs < 0 ? 'bad' : 'good'} />
        <Stat
          label="Monthly burn"
          value={eur(burn)}
          note={last3.length ? `Average of ${last3.map((s) => monthLabel(s.month, true)).join(', ')} (costs minus revenue)` : undefined}
        />
        <Stat
          label="Runway"
          value={runway !== null ? `${runway.toFixed(1)} months` : 'Not set'}
          note={runway !== null
            ? `Wise balance ${eur(totals.wiseBalance)} / monthly burn`
            : <Link href="/r/accounts?provider=Wise" className="text-accent hover:underline">Add the Wise opening balance to see runway</Link>}
        />
        <Stat label="Owed by clients" value={eur(owed)} note={`${receivables.length} open invoices`} />
        <Stat label="Tools per month" value={eur(toolRunRate)} note={toolUnknown ? `+ ${eur(toolUnknown)} for tools with unknown status` : 'Active subscriptions + average credits'} />
        <Stat label="Team cost per month" value={eur(complete.at(-1)?.costs.Manpower ?? 0)} note={complete.at(-1) ? `Manpower in ${monthLabel(complete.at(-1)!.month)}` : undefined} />
        <Stat label="Cash received from clients" value={eur(totals.cashIn)} note={`Cash paid out, all time ${eur(totals.cashOut)}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Revenue vs costs by month">
          <GroupedBars data={chartData} series={[{ key: 'revenue', label: 'Revenue (P&L)' }, { key: 'costs', label: 'Costs' }]} />
          <p className="mt-2 text-xs text-muted">* current month, still in progress.</p>
        </Card>
        <Card title="Where the money goes">
          <StackedBars data={chartData} series={COST_LINES.map((g) => ({ key: g, label: g }))} />
        </Card>
        <Card title="Result since the start, month by month">
          <SingleLine data={cumulativeData} dataKey="cumulative" label="Cumulative result" />
        </Card>
        <Card title="Tools, total paid" actions={<Link href="/tools" className="text-xs text-accent hover:underline">All tools</Link>}>
          <HorizontalBars data={toolBars} />
        </Card>
        <Card title="Owed by clients" actions={<Link href="/r/invoices?status=sent" className="text-xs text-accent hover:underline">Open invoices</Link>}>
          {receivables.length === 0 ? <p className="text-sm text-muted">Nothing outstanding.</p> : (
            <div className="overflow-x-auto"><table className="data-table">
              <thead><tr><th>Invoice</th><th>Client</th><th>Issued</th><th className="text-right">Owed</th><th className="text-right">EUR</th><th className="text-right">Days</th></tr></thead>
              <tbody>
                {receivables.map((r) => (
                  <tr key={r.invoice_id}>
                    <td><Link href={`/r/invoices/${r.invoice_id}`} className="font-medium text-accent hover:underline">{r.number}</Link></td>
                    <td>{r.client}</td>
                    <td className="whitespace-nowrap">{dateLabel(r.issue_date)}</td>
                    <td className="num text-right">{money(Number(r.outstanding), r.currency)}</td>
                    <td className="num text-right">{eur(Number(r.outstanding_eur))}</td>
                    <td className="num text-right">{r.days_overdue}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>
        <Card title="Top clients by money received">
          <table className="data-table">
            <thead><tr><th>Client</th><th className="text-right">Projects</th><th className="text-right">Received</th></tr></thead>
            <tbody>
              {topClients.map((c) => (
                <tr key={c.client_id}>
                  <td><Link href={`/r/clients/${c.client_id}`} className="text-accent hover:underline">{c.name}</Link></td>
                  <td className="num text-right">{c.projects}</td>
                  <td className="num text-right">{eur(Number(c.collected))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
