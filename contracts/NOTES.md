# Контракт: примечания к p13–p17

Проверка p13: `.d.ts` вне `rootDir` принимается обеими сборками TypeScript (сервер и Electron). Контракт не создаёт JavaScript. Самостоятельная проверка использует только ES2022, `types: []` и `skipLibCheck: false`.

Форма записи: ключ карты — полный `METHOD /api/path`, включая параметры родительского Router. `Endpoint<Key, Body, Reply, Query, Kind, Event>` содержит `params`, `query`, `body`, `response`, `kind` и `event`. `never` означает отсутствие тела запроса, `void` — отсутствие JSON-ответа; `kind` отличает JSON, 204 (`empty`), NDJSON и файлы. Общая ошибка — `ApiError`. Для NDJSON указан тип события, для файлов типы Node в контракт не попадают.

Описаны 306 уникальных ключей из 307 существующих регистраций в HTTP routes и server.ts, включая развёрнутые регистрации в циклах и SPA fallback `GET *`. Два обработчика `POST /api/projects/:projectId/tasks/:taskId/reopen` уже существуют: первым подключён workRouter, его контракт и использован. Второй обработчик в orchestrator.ts остаётся без изменения; при последующей миграции маршрутов нужно учесть эту коллизию.

Контракт описывает ответы сервера. Обнаруженные расхождения для последующего шага API по фичам:

- Список планов содержит записи без вычисленных `steps`, latest/save возвращают их со `steps`.
- Создание/изменение/перестановка разделов анализа возвращает запись без `files`; список и чтение раздела добавляют `files`. Файлы передаются без серверного `Buffer`.
- Создание поручения подтверждается `{ task }` с кодом 202 до подготовки сессии, а поручение по влитой работе возвращает `{ task, session }`.
- `GET …/check` возвращает изменения вида `{ file, diff }[]`; это отдельный `WorkCheck`, а не список `GitChange`.
- `PUT …/branch-review/:id/context` передаёт Promise в `res.json` без await: фактически отправляется `{}`. Исправление поведения не входит в эти шаги.
- Ответ создания/обновления МР — полный `MergeRequest`; поля `MrPreview`, унаследованные от `CreateMergeRequest`, могут отсутствовать. Клиентское чтение reviewer_ids учитывает отсутствие массива.
- Сетевые `FinishOptions` содержат необязательные настройки; заполненные значения формы описаны отдельно как `FinishFormOptions`.

`server/models` сохраняет серверные `PlanFrontmatter`, `IntegrationSessionRow` и адаптации хранения `Plan`, `AnalysisSection`, `AnalysisFile`; общие сущности реэкспортируются из контракта. Временные реэкспорты типов в фичах сохраняют совместимость их публичных импортов. JSON-значения произвольных настроек и метаданных представлены `JsonValue`/`unknown`; это не подмена известных полей API на any.

Проверки помощника: отрицательные примеры в `typed-route.type-test.ts` входят в серверный typecheck; отдельные тесты проверяют регистрацию путей, передачу ошибок Express и NDJSON с сохранением backpressure. Серверные тесты work по плану запускает разработчик.

## Server registration migration (p18–p22)

All HTTP endpoints use typedRoutes; check:routes compares literal registrations and response kinds against the maps and rejects duplicate, missing and untyped routes. The SPA fallback and health endpoint use the existing settings map. The legacy orchestrator reopen handler was unreachable (workRouter is mounted first); its duplicate registration was removed, preserving reopenWork as the active implementation.

Open metadata dictionaries and ACP raw payloads remain unknown, matching the domain/SDK types; consumers must narrow them. Library/project replies reuse domain contracts. Branch review context now awaits setContext and returns the same detail shape as opening a review (previously an unresolved Promise was serialized as {}).

ElectronAPI is generic over the host File type so declaration-only contracts do not depend on DOM globals; preload and the browser adapter use ElectronAPI<File>.
