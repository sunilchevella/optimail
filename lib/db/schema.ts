// Database schema for the Optimail Solutions finance dashboard.
//
// Design rules (read before adding a table):
// - Every money column stores the ORIGINAL amount + currency + fx_rate (to EUR). The EUR
//   value is a generated column, so it can never drift from the amount it was made from.
// - `transactions` is the single ledger: every euro in or out is one row there. Invoices,
//   payroll, tools and assets link to it; reports read from it.
// - A transaction has two dates: `txn_date` (when money moved, for cash flow) and `period`
//   (the month it belongs to, for the P&L). Rent paid in advance or a salary arrear keeps
//   both facts.
// - Nothing is deleted to "fix" history. Unclear rows stay, with status 'review' and a
//   `review_reason` (use 'Unknown' when the reason isn't known).
// - Passwords are never stored. Tools record which login they use and where the
//   credential lives in the password manager.
// - RLS is enabled on every table with no policies, so the public Supabase API can read
//   nothing. The Next.js server queries with the database role and enforces access itself.
import { sql } from 'drizzle-orm';
import {
  boolean, check, date, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey,
  text, timestamp, uniqueIndex, uuid, bigint, type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { authUsers } from 'drizzle-orm/supabase';

// ─── Shared column helpers ───────────────────────────────────────────

const id = () => integer().primaryKey().generatedByDefaultAsIdentity();
const money = () => numeric({ precision: 14, scale: 2, mode: 'number' });
const rate = () => numeric({ precision: 18, scale: 8, mode: 'number' });
const currency = () => text().notNull().default('EUR');
const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};
// EUR value of an amount column, always amount × fx_rate rounded to cents.
const eurOf = (amountColumn: string) =>
  numeric({ precision: 14, scale: 2, mode: 'number' })
    .generatedAlwaysAs(sql.raw(`round(${amountColumn} * fx_rate, 2)`));
const currencyCheck = (name: string, col: AnyPgColumn) =>
  check(name, sql`${col} ~ '^[A-Z]{3}$'`);
const monthStartCheck = (name: string, col: AnyPgColumn) =>
  check(name, sql`${col} = date_trunc('month', ${col})::date`);

// ─── Enums ───────────────────────────────────────────────────────────

// 'none' = no access to the finance area (e.g. a login that only uses Ads & Leads).
export const userRole = pgEnum('user_role', ['owner', 'admin', 'accountant', 'editor', 'viewer', 'none']);
export const accountType = pgEnum('account_type', ['bank', 'card', 'wallet', 'cash']);
export const categoryKind = pgEnum('category_kind', ['income', 'expense', 'asset', 'liability', 'equity']);
// 'course' = AI Architect course money; the P&L shows it apart from automation + staffing.
export const serviceLine = pgEnum('service_line', ['automation', 'staffing', 'course', 'shared', 'unknown']);
export const clientStatus = pgEnum('client_status', ['lead', 'active', 'past', 'unknown']);
export const projectStatus = pgEnum('project_status', ['proposal', 'active', 'completed', 'on_hold', 'cancelled', 'unknown']);
export const milestoneStatus = pgEnum('milestone_status', ['planned', 'invoiced', 'paid', 'cancelled']);
export const invoiceStatus = pgEnum('invoice_status', ['draft', 'sent', 'partially_paid', 'paid', 'cancelled', 'unknown']);
export const employmentType = pgEnum('employment_type', ['founder', 'employee', 'intern', 'freelancer', 'contractor']);
export const memberStatus = pgEnum('member_status', ['active', 'notice', 'left', 'unknown']);
export const placementStatus = pgEnum('placement_status', ['trial', 'active', 'ended']);
export const payrollStatus = pgEnum('payroll_status', ['draft', 'approved', 'paid']);
export const payrollKind = pgEnum('payroll_kind', ['salary', 'prorata', 'arrear', 'bonus', 'deduction', 'other']);
export const billingCycle = pgEnum('billing_cycle', ['monthly', 'yearly', 'usage', 'one_time', 'unknown']);
export const toolStatus = pgEnum('tool_status', ['active', 'trial', 'cancelled', 'unknown']);
export const vendorType = pgEnum('vendor_type', ['software', 'landlord', 'utility', 'supplier', 'freelancer', 'agency', 'other']);
export const txnType = pgEnum('txn_type', ['income', 'expense', 'funding', 'deposit', 'refund', 'transfer']);
export const recordStatus = pgEnum('record_status', ['confirmed', 'review']);
// Where a transaction is counted. The P&L follows the owner's final P&L sheet, which can
// differ from cash: e.g. revenue booked at project value (pnl_only) while the client's
// actual payment is cash_only; rows the P&L leaves out are kept as 'neither'.
export const countsIn = pgEnum('counts_in', ['pnl_and_cash', 'pnl_only', 'cash_only', 'neither']);
export const assetStatus = pgEnum('asset_status', ['in_use', 'in_storage', 'disposed', 'returned']);
// The columns of the Ads & Leads board, in order.
export const leadStatus = pgEnum('lead_status', ['new', 'contacted', 'follow_up', 'interested', 'meeting_booked', 'won', 'lost']);

