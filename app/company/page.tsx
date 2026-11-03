import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Building2, ChevronRight } from 'lucide-react';
import { selectCompany, signOut } from '@/app/actions';
import { requireUser } from '@/lib/auth';
import { companiesFor, getCompany } from '@/lib/company';

export const metadata: Metadata = { title: 'Choose company · Optimail Finance' };

// First screen after sign-in (and behind "Switch company"): pick whose books to open.
export default function CompanyPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-md p-6">
        <h1 className="text-lg font-semibold">Choose a company</h1>
        <p className="mb-5 mt-1 text-sm text-ink-2">Each company has its own books. You can switch at any time from the menu.</p>
        <Suspense fallback={<div className="h-32 animate-pulse rounded-xl bg-surface-2" aria-label="Loading" />}>
          <Companies />
        </Suspense>
        <form action={signOut} className="mt-5">
          <button className="btn w-full justify-center">Sign out</button>
        </form>
      </div>
    </main>
  );
}

async function Companies() {
  const user = await requireUser();
  const [companies, current] = await Promise.all([companiesFor(user), getCompany()]);
  if (!companies.length) return <p className="text-sm text-ink-2">This login has no company yet. Ask an owner or admin.</p>;
  return (
    <ul className="space-y-2">
      {companies.map((c) => (
        <li key={c.id}>
          <form action={selectCompany.bind(null, c.id)}>
            <button className="flex w-full items-center gap-3 rounded-lg border border-line px-4 py-3 text-left hover:bg-surface-2">
              <Building2 size={20} className="shrink-0 text-ink-2" aria-hidden />
              <span className="flex-1">
                <span className="block font-medium">{c.name}</span>
                {current?.id === c.id && <span className="block text-xs text-muted">Open now</span>}
              </span>
              <ChevronRight size={16} className="text-muted" aria-hidden />
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}
