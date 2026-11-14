import { getDb } from '../../schema';

/** Nested work uses a savepoint; immediate allocation keeps generated keys unique. */
export function transaction<T>(work: () => T, mode: 'deferred' | 'immediate' = 'deferred'): T {
  const operation = getDb().transaction(work);
  return mode === 'immediate' ? operation.immediate() : operation();
}
