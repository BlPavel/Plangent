import type Database from 'better-sqlite3';
import { getDb } from '../../../schema';
import * as queries from './index';
import { createPlanReviewStore } from '../plan';

export function createPlanReviewRepository(db: Database.Database = getDb()) {
  return {
    identity: db as object,
    store: createPlanReviewStore(db),
    transaction: <T>(work: () => T): T => db.transaction(work)(),
    taskSelectTasks: (...params: unknown[]) => queries.taskSelectTasks(db).get(...params),
    currentSelectPlans: (...params: unknown[]) => queries.currentSelectPlans(db).get(...params),
    currentSelectMaterials: (...params: unknown[]) => queries.currentSelectMaterials(db).get(...params),
    readySelectPreparationMarks: (...params: unknown[]) => queries.readySelectPreparationMarks(db).get(...params),
    hasQueueSelectSqliteMaster: (...params: unknown[]) => queries.hasQueueSelectSqliteMaster(db).get(...params),
    queueSelectTaskQueues: (...params: unknown[]) => queries.queueSelectTaskQueues(db).get(...params),
    sentUpdatePlanReviewMessages: (...params: unknown[]) => queries.sentUpdatePlanReviewMessages(db).run(...params),
    deliveredUpdatePlanReviewMessages: (...params: unknown[]) => queries.deliveredUpdatePlanReviewMessages(db).run(...params),
  };
}
