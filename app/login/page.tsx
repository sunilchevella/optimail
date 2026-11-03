import type { Metadata } from 'next';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in · Optimail Finance' };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">Optimail Finance</h1>
        <p className="mb-5 mt-1 text-sm text-ink-2">Sign in with the login you were given.</p>
        <LoginForm />
      </div>
    </main>
  );
}
