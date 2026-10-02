/** Provider-neutral integration contracts. Secrets never appear in these read models. */
export type AuthStrategy = 'basic' | 'form' | 'auto' | 'token' | 'browser' | 'api-login';
export type CredentialMode = 'inherit' | 'credential' | 'own';
export type CredentialStatus = 'ready' | 'needs_update';
export type ConnectionCheckStatus = 'unchecked' | 'ok' | 'error' | 'needs_update';
export type SourceType = 'folder' | 'docs';
export type SyncStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled';
export interface IntegrationOrganization {
  id: string; name: string; credential_id: string | null; created_at: string; updated_at: string;
}
export interface IntegrationCredential {
  id: string; organization_id: string | null; name: string; username: string;
  hasSecret: boolean; status: CredentialStatus; revision: number; created_at: string; updated_at: string;
}
export interface IntegrationConnection {
  id: string; name: string; base_url: string; organization_id: string | null;
  credential_mode: CredentialMode; credential_id: string | null; auth_strategy: AuthStrategy;
  auth_config: Record<string, unknown>; last_check_status: ConnectionCheckStatus;
  last_check_at: string | null; last_check_message: string; created_at: string; updated_at: string;
}
/** Ciphertext only; internal database row, never an HTTP response. */
export interface IntegrationSessionRow {
  connection_id: string; credential_id: string | null; credential_revision: number;
  secret_blob: Buffer; expires_at: string | null; created_at: string; updated_at: string;
}
export interface DocsSelection { id: string; include_descendants: boolean; excluded_ids?: string[] }
export interface SyncStats { message?: string; code?: string; confirmation_count?: number; warnings?: string[]; errors?: number; found?: number; downloaded?: number; added?: number; updated?: number; deleted?: number }