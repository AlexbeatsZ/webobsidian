# Rendering acceptance

Plain paragraph with **bold**, *italic*, ~~strike~~, ==highlight==, `inline code`,
[[Another note|alias]], [external](https://example.com), #中文标签 and #nested/tag.

甲<br>乙 — 甲<br/>乙 — 甲<br />乙 — 甲<BR>乙

<b>bold <mark>highlight</mark></b> and <kbd>Ctrl</kbd> &amp; entities.

- A long list item whose wrapping must align with its text rather than its marker.
  - Nested item
- [ ] Pending
- [x] Complete

> [!note]+ A callout
> Body with $x^2$.
>
> > [!warning] Nested
> > Keep the nesting.

| Name | Value |
| :--- | ---: |
| **bold** | a<br>b |
| `a\|b` | $x$ |

$$
\frac{a}{b}
$$

```html
<br> and [[literal]] must remain code
```

%%hidden comment%% and a block reference ^block-id

Footnote[^one] and [reference][target].

[^one]: Footnote definition.
[target]: https://example.com

Caret sentinel: plain text.
