export const metadata = {
  title: 'SPECTRE C2 — Live View',
  description: 'Real-time Arma 3 tactical map',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      </head>
      <body style={{ margin: 0, padding: 0, background: '#1b1b1b' }}>
        {children}
      </body>
    </html>
  );
}
