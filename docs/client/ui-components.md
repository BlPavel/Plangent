# UI components

Use `@shared/ui` primitives for controls so their appearance, keyboard handling
and disabled states remain consistent. Choose AppButton (including link/icon
variants), AppInput, AppTextarea, AppSelect/Combobox, AppCheckbox, AppRadioGroup,
AppSwitch, AppTabs, AppSegmented, AppBadge/Count/Chip, AppModal and AppPopover.
AppChoiceList is a single choice among options that each need an explanation line
(selectable tiles with radio semantics, an optional badge and quieter `secondary` fallbacks).
FormField wraps common fields; BranchSelect wraps the combobox. List entries with a title,
badges, buttons on the right and meta lines below are AppItemCard (`nested` for a card inside
a card); sidebar-style rows are AppTreeRow. Do not restyle such cards locally.
Settings-like screens (global settings, a project's or group's settings) are
AppSettingsLayout: AppNavTree on the left, AppPageHeader and the page body in the
middle, and an optional panel on the right (the chat with an agent) that takes
the navigation's place on a narrow screen. See
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

Closed review cards share the persisted `core/stores/remark-visibility` preference
across code, branch reviews, MR discussions and task document reviews. Use
`useRemarkVisibility` with an owner key and explicit closed flags; an agent reply,
acceptance for implementation or publication is not closure. Code items use
`closed`, external discussions use `resolved`, branch remarks use `rejected`,
and task document remarks use `applied` or `rejected`.

Use `AppClosedItemsToggle` (built on AppCheckbox) for the setting and hidden count.
Render it once in the remarks panel, alongside its filters. Do not duplicate it
in file/diff toolbars or the embedded MR section of the same panel.
Apply visibility to both cards and code widget/marker lines. Explicit closed-only
filters override the preference for their list. `AppClosedItemNotice` leaves a
short notice after a live closure; its Show action and direct navigation reveal
only that card until the owner changes. Never save these temporary exceptions.
Outdated anchors and review selection keep their existing meaning; this setting
does not attach historical remarks to a different line or review. Verify with
`node --test client/tests/remark-visibility.test.cjs` and the review UI suites.
