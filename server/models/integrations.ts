export type * from '@contracts';
export interface IntegrationSessionRow {
  connection_id: string; credential_id: string | null; credential_revision: number;
  secret_blob: Buffer; expires_at: string | null; created_at: string; updated_at: string;
}
