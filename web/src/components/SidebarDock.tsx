import { useEffect, useRef, type ReactNode } from 'react';

/** One floating shell and resize lifecycle for both sides. Width stays device-local. */
export default function SidebarDock({ side, open, rail, children }: {
  side: 'left' | 'right'; open: boolean; rail: ReactNode; children: ReactNode;
}) {
  const stopDrag = useRef<(() => void) | undefined>();
  const property = side === 'left' ? '--sidebar-width' : '--right-width';
  const storage = side === 'left' ? 'wo-sidebar-width' : 'wo-right-sidebar-width';
  useEffect(() => {
    try {
      const width = Number(localStorage.getItem(storage));
      if (Number.isFinite(width) && width >= 180 && width <= 900) document.documentElement.style.setProperty(property, `${width}px`);
    } catch { /* Device storage can be unavailable. */ }
    return () => stopDrag.current?.();
  }, [property, storage]);
  useEffect(() => { if (!open) stopDrag.current?.(); }, [open]);
  return <aside className={`sidebar-dock dock-${side}${open ? ' is-open' : ''}`} aria-label={side === 'left' ? '左侧栏' : '右侧栏'} aria-hidden={!open}>
    {rail}
    <div className="dock-panel">{children}</div>
    <div className="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="调整侧栏宽度" tabIndex={open ? 0 : -1}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const current = Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue(property), 10);
        const width = Math.max(180, Math.min(window.innerWidth - 60, 900, current + (event.key === 'ArrowRight' ? 20 : -20) * (side === 'left' ? 1 : -1)));
        document.documentElement.style.setProperty(property, `${width}px`);
        try { localStorage.setItem(storage, String(width)); } catch { /* optional */ }
      }}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault(); stopDrag.current?.();
        const start = event.clientX;
        const panel = event.currentTarget.parentElement!.querySelector('.dock-panel')!;
        const initial = panel.getBoundingClientRect().width;
        document.body.classList.add('wo-col-resizing');
        const move = (next: PointerEvent) => {
          const width = Math.max(180, Math.min(900, window.innerWidth - 60, Math.round(initial + (next.clientX - start) * (side === 'left' ? 1 : -1))));
          document.documentElement.style.setProperty(property, `${width}px`);
        };
        const stop = () => {
          document.body.classList.remove('wo-col-resizing');
          window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop);
          try { localStorage.setItem(storage, document.documentElement.style.getPropertyValue(property).replace('px', '')); } catch { /* optional */ }
          stopDrag.current = undefined;
        };
        stopDrag.current = stop;
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
      }} />
  </aside>;
}
