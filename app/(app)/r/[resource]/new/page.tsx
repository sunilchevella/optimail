import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { saveRecord } from '@/app/actions';
import { RecordForm } from '@/components/RecordForm';
import { Card, PageHeader, PageLoading } from '@/components/ui';
import { can } from '@/lib/auth';
import { requireCompany } from '@/lib/company';
import { getResource } from '@/lib/resources';
import { loadAllOptions } from '@/lib/records';

export default function NewPage(props: PageProps<'/r/[resource]/new'>) {
  return <Suspense fallback={<PageLoading />}><NewContent {...props} /></Suspense>;
}

async function NewContent({ params, searchParams }: PageProps<'/r/[resource]/new'>) {
  const { user, company } = await requireCompany();
  const { resource } = await params;
  const r = getResource(resource);
  if (!r) notFound();
  if (!can(user, 'create')) {
    return (
      <>
        <PageHeader title={`New ${r.singular.toLowerCase()}`} />
        <Card><p className="text-sm text-ink-2">Your role ({user.role}) can view records but not add them. Ask an owner or admin if you need to.</p></Card>
      </>
    );
  }
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);

  // Sensible defaults, then anything passed in the URL (e.g. ?clientId=3 from a client page).
  const initial: Record<string, unknown> = {};
  for (const f of r.fields) {
    if (f.type === 'date' && f.required) initial[f.name] = today;
    if (f.type === 'month' && f.required) initial[f.name] = today.slice(0, 7);
    if (f.name === 'status' && f.optionsFrom === 'ledger_statuses') initial.status = 'confirmed';
    if (f.name === 'status' && f.options?.includes('active')) initial.status = 'active';
    if (f.name === 'type' && r.key === 'transactions') initial.type = 'expense';
    if (f.name === 'quantity') initial.quantity = 1;
    const v = sp[f.name];
    if (typeof v === 'string') initial[f.name] = v;
  }
  const options = await loadAllOptions(r.fields, company.id);
  const returnTo = typeof sp._return === 'string' ? sp._return : undefined;

  return (
    <>
      <PageHeader title={`New ${r.singular.toLowerCase()}`} subtitle={r.description} />
      <Card>
        <RecordForm
          fields={r.fields}
          options={options}
          initial={initial}
          action={saveRecord.bind(null, r.key, null)}
          submitLabel={`Create ${r.singular.toLowerCase()}`}
          returnTo={returnTo}
        />
      </Card>
    </>
  );
}
