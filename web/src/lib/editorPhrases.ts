import { EditorState } from '@codemirror/state';

/**
 * Chinese phrases for CodeMirror's own panel/placeholder strings (search panel,
 * fold placeholder, completion status). One facet value shared by every editor
 * instance; no second localization table and no duplicated DOM.
 */
export const editorPhrases = EditorState.phrases.of({
  // Search panel
  Find: '查找',
  Replace: '替换',
  next: '下一个',
  previous: '上一个',
  all: '全部',
  'match case': '区分大小写',
  regexp: '正则表达式',
  'by word': '全词匹配',
  replace: '替换',
  'replace all': '全部替换',
  close: '关闭',
  'Go to line': '跳转到行',
  go: '跳转',
  'replaced match on line $': '已替换第 $ 行的匹配',
  'replaced $ matches': '已替换 $ 处匹配',
  'current match': '当前匹配',
  'on line': '位于第',
  // Fold gutter/placeholder
  'folded code': '已折叠的代码',
  unfold: '展开',
  // Completion status
  Completions: '补全',
  'Control character': '控制字符',
});
