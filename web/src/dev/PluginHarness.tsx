import {ensureWriting} from '../lib/writing/config';
import { useEffect, useState } from 'react';
import Editor from '../components/Editor';
import Settings from '../components/Settings';
import CommandPalette from '../components/CommandPalette';
import { useStore } from '../lib/store';
import * as host from '../lib/plugins';
import { documents } from '../lib/documents';

export default function PluginHarness() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    Object.assign(window, {
      pluginHarness: { ...host, store: useStore, documents },
    });
    void host.loadPlugins().then(async () => {
      await ensureWriting();
      await useStore.getState().openFile('fixture.md');
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="app theme-light">
      <div className="workspace" data-plugin-ready={ready}>
        <Editor path="fixture.md" />
      </div>
      <Settings />
      <CommandPalette />
    </div>
  );
}
