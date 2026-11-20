# Server testing

Run commands from the repository root:

- `npm run lint`: layer boundaries, public imports and SQL placement.
- `npm run typecheck`: contracts, server, client and Electron types.
- `npm run check:routes`: HTTP registrations against contracts.
- `npm test`: server unit/integration tests, including colocated tests.
- `npm run test:client`: client tests in `client/tests/`.
- `npm run build`: server compilation, runtime assets and client build.

`server/tests/<domain>/` holds integration tests. `server/tests/support/` supplies
isolated databases, temporary Git repositories and a mock ACP agent.
Use these helpers instead of real user data or network accounts. Test observable
behavior, ownership, cancellation and migration compatibility.
Colocated tests cover local policies and the MCP registry.

The test command preloads `server/tests/support/environment.cjs`.
It isolates both the database directory and OS temporary files for every worker,
including command logs, so tests cannot clear logs of the hosting Plangent process.
Native modules must match the Node ABI; tests do not rebuild them.
Electron packaging rebuilds native modules for Electron, so use typecheck/build
for ordinary verification. Platform vault behavior needs release smoke tests
on each supported OS. See [build instructions](../BUILD.md).

## Карта покрытия перед переносом на Rust

Карта составлена по утверждениям в существующих тестах. Ссылка ведёт к проверке
указанного поведения. «Пробел» обозначает сценарий или уровень проверки, которого
пока не хватает. В первую очередь закрываются пробелы, связанные с потерей данных
и неверным состоянием после прерывания или повтора.

### Наборы для повторной проверки (p2–p8)

Эта таблица даёт краткий выбор набора; подробная карта ниже описывает текущее покрытие p2–p8.

