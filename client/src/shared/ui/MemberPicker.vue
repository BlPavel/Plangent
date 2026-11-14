<template>
  <span ref="root" class="member-picker">
    <AppButton size="sm" variant="subtle" :disabled="!members.length && !allowCustom" :aria-expanded="open" @click="open = !open; query = ''">{{ label }}</AppButton>
    <AppPopover v-model="open" :anchor="root" :min-width="260">
      <div class="search"><AppInput v-model="query" size="sm" block :placeholder="placeholder" aria-label="Поиск участника" @keydown.enter.prevent="create" /></div>
      <div class="list">
        <button v-for="member in shown" :key="member.value" type="button" class="option" @click="pick(member.value)"><span>{{ member.name }}<span class="description">{{ member.login }}</span></span></button>
        <AppButton v-if="allowCustom && query.trim()" size="sm" variant="link" @click="create">Добавить {{ query }}</AppButton>
        <div v-if="!shown.length" class="heading">Никого не найдено</div>
      </div>
    </AppPopover>
  </span>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import AppButton from './AppButton.vue';
import AppInput from './AppInput.vue';
import AppPopover from './AppPopover.vue';
const props = withDefaults(defineProps<{
    members: {
        value: string;
        login: string;
        name: string;
    }[];
    allowCustom?: boolean;
    label?: string;
    placeholder?: string;
}>(), { label: '+ Добавить', placeholder: 'Поиск…' });
const emit = defineEmits<{
    pick: [
        value: string
    ];
    create: [
        value: string
    ];
}>();
const root = ref<HTMLElement>(), open = ref(false), query = ref('');
const shown = computed(() => props.members.filter(m => (m.name + ' ' + m.login).toLowerCase().includes(query.value.toLowerCase())));
function pick(value: string) { open.value = false; emit('pick', value); }
function create() { if (props.allowCustom && query.value.trim()) {
    emit('create', query.value.trim());
    open.value = false;
} }
</script>
<style scoped>
@import './styles/options.css';
.member-picker { display: inline-flex; }
.search { padding: var(--sp-1) var(--sp-1) var(--sp-2); border-bottom: 1px solid var(--border); }
.list .option { flex-shrink: 0; }
.list { display: flex; flex-direction: column; max-height: 240px; margin-top: var(--sp-1); overflow-y: auto; }
</style>