// ─── 1. Organisation & access ────────────────────────────────────────

// The companies whose books are kept here: Optimail Solutions and Optiserv Solutions. Every
// main table carries entity_id; child tables follow their parent row. The app shows one
// company at a time (picked on /company).
export const entities = pgTable('entities', {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  legalName: text(),
  country: text(),
  invoicePrefix: text(),
  notes: text(),
  ...timestamps,
}).enableRLS();

// One row per login. `id` is the Supabase Auth user id.
export const profiles = pgTable('profiles', {
  id: uuid().primaryKey().references(() => authUsers.id, { onDelete: 'cascade' }),
  fullName: text().notNull(),
  email: text().notNull().unique(),
  role: userRole().notNull().default('viewer'),
  // true = sees every entity; false = only those listed in profile_entities.
  allEntities: boolean().notNull().default(false),
  // Off until an owner/admin enables it. A login created any other way (e.g. a public
  // Supabase sign-up) gets no access.
  isActive: boolean().notNull().default(false),
  // Access to the Ads & Leads area (live Meta ads + the leads board). Separate from the
  // finance `role`: a login can have either, both, or (when switched off) neither.
  adsAccess: boolean().notNull().default(false),
  ...timestamps,
}).enableRLS();

export const profileEntities = pgTable('profile_entities', {
  profileId: uuid().notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  entityId: integer().notNull().references(() => entities.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.profileId, t.entityId] })]).enableRLS();

// Where money sits or is paid from: Wise, payment channels, cards, GPay.
export const accounts = pgTable('accounts', {
  id: id(),
  entityId: integer().notNull().references(() => entities.id),
  name: text().notNull(),
  type: accountType().notNull(),
  provider: text(),
  currency: currency(),
  last4: text(),
  holder: text(),
  // Balance in EUR on opening_date, the starting point for the running balance.
  openingBalanceEur: money().notNull().default(0),
  openingDate: date(),
  isActive: boolean().notNull().default(true),
  notes: text(),
  ...timestamps,
}, (t) => [
  uniqueIndex('accounts_entity_name').on(t.entityId, t.name),
  currencyCheck('accounts_currency_iso', t.currency),
]).enableRLS();

// Reference rates to EUR, used as the default when a transaction is entered.
export const fxRates = pgTable('fx_rates', {
  id: id(),
  currency: text().notNull(),
  rateDate: date().notNull(),
  rateToEur: rate().notNull(),
  source: text(),
}, (t) => [
  uniqueIndex('fx_rates_currency_date').on(t.currency, t.rateDate),
  currencyCheck('fx_rates_currency_iso', t.currency),
  check('fx_rates_positive', sql`${t.rateToEur} > 0`),
]).enableRLS();

