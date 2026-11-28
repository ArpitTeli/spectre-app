import React from 'react';

// Compass dial: the pointer is the unit's heading, the figure its speed.
export default function HeadingDial({ heading, speed }) {
  const ticks = Array.from({ length: 36 }, (_, i) => i * 10);
  return (
    <svg className="dial" viewBox="-60 -60 120 120" role="img" aria-label={`Heading ${Math.round(heading)} degrees, ${Math.round(speed)} kilometres per hour`}>
      <circle r="57" className="dial__rim" />
      {ticks.map((angle) => (
        <line key={angle} className={angle % 90 === 0 ? 'dial__major' : 'dial__tick'} x1="0" y1="-56" x2="0" y2={angle % 30 === 0 ? -49 : -52} transform={`rotate(${angle})`} />
      ))}
      {[['N', 0, -39], ['E', 40, 3.5], ['S', 0, 45], ['W', -40, 3.5]].map(([text, x, y]) => (
        <text key={text} className={`dial__point${text === 'N' ? ' dial__north' : ''}`} x={x} y={y}>{text}</text>
      ))}
      <path className="dial__pointer" d="M0 -57 L6 -44 L0 -47.5 L-6 -44 Z" transform={`rotate(${heading})`} />
      <text className="dial__speed" y="6">{Math.round(speed)}</text>
      <text className="dial__unit" y="21">km/h</text>
    </svg>
  );
}
