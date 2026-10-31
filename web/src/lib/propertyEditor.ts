import { canEditProperties, patchPropertyRows, readPropertyRows, type SourceChange } from '@webobsidian/markdown-core';
import { setIcon } from './icons';
import type { RenderContext, RenderMenuItem as LpMenuItem } from './renderContext';

export interface PropertyEditorHost {
  context: RenderContext;
  text(): string;
  readOnly(): boolean;
  apply(changes: SourceChange[]): void;
  focus(): void;
  sourceEntry?: () => HTMLElement;
}
const cleanups = new WeakMap<HTMLElement, Set<() => void>>();
export function disposePropertyEditor(root: HTMLElement) {
  for (const cleanup of cleanups.get(root) ?? []) cleanup();
  cleanups.delete(root);
}

interface Prop {
  key: string;
  values: string[];
  list: boolean;
  editable?: boolean; scalarType?: string; forceList?: boolean;
}

// Tags / cssclasses can't contain spaces (invalid in Obsidian) — collapse runs of
// whitespace to a hyphen and drop a leading '#'. Other list values pass through.
function sanitizeListValue(key: string, raw: string): string {
  const v = raw.trim();
  if (key === 'tags' || key === 'cssclasses') return v.replace(/^#+/, '').replace(/\s+/g, '-');
  return v;
}

/** Parse the YAML subset Obsidian uses for properties. */
const parseFrontmatter = readPropertyRows;

// Obsidian's built-in List properties.
const CORE_LIST_PROPS = new Set(['tags', 'aliases', 'cssclasses']);

// Infer a property's type only when the Vault registry has no explicit type.
function propType(p: Prop): string {
  if (p.list || CORE_LIST_PROPS.has(p.key)) return 'list';
  const v = p.values[0] ?? '';
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v)) return 'datetime';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'date';
  if (v !== '' && /^-?\d+(\.\d+)?$/.test(v)) return 'number';
  if (/^(true|false)$/i.test(v)) return 'checkbox';
  return 'text';
}
const PROP_TYPES: Record<string, { label: string; icon: string }> = {
  auto: { label: '自动', icon: 'loader' },
  checkbox: { label: '复选框', icon: 'check-square' },
  date: { label: '日期', icon: 'calendar' },
  datetime: { label: '日期 & 时间', icon: 'clock' },
  list: { label: '列表', icon: 'list' },
  number: { label: '数字', icon: 'hash' },
  text: { label: '文本', icon: 'type' },
};
function setPropertyIcon(element: HTMLElement, type: string): void {
  const entry = PROP_TYPES[type] ?? PROP_TYPES.text;
  setIcon(element, entry.icon);
  element.title = entry.label;
}

// Obsidian type id ↔ our display type.
const OBS_TO_DT: Record<string, string> = {
  text: 'text',
  multitext: 'list',
  tags: 'list',
  aliases: 'list',
  number: 'number',
  checkbox: 'checkbox',
  date: 'date',
  datetime: 'datetime',
};
function dtToObs(dt: string, key: string): string {
  if (dt === 'list') return key === 'tags' ? 'tags' : key === 'aliases' ? 'aliases' : 'multitext';
  return dt;
}
/** Effective display type: the vault registry wins, else inferred from the value. */
function displayTypeOf(p: Prop, registry: Record<string, string>): string {
  const reg = registry[p.key];
  if (reg && OBS_TO_DT[reg]) return OBS_TO_DT[reg];
  return propType(p);
}

