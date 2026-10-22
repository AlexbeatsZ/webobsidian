# JavaScript blocks

Ordinary `js` and `javascript` display source. Use `js-widget` to execute trusted
code in private notes. `javascript-widget` is an alias. Existing first-line
`// @obsidian-js` blocks remain supported. Source view always shows source.

The supplied values are `app`, `container`, `sourcePath`, `component`, `echarts`,
`chart`, `widgets`, `watch`, `onCleanup`, `renderMarkdown`, and `signal`.

```js
// This example is displayed, never executed.
container.textContent = 'Hello';
```

## A dynamic control

```js-widget
const label = document.createElement('output');
const slider = document.createElement('input');
slider.type = 'range';
slider.min = '0'; slider.max = '100'; slider.value = '40';
const update = () => { label.textContent = `Value: ${slider.value}`; };
component.registerDomEvent(slider, 'input', update);
container.append(slider, label);
update();
```

## A chart

```js-widget
const plot = chart({
  tooltip: {},
  xAxis: { type: 'category', data: ['A', 'B', 'C'] },
  yAxis: { type: 'value' },
  series: [{ type: 'bar', data: [5, 12, 8] }]
}, { height: 300 });
// chart returns the ECharts instance synchronously.
plot.setOption({ animationDuration: 250 });
```

For custom animations, register their cleanup. The chart helper already owns its
observer and chart disposal; do not dispose it a second time.

```js-widget
const text = document.createElement('p'); container.append(text);
const timer = window.setInterval(() => { text.textContent = new Date().toLocaleTimeString(); }, 1000);
onCleanup(() => window.clearInterval(timer));
```

## Existing personal widgets

```js-widget
await widgets.outline({ target: '[[]]' });
```

```js-widget
await widgets.directoryIndex();
```

```js-widget
await widgets.callouts({ note: 'Example note', type: 'tactic' });
```

`widgets.folderTagOverview({mode:'folders'})`, the `rules` mode and
`widgets.uptimer(options)` retain the original plugin's options. The directory
index groups PDF/MD in child folders containing 正文. Widgets subscribe to their
inputs automatically; custom scripts use `watch('path/to/data.md')` explicitly.

Generated Markdown uses the existing renderer with nested execution disabled.
Public shares and print show source rather than executing trusted code. The full
`app` has Vault write access even in a private reading view. Trusted scripts can
block the main thread or create unmanaged globals; use the lifecycle helpers to
release resources. Scrolling an output out of CodeMirror's virtualized DOM may
dispose it; there is no persisted control-state cache.
