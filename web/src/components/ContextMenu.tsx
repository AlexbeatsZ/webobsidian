import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from '../lib/store';
import { applyConfiguredMenu, getMenuConfigurationController, getMenuConfigurationRevision, subscribeMenuConfiguration } from '../lib/configuredMenus/controller';
import type { ConfiguredMenuItem } from '../lib/configuredMenus/types';
import Icon from './Icon';

function MenuList({ items, onClose }: { items: ConfiguredMenuItem[]; onClose: () => void }) {
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
            aria-disabled={it.disabled || undefined}
            aria-checked={it.checked}
            aria-haspopup={it.submenu ? 'menu' : undefined}
            style={it.disabled ? { opacity: 0.45, cursor: 'default' } : undefined}
            onMouseEnter={() => setOpenSub(!it.disabled && it.submenu ? i : null)}
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
            {it.checked ? <Icon name="check" size={15} /> : it.icon && <Icon name={it.icon} size={15} />}
            <span className="ctx-label">{it.label}</span>
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
    <div className="context-menu" role="menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      <MenuList key={revision} items={items} onClose={close} />
    </div>
  );
}
