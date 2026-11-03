ALTER TYPE "public"."txn_type" ADD VALUE 'reversal';--> statement-breakpoint
-- A reversal is money given back to a client: it lowers revenue in the P&L (signed negative,
-- on the revenue category of the original payment) and is money out in cash views.
-- type::text is compared, because the new enum value cannot be used as a literal in the
-- same transaction that adds it.
CREATE OR REPLACE VIEW public.v_pnl_lines WITH (security_invoker = true) AS
SELECT
  t.id AS transaction_id, t.entity_id, t.period, t.txn_date, t.type, t.status,
  t.service_line, t.category_id, c.name AS category, c.pnl_group, c.kind,
  t.amount_eur,
  CASE WHEN t.type::text IN ('income', 'refund') THEN t.amount_eur ELSE -t.amount_eur END
    AS signed_eur
FROM public.transactions t
JOIN public.categories c ON c.id = t.category_id
WHERE t.type::text IN ('income', 'expense', 'refund', 'reversal')
  AND t.counts_in IN ('pnl_and_cash', 'pnl_only');
--> statement-breakpoint

CREATE OR REPLACE VIEW public.v_cash_flow_monthly WITH (security_invoker = true) AS
SELECT entity_id, date_trunc('month', txn_date)::date AS month,
  sum(CASE WHEN type::text IN ('income', 'funding', 'refund') THEN amount_eur ELSE 0 END) AS cash_in_eur,
  sum(CASE WHEN type::text IN ('expense', 'deposit', 'reversal') THEN amount_eur ELSE 0 END) AS cash_out_eur,
  sum(CASE WHEN type::text IN ('income', 'funding', 'refund') THEN amount_eur
           WHEN type::text IN ('expense', 'deposit', 'reversal') THEN -amount_eur ELSE 0 END) AS net_eur
FROM public.transactions
WHERE counts_in IN ('pnl_and_cash', 'cash_only')
GROUP BY entity_id, date_trunc('month', txn_date);
