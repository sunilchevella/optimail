import Link from 'next/link';
import type { Field, Resource } from '@/lib/resources';
import type { Options, Row } from '@/lib/records';
import { Empty, formatValue } from './ui';

// A table of records linking to each one's detail page.
export function RecordTable({ resource, rows, fields, options, empty = 'Nothing here yet.' }: {
  resource: Resource;
  rows: Row[];
  fields: Field[];
  options: Record<string, Options>;
  empty?: string;
}) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  const isNum = (f: Field) => ['money', 'computed', 'number', 'rate'].includes(f.type);
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>{fields.map((f) => <th key={f.name} className={isNum(f) ? 'text-right' : ''}>{f.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {fields.map((f, i) => (
                <td key={f.name} className={isNum(f) ? 'text-right' : ''}>
                  {i === 0 && f.type !== 'ref' ? (
                    <Link href={`/r/${resource.key}/${row.id}`} className="font-medium text-accent hover:underline">
                      {formatValue(f, row, options)}
                    </Link>
                  ) : formatValue(f, row, options)}
                  {i === 0 && f.type === 'ref' && (
                    <Link href={`/r/${resource.key}/${row.id}`} className="ml-2 text-xs text-muted hover:underline">open</Link>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
