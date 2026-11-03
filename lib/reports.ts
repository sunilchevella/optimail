import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from './db/client';
import { monthRange, todayMonth } from './format';

export const COST_LINES = ['Manpower', 'Rent', 'Systems & Tools', 'Other Office Cost', 'Equipment', 'Meta Ads & Webinars'] as const;

type PnlRow = { period: string; pnl_group: string; course: boolean; amount_eur: string; review_eur: string };

// Course revenue is shown apart from automation + staffing revenue. An entry is course when its
// service line is 'course' or its category name has "course" in it (e.g. "Course revenue").
// Course costs stay on the normal cost lines.
export const COURSE_CATEGORY = '%course%';

// Every report below is for one company (entities.id), the one picked on /company.
export async function getPnl(companyId: number) {
  const rows = await db.execute<PnlRow>(sql`
    select to_char(period, 'YYYY-MM-DD') as period, pnl_group,
      (pnl_group = 'Revenue' and (service_line = 'course' or category ilike ${COURSE_CATEGORY})) as course,
      sum(signed_eur) as amount_eur, sum(case when status = 'review' then signed_eur else 0 end) as review_eur
    from v_pnl_lines where entity_id = ${companyId} group by 1, 2, 3 order by 1`);
  const first = rows[0]?.period ?? `${todayMonth()}-01`;
  const months = monthRange(first, todayMonth());
  const key = (group: string, course: boolean) => `${course ? 'course' : 'main'}|${group}`;
  const lines = new Map<string, Map<string, number>>();
  const review = new Set<string>();
  for (const r of rows) {
    const k = key(r.pnl_group, r.course);
    if (!lines.has(k)) lines.set(k, new Map());
    lines.get(k)!.set(r.period, Number(r.amount_eur));
    if (Number(r.review_eur) !== 0) review.add(`${k}|${r.period}`);
  }
  // get(group, m) is automation + staffing; get(group, m, true) is the course.
  const get = (group: string, m: string, course = false) => lines.get(key(group, course))?.get(m) ?? 0;
  const hasReview = (group: string, m: string, course = false) => review.has(`${key(group, course)}|${m}`);
  const groups = [...new Set(rows.map((r) => r.pnl_group))];
  const series = months.map((m) => {
    const mainRevenue = get('Revenue', m);
    const courseRevenue = get('Revenue', m, true);
    const revenue = mainRevenue + courseRevenue;
    const costs = Object.fromEntries(COST_LINES.map((g) => [g, -get(g, m)])) as Record<string, number>;
    const other = groups.filter((g) => g !== 'Revenue' && !(COST_LINES as readonly string[]).includes(g)).reduce((a, g) => a - get(g, m), 0);
    const totalCosts = Object.values(costs).reduce((a, b) => a + b, 0) + other;
    return { month: m, mainRevenue, courseRevenue, revenue, costs, totalCosts, net: revenue - totalCosts };
  });
  let running = 0;
  const withCumulative = series.map((s) => ({ ...s, cumulative: (running += s.net) }));
  return { months, series: withCumulative, groups, get, hasReview };
}

export async function getTotals(companyId: number) {
  const [row] = await db.execute<Record<string, string>>(sql`
    select
      coalesce(sum(amount_eur) filter (where cash and type = 'deposit'), 0) as deposits,
      coalesce(sum(amount_eur) filter (where cash and type in ('income', 'refund')), 0) as cash_in,
      coalesce(sum(amount_eur) filter (where cash and type in ('expense', 'reversal')), 0) as cash_out,
      count(*) filter (where status = 'review') as review_count,
      coalesce(sum(amount_eur) filter (where status = 'review'), 0) as review_eur
    from (select *, counts_in in ('pnl_and_cash', 'cash_only') as cash from transactions where entity_id = ${companyId}) t`);
  const [wise] = await db.execute<{ balance: string | null; set: boolean }>(sql`
    select sum(balance_eur) as balance, bool_or(opening_date is not null) as set
    from v_account_balances b join accounts a on a.id = b.account_id where a.provider = 'Wise' and a.entity_id = ${companyId}`);
  return {
    deposits: Number(row.deposits), cashIn: Number(row.cash_in), cashOut: Number(row.cash_out),
    reviewCount: Number(row.review_count), reviewEur: Number(row.review_eur),
    wiseBalance: wise?.set ? Number(wise.balance) : null,
  };
}

