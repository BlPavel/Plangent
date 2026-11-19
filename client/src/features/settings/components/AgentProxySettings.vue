<template>
  <div class="proxy-settings">
    <p class="hint">Включите «Использовать прокси» у нужных агентов. Их обращения пойдут через указанный сервер. Команды через Plangent сохранят своё сетевое окружение.</p>
    <FormField
      v-model="url" label="Адрес прокси" placeholder="socks5://proxy.company:1080" :disabled="loading || saving"
      hint="HTTP, HTTPS, SOCKS5 и SOCKS5h. Например: http://proxy.company:8080. Для SOCKS5 имена серверов разрешает прокси." @update:model-value="changed"
    />
    <FormField v-slot="{ id }" label="Логин">
      <AppInput :id="id" v-model="username" autocomplete="off" :disabled="loading || saving" block @update:model-value="changed" />
    </FormField>
    <FormField v-slot="{ id }" label="Пароль" hint="Пустое поле сохраняет текущий пароль. При смене сервера или логина введите пароль заново.">
      <AppInput
        :id="id" v-model="password" type="password" autocomplete="new-password" :disabled="loading || saving"
        :placeholder="hasPassword ? 'Пароль сохранён' : 'Без пароля'" block @update:model-value="passwordChanged"
      />
    </FormField>
    <AppButton v-if="hasPassword" variant="ghost" size="sm" :disabled="loading || saving" @click="clearPassword">Удалить сохранённый пароль</AppButton>
    <FormField
      v-model="ca" label="Сертификат CA (необязательно)" type="textarea" :rows="3" :disabled="loading || saving"
      placeholder="-----BEGIN CERTIFICATE-----" hint="PEM-сертификат организации для защищённого соединения с HTTPS-прокси. Проверка сертификатов остаётся включённой." @update:model-value="changed"
    />
    <p class="hint">Если прокси недоступен, шлюз возвращает ошибку без прямого подключения. Пустой адрес блокирует запуск агентов с включённым прокси. Сохранение настроек закрывает их текущие сетевые соединения.</p>
    <div class="actions">
      <AppButton variant="primary" :disabled="loading || saving || !dirty" @click="save">{{ saving ? 'Сохранение…' : 'Сохранить' }}</AppButton>
      <AppButton variant="ghost" :disabled="loading || saving || checking || dirty || !url" @click="check">{{ checking ? 'Проверка…' : 'Проверить подключение' }}</AppButton>
    </div>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="saved" role="status" class="hint">Настройки сохранены</p>
    <div v-if="result" role="status" class="check-results">
      <p v-for="item in result.results" :key="item.host" :class="{ error: !item.ok }">{{ item.host }}: {{ item.ok ? 'соединение через прокси установлено' : item.error }}</p>
      <p class="hint">Проверяется туннель к API Codex и Claude. Запросы к моделям не отправляются.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AgentProxyCheck } from '@contracts'
import { AppButton, AppInput, FormField } from '@shared/ui'
import { settingsEndpoints } from '../api'

const url = ref(''), username = ref(''), password = ref(''), hasPassword = ref(false)
const ca = ref('')
const loading = ref(true), saving = ref(false), checking = ref(false), dirty = ref(false), saved = ref(false)
const error = ref(''), result = ref<AgentProxyCheck | null>(null)
let replacePassword = false
function changed() { dirty.value = true; saved.value = false; result.value = null; error.value = '' }
function passwordChanged() { replacePassword = password.value.length > 0; changed() }
function clearPassword() { password.value = ''; hasPassword.value = false; replacePassword = true; changed() }

async function load() {
  loading.value = true
  try {
    const value = await settingsEndpoints.getAgentProxy({ params: {} })
    url.value = value.url; username.value = value.username; hasPassword.value = value.hasPassword
    ca.value = value.ca ?? ''
  } catch (e) { error.value = String(e) }
  finally { loading.value = false }
}
async function save() {
  saving.value = true; error.value = ''; result.value = null
  try {
    const value = await settingsEndpoints.putAgentProxy({ params: {}, body: { url: url.value, username: username.value, ca: ca.value,
      ...(replacePassword ? { password: password.value } : {}) } })
    url.value = value.url; username.value = value.username; hasPassword.value = value.hasPassword
    ca.value = value.ca ?? ''
    password.value = ''; replacePassword = false; dirty.value = false; saved.value = true
  } catch (e) { error.value = String(e) }
  finally { saving.value = false }
}
async function check() {
  checking.value = true; error.value = ''; result.value = null
  try { result.value = await settingsEndpoints.checkAgentProxy({ params: {} }) }
  catch (e) { error.value = String(e) }
  finally { checking.value = false }
}
onMounted(load)
</script>

<style scoped>
.proxy-settings { display: flex; flex-direction: column; gap: var(--sp-3); max-width: 640px; }
.hint { color: var(--text-muted); font-size: var(--fs-sm); }
.actions { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.error { color: var(--danger-hover); overflow-wrap: anywhere; }
.check-results { display: flex; flex-direction: column; gap: var(--sp-2); }
</style>
