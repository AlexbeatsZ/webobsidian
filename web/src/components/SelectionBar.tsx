import type { ReactNode } from 'react';
import Icon from './Icon';

/** Batch actions for a list's current multi-selection, shown above that list only while it exists. */
export default function SelectionBar({ label, count, closeLabel = '取消选择', onClose, children }: {
  label: string; count: number; closeLabel?: string; onClose: () => void; children: ReactNode;
}) {
  return <div className="selection-bar" role="toolbar" aria-label={label}>
    <span role="status">已选 {count}</span>
    {children}
    <button type="button" className="selection-bar-close" title={closeLabel} aria-label={closeLabel} onClick={onClose}><Icon name="x" size={13} /></button>
  </div>;
}
