import { DocsSelection } from '../../models/integrations';
export interface LinkPattern { pattern: string; id_group?: number; title_group?: number; scope_group?: number }
export interface Fields {
  id: string; title: string; body: string; version?: string; parent?: string; ancestors?: string;
  url?: string; updated?: string; space?: string; author?: string;
}
export interface Pagination {
  mode: 'offset' | 'next'; limit?: number; offset_parameter?: string; limit_parameter?: string;
  next_path?: string; total_path?: string;
}
export interface CollectionEndpoint { endpoint: string; items_path: string; pagination?: Pagination }
export interface ElementValue { selector?: string; attribute?: string }
export interface ConversionRule {
  selector: string; action: 'code' | 'callout' | 'unwrap' | 'skip' | 'unknown';
  content?: ElementValue; parameter?: ElementValue; label?: string;
}
export interface DocsSourceConfig {
  document_endpoint: string; metadata_endpoint?: string; document_path?: string; metadata_path?: string;
  children?: CollectionEndpoint; lookup?: CollectionEndpoint;
  fields: Fields; link_patterns: LinkPattern[]; internal_link_patterns?: LinkPattern[];
  original_url?: string; body_format: 'html' | 'markdown'; conversion_rules?: ConversionRule[];
}
export interface DocsNode {
  id: string; title: string; parent?: string; ancestors?: string[]; version?: string;
  url: string; updated?: string; space?: string; author?: string; body?: string;
}
export interface Diagnostics { urls: string[]; fields: Record<string, unknown>; missing: string[]; preview: string; warnings: string[] }
export interface SourceReply { status: number; body: string; url: string; headers?: Headers }
export type SourceRequest = (relativePath: string, signal?: AbortSignal) => Promise<SourceReply>;
export interface SyncProgress { stage: 'discover' | 'download' | 'done'; found: number; downloaded: number; processed?: number; total?: number }
export interface DocsSyncStats { found: number; downloaded: number; added: number; updated: number; deleted: number; errors: number }
export interface ManifestEntry { node: DocsNode; path: string; hash: string; body: string }
export interface DocsManifest { format: 1; source: string; service_url?: string; synced_at: string; selection: DocsSelection[]; entries: Record<string, ManifestEntry> }
export interface SyncResult { stats: DocsSyncStats; warnings: string[]; manifest: DocsManifest }
export interface SyncOptions { signal?: AbortSignal; confirmed_large?: boolean; concurrency?: number; onProgress?: (progress: SyncProgress) => void }
export class DocsSourceError extends Error {
  constructor(message: string, public readonly code = 'validation') { super(message); }
}
export class ConfirmationRequired extends DocsSourceError {
  constructor(public readonly count: number, public readonly found = count) { super(`${count} documents require downloading out of ${found}; confirmation is required above 500 downloads`, 'confirmation_required'); }
}
