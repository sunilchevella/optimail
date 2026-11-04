// One description per table. The generic list, form and detail pages are built from
// these, so adding a field to a screen is a one-line change here.
import * as s from './db/schema';

export type FieldType =
  | 'text' | 'textarea' | 'email' | 'url' | 'phone' | 'whatsapp' | 'number' | 'money' | 'rate'
  | 'date' | 'month' | 'select' | 'ref' | 'boolean' | 'currency' | 'computed';

export type Field = {
  name: string;
  label: string;
  type: FieldType;
  options?: readonly string[];
  ref?: ResourceKey;
  // A select whose choices are the names in another table (ledger statuses), so they can grow.
  optionsFrom?: ResourceKey;
  required?: boolean;
  list?: boolean; // show as a column on the list page
  filter?: boolean; // offer as a filter on the list page
  help?: string;
  wide?: boolean; // spans the full form width
  // Not a table column: calculated on the server when rows are loaded (see lib/records.ts).
  virtual?: boolean;
};

export type Child = { resource: ResourceKey; fk: string; label: string };

export type Resource = {
  key: ResourceKey;
  label: string;
  singular: string;
  table: any;
  title: (row: any) => string;
  fields: Field[];
  sort: { field: string; dir: 'asc' | 'desc' };
  search?: string[];
  sumField?: string; // EUR column totalled under the list
  children?: Child[];
  // Child tables have no company column of their own: they belong to the company of the
  // parent row `fk` points at (an invoice line follows its invoice).
  parent?: { fk: string; resource: ResourceKey };
  attachments?: boolean;
  description?: string;
};

export const RESOURCE_KEYS = [
  'transactions', 'invoices', 'invoice_lines', 'payment_allocations', 'clients', 'client_companies', 'projects',
  'billing_milestones', 'recurring_charges', 'placements', 'team_members', 'salary_history', 'tools', 'vendors',
  'accounts', 'categories', 'ledger_statuses', 'assets', 'marketing_campaigns', 'leads', 'fx_rates',
] as const;
export type ResourceKey = (typeof RESOURCE_KEYS)[number];

// How a stored value reads on screen, where the plain value would be unclear.
const OPTION_LABELS: Record<string, string> = {
  refund: 'refund received',
  reversal: 'reversal (refund to client)',
};
export const optionLabel = (value: string) => OPTION_LABELS[value] ?? value.replace(/_/g, ' ');

export const CURRENCIES = ['EUR', 'USD', 'CAD', 'INR', 'GBP', 'AED', 'PHP'] as const;

const e = (en: { enumValues: readonly string[] }) => en.enumValues;