export async function getReceivables(companyId: number) {
  return db.execute<{ invoice_id: number; number: string; client: string; issue_date: string; currency: string; outstanding: string; outstanding_eur: string; days_overdue: number; via: string | null }>(sql`
    select b.invoice_id, b.number, c.name as client, to_char(b.issue_date, 'YYYY-MM-DD') as issue_date, b.currency,
      b.outstanding, b.outstanding_eur, b.days_overdue, a.name as via
    from v_invoice_balances b
    join clients c on c.id = b.client_id
    join invoices i on i.id = b.invoice_id
    left join accounts a on a.id = i.issued_via_account_id
    where i.entity_id = ${companyId} and b.outstanding > 0 and b.status not in ('cancelled', 'draft')
    order by b.outstanding_eur desc`);
}

export async function getTopClients(companyId: number) {
  return db.execute<{ client_id: number; name: string; collected: string; projects: number }>(sql`
    select c.id as client_id, c.name, sum(case when t.type = 'reversal' then -t.amount_eur else t.amount_eur end) as collected, count(distinct t.project_id)::int as projects
    from transactions t join clients c on c.id = t.client_id
    where t.entity_id = ${companyId} and t.type in ('income', 'reversal') and t.counts_in in ('pnl_and_cash', 'cash_only')
    group by c.id, c.name order by collected desc limit 8`);
}

export type ToolStat = {
  id: number; name: string; category: string | null; billing_cycle: string; status: string; expected_eur: string | null;
  login_email: string | null; account: string | null; renewal_date: string | null; notes: string | null;
  total_paid: string; payments: number; renews_soon: boolean; first_paid: string | null; last_paid: string | null; last3: string;
};

export async function getToolStats(companyId: number) {
  const rows = await db.execute<ToolStat>(sql`
    select t.id, t.name, t.category, t.billing_cycle, t.status, t.expected_eur, t.login_email, a.name as account,
      to_char(t.renewal_date, 'YYYY-MM-DD') as renewal_date, t.notes,
      coalesce(t.renewal_date <= current_date + 90, false) as renews_soon,
      coalesce(sum(x.amount_eur), 0) as total_paid, count(x.id)::int as payments,
      to_char(min(x.txn_date), 'YYYY-MM-DD') as first_paid, to_char(max(x.txn_date), 'YYYY-MM-DD') as last_paid,
      coalesce(sum(x.amount_eur) filter (where x.txn_date >= (date_trunc('month', current_date) - interval '3 months')), 0) as last3
    from tools t
    left join accounts a on a.id = t.payment_account_id
    left join transactions x on x.tool_id = t.id and x.type = 'expense' and x.counts_in in ('pnl_and_cash', 'pnl_only')
    where t.entity_id = ${companyId}
    group by t.id, a.name order by total_paid desc`);
  // What each tool costs per month now, best estimate first.
  const monthly = (t: ToolStat) => {
    if (t.status === 'cancelled') return 0;
    const expected = t.expected_eur ? Number(t.expected_eur) : null;
    if (t.billing_cycle === 'yearly') return (expected ?? Number(t.total_paid)) / 12;
    if (t.billing_cycle === 'monthly' && expected) return expected;
    if (t.billing_cycle === 'one_time') return 0;
    if (t.billing_cycle === 'usage' && t.first_paid) {
      const months = Math.max(1, monthRange(t.first_paid.slice(0, 7), todayMonth()).length);
      return Number(t.total_paid) / months;
    }
    return Number(t.last3) / 3;
  };
  return rows.map((t) => ({ ...t, monthly: monthly(t) }));
}
