import { and, desc, eq } from 'drizzle-orm';
import { FileText } from 'lucide-react';
import { deleteAttachment } from '@/app/actions';
import { can, type CurrentUser } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { attachments } from '@/lib/db/schema';
import { dateLabel } from '@/lib/format';
import { ActionButton } from './ActionButton';
import { UploadForm } from './UploadForm';
import { Card } from './ui';

const size = (b: number | null) => (b === null ? '' : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.ceil(b / 1e3)} KB`);

export async function Attachments({ ownerTable, ownerId, user }: { ownerTable: string; ownerId: number; user: CurrentUser }) {
  const files = await db.select().from(attachments)
    .where(and(eq(attachments.ownerTable, ownerTable), eq(attachments.ownerId, ownerId)))
    .orderBy(desc(attachments.createdAt));
  return (
    <Card title={`Attachments (${files.length})`}>
      {files.length > 0 && (
        <ul className="mb-3 divide-y divide-line">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <a href={`/api/files/${f.id}`} target="_blank" className="flex min-w-0 items-center gap-2 text-accent hover:underline">
                <FileText size={16} aria-hidden /> <span className="truncate">{f.fileName}</span>
              </a>
              <span className="flex items-center gap-3 text-xs text-muted">
                {size(f.sizeBytes)} · {dateLabel(f.createdAt.toISOString())}
                {can(user, 'delete') && (
                  <ActionButton action={deleteAttachment.bind(null, f.id)} label="Remove" confirm={`Remove ${f.fileName}?`} className="btn btn-danger px-2 py-0.5 text-xs" />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {can(user, 'edit') ? (
        <UploadForm ownerTable={ownerTable} ownerId={ownerId} />
      ) : (
        files.length === 0 && <p className="text-sm text-muted">No files.</p>
      )}
    </Card>
  );
}