const RESOURCES: Record<ResourceKey, Omit<Resource, 'key'>> = {
  transactions: {
    label: 'Ledger',
    singular: 'Transaction',
    table: s.transactions,
    description: 'Every euro in or out. Reports are calculated from here.',
    title: (r) => r.description,
    sort: { field: 'txnDate', dir: 'desc' },
    search: ['description', 'reviewReason', 'reference', 'paidBy'],
    sumField: 'amountEur',
    attachments: true,
    children: [
      { resource: 'payment_allocations', fk: 'transactionId', label: 'Invoices this payment settles' },
      { resource: 'transactions', fk: 'parentId', label: 'Fees and splits' },
    ],
    fields: [
      { name: 'txnDate', label: 'Date paid', type: 'date', required: true, list: true, help: 'When the money moved.' },
      { name: 'period', label: 'Month (P&L)', type: 'month', required: true, list: true, filter: true, help: 'The month this belongs to in the P&L.' },
      { name: 'type', label: 'Type', type: 'select', options: e(s.txnType), required: true, list: true, filter: true, help: 'Refund received: money back to you from a vendor (lowers a cost). Reversal: money you give back to a client (lowers revenue).' },
      { name: 'description', label: 'Description', type: 'text', required: true, list: true, wide: true },
      { name: 'categoryId', label: 'Category', type: 'ref', ref: 'categories', required: true, list: true, filter: true, help: 'Decides the P&L line. Entries without one would not show in the P&L or charts.' },
      { name: 'amount', label: 'Amount', type: 'money', required: true },
      { name: 'currency', label: 'Currency', type: 'currency', required: true },
      { name: 'fxRate', label: 'Rate to EUR', type: 'rate', help: 'Leave empty to use the default rate for the currency.' },
      { name: 'amountEur', label: 'EUR', type: 'computed', list: true },
      { name: 'accountId', label: 'Account / card', type: 'ref', ref: 'accounts', filter: true },
      { name: 'paidBy', label: 'Paid by', type: 'text' },
      { name: 'serviceLine', label: 'Service line', type: 'select', options: e(s.serviceLine), filter: true },
      { name: 'clientId', label: 'Client', type: 'ref', ref: 'clients', filter: true },
      { name: 'projectId', label: 'Project', type: 'ref', ref: 'projects' },
      { name: 'teamMemberId', label: 'Team member', type: 'ref', ref: 'team_members', filter: true },
      { name: 'toolId', label: 'Tool', type: 'ref', ref: 'tools', filter: true },
      { name: 'vendorId', label: 'Vendor', type: 'ref', ref: 'vendors' },
      { name: 'campaignId', label: 'Campaign', type: 'ref', ref: 'marketing_campaigns' },
      { name: 'parentId', label: 'Part of (fee or split of)', type: 'ref', ref: 'transactions' },
      { name: 'reference', label: 'Reference', type: 'text', help: 'Wise transfer ID, invoice number...' },
      { name: 'countsIn', label: 'Counts in', type: 'select', options: e(s.countsIn), required: true, filter: true, help: 'P&L and cash for normal entries. P&L only: a figure from the P&L with no money movement. Cash only: money that moved but is not P&L revenue or cost. Neither: kept for the record.' },
      { name: 'status', label: 'Status', type: 'select', optionsFrom: 'ledger_statuses', required: true, list: true, filter: true, help: 'Review puts the entry on the Needs review page. Every status counts in the totals.' },
      { name: 'reviewReason', label: 'Review note', type: 'textarea', wide: true },
      { name: 'source', label: 'Source', type: 'text', wide: true },
    ],
  },
  invoices: {
    label: 'Invoices',
    singular: 'Invoice',
    table: s.invoices,
    title: (r) => r.number,
    sort: { field: 'issueDate', dir: 'desc' },
    search: ['number', 'description', 'notes'],
    sumField: 'totalEur',
    attachments: true,
    children: [
      { resource: 'invoice_lines', fk: 'invoiceId', label: 'Lines' },
      { resource: 'payment_allocations', fk: 'invoiceId', label: 'Payments applied' },
    ],
    fields: [
      { name: 'number', label: 'Number', type: 'text', required: true, list: true },
      { name: 'issuedViaAccountId', label: 'Issued via', type: 'ref', ref: 'accounts', list: true, filter: true },
      { name: 'clientId', label: 'Client', type: 'ref', ref: 'clients', required: true, list: true, filter: true },
      { name: 'companyId', label: 'Billed company', type: 'ref', ref: 'client_companies' },
      { name: 'projectId', label: 'Project', type: 'ref', ref: 'projects' },
      { name: 'issueDate', label: 'Issue date', type: 'date', required: true, list: true },
      { name: 'dueDate', label: 'Due date', type: 'date' },
      { name: 'currency', label: 'Currency', type: 'currency', required: true },
      { name: 'total', label: 'Total', type: 'money', required: true, list: true },
      { name: 'fxRate', label: 'Rate to EUR', type: 'rate' },
      { name: 'totalEur', label: 'EUR', type: 'computed', list: true },
      { name: 'status', label: 'Status', type: 'select', options: e(s.invoiceStatus), required: true, list: true, filter: true },
      { name: 'replacesInvoiceId', label: 'Replaces invoice', type: 'ref', ref: 'invoices' },
      { name: 'description', label: 'Description', type: 'textarea', wide: true },
      { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
    ],
  },
  invoice_lines: {
    label: 'Invoice lines',
    singular: 'Invoice line',
    table: s.invoiceLines,
    parent: { fk: 'invoiceId', resource: 'invoices' },
    title: (r) => r.description,
    sort: { field: 'sortOrder', dir: 'asc' },
    fields: [
      { name: 'invoiceId', label: 'Invoice', type: 'ref', ref: 'invoices', required: true },
      { name: 'description', label: 'Description', type: 'text', required: true, list: true, wide: true },
      { name: 'quantity', label: 'Quantity', type: 'number', required: true, list: true },
      { name: 'unitPrice', label: 'Unit price', type: 'money', required: true, list: true },
      { name: 'amount', label: 'Amount', type: 'computed', list: true },
      { name: 'milestoneId', label: 'Milestone', type: 'ref', ref: 'billing_milestones' },
      { name: 'sortOrder', label: 'Order', type: 'number' },
    ],
  },
  payment_allocations: {
    label: 'Payments applied',
    singular: 'Payment applied',
    table: s.paymentAllocations,
    parent: { fk: 'invoiceId', resource: 'invoices' },
    title: (r) => `Allocation #${r.id}`,
    sort: { field: 'id', dir: 'asc' },
    fields: [
      { name: 'transactionId', label: 'Payment (ledger)', type: 'ref', ref: 'transactions', required: true, list: true },
      { name: 'invoiceId', label: 'Invoice', type: 'ref', ref: 'invoices', required: true, list: true },
      { name: 'amount', label: 'Amount settled (invoice currency)', type: 'money', required: true, list: true },
    ],
  },
  clients: {
    label: 'Clients',
    singular: 'Client',
    table: s.clients,
    title: (r) => r.name,
    sort: { field: 'name', dir: 'asc' },
    search: ['name', 'email', 'phone', 'whatsapp', 'services', 'notes'],
    attachments: true,
    children: [
      { resource: 'client_companies', fk: 'clientId', label: 'Billing companies' },
      { resource: 'projects', fk: 'clientId', label: 'Projects' },
      { resource: 'invoices', fk: 'clientId', label: 'Invoices' },
      { resource: 'transactions', fk: 'clientId', label: 'Ledger' },
    ],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, list: true },
      { name: 'services', label: 'Services', type: 'text', list: true, wide: true, help: 'What we do for them, e.g. "Meta ads automation, voice agent".' },
      { name: 'phone', label: 'Phone', type: 'phone', list: true, help: 'With country code, e.g. +1 416 555 0100.' },
      { name: 'whatsapp', label: 'WhatsApp', type: 'whatsapp', list: true, help: 'With country code. Opens a chat on wa.me.' },
      { name: 'email', label: 'Email', type: 'email', list: true },
      { name: 'website', label: 'Website', type: 'url', list: true },
      { name: 'productUrl', label: 'Product link', type: 'url', list: true, help: 'Their product, app or store page.' },
      { name: 'country', label: 'Country', type: 'text', list: true },
      { name: 'source', label: 'Came from', type: 'text' },
      { name: 'status', label: 'Status', type: 'select', options: e(s.clientStatus), required: true, list: true, filter: true },
      { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
    ],
  },
  client_companies: {
    label: 'Billing companies',
    singular: 'Billing company',
    table: s.clientCompanies,
    parent: { fk: 'clientId', resource: 'clients' },
    title: (r) => r.legalName,
    sort: { field: 'legalName', dir: 'asc' },
    attachments: true,
    fields: [
      { name: 'clientId', label: 'Client', type: 'ref', ref: 'clients', required: true, list: true },
      { name: 'legalName', label: 'Legal name', type: 'text', required: true, list: true },
      { name: 'country', label: 'Country', type: 'text', list: true },
      { name: 'registrationNo', label: 'Registration no.', type: 'text' },
      { name: 'taxId', label: 'Tax ID', type: 'text' },
      { name: 'billingEmail', label: 'Billing email', type: 'email' },
      { name: 'address', label: 'Address', type: 'textarea', wide: true },
      { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
    ],
  },
  projects: {
    label: 'Projects',
    singular: 'Project',
    table: s.projects,
    title: (r) => r.name,
    sort: { field: 'startDate', dir: 'desc' },
    search: ['name', 'description', 'notes'],
    sumField: 'totalValueEur',
    attachments: true,
    children: [
      { resource: 'billing_milestones', fk: 'projectId', label: 'Payment schedule' },
      { resource: 'invoices', fk: 'projectId', label: 'Invoices' },
      { resource: 'recurring_charges', fk: 'projectId', label: 'Recurring charges' },
      { resource: 'placements', fk: 'projectId', label: 'Staff placements' },
      { resource: 'transactions', fk: 'projectId', label: 'Ledger' },
    ],
    fields: [
      { name: 'name', label: 'Project', type: 'text', required: true, list: true, wide: true },
      { name: 'clientId', label: 'Client', type: 'ref', ref: 'clients', required: true, list: true, filter: true },
      { name: 'companyId', label: 'Billed company', type: 'ref', ref: 'client_companies' },
      { name: 'serviceLine', label: 'Service line', type: 'select', options: e(s.serviceLine), required: true, list: true, filter: true },
      { name: 'status', label: 'Status', type: 'select', options: e(s.projectStatus), required: true, list: true, filter: true },
      { name: 'currency', label: 'Currency', type: 'currency', required: true },
      { name: 'totalValue', label: 'Agreed value', type: 'money', required: true },
      { name: 'fxRate', label: 'Rate to EUR', type: 'rate' },
      { name: 'totalValueEur', label: 'Value (EUR)', type: 'computed', list: true },
      { name: 'startDate', label: 'Start', type: 'date', list: true },
      { name: 'endDate', label: 'End', type: 'date' },
      { name: 'paymentTerms', label: 'Payment terms', type: 'textarea', wide: true },
      { name: 'description', label: 'Description', type: 'textarea', wide: true },
      { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
    ],
  },
  billing_milestones: {
    label: 'Payment schedule',
    singular: 'Milestone',
    table: s.billingMilestones,
    parent: { fk: 'projectId', resource: 'projects' },
    title: (r) => r.label,
    sort: { field: 'sortOrder', dir: 'asc' },
    fields: [
      { name: 'projectId', label: 'Project', type: 'ref', ref: 'projects', required: true },
      { name: 'label', label: 'Milestone', type: 'text', required: true, list: true },
      { name: 'amount', label: 'Amount (project currency)', type: 'money', required: true, list: true },
      { name: 'dueDate', label: 'Due', type: 'date', list: true },
      { name: 'status', label: 'Status', type: 'select', options: e(s.milestoneStatus), required: true, list: true },
      { name: 'sortOrder', label: 'Order', type: 'number' },
    ],
  },
  recurring_charges: {
    label: 'Recurring charges',
    singular: 'Recurring charge',
    table: s.recurringCharges,
    parent: { fk: 'projectId', resource: 'projects' },
    title: (r) => r.description,
    sort: { field: 'startDate', dir: 'asc' },
    fields: [
      { name: 'projectId', label: 'Project', type: 'ref', ref: 'projects', required: true },
      { name: 'description', label: 'Description', type: 'text', required: true, list: true, wide: true },
      { name: 'amount', label: 'Amount', type: 'money', required: true, list: true },
      { name: 'currency', label: 'Currency', type: 'currency', required: true, list: true },
      { name: 'cycle', label: 'Cycle', type: 'select', options: e(s.billingCycle), required: true, list: true },
      { name: 'dayOfMonth', label: 'Day of month', type: 'number' },
      { name: 'startDate', label: 'Start', type: 'date', required: true, list: true },
      { name: 'endDate', label: 'End', type: 'date' },
      { name: 'isActive', label: 'Active', type: 'boolean', list: true },
    ],
  },
  placements: {
    label: 'Staff placements',
    singular: 'Placement',
    table: s.placements,
    parent: { fk: 'projectId', resource: 'projects' },
    title: (r) => r.role ?? `Placement #${r.id}`,
    sort: { field: 'startDate', dir: 'desc' },
    description: 'Staffing: which developer works for which client, and what the client pays per month.',
    fields: [
      { name: 'projectId', label: 'Staffing project', type: 'ref', ref: 'projects', required: true, list: true },
      { name: 'teamMemberId', label: 'Team member', type: 'ref', ref: 'team_members', required: true, list: true },
      { name: 'role', label: 'Role', type: 'text', list: true },
      { name: 'monthlyBillAmount', label: 'Client pays per month', type: 'money', required: true },
      { name: 'currency', label: 'Currency', type: 'currency', required: true },
      { name: 'fxRate', label: 'Rate to EUR', type: 'rate' },
      { name: 'monthlyBillEur', label: 'Per month (EUR)', type: 'computed', list: true },
      { name: 'startDate', label: 'Start', type: 'date', required: true, list: true },
      { name: 'freeUntil', label: 'Free until', type: 'date', help: 'End of the free first month.' },
      { name: 'endDate', label: 'End', type: 'date' },
      { name: 'status', label: 'Status', type: 'select', options: e(s.placementStatus), required: true, list: true },
      { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
    ],
  },
  team_members: {
    label: 'Team',
    singular: 'Team member',
    table: s.teamMembers,
    title: (r) => r.fullName,
    sort: { field: 'joinDate', dir: 'desc' },
    search: ['fullName', 'position', 'workEmail', 'notes'],
    attachments: true,
    children: [
      { resource: 'salary_history', fk: 'teamMemberId', label: 'Salary history' },
      { resource: 'placements', fk: 'teamMemberId', label: 'Placements' },
      { resource: 'transactions', fk: 'teamMemberId', label: 'Payments' },
      { resource: 'assets', fk: 'assignedToId', label: 'Equipment' },
    ],
    fields: [
      { name: 'fullName', label: 'Name', type: 'text', required: true, list: true },
      { name: 'position', label: 'Position', type: 'text', list: true },
      { name: 'location', label: 'Location', type: 'text', list: true },
      { name: 'currentSalaryEur', label: 'Monthly salary', type: 'computed', list: true, virtual: true },
      { name: 'workEmail', label: 'Work email', type: 'email' },
      { name: 'phone', label: 'Phone', type: 'text' },
      { name: 'employmentType', label: 'Type', type: 'select', options: e(s.employmentType), required: true, filter: true },
      { name: 'joinDate', label: 'Joined', type: 'date', list: true },
      { name: 'exitDate', label: 'Left', type: 'date', list: true },
      { name: 'status', label: 'Status', type: 'select', options: e(s.memberStatus), required: true, list: true, filter: true },
      { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
    ],
  },
  salary_history: {
    label: 'Salary history',
    singular: 'Salary change',
    table: s.salaryHistory,
    parent: { fk: 'teamMemberId', resource: 'team_members' },
    title: (r) => `From ${r.effectiveFrom}`,
    sort: { field: 'effectiveFrom', dir: 'desc' },
    fields: [
      { name: 'teamMemberId', label: 'Team member', type: 'ref', ref: 'team_members', required: true },
      { name: 'effectiveFrom', label: 'From', type: 'date', required: true, list: true },
      { name: 'monthlyAmount', label: 'Monthly salary', type: 'money', required: true },
      { name: 'currency', label: 'Currency', type: 'currency', required: true },
      { name: 'fxRate', label: 'Rate to EUR', type: 'rate' },
      { name: 'monthlyEur', label: 'Monthly (EUR)', type: 'computed', list: true },
      { name: 'reason', label: 'Reason', type: 'text', list: true, wide: true },
    ],
  },
  tools: {
    label: 'Tools',
    singular: 'Tool',
    table: s.tools,
    title: (r) => r.name,
    sort: { field: 'name', dir: 'asc' },
    search: ['name', 'loginEmail', 'notes', 'category'],
    attachments: true,
    children: [{ resource: 'transactions', fk: 'toolId', label: 'Payments' }],
    fields: [
      { name: 'name', label: 'Tool', type: 'text', required: true, list: true },
      { name: 'vendorId', label: 'Vendor', type: 'ref', ref: 'vendors' },
      { name: 'category', label: 'Category', type: 'text', list: true },
      { name: 'loginEmail', label: 'Login email', type: 'email', list: true },
      { name: 'plan', label: 'Plan', type: 'text' },
      { name: 'billingCycle', label: 'Billing', type: 'select', options: e(s.billingCycle), required: true, list: true, filter: true },
      { name: 'expectedAmount', label: 'Expected charge', type: 'money' },
      { name: 'currency', label: 'Currency', type: 'currency', required: true },
      { name: 'fxRate', label: 'Rate to EUR', type: 'rate' },
      { name: 'expectedEur', label: 'Expected (EUR)', type: 'computed', list: true },
      { name: 'paymentAccountId', label: 'Paid with', type: 'ref', ref: 'accounts', list: true, filter: true },
      { name: 'ownerName', label: 'Owner', type: 'text' },
      { name: 'status', label: 'Status', type: 'select', options: e(s.toolStatus), required: true, list: true, filter: true },
      { name: 'startDate', label: 'Started', type: 'date' },
      { name: 'renewalDate', label: 'Renews', type: 'date', list: true },
      { name: 'cancelledOn', label: 'Cancelled on', type: 'date' },
      { name: 'credentialRef', label: 'Password manager entry', type: 'text', wide: true, help: 'Where the login is stored, e.g. "Bitwarden > Optimail > OpenAI". Never the password.' },
      { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
    ],
  },
  vendors: {
    label: 'Vendors',
    singular: 'Vendor',
    table: s.vendors,
    title: (r) => r.name,
    sort: { field: 'name', dir: 'asc' },
    search: ['name', 'notes'],
    attachments: true,
    children: [
      { resource: 'tools', fk: 'vendorId', label: 'Tools' },
      { resource: 'transactions', fk: 'vendorId', label: 'Payments' },
    ],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, list: true },
      { name: 'type', label: 'Type', type: 'select', options: e(s.vendorType), required: true, list: true, filter: true },
      { name: 'email', label: 'Email', type: 'email', list: true },
      { name: 'website', label: 'Website', type: 'url' },
      { name: 'country', label: 'Country', type: 'text' },
      { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
    ],
  },
  accounts: {
    label: 'Accounts & cards',
    singular: 'Account',
    table: s.accounts,
    title: (r) => r.name,
    sort: { field: 'name', dir: 'asc' },
    children: [{ resource: 'transactions', fk: 'accountId', label: 'Transactions' }],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, list: true },
      { name: 'type', label: 'Type', type: 'select', options: e(s.accountType), required: true, list: true },
      { name: 'provider', label: 'Provider', type: 'text', list: true },
      { name: 'holder', label: 'Holder', type: 'text', list: true },
      { name: 'last4', label: 'Last 4 digits', type: 'text' },
      { name: 'currency', label: 'Currency', type: 'currency', required: true },
      { name: 'openingBalanceEur', label: 'Opening balance (EUR)', type: 'money', help: 'Balance on the opening date. Set this for Wise to see runway.' },
      { name: 'openingDate', label: 'Opening date', type: 'date' },
      { name: 'isActive', label: 'Active', type: 'boolean', list: true },
      { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
    ],
  },
  ledger_statuses: {
    label: 'Ledger statuses',
    singular: 'Status',
    table: s.ledgerStatuses,
    description: 'Statuses for ledger entries, shared by both companies. confirmed and review are built in.',
    title: (r) => r.name,
    sort: { field: 'sortOrder', dir: 'asc' },
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, list: true },
      { name: 'sortOrder', label: 'Order', type: 'number', list: true },
    ],
  },
  categories: {
    label: 'Categories',
    singular: 'Category',
    table: s.categories,
    title: (r) => r.name,
    sort: { field: 'sortOrder', dir: 'asc' },
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, list: true },
      { name: 'kind', label: 'Kind', type: 'select', options: e(s.categoryKind), required: true, list: true, filter: true },
      { name: 'pnlGroup', label: 'P&L line', type: 'text', required: true, list: true, help: 'Revenue, Manpower, Rent, Systems & Tools, Other Office Cost, Equipment, Meta Ads & Webinars...' },
      { name: 'sortOrder', label: 'Order', type: 'number' },
      { name: 'isActive', label: 'Active', type: 'boolean', list: true },
    ],
  },
  assets: {
    label: 'Assets',
    singular: 'Asset',
    table: s.assets,
    title: (r) => r.name,
    sort: { field: 'purchaseDate', dir: 'desc' },
    sumField: 'costEur',
    attachments: true,
    fields: [
      { name: 'name', label: 'Asset', type: 'text', required: true, list: true },
      { name: 'category', label: 'Category', type: 'text', list: true },
      { name: 'purchaseDate', label: 'Bought', type: 'date', list: true },
      { name: 'costEur', label: 'Cost (EUR)', type: 'money', required: true, list: true },
      { name: 'usefulLifeMonths', label: 'Useful life (months)', type: 'number' },
      { name: 'refundable', label: 'Refundable deposit', type: 'boolean' },
      { name: 'assignedToId', label: 'Assigned to', type: 'ref', ref: 'team_members', list: true },
      { name: 'serialNo', label: 'Serial no.', type: 'text' },
      { name: 'status', label: 'Status', type: 'select', options: e(s.assetStatus), required: true, list: true },
      { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
    ],
  },
  marketing_campaigns: {
    label: 'Campaigns',
    singular: 'Campaign',
    table: s.marketingCampaigns,
    title: (r) => r.name,
    sort: { field: 'name', dir: 'asc' },
    children: [
      { resource: 'leads', fk: 'campaignId', label: 'Leads' },
      { resource: 'transactions', fk: 'campaignId', label: 'Ad spend' },
    ],
    fields: [
      { name: 'name', label: 'Campaign', type: 'text', required: true, list: true },
      { name: 'platform', label: 'Platform', type: 'text', required: true, list: true },
      { name: 'serviceLine', label: 'Service line', type: 'select', options: e(s.serviceLine), required: true, list: true },
      { name: 'externalId', label: 'Platform ID', type: 'text' },
      { name: 'startDate', label: 'Start', type: 'date', list: true },
      { name: 'endDate', label: 'End', type: 'date' },
      { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
    ],
  },
  leads: {
    label: 'Leads',
    singular: 'Lead',
    table: s.leads,
    title: (r) => r.fullName ?? r.email ?? `Lead #${r.id}`,
    sort: { field: 'receivedAt', dir: 'desc' },
    search: ['fullName', 'email', 'company', 'notes'],
    fields: [
      { name: 'fullName', label: 'Name', type: 'text', list: true },
      { name: 'company', label: 'Company', type: 'text', list: true },
      { name: 'email', label: 'Email', type: 'email', list: true },
      { name: 'phone', label: 'Phone', type: 'text' },
      { name: 'website', label: 'Website', type: 'text' },
      { name: 'campaignId', label: 'Campaign', type: 'ref', ref: 'marketing_campaigns', filter: true },
      { name: 'requirement', label: 'Requirement', type: 'text' },
      { name: 'headcount', label: 'People needed', type: 'text', list: true },
      { name: 'talentType', label: 'Talent', type: 'text' },
      { name: 'timeline', label: 'Timeline', type: 'text' },
      { name: 'status', label: 'Status', type: 'select', options: e(s.leadStatus), required: true, list: true, filter: true },
      { name: 'clientId', label: 'Became client', type: 'ref', ref: 'clients' },
      { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
    ],
  },
  fx_rates: {
    label: 'Exchange rates',
    singular: 'Exchange rate',
    table: s.fxRates,
    title: (r) => `${r.currency} ${r.rateDate}`,
    sort: { field: 'rateDate', dir: 'desc' },
    description: 'Default rates to EUR. The latest rate on or before a date is used when a rate is left empty.',
    fields: [
      { name: 'currency', label: 'Currency', type: 'currency', required: true, list: true },
      { name: 'rateDate', label: 'From date', type: 'date', required: true, list: true },
      { name: 'rateToEur', label: '1 unit in EUR', type: 'rate', required: true, list: true },
      { name: 'source', label: 'Source', type: 'text', list: true },
    ],
  },
};

export const resources = Object.fromEntries(
  Object.entries(RESOURCES).map(([key, r]) => [key, { key, ...r }]),
) as unknown as Record<ResourceKey, Resource>;

export function getResource(key: string): Resource | null {
  return (resources as Record<string, Resource>)[key] ?? null;
}

// Fields whose value is calculated by the database (EUR columns).
export const editableFields = (r: Resource) => r.fields.filter((f) => f.type !== 'computed');

// Tables a dropdown can add to on the spot ("+ Add new..."). The small form asks only for
// the required fields; the rest can be filled in later on the record's own page.
export const QUICK_ADD: readonly ResourceKey[] = [
  'categories', 'accounts', 'clients', 'client_companies', 'projects', 'team_members', 'tools', 'vendors', 'marketing_campaigns',
  'ledger_statuses',
];
// Which category kind a ledger entry type may use, so income can't be filed under a cost.
// Types not listed (transfer) can use any category.
export const CATEGORY_KIND_FOR_TYPE: Record<string, string> = {
  income: 'income', reversal: 'income', expense: 'expense', refund: 'expense', funding: 'equity', deposit: 'asset',
};
export const quickFields = (key: ResourceKey) =>
  resources[key].fields.filter((f) => (f.required || f.type === 'boolean') && f.type !== 'computed' && !f.virtual);