| Модуль | Входы и проверки |
| --- | --- |
| Файлы и поиск | [Примеры дерева и запросов](../../tests/fixtures/files/search.json), [проверка правил и временного дерева](../../server/tests/files/files-search-watcher.test.ts#L41), [HTTP и WebSocket](../../server/tests/git/repo/http.test.ts#L12). |
| Состояния плана, ревью и работы | [Таблица переходов](../../tests/fixtures/transitions.json), проверки [плана](../../server/core/preparation/plans.test.ts#L70), [ревью](../../server/core/review/kernel/kernel.test.ts#L23) и [работы](../../server/core/work/state.test.ts#L11). |
| Хранение и восстановление | [Миграция задачи и повторное открытие SQLite](../../server/tests/db/legacy-task.test.ts#L8), [завершение и повтор Git-операции](../../server/tests/git/finish/finish.test.ts#L9), [восстановление после ошибок](../../server/tests/git/finish/finish-recovery.test.ts#L9). |
| Десктопный интерфейс | [Правила поиска](../../client/tests/code-search.test.cjs#L25), [смонтированный экран поиска](../../client/tests/preparation-ui.test.cjs#L163), [черновики](../../client/tests/preparation-ui.test.cjs#L232), [ошибка сохранения](../../client/tests/preparation-ui.test.cjs#L352), [мост Electron](../../client/tests/electron-bridge.test.cjs#L44). |
| Агентские сессии и внешние адаптеры | [ACP](../../server/tests/agents/sessions/integration.test.ts#L8), [восстановление процесса](../../server/tests/agents/sessions/shared-process.test.ts#L9), [роли MCP](../../server/api/mcp/registry.test.ts#L8), [интеграции](../../server/tests/integrations/integrations.test.ts#L12), [GitHub](../../server/tests/git/hosts/github/github.test.ts#L24) и [GitLab](../../server/tests/git/hosts/gitlab/gitlab.test.ts#L25). |

### Как повторить проверку после переноса

1. Выберите модуль по таблице. Для исходной проверки файлов и поиска запустите из корня `npm exec -- tsx --test --require ./server/tests/support/environment.cjs server/tests/files/files-search-watcher.test.ts server/tests/git/repo/http.test.ts`.
2. Подайте новой реализации те же запросы из `tests/fixtures/files/search.json` на временном дереве из того же примера. Сохраните содержимое файлов побайтово, включая CRLF и бинарные данные. Сравните относительные пути, номера строк и текст совпадений, счётчики `done` и гарантированный порядок событий по утверждениям исходных тестов.
3. Повторите действия с побочными эффектами на внешней границе. Измените файл в подписанном проекте, дождитесь `code:changed`, снимите подписку и проверьте прекращение доставки. Повторите отмену при чтении потока и проверку лимитов из серверного набора. Сравните результаты с исходными утверждениями при одинаковых начальных условиях.
4. После совпадения результатов модуля повторите `npm test`, `npm run test:client`, `npm run typecheck` и `npm run check:routes` для затронутой системы.

### Исходный прогон (p9)

20 ноября 2026, Windows x64, Node.js 22.14.0 (ABI 127).

| Проверка | Результат | Журнал Plangent |
| --- | --- | --- |
| Файлы и поиск, отдельный прогон по команде выше | 10 из 10 прошли. | `97c5c8d3` |
| `npm test` | 274 прошли, 3 упали, 2 пропущены. Два сбоя в `git-projects.test.ts` (источник настройки и имя ветки), один в `instruction-guide.test.ts` (выбор уровня инструкции). | `1a98bf19` |
| `npm run test:client` | 177 прошли, 4 упали. Сбои в индикаторе расхода, моках `SuggestMenu` и `useMentionFiles`, загрузке `@core/api/endpoint` и вызове `events.onWorkEvent`. | `002f6e75` |
| `npm run typecheck` | Код выхода 0. | `83469936` |
| `npm run check:routes` | Все 296 маршрутов соответствуют контракту. | `aac83a78` |

Для сравнения переноса файлов и поиска используйте успешный отдельный прогон.
Приведённые выше полные прогоны были первичными наблюдениями; происхождение
сбоев проверено сравнением ниже.

#### Сравнение с базовым коммитом задачи

База задачи — `b99f7b2cd70bb20e5bd9d6cd67fb473c3d084d28`. 20 ноября 2026
база выгружена через `git archive` в отдельный каталог и запущена с теми же
Node.js 22.14.0 (ABI 127), Windows x64 и `node_modules`, что и текущие изменения.
Наборы запускались последовательно с `--test-concurrency=2`. Первые попытки
одновременных полных прогонов исчерпали память Node/esbuild; они исключены из
сравнения. Команды ниже проверяют те же файлы, что npm-скрипты, ограничивая число
тестовых процессов:

```sh
node node_modules/tsx/dist/cli.mjs --test --test-concurrency=2 --require ./server/tests/support/environment.cjs "server/**/*.test.ts"
node --test --test-concurrency=2 "client/tests/*.test.cjs"
```

| Набор | База задачи | Текущие изменения | Журналы Plangent (база / текущие) |
| --- | --- | --- | --- |
| Сервер | 261 прошли, 9 упали, 2 пропущены (разбор ниже) | 274 прошли, 3 исходных сбоя, 2 пропущены | `e845f940` / `b11b1dd4` |
| Клиент | 155 прошли, 4 упали | 177 прошли, те же 4 упали | `6c20f91b` / `9d82768e` |

Ожидаемые исходные серверные сбои из первичного прогона также воспроизводятся на базе:

| Файл | Точное имя теста | Причина на базе |
| --- | --- | --- |
| [git-projects.test.ts](../../server/tests/projects/git-projects.test.ts#L21) | `git settings: per-field provenance, false/empty overrides, regex validation and defaults` | Получен источник `default`, ожидался `group`. |
| [git-projects.test.ts](../../server/tests/projects/git-projects.test.ts#L37) | `project storage, clone conflicts/cleanup, busy guards and HTTP commit validation` | Получено пустое имя ветки, ожидалось `main` (утверждение на строке 68). |
| [instruction-guide.test.ts](../../server/tests/projects/instruction-guide.test.ts#L9) | `instruction guides resolve the closest enabled level and expose defaults` | `false == true` в проверке уровня инструкции (строка 50). |

Полный серверный прогон базы (`e845f940`) дал 261 прошедший, 9 упавших и
2 пропущенных теста. Помимо трёх строк выше, на базе падают пять ACP-сценариев,
для которых в этой задаче исправлены фикстуры: они теперь учитывают служебный
блок маршрутизации инструментов в prompt.
В текущем полном прогоне все пять сценариев проходят; остаются только три
исходных серверных сбоя с теми же именами и причинами.

| Файл | Точное имя теста, упавшего на базе |
| --- | --- |
| [deletion.test.ts](../../server/tests/agents/deletion.test.ts) | `deletion refuses active work, closes idle sessions and preserves chats for another agent` |
| [idle-policy.test.ts](../../server/tests/agents/sessions/idle-policy.test.ts) | `idle processes stop after the turn, resume with load, and restart unsupported adapters with a notice` |
| [integration.test.ts](../../server/tests/agents/sessions/integration.test.ts) | `stdio ACP lifecycle persists coalesced messages, serializes queue, resolves permissions and loads sessions` |
| [shared-process.test.ts](../../server/tests/agents/sessions/shared-process.test.ts) | `shared chat lifecycle isolates permissions, idle release, close during a turn and restoration` |
| [workspace-context.test.ts](../../server/tests/agents/sessions/workspace-context.test.ts) | `ACP supplies reference sources only on explicit mention, with no discovery tool or legacy visibility` |

Девятый сбой базы — `task baseline captures HEAD once, resets explicitly and
stays empty without git`: архив не содержит `.git`, и тест требует checkout
в `process.cwd()`. Повторный запуск **базового файла** из рабочего checkout
прошёл (1/1, `108706ed`); это ограничение архивной копии, а не исходный дефект.
Команда повтора из корня рабочего репозитория:

```sh
node node_modules/tsx/dist/cli.mjs --test --require ./server/tests/support/environment.cjs .plangent/review-baseline-b99f7b2/server/tests/tasks/task-base-commit.test.ts
```

Ожидаемые исходные клиентские сбои (имена и причины совпадают на базе и с изменениями):

| Файл | Точное имя теста | Причина |
| --- | --- | --- |
| [code-item-card.test.cjs](../../client/tests/code-item-card.test.cjs#L291) | `shared usage meter shows session context and account limits with details below the review header` | Не найден `.usage-below`. |
| [task-review-ui.test.cjs](../../client/tests/task-review-ui.test.cjs#L68) | `review queue UI adds, groups, configures and opens results; Code labels and removes agent drafts` | В `mock:@features/agent-chat` отсутствуют `SuggestMenu` и `useMentionFiles`. |
| [work-client.test.cjs](../../client/tests/work-client.test.cjs#L16) | `code, review, Git, finish and task clients preserve query and cancellation while scoping requests` | `Cannot find module '@core/api/endpoint'`. |
| [work-client.test.cjs](../../client/tests/work-client.test.cjs#L45) | `workspace subscriptions have independent reference counts, reconnect and typed events` | `events.onWorkEvent is not a function`. |

Новых сбоев относительно базы в полных наборах не обнаружено. При повторной
проверке переноса сравнивайте точные имена и причины, а не только число падений:
три исходных серверных и четыре клиентских сбоя пока ожидаемы. Изменённый набор
`preparation-ui.test.cjs` отдельно прошёл 20/20 (`b046d98b`).

### Данные, восстановление и переходы (p6, p7)

| Сценарий | Что покрыто и чего не хватает |
| --- | --- |
| Чтение старой задачи, связи после миграции и повторное открытие SQLite | `legacy task and its plan survive migration and reopening on disk` создаёт прежнюю схему на диске и дважды читает задачу, связанный план и перенесённое описание через публичные операции, закрывая SQLite между чтениями; проверяет внешние ключи. `workspace migration on fresh and existing databases` проверяет рабочий каталог и ограничения. `review table rename and run removal preserve sessions, threads and messages and are idempotent` проверяет связи и сообщения при двукратной миграции. [Старая задача](../../server/tests/db/legacy-task.test.ts#L8), [рабочие каталоги](../../server/tests/workspaces/workspaces.test.ts#L12), [ревью](../../server/tests/db/refactor-migrations.test.ts#L8). |
| Завершение работы, конфликт и повтор | `finish commits → manual merge → confirmation → bare remote; recovery and safety` проверяет завершение, откат с сохранением файла, отказ при изменившемся HEAD и повтор после ошибки push. `finish recovers from rejected commits, rewriting hooks, changed files and lost tasks` проверяет отказ запуска при merge-конфликте без изменения файла и создания активного завершения; после остановки агента выполняет `revise`, создание коммита и подтверждение, затем читает `complete`, один итоговый коммит и чистую рабочую копию. Также проверяет повтор после отказа хука и сохранение внешних правок. `developer merge/rebase: detection, blocked writes, agent tools, edit scope and closing` покрывает отдельный merge. [Завершение](../../server/tests/git/finish/finish.test.ts#L9), [отказ при конфликте](../../server/tests/git/finish/finish-recovery.test.ts#L32), [повтор после остановки](../../server/tests/git/finish/finish-recovery.test.ts#L135), [конфликт Git](../../server/tests/git/conflicts/conflicts.test.ts#L9). |
| Восстановление рабочего каталога | `lost folders and interrupted preparation become recoverable failures` проверяет ошибку после прерывания подготовки, доступность пересоздания и сохранение ветки при восстановлении потерянного каталога. `a half-removed folder no longer blocks removal and recreation` проверяет повтор после частичного удаления и очистку остатков. [Восстановление работы](../../server/tests/workspaces/work-lifecycle.test.ts#L109), [повтор после частичного удаления](../../server/tests/workspaces/workspaces.test.ts#L120). |
| Правила плана и сохранение идентификаторов | `manual plan creation and edits persist selectable step ids before notifying consumers` проверяет ID, завершение, пустой план и повтор без лишнего события. `numbering is idempotent for existing ids with extra whitespace` проверяет идемпотентность. `step completion only changes an existing checkbox` использует таблицу: установка и снятие отметки существующего шага, отсутствующий шаг и строка без checkbox. `plan author survives materialization, startup and completion; manual saves clear the session` после ручной перестановки и добавления шага повторно читает весь набор ID и флагов из SQLite (`p2`, `p1`, `p3`), автора и сброс сессии. [Правки](../../server/core/preparation/plans.test.ts#L39), [нумерация](../../server/core/preparation/plans.test.ts#L61), [переходы](../../server/core/preparation/plans.test.ts#L70), [интеграция](../../server/tests/preparation/plan-author.test.ts#L7), [общие примеры](../../tests/fixtures/transitions.json). |
| Ядро ревью и сохранённое решение | `review variants restrict reply kinds and require nonempty text` проверяет допустимые и недопустимые ответы. `a reported review cannot start again until its owner creates a new cycle` по общей таблице проверяет запуск, отчёт, отклонённый повторный старт и новый цикл. `real plan saves drive subscription, including deleted/reused ids; HTTP enforces scope and origin` повторно читает решение `applied`, проверяет устаревшие ссылки и HTTP 400 для недопустимого решения. [Ответы](../../server/core/review/kernel/kernel.test.ts#L5), [переходы](../../server/core/review/kernel/kernel.test.ts#L23), [сохранение](../../server/tests/review/plan/integration.test.ts#L9), [общие примеры](../../tests/fixtures/transitions.json). |
| Состояние работы и остановка выполнения | `queue transitions preserve execution while steps are open and gate verification` использует общие примеры переходов; `work state: stage, group and primary action across lifecycle and precedence` проверяет приоритет состояний. `queue prepares workspace before execution, reruns reuse it` останавливает очередь и через `workEntry` читает задачу `in_progress`, этап `execution`, ноль завершённых шагов и доступность проверки. `A cancelled completion turn does not start review or mark work done` проверяет отмену и незавершённость после следующего сообщения; ACP-набор повторно читает остановленные сессии. [Переходы](../../server/core/work/state.test.ts#L11), [общие примеры](../../tests/fixtures/transitions.json), [состояние после остановки](../../server/tests/workspaces/execution.test.ts#L99), [отмена и ошибка](../../server/tests/workspaces/execution.test.ts#L321), [сессии](../../server/tests/agents/sessions/integration.test.ts#L189). |

### Файлы и экран «Код» (p2, p3)

| Сценарий | Что покрыто и чего не хватает |
| --- | --- |
| Временное дерево и поиск | `portable file and search examples on a temporary repository` проверяет общие JSON-примеры сначала без Git, затем с Git: CRLF, Unicode в пути и тексте, игнорируемый и бинарный файл, точные совпадения и пустой `done`. `search pattern handles literal punctuation, case and whole-word boundaries` отдельно проверяет правила шаблона. Существующие тесты дерева и Git-поиска проверяют типы файлов, ограничения путей, маски и недопустимый шаблон. [Переносимые примеры](../../tests/fixtures/files/search.json), [правила](../../server/tests/files/files-search-watcher.test.ts#L41), [общее дерево](../../server/tests/files/files-search-watcher.test.ts#L56), [чтение](../../server/tests/files/files-search-watcher.test.ts#L80), [поиск Git](../../server/tests/files/files-search-watcher.test.ts#L104). |
| Границы выдачи, отмена и повторное чтение | `Node fallback searches without git and bounds matches and files` и `Git streaming limits and cancellation while consuming results` проверяют лимиты и `AbortError` до поиска и после первого результата. `watched roots reuse Git snapshots until a file event; unwatched roots read Git every time` проверяет появление нового пути после сброса снимка событием. [Поиск без Git](../../server/tests/files/files-search-watcher.test.ts#L121), [поток Git](../../server/tests/files/files-search-watcher.test.ts#L134), [повторное чтение](../../server/tests/files/files-search-watcher.test.ts#L172). |
| Внешний HTTP и WebSocket | `code HTTP contract and events subscription on a real repository` использует примеры p2: выдача файлов и чтение Unicode/CRLF, точные поля NDJSON-совпадений и `done`, включая пустую выдачу; также проверяет 400 для недопустимого пути, 404 для отсутствующего файла, повторную подписку, `code:changed`, снятие подписки и ошибку подписки. [HTTP и подписка](../../server/tests/git/repo/http.test.ts#L12), [примеры](../../tests/fixtures/files/search.json). |

### Десктопный интерфейс и мост Electron (p4, p5)

| Сценарий | Что покрыто и чего не хватает |
| --- | --- |
| Ранжирование файлов и поиск в строке | Табличные `fuzzy file ranking for …` проверяют приоритет имени, отсутствие совпадений и пустой ввод; `line search: …` — смещения, регистр, границы слова и regex. `line search rejects invalid regex and accepts empty input without a pattern` проверяет ошибку и пустой ввод. [Ранжирование](../../client/tests/code-search.test.cjs#L25), [строки](../../client/tests/code-search.test.cjs#L37), [ошибка и пустой ввод](../../client/tests/code-search.test.cjs#L45). |
| Активная вкладка, открытие результата и поиск после пустой выдачи | `main file tabs remember modes and neighbours independently of the side panel and other folders` и таблица `active tab after closing …` проверяют выбор соседней вкладки. `main screen restores tabs, opens search lines, closes missing files and keeps closed tabs closed on revisit` проверяет восстановление и закрытие. `project search recovers from an empty stream, opens a matching line and updates its status on a file event` монтирует CodeTab: пустая выдача → успешный поиск → клик через рабочий обработчик → активная вкладка в DOM, файл и переход к строке 7 на границе CodeView. `search cancellation suppresses old results and incomplete streams produce an error` проверяет отмену и ошибку потока. [Вкладки](../../client/tests/code-client.test.cjs#L98), [таблица](../../client/tests/code-client.test.cjs#L128), [восстановление](../../client/tests/code-client.test.cjs#L157), [смонтированный экран](../../client/tests/preparation-ui.test.cjs#L163), [отмена](../../client/tests/code-client.test.cjs#L293). |
| Возврат к черновику, изоляция и ошибка сохранения | `plan editor retains its source version across remounts; taking latest and cancel work` проверяет текст, версию, загрузку актуальной версии и отмену; таблица `document draft after … with a newer source` — публичные результаты правил черновиков. `task document editors restore both independent drafts after switching tasks` монтирует MaterialPanel и проверяет оба текста при A → B → A → B. `switching chats and projects keeps each draft separate, including reused components` покрывает чаты. `MaterialPanel preserves rejected edits, reloads a new version and retries with its version` проверяет видимую ошибку 409, сохранение текста и успешный повтор. [Версия](../../client/tests/drafts.test.cjs#L75), [таблица](../../client/tests/drafts.test.cjs#L93), [два черновика](../../client/tests/preparation-ui.test.cjs#L232), [чаты](../../client/tests/chat-drafts.test.cjs#L148), [ошибка и повтор](../../client/tests/preparation-ui.test.cjs#L352). |
| Видимый статус по событию | `project search recovers from an empty stream, opens a matching line and updates its status on a file event` после `code:changed` и обновления списка файлов проверяет новый счётчик в DOM. `review session completion clears stale busy state and lets a queued discussion be sent` проверяет состояние стора, чужую сессию и отправку. `workspace subscriptions have independent reference counts, reconnect and typed events` покрывает доставку и переподписку. [DOM после события](../../client/tests/preparation-ui.test.cjs#L163), [стор](../../client/tests/code-client.test.cjs#L579), [доставка](../../client/tests/work-client.test.cjs#L45). |
| Выбор папки, отмена и передача пути файла | `folder picker passes the default path and returns selection or cancellation` проверяет адаптер вместе с настоящим preload: начальный путь, результат и `null` при отмене. `file path lookup forwards the original file and normalizes an empty path` проверяет исходный объект File в webUtils, путь и преобразование пустого пути в `null`. [Папка](../../client/tests/electron-bridge.test.cjs#L44), [путь файла](../../client/tests/electron-bridge.test.cjs#L56). |
| Пустой буфер изображения, уведомление и обновление | `empty native clipboard image is returned as null`, `notification target crosses the bridge in both directions` и `update state is returned on request and forwarded on change` проверяют адаптер вместе с preload: `null` от IPC, цель уведомления и обратного события, запрос состояния обновления и последующее событие. `review completion notifications use the existing channels, link to Code and ignore repeats or cancellations` покрывает фильтрацию повторов и отмен. Остался пробел вне границы preload: вызов Electron main с `image.isEmpty()` и само преобразование пустого изображения в `null`. [Буфер](../../client/tests/electron-bridge.test.cjs#L65), [уведомления](../../client/tests/electron-bridge.test.cjs#L72), [обновление](../../client/tests/electron-bridge.test.cjs#L86), [main](../../electron/main.ts#L157), [фильтрация](../../client/tests/code-client.test.cjs#L634). |

### Агентские сессии, MCP и внешние сервисы (p8)

| Сценарий | Что покрыто и чего не хватает |
| --- | --- |
| ACP отвечает, отменяется, завершается во время ожидания и восстанавливается | `stdio ACP lifecycle persists coalesced messages, serializes queue, resolves permissions and loads sessions` проверяет результат двух ходов, порядок, отмену и очистку разрешений. `shared chat lifecycle isolates permissions, idle release, close during a turn and restoration` проверяет падение процесса при активных сессиях, состояние `error`, очистку ожиданий и ответ после перезапуска. Тест пула `a failed session start leaves siblings working; process death reports all owners and next acquire starts fresh` отдельно проверяет отклонение ожидающего запроса. [Ответ и отмена](../../server/tests/agents/sessions/integration.test.ts#L8), [падение и восстановление](../../server/tests/agents/sessions/shared-process.test.ts#L9), [ожидающий запрос](../../server/infrastructure/acp/pool.test.ts#L81). |
| Матрица роль–действие MCP | `module registry preserves every pre-refactoring role tool list and order` фиксирует полные списки инструментов реестра, включая отсутствующие в каждой роли инструменты. `stdio ACP lifecycle persists coalesced messages, serializes queue, resolves permissions and loads sessions` дополнительно проверяет разрешённый вызов, отказ без авторизации, отказ для недоступного инструмента и ограничения по роли и проекту. Пробел на уровне исполнения — эти примеры вызовов подтверждают отдельные роли и действия. [Реестр](../../server/api/mcp/registry.test.ts#L8), [авторизация вызова](../../server/tests/agents/sessions/integration.test.ts#L83). |
| Очередь терминальных команд | `reports exit code and output, and frees the slot` проверяет успешный результат, ненулевой код и освобождение слота. `queue timeout, run timeout and cancellation are reported separately from exit codes` проверяет различие ошибок ожидания и исполнения и освобождение слота после отмены. `commands beyond the limit wait in order and start when a slot is released` проверяет запуск следующей команды при освобождении. [Результат и ошибка](../../server/infrastructure/terminal/command-runner.test.ts#L9), [отмена](../../server/infrastructure/terminal/command-runner.test.ts#L44), [очередь](../../server/infrastructure/terminal/command-slots.test.ts#L15). |
| Интеграции и адаптеры Git-хостов | `integration domain, configured authentication and HTTP API` на локальном сервере проверяет успех, `forbidden`, недействительные данные и повтор после замены. `provider pagination, search paths, optional APIs and guarded bulk publishing` покрывает пагинацию и старый GitLab. `GitHub: create PR maps to the host contract, reviewers and labels are best effort` проверяет успешный маппинг; `GitHub: a rejected PR creation reaches the caller and skips follow-up requests` — ошибку HTTP 422 у вызывающего кода и отсутствие последующих запросов. `GitLab: merge request creation returns the created MR or propagates a refusal` проверяет успех и передачу отказа HTTP 422. [Интеграции](../../server/tests/integrations/integrations.test.ts#L12), [GitLab создание](../../server/tests/git/hosts/gitlab/gitlab.test.ts#L25), [GitLab пагинация](../../server/tests/git/hosts/gitlab/gitlab.test.ts#L46), [GitHub успех](../../server/tests/git/hosts/github/github.test.ts#L24), [GitHub отказ](../../server/tests/git/hosts/github/github.test.ts#L42). |
