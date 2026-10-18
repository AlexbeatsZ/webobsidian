import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/obsidian.css';

// NOTE: /share/<id> never reaches the SPA — the server renders it (SEO/OG SSR).

const root = createRoot(document.getElementById('root')!);
if (import.meta.env.DEV && location.pathname === '/__render-test') {
  void import('./dev/RenderHarness').then(({ default: Harness }) => root.render(<React.StrictMode><Harness /></React.StrictMode>));
} else root.render(<React.StrictMode><App /></React.StrictMode>);
