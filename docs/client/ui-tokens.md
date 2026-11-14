# UI tokens

Common visual values live in `client/src/shared/ui/styles/tokens.css`.
`base.css` owns resets and global base styles; `app/main.ts` imports both files.
Keeping values here makes theme and typography changes consistent.

Use CSS custom properties: `--fs-*` for font sizes, `--font-sans`/`--font-mono`
for families, `--fw-*` and `--lh-*` for weight and line height. `inherit` is allowed
when a child deliberately follows its parent. Do not copy font stacks or add
literal font sizes in feature styles, including inline styles.

```css
.path { font-family: var(--font-mono); font-size: var(--fs-sm); }
.panel { color: var(--text); background: var(--bg2); gap: var(--sp-2); }
```

Use existing spacing, radius, control-size, color, shadow, motion, focus and z-index
tokens for common visual values. If a new shared value is needed, add a named
token here and use it in the shared component; domain geometry stays local.
Use component props to change a control's appearance: see [UI components](ui-components.md).

`npm run test:ui-consistency` rejects literal `font-size`/`font-family` declarations
and includes negative fixtures. `npm run lint` rejects legacy control classes.
