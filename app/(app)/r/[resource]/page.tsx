import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Plus } from 'lucide-react';
import { RecordTable } from '@/components/RecordTable';
import { Card, PageHeader, PageLoading } from '@/components/ui';
import { can } from '@/lib/auth';
import { requireCompany } from '@/lib/company';
import { eur, monthLabel } from '@/lib/format';
import { getResource, optionLabel } from '@/lib/resources';
import { listRecords, loadAllOptions, type ListQuery } from '@/lib/records';

export default function ListPage(props: PageProps<'/r/[resource]'>) {
  return <Suspense fallback={<PageLoading />}><ListContent {...props} /></Suspense>;
}

async function ListContent({ params, searchParams }: PageProps<'/r/[resource]'>) {
  const { user, company } = await requireCompany();
  const { resource } = await params;
  const r = getResource(resource);
  if (!r) notFound();
  const sp = await searchParams;
  const q: ListQuery = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));

  const [rows, options] = await Promise.all([listRecords(r, q, company.id), loadAllOptions(r.fields, company.id)]);
  const listFields = r.fields.filter((f) => f.list);
  const filters = r.fields.filter((f) => f.filter);
  const active = Object.entries(q).filter(([k, v]) => v && (k === 'q' || k === 'pnlGroup' || k === 'course' || r.fields.some((f) => f.name === k)));

  let summary: string | null = null;
  if (r.key === 'transactions') {
    const inn = rows.filter((x) => ['income', 'funding', 'refund'].includes(x.type)).reduce((a, x) => a + Number(x.amountEur), 0);
    const out = rows.filter((x) => ['expense', 'deposit', 'reversal'].includes(x.type)).reduce((a, x) => a + Number(x.amountEur), 0);
    summary = `In ${eur(inn, true)} · Out ${eur(out, true)}`;
  } else if (r.sumField) {
    summary = `Total ${eur(rows.reduce((a, x) => a + Number(x[r.sumField!] ?? 0), 0), true)}`;
  }
  const newHref = `/r/${r.key}/new${active.length ? `?${new URLSearchParams(active.filter(([k]) => k !== 'q' && k !== 'pnlGroup' && k !== 'course') as [string, string][]).toString()}` : ''}`;

  return (
    <>
      <PageHeader
        title={q.status === 'review' && r.key === 'transactions' ? 'Needs review' : r.label}
        subtitle={q.status === 'review' && r.key === 'transactions'
          ? 'Entries kept exactly as recorded, with a note on what is unclear. Open one to fix it, then set its status to confirmed.'
          : r.description}
        actions={can(user, 'create') && (
          <Link href={newHref} className="btn btn-primary"><Plus size={16} aria-hidden /> New {r.singular.toLowerCase()}</Link>
        )}
      />
      <Card>
        <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
          {r.search && (
            <div className="min-w-48 flex-1">
              <label htmlFor="q" className="mb-1 block text-xs font-medium text-ink-2">Search</label>
              <input id="q" name="q" defaultValue={q.q} className="field" placeholder={`Search ${r.label.toLowerCase()}`} />
            </div>
          )}
          {filters.map((f) => (
            <div key={f.name}>
              <label htmlFor={`flt-${f.name}`} className="mb-1 block text-xs font-medium text-ink-2">{f.label}</label>
              {f.type === 'month' ? (
                <input id={`flt-${f.name}`} type="month" name={f.name} defaultValue={q[f.name]?.slice(0, 7)} className="field" />
              ) : (
                <select id={`flt-${f.name}`} name={f.name} defaultValue={q[f.name] ?? ''} className="field max-w-52">
                  <option value="">All</option>
                  {f.type === 'ref'
                    ? options[f.ref!]?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
                    : f.optionsFrom
                    ? options[f.optionsFrom]?.map((o) => <option key={o.value} value={o.label}>{o.label === 'review' ? 'needs review' : optionLabel(o.label)}</option>)
                    : f.options?.map((o) => <option key={o} value={o}>{o === 'review' ? 'needs review' : optionLabel(o)}</option>)}
                </select>
              )}
            </div>
          ))}
          {q.pnlGroup && <input type="hidden" name="pnlGroup" value={q.pnlGroup} />}
          {q.course && <input type="hidden" name="course" value={q.course} />}
          <button className="btn">Apply</button>
          {active.length > 0 && <Link href={`/r/${r.key}`} className="btn">Clear</Link>}
        </form>
        {q.pnlGroup && (
          <p className="mb-3 text-sm text-ink-2">
            P&L line: <strong>{q.pnlGroup}</strong>
            {q.course === 'yes' ? ' · Course' : q.course === 'no' ? ' · without course' : ''}
            {q.period ? ` · ${monthLabel(q.period)}` : ''}
          </p>
        )}
        <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-muted">
          <span>{rows.length} {rows.length === 1 ? 'record' : 'records'}</span>
          {summary && <span className="num">{summary}</span>}
        </div>
        <RecordTable resource={r} rows={rows} fields={listFields} options={options} empty="No records match." />
      </Card>
    </>
  );
}
