import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useStore, type ViewMode } from '../lib/store';
import Icon from './Icon';

const modes: { mode: ViewMode; label: string; icon: string }[] = [
  { mode: 'reading', label: '阅读视图', icon: 'book-open' },
  { mode: 'source', label: '源码模式', icon: 'code' },
  { mode: 'live', label: '实时预览', icon: 'pencil' },
];

export default function ViewModeMenu() {
  const activePath = useStore((s) => s.activePath);
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const isMarkdown = !!activePath && /\.(md|markdown)$/i.test(activePath);
  const current = modes.find((item) => item.mode === viewMode)!;

  useEffect(() => { setOpen(false); }, [activePath]);
  useEffect(() => {
    if (!open) return;
    host.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      setOpen(false); trigger.current?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const buttons = [...host.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
      buttons[next]?.focus();
    }
  };

  if (!isMarkdown) return null;
  return (
    <div className="view-mode-control" ref={host} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <button type="button" className="view-mode-trigger" ref={trigger}
        title={`${current.label} — 切换视图`} aria-label={`${current.label} — 切换视图`}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true);
          }
        }}>
        <Icon name={current.icon} size={15} />
      </button>
      {open && (
        <div id={menuId} className="view-mode-menu" role="menu" aria-label="切换视图" onKeyDown={onKeyDown}>
          {modes.map((item) => (
            <button key={item.mode} type="button" role="menuitemradio" aria-checked={item.mode === viewMode}
              onClick={() => { setViewMode(item.mode); setOpen(false); trigger.current?.focus(); }}>
              <Icon name={item.icon} size={15} />
              <span>{item.label}</span>
              {item.mode === viewMode && <Icon name="check" size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
