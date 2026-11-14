<template>
  <div class="settings-layout" :class="{ split: !!$slots.panel }">
    <aside class="settings-layout-nav"><slot name="nav" /></aside>
    <div class="settings-layout-main">
      <div v-if="$slots.header" class="settings-layout-header"><slot name="header" /></div>
      <slot />
    </div>
    <div v-if="$slots.panel" class="settings-layout-panel"><slot name="panel" /></div>
  </div>
</template>

<script setup lang="ts">
/**
 * A settings-like screen: the navigation on the left, the page (its header and body) in the middle
 * and an optional panel on the right, such as the chat with an agent. The page's body scrolls itself.
 * When the screen narrows, the navigation and then the page give way to the panel.
 */
</script>

<style scoped>
.settings-layout { display: flex; flex: 1; min-height: 0; min-width: 0; container-type: inline-size; }
/* Like the chat list: the page background, set apart from the details by a border. */
.settings-layout-nav { flex: 0 0 260px; overflow-y: auto; padding: var(--sp-5) var(--sp-2) var(--sp-2); border-right: 1px solid var(--border); }
.settings-layout-main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.settings-layout-header { flex-shrink: 0; padding: var(--sp-5) var(--sp-6) 0; }
.split .settings-layout-main { flex: 0 1 46%; min-width: 360px; }
.settings-layout-panel { flex: 1 1 54%; min-width: 420px; min-height: 0; display: flex; flex-direction: column; border-left: 1px solid var(--border); }

@container (max-width: 1080px) {
  .settings-layout-nav { flex-basis: 200px; }
  .split .settings-layout-nav { display: none; }
  .split .settings-layout-main { min-width: 320px; }
  .settings-layout-panel { min-width: 340px; }
}
@container (max-width: 720px) {
  .split .settings-layout-main { display: none; }
  .settings-layout-panel { min-width: 0; border-left: 0; }
}
</style>