// Chart of accounts. `pnl_group` is the line it rolls up to on the P&L
// (Revenue, Manpower, Rent, Systems & Tools, Other Office Cost, Equipment, Marketing...).
export const categories = pgTable('categories', {
  id: id(),
  name: text().notNull().unique(),
  kind: categoryKind().notNull(),
  pnlGroup: text().notNull(),
  parentId: integer().references((): AnyPgColumn => categories.id),
  sortOrder: integer().notNull().default(0),
  isActive: boolean().notNull().default(true),
}).enableRLS();

// ─── 2. Clients & sales ──────────────────────────────────────────────

// The person or relationship (Burak, Murali). One client can bill through several companies.
export const clients = pgTable('clients', {
  id: id(),
  entityId: integer().notNull().references(() => entities.id),
  name: text().notNull(),
  email: text(),
  phone: text(),
  whatsapp: text(),
  country: text(),
  website: text(),
  // Link to the client's product or store (app, Shopify page...).
  productUrl: text(),
  // What we do for them, in words ("Meta ads automation, voice agent").
  services: text(),
  source: text(),
  status: clientStatus().notNull().default('active'),
  ownerId: uuid().references(() => profiles.id, { onDelete: 'set null' }),
  notes: text(),
  ...timestamps,
}, (t) => [index('clients_entity').on(t.entityId)]).enableRLS();

// Legal billing companies (TOGA Health Inc., Brovista LLC) belonging to a client.
export const clientCompanies = pgTable('client_companies', {
  id: id(),
  clientId: integer().notNull().references(() => clients.id, { onDelete: 'cascade' }),
  legalName: text().notNull(),
  address: text(),
  country: text(),
  registrationNo: text(),
  taxId: text(),
  billingEmail: text(),
  notes: text(),
  ...timestamps,
}, (t) => [index('client_companies_client').on(t.clientId)]).enableRLS();

// A piece of work sold to a client: an automation build or a staffing engagement.
// Holds the agreed value ("total budget $2,500").
export const projects = pgTable('projects', {
  id: id(),
  entityId: integer().notNull().references(() => entities.id),
  clientId: integer().notNull().references(() => clients.id),
  companyId: integer().references(() => clientCompanies.id, { onDelete: 'set null' }),
  serviceLine: serviceLine().notNull().default('automation'),
  name: text().notNull(),
  description: text(),
  status: projectStatus().notNull().default('active'),
  currency: currency(),
  totalValue: money().notNull().default(0),
  fxRate: rate().notNull().default(1),
  totalValueEur: eurOf('total_value'),
  startDate: date(),
  endDate: date(),
  paymentTerms: text(),
  notes: text(),
  ...timestamps,
}, (t) => [
  index('projects_client').on(t.clientId),
  index('projects_entity').on(t.entityId),
  currencyCheck('projects_currency_iso', t.currency),
]).enableRLS();

// Payment schedule of a project: "Advance 50%", "Final 50%", "Stage 1".
export const billingMilestones = pgTable('billing_milestones', {
  id: id(),
  projectId: integer().notNull().references(() => projects.id, { onDelete: 'cascade' }),
  label: text().notNull(),
  amount: money().notNull(),
  dueDate: date(),
  status: milestoneStatus().notNull().default('planned'),
  sortOrder: integer().notNull().default(0),
}, (t) => [index('milestones_project').on(t.projectId)]).enableRLS();

// Repeating charges on a project: maintenance retainers ($150/month).
export const recurringCharges = pgTable('recurring_charges', {
  id: id(),
  projectId: integer().notNull().references(() => projects.id, { onDelete: 'cascade' }),
  description: text().notNull(),
  amount: money().notNull(),
  currency: currency(),
  cycle: billingCycle().notNull().default('monthly'),
  dayOfMonth: integer(),
  startDate: date().notNull(),
  endDate: date(),
  isActive: boolean().notNull().default(true),
}, (t) => [currencyCheck('recurring_currency_iso', t.currency)]).enableRLS();

