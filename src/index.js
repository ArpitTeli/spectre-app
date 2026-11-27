import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import pkg from '../package.json';

window.__APP_VERSION = pkg.version;

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
