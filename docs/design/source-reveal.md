# 源码展开时的语法颜色

## 规则(2026-11-05 用户要求)

学 Obsidian:实时预览里能被渲染、但因为光标在上面而显示为源码的语法字符，统一用
`^id`(`.cm-blockid`)同款的 `var(--text-faint)` 灰色;语法所包裹的、渲染后仍会显示的
内容保持正文颜色。光标离开后重新渲染，灰色标记随之消失。

统一的类名是 `cm-formatting cm-formatting-<kind>`,CSS 只有一处:
`.cm-s-obsidian .cm-formatting { color: var(--text-faint) }`,并让其中嵌套的语法高亮
(HTML 标签、任务框的 ͼ 类)继承这个颜色。各处只在“光标展开”时加标记，显式打开的
源码区域(`</>`)和源码模式不加。

| 语法 | 灰色部分 | 正文色 | 位置 |
|---|---|---|---|
| `**` `*` `~~` `` ` `` | 定界符 | 包裹的文字 | livePreview 强调分支 |
| `==` `## ` `%%` `^id` `> ` `1.` | 原本就是灰色 | — | 既有 |
| `[[x]]` `![[x]]` | `[[`/`![[`、`]]`;有别名时连同 `目标|` | 显示文字/别名 | livePreview wikilink |
| `![alt](url)` | `![`、`](url)` | alt | livePreview 图片 |
| `[text](url)` `<url>` `[a][r]` | 括号与目标 | 链接文字 | semanticDecorations |
| `[r]: url` 链接定义 | 整段 | — | semanticDecorations |
| `[^1]` / 脚注定义 `[^1]:` | `[^`、`]` / 整个标记 | 编号 | semanticDecorations |
| `<u>` `<br>` `&amp;` | 标签与实体 | 标签内文字 | inlineHtml |
| `- ` `- [ ] ` | 列表/任务标记 | 条目文字 | livePreview 列表 |
| `\*` 转义 | 反斜杠 | 被转义字符 | livePreview 转义 |
| `> [!tip]` | `>`、`[!tip]`(含折叠号与分隔空格) | 自定义标题 | livePreview callout |
| `$` `$$` `\(` `\[` | 定界符(`.cm-tex-delimiter`) | 公式内部保留 LaTeX 高亮 | math_highlight + CSS |

`#tag` 在 Obsidian 实时预览里展开时仍是标签样式，这里也保持紫色标签，不算“可渲染的源码”。

## Callout 标题源码态

光标落在 `[!type]` 标记上时(与图标 widget 换回源码同一个判定),标题行加
`cm-callout-source`:去掉类型色、粗体、标题竖线(只把边框设为透明，宽度不变)和折叠
箭头;本行的 `>` 同时显示为灰色。仅光标碰到 `>` 不展开类型标记，这一既有独立性不变。

## 验证

`tests/browser/source-syntax.spec.ts` 按表逐项把光标放进语法，比较灰色与 `.cm-blockid`
颜色;`callout-styles.spec.ts` 覆盖 callout 标题源码态。
