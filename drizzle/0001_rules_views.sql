-- Rules the database enforces on its own, plus the reporting views.
-- The app sets `app.user_id` per transaction (set_config) so the audit log knows who acted.

-- ─── updated_at on every table that has one ──────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'updated_at'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      t || '_set_updated_at', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- ─── Audit trail: who changed what, with before/after ─────────────────
CREATE OR REPLACE FUNCTION public.audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := nullif(current_setting('app.user_id', true), '')::uuid;
  row_data jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
BEGIN
  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  VALUES (
    TG_TABLE_NAME,
    row_data ->> 'id',
    lower(TG_OP),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END,
    actor
  );
  RETURN coalesce(NEW, OLD);
END $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'entities', 'profiles', 'profile_entities', 'accounts', 'categories', 'clients',
    'client_companies', 'projects', 'billing_milestones', 'recurring_charges', 'team_members',
    'salary_history', 'placements', 'payroll_runs', 'payroll_items', 'vendors', 'tools',
    'assets', 'transactions', 'invoices', 'invoice_lines', 'payment_allocations', 'budgets',
    'period_locks', 'attachments'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row()',
      t || '_audit', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- ─── Closed months can't be edited ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_period_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
    SELECT 1 FROM public.period_locks l WHERE l.entity_id = OLD.entity_id AND l.period = OLD.period
  ) THEN
    RAISE EXCEPTION 'The month % is locked for this company', to_char(OLD.period, 'Mon YYYY')
      USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
    SELECT 1 FROM public.period_locks l WHERE l.entity_id = NEW.entity_id AND l.period = NEW.period
  ) THEN
    RAISE EXCEPTION 'The month % is locked for this company', to_char(NEW.period, 'Mon YYYY')
      USING ERRCODE = 'P0001';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER transactions_period_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
--> statement-breakpoint

