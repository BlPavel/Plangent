import type Database from 'better-sqlite3';
import { getDb } from '../../../schema';
import * as queries from './reviews';
import { createReviewStore } from '../code';

export function createCodeReviewRepository(db: Database.Database = getDb()) {
  return {
    identity: db as object,
    store: createReviewStore(db),
    transaction: <T>(work: () => T): T => db.transaction(work)(),
    rowSelectProjects: (...params: unknown[]) => queries.rowSelectProjects(db).get(...params),
    projectSelectTasks: (...params: unknown[]) => queries.projectSelectTasks(db).get(...params),
    findReadyWorkspaceForProject: (...params: unknown[]) => queries.findReadyWorkspaceForProject(db).get(...params),
    contextUpdateCodeReview: (...params: unknown[]) => queries.contextUpdateCodeReview(db).run(...params),
    contextUpdateCodeReview2: (...params: unknown[]) => queries.contextUpdateCodeReview2(db).run(...params),
    checkOriginSelectTasks: (...params: unknown[]) => queries.checkOriginSelectTasks(db).get(...params),
    taskBaseSelectTasks: (...params: unknown[]) => queries.taskBaseSelectTasks(db).get(...params),
    itemSelectTasks: (...params: unknown[]) => queries.itemSelectTasks(db).get(...params),
    activeSessionsSelectSqliteMaster: (...params: unknown[]) => queries.activeSessionsSelectSqliteMaster(db).get(...params),
    findActiveSession: (...params: unknown[]) => queries.findActiveSession(db).all(...params),
    releaseDeveloperMessagesForRound: (...params: unknown[]) => queries.releaseDeveloperMessagesForRound(db).run(...params),
    stopUpdateAgentSessions: (...params: unknown[]) => queries.stopUpdateAgentSessions(db).run(...params),
    rowSelectAgentSessions: (...params: unknown[]) => queries.rowSelectAgentSessions(db).get(...params),
    rowSelectCodeReviewRound: (...params: unknown[]) => queries.rowSelectCodeReviewRound(db).get(...params),
    sendRoundSelectCodeReviewRound: (...params: unknown[]) => queries.sendRoundSelectCodeReviewRound(db).get(...params),
    renameUntitledSession: (...params: unknown[]) => queries.renameUntitledSession(db).run(...params),
    viewedFilesUpdateCodeReviewFileView: (...params: unknown[]) => queries.viewedFilesUpdateCodeReviewFileView(db).run(...params),
    existsSelectSqliteMaster: (...params: unknown[]) => queries.existsSelectSqliteMaster(db).get(...params),
    eventsSelectAgentSessionEvents: (...params: unknown[]) => queries.eventsSelectAgentSessionEvents(db).all(...params),
    ownedSelectCodeReviewRound: (...params: unknown[]) => queries.ownedSelectCodeReviewRound(db).get(...params),
    sessionTableSelectSqliteMaster: (...params: unknown[]) => queries.sessionTableSelectSqliteMaster(db).get(...params),
    removeReviewSelectAgentSessions: (...params: unknown[]) => queries.removeReviewSelectAgentSessions(db).get(...params),
    removeReviewDeleteAgentSessions: (...params: unknown[]) => queries.removeReviewDeleteAgentSessions(db).run(...params),
  };
}
