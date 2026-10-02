export interface Organization { id: string; name: string; credential_id: string | null }
export interface Credential { id: string; name: string; username: string; organization_id: string | null; hasSecret: boolean; status: 'ready' | 'needs_update' }
export type ConnectionCheckStatus = 'unchecked' | 'ok' | 'error' | 'needs_update'
export interface Connection {
  id: string; name: string; base_url: string; organization_id: string | null; credential_id: string | null;
  credential_mode: 'inherit' | 'credential' | 'own'; auth_strategy: string; auth_config: Record<string, unknown>;
  last_check_status: ConnectionCheckStatus; last_check_message: string; last_check_at?: string | null;
}
/** Result of «Проверить»: status is a server error code (network, invalid_credentials, …) or 'ok'; url is where it went. */
export interface ConnectionCheck { ok: boolean; status: string; message: string; url: string; user?: string }
export interface SecretStorage { kind?: string; available: boolean; insecure_dev_storage: boolean }
export interface IntegrationPreset { id: string; name: string; description: string; auth_strategy: string; auth_config: Record<string, unknown> }
export interface DocsPreset { id: string; name: string; description: string; config: Record<string, unknown> }
export interface DocsSelection { id: string; include_descendants: boolean; excluded_ids?: string[] }
export interface DocsForm { connection_id: string; docs_config: Record<string, unknown>; docs_selection: DocsSelection[] }
export interface DocsNode { id: string; title: string; url: string }
/** «Пробный запрос»: request URLs, extracted fields by name, JSON paths that found nothing, converted text. */
export interface DocsProbe { urls: string[]; fields: Record<string, unknown>; missing: string[]; preview: string; warnings: string[] }
export interface SyncProgress { stage: 'discover' | 'download' | 'done'; found: number; downloaded: number; processed?: number; total?: number }
