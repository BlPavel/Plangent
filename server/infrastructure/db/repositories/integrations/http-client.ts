import { getDb } from '../../schema';

export const checkConnectionIntegrationConnections = (...params: unknown[]) => getDb().prepare(`UPDATE integration_connections SET last_check_status=?,last_check_at=datetime('now'),last_check_message=? WHERE id=?`).run(...params);