// Marketing campaigns, so ad spend can be tied to the leads it produced.
export const marketingCampaigns = pgTable('marketing_campaigns', {
  id: id(),
  entityId: integer().notNull().references(() => entities.id),
  name: text().notNull(),
  platform: text().notNull().default('meta'),
  externalId: text(),
  serviceLine: serviceLine().notNull().default('unknown'),
  startDate: date(),
  endDate: date(),
  notes: text(),
  ...timestamps,
}).enableRLS();

export const leads = pgTable('leads', {
  id: id(),
  entityId: integer().notNull().references(() => entities.id),
  campaignId: integer().references(() => marketingCampaigns.id, { onDelete: 'set null' }),
  source: text().notNull().default('meta_form'),
  externalId: text().unique(),
  receivedAt: timestamp({ withTimezone: true }),
  fullName: text(),
  email: text(),
  phone: text(),
  company: text(),
  website: text(),
  requirement: text(),
  headcount: text(),
  talentType: text(),
  timeline: text(),
  status: leadStatus().notNull().default('new'),
  clientId: integer().references(() => clients.id, { onDelete: 'set null' }),
  notes: text(),
  // Filled by the Meta lead sync: which ad the lead came from and every answer on the form.
  metaAdId: text(),
  metaAdName: text(),
  metaAdsetName: text(),
  metaCampaignId: text(),
  metaCampaignName: text(),
  metaFormId: text(),
  platform: text(), // 'fb' | 'ig'
  isOrganic: boolean(),
  answers: jsonb().$type<{ name: string; value: string }[]>(),
  statusChangedAt: timestamp({ withTimezone: true }),
  lastContactedAt: timestamp({ withTimezone: true }),
  ...timestamps,
}, (t) => [index('leads_status_idx').on(t.status), index('leads_meta_ad_idx').on(t.metaAdId)]).enableRLS();

// Everything done to a lead on the board: status moves, calls, WhatsApps, emails, notes.
export const leadActivities = pgTable('lead_activities', {
  id: id(),
  leadId: integer().notNull().references(() => leads.id, { onDelete: 'cascade' }),
  userId: uuid().references(() => profiles.id, { onDelete: 'set null' }),
  kind: text().notNull(), // status | call | whatsapp | email | note
  detail: text(),
  at: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('lead_activities_lead_idx').on(t.leadId, t.at)]).enableRLS();

