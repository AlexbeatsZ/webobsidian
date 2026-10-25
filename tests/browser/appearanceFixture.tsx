import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../web/src/App';
import '../../web/src/styles/obsidian.css';
import '../../web/src/styles/plugins.css';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);

export function dispose() { root.unmount(); }
