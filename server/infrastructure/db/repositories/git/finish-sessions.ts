import { getDb } from '../../schema';

export const finishSessionsRecords = {
  findActiveSessionFinish: (sessionId: string) => getDb().prepare("SELECT id FROM finish_runs WHERE session_id=? AND status NOT IN ('complete','cancelled')").get(sessionId),
};
