export const metadata = {
  title: 'SPECTRE C2 — Live View',
  description: 'Real-time Arma 3 tactical map',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
        <style>{`
          .leaflet-tile-pane {
            filter: brightness(0.6) saturate(0.4) hue-rotate(180deg);
          }
        `}</style>
      </head>
      <body style={{ margin: 0, padding: 0, background: '#1b1b1b' }}>
        {children}
      </body>
    </html>
  );
}
