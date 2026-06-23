# Plangent

## Architecture

The Vue app in `client/src` uses a small modular layout:

```text
client/src/
  core/
    api/
    electron/
    models/
    router/
    stores/
  shared/
    ui/
    components/
    composables/
    utils/
  features/
    agents/
    library/
    projects/
    settings/
    tasks/
  assets/
  App.vue
  main.ts
```

`core` contains app-wide infrastructure: API client, shared TypeScript models,
router assembly, Electron declarations, and truly global stores such as `app`.

`shared` contains reusable frontend building blocks. `shared/ui` is for dumb,
domain-agnostic components. `shared/components` is reserved for smart reusable
components that are not owned by a single feature. Universal composables belong in
`shared/composables`; domain-bound composables stay inside their feature.

`features` contains domain modules. Each feature owns its `views/`, `components/`,
`stores/`, `routes.ts`, and `index.ts`. Feature `index.ts` is the public API used
from outside that feature; avoid importing from another feature's internal folders.

Dependency direction is one-way: features may use `shared` and `core`; `shared`
may use `core`; shared code must not depend on features. The router is assembled in
`core/router` from feature route arrays.

Use the view/component rule consistently: if it is declared in the router, put it
in `views/`; if it is inserted as a local tag inside another screen, put it in
`components/`.

Stores live with the feature they belong to. Only truly global UI/application
state lives in `core/stores`.

Path aliases are part of the architecture and must stay synchronized between
`client/vite.config.ts` and `client/tsconfig.json`: `@core`, `@shared`, and
`@features`.
