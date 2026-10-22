import { useEffect, useState } from 'react';
import { useWriting, updateWriting, refreshWriting, writingCMSettings } from '../lib/writing/config';
import { DEFAULT_SETTINGS } from '../lib/writing/latex/settings/settings';
import { formatRules, formatterSettings } from '../lib/writing/format';
import { DropdownOption, TextAreaOption } from '../lib/writing/linter/option';
import { useStore } from '../lib/store';
import MathSettings from './MathSettings';

function JsonEditor({
  label,
  value,
  onSave,
}: {
  label: string;
  value: unknown;
  onSave: (value: any) => Promise<unknown>;
}) {
  const [text, setText] = useState(JSON.stringify(value, null, 2)),
    [error, setError] = useState('');
  useEffect(() => setText(JSON.stringify(value, null, 2)), [value]);
  return (
    <details>
      <summary>{label}</summary>
      <textarea
        aria-label={label}
        value={text}
        rows={14}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        style={{ width: '100%', fontFamily: 'monospace' }}
      />
      <button
        onClick={() => {
          try {
            void onSave(JSON.parse(text))
              .then(() => setError(''))
              .catch((e) => setError(String(e)));
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        保存
      </button>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
export default function WritingSettings({ formatting = false }: { formatting?: boolean }) {
  const { settings, error } = useWriting();
  const notify = useStore((s) => s.notify);
  const [failure, setFailure] = useState('');
  const save = async (value: Parameters<typeof updateWriting>[0]) => {
    try {
      await updateWriting(value);
      setFailure('');
    } catch (e) {
      setFailure(String(e));
      throw e;
    }
  };
  const attempt = (value: Parameters<typeof updateWriting>[0]) => {
    void save(value).catch(() => {});
  };
  const raw = { ...DEFAULT_SETTINGS, ...settings.latex };
  const checkbox = (label: string, value: boolean, change: (value: boolean) => void) => (
    <label className="setting-row" key={label}>
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => change(e.target.checked)} />
    </label>
  );
  const fmt = formatterSettings();
  return (
    <div>
      <h2>{formatting ? '文档格式化' : '公式与片段'}</h2>
      {(failure || error) && <p role="alert">{failure || error}</p>}
      <button
        onClick={() =>
          void refreshWriting(true)
            .then(() => notify('配置已重新加载'))
            .catch((e) => setFailure(String(e)))
        }
      >
        重新加载配置与规则文件
      </button>
      {formatting ? (
        <>
          {checkbox('手动保存时格式化', fmt.lintOnSave, (v) => attempt({ linter: { lintOnSave: v } }))}
          {checkbox('切换或关闭文档时格式化', fmt.lintOnFileChange, (v) =>
            attempt({ linter: { lintOnFileChange: v } }),
          )}
          <p>后台自动保存只保存内容。规则按配置顺序执行，忽略路径适用于手动保存及批量格式化。</p>
          <label>
            忽略文件夹（每行一个）
            <textarea
              rows={4}
              defaultValue={fmt.foldersToIgnore.join('\n')}
              onBlur={(e) =>
                attempt({ linter: { foldersToIgnore: e.target.value.split('\n').filter(Boolean) } })
              }
            />
          </label>
          {['YAML', 'Heading', 'Footnote', 'Content', 'Spacing', 'Paste'].map((type) => (
            <details key={type}>
              <summary>
                {
                  (
                    {
                      YAML: '文档属性',
                      Heading: '标题',
                      Footnote: '脚注',
                      Content: '正文',
                      Spacing: '空白与排版',
                      Paste: '粘贴',
                    } as Record<string, string>
                  )[type]
                }
              </summary>
              {formatRules
                .filter((rule) => rule.type === type)
                .map((rule) => (
                  <details key={rule.alias}>
                    <summary>
                      <input
                        type="checkbox"
                        aria-label={rule.getName()}
                        checked={Boolean(fmt.ruleConfigs[rule.alias]?.enabled)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          attempt({
                            linter: { ruleConfigs: { [rule.alias]: { enabled: e.target.checked } } },
                          })
                        }
                      />
                      {rule.getName()}
                    </summary>
                    <p>{rule.getDescription()}</p>
                    {rule.options.slice(1).map((option) => {
                      const current = fmt.ruleConfigs[rule.alias][option.configKey] ?? option.defaultValue;
                      const set = (value: any) =>
                        attempt({ linter: { ruleConfigs: { [rule.alias]: { [option.configKey]: value } } } });
                      return (
                        <label className="setting-row" key={option.configKey}>
                          <span>{option.getName()}</span>
                          {typeof current === 'boolean' ? (
                            <input
                              type="checkbox"
                              checked={current}
                              onChange={(e) => set(e.target.checked)}
                            />
                          ) : option instanceof DropdownOption ? (
                            <select value={current} onChange={(e) => set(e.target.value)}>
                              {option.options.map((o) => (
                                <option key={o.value} value={o.value.replace('enums.', '')}>
                                  {o.getDisplayValue()}
                                </option>
                              ))}
                            </select>
                          ) : typeof current === 'object' ? (
                            <JsonEditor
                              label={option.getName()}
                              value={current}
                              onSave={async (value) => {
                                await save({
                                  linter: { ruleConfigs: { [rule.alias]: { [option.configKey]: value } } },
                                });
                              }}
                            />
                          ) : option instanceof TextAreaOption ? (
                            <textarea
                              key={String(current)}
                              defaultValue={current}
                              rows={3}
                              onBlur={(e) => set(e.target.value)}
                            />
                          ) : (
                            <input
                              key={String(current)}
                              defaultValue={current}
                              onBlur={(e) =>
                                set(typeof current === 'number' ? Number(e.target.value) : e.target.value)
                              }
                            />
                          )}
                        </label>
                      );
                    })}
                  </details>
                ))}
            </details>
          ))}
          <JsonEditor
            label={`自定义正则（${settings.linter.customRegexes?.length ?? 0} 条，按列表顺序执行）`}
            value={settings.linter.customRegexes ?? []}
            onSave={(customRegexes) => save({ linter: { customRegexes } })}
          />
          <p>
            {
              '替换使用 LaTeX Suite 语法：[[0]] 是第一个捕获组，[[<名称>]] 是命名组，${MATCH} 是完整匹配。反斜杠保留原文；${DOLLAR} 可插入字面 $，例如 ${DOLLAR}1 插入 $1。格式化中的 ${0:默认值} 只插入默认值。JSON 中的换行写作 \\n，反斜杠写作 \\\\。'
            }
          </p>
          <JsonEditor label="高级格式化配置" value={settings.linter} onSave={(linter) => save({ linter })} />
        </>
      ) : (
        <>
          <MathSettings />
          <p>
            当前载入 {writingCMSettings().snippets.all.length}{' '}
            条片段。修改规则文件后自动重载；失败时继续使用上一次有效规则。
          </p>
          {checkbox('启用片段与占位符', raw.snippetsEnabled, (v) =>
            attempt({ latex: { snippetsEnabled: v } }),
          )}
          <label>
            片段文件／文件夹
            <input
              key={raw.snippetsFileLocation}
              defaultValue={raw.snippetsFileLocation}
              onBlur={(e) =>
                attempt({
                  latex: {
                    snippetsFileLocation: e.target.value,
                    loadSnippetsFromFile: Boolean(e.target.value),
                  },
                })
              }
            />
          </label>
          {raw.loadSnippetsFromFile && (
            <button onClick={() => void useStore.getState().openFile(raw.snippetsFileLocation)}>
              编辑片段文件
            </button>
          )}
          {[
            ['自动分式', 'autofractionEnabled'],
            ['Tab 跳出', 'taboutEnabled'],
            ['自动放大括号', 'autoEnlargeBrackets'],
            ['括号着色', 'colorPairedBracketsEnabled'],
            ['光标括号高亮', 'highlightCursorBracketsEnabled'],
            ['公式分隔符检查', 'highlightDollarEnabled'],
            ['公式预览', 'mathPreviewEnabled'],
            ['预览参数高亮', 'mathPreviewBracketHighlighting'],
            ['实时编辑块公式浮层', 'mathPreviewLivePreviewDisplay'],
            ['Unicode 简化显示', 'concealEnabled'],
          ].map(([label, key]) =>
            checkbox(label, Boolean((raw as any)[key]), (v) => attempt({ latex: { [key]: v } })),
          )}
          <JsonEditor label="高级公式与片段配置" value={settings.latex} onSave={(latex) => save({ latex })} />
        </>
      )}
      <p>{settings.migration}</p>
    </div>
  );
}
