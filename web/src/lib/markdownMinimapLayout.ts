import type { EditorView } from '@codemirror/view';
import { minimapSourceWidth } from './markdownMinimap';

const OVERFLOW_SELECTOR = 'img, table, pre, mjx-container, .cm-table-wrap, .cm-image-wrap, .cm-math-rendered, .cm-note-embed, .cm-html-block';

export function observeMinimapLayout(view: EditorView, schedule: () => void) {
  const content = view.contentDOM;
  const targets = new Set<Element>();
  let width = minimapSourceWidth(0);
  let disposed = false;
  const changed = () => { if (!disposed) schedule(); };
  const media = new ResizeObserver(changed);
  const observe = (node: Element) => {
    if (!node.matches(OVERFLOW_SELECTOR) || targets.has(node)) return;
    targets.add(node);
    media.observe(node, { box: 'border-box' });
  };
  const observeTree = (node: Node) => {
    if (!(node instanceof Element) || !content.contains(node)) return;
    observe(node);
    node.querySelectorAll(OVERFLOW_SELECTOR).forEach(observe);
  };
  const mounted = new MutationObserver(records => {
    if (disposed) return;
    for (const record of records) record.addedNodes.forEach(observeTree);
    for (const target of targets) {
      if (content.contains(target)) continue;
      media.unobserve(target);
      targets.delete(target);
    }
    changed();
  });
  observeTree(content);
  mounted.observe(content, { childList: true, subtree: true });
  const geometry = new ResizeObserver(changed);
  geometry.observe(content, { box: 'border-box' });
  geometry.observe(view.scrollDOM, { box: 'border-box' });
  view.scrollDOM.addEventListener('scroll', schedule, { passive: true });

  return {
    get width() { return width; },
    measure() {
      const borderWidth = content.offsetWidth - content.clientWidth;
      const next = minimapSourceWidth(content.getBoundingClientRect().width, content.scrollWidth + borderWidth);
      const changed = next.column !== width.column || next.source !== width.source;
      width = next;
      return changed;
    },
    dispose() {
      disposed = true;
      mounted.disconnect();
      media.disconnect();
      geometry.disconnect();
      targets.clear();
      view.scrollDOM.removeEventListener('scroll', schedule);
    },
  };
}
