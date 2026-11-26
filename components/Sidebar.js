'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export const NAV = [
  { href: '/', label: 'Dashboard', icon: '▦' },
  { href: '/mailboxes', label: 'Mailbox Accounts', icon: '✉' },
  { href: '/contacts', label: 'Contacts', icon: '👤' },
  { href: '/campaigns', label: 'Campaigns', icon: '➤' },
  { href: '/sequences', label: 'Sequences', icon: '↻' },
  { href: '/inbox', label: 'Unified Inbox', icon: '⇩' },
  { href: '/templates', label: 'Templates', icon: '❏' },
  { href: '/jobs', label: 'Scheduled Jobs', icon: '⏱' },
  { href: '/analytics', label: 'Analytics', icon: '▤' },
  { href: '/suppression', label: 'Suppression List', icon: '⊘' },
  { href: '/health', label: 'Account Health', icon: '♥' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
  { href: '/logs', label: 'Activity Logs', icon: '≡' },
];

export default function Sidebar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState(null);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    fetch('/api/auth/session').then((r) => r.json()).then(setMe).catch(() => {});
  }, []);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/login';
  }

  const nav = me?.role === 'admin' ? [{ href: '/admin', label: 'Admin Panel', icon: '★' }, ...NAV] : NAV;

  return (
    <>
      <button className="nav-toggle" aria-label="Open menu" onClick={() => setOpen(true)}>☰</button>
      {open && <div className="nav-scrim" onClick={() => setOpen(false)} />}
      <aside className={'sidebar' + (open ? ' open' : '')}>
        <div className="brand">
          <span className="brand-mark">MR</span>
          <div>
            <div className="brand-name">Mail Rotator</div>
            <div className="brand-sub">Outreach</div>
          </div>
        </div>
        <nav>
          {nav.map((n) => {
            const active = n.href === '/' ? path === '/' : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={'nav-link' + (active ? ' active' : '')}>
                <span className="nav-icon" aria-hidden>{n.icon}</span>
                {n.label}
              </Link>
            );
          })}
        </nav>
        {me?.status === 'ok' && (
          <div className="me">
            <div className="me-email" title={me.email}>{me.email}</div>
            <div className="me-sub">
              {me.role === 'admin' ? 'Admin' : `Access until ${new Date(me.validUntil).toLocaleDateString()}`}
            </div>
            <button className="ghost sm" onClick={signOut}>Log out</button>
          </div>
        )}
      </aside>
    </>
  );
}
