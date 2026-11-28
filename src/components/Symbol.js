import React from 'react';
import { listSymbol } from './milSymbols';

// The SVG comes from the milsymbol library, built only from fixed symbol codes.
export default function Symbol({ item, side, size }) {
  return <span className="symbol" aria-hidden="true" dangerouslySetInnerHTML={{ __html: listSymbol(item, side, size).svg }} />;
}
