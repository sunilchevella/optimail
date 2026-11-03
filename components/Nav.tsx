'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  AlertTriangle, BarChart3, Boxes, Building2, CreditCard, FileText, FolderKanban, LayoutDashboard,
  Megaphone, Receipt, Settings, Tags, Users, Wallet, Wrench, Coins, ShieldCheck, ListChecks,
} from 'lucide-react';

type Group = { label: string; items: { href: string; label: string; icon: typeof Megaphone }[] };

const FINANCE_GROUPS: Group[] = [
  { label: 'Overview', items: [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/pnl', label: 'Profit & loss', icon: BarChart3 },
  ] },
  { label: 'Money', items: [
    { href: '/r/transactions', label: 'Ledger', icon: Receipt },
    { href: '/r/transactions?status=review', label: 'Needs review', icon: AlertTriangle },
    { href: '/r/invoices', label: 'Invoices', icon: FileText },
    { href: '/r/accounts', label: 'Accounts & cards', icon: CreditCard },
  ] },
  { label: 'Sales', items: [
    { href: '/r/clients', label: 'Clients', icon: Building2 },
    { href: '/r/projects', label: 'Projects', icon: FolderKanban },
    { href: '/r/marketing_campaigns', label: 'Campaigns', icon: Megaphone },
  ] },
  { label: 'Team & spending', items: [
    { href: '/r/team_members', label: 'Team', icon: Users },
    { href: '/tools', label: 'Tools', icon: Wrench },
    { href: '/r/vendors', label: 'Vendors', icon: Wallet },
    { href: '/r/assets', label: 'Assets', icon: Boxes },
  ] },
  { label: 'Settings', items: [
    { href: '/r/categories', label: 'Categories', icon: Tags },
    { href: '/r/ledger_statuses', label: 'Ledger statuses', icon: ListChecks },
    { href: '/r/fx_rates', label: 'Exchange rates', icon: Coins },
    { href: '/users', label: 'Users & access', icon: ShieldCheck },
  ] },
];

const ACCOUNT_GROUP: Group = { label: 'Account', items: [{ href: '/account', label: 'My account', icon: Settings }] };

export type NavAccess = { finance: boolean; canManageUsers: boolean };

export function Nav({ onNavigate, access }: { onNavigate?: () => void; access: NavAccess }) {
  const groups = [
    ...(access.finance ? FINANCE_GROUPS : []),
    ACCOUNT_GROUP,
  ];
  const pathname = usePathname();
  const params = useSearchParams();
  const isActive = (href: string) => {
    const [path, query] = href.split('?');
    if (query) return pathname === path && params.toString() === query;
    if (path === '/') return pathname === '/';
    if (path === '/r/transactions') return pathname.startsWith(path) && params.get('status') !== 'review';
    return pathname === path || pathname.startsWith(`${path}/`);
  };
  return (
    <nav className="space-y-5 text-sm">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-muted">{g.label}</p>
          <ul className="space-y-0.5">
            {g.items.filter((i) => i.href !== '/users' || access.canManageUsers).map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${isActive(href) ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:bg-surface-2'}`}
                >
                  <Icon size={16} aria-hidden /> {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
