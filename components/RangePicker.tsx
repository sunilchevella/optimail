'use client';

import { useState } from 'react';

type Option = { value: string; label: string };

export default function RangePicker({ options, range, from, to, min, max }: {
  options: Option[]; range: string; from: string; to: string; min?: string; max: string;
}) {
  const [value, setValue] = useState(range);
  const custom = value === 'custom';

  return (
    <form className="flex flex-wrap items-center gap-2">
      <label htmlFor="range" className="sr-only">Period</label>
      <select id="range" name="range" value={value} onChange={(e) => setValue(e.target.value)} className="field w-40">
        {options.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
      {custom && (
        <>
          <label htmlFor="from" className="sr-only">From month</label>
          <input id="from" type="month" name="from" defaultValue={from} min={min} max={max} required className="field w-40" />
          <span className="text-sm text-muted">to</span>
          <label htmlFor="to" className="sr-only">To month</label>
          <input id="to" type="month" name="to" defaultValue={to} min={min} max={max} required className="field w-40" />
        </>
      )}
      <button className="btn">Show</button>
    </form>
  );
}
