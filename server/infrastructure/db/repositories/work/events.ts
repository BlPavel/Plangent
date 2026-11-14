import { getDb } from '../../schema';

export const initWorkEventsAppSettings = (...params: unknown[]) => getDb().prepare('SELECT value FROM app_settings WHERE key=?').get(...params);
export const initWorkEventsAppSettings2 = (...params: unknown[]) => getDb().prepare('INSERT INTO app_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(...params);
