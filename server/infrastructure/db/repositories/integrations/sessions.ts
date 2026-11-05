import { getDb } from '../../schema';

export const loadIntegrationSessions = (...params: unknown[]) => getDb().prepare('SELECT * FROM integration_sessions WHERE connection_id=?').get(...params);
export const loadIntegrationSessions2 = (...params: unknown[]) => getDb().prepare('DELETE FROM integration_sessions WHERE connection_id=?').run(...params);
export const saveSessionIntegrationSessions = (...params: unknown[]) => getDb().prepare(`INSERT INTO integration_sessions(connection_id,credential_id,credential_revision,secret_blob) VALUES (?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET credential_id=excluded.credential_id,credential_revision=excluded.credential_revision,secret_blob=excluded.secret_blob,expires_at=NULL,updated_at=datetime('now')`).run(...params);
/** A failed request can clear only the authentication context it actually used. */
export const clearSessionIfCredentialMatches = (connectionId: string, credentialId: string, revision: number): void => {
  getDb().prepare('DELETE FROM integration_sessions WHERE connection_id=? AND credential_id=? AND credential_revision=?')
    .run(connectionId, credentialId, revision);
};
