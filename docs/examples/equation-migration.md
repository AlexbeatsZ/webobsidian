# 旧公式编号与引用迁移

入口是 `scripts/migrate-equations.mts`。在项目根目录运行，需要现有项目依赖中的 `tsx`；不安装全局工具，也不启动 WebObsidian、Obsidian 或服务器。

脚本默认只生成预览。它把历史公式身份从显示编号迁移到普通 Markdown 块 ID：

```markdown
$$E=mc^2 \tag{1-1}$$
由$\text{(1-1)}$与[[#=(1-1)]]可得。
```

转换为：

```markdown
$$E=mc^2 $$ ^eq-migrated1
由[[#^eq-migrated1]]与[[#^eq-migrated1]]可得。
```

自动编号由 WebObsidian 按当前文档结构计算。旧编号与新编号的映射在预览报告中显示，可能发生变化。迁移后的固定 ID 不再随着编号变化而变化。没有手写标签的公式已经使用原生编号，不会被批量添加 ID。

## 生成预览

PowerShell 示例，`--vault` 替换成要处理的 Vault；`--out` 必须是 **Vault 外部的新目录**，已有目录不会被覆盖。

```powershell
node --import tsx scripts/migrate-equations.mts `
  --vault 'C:\path\to\vault' `
  --out '.local/equation-migration/run-01'
```

只选一篇文档时使用相对于 Vault 的完整路径；可以重复 `--file` 选择多篇。脚本同时更新 Vault 中指向这些文档的旧公式链接，所以改动列表可能包含引用它的其他文档。选中文档指向未选中文档的旧引用会列为问题；批量迁移时省略 `--file`。

```powershell
node --import tsx scripts/migrate-equations.mts `
  --vault 'C:\path\to\vault' `
  --file '02笔记/化学/高分子化学/高分子化学 04自由基共聚合.md' `
  --out '.local/equation-migration/run-02'
```

输出包括：

- `preview.html`：无需网络的对照页面，包含引用前后、编号变化和待处理问题。页面展示源代码对照；实际数学排版由应用负责。
- `before/`：所有待修改文件的原始内容，包括 BOM、换行和原始空白。
- `after/`：对应的迁移结果；目录层次与 Vault 相同。
- `changes.diff`：完整差异。
- `report.json`：统计、固定 ID 与编号映射、未解决问题、来源 Vault 以及执行状态。

## 实际执行与恢复

查看预览后，关闭该 Vault 的编辑器和可能写入它的同步任务，使用一个 **新的输出目录**，在同一条命令追加 `--apply`。先检查整份源快照和文件列表没有变化，再逐文件检查、原子替换。所有原件都会在开始替换前存入 `before/`。存在未解决问题时，`--apply` 拒绝修改 Vault，预览仍然保留。

```powershell
node --import tsx scripts/migrate-equations.mts `
  --vault 'C:\path\to\vault' `
  --out '.local/equation-migration/applied-01' `
  --apply
```

撤销这一次执行：

```powershell
node --import tsx scripts/migrate-equations.mts `
  --restore '.local/equation-migration/applied-01'
```

恢复先检查全部文件；只有文件仍等于迁移结果或原件时才继续。迁移之后被用户编辑的文件不会被覆盖。如果进程中途失败，报告会留下 `applying` / `apply-failed` 状态，可以用同一个恢复命令撤销已完成的部分。恢复同样允许重复执行。跨文件替换不是文件系统事务，执行和恢复期间都应停止其他写入。

## 覆盖范围与保留规则

- `\tag{1-1}`、`\tag{1}`、`\tag{2.5}` 及其 `\tag*` 形式：添加固定锚点，去掉手写数字标签，使用原生自动编号。保留原有 `eq-` 块 ID；旧的非规范公式块 ID 改为 `eq-` 名称并更新其入链。新增或重命名 ID 避让所有块名，包括普通正文块。
- 正文中独立的 `$\text{(编号)}$`：仅当同一篇文档中有唯一对应的旧标签时，改成无别名的块链接。Unicode 连字符按原生规则匹配。不会把普通的 `(1-1)` 文本或其他数学表达式猜成引用。
- `[[笔记#=(编号)]]`、`![[笔记#=(编号)]]`、同文档链接，以及 `§2` 等重复编号序号：统一改成固定块链接，保留嵌入标记。
- Markdown 链接、图片及引用式链接定义中的旧公式 URL：复用语法树给出的 URL 范围，仅替换片段，保留标签和标题；手写显示文字不自动变成动态编号。
- 跨文件引用：复用原生 `TargetIndex` 解析相对路径、Vault 路径和短文件名；文件歧义时拒绝猜测。
- 自定义非数字标签、明确 `\notag` / `\nonumber` 或 `{{}}` 豁免下的手写标签保留。`--keep-tags` 可以保留所有手写标签，只迁移引用身份。
- 默认保留全部手写别名。如果希望旧的纯编号别名也随新编号更新，可以显式加 `--drop-number-aliases`；只移除与原标签完全匹配的 `(编号)` 或 `$\text{(编号)}$` 别名。
- 规范引用区分没有 `|` 与空 `|`：`[[#^eq-migrated17]]` 显示当前编号，`[[#^eq-migrated17|]]` 显示 `migrated17`，非空别名显示手写内容。三者悬浮时均预览渲染后的公式。
- 使用现有 Markdown / 数学区间 / 元数据分析和 `SourceDocument` 范围补丁，保留未修改内容的字节，不重新序列化 Markdown。代码、注释、YAML、HTML 以及普通数学公式中的示例引用不被替换。
- 不扫描点号开头的文件/目录及 `node_modules`，不跟随符号链接或 junction，非 UTF-8 内容拒绝处理。不会改插件、模板配置、快捷键或应用设置。

## 不可自动判定的情况

缺失目标、没有指定 occurrence 的重复编号、重复块 ID、表格中的带标签公式，以及结束 `$$` 后同一行还有正文等无法安全加入块 ID 的公式，会保留原状并列入问题。涉及不明确引用的原标签不会被删除。脚本不会改写段落结构、修补破损分隔符，或根据“看起来差不多”推断旧编号指向哪一条公式。

出现这些问题时，可以从报告选取无问题的单篇/一组关联文档迁移，或者先人工纠正原始内容后重新生成全库预览。报告为零问题才允许 `--apply`，因此“预览已生成”不等于“全库可无损自动迁移”。

## 脚本检查

以下只运行迁移器的针对性检查，不启动应用：

```powershell
node --import tsx --test scripts/migrate-equations.test.mts
```

覆盖格式转换、重复目标、跨文件入链、编号变化、代码/注释保护、混合源格式、幂等、原件备份、实际替换与恢复，以及拒绝覆盖迁移后用户修改的数据。测试目录创建在系统 Temp 的 `.agents` 下，结束后删除。2026-10-24 后续规范化修改只做源码检查，新增的非规范 ID 迁移断言尚未执行，前一版的 14 项通过结果不代表后续版本已验证。