-- ─── A new Supabase login gets a profile (viewer, no companies) ───────
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    coalesce(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
--> statement-breakpoint

-- ─── Reporting views ──────────────────────────────────────────────────
-- security_invoker keeps RLS in force, so the public API can't read through them.

-- Signed P&L lines: income positive, costs negative, refunds reduce a cost.
CREATE VIEW public.v_pnl_lines WITH (security_invoker = true) AS
SELECT
  t.id AS transaction_id, t.entity_id, t.period, t.txn_date, t.type, t.status,
  t.service_line, t.category_id, c.name AS category, c.pnl_group, c.kind,
  t.amount_eur,
  CASE t.type WHEN 'income' THEN t.amount_eur WHEN 'refund' THEN t.amount_eur ELSE -t.amount_eur END
    AS signed_eur
FROM public.transactions t
JOIN public.categories c ON c.id = t.category_id
WHERE t.type IN ('income', 'expense', 'refund');
--> statement-breakpoint

CREATE VIEW public.v_monthly_pnl WITH (security_invoker = true) AS
SELECT entity_id, period, pnl_group, kind,
  sum(signed_eur) AS amount_eur,
  sum(CASE WHEN status = 'review' THEN signed_eur ELSE 0 END) AS review_eur,
  count(*) AS line_count
FROM public.v_pnl_lines
GROUP BY entity_id, period, pnl_group, kind;
--> statement-breakpoint

-- Money actually moving, by the month it moved.
CREATE VIEW public.v_cash_flow_monthly WITH (security_invoker = true) AS
SELECT entity_id, date_trunc('month', txn_date)::date AS month,
  sum(CASE WHEN type IN ('income', 'funding', 'refund') THEN amount_eur ELSE 0 END) AS cash_in_eur,
  sum(CASE WHEN type IN ('expense', 'deposit') THEN amount_eur ELSE 0 END) AS cash_out_eur,
  sum(CASE WHEN type IN ('income', 'funding', 'refund') THEN amount_eur
           WHEN type IN ('expense', 'deposit') THEN -amount_eur ELSE 0 END) AS net_eur
FROM public.transactions
GROUP BY entity_id, date_trunc('month', txn_date);
--> statement-breakpoint

-- Running balance of each Wise account / card, in EUR.
CREATE VIEW public.v_account_balances WITH (security_invoker = true) AS
SELECT a.id AS account_id, a.entity_id, a.name, a.type, a.opening_balance_eur,
  a.opening_balance_eur + coalesce(m.movement_eur, 0) AS balance_eur
FROM public.accounts a
LEFT JOIN (
  SELECT account_id, sum(delta) AS movement_eur
  FROM (
    SELECT account_id,
      CASE WHEN type IN ('income', 'funding', 'refund') THEN amount_eur ELSE -amount_eur END AS delta
    FROM public.transactions WHERE account_id IS NOT NULL
    UNION ALL
    SELECT transfer_account_id, amount_eur
    FROM public.transactions WHERE type = 'transfer'
  ) moves
  GROUP BY account_id
) m ON m.account_id = a.id;
--> statement-breakpoint

-- What each invoice has been paid and what is still owed (in EUR at the invoice rate).
CREATE VIEW public.v_invoice_balances WITH (security_invoker = true) AS
SELECT
  i.id AS invoice_id, i.entity_id, i.client_id, i.company_id, i.project_id, i.number,
  i.issue_date, i.due_date, i.status, i.currency, i.total, i.fx_rate, i.total_eur,
  coalesce(p.paid, 0) AS paid,
  coalesce(p.received_eur, 0) AS received_eur,
  CASE WHEN i.status IN ('cancelled', 'draft') THEN 0
       ELSE greatest(i.total - coalesce(p.paid, 0), 0) END AS outstanding,
  CASE WHEN i.status IN ('cancelled', 'draft') THEN 0
       ELSE round(greatest(i.total - coalesce(p.paid, 0), 0) * i.fx_rate, 2) END AS outstanding_eur,
  CASE WHEN i.status NOT IN ('cancelled', 'draft') AND i.total > coalesce(p.paid, 0)
       THEN current_date - coalesce(i.due_date, i.issue_date) END AS days_overdue
FROM public.invoices i
LEFT JOIN (
  SELECT a.invoice_id, sum(a.amount) AS paid, sum(round(a.amount * t.fx_rate, 2)) AS received_eur
  FROM public.payment_allocations a
  JOIN public.transactions t ON t.id = a.transaction_id
  GROUP BY a.invoice_id
) p ON p.invoice_id = i.id;
--> statement-breakpoint

-- Each project: agreed value vs invoiced vs collected, all in EUR.
CREATE VIEW public.v_project_balances WITH (security_invoker = true) AS
SELECT
  pr.id AS project_id, pr.entity_id, pr.client_id, pr.name, pr.status, pr.service_line,
  pr.total_value_eur,
  coalesce(sum(b.total_eur) FILTER (WHERE b.status <> 'cancelled'), 0) AS invoiced_eur,
  coalesce(sum(b.received_eur), 0) AS collected_eur,
  greatest(pr.total_value_eur - coalesce(sum(b.total_eur) FILTER (WHERE b.status <> 'cancelled'), 0), 0)
    AS left_to_invoice_eur,
  coalesce(sum(b.outstanding_eur), 0) AS outstanding_eur
FROM public.projects pr
LEFT JOIN public.v_invoice_balances b ON b.project_id = pr.id
GROUP BY pr.id;
--> statement-breakpoint

CREATE VIEW public.v_tool_spend_monthly WITH (security_invoker = true) AS
SELECT t.tool_id, t.entity_id, t.period, sum(t.amount_eur) AS amount_eur, count(*) AS payments
FROM public.transactions t
WHERE t.tool_id IS NOT NULL AND t.type = 'expense'
GROUP BY t.tool_id, t.entity_id, t.period;
--> statement-breakpoint

CREATE VIEW public.v_team_cost_monthly WITH (security_invoker = true) AS
SELECT t.team_member_id, t.entity_id, t.period, sum(t.amount_eur) AS amount_eur
FROM public.transactions t
WHERE t.team_member_id IS NOT NULL AND t.type = 'expense'
GROUP BY t.team_member_id, t.entity_id, t.period;
