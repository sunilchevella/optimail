'use client';

import { useActionState } from 'react';
import type { FormState } from '@/app/actions';

const ROLES = ['owner', 'admin', 'accountant', 'editor', 'viewer'];

function Result({ state }: { state: FormState }) {
  if (state?.error) return <span role="alert" className="text-sm text-bad">{state.error}</span>;
  if (state?.ok) return <span className="text-sm text-good">{state.ok}</span>;
  return null;
}

export function CreateUserForm({ action }: { action: (p: FormState, f: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
      <input name="fullName" placeholder="Full name" className="field" aria-label="Full name" required />
      <input name="email" type="email" placeholder="Email" className="field" aria-label="Email" required />
      <input name="password" type="text" placeholder="Temporary password (10+ chars)" className="field" aria-label="Temporary password" required minLength={10} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-ink-2">Role</span>
        <select name="role" defaultValue="viewer" className="field" aria-label="Role">
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      <div className="flex items-center gap-3 sm:col-span-4">
        <button className="btn btn-primary" disabled={pending}>{pending ? 'Creating...' : 'Create login'}</button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function EditUserForm({ action, role, isActive, disabled }: {
  action: (p: FormState, f: FormData) => Promise<FormState>; role: string; isActive: boolean; disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <select name="role" defaultValue={role} className="field w-32" aria-label="Role" disabled={disabled}>
        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <label className="flex items-center gap-1 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={isActive} disabled={disabled} /> Active
      </label>
      {!disabled && <button className="btn px-2 py-1 text-xs" disabled={pending}>Save</button>}
      <Result state={state} />
    </form>
  );
}

export function PasswordForm({ action }: { action: (p: FormState, f: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input name="password" type="text" placeholder="New password" className="field w-44" aria-label="New password" minLength={10} required />
      <button className="btn px-2 py-1 text-xs" disabled={pending}>Set</button>
      <Result state={state} />
    </form>
  );
}
