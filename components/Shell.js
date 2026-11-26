'use client';

import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';

const BARE = ['/login', '/access-expired'];

// Login and "access expired" pages render without the sidebar.
export default function Shell({ children }) {
  const path = usePathname();
  if (BARE.includes(path)) return <div className="auth-page">{children}</div>;
  return (
    <div className="shell">
      <Sidebar />
      <main className="main">{children}</main>
    </div>
  );
}
