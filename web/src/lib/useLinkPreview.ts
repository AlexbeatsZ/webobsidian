import { useEffect, useMemo } from 'react';
import { LinkPreviewPopover } from './linkPreview';
import { createVaultRenderContext } from './vaultRenderContext';
import { mountMarkdownFragment } from '../components/MarkdownFragment';
import { useStore } from './store';
import { documents } from './documents';

export function useLinkPreview(sourcePath?: string | null) {
  const popover = useMemo(() => new LinkPreviewPopover(), []);
  useEffect(() => () => popover.close(), [popover, sourcePath]);
  return (target: string) => ({
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
      const state = useStore.getState(), path = sourcePath ?? state.activePath ?? '';
      const context = createVaultRenderContext(path, { openLink: (target, source, intent) => { void state.openWikilink(target, source, intent); },
        openMenu: state.openContextMenu, files: () => state.filePaths, reportError: state.notify });
      const model = documents.get(path)?.analysis;
      popover.schedule(event.currentTarget, target, { ...context, mountFragment: (host, source, options) => mountMarkdownFragment(host, source, { ...options, context: options.context ?? context }),
        ...(model ? { mathSource: { model, from: 0 } } : {}) });
    },
    onMouseLeave: (event: React.MouseEvent<HTMLElement>) => { if (!popover.contains(event.relatedTarget as Node)) popover.leave(); },
  });
}
