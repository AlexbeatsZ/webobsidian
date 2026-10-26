import { expect, it } from 'vitest';
import { activatePdfSession, getActivePdfSession, getMainPdfSession, registerPdfSession, subscribeActivePdfSession } from './react';
import type { PdfSession } from './session';

function session(path: string, viewId: string) {
  let destroyed = false;
  return { path, viewId, getSnapshot: () => ({ status: destroyed ? 'destroyed' : 'ready' }),
    destroy: () => { destroyed = true; } } as unknown as PdfSession;
}

it('binds fixed panels to main even when a same-path sidebar has focus', () => {
  const main = session('same.pdf', 'main');
  const sidebar = session('same.pdf', 'sidebar');
  const closeMain = registerPdfSession(main);
  const closeSidebar = registerPdfSession(sidebar);
  try {
    activatePdfSession(sidebar);
    expect(getActivePdfSession()).toBe(sidebar);
    expect(getMainPdfSession('same.pdf')).toBe(main);
    expect(getMainPdfSession('other.pdf')).toBeNull();
    closeSidebar(); sidebar.destroy(); activatePdfSession(sidebar);
    expect(getActivePdfSession()).toBe(main);
    expect(getMainPdfSession('same.pdf')).toBe(main);
    closeMain(); main.destroy();
    expect(getMainPdfSession('same.pdf')).toBeNull();
    expect(getActivePdfSession()).toBeNull();
  } finally { closeSidebar(); closeMain(); }
});

it('notifies hidden main removal, ignores late focus, and unregisters idempotently', () => {
  const main = session('same.pdf', 'main');
  const sidebar = session('same.pdf', 'sidebar');
  const closeMain = registerPdfSession(main);
  const closeSidebar = registerPdfSession(sidebar);
  let notifications = 0;
  const unsubscribe = subscribeActivePdfSession(() => { notifications++; });
  try {
    closeMain(); main.destroy();
    expect(notifications).toBe(1);
    expect(getMainPdfSession('same.pdf')).toBeNull();
    activatePdfSession(main);
    expect(getActivePdfSession()).toBe(sidebar);
    closeSidebar(); sidebar.destroy(); closeMain(); closeSidebar();
    expect(notifications).toBe(2);
    expect(getActivePdfSession()).toBeNull();
  } finally { unsubscribe(); closeSidebar(); closeMain(); }
});

it('never falls back to an already destroyed registration', () => {
  const main = session('same.pdf', 'main');
  const sidebar = session('same.pdf', 'sidebar');
  const closeMain = registerPdfSession(main);
  const closeSidebar = registerPdfSession(sidebar);
  try {
    main.destroy(); closeSidebar();
    expect(getActivePdfSession()).toBeNull();
    expect(getMainPdfSession('same.pdf')).toBeNull();
  } finally { closeSidebar(); closeMain(); }
});
