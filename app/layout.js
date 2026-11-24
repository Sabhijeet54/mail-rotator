import './globals.css';
import Sidebar from '../components/Sidebar';

export const metadata = {
  title: 'Mail Rotator',
  description: 'Multi-mailbox outreach',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <Sidebar />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
