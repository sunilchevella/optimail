'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { checkSheet, confirmSheet, type SheetCheck } from '@/app/(app)/import/actions';
import type { NameChoice, NameMatch } from '@/lib/staffing';

type Opt = { id: number; label: string };
type ClientOpt = { id: number; name: string };

// The sheet keeps cents and we book whole euros, so a 1 euro gap is rounding, not a difference.
const profitGap = (x: { sheetProfit: number | null; income: number; cost: number }) =>
  x.sheetProfit !== null && Math.abs(x.sheetProfit - (x.income - x.cost)) > 1;
// "2 skipped (1 already in the books, 1 repeated in the file)"
const skipText = (rows: { status: string }[]) => {
  const inBooks = rows.filter((x) => x.status === 'in_books').length, twice = rows.filter((x) => x.status === 'twice_in_file').length;
  const parts = [inBooks && `${inBooks} already in the books`, twice && `${twice} repeated in the file`].filter(Boolean);
  return parts.length ? `, ${inBooks + twice} skipped (${parts.join(', ')})` : '';
};
const eur = (n: number) => n.toLocaleString('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const month = (iso: string) => new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

const STATUS: Record<NameMatch['status'], { label: string; tone: string }> = {
  matched: { label: 'Matched', tone: 'text-good' },
  remembered: { label: 'Matched (used before)', tone: 'text-good' },
  close: { label: 'Check: close match', tone: 'bg-warn-bg text-warn-ink' },
  new: { label: 'New person', tone: 'bg-warn-bg text-warn-ink' },
};

export function ImportForm({ clients, members }: { clients: ClientOpt[]; members: Opt[] }) {
  const [client, setClient] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [names, setNames] = useState<Record<string, NameChoice>>({});
  const [check, setCheck] = useState<SheetCheck | null>(null);
  const [saved, setSaved] = useState<SheetCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [fileKey, setFileKey] = useState(0);
  const [busy, start] = useTransition();
  const [mode, setMode] = useState<'check' | 'save' | null>(null);
  const router = useRouter();

  const form = (picked: Record<string, NameChoice>) => {
    const fd = new FormData();
    if (file) fd.set('file', file);
    fd.set('client', client);
    fd.set('newClientName', newClientName);
    fd.set('names', JSON.stringify(picked));
    return fd;
  };

  const runCheck = (picked = names) => {
    setError(null); setSaved(null);
    if (!client) { setError('Pick the client first.'); return; }
    if (client === 'new' && !newClientName.trim()) { setError('Type the new client\'s name.'); return; }
    if (!file) { setError('Choose the filled staffing sheet.'); return; }
    setMode('check');
    start(async () => {
      const res = await checkSheet(form(picked));
      if (res.error) { setError(res.error); setCheck(null); return; }
      // Keep what was picked; fill the rest from the suggestions.
      const next: Record<string, NameChoice> = {};
      for (const n of res.names ?? []) next[n.name] = picked[n.name] ?? n.memberId ?? 'new';
      setNames(next); setCheck(res);
    });
  };

  const pick = (name: string, value: string) => {
    const next = { ...names, [name]: value === 'new' ? 'new' as const : Number(value) };
    setNames(next);
    runCheck(next);
  };

  const confirm = () => {
    const r = check?.result;
    if (!r) return;
    const newOnes = (check.names ?? []).filter((n) => names[n.name] === 'new').map((n) => n.name);
    const label = (id: NameChoice) => members.find((m) => m.id === id)?.label.replace(/ \(.*\)$/, '') ?? '';
    const guessed = (check.names ?? []).filter((n) => n.status === 'close' && names[n.name] !== 'new')
      .map((n) => `${n.name} = ${label(names[n.name])}`);
    const msg = `Add ${r.added} rows for ${r.clientName}?\n\nIncome ${eur(r.incomeEur)}, cost ${eur(r.costEur)}.` +
      (guessed.length ? `\n\nPlease check these names: ${guessed.join(', ')}.` : '') +
      (newOnes.length ? `\nNew team members: ${newOnes.join(', ')}.` : '');
    if (!window.confirm(msg)) return;
    setError(null);
    setMode('save');
    start(async () => {
      const res = await confirmSheet(form(names));
      if (res.error) { setError(res.error); return; }
      setSaved(res); setCheck(null); setFile(null); setNames({}); setNewClientName(''); setClient('');
      setFileKey((k) => k + 1);
      router.refresh();
    });
  };

  const reset = () => { setCheck(null); setNames({}); setSaved(null); setError(null); };
  const r = check?.result;
  const flagged = (check?.names ?? []).filter((n) => n.status === 'close' || n.status === 'new');
  const rows = r ? (showAll ? r.rows : r.rows.slice(0, 50)) : [];

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">1. Client</span>
            <select className="field" value={client} onChange={(e) => { setClient(e.target.value); reset(); }} disabled={busy}>
              <option value="">Choose a client...</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="new">+ New client</option>
            </select>
            {client === 'new' && (
              <input className="field mt-2" placeholder="New client's name" value={newClientName}
                onChange={(e) => { setNewClientName(e.target.value); reset(); }} disabled={busy} />
            )}
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">2. Filled template (.xlsx or .csv)</span>
            <input key={fileKey} type="file" accept=".xlsx,.csv" className="field"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }} disabled={busy} />
          </label>
          <div className="flex items-end">
            <button className="btn btn-primary" onClick={() => runCheck()} disabled={busy}>
              {busy && mode === 'check' && !check ? 'Reading...' : '3. Check file'}
            </button>
          </div>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
      </section>

      {saved?.result && (
        <section className="card p-4">
          <p className="text-sm text-good font-medium">
            Done. {saved.result.added} rows added for {saved.result.clientName}: income {eur(saved.result.incomeEur)}, cost {eur(saved.result.costEur)}
            {skipText(saved.result.rows)}.
            {saved.result.createdMembers.length ? ` New team members: ${saved.result.createdMembers.join(', ')}.` : ''}
          </p>
          <p className="mt-2 text-sm">
            <Link href={`/r/clients/${saved.result.clientId}`} className="text-accent hover:underline">Open {saved.result.clientName}</Link>
            {' · '}
            <Link href="/r/transactions" className="text-accent hover:underline">Open the ledger</Link>
            {' · '}Wrong file? Use Undo under Recent uploads.
          </p>
        </section>
      )}

      {check && r && (
        <>
          <section className="card p-4">
            <h2 className="mb-1 text-sm font-semibold">Who is who</h2>
            <p className="mb-3 text-sm text-ink-2">
              {flagged.length
                ? `${flagged.length} name(s) need a look. Close matches are pre-picked; change the person if it is wrong, or choose "Add as new person".`
                : 'Every name matched a team member.'}
            </p>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Name in sheet</th><th className="text-right">Rows</th><th>Status</th><th>Book it under</th></tr></thead>
                <tbody>
                  {(check.names ?? []).map((n) => (
                    <tr key={n.name}>
                      <td className="font-medium">{n.name}</td>
                      <td className="text-right num">{n.rows}</td>
                      <td><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[n.status].tone}`}>
                        {n.status === 'close' ? `Did you mean ${n.memberName}?` : STATUS[n.status].label}
                      </span></td>
                      <td>
                        <select className="field py-1" value={String(names[n.name] ?? 'new')} onChange={(e) => pick(n.name, e.target.value)} disabled={busy}>
                          <option value="new">Add as new person: {n.name}</option>
                          {members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <p className="font-semibold">Preview: {check.fileName} for {r.clientName}{client === 'new' ? ' (new client)' : ''}</p>
                <p className="text-ink-2">
                  {r.rows.length} rows in file · <b>{r.added} will be added</b>
                  {skipText(r.rows).replace(/^, /, ' · ')} · income <b>{eur(r.incomeEur)}</b> · cost <b>{eur(r.costEur)}</b> · profit <b>{eur(r.incomeEur - r.costEur)}</b>
                </p>
                {r.rows.some(profitGap) ? (
                  <p className="mt-1 rounded bg-warn-bg px-2 py-1 text-warn-ink">
                    {r.rows.filter(profitGap).length} row(s) where the sheet&apos;s own profit column differs from income minus cost (highlighted below).
                    The books follow the income and cost columns; check those rows in the sheet.
                  </p>
                ) : null}
                {check.ignoredColumns?.length ? (
                  <p className="mt-1 rounded bg-warn-bg px-2 py-1 text-warn-ink">Columns not read (not in the template): {check.ignoredColumns.join(', ')}</p>
                ) : null}
              </div>
              <button className="btn btn-primary" onClick={confirm} disabled={busy || r.added === 0}>
                {busy && mode === 'save' ? 'Saving...' : busy ? 'Updating...' : r.added === 0 ? 'Nothing new to add' : `Confirm and add ${r.added} rows`}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr><th>Month</th><th>Name in sheet</th><th>Booked under</th><th>Position</th><th className="text-right">Income</th><th className="text-right">Cost</th><th className="text-right">Profit</th><th className="text-right">Sheet profit</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {rows.map((x, i) => (
                    <tr key={i} className={x.status === 'add' ? '' : 'text-muted'}>
                      <td className="whitespace-nowrap">{month(x.monthEnd)}</td>
                      <td>{x.name}</td>
                      <td>{x.member}</td>
                      <td>{x.position ?? ''}</td>
                      <td className="text-right num">{eur(x.income)}</td>
                      <td className="text-right num">{eur(x.cost)}</td>
                      <td className="text-right num">{eur(x.income - x.cost)}</td>
                      <td className={`text-right num ${profitGap(x) ? 'text-warn-ink bg-warn-bg' : ''}`}>
                        {x.sheetProfit === null ? '' : eur(x.sheetProfit)}
                      </td>
                      <td className="whitespace-nowrap">{x.status === 'add' ? 'Add' : x.status === 'in_books' ? 'Skip: already in books' : 'Skip: same person and month twice in file'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {r.rows.length > 50 && (
              <button className="btn mt-3 text-xs" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show first 50' : `Show all ${r.rows.length} rows`}</button>
            )}
            <p className="mt-3 text-xs text-muted">
              Income = Agency fees + Recruitment fee + Salary + Seat + Bonus. Cost = Employee cost + Payroll &amp; tax + Lunch &amp; beverages + Leave benefits.
              Laptop is kept on the sheet but not booked. &quot;Sheet profit&quot; is highlighted when it differs from income minus cost by more than 1 euro (smaller gaps are rounding).
            </p>
          </section>
        </>
      )}
    </div>
  );
}
