import type { IntegrationConnection } from '@contracts';
export interface ResponseRule { statuses?: number[]; redirect_path?: string; header?: { name: string; value: string }; html_instead_of_json?: boolean }
export interface AuthConfig {
  token_header?: string; token_prefix?: string;
  check_details?: { path: string; value_path: string; result_key: 'version' | 'token_expires_at'; label: string }[];
  check_path: string; user_path?: string; expect_json?: boolean; timeout_ms?: number;
  login_path?: string; username_field?: string; password_field?: string;
  fields?: Record<string, string>; headers?: Record<string, string>; strategies?: ('basic' | 'form')[];
  invalid_password?: ResponseRule; invalid_session?: ResponseRule;
}
export interface Cookie { name: string; value: string; path: string; secure: boolean; expires?: number }
export interface AuthSession { id: string; strategy: 'basic' | 'form' | 'token'; cookies: Cookie[] }
export interface AuthContext { connection: IntegrationConnection; credential_id: string; revision: number; username: string; password: string; signature: string; last_url?: string }
