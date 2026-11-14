import { getDb } from '../../schema';

export const recoverWorkspacesWorkspaces = (...params: unknown[]) => getDb().prepare("SELECT * FROM workspaces WHERE status<>'removed'").all(...params);
