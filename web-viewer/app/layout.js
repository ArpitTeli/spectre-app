export const metadata = {
  title: 'SPECTRE C2 — Live View',
  description: 'Real-time Arma 3 tactical map',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: '#1b1b1b' }}>
        {children}
      </body>
    </html>
  );
}
