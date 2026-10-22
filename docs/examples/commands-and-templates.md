# User commands and templates

Settings → 用户指令与模板 saves definitions in the current Vault's
`.obsidian/webobsidian/automation.jsonc`. No user command runs when merely loading
the file. Use trusted code, with the same app access as native JS blocks.

```jsonc
{
  "version": 1,
  "commands": [
    {
      "id": "user:experiment-name",
      "name": "选择实验名称",
      "enabled": true,
      "code": "return await prompt(\"实验名称\");"
    }
  ],
  "templates": {
    "folder": "Templates",
    "bindings": [
      { "id": "template:experiment", "name": "插入实验记录", "path": "Templates/Experiment.md" }
    ],
    "folderRules": []
  }
}
```

`Templates/Experiment.md`:

```markdown
<% let experiment = command "user:experiment-name" {} %>
# <% experiment %>

日期：<% date "YYYY-MM-DD" %>
笔记：<% title %>

## 实验目的
<% cursor 1 %>

## 实验数据
<% cursor 2 %>
```

The prompt executes once; `experiment` can be reused anywhere. Run the template
from 插入模板, its registered command, a shortcut, or a configured menu. Use
从模板新建笔记 to generate a new document before creating it.

Command code receives `app`, `args`, `context`, `signal`, `onCleanup`, `prompt`,
`choose`, `execute`. For composition: `return await execute('user:other', args)`.
For asynchronous reads, check `context.assertCurrent()` before later edits. Own
resources via `onCleanup(() => ...)`; command resources end when the invocation
finishes, is replaced/disabled, or the Vault closes. Persistent displays belong in
the existing JS blocks.

`<% command "id" {} %>` inserts text/number; `<% do "id" {} %>` only runs the action.
Store structured results with `let`, then access a field, e.g. `<% item.title %>`.
Pass variables in JSON arguments as `{"$var":"item.title"}`. Results are literal:
returned dollar signs, Markdown and `<%` are never interpreted a second time.

Includes use complete Vault paths, e.g. `<% include "Templates/Methods.md" %>`.
Use `<%%` to insert literal `<%`. General Templater JavaScript and tp.user are not
evaluated by this language; move those workflows to registered commands explicitly.

Optional `folderRules` example:
`[{"folder":"Experiments","template":"Templates/Experiment.md"}]`.
This generates only blank notes created by this client. The longest folder path
wins. Existing text and externally created files remain untouched; turn off the
original Templater before enabling native automatic rules. Folder tag rules then
run in the existing initial write path, so generated content and automatic tags
are persisted together.
