<template>
  <div class="slots">
    <FormField
      v-model="value"
      label="Одновременных тяжёлых команд"
      type="number"
      :placeholder="'Авто: ' + auto"
      :disabled="loading"
      :invalid="invalid"
      hint="Тесты, сборка, линтеры и проверка типов от всех агентов выполняются не более чем в таком числе одновременно, остальные ждут в очереди. Пусто — считается автоматически по ядрам процессора этого компьютера."
      @update:model-value="status = 'dirty'"
      @change="save"
    />
    <div class="row">
      <AppButton variant="primary" size="sm" :disabled="loading || invalid || status === 'saving'" @click="save">Сохранить</AppButton>
      <span class="status" :class="status">{{ statusLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import FormField from '@shared/ui/FormField.vue'
import AppButton from '@shared/ui/AppButton.vue'
import { settingsEndpoints } from '../api'

const KEY = 'command_slots'
// The same rule as the server's: a quarter of the cores, at least two.
const auto = Math.max(2, Math.floor((navigator.hardwareConcurrency || 8) / 4))

const value = ref('')
const loading = ref(true)
const status = ref<'saved' | 'dirty' | 'saving' | 'error'>('saved')
const invalid = computed(() => value.value.trim() !== '' && !/^\d{1,3}$/.test(value.value.trim()))
const statusLabel = computed(() => ({ saved: 'Сохранено', dirty: 'Есть изменения', saving: 'Сохранение…', error: 'Не удалось сохранить' })[status.value])

async function save() {
  if (loading.value || invalid.value || status.value !== 'dirty') return
  status.value = 'saving'
  try {
    const slots = Number(value.value.trim()) || 0
    await settingsEndpoints.putSettingsByKey({ params: { key: KEY }, body: { value: slots > 0 ? String(slots) : '' } })
    status.value = 'saved'
  } catch {
    status.value = 'error'
  }
}

onMounted(async () => {
  try {
    value.value = (await settingsEndpoints.getSettingsByKey({ params: { key: KEY } })).value
  } catch {
    status.value = 'error'
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.slots { display: flex; flex-direction: column; gap: 12px; max-width: 520px; }
.row { display: flex; align-items: center; gap: 12px; }
.status { font-size: var(--fs-sm); color: var(--text-muted); }
.status.error { color: var(--danger-hover); }
</style>