// Small key/value store for integrations (e.g. when Meta leads were last synced).
export const integrationState = pgTable('integration_state', {
  key: text().primaryKey(),
  value: text(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// ─── 3. Team & payroll ───────────────────────────────────────────────

export const teamMembers = pgTable('team_members', {
  id: id(),
  entityId: integer().notNull().references(() => entities.id),
  fullName: text().notNull(),
  workEmail: text(),
  phone: text(),
  position: text(),
  location: text(),
  employmentType: employmentType().notNull().default('employee'),
  joinDate: date(),
  exitDate: date(),
  status: memberStatus().notNull().default('active'),
  notes: text(),
  ...timestamps,
}).enableRLS();

// Every salary a person has had. The current salary is the latest effective row.
export const salaryHistory = pgTable('salary_history', {
  id: id(),
  teamMemberId: integer().notNull().references(() => teamMembers.id, { onDelete: 'cascade' }),
  effectiveFrom: date().notNull(),
  monthlyAmount: money().notNull(),
  currency: currency(),
  fxRate: rate().notNull().default(1),
  monthlyEur: eurOf('monthly_amount'),
  reason: text(),
}, (t) => [
  uniqueIndex('salary_member_from').on(t.teamMemberId, t.effectiveFrom),
  currencyCheck('salary_currency_iso', t.currency),
]).enableRLS();

// Staffing: a team member placed with a client, and what the client pays for them.
export const placements = pgTable('placements', {
  id: id(),
  projectId: integer().notNull().references(() => projects.id, { onDelete: 'cascade' }),
  teamMemberId: integer().notNull().references(() => teamMembers.id),
  role: text(),
  monthlyBillAmount: money().notNull().default(0),
  currency: currency(),
  fxRate: rate().notNull().default(1),
  monthlyBillEur: eurOf('monthly_bill_amount'),
  startDate: date().notNull(),
  freeUntil: date(),
  endDate: date(),
  status: placementStatus().notNull().default('trial'),
  notes: text(),
}, (t) => [currencyCheck('placements_currency_iso', t.currency)]).enableRLS();

export const payrollRuns = pgTable('payroll_runs', {
  id: id(),
  entityId: integer().notNull().references(() => entities.id),
  period: date().notNull(),
  status: payrollStatus().notNull().default('draft'),
  paidOn: date(),
  notes: text(),
  ...timestamps,
}, (t) => [
  uniqueIndex('payroll_runs_entity_period').on(t.entityId, t.period),
  monthStartCheck('payroll_runs_period_month', t.period),
]).enableRLS();

// One line of a payroll run. `for_period` is the month the pay relates to, so an
// arrear paid in May for April keeps that fact.
export const payrollItems = pgTable('payroll_items', {
  id: id(),
  payrollRunId: integer().notNull().references(() => payrollRuns.id, { onDelete: 'cascade' }),
  teamMemberId: integer().references(() => teamMembers.id),
  kind: payrollKind().notNull().default('salary'),
  forPeriod: date().notNull(),
  daysWorked: numeric({ precision: 5, scale: 2, mode: 'number' }),
  amount: money().notNull(),
  currency: currency(),
  fxRate: rate().notNull().default(1),
  amountEur: eurOf('amount'),
  note: text(),
  transactionId: integer().references((): AnyPgColumn => transactions.id, { onDelete: 'set null' }),
}, (t) => [
  index('payroll_items_run').on(t.payrollRunId),
  monthStartCheck('payroll_items_for_period_month', t.forPeriod),
]).enableRLS();

// ─── 4. Spending ─────────────────────────────────────────────────────

// Anyone we pay who isn't on the team: landlord, Airtel, OpenAI, freelancers.
export const vendors = pgTable('vendors', {
  id: id(),
  entityId: integer().notNull().references(() => entities.id),
  name: text().notNull(),
  type: vendorType().notNull().default('other'),
  email: text(),
  website: text(),
  country: text(),
  notes: text(),
  ...timestamps,
}, (t) => [uniqueIndex('vendors_entity_name').on(t.entityId, t.name)]).enableRLS();

// Software subscriptions and credit accounts.
export const tools = pgTable('tools', {
  id: id(),
  name: text().notNull(),
  vendorId: integer().references(() => vendors.id, { onDelete: 'set null' }),
  entityId: integer().notNull().references(() => entities.id),
  category: text(),
  loginEmail: text(),
  plan: text(),
  billingCycle: billingCycle().notNull().default('monthly'),
  expectedAmount: money(),
  currency: currency(),
  fxRate: rate().notNull().default(1),
  expectedEur: eurOf('expected_amount'),
  paymentAccountId: integer().references(() => accounts.id, { onDelete: 'set null' }),
  ownerName: text(),
  status: toolStatus().notNull().default('active'),
  startDate: date(),
  renewalDate: date(),
  cancelledOn: date(),
  // Where the login lives in the password manager. Never the password itself.
  credentialRef: text(),
  notes: text(),
  ...timestamps,
}, (t) => [currencyCheck('tools_currency_iso', t.currency)]).enableRLS();

// Equipment register and refundable deposits (things we own, not costs).
export const assets = pgTable('assets', {
  id: id(),
  entityId: integer().notNull().references(() => entities.id),
  name: text().notNull(),
  category: text().notNull().default('equipment'),
  purchaseDate: date(),
  costEur: money().notNull(),
  usefulLifeMonths: integer(),
  refundable: boolean().notNull().default(false),
  assignedToId: integer().references(() => teamMembers.id, { onDelete: 'set null' }),
  serialNo: text(),
  status: assetStatus().notNull().default('in_use'),
  notes: text(),
  ...timestamps,
}).enableRLS();

// ─── 5. The ledger ───────────────────────────────────────────────────

// Every money movement. Direction comes from `type`:
// in  = income, funding, refund · out = expense, deposit · transfer = account -> transfer_account.
export const transactions = pgTable('transactions', {
  id: id(),
  entityId: integer().notNull().references(() => entities.id),
  accountId: integer().references(() => accounts.id, { onDelete: 'set null' }),
  transferAccountId: integer().references(() => accounts.id, { onDelete: 'set null' }),
  txnDate: date().notNull(),
  period: date().notNull(),
  type: txnType().notNull(),
  categoryId: integer().references(() => categories.id),
  description: text().notNull(),
  amount: money().notNull(),
  currency: currency(),
  fxRate: rate().notNull().default(1),
  amountEur: eurOf('amount'),
  serviceLine: serviceLine().notNull().default('shared'),
  clientId: integer().references(() => clients.id, { onDelete: 'set null' }),
  projectId: integer().references(() => projects.id, { onDelete: 'set null' }),
  vendorId: integer().references(() => vendors.id, { onDelete: 'set null' }),
  teamMemberId: integer().references(() => teamMembers.id, { onDelete: 'set null' }),
  toolId: integer().references(() => tools.id, { onDelete: 'set null' }),
  assetId: integer().references(() => assets.id, { onDelete: 'set null' }),
  campaignId: integer().references(() => marketingCampaigns.id, { onDelete: 'set null' }),
  // A fee or split that belongs to another transaction (Wise fee on a client payment).
  parentId: integer().references((): AnyPgColumn => transactions.id, { onDelete: 'cascade' }),
  paidBy: text(),
  reference: text(),
  countsIn: countsIn().notNull().default('pnl_and_cash'),
  status: recordStatus().notNull().default('confirmed'),
  reviewReason: text(),
  source: text(),
  createdBy: uuid().references(() => profiles.id, { onDelete: 'set null' }),
  ...timestamps,
}, (t) => [
  index('transactions_entity_period').on(t.entityId, t.period),
  index('transactions_date').on(t.txnDate),
  index('transactions_category').on(t.categoryId),
  index('transactions_client').on(t.clientId),
  index('transactions_tool').on(t.toolId),
  index('transactions_member').on(t.teamMemberId),
  check('transactions_amount_positive', sql`${t.amount} > 0`),
  check('transactions_fx_positive', sql`${t.fxRate} > 0`),
  check('transactions_transfer_target', sql`(${t.type} = 'transfer') = (${t.transferAccountId} is not null)`),
  monthStartCheck('transactions_period_month', t.period),
  currencyCheck('transactions_currency_iso', t.currency),
]).enableRLS();

// ─── 6. Invoicing ────────────────────────────────────────────────────

export const invoices = pgTable('invoices', {
  id: id(),
  entityId: integer().notNull().references(() => entities.id),
  number: text().notNull(),
  clientId: integer().notNull().references(() => clients.id),
  companyId: integer().references(() => clientCompanies.id, { onDelete: 'set null' }),
  projectId: integer().references(() => projects.id, { onDelete: 'set null' }),
  // The channel the invoice was issued through and is paid into (Fusion Media, Digital Clues...).
  issuedViaAccountId: integer().references(() => accounts.id, { onDelete: 'set null' }),
  issueDate: date().notNull(),
  dueDate: date(),
  currency: currency(),
  subtotal: money().notNull().default(0),
  taxRate: numeric({ precision: 5, scale: 2, mode: 'number' }).notNull().default(0),
  taxAmount: money().notNull().default(0),
  total: money().notNull(),
  fxRate: rate().notNull().default(1),
  totalEur: eurOf('total'),
  status: invoiceStatus().notNull().default('draft'),
  // A reissue points at the invoice it replaces (INV-31 at FM -> SI-374).
  replacesInvoiceId: integer().references((): AnyPgColumn => invoices.id, { onDelete: 'set null' }),
  description: text(),
  notes: text(),
  sentAt: timestamp({ withTimezone: true }),
  ...timestamps,
}, (t) => [
  uniqueIndex('invoices_entity_number').on(t.entityId, t.number),
  index('invoices_client').on(t.clientId),
  currencyCheck('invoices_currency_iso', t.currency),
]).enableRLS();

export const invoiceLines = pgTable('invoice_lines', {
  id: id(),
  invoiceId: integer().notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  description: text().notNull(),
  quantity: numeric({ precision: 10, scale: 2, mode: 'number' }).notNull().default(1),
  unitPrice: money().notNull(),
  amount: numeric({ precision: 14, scale: 2, mode: 'number' })
    .generatedAlwaysAs(sql`round(quantity * unit_price, 2)`),
  milestoneId: integer().references(() => billingMilestones.id, { onDelete: 'set null' }),
  placementId: integer().references(() => placements.id, { onDelete: 'set null' }),
  sortOrder: integer().notNull().default(0),
}, (t) => [index('invoice_lines_invoice').on(t.invoiceId)]).enableRLS();

// Links money received to the invoices it pays. One payment can cover several
// invoices, and an invoice can be paid in parts.
export const paymentAllocations = pgTable('payment_allocations', {
  id: id(),
  transactionId: integer().notNull().references(() => transactions.id, { onDelete: 'cascade' }),
  invoiceId: integer().notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  // Amount settled, in the invoice's currency.
  amount: money().notNull(),
}, (t) => [
  uniqueIndex('allocations_txn_invoice').on(t.transactionId, t.invoiceId),
  index('allocations_invoice').on(t.invoiceId),
  check('allocations_amount_positive', sql`${t.amount} > 0`),
]).enableRLS();

// ─── 7. Planning & control ───────────────────────────────────────────

export const budgets = pgTable('budgets', {
  id: id(),
  entityId: integer().notNull().references(() => entities.id),
  categoryId: integer().notNull().references(() => categories.id),
  period: date().notNull(),
  amountEur: money().notNull(),
}, (t) => [
  uniqueIndex('budgets_entity_category_period').on(t.entityId, t.categoryId, t.period),
  monthStartCheck('budgets_period_month', t.period),
]).enableRLS();

// A closed month. Transactions in a locked (entity, period) can't be changed.
export const periodLocks = pgTable('period_locks', {
  entityId: integer().notNull().references(() => entities.id),
  period: date().notNull(),
  lockedBy: uuid().references(() => profiles.id, { onDelete: 'set null' }),
  lockedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.entityId, t.period] }),
  monthStartCheck('period_locks_period_month', t.period),
]).enableRLS();

