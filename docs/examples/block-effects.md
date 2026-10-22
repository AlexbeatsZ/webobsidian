# 自定义块效果

效果定义和 CSS/JavaScript 都放在笔记 Vault 的
`.obsidian/webobsidian/blocks/`，随 Vault 一起保存。应用不自带效果集合，
没有配置文件时不创建文件，也不自动导入 AnyBlock 默认设置。

编辑配置、CSS 或 JS 后会自动重新加载，多次文件保存事件会合并处理。也可以在
命令面板执行 **重新加载块效果配置**（`blocks:reload`）。
配置或脚本有语法错误时会显示错误，并停用上一次定义；修改后重新加载即可。

## 纯 CSS

创建 `blocks.jsonc`：

```jsonc
{
  "version": 1,
  "definitions": [
    {
      "names": ["card", "卡片"],
      "classes": ["my-card"],
      "stylesheet": "cards.css"
    }
  ]
}
```

创建同目录下的 `cards.css`：

```css
.my-card {
  padding: 16px;
  border: 1px solid var(--bg-modifier-border);
  border-radius: 12px;
  background: var(--bg-secondary);
}
```

笔记中使用：

```markdown
[card]
> 这段引用使用卡片样式，里面仍然是原生可编辑的 Markdown。
```

标记作用于后面的**一个完整 Markdown 块**：一个段落、表格、列表、引用或
代码块。标记和目标必须在同一引用/列表层次，可以隔空行。未知名字继续显示
原文；代码、YAML、公式和注释中的标记不激活。

多个效果写作 `[card|other]`。当前支持多个 CSS 定义与最多一个 JS 定义组合；
重复别名不重复执行同一个定义。多段正文的任意区域/标题节范围尚未提供。

## JavaScript

配置中增加一个条目：

```jsonc
{ "names": ["fold"], "classes": ["my-fold"], "script": "fold.js" }
```

`fold.js` 中写函数体，应用传入 `block`：

```js
const doc = block.container.ownerDocument;
const button = doc.createElement("button");
button.textContent = "展开/收起";
const body = doc.createElement("div");
block.container.append(button, body);
block.component.registerDomEvent(button, "click", () => {
  body.hidden = !body.hidden;
});
await block.renderSource(body);
```

笔记中使用 `[fold]` 即可。JavaScript 只能操作自己的展示容器；原文通过源码
按钮编辑。不要查询和重写 CodeMirror 的正文 DOM。脚本可以返回 Markdown
字符串交给共享渲染器，也可以返回清理函数。监听器、定时器和自建资源应通过
`component` 或 `onCleanup` 注册清理。

`block` 提供：

| 成员 | 用途 |
| --- | --- |
| `source`、`sourcePath` | 目标原文及所属笔记路径 |
| `model`、`range`、`node` | 当前共享语法模型、目标范围及语法节点 |
| `table()` | 原生表格模型，包括单元格内容与源码范围 |
| `list()` | 原生语法提取的列表条目，含文本、父条目和深度 |
| `container`、`renderMarkdown(text, target?)`、`renderSource(target?)` | 独立输出容器和共享 Markdown 渲染 |
| `app` | 现有应用对象及 Vault/命令等能力 |
| `signal`、`component`、`onCleanup(fn)` | 取消及资源生命周期 |
| `watch(path)` | 声明依赖；复用现有文档会话与文件事件刷新 |

私有阅读视图允许可信 JS。公开分享不加载 Vault 定义；打印和生成内容不执行
用户 JS。纯 CSS 效果可继续使用。脚本是用户信任的代码，清理和取消不能抢占
同步死循环，也不能自动撤销任意全局副作用。

自定义指令/模板定义则保存在同一 Vault 的
`.obsidian/webobsidian/automation.jsonc`，见 [指令与模板](commands-and-templates.md)。

## 本次现用内容的注册

当前开发用测试 Vault 中仅注册：

- `addClass(ab-custom-td-nowrap)`：个人 `tables.css`，保留单元格不换行。
- `exTable`：个人 `merged-table.js`，读取原生表格模型处理矩形合并。
- `list2table` / `table`：同一份个人 `list-table.js`，读取共享列表层次生成表格。

这些个人文件不打包进应用，也不成为新 Vault 的默认内容。原始笔记与原始
Vault 未改写。用户需要接管其他 Vault 时，将自己选定的定义文件复制到该
Vault；不要把测试 Vault 的其他配置、会话或插件状态同步回去。
