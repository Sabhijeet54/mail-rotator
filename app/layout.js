import './globals.css';

export const metadata = {
  title: 'Mail Rotator',
  description: 'Rotating multi-account email sender',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
