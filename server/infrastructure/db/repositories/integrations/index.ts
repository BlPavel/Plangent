import { getDb } from '../../schema';

export const listOrganizationsIntegrationOrganizations = (...params: unknown[]) => getDb().prepare('SELECT * FROM integration_organizations ORDER BY name').all(...params);
export const getOrganizationIntegrationOrganizations = (...params: unknown[]) => getDb().prepare('SELECT * FROM integration_organizations WHERE id=?').get(...params);
export const saveOrganizationIntegrationOrganizations = (...params: unknown[]) => getDb().prepare(`INSERT INTO integration_organizations(id,name,credential_id) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, credential_id=excluded.credential_id, updated_at=datetime('now')`).run(...params);
export const credentialRowIntegrationCredentials = (...params: unknown[]) => getDb().prepare('SELECT * FROM integration_credentials WHERE id=?').get(...params);
export const listCredentialsIntegrationCredentials = (...params: unknown[]) => getDb().prepare(`SELECT * FROM integration_credentials WHERE id NOT IN (SELECT credential_id FROM integration_connections WHERE credential_mode='own' AND credential_id IS NOT NULL) ORDER BY name`).all(...params);
export const saveCredentialIntegrationCredentials = (...params: unknown[]) => getDb().prepare(`INSERT INTO integration_credentials(id,organization_id,name,username) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, username=excluded.username, updated_at=datetime('now')`).run(...params);
export const saveCredentialIntegrationCredentials2 = (...params: unknown[]) => getDb().prepare(`UPDATE integration_credentials SET revision=revision+1, status='needs_update' WHERE id=?`).run(...params);
export const invalidateConnectionIntegrationSessions = (...params: unknown[]) => getDb().prepare('DELETE FROM integration_sessions WHERE connection_id=?').run(...params);
export const invalidateConnectionIntegrationConnections = (...params: unknown[]) => getDb().prepare(`UPDATE integration_connections SET last_check_status='unchecked',last_check_at=NULL,last_check_message='' WHERE id=?`).run(...params);
export const invalidateCredentialIntegrationSessions = (...params: unknown[]) => getDb().prepare('DELETE FROM integration_sessions WHERE credential_id=?').run(...params);
export const setPasswordIntegrationCredentials = (...params: unknown[]) => getDb().prepare(`UPDATE integration_credentials SET secret_blob=?,status='ready',revision=revision+1,updated_at=datetime('now') WHERE id=?`).run(...params);
/** A stale HTTP request must never invalidate a freshly changed credential. */
export const markCredentialNeedsUpdateIfRevisionMatches = (id: string, revision: number): boolean =>
  getDb().prepare(`UPDATE integration_credentials SET status='needs_update' WHERE id=? AND revision=?`).run(id, revision).changes > 0;
export const markNeedsUpdateIntegrationConnections = (...params: unknown[]) => getDb().prepare(`UPDATE integration_connections SET last_check_status='needs_update' WHERE id=?`).run(...params);
export const getConnectionIntegrationConnections = (...params: unknown[]) => getDb().prepare('SELECT * FROM integration_connections WHERE id=?').get(...params);
export const listConnectionsIntegrationConnections = (...params: unknown[]) => getDb().prepare('SELECT * FROM integration_connections ORDER BY name').all(...params);
export const saveConnectionIntegrationConnections = (...params: unknown[]) => getDb().prepare(`INSERT INTO integration_connections(id,name,base_url,organization_id,credential_mode,credential_id,auth_strategy,auth_config) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url,organization_id=excluded.organization_id,credential_mode=excluded.credential_mode,credential_id=excluded.credential_id,auth_strategy=excluded.auth_strategy,auth_config=excluded.auth_config,updated_at=datetime('now')`).run(...params);
export const saveConnectionIntegrationConnections2 = (...params: unknown[]) => getDb().prepare('UPDATE integration_connections SET code_host=? WHERE id=?').run(...params);
export const saveConnectionIntegrationCredentials = (...params: unknown[]) => getDb().prepare('DELETE FROM integration_credentials WHERE id=?').run(...params);
export const deleteConnectionProjects = (...params: unknown[]) => getDb().prepare('SELECT 1 FROM projects WHERE connection_id=?').get(...params);
export const deleteConnectionIntegrationConnections = (...params: unknown[]) => getDb().prepare('DELETE FROM integration_connections WHERE id=?').run(...params);
export const deleteConnectionIntegrationCredentials = (...params: unknown[]) => getDb().prepare('DELETE FROM integration_credentials WHERE id=?').run(...params);
export const deleteCredentialIntegrationCredentials = (...params: unknown[]) => getDb().prepare('DELETE FROM integration_credentials WHERE id=?').run(...params);
export const deleteOrganizationIntegrationOrganizations = (...params: unknown[]) => getDb().prepare('DELETE FROM integration_organizations WHERE id=?').run(...params);
