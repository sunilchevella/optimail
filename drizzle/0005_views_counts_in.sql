-- Views now respect transactions.counts_in:
--   P&L views read pnl_and_cash + pnl_only; cash views read pnl_and_cash + cash_only.

CREATE OR REPLACE VIEW public.v_pnl_lines WITH (security_invoker = true) AS
SELECT
  t.id AS transaction_id, t.entity_id, t.period, t.txn_date, t.type, t.status,
  t.service_line, t.category_id, c.name AS category, c.pnl_group, c.kind,
  t.amount_eur,
  CASE t.type WHEN 'income' THEN t.amount_eur WHEN 'refund' THEN t.amount_eur ELSE -t.amount_eur END
    AS signed_eur
FROM public.transactions t
JOIN public.categories c ON c.id = t.category_id
WHERE t.type IN ('income', 'expense', 'refund')
  AND t.counts_in IN ('pnl_and_cash', 'pnl_only');
--> statement-breakpoint

CREATE OR REPLACE VIEW public.v_cash_flow_monthly WITH (security_invoker = true) AS
SELECT entity_id, date_trunc('month', txn_date)::date AS month,
  sum(CASE WHEN type IN ('income', 'funding', 'refund') THEN amount_eur ELSE 0 END) AS cash_in_eur,
  sum(CASE WHEN type IN ('expense', 'deposit') THEN amount_eur ELSE 0 END) AS cash_out_eur,
  sum(CASE WHEN type IN ('income', 'funding', 'refund') THEN amount_eur
           WHEN type IN ('expense', 'deposit') THEN -amount_eur ELSE 0 END) AS net_eur
FROM public.transactions
WHERE counts_in IN ('pnl_and_cash', 'cash_only')
GROUP BY entity_id, date_trunc('month', txn_date);
--> statement-breakpoint

CREATE OR REPLACE VIEW public.v_account_balances WITH (security_invoker = true) AS
SELECT a.id AS account_id, a.entity_id, a.name, a.type, a.opening_balance_eur,
  a.opening_balance_eur + coalesce(m.movement_eur, 0) AS balance_eur
FROM public.accounts a
LEFT JOIN (
  SELECT account_id, sum(delta) AS movement_eur
  FROM (
    SELECT account_id,
      CASE WHEN type IN ('income', 'funding', 'refund') THEN amount_eur ELSE -amount_eur END AS delta
    FROM public.transactions
    WHERE account_id IS NOT NULL AND counts_in IN ('pnl_and_cash', 'cash_only')
    UNION ALL
    SELECT transfer_account_id, amount_eur
    FROM public.transactions
    WHERE type = 'transfer' AND counts_in IN ('pnl_and_cash', 'cash_only')
  ) moves
  GROUP BY account_id
) m ON m.account_id = a.id;
--> statement-breakpoint

CREATE OR REPLACE VIEW public.v_tool_spend_monthly WITH (security_invoker = true) AS
SELECT t.tool_id, t.entity_id, t.period, sum(t.amount_eur) AS amount_eur, count(*) AS payments
FROM public.transactions t
WHERE t.tool_id IS NOT NULL AND t.type = 'expense' AND t.counts_in IN ('pnl_and_cash', 'pnl_only')
GROUP BY t.tool_id, t.entity_id, t.period;
--> statement-breakpoint

CREATE OR REPLACE VIEW public.v_team_cost_monthly WITH (security_invoker = true) AS
SELECT t.team_member_id, t.entity_id, t.period, sum(t.amount_eur) AS amount_eur
FROM public.transactions t
WHERE t.team_member_id IS NOT NULL AND t.type = 'expense' AND t.counts_in IN ('pnl_and_cash', 'pnl_only')
GROUP BY t.team_member_id, t.entity_id, t.period;
