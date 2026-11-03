import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq, getTableName } from 'drizzle-orm';
import { Plus } from 'lucide-react';
import { deleteRecord, saveRecord } from '@/app/actions';
import { ActionButton } from '@/components/ActionButton';
import { Attachments } from '@/components/Attachments';
import { RecordForm } from '@/components/RecordForm';
import { RecordTable } from '@/components/RecordTable';
import { Badge, Card, PageHeader, PageLoading, formatValue } from '@/components/ui';
import { can } from '@/lib/auth';
import { requireCompany } from '@/lib/company';
import { db } from '@/lib/db/client';
import { auditLog, profiles } from '@/lib/db/schema';
import { dateLabel } from '@/lib/format';
import { getResource, resources, type Resource } from '@/lib/resources';
import { getRecord, listRecords, loadAllOptions } from '@/lib/records';

export default function DetailPage(props: PageProps<'/r/[resource]/[id]'>) {
  return <Suspense fallback={<PageLoading />}><DetailContent {...props} /></Suspense>;
}

async function DetailContent({ params }: PageProps<'/r/[resource]/[id]'>) {
  const { user, company } = await requireCompany();
  const { resource, id: rawId } = await params;
  const r = getResource(resource);
  const id = Number(rawId);
  if (!r || !Number.isInteger(id)) notFound();
  const [row, options] = await Promise.all([getRecord(r, id, company.id), loadAllOptions(r.fields, company.id)]);
  if (!row) notFound();

  const computed = r.fields.filter((f) => f.type === 'computed');
  const editable = can(user, 'edit');
  const back = `/r/${r.key}/${id}`;

  return (
    <>
      <PageHeader
        title={r.title(row)}
        subtitle={<Link href={`/r/${r.key}`} className="hover:underline">{r.label}</Link>}
        actions={
          <>
            {row.status && <span className="self-center"><Badge value={row.status} /></span>}
            {can(user, 'delete') && (
              <ActionButton action={deleteRecord.bind(null, r.key, id)} label="Delete" confirm={`Delete this ${r.singular.toLowerCase()}? This can't be undone.`} />
            )}
          </>
        }
      />
      {row.status === 'review' && row.reviewReason && (
        <p className="mb-4 rounded-lg bg-warn-bg px-4 py-3 text-sm text-warn-ink"><strong>Needs review:</strong> {row.reviewReason}</p>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {computed.length > 0 && (
            <div className="flex flex-wrap gap-6 px-1">
              {computed.map((f) => (
                <div key={f.name}>
                  <p className="text-xs text-muted">{f.label}</p>
                  <p className="text-2xl font-semibold">{formatValue(f, row)}</p>
                </div>
              ))}
            </div>
          )}
          <Card title={editable ? 'Details' : 'Details (read only)'}>
            <RecordForm
              fields={r.fields}
              options={options}
              initial={row}
              action={saveRecord.bind(null, r.key, id)}
              submitLabel="Save changes"
              readOnly={!editable}
              returnTo={back}
            />
          </Card>
          {r.children?.map((c) => <ChildList key={`${c.resource}-${c.fk}`} parent={r} parentId={id} companyId={company.id} child={c} canCreate={can(user, 'create')} back={back} />)}
        </div>
        <div className="space-y-4">
          {r.attachments && <Attachments ownerTable={getTableName(r.table)} ownerId={id} user={user} />}
          <History table={getTableName(r.table)} id={id} />
        </div>
      </div>
    </>
  );
}

async function ChildList({ parent, parentId, companyId, child, canCreate, back }: {
  parent: Resource; parentId: number; companyId: number; child: NonNullable<Resource['children']>[number]; canCreate: boolean; back: string;
}) {
  const r = resources[child.resource];
  const rows = await listRecords(r, { [child.fk]: String(parentId) }, companyId);
  const fields = r.fields.filter((f) => f.list && f.name !== child.fk);
  const options = await loadAllOptions(fields, companyId);
  const total = r.sumField ? rows.reduce((a, x) => a + Number(x[r.sumField!] ?? 0), 0) : null;
  return (
    <Card
      title={`${child.label} (${rows.length})`}
      actions={canCreate && (
        <Link href={`/r/${r.key}/new?${child.fk}=${parentId}&_return=${encodeURIComponent(back)}`} className="btn px-2 py-1 text-xs">
          <Plus size={14} aria-hidden /> Add
        </Link>
      )}
    >
      <RecordTable resource={r} rows={rows} fields={fields} options={options} empty={`No ${child.label.toLowerCase()} for this ${parent.singular.toLowerCase()}.`} />
      {total !== null && rows.length > 1 && r.key !== 'transactions' && (
        <p className="mt-2 text-right text-xs text-muted num">Total {total.toLocaleString('en-IE', { style: 'currency', currency: 'EUR' })}</p>
      )}
    </Card>
  );
}

async function History({ table, id }: { table: string; id: number }) {
  const entries = await db
    .select({ action: auditLog.action, at: auditLog.changedAt, who: profiles.fullName, changedBy: auditLog.changedBy, oldData: auditLog.oldData, newData: auditLog.newData })
    .from(auditLog)
    .leftJoin(profiles, eq(profiles.id, auditLog.changedBy))
    .where(and(eq(auditLog.tableName, table), eq(auditLog.recordId, String(id))))
    .orderBy(desc(auditLog.changedAt))
    .limit(15);
  const changed = (o: any, n: any) =>
    o && n ? Object.keys(n).filter((k) => !['updated_at', 'amount_eur', 'total_eur'].includes(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k])) : [];
  return (
    <Card title="History">
      {entries.length === 0 ? (
        <p className="text-sm text-muted">No changes since the data was imported.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {entries.map((e, i) => (
            <li key={i}>
              <span className="font-medium">{e.who ?? (e.changedBy ? 'A deleted user' : 'System')}</span>{' '}
              <span className="text-ink-2">{e.action === 'insert' ? 'created this' : e.action === 'delete' ? 'deleted this' : `changed ${changed(e.oldData, e.newData).map((k) => k.replace(/_/g, ' ')).join(', ') || 'it'}`}</span>
              <span className="block text-xs text-muted">{dateLabel(e.at.toISOString())} {e.at.toISOString().slice(11, 16)} UTC</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