// ─── 8. Files & history ──────────────────────────────────────────────

export const ATTACHMENT_OWNERS = [
  'transactions', 'invoices', 'projects', 'clients', 'client_companies', 'team_members',
  'tools', 'assets', 'vendors', 'payroll_runs',
] as const;

// Receipts, invoice PDFs, contracts. Files live in Supabase Storage; this is the index.
export const attachments = pgTable('attachments', {
  id: id(),
  ownerTable: text().notNull(),
  ownerId: integer().notNull(),
  storagePath: text().notNull().unique(),
  fileName: text().notNull(),
  mimeType: text(),
  sizeBytes: integer(),
  uploadedBy: uuid().references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('attachments_owner').on(t.ownerTable, t.ownerId),
  check('attachments_owner_table', sql.raw(`owner_table in (${ATTACHMENT_OWNERS.map((o) => `'${o}'`).join(', ')})`)),
]).enableRLS();

// Written by a database trigger on every insert, update and delete of the main tables.
export const auditLog = pgTable('audit_log', {
  id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  tableName: text().notNull(),
  recordId: text(),
  action: text().notNull(),
  oldData: jsonb(),
  newData: jsonb(),
  changedBy: uuid(),
  changedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('audit_log_record').on(t.tableName, t.recordId)]).enableRLS();
