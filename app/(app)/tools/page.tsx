import { Suspense } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Badge, Card, PageHeader, PageLoading } from '@/components/ui';
import { can } from '@/lib/auth';
import { requireCompany } from '@/lib/company';
import { dateLabel, eur } from '@/lib/format';
import { getToolStats } from '@/lib/reports';

export default function ToolsPage() {
  return <Suspense fallback={<PageLoading />}><Tools /></Suspense>;
}

async function Tools() {
  const { user, company } = await requireCompany();
  const tools = await getToolStats(company.id);
  const active = tools.filter((t) => t.status === 'active');
  const unknown = tools.filter((t) => t.status === 'unknown');
  const sum = (list: typeof tools, f: (t: (typeof tools)[number]) => number) => list.reduce((a, t) => a + f(t), 0);
  const soon = tools.filter((t) => t.renews_soon);

  return (
    <>
      <PageHeader
        title="Tools"
        subtitle="Subscriptions and credit accounts, with what each costs per month now and everything paid so far."
        actions={can(user, 'create') && <Link href="/r/tools/new" className="btn btn-primary"><Plus size={16} aria-hidden /> New tool</Link>}
      />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs font-medium text-ink-2">Per month now (active tools)</p>
          <p className="mt-1 text-2xl font-semibold">{eur(sum(active, (t) => t.monthly))}</p>
          <p className="mt-1 text-xs text-muted">Monthly plans + yearly plans / 12 + average credit top-ups</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium text-ink-2">Tools with unknown status</p>
          <p className="mt-1 text-2xl font-semibold">{eur(sum(unknown, (t) => t.monthly))}</p>
          <p className="mt-1 text-xs text-muted">{unknown.map((t) => t.name).join(', ') || 'None'}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium text-ink-2">Paid for tools, all time</p>
          <p className="mt-1 text-2xl font-semibold">{eur(sum(tools, (t) => Number(t.total_paid)))}</p>
          <p className="mt-1 text-xs text-muted">{sum(tools, (t) => t.payments)} payments</p>
        </div>
      </div>
      {soon.length > 0 && (
        <p className="mb-4 rounded-lg bg-warn-bg px-4 py-3 text-sm text-warn-ink">
          Renewing in the next 90 days: {soon.map((t) => `${t.name} (${dateLabel(t.renewal_date)})`).join(', ')}
        </p>
      )}
      <Card>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Tool</th><th>Billing</th><th>Status</th><th>Login</th><th>Paid with</th>
                <th className="text-right">Per month now</th><th className="text-right">Total paid</th>
                <th className="text-right">Payments</th><th>Last paid</th><th>Renews</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/r/tools/${t.id}`} className="font-medium text-accent hover:underline">{t.name}</Link>
                    {t.notes && <p className="mt-0.5 max-w-xs text-xs text-muted">{t.notes}</p>}
                  </td>
                  <td>{t.billing_cycle.replace('_', ' ')}</td>
                  <td><Badge value={t.status} /></td>
                  <td className="text-xs">{t.login_email ?? '-'}</td>
                  <td className="text-xs">{t.account ?? '-'}</td>
                  <td className="num text-right">{t.monthly ? eur(t.monthly) : '-'}</td>
                  <td className="num text-right">{eur(Number(t.total_paid), true)}</td>
                  <td className="num text-right">{t.payments}</td>
                  <td className="whitespace-nowrap">{dateLabel(t.last_paid) || '-'}</td>
                  <td className="whitespace-nowrap">{dateLabel(t.renewal_date) || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
