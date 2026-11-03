'use client';

import { useActionState } from 'react';
import type { FormState } from '@/app/actions';

// A one-click server action (delete, remove file) with a confirm step and inline result.
export function ActionButton({ action, label, confirm, className = 'btn btn-danger' }: {
  action: (prev: FormState) => Promise<FormState>;
  label: string;
  confirm?: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form
      action={formAction}
      onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}
      className="inline-flex items-center gap-2"
    >
      <button className={className} disabled={pending}>{pending ? '...' : label}</button>
      {state?.error && <span role="alert" className="text-sm text-bad">{state.error}</span>}
      {state?.ok && <span className="text-sm text-good">{state.ok}</span>}
    </form>
  );
}
