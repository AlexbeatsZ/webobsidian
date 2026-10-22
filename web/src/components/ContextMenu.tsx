import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from '../lib/store';
import { applyConfiguredMenu, getMenuConfigurationController, getMenuConfigurationRevision, subscribeMenuConfiguration } from '../lib/configuredMenus/controller';
import type { ConfiguredMenuItem } from '../lib/configuredMenus/types';
import Icon from './Icon';

export function MenuList({ items, onClose }: { items: ConfiguredMenuItem[]; onClose: () => void }) {
  const [openSub, setOpenSub] = useState<number | null>(null);
  useEffect(() => setOpenSub(null), [items]);
  return (
    <>
      {items.map((it, i) =>
        it.separator ? (
          <div key={`${it.id ?? 'separator'}:${i}`} className="context-sep" role="separator" />
        ) : (
          <div
            key={`${it.id ?? 'item'}:${i}`}
            className={`context-item ${it.danger ? 'danger' : ''} ${it.submenu ? 'has-sub' : ''} ${it.disabled ? 'is-disabled' : ''}`}
            role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            tabIndex={it.disabled ? undefined : -1}
            aria-disabled={it.disabled || undefined}
            aria-checked={it.checked}
            aria-haspopup={it.submenu ? 'menu' : undefined}
            style={it.disabled ? { opacity: 0.45, cursor: 'default' } : undefined}
            onMouseEnter={() => setOpenSub(!it.disabled && it.submenu ? i : null)}
            onKeyDown={event => {
              const row = event.currentTarget;
              const rows = [...row.parentElement!.children].filter(el => el.getAttribute('role')?.startsWith('menuitem') && el.getAttribute('aria-disabled') !== 'true') as HTMLElement[];
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault(); event.stopPropagation();
                const index = rows.indexOf(row);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length;
                rows[next]?.focus();
              } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault(); event.stopPropagation();
                if (it.submenu) setOpenSub(i); else row.click();
              } else if (event.key === 'ArrowRight' && it.submenu) {
                event.preventDefault(); event.stopPropagation(); setOpenSub(i);
                requestAnimationFrame(() => row.querySelector<HTMLElement>('[role^="menuitem"]')?.focus());
              } else if (event.key === 'ArrowLeft' && row.parentElement?.classList.contains('submenu')) {
                event.preventDefault(); event.stopPropagation(); (row.parentElement.parentElement as HTMLElement)?.focus();
              }
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (it.disabled) return;
              if (it.submenu) {
                e.stopPropagation();
                return;
              }
              try { it.onClick?.(e.nativeEvent); }
              finally { onClose(); }
            }}
          >
            <span className="ctx-icon">{it.icon && <Icon name={it.icon} size={15} />}</span>
            <span className="ctx-label">{it.label}</span>
            {it.checked && <Icon name="check" size={14} />}
            {it.submenu && <Icon name="chevron-right" size={14} className="ctx-arrow" />}
            {it.submenu && !it.disabled && openSub === i && (
              <div className="context-menu submenu" role="menu">
                <MenuList items={it.submenu} onClose={onClose} />
              </div>
            )}
          </div>
        ),
      )}
    </>
  );
}

export default function ContextMenu() {
  const menu = useStore((s) => s.contextMenu);
  const close = useStore((s) => s.closeContextMenu);
  const revision = useSyncExternalStore(subscribeMenuConfiguration, getMenuConfigurationRevision);
  const sessionId = getMenuConfigurationController()?.sessionId;
  const previousSession = useRef(sessionId);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const previous = document.activeElement as HTMLElement | null;
    host.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')?.focus();
    return () => { if (host.current?.contains(document.activeElement) || document.activeElement === document.body) previous?.isConnected && previous.focus(); };
  }, [menu]);
  useEffect(() => {
    if (previousSession.current === sessionId) return;
    previousSession.current = sessionId;
    close();
  }, [sessionId, close]);
  const items = useMemo(() => menu
    ? applyConfiguredMenu(menu.items, menu.context)
    : [], [menu, revision]);

  useEffect(() => {
    if (!menu) return;
    const onClick = () => close();
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    // Attach the outside-click listener on the NEXT tick. A menu opened by a
    // left-click (e.g. the Files header sort button) is otherwise closed instantly
    // by the very click that opened it — that click keeps bubbling to window after
    // React commits this effect, so the listener would fire on it. (Right-click
    // menus were unaffected: a `contextmenu` event never fires a `click`.)
    const t = window.setTimeout(() => window.addEventListener('click', onClick), 0);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onEsc);
    };
  }, [menu, close]);

  if (!menu || !items.length || previousSession.current !== sessionId) return null;
  const margin = 8;
  // Rough height estimate, but capped to the viewport so the menu can never be
  // pushed off-screen; a too-tall menu is then made scrollable via CSS max-height.
  const estHeight = Math.min(items.length * 30 + 12, window.innerHeight - margin * 2);
  const x = Math.max(margin, Math.min(menu.x, window.innerWidth - 240));
  const y = Math.max(margin, Math.min(menu.y, window.innerHeight - estHeight - margin));

  return (
    <div ref={host} className="context-menu" role="menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      <MenuList key={revision} items={items} onClose={close} />
    </div>
  );
}
