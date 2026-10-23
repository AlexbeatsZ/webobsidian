import { useStore } from '../lib/store';
import Icon from './Icon';

export default function SidebarTabRail({ side }: { side: 'left' | 'right' }) {
  const allTabs = useStore(s => s.rightTabs);
  const activeId = useStore(s => side === 'left' ? s.leftActiveId : s.rightActiveId);
  const tabs = allTabs.filter(tab => (tab.side ?? 'right') === side);
  const label = side === 'left' ? '左侧' : '右侧';
  const select = useStore(s => s.selectRightTab);
  const close = useStore(s => s.closeRightTab);
  return <>
    <div className="ribbon-divider" />
    <button title="Homepage" aria-label={`新建${label}标签页`} onClick={() => void useStore.getState().openSidebarTab(side, 'empty')}><Icon name="plus" size={18} /></button>
    <div className="ribbon-tabs" role="tablist" aria-label={`${label}标签页`} aria-orientation="vertical">
      {tabs.map((tab, index) => <button key={tab.id} role="tab" aria-selected={activeId === tab.id} title={tab.title}
        aria-label={tab.title} className={activeId === tab.id ? 'active' : ''} onClick={() => select(tab.id)}
        onAuxClick={event => { if (event.button === 1) { event.preventDefault(); void close(tab.id); } }}
        onKeyDown={event => {
          if (event.key === 'Delete') { event.preventDefault(); void close(tab.id); }
          if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length;
            select(tabs[next].id); (event.currentTarget.parentElement!.children[next] as HTMLElement).focus();
          }
        }}
        onContextMenu={event => { event.preventDefault(); useStore.getState().openContextMenu({ x: event.clientX, y: event.clientY, items: [
          { label: '关闭标签页', icon: 'x', onClick: () => void close(tab.id) },
          { label: '关闭其他标签页', onClick: () => tabs.filter(other => other.id !== tab.id).forEach(other => void close(other.id)) },
        ] }); }}><Icon name={tab.icon} size={18} /><span className="ribbon-tab-number">{index + 1}</span></button>)}
    </div>
  </>;
}
