# Callout 颜色与图标

## 目标

新增 callout 类型只需要名称、颜色、图标三项，写一条 CSS 即可，不改源码、不重新构建。
内置类型（Obsidian 标准类型与 proof/think/tactic/attention）保留。

## 约定（与 Obsidian 相同）

```css
.callout[data-callout="definition"] {
  --callout-color: 99, 102, 241;      /* RGB 三元组，或任意 CSS 颜色：rgb(...)、#hex、颜色名 */
  --callout-icon: lucide-book-open;   /* Lucide 名称（可省略 lucide- 前缀，旧名别名可用），或 '<svg …>…</svg>' */
}
```

名称就是 `[!definition]` 的类型；未写标题时显示 `Definition`。规则可写在应用 CSS、Vault 主题或
`.obsidian/snippets/*.css`，按正常层叠顺序生效（片段最后加载，可覆盖内置）。

## 实现（web/src/lib/calloutStyles.ts）

- 原生 Callout 容器只用 `md-callout`，**不能**加 `.callout` class：Vault 的 Theme.css 会给 `.callout`、
  `.callout-title` 加 padding/flex/::before，破坏原生文本坐标（见 callout-lists.md）。所以用 body 下的
  隐藏探针 `div.callout[data-callout=type]` 读计算样式，再把结果写到原生标题包装层的行内
  `--callout-color` 和图标 widget 里。
- 探针容器带当前主题 class（取第一个 `.theme-light/.theme-dark` 元素），`var()` 在探针处求值，
  因此颜色是当前主题下的值；主题切换时需要重算。
- 颜色统一转成 `r, g, b` 三元组（Vault Theme.css 写的是 `rgb(...)` 全色值，两种都要支持）；
  无效值回落到内置 slot 颜色变量。
- 图标解析顺序：固定版本资产（check-circle/lightbulb/file-signature，保持 proof/think/tactic 原形状）
  → icons.ts 已有路径 → 完整 Lucide（`import('lucide')` 懒加载，约 830 KB/gzip 121 KB 独立 chunk）。
  未解析时回落到内置 slot 图标。内联 SVG 经 DOMParser 解析并去掉 script/foreignObject/on* 属性。
- 缓存按类型保存；以下情况重算全部已见类型，有变化才调用 `refreshBlockViews()` 重建装饰：
  body/主题宿主的 class 变化、head 中样式表增删改、link/style 的 load 事件、Lucide 加载完成。
  不观察编辑器子树。
- 没有 DOM（单元测试）时直接用内置表。

## 失败与限制

- 探针挂在 body 下，带祖先限定的选择器（如 `.markdown-source-view .callout[...]`）不会命中；
  Obsidian 片段通常写裸 `.callout[data-callout]`，可用。
- `--callout-icon` 只影响原生 Callout；插件生成的 `.callout` HTML 仍由插件自己放图标。
