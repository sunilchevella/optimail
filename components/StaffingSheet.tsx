'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';

export type SheetRowView = {
  id: number; monthEnd: string; name: string; position: string | null; teamMemberId: number;
  incomeTxnId: number | null; expenseTxnId: number | null;
} & Record<string, number | string | null>;

// Columns in the same order as the owner's sheet.
const INCOME = [['laptop', 'Laptop'], ['recruitmentFee', 'Recruitment fee'], ['agencyFee', 'Agency fees'], ['salary', 'Salary'], ['seat', 'Seat'], ['bonus', 'Bonus']] as const;
const COST = [
  ['employeeCost', 'Employee cost'], ['payrollTax', 'Payroll & tax'], ['officeSeat', 'Office seat'], ['lunch', 'Lunch & beverages'],
  ['medicalInsurance', 'Medical insurance'], ['providentFund', 'Provident fund'], ['gratuity', 'Gratuity'], ['leaveBenefits', 'Leave benefits'],
] as const;
const PROFIT = [['profitFirstMonth', 'Profit/Employee (first month)'], ['profitPerEmployee', 'Profit/Employee']] as const;
// What the ledger books (see lib/staffing.ts).
const INCOME_BOOKED = ['agencyFee', 'recruitmentFee', 'salary', 'seat'];
const COST_BOOKED = ['employeeCost', 'payrollTax', 'officeSeat', 'lunch', 'leaveBenefits'];

const n = (v: unknown) => Number(v ?? 0);
const fmt = (v: number | null) => (v === null ? '' : v.toLocaleString('en-IE', { maximumFractionDigits: 2 }));
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const month = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export function StaffingSheet({ rows }: { rows: SheetRowView[] }) {
  const months = useMemo(() => [...new Set(rows.map((r) => r.monthEnd))].sort().reverse(), [rows]);
  const [pick, setPick] = useState('all');
  const shown = pick === 'all' ? rows : rows.filter((r) => r.monthEnd === pick);
  const income = (r: SheetRowView) => INCOME_BOOKED.reduce((a, k) => a + n(r[k]), 0);
  const cost = (r: SheetRowView) => COST_BOOKED.reduce((a, k) => a + n(r[k]), 0);
  const total = (f: (r: SheetRowView) => number) => shown.reduce((a, r) => a + f(r), 0);

  // Who worked here and when: first and last month per person.
  const team = useMemo(() => {
    const m = new Map<number, { name: string; position: string | null; from: string; to: string; months: number }>();
    for (const r of rows) {
      const t = m.get(r.teamMemberId);
      if (!t) m.set(r.teamMemberId, { name: r.name, position: r.position, from: r.monthEnd, to: r.monthEnd, months: 1 });
      else { t.months++; if (r.monthEnd < t.from) t.from = r.monthEnd; if (r.monthEnd > t.to) { t.to = r.monthEnd; t.name = r.name; t.position = r.position; } }
    }
    return [...m.entries()].sort((a, b) => a[1].from.localeCompare(b[1].from));
  }, [rows]);
  const latest = months[0];

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr><th>Team member</th><th>Position</th><th>From</th><th>To</th><th className="text-right">Months</th></tr>
          </thead>
          <tbody>
            {team.map(([id, t]) => (
              <tr key={id}>
                <td><Link href={`/r/team_members/${id}`} className="hover:underline">{t.name}</Link></td>
                <td>{t.position}</td>
                <td>{month(t.from)}</td>
                <td>{t.to === latest ? <span className="text-good">{month(t.to)} (current)</span> : month(t.to)}</td>
                <td className="text-right num">{t.months}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          Month
          <select className="field w-48" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="all">All months ({rows.length} rows)</option>
            {months.map((m) => <option key={m} value={m}>{month(m)}</option>)}
          </select>
        </label>
        <span className="text-muted">
          Income {fmt(total(income))} · Costs {fmt(total(cost))} · Gap <strong>{fmt(total(income) - total(cost))}</strong> (EUR)
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="data-table num text-xs">
          <thead>
            <tr>
              <th colSpan={3} />
              <th colSpan={INCOME.length + 1} className="text-center">Income</th>
              <th colSpan={COST.length + 1} className="text-center">Expenses</th>
              <th colSpan={PROFIT.length + 1} />
            </tr>
            <tr>
              <th>Date</th><th>Name</th><th>Position</th>
              {INCOME.map(([k, l]) => <th key={k} className="text-right">{l}</th>)}
              <th className="text-right">Income booked</th>
              {COST.map(([k, l]) => <th key={k} className="text-right">{l}</th>)}
              <th className="text-right">Cost booked</th>
              <th className="text-right">Gap</th>
              {PROFIT.map(([k, l]) => <th key={k} className="text-right">{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{ddmmyyyy(r.monthEnd)}</td>
                <td className="whitespace-nowrap"><Link href={`/r/team_members/${r.teamMemberId}`} className="hover:underline">{r.name}</Link></td>
                <td className="whitespace-nowrap">{r.position}</td>
                {INCOME.map(([k]) => <td key={k} className="text-right">{fmt(n(r[k]))}</td>)}
                <td className="text-right font-medium">
                  {r.incomeTxnId ? <Link href={`/r/transactions/${r.incomeTxnId}`} className="hover:underline">{fmt(income(r))}</Link> : fmt(income(r))}
                </td>
                {COST.map(([k]) => <td key={k} className="text-right">{fmt(n(r[k]))}</td>)}
                <td className="text-right font-medium">
                  {r.expenseTxnId ? <Link href={`/r/transactions/${r.expenseTxnId}`} className="hover:underline">{fmt(cost(r))}</Link> : fmt(cost(r))}
                </td>
                <td className={`text-right font-medium ${income(r) - cost(r) < 0 ? 'text-bad' : ''}`}>{fmt(income(r) - cost(r))}</td>
                {PROFIT.map(([k]) => <td key={k} className="text-right">{r[k] === null ? '' : fmt(n(r[k]))}</td>)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td colSpan={3}>Total</td>
              {INCOME.map(([k]) => <td key={k} className="text-right">{fmt(total((r) => n(r[k])))}</td>)}
              <td className="text-right">{fmt(total(income))}</td>
              {COST.map(([k]) => <td key={k} className="text-right">{fmt(total((r) => n(r[k])))}</td>)}
              <td className="text-right">{fmt(total(cost))}</td>
              <td className="text-right">{fmt(total(income) - total(cost))}</td>
              {PROFIT.map(([k]) => <td key={k} className="text-right">{fmt(total((r) => n(r[k])))}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
