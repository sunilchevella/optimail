'use client';
import { useFormStatus } from 'react-dom';
import { Building2, ChevronRight, Loader2 } from 'lucide-react';

// One company on /company. Opening a company takes a moment, so the button shows it is working.
export function CompanyButton({ name, current }: { name: string; current: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="flex w-full items-center gap-3 rounded-lg border border-line px-4 py-3 text-left hover:bg-surface-2 disabled:opacity-70">
      <Building2 size={20} className="shrink-0 text-ink-2" aria-hidden />
      <span className="flex-1">
        <span className="block font-medium">{name}</span>
        {pending ? <span className="block text-xs text-muted">Opening...</span>
          : current && <span className="block text-xs text-muted">Open now</span>}
      </span>
      {pending ? <Loader2 size={16} className="animate-spin text-muted" aria-hidden />
        : <ChevronRight size={16} className="text-muted" aria-hidden />}
    </button>
  );
}
