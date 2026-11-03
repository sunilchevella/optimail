'use client';

import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Nav, type NavAccess } from './Nav';

export function MobileMenu({ access }: { access: NavAccess }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button className="btn px-2" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}>
        {open ? <X size={18} /> : <Menu size={18} />}
      </button>
      {open && (
        <div className="fixed inset-x-0 top-14 bottom-0 z-40 overflow-y-auto border-t border-line bg-surface p-4">
          <Nav onNavigate={() => setOpen(false)} access={access} />
        </div>
      )}
    </div>
  );
}
