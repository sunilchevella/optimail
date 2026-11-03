'use client';

import { useActionState } from 'react';
import type { FormState } from '@/app/actions';
import type { Field } from '@/lib/resources';
import { CURRENCIES } from '@/lib/resources';

type Props = {
  fields: Field[];
  options: Record<string, { value: number; label: string }[]>;
  initial: Record<string, any>;
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  submitLabel: string;
  readOnly?: boolean;
  returnTo?: string;
};

const toInput = (f: Field, v: any) => {
  if (v === null || v === undefined) return '';
  if (f.type === 'month') return String(v).slice(0, 7);
  if (f.type === 'date') return String(v).slice(0, 10);
  return String(v);
};

export function RecordForm({ fields, options, initial, action, submitLabel, readOnly, returnTo }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const editable = fields.filter((f) => f.type !== 'computed');

  return (
    <form action={formAction} className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      {returnTo && <input type="hidden" name="_return" value={returnTo} />}
      {editable.map((f) => {
        const id = `f-${f.name}`;
        const value = toInput(f, initial[f.name]);
        const common = { id, name: f.name, disabled: readOnly, defaultValue: value, className: 'field' };
        let control;
        switch (f.type) {
          case 'textarea':
            control = <textarea {...common} rows={3} />;
            break;
          case 'select':
            control = (
              <select {...common} defaultValue={value || (f.required ? f.options?.[0] : '')}>
                {!f.required && <option value="">-</option>}
                {f.options?.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
              </select>
            );
            break;
          case 'ref':
            control = (
              <select {...common}>
                <option value="">-</option>
                {options[f.ref!]?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            );
            break;
          case 'currency':
            control = (
              <select {...common} defaultValue={value || 'EUR'}>
                {[...new Set([...CURRENCIES, ...(value ? [value] : [])])].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            );
            break;
          case 'boolean':
            return (
              <label key={f.name} className="flex items-center gap-2 self-end py-2 text-sm">
                <input type="checkbox" name={f.name} defaultChecked={initial[f.name] ?? true} disabled={readOnly} />
                {f.label}
              </label>
            );
          default: {
            // url stays a text input so "example.com" is accepted; https:// is added on save.
            const type = { date: 'date', month: 'month', email: 'email', phone: 'tel', whatsapp: 'tel' }[f.type as string] ?? 'text';
            const numeric = ['number', 'money', 'rate'].includes(f.type);
            control = <input {...common} type={type} inputMode={numeric ? 'decimal' : undefined} step={numeric ? 'any' : undefined} />;
          }
        }
        return (
          <div key={f.name} className={f.wide ? 'sm:col-span-2' : ''}>
            <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-2">
              {f.label}{f.required && !readOnly && <span className="text-bad"> *</span>}
            </label>
            {control}
            {f.help && !readOnly && <p className="mt-1 text-xs text-muted">{f.help}</p>}
          </div>
        );
      })}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button className="btn btn-primary" disabled={pending}>{pending ? 'Saving...' : submitLabel}</button>
          {state?.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
        </div>
      )}
    </form>
  );
}