export function createPropertyEditor(yaml: string, ro: boolean, host: PropertyEditorHost): HTMLElement {
    // CM measures this root's rectangle, not margins between block siblings.
    // A flow root contains the existing properties margins and divider intact.
    const block = document.createElement('div');
    block.className = 'cm-properties-block';
    const lifetime = new Set<() => void>();
    cleanups.set(block, lifetime);
    const box = document.createElement('div');
    box.className = 'properties cm-properties';
    block.appendChild(box);
    if (!ro && host.sourceEntry) box.appendChild(host.sourceEntry());

    // Commit source patches only, preserving every unrelated YAML token.
    const commit = (props: Prop[]) => {
      if (!block.isConnected || ro || host.readOnly()) return;
      const text = host.text();
      const fm = text.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
      try {
        if ((fm?.[1] ?? '') !== yaml) throw new Error('编辑期间属性已变化，草稿未写入');
        const patches = patchPropertyRows(yaml, props);
        const changes = fm ? patches.map(change => ({ ...change, from: change.from + 4, to: change.to + 4 }))
          : [{ from: 0, to: 0, insert: '---\n' + patches.reduceRight((text, change) => text.slice(0, change.from) + change.insert + text.slice(change.to), yaml) + '\n---\n' }];
        if (changes.length) host.apply(changes);
        host.focus();
      } catch (error) { host.context.reportError?.((error as Error).message); }
    };
    // Rows keep source order until this widget is replaced by the transaction.
    // A blank control for a null scalar must not turn it into a quoted string
    // when a different property is edited; explicit empty strings stay strings.
    const readProps = (): Prop[] =>
      ([...box.querySelectorAll('.prop-row:not(.prop-newrow)')] as HTMLElement[]).map((row, index) => ({
        key: (row.querySelector('.prop-key') as HTMLElement).innerText,
        list: row.dataset.list === '1',
        scalarType: (row.querySelector('.prop-val-field') as HTMLElement | null)?.dataset.propertyType,
        values:
          row.dataset.list === '1'
            ? ([...row.querySelectorAll('.prop-pill')] as HTMLElement[]).map((p) => p.dataset.val ?? '')
            : (props[index]?.values.length === 0 && !(row.querySelector('.prop-val-field') as HTMLElement)?.dataset.raw
              ? [] : [(row.querySelector('.prop-val-field') as HTMLElement)?.dataset.raw ?? '']),
      }));
    // Flush an in-progress inline edit (pill text or scalar text) into its data
    // attribute so a concurrent structural change never drops it.
    const flushActive = () => {
      const a = document.activeElement as HTMLElement | null;
      if (!a) return;
      if (a.classList.contains('prop-pill-text')) {
        const pill = a.closest('.prop-pill') as HTMLElement | null;
        const rowKey = (a.closest('.prop-row')?.querySelector('.prop-key') as HTMLElement | null)?.innerText.trim() ?? '';
        if (pill) pill.dataset.val = sanitizeListValue(rowKey, a.innerText);
      } else if (a.classList.contains('prop-val-input')) {
        a.dataset.raw = a.innerText;
      }
    };
    const mutate = (fn: (p: Prop[]) => void) => {
      flushActive();
      const p = readProps();
      fn(p);
      commit(p);
    };

    // Change a property's type: persist to .obsidian/types.json, then convert the
    // note's YAML if list-ness changed (else just refresh the icon in place).
    const setType = async (key: string, dt: string) => {
      try {
        await host.context.setPropertyType(key, dtToObs(dt, key));
      } catch (error) {
        host.context.reportError?.(String(error));
        return;
      }
      if (!block.isConnected) return;
      const row = ([...box.querySelectorAll('.prop-row:not(.prop-newrow)')] as HTMLElement[]).find(
        (r) => (r.querySelector('.prop-key') as HTMLElement).innerText.trim() === key,
      );
      const curIsList = row?.dataset.list === '1';
      // The existing registry fallback infers from source. Selecting Auto must
      // not convert YAML values or turn an existing source list into text.
      const effectiveType = dt === 'auto' ? propType(props.find(prop => prop.key === key) ?? { key, values: [], list: false }) : dt;
      const newIsList = effectiveType === 'list';
      if (dt !== 'auto' && newIsList !== curIsList) {
        mutate((ps) => {
          const p = ps.find((x) => x.key === key);
          if (!p) return;
          p.forceList = true;
          if (newIsList) p.list = true;
          else {
            p.list = false;
            p.values = [p.values.filter(Boolean).join(', ')];
          }
        });
      } else if (row) {
        // Scalar → scalar: no YAML change needed; just refresh the icon and swap
        // the value control to match the new type (e.g. date → number input).
        const ic = row.querySelector('.prop-icon') as HTMLElement | null;
        if (ic) {
          setPropertyIcon(ic, effectiveType);
        }
        const valCell = row.querySelector('.prop-val');
        const oldField = row.querySelector('.prop-val-field') as HTMLElement | null;
        if (valCell && oldField) valCell.replaceChild(makeScalarField(effectiveType, oldField.dataset.raw ?? ''), oldField);
      }
    };

    const propMenu = (key: string, idx: number): LpMenuItem[] => {
      const selectedType = OBS_TO_DT[host.context.propertyTypes()[key]] ?? 'auto';
      return [
      {
        label: '属性类型',
        icon: PROP_TYPES[selectedType].icon,
        submenu: Object.entries(PROP_TYPES).map(([type, entry]) => ({
          label: entry.label, icon: entry.icon,
          checked: type === selectedType,
          onClick: () => void setType(key, type),
        })),
      },
      { label: '', separator: true },
      {
        label: 'Copy value',
        icon: 'file-text',
        onClick: () => {
          const p = readProps()[idx];
          if (p) navigator.clipboard.writeText(p.values.join(', ')).catch(() => {});
        },
      },
      { label: '', separator: true },
      { label: 'Remove', icon: 'trash', onClick: () => mutate((ps) => ps.splice(idx, 1)) },
    ]; };

    const props = parseFrontmatter(yaml);

    const header = document.createElement('div');
    header.className = 'cm-props-header';
    header.textContent = 'Properties';
    box.appendChild(header);
    if (!canEditProperties(yaml)) {
      const hint = document.createElement('div'); hint.className = 'prop-unsupported';
      hint.textContent = 'Complex or invalid YAML. Use the source entry to edit.'; box.appendChild(hint); return block;
    }

    const editable = (el: HTMLElement, onCommit: () => void) => {
      if (ro) return; // reading mode: no inline editing
      el.setAttribute('contenteditable', 'true');
      el.spellcheck = false;
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          el.blur();
        }
      });
      el.addEventListener('blur', onCommit);
    };

    // A value editor whose control matches the property type. `dataset.raw` always
    // holds the canonical YAML value so readProps never rewrites untouched fields.
    const makeScalarField = (dt: string, value: string): HTMLElement => {
      const commitChange = () => mutate(() => {});
      if (dt === 'number') {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.className = 'prop-val-field prop-input';
        inp.value = value;
        inp.dataset.raw = value;
        inp.addEventListener('change', () => {
          inp.dataset.raw = inp.value;
          commitChange();
        });
        inp.dataset.propertyType = dt;
        return inp;
      }
      if (dt === 'checkbox') {
        const inp = document.createElement('input');
        inp.type = 'checkbox';
        inp.className = 'prop-val-field prop-checkbox';
        const on = /^(true|yes|1)$/i.test(value);
        inp.checked = on;
        inp.dataset.raw = value;
        inp.addEventListener('change', () => {
          inp.dataset.raw = inp.checked ? 'true' : 'false';
          commitChange();
        });
        inp.dataset.propertyType = dt;
        return inp;
      }
      if (dt === 'date' || dt === 'datetime') {
        const inp = document.createElement('input');
        inp.type = dt === 'date' ? 'date' : 'datetime-local';
        inp.className = 'prop-val-field prop-input';
        if (dt === 'date') {
          inp.value = value.slice(0, 10);
        } else {
          const m = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
          inp.value = m ? `${m[1]}T${m[2]}` : '';
        }
        inp.dataset.raw = value;
        inp.addEventListener('change', () => {
          inp.dataset.raw = inp.value;
          commitChange();
        });
        inp.dataset.propertyType = dt;
        return inp;
      }
      // text (default)
      const span = document.createElement('span');
      span.className = 'prop-val-field prop-val-input';
      span.dataset.raw = value;
      span.textContent = value;
      editable(span, () => {
        if (span.innerText !== span.dataset.raw) {
          span.dataset.raw = span.innerText;
          mutate(() => {});
        }
      });
      span.dataset.propertyType = dt;
      return span;
    };

    // Add an item to a list property via a typed input + suggestion dropdown
    // (vault tags for the `tags` property; free text otherwise), like Obsidian.
    const startAddItem = async (key: string, idx: number, container: HTMLElement, addBtn: HTMLElement) => {
      addBtn.style.display = 'none';
      const inp = document.createElement('span');
      inp.className = 'prop-pill-input';
      inp.setAttribute('contenteditable', 'true');
      inp.spellcheck = false;
      const dd = document.createElement('div');
      dd.className = 'cm-props-dropdown prop-val-dropdown';
      container.insertBefore(inp, addBtn);
      // Mount inside the theme wrapper (not <body>) so the CSS variables that give
      // the dropdown its background resolve — otherwise it renders transparent.
      const themeHost = (document.querySelector('.theme-light, .theme-dark') as HTMLElement) ?? document.body;
      themeHost.appendChild(dd);
      // Fixed-position just below the input (viewport coords; rect forces reflow).
      const ir = inp.getBoundingClientRect();
      dd.style.left = `${Math.round(ir.left)}px`;
      dd.style.top = `${Math.round(ir.bottom + 2)}px`;
      inp.focus();

      const suggestions = key === 'tags' ? await host.context.tags() : [];
      if (!block.isConnected) { dd.remove(); return; }
      const existing = new Set(([...container.querySelectorAll('.prop-pill')] as HTMLElement[]).map((p) => p.dataset.val));
      let done = false;
      const cleanup = () => {
        if (container.contains(inp)) inp.remove();
        dd.remove();
        addBtn.style.display = '';
        lifetime.delete(cleanup);
      };
      lifetime.add(cleanup);
      const choose = (val: string) => {
        if (done || !block.isConnected) return;
        done = true;
        const vv = sanitizeListValue(key, val);
        // Always tear down first: the dropdown is mounted on the theme wrapper
        // (outside the widget DOM), so mutate()'s rebuild won't remove it — skip
        // this and the suggester stays stuck on screen after picking a value.
        cleanup();
        if (!vv) return;
        mutate((ps) => ps[idx]?.values.push(vv));
      };
      const render = () => {
        const q = inp.innerText.trim().toLowerCase();
        const matches = suggestions.filter((s) => !existing.has(s) && s.toLowerCase().includes(q));
        dd.textContent = '';
        for (const s of matches) {
          const it = document.createElement('div');
          it.className = 'cm-props-dd-item';
          const ic = document.createElement('span');
          ic.className = 'prop-icon';
          setIcon(ic, 'hash');
          const nm = document.createElement('span');
          nm.textContent = s;
          it.append(ic, nm);
          it.addEventListener('mousedown', (e) => {
            e.preventDefault();
            choose(s);
          });
          dd.appendChild(it);
        }
        dd.style.display = matches.length ? 'block' : 'none';
      };
      render();
      inp.addEventListener('input', render);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          choose(inp.innerText);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          done = true;
          cleanup();
        }
      });
      inp.addEventListener('blur', () =>
        setTimeout(() => {
          if (!done) {
            if (inp.innerText.trim()) choose(inp.innerText);
            else cleanup();
          }
        }, 160),
      );
    };

    props.forEach((p, idx) => {
      const dt = displayTypeOf(p, host.context.propertyTypes());
      const renderAsList = dt === 'list' || p.list;
      const row = document.createElement('div');
      row.className = 'prop-row';
      row.dataset.list = renderAsList ? '1' : '0';

      const icon = document.createElement('span');
      icon.className = 'prop-icon';
      setPropertyIcon(icon, renderAsList ? 'list' : dt);

      const k = document.createElement('span');
      k.className = 'prop-key';
      k.textContent = p.key;
      editable(k, () => mutate(() => {}));

      // Right-click the key or icon → Property type / Copy / Remove (like Obsidian).
      const openPropMenu = (e: MouseEvent) => {
        if (ro || p.editable === false) return;
        e.preventDefault();
        e.stopPropagation();
        host.context.openMenu({ x: e.clientX, y: e.clientY, items: propMenu(p.key, idx) });
      };
      k.addEventListener('contextmenu', openPropMenu);
      icon.addEventListener('contextmenu', openPropMenu);
      icon.style.cursor = 'pointer';
      // Left-click the icon also opens the menu. Use `click` (not `mousedown`):
      // openPropMenu stops propagation, so the trailing click never reaches the
      // window close-listener — opening on mousedown let that click slam it shut
      // again (the "jitter / won't open" on left-click).
      icon.addEventListener('click', openPropMenu);

      const v = document.createElement('div');
      v.className = 'prop-val';
      if (renderAsList) {
        for (const val of p.values) {
          const pill = document.createElement('span');
          pill.className = 'prop-pill';
          pill.dataset.val = val;
          if (/^tags?$/i.test(p.key)) pill.dataset.nativeTag = val.replace(/^#/, '');
          const txt = document.createElement('span');
          txt.className = 'prop-pill-text';
          txt.textContent = val;
          txt.setAttribute('contenteditable', 'true');
          txt.spellcheck = false;
          txt.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              txt.blur();
            }
          });
          txt.addEventListener('blur', () => {
            const nv = sanitizeListValue(p.key, txt.innerText);
            if (nv !== pill.dataset.val) {
              pill.dataset.val = nv;
              txt.textContent = nv; // reflect the sanitized value
              mutate(() => {});
            } else if (txt.innerText !== nv) {
              txt.textContent = nv;
            }
          });
          const x = document.createElement('span');
          x.className = 'prop-pill-x';
          setIcon(x, 'x');
          x.addEventListener('mousedown', (e) => {
            e.preventDefault();
            mutate((ps) => {
              const pp = ps[idx];
              if (!pp) return;
              const i = pp.values.indexOf(pill.dataset.val ?? '');
              if (i >= 0) pp.values.splice(i, 1);
            });
          });
          pill.append(txt, x);
          v.appendChild(pill);
        }
        const add = document.createElement('span');
        add.className = 'prop-pill-add';
        setIcon(add, 'plus');
        add.title = 'Add item';
        add.addEventListener('mousedown', (e) => {
          e.preventDefault();
          void startAddItem(p.key, idx, v, add);
        });
        v.appendChild(add);
      } else {
        v.appendChild(makeScalarField(dt, p.values[0] ?? ''));
      }

      const del = document.createElement('span');
      del.className = 'prop-del';
      setIcon(del, 'x');
      del.title = 'Delete property';
      del.addEventListener('mousedown', (e) => {
        e.preventDefault();
        mutate((ps) => ps.splice(idx, 1));
      });

      row.append(icon, k, v, del);
      if (p.editable === false) {
        row.classList.add('prop-unsupported');
        row.querySelectorAll('[contenteditable]').forEach((element) => element.removeAttribute('contenteditable'));
        row.querySelectorAll('.prop-del, .prop-pill-x, .prop-pill-add').forEach((element) => element.remove());
        for (const input of row.querySelectorAll('input')) { input.readOnly = true; input.tabIndex = -1; }
      }
      box.appendChild(row);
    });

    const addBtn = document.createElement('div');
    addBtn.className = 'cm-props-add';
    setIcon(addBtn, 'plus');
    addBtn.append('添加属性');

    // Add a property with a name-suggester dropdown (existing vault keys), like Obsidian.
    const startAdd = async () => {
      addBtn.style.display = 'none';
      const editorRow = document.createElement('div');
      editorRow.className = 'prop-row prop-newrow';
      const icon = document.createElement('span');
      icon.className = 'prop-icon';
      setPropertyIcon(icon, 'auto');
      const input = document.createElement('span');
      input.className = 'prop-key prop-new-key';
      input.setAttribute('contenteditable', 'true');
      input.spellcheck = false;
      const dd = document.createElement('div');
      dd.className = 'cm-props-dropdown';
      editorRow.append(icon, input);
      box.insertBefore(editorRow, addBtn);
      box.insertBefore(dd, addBtn);
      input.focus();

      const existing = new Set(readProps().map((p) => p.key));
      const all = (await host.context.properties()).filter((p) => !existing.has(p.key));
      if (!block.isConnected) return;

      let done = false;
      const choose = (key: string, type: string) => {
        if (done || !block.isConnected) return;
        done = true;
        const k = key.trim();
        if (!k) {
          cleanup();
          return;
        }
        mutate((ps) => ps.push({ key: k, values: type === 'list' ? [] : [''], list: type === 'list' }));
      };
      const cleanup = () => {
        if (box.contains(editorRow)) editorRow.remove();
        if (box.contains(dd)) dd.remove();
        addBtn.style.display = '';
        lifetime.delete(cleanup);
      };
      lifetime.add(cleanup);
      const renderDD = () => {
        const q = input.innerText.trim().toLowerCase();
        const matches = all.filter((p) => p.key.toLowerCase().includes(q)); // scrollable, show all
        dd.textContent = '';
        for (const p of matches) {
          const it = document.createElement('div');
          it.className = 'cm-props-dd-item';
          const ic = document.createElement('span');
          ic.className = 'prop-icon';
          setPropertyIcon(ic, OBS_TO_DT[p.type] ?? p.type);
          const nm = document.createElement('span');
          nm.textContent = p.key;
          it.append(ic, nm);
          it.addEventListener('mousedown', (e) => {
            e.preventDefault();
            choose(p.key, p.type);
          });
          dd.appendChild(it);
        }
        dd.style.display = matches.length ? 'block' : 'none';
      };
      renderDD();
      input.addEventListener('input', renderDD);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          choose(input.innerText, 'text');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          done = true;
          cleanup();
        }
      });
      input.addEventListener('blur', () => {
        // Allow a dropdown mousedown to win first; otherwise cancel an empty add.
        setTimeout(() => {
          if (!done) {
            if (input.innerText.trim()) choose(input.innerText, 'text');
            else cleanup();
          }
        }, 160);
      });
    };
    addBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      void startAdd();
    });
    box.appendChild(addBtn);
    // Reading mode: strip any remaining editing affordances (pill texts, inputs).
    if (ro) {
      for (const el of box.querySelectorAll('[contenteditable]')) el.removeAttribute('contenteditable');
      for (const inp of box.querySelectorAll('input')) {
        inp.readOnly = true; inp.tabIndex = -1;
        inp.addEventListener('click', (event) => event.preventDefault());
      }
    }
    return block;
}
