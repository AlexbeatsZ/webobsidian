import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/obsidian.css';
import './styles/plugins.css';

// /share/<id> keeps SSR for crawlers and loads the separate scoped share entry.

const root = createRoot(document.getElementById('root')!);
if (import.meta.env.DEV && location.pathname === '/__plugin-test') {
  void import('./dev/PluginHarness').then(({ default: Harness }) => root.render(<Harness />));
} else if (import.meta.env.DEV && location.pathname === '/__render-test') {
  void import('./dev/RenderHarness').then(({ default: Harness }) => root.render(<React.StrictMode><Harness /></React.StrictMode>));
} else root.render(<React.StrictMode><App /></React.StrictMode>);
