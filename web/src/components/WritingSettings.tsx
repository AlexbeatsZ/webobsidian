import { useWriting, updateWriting, refreshWriting, writingCMSettings } from '../lib/writing/config';
import { DEFAULT_SETTINGS } from '../lib/writing/latex/settings/settings';
import { formatRules, formatterSettings } from '../lib/writing/format';
import { DropdownOption, TextAreaOption } from '../lib/writing/linter/option';
import MathSettings from './MathSettings';
import { SettingGroup, SettingRow } from './SettingRow';
import ConfigurationFile from './ConfigurationFile';

export default function WritingSettings({ formatting = false }: { formatting?: boolean }) {
  const { settings, error } = useWriting();
  const attempt = (value: Parameters<typeof updateWriting>[0]) => {
    void updateWriting(value).catch(() => {});
  };
  const raw = { ...DEFAULT_SETTINGS, ...settings.latex };
  const checkbox = (name: string, value: boolean, change: (value: boolean) => void, desc?: string) => (
    <SettingRow name={name} key={name} desc={desc}>
      <input type="checkbox" checked={value} onChange={event => change(event.target.checked)} />
    </SettingRow>
  );
  const fmt = formatterSettings();
  return <div>
    <h2>{formatting ? '文档格式化' : '公式与片段'}</h2>
    {error && <p role="alert">{error}</p>}
    <SettingGroup>
      <ConfigurationFile path=".obsidian/webobsidian/writing.jsonc" desc={formatting
        ? '自定义正则、忽略路径和高级规则在配置文件中编辑。'
        : '高级公式与片段配置在此文件中编辑。'}>
        <button type="button" title="重新加载配置与规则" onClick={() => {
          void refreshWriting(true).catch(() => {});
        }}>重新加载</button>
      </ConfigurationFile>
      {settings.source && !settings.source.exists && <SettingRow name="创建配置文件" desc="将当前写作配置保存到仓库，原应用与插件配置保留。">
        <button type="button" onClick={() => attempt({ latex: {} })}>创建配置文件</button>
      </SettingRow>}
    </SettingGroup>
    {formatting ? <>
      <SettingGroup title="保存与格式化">
        {checkbox('手动保存时格式化', fmt.lintOnSave, value => attempt({ linter: { lintOnSave: value } }))}
        {checkbox('切换或关闭文档时格式化', fmt.lintOnFileChange, value => attempt({ linter: { lintOnFileChange: value } }), '后台自动保存只保存内容。')}
      </SettingGroup>
      {Object.entries({ YAML: '文档属性', Heading: '标题', Footnote: '脚注', Content: '正文', Spacing: '空白与排版', Paste: '粘贴' }).map(([type, title]) => (
        <SettingGroup key={type} title={title}>
          {formatRules.filter(rule => rule.type === type).map(rule => <div className="formatting-rule" key={rule.alias}>
            {checkbox(rule.getName(), Boolean(fmt.ruleConfigs[rule.alias]?.enabled), enabled => attempt({ linter: { ruleConfigs: { [rule.alias]: { enabled } } } }), rule.getDescription())}
            {rule.options.slice(1).filter(option => !option.hidden).map(option => {
              const current = fmt.ruleConfigs[rule.alias]?.[option.configKey] ?? option.defaultValue;
              const set = (value: unknown) => attempt({ linter: { ruleConfigs: { [rule.alias]: { [option.configKey]: value } } } });
              const advanced = typeof current === 'object' || option instanceof TextAreaOption;
              return <SettingRow key={option.configKey} name={option.getName()} desc={advanced
                ? `${option.getDescription()} 在 writing.jsonc 中配置 linter.ruleConfigs.${rule.alias}.${option.configKey}。`
                : option.getDescription()}>
                {advanced ? <span className="setting-config-status">配置文件</span>
                  : typeof current === 'boolean' ? <input type="checkbox" checked={current} onChange={event => set(event.target.checked)} />
                  : option instanceof DropdownOption ? <select value={current} onChange={event => set(event.target.value)}>
                    {option.options.map(item => <option key={item.value} value={item.value.replace('enums.', '')}>{item.getDisplayValue()}</option>)}
                  </select>
                  : <input key={String(current)} type={typeof current === 'number' ? 'number' : 'text'} defaultValue={current}
                    onBlur={event => set(typeof current === 'number' ? Number(event.target.value) : event.target.value)} />}
              </SettingRow>;
            })}
          </div>)}
        </SettingGroup>
      ))}
    </> : <>
      <MathSettings />
      <SettingGroup title="片段">
        {checkbox('启用片段与占位符', raw.snippetsEnabled, value => attempt({ latex: { snippetsEnabled: value } }), `当前载入 ${writingCMSettings().snippets.all.length} 条片段。修改规则文件后自动重载；失败时保留上一次有效规则。`)}
        <SettingRow name="片段文件／文件夹" desc="相对当前仓库的路径，或桌面客户端支持的外部绝对路径">
          <input key={raw.snippetsFileLocation} defaultValue={raw.snippetsFileLocation} onBlur={event => attempt({ latex: {
            snippetsFileLocation: event.target.value, loadSnippetsFromFile: Boolean(event.target.value),
          } })} />
        </SettingRow>
        {raw.loadSnippetsFromFile && raw.snippetsFileLocation && <ConfigurationFile name="片段源码" path={raw.snippetsFileLocation} />}
        {raw.loadSnippetVariablesFromFile && raw.snippetVariablesFileLocation && <ConfigurationFile name="片段变量" path={raw.snippetVariablesFileLocation} />}
      </SettingGroup>
      <SettingGroup title="公式编辑与预览">
        {[
          ['自动分式', 'autofractionEnabled'], ['Tab 跳出', 'taboutEnabled'], ['自动放大括号', 'autoEnlargeBrackets'],
          ['括号着色', 'colorPairedBracketsEnabled'], ['光标括号高亮', 'highlightCursorBracketsEnabled'],
          ['LaTeX 语法高亮', 'syntaxHighlightingEnabled'], ['公式分隔符检查', 'highlightDollarEnabled'],
          ['编辑时公式预览', 'mathPreviewEnabled'], ['预览参数高亮', 'mathPreviewBracketHighlighting'],
          ['实时编辑块公式文档内预览', 'mathPreviewLivePreviewDisplay'], ['Unicode 简化显示', 'concealEnabled'],
        ].map(([label, key]) => checkbox(label, Boolean((raw as any)[key]), value => attempt({ latex: { [key]: value } })))}
        {checkbox('预览中显示光标', Boolean(raw.mathPreviewCursor), value => attempt({ latex: { mathPreviewCursor: value ? '▶' : '' } }), '无法可靠定位时显示普通公式。')}
      </SettingGroup>
    </>}
  </div>;
}
