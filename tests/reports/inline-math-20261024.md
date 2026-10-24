# 行内公式源码显隐的字体度量修正

2026-10-24，America/New_York。用户在上一轮CSS修正后仍报告轻微位移，
明确允许用渲染器复现、测试和修复；继续禁止临时间距／高度补偿，跨行公式不改。

## 已确认的原因

在现有RenderHarness内，用相同视口与原生MarkdownView复现截图中的
`f_i`、`\ce{M_{\mathit{i}}}`和后续分式。默认18px、1.5行距下：

| 测量 | 修复前渲染 | 修复前源码 | 删除强制斜体后源码 |
| --- | --- | --- | --- |
| 当前行高度 | 27px | 28px | 27px |
| 后文所在行top | 343.328125px | 344.328125px | 343.328125px |
| scrollTop | 0 | 0 | 0 |
| 内容区宽度 | 700px | 700px | 700px |

源码原先由`.cm-s-obsidian .cm-math { font-style: italic }`强制整段斜体，
切换到捆绑MathJax_Main字体的italic字面。它与正文normal字面的基线／上下度量
不同；虽然两者computed line-height同为27px，浏览器取各个inline box基线以上、
以下的最大值时，混排总高度仍可变成28px。这与MathJax公式SVG自身大小无关。

单变量探针对照：只取消源码font-style即可恢复27px及后文位置，scroll与列宽不变。
给渲染宿主设line-height:0没有消除源码态的28px；给源码设line-height:0虽可压低
行盒，但未采用。上一轮仅处理MathJax输出层的继承行距，不能解决这个源码字体问题。
这次两张用户截图裁剪尺寸不同，不把截图中的全局水平差异当作已经量化的同一问题。

## 改动归属

产品代码只删除现有cm-math规则中的强制italic，继续继承上下文正常字体样式，
保留颜色与原生公式语法着色。MathWidget、MathJax转换队列／缓存、source visibility、
DocumentSession与CodeMirror测量／选择路径均复用原有实现。
无新JS、状态、测量、observer、行高缓存、scroll修正、padding/min-height占位或裁切。
显式数学命令／concealment的字体规则不变；高分式与长源码仍自然撑高／换行。

新增math-inline.spec.ts接入既有render项目，测量存在实际用户意义的前文／所在行／
后文／块公式／内容区和scroll几何；原文保持及Undo也有断言。未修改并行Callout标题
任务的CSS649+、livePreview、elements/render/quote测试或其设计文档。

## 验证结果

- 基线回归先红：同一行27px变28px，首轮编辑即失败；原始trace与JSON保留。
- 最终10/10通过，16.3秒，0跳过／重试，既有test fixture未发现pageerror／console error。
- 7种环境各8轮源码显隐：body、dark、16px、24px、普通引用、嵌套引用、列表。
  共112次进入／恢复状态，所有比较锚点的几何差为0 CSSpx，无累积漂移。
- 真实鼠标点击进入化学式，再点所在行前部退出；scrollTop=30的视口和所有锚点不变。
- 简单`f_i`／`t_0`在Live／Source／Reading之间多次切换，各行top／height完全一致。
- 高嵌套分式仍高于正文行高且被行盒包含；长TeX实际换行，source完整，Undo恢复原文。
- 既有7项相关回归7/7通过，9.9秒：表格宏刷新、嵌套Callout公式归属、块公式源码入口、
  MathJax版本／inline-display／化学式／动态字体本地资源、错误／安全链接、列表异步
  公式布局、卸载后迟到渲染取消。
- 实际查看最终rendered.png与source.png；源码着色保留，前后文和分式未出现纵向位移。

## 隔离与运行记录

基线为46a69a2的git archive，独立目录：
`C:/Users/Meta/AppData/Local/Temp/.agents/meta-obsidian-inline-math-20261024/source`。
Vite端口5199、独立cache、Edge临时浏览器上下文；RenderHarness使用内存DocumentSession，
writing接口由测试固定响应，没有连接实际Vault服务。node_modules仅复用依赖，不链接用户数据。

准备期发现根目录已有core dist落后于源码，最初dependency scan缺少导出；临时快照
必要core/search编译通过，随后按现有隔离配置直接alias到快照core/search源码。
当前picomatch依赖在dev预打包中读取Node process.platform/version，临时Vite配置为它
提供常量，未修改产品全局环境或混入本次产品修复。一个CLI调用因误用根cwd而未找到
临时config，立即失败，无构建／资源写入。诊断脚本一次括号拼写错误已改正。
补充测试最初假设一次Escape可恢复行内公式，8/9通过且该假设失败；最终按用户真实
点击进入／点击外部路径测试，没有借本任务修改键盘行为或声称Escape已验收。

证据在`.local/inline-math-20261024/`：baseline.json、strut.json、red.json、green.json、
regression.json、geometry.json、rendered.png与source.png。临时目录保留原始trace和探针。
原生EXE、物理IME、多设备和长时间使用未验证；未生成或发布新包。
原始Vault／profile／运行应用／server/public未改动。测试结束只停止本任务Vite及测试浏览器。
