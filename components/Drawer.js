'use client';

import { useEffect, useRef } from 'react';

// Right-side slide-over panel used for every add / edit / detail view.
// <Drawer open title="Add mailbox" onClose={...} footer={<button/>}>...</Drawer>
export default function Drawer({ open, title, subtitle, onClose, children, footer, width = 520 }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => panelRef.current?.querySelector('input,select,textarea,button')?.focus(), 50);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      clearTimeout(t);
    };
  }, [open, onClose]);

  return (
    <div className={'drawer-root' + (open ? ' open' : '')} aria-hidden={!open}>
      <div className="drawer-scrim" onClick={onClose} />
      <aside
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width: `min(${width}px, 100vw)` }}
      >
        <header className="drawer-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <div className="drawer-sub">{subtitle}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="drawer-body">{open && children}</div>
        {footer && open && <footer className="drawer-foot">{footer}</footer>}
      </aside>
    </div>
  );
}
