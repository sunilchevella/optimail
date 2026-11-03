import type { Metadata } from 'next';
import { signOut } from '@/app/actions';

export const metadata: Metadata = { title: 'No access · Optimail Finance' };

// Shown to someone with a valid login whose account is switched off (or was just removed).
export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">No access</h1>
        <p className="mb-5 mt-1 text-sm text-ink-2">
          This login is not switched on. Ask an owner or admin of Optimail Finance to give you access.
        </p>
        <form action={signOut}>
          <button className="btn w-full justify-center">Sign out</button>
        </form>
      </div>
    </main>
  );
}
