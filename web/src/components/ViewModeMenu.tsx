import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { useStore, type ViewMode } from '../lib/store';
import Icon from './Icon';
import { MenuList } from './ContextMenu';
import { useActivePage } from '../lib/useActivePage';
import { getActiveEditor, setActiveEditorMode } from '../lib/activeEditor';
import { livePreviewState, livePreviewReadonly } from '../lib/renderState';
import { subscribeNavigationViews } from '../lib/fragmentNavigation';
import { useVirtualReading } from '../lib/virtualReading';
const noSubscribe = () => () => {};

const subscribeMode = (listener: () => void) => subscribeNavigationViews(() => listener());
const currentMode = (): ViewMode => {
  const view = getActiveEditor();
  return view ? view.state.field(livePreviewReadonly, false) ? 'reading' : view.state.field(livePreviewState, false) ? 'live' : 'source' : useStore.getState().viewMode;
};

const modes: { mode: ViewMode; label: string; icon: string }[] = [
  { mode: 'reading', label: '阅读视图', icon: 'book-open' },
  { mode: 'source', label: '源码模式', icon: 'code' },
  { mode: 'live', label: '实时预览', icon: 'pencil' },
];

export default function ViewModeMenu() {
  const { path: activePath, viewId } = useActivePage();
  const reader = useVirtualReading(activePath, viewId);
  const reading = useSyncExternalStore(reader?.subscribe ?? noSubscribe, () => reader?.getSnapshot());
  const normalMode = useSyncExternalStore(subscribeMode, currentMode);
  const viewMode = reading?.mode ?? normalMode;
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const isMarkdown = reading ? !reading.configuration && !!reader?.document.streams.find(stream => stream.id === reading.stream)?.files.some(file => file.kind === 'markdown')
    : !!activePath && /\.(md|markdown)$/i.test(activePath);
  const current = modes.find((item) => item.mode === viewMode)!;

  useEffect(() => { setOpen(false); }, [activePath]);
  useEffect(() => {
    if (!open) return;
    host.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
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
          <MenuList items={modes.map(item => ({ label: item.label, icon: item.icon, checked: item.mode === viewMode,
            onClick: () => { if (reader) reader.setMode(item.mode); else setActiveEditorMode(item.mode); } }))} onClose={() => { setOpen(false); trigger.current?.focus(); }} />
        </div>
      )}
    </div>
  );
}
