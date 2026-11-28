import React from 'react';

// SPECTRE line icons (24 x 24, drawn for this app).
const PATHS = {
  units: 'M3 15l2-6h11l5 5v3H3zM7 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM17 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  contacts: 'M12 3l9 9-9 9-9-9zM12 8.5v4.5M12 16v.4',
  intel: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h5',
  orders: 'M9 6h11M9 12h11M9 18h11M4 6h.4M4 12h.4M4 18h.4',
  graph: 'M6 6.5a2.5 2.5 0 1 0 0 .1M18 8a2.5 2.5 0 1 0 0 .1M10 18a2.5 2.5 0 1 0 0 .1M8.4 7.4l7.2 1.2M7 9l2.2 6.6M16.4 10l-4.8 6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  pair: 'M10 14a4 4 0 0 0 6 .5l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-6-.5l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  web: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  comms: 'M4 5h16v11H9l-5 4z',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5',
  swap: 'M7 7h13l-3.5-3.5M17 17H4l3.5 3.5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  close: 'M6 6l12 12M18 6L6 18',
  hold: 'M9 5v14M15 5v14',
  home: 'M4 11l8-7 8 7M6.5 10v10h11V10',
  move: 'M4 12h14M13 6l6 6-6 6',
  attack: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM12 2v6M12 16v6M2 12h6M16 12h6',
  formUp: 'M5 5l5 5M10 5.5V10H5.5M19 5l-5 5M14 5.5V10h4.5M5 19l5-5M10 18.5V14H5.5M19 19l-5-5M14 18.5V14h4.5',
  disperse: 'M10 10L5 5M5 9.5V5h4.5M14 10l5-5M14.5 5H19v4.5M10 14l-5 5M5 14.5V19h4.5M14 14l5 5M19 14.5V19h-4.5',
  shield: 'M12 3l8 3v6c0 5-3.5 7.8-8 9-4.5-1.2-8-4-8-9V6z',
  alert: 'M12 4l9 16H3zM12 10v4.5M12 17.2v.3',
  arrow: 'M12 3l7 17-7-4-7 4z',
  smoke: 'M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6 11.5 3.3 3.3 0 0 0 7 18zM8 21.5h8',
  land: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  minimize: 'M6 12h12',
  maximize: 'M7 7h10v10H7z',
};

export default function Icon({ name, size = 18, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] || ''} />
    </svg>
  );
}
