import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { pluginRevision, subscribePlugins } from '../lib/plugins';

export default function PluginElements({
  items,
}: {
  items: Map<string, HTMLElement[]>;
}) {
  const version = useSyncExternalStore(subscribePlugins, pluginRevision);
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = host.current!;
    el.replaceChildren(...[...items.values()].flat());
    return () => el.replaceChildren();
  }, [items, version]);
  return <div ref={host} className="plugin-elements" />;
}
