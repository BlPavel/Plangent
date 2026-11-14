import { getDb } from '../../schema';

export const rowSelectAppSettings = (...params: unknown[]) => getDb().prepare('SELECT value, updated_at FROM app_settings WHERE key = ?').get(...params);
export const writeSettingInsertAppSettings = (...params: unknown[]) => getDb().prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(...params);
export const rowSelectAppSettings2 = (...params: unknown[]) => getDb().prepare("SELECT value FROM app_settings WHERE key = 'git-settings'").get(...params);
export const saveGlobalGitSettingsInsertAppSettings = (...params: unknown[]) => getDb().prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('git-settings', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(...params);
