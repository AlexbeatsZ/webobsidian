import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Do not keep a CodeMirror instance alive for every offscreen Canvas card. */
export default function CanvasVisible({ active = false, children }: { active?: boolean; children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const observer = new IntersectionObserver(entries => setVisible(entries[0]?.isIntersecting ?? false), { rootMargin: '250px' });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={host} className="canvas-visible">{(active || visible) && children}</div>;
}
