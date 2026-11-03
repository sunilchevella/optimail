'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { keepOnError } from './RecordForm';
import { quickCreate, type QuickState } from '@/app/actions';
import { CURRENCIES, optionLabel, quickFields, QUICK_ADD, resources, type Field, type ResourceKey } from '@/lib/resources';

type Option = { value: number; label: string };
const NEW = '__new';

// A dropdown of records from another table. For the lists in QUICK_ADD it ends with
// "+ Add new...", which opens a small form; the new record is saved and picked right away.
// byName: the field stores the record's name, not its id (ledger status).
export function RefSelect({ id, field, value, options, allOptions, disabled, byName }: {
  id: string; field: Field; value: string; options: Option[]; allOptions: Record<string, Option[]>; disabled?: boolean; byName?: boolean;
}) {
  const key = (field.ref ?? field.optionsFrom)!;
  const [opts, setOpts] = useState(options);
  const [current, setCurrent] = useState(value);
  const [adding, setAdding] = useState(false);
  const canAdd = !disabled && QUICK_ADD.includes(key);
  const optValue = (o: Option) => (byName ? o.label : String(o.value));

  return (
    <>
      <select
        id={id} name={field.name} disabled={disabled} className="field" value={current}
        onChange={(e) => (e.target.value === NEW ? setAdding(true) : setCurrent(e.target.value))}
      >
        {!(byName && field.required) && <option value="">-</option>}
        {opts.map((o) => <option key={o.value} value={optValue(o)}>{byName ? optionLabel(o.label) : o.label}</option>)}
        {canAdd && <option value={NEW}>+ Add new {resources[key].singular.toLowerCase()}...</option>}
      </select>
      {adding && createPortal(
        <QuickAddDialog
          refKey={key}
          allOptions={allOptions}
          onClose={() => setAdding(false)}
          onCreated={(o) => { setOpts((list) => [...list, o]); setCurrent(optValue(o)); setAdding(false); }}
        />,
        document.body,
      )}
    </>
  );
}

// Sensible starting values for the small form (same idea as the New record page).
const DEFAULTS: Record<string, string> = { status: 'active', employmentType: 'employee', kind: 'expense', currency: 'EUR' };

function QuickAddDialog({ refKey, allOptions, onClose, onCreated }: {
  refKey: ResourceKey; allOptions: Record<string, Option[]>; onClose: () => void; onCreated: (o: Option) => void;
}) {
  const r = resources[refKey];
  const fields = quickFields(refKey);
  const [state, action, pending] = useActionState<QuickState, FormData>(quickCreate.bind(null, refKey), undefined);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { if (state?.option) onCreated(state.option); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <dialog ref={dialog} onClose={onClose} className="card m-auto w-full max-w-md p-5 text-ink backdrop:bg-black/50">
      <form onSubmit={(e) => keepOnError(e, action)} className="space-y-3">
        <h2 className="text-base font-semibold">New {r.singular.toLowerCase()}</h2>
        {fields.map((f) => {
          const fid = `q-${refKey}-${f.name}`;
          if (f.type === 'boolean') return <input key={f.name} type="hidden" name={f.name} value="on" />;
          let control;
          if (f.type === 'select') {
            const start = f.options?.includes(DEFAULTS[f.name]) ? DEFAULTS[f.name] : f.options?.[0];
            control = (
              <select id={fid} name={f.name} defaultValue={start} className="field">
                {f.options?.map((o) => <option key={o} value={o}>{optionLabel(o)}</option>)}
              </select>
            );
          } else if (f.type === 'ref') {
            control = (
              <select id={fid} name={f.name} defaultValue="" className="field">
                <option value="">-</option>
                {allOptions[f.ref!]?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            );
          } else if (f.type === 'currency') {
            control = (
              <select id={fid} name={f.name} defaultValue="EUR" className="field">
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            );
          } else {
            const numeric = ['number', 'money', 'rate'].includes(f.type);
            control = <input id={fid} name={f.name} type={f.type === 'date' ? 'date' : 'text'} inputMode={numeric ? 'decimal' : undefined} className="field" autoFocus={f === fields[0]} />;
          }
          return (
            <div key={f.name}>
              <label htmlFor={fid} className="mb-1 block text-xs font-medium text-ink-2">{f.label}<span className="text-bad"> *</span></label>
              {control}
              {f.help && <p className="mt-1 text-xs text-muted">{f.help}</p>}
            </div>
          );
        })}
        <p className="text-xs text-muted">Other details can be added later on its own page.</p>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" disabled={pending}>{pending ? 'Saving...' : 'Save and pick it'}</button>
          <button type="button" className="btn" onClick={() => dialog.current?.close()}>Cancel</button>
          {state?.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
        </div>
      </form>
    </dialog>
  );
}
