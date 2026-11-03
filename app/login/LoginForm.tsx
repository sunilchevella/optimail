'use client';

import { useActionState } from 'react';
import { signIn } from '@/app/actions';

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, undefined);
  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="email" className="mb-1 block text-xs font-medium text-ink-2">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="field" />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-xs font-medium text-ink-2">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="field" />
      </div>
      {state?.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      <button className="btn btn-primary w-full justify-center" disabled={pending}>{pending ? 'Signing in...' : 'Sign in'}</button>
    </form>
  );
}
