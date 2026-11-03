'use client';

import { useActionState } from 'react';
import { changePassword } from '@/app/actions';

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, undefined);
  return (
    <form action={action} className="space-y-3">
      <input name="password" type="password" autoComplete="new-password" placeholder="New password (10+ characters)" className="field" aria-label="New password" required minLength={10} />
      <input name="confirm" type="password" autoComplete="new-password" placeholder="Repeat new password" className="field" aria-label="Repeat new password" required />
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" disabled={pending}>{pending ? 'Saving...' : 'Change password'}</button>
        {state?.error && <span role="alert" className="text-sm text-bad">{state.error}</span>}
        {state?.ok && <span className="text-sm text-good">{state.ok}</span>}
      </div>
    </form>
  );
}
