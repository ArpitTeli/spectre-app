import React from 'react';

// A ten-segment gauge. Neutral while fine; coloured only when low.
export default function Segments({ label, value, wide }) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  const level = percent <= 30 ? 'bad' : percent <= 60 ? 'warn' : 'ok';
  const lit = Math.ceil(percent / 10);
  return (
    <span className={`segments segments--${level}${wide ? ' segments--wide' : ''}`}>
      <span className="segments__label">{label}</span>
      <span className="segments__bar" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => <i key={i} className={i < lit ? 'on' : ''} />)}
      </span>
      <span className="segments__value">{percent}</span>
    </span>
  );
}
