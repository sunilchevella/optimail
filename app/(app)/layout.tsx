import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowLeftRight, LogOut } from 'lucide-react';
import { signOut } from '@/app/actions';
import { Nav } from '@/components/Nav';
import { MobileMenu } from '@/components/MobileMenu';
import { can, getCurrentUser, hasFinance } from '@/lib/auth';
import { getCompany } from '@/lib/company';

async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <div className="flex items-center gap-3 text-sm">
      <Link href="/account" className="hidden text-right sm:block">
        <span className="block font-medium leading-tight">{user.fullName}</span>
        <span className="block text-xs text-muted">{user.role}</span>
      </Link>
      <form action={signOut}>
        <button className="btn px-2" aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>
      </form>
    </div>
  );
}

// Menus depend on the login (which areas it can open, and Users & access only for
// owners/admins), so they stream in.
async function RoleNav({ mobile }: { mobile?: boolean }) {
  const user = await getCurrentUser();
  const access = {
    finance: !!user && hasFinance(user),
    canManageUsers: !!user && hasFinance(user) && can(user, 'manageUsers'),
  };
  return mobile ? <MobileMenu access={access} /> : <Nav access={access} />;
}

// The company whose books are open (picked on /company).
async function CompanyName() {
  const company = await getCompany();
  return <>{company?.name ?? 'Choose a company'}</>;
}

export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-r border-line bg-surface p-4 lg:block">
        <div className="mb-6 px-2">
          <Link href="/" className="block text-base font-semibold tracking-tight"><Suspense fallback="Finance"><CompanyName /></Suspense></Link>
          <Link href="/company" className="mt-1 inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
            <ArrowLeftRight size={12} aria-hidden /> Switch company
          </Link>
        </div>
        <Suspense><RoleNav /></Suspense>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur lg:px-8">
          <div className="flex items-center gap-2">
            <Suspense><RoleNav mobile /></Suspense>
            <Link href="/company" className="font-semibold lg:hidden" title="Switch company"><Suspense fallback="Finance"><CompanyName /></Suspense></Link>
          </div>
          <Suspense><UserMenu /></Suspense>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
