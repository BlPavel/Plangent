# UI components

Use `@shared/ui` primitives for controls so their appearance, keyboard handling
and disabled states remain consistent. Choose AppButton (including link/icon
variants), AppInput, AppTextarea, AppSelect/Combobox, AppCheckbox, AppRadioGroup,
AppSwitch, AppTabs, AppSegmented, AppBadge/Count/Chip, AppModal and AppPopover.
FormField wraps common fields; BranchSelect wraps the combobox. List entries with a title,
badges, buttons on the right and meta lines below are AppItemCard (`nested` for a card inside
a card); sidebar-style rows are AppTreeRow. Do not restyle such cards locally. See
`client/src/shared/ui/index.ts` for the public exports.

Chats with an agent about an entity (analysis, plan, library section) show the
same `ChatTabs` strip from `@features/agent-chat`: tabs named after the entity and the
chat's number («План 1»), never after the first request, and «+ Новый чат».

Set visual state through props (`variant`, `size`, `pressed`, `tone`, `mono`,
`invalid`, `block`). For example:

```vue
<AppButton variant="blue" size="sm" :disabled="saving" @click="save">Save</AppButton>
<AppTextarea v-model="text" mono block />
```

Local classes may position a primitive with margin, flex, grid, align-self, order,
dimensions or positioning. Add a wrapper for container layout. Visual overrides
(color, padding, border, typography, background), inline styles and `:deep` into
shared controls are forbidden; add a reusable prop or variant to the primitive.
Native controls are implemented inside shared/ui. Third-party xterm content,
Markdown/highlight output and domain child components have targeted deep selectors
in the consistency checker; these are not permission to style shared controls.

Run `npm run lint` (restricted HTML elements/classes) and
`npm run test:ui-consistency` (CSS and override checks). Behavioral tests use
roles, accessible labels and stable data attributes rather than primitive classes;
`npm run test:ui-primitives` verifies the primitives themselves.
