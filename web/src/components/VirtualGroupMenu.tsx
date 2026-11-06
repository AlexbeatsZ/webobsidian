import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useActivePage } from '../lib/useActivePage';
import { useVirtualReading } from '../lib/virtualReading';
import { MenuList } from './ContextMenu';
import Icon from './Icon';

const noSubscribe = () => () => {};
export default function VirtualGroupMenu() {
  const { path, viewId } = useActivePage(), reader = useVirtualReading(path, viewId);
  const state = useSyncExternalStore(reader?.subscribe ?? noSubscribe, () => reader?.getSnapshot());
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), id = useId();
  useEffect(() => setOpen(false), [reader]);
  useEffect(() => {
    if (!open) return;
    host.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const dismiss = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [open]);
  if (!reader || !state) return null;
  const title = state.configuration ? '配置' : reader.document.streams.find(stream => stream.id === state.stream)!.title;
  return <div className="view-mode-control virtual-group-control" ref={host} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button type="button" className="view-mode-trigger virtual-group-trigger" ref={trigger} title="切换分组" aria-label={'切换分组：' + title}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>
      <Icon name={state.configuration ? 'code' : 'book-open'} size={14} /><span>{title}</span><Icon name="chevron-up" size={12} />
    </button>
    {open && <div id={id} className="view-mode-menu virtual-group-menu" role="menu" aria-label="文档分组" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      else if (event.key === 'Tab') setOpen(false);
    }}>
      <MenuList items={[
        ...reader.document.streams.map(stream => ({ label: stream.title, checked: !state.configuration && stream.id === state.stream,
          icon: stream.files.every(file => file.kind === 'pdf') ? 'file-text' : 'book-open', onClick: () => reader.selectStream(stream.id) })),
        { label: '', separator: true },
        { label: '配置', icon: 'code', checked: state.configuration, onClick: () => reader.selectConfiguration() },
      ]} onClose={() => { setOpen(false); trigger.current?.focus(); }} />
    </div>}
  </div>;
}
