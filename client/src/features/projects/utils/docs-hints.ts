// All user-facing texts of docs sources: source settings hints, probe, sections, sync and errors.
// The user guide (docs) quotes these, so change them here and keep the guide in step.
import type { SettingField } from '@shared/ui/SettingsFields.vue'
import type { ErrorDictionary } from '@shared/utils/errorText'

export const FORM = {
  type: 'Папка — файлы с диска. Документация — страницы внешнего сервиса, скачанные в markdown: агенты читают их без сети.',
  connection: 'Через какое подключение скачивать: адрес сервиса и вход берутся из него.',
  noConnections: 'Нет подключений. Создайте его в Настройки → Подключения, затем вернитесь сюда.',
  openConnections: 'Открыть подключения',
  presetNote: 'Преднастройка заполняет «Настройки источника»; значения копируются в справочник, их можно поправить. Для незнакомого сервиса заполните их вручную и проверьте «Пробным запросом».',
  noConfig: 'Выберите преднастройку («Заполнить как») или заполните настройки источника вручную.',
  manualSummary: 'Настройки источника',
  manualIntro: 'Как найти и забрать документы. Все пути относительные: они приклеиваются к адресу подключения, итоговый URL показан под полем. {id} в пути заменяется на id документа.',
  json: 'Все настройки одним JSON — для копирования между справочниками. Изменения здесь и в полях выше синхронизированы.',
  jsonInvalid: 'Неверный JSON — исправьте его перед сохранением.',
  afterSave: 'После сохранения нажмите «Обновить» на странице справочника — документы скачаются в markdown.',
}

export const CONNECTION_STATE: Record<string, string> = {
  ok: 'работает',
  error: 'ошибка при последней проверке',
  needs_update: 'нужен новый пароль',
  unchecked: 'не проверялось',
}
export const NEEDS_UPDATE = {
  text: 'Пароль учётной записи этого подключения больше не подходит. Plangent не входит повторно, чтобы не заблокировать учётную запись, — задайте новый пароль: Настройки → Подключения → «Изменить пароль».',
  action: 'Изменить пароль',
}

export const SECTIONS = {
  title: 'Разделы',
  intro: 'Вставьте ссылку на страницу из браузера (или её id) и нажмите «Добавить раздел». Можно скачать одну страницу или её со всеми дочерними; лишние ветки снимаются галочками.',
  input: 'Ссылка на страницу или id документа',
  add: 'Добавить раздел',
  probe: 'Пробный запрос',
  probeHint: 'Пробный запрос скачивает один документ по текущим настройкам и показывает, куда ушли запросы и что извлеклось, — ничего не сохраняет.',
  empty: 'Разделов пока нет — синхронизировать нечего.',
  withChildren: 'Со всеми дочерними страницами',
  noTree: 'Дочерние документы не настроены: раздел скачивается как одна страница.',
  showTree: 'Показать дочерние страницы',
  hideTree: 'Скрыть дочерние страницы',
  treeHint: 'Снимите галочку, чтобы не скачивать страницу и всё, что под ней.',
  excluded: 'Исключены',
  restore: 'Вернуть',
  remove: 'Убрать раздел',
  noChildren: 'Дочерних страниц нет.',
  loading: 'Загрузка…',
  retry: 'Повторить',
}

export const PROBE = {
  urls: 'Запросы',
  fields: 'Извлечённые поля',
  missing: 'не найдено по пути',
  preview: 'Начало текста в markdown',
  emptyPreview: 'Текст пуст или поле текста не найдено.',
  ok: 'Документ получен.',
}

/** Names of `fields.*` for the probe table and the field labels. */
export const FIELD_LABELS: Record<string, string> = {
  id: 'id', title: 'Заголовок', body: 'Текст', version: 'Версия', parent: 'Родитель', ancestors: 'Предки',
  url: 'Ссылка на оригинал', updated: 'Дата изменения', space: 'Пространство', author: 'Автор',
}

const OPEN_IN_BROWSER = 'Откройте итоговый URL в браузере, где вы уже вошли в сервис: должен открыться JSON.'
const PROBE_FIELDS = 'Нажмите «Пробный запрос» — в результате видно, какие поля нашлись. Чтобы увидеть ответ целиком, ' + OPEN_IN_BROWSER.toLowerCase()
const field = (key: string, hint: string, required = false): SettingField => ({ path: 'fields.' + key, label: FIELD_LABELS[key], hint, required, placeholder: key, find: PROBE_FIELDS })

/** Source settings, grouped as the form shows them. */
export const SOURCE_GROUPS: { title: string; fields: SettingField[] }[] = [
  { title: 'Документ', fields: [
    { path: 'document_endpoint', kind: 'path', required: true, label: 'Путь документа', placeholder: '/api/pages/{id}', hint: 'Запрос, который отдаёт один документ вместе с текстом. {id} заменяется на id документа.', find: 'В документации API сервиса ищите «get page by id» или «content by id». ' + OPEN_IN_BROWSER },
    { path: 'metadata_endpoint', kind: 'path', label: 'Путь метаданных', placeholder: '/api/pages/{id}?fields=version', hint: 'Тот же документ без текста — версия, заголовок, родитель. С ним повторная синхронизация быстро понимает, что не изменилось. Пусто — каждый раз запрашивается полный документ.' },
    { path: 'document_path', label: 'Где документ в ответе', placeholder: 'data', hint: 'Если ответ оборачивает документ, например {"data": {…}}, — путь к нему через точку. Пусто — документ занимает весь ответ.' },
    { path: 'body_format', kind: 'select', label: 'Формат текста', options: [{ value: 'html', label: 'HTML — конвертируется в markdown' }, { value: 'markdown', label: 'Markdown — сохраняется как есть' }], hint: 'В каком виде сервис отдаёт текст документа.' },
    { path: 'original_url', kind: 'path', label: 'Ссылка на оригинал', placeholder: '/pages/{id}', hint: 'Адрес страницы для браузера: попадает в шапку markdown-файла, чтобы агент и вы могли открыть оригинал. Пусто — используется путь документа.', find: 'Откройте любую страницу в браузере и замените в её адресе id на {id}, а адрес сервиса уберите.' },
  ] },
  { title: 'Поля в ответе', fields: [
    field('id', 'Путь к уникальному id документа в JSON-ответе. Вложенные поля — через точку: page.id.', true),
    field('title', 'Путь к заголовку документа.', true),
    field('body', 'Путь к тексту документа (HTML или markdown, как выбрано в «Формате текста»).', true),
    field('version', 'Номер или дата версии: по ней синхронизация понимает, что документ изменился. Без версии тексты скачиваются каждый раз и сравниваются целиком.'),
    field('parent', 'id родительского документа — для структуры папок и INDEX.md.'),
    field('ancestors', 'Список предков от корня (массив объектов с id) — альтернатива «Родителю».'),
    field('url', 'Ссылка на страницу, если сервис отдаёт её в ответе; иначе берётся «Ссылка на оригинал».'),
    field('updated', 'Дата последнего изменения — попадает в шапку файла.'),
    field('space', 'Пространство или раздел сервиса — попадает в шапку файла.'),
    field('author', 'Автор последнего изменения — попадает в шапку файла.'),
  ] },
  { title: 'Дочерние документы', fields: [
    { path: 'children.endpoint', kind: 'path', label: 'Путь списка дочерних', placeholder: '/api/pages/{id}/children', hint: 'Запрос, который отдаёт непосредственных потомков документа {id}. Без него раздел скачивается как одна страница, а дерево недоступно.', find: 'В документации API ищите «children» или «child pages». ' + OPEN_IN_BROWSER },
    { path: 'children.items_path', label: 'Где список в ответе', placeholder: 'results', hint: 'Путь к массиву документов в ответе списка, например results. Пусто — ответ сам является массивом.' },
    { path: 'children.pagination.mode', kind: 'select', clears: 'children.pagination', label: 'Постраничная загрузка', options: [{ value: '', label: 'Нет — список приходит целиком' }, { value: 'offset', label: 'Смещение и размер страницы' }, { value: 'next', label: 'Ссылка на следующую страницу в ответе' }], hint: 'Как сервис отдаёт длинные списки.', find: 'Посмотрите ответ списка: параметры вида start/limit или offset/size — это «Смещение»; поле со ссылкой на следующую страницу — «Ссылка».' },
    ...pagination('children'),
  ] },
  { title: 'Поиск по заголовку', fields: [
    { path: 'lookup.endpoint', kind: 'path', label: 'Путь поиска', placeholder: '/api/pages?title={title}&space={scope}', hint: 'Нужен только для ссылок, где вместо id — название страницы. {title} — заголовок из ссылки, {scope} — пространство. Поиск должен найти ровно один документ.' },
    { path: 'lookup.items_path', label: 'Где список в ответе', placeholder: 'results', hint: 'Путь к массиву найденных документов.' },
  ] },
  { title: 'Ссылки и конвертация', fields: [
    { path: 'link_patterns', kind: 'json', label: 'Шаблоны ссылок', hint: 'Как вынуть id из ссылки, вставленной из браузера: список {"pattern": регулярное выражение, "id_group": номер группы с id}. Для ссылок по заголовку — title_group и scope_group. Голый id подходит всегда.', find: 'Скопируйте 2–3 ссылки на страницы из браузера и найдите в них id; регулярное выражение должно его захватывать в скобках.' },
    { path: 'internal_link_patterns', kind: 'json', label: 'Внутренние ссылки', hint: 'Шаблоны ссылок между документами (в том же формате): такие ссылки в тексте превращаются в относительные пути к скачанным файлам.' },
    { path: 'conversion_rules', kind: 'json', label: 'Правила конвертации', hint: 'Что делать с особыми элементами HTML, по порядку: selector — CSS-селектор; action: code (блок кода; parameter — язык), callout (врезка с меткой label), unwrap (оставить содержимое), skip (пропустить), unknown (пометить как неизвестный элемент).' },
  ] },
]

function pagination(collection: string): SettingField[] {
  const p = collection + '.pagination.'
  const mode = (m: string) => (c: Record<string, unknown>) => ((c[collection] as Record<string, Record<string, unknown>> | undefined)?.pagination?.mode) === m
  return [
    { path: p + 'offset_parameter', label: 'Параметр смещения', placeholder: 'start', hint: 'Имя параметра запроса с номером первого элемента страницы.', visible: mode('offset') },
    { path: p + 'limit_parameter', label: 'Параметр размера', placeholder: 'limit', hint: 'Имя параметра запроса с размером страницы.', visible: mode('offset') },
    { path: p + 'limit', kind: 'number', label: 'Размер страницы', placeholder: '100', hint: 'Сколько элементов просить за раз (1–1000).', visible: mode('offset') },
    { path: p + 'next_path', label: 'Поле ссылки на следующую страницу', placeholder: 'links.next', hint: 'Путь к ссылке на следующую страницу в ответе; когда её нет — список закончился.', visible: mode('next') },
    { path: p + 'total_path', label: 'Поле общего количества', placeholder: 'total', hint: 'Необязательно: путь к общему числу элементов, чтобы не делать лишний запрос.', visible: c => mode('offset')(c) || mode('next')(c) },
  ]
}

export const SYNC = {
  title: 'Синхронизация',
  idle: { title: 'Ещё не синхронизировался', sub: 'Нажмите «Обновить», чтобы скачать выбранные разделы.' },
  starting: { title: 'Синхронизация запущена', sub: 'Вход в сервис…' },
  discover: (found: number) => ({ title: 'Проверка документов', sub: `найдено ${found}; проверяем состав и версии страниц` }),
  download: (done: number, total?: number, found?: number) => ({ title: total === 0 ? 'Изменений для загрузки нет' : 'Загрузка документов', sub: `найдено ${found ?? total ?? 0} · требуется загрузить ${total ?? 0} · обработано ${done} / ${total ?? 0}` }),
  done: { title: 'Синхронизировано' },
  error: { title: 'Синхронизация не удалась' },
  cancelled: { title: 'Синхронизация отменена' },
  confirm: (count: number, found?: number) => ({ title: 'Нужно подтверждение', sub: `Найдено ${found ?? count} документов; требуется загрузить ${count} новых, изменённых или требующих проверки — больше порога 500. Список уже проверен.` }),
  confirmAction: (count: number) => `Загрузить ${count} документов`,
  confirmQuestion: (count: number) => `Загрузить ${count} документов по уже проверенному списку? Страницы с прежними версиями повторно не скачиваются.`,
  narrow: 'Изменить выбор',
  update: 'Обновить',
  cancel: 'Отменить синхронизацию',
  report: (s: { added?: number; updated?: number; deleted?: number }) => `Новых ${s.added || 0} · обновлено ${s.updated || 0} · удалено ${s.deleted || 0}`,
  unchanged: (n: number) => `без изменений ${n}`,
  errors: (n: number) => `не удалось скачать: ${n}`,
  details: 'Подробности',
  noSections: 'Разделы не выбраны — добавьте их в «Настройках» справочника.',
  background: 'Синхронизация идёт на сервере: закрытие вкладки её не останавливает. Агенты читают скачанные markdown-файлы и INDEX.md без доступа к сети.',
}

/** Engine notes about the configured source (probe and sync warnings). */
export const WARNINGS: ErrorDictionary = [
  [/^No version field/, 'Нет поля версии: при каждой синхронизации тексты скачиваются заново и сравниваются целиком.'],
  [/^No children endpoint/, 'Дочерние документы не настроены: раздел скачивается как одна страница, дерево недоступно.'],
  [/^No metadata endpoint/, 'Нет пути метаданных: для проверки изменений каждый раз запрашивается полный документ раздела.'],
  [/^Some metadata lacks the configured version field/, 'У части документов нет версии — их тексты скачиваются для сравнения.'],
]

export const ERRORS: ErrorDictionary = [
  [/^Download plan expired or settings changed/, 'Список загрузки устарел или настройки изменились. Нажмите «Обновить», чтобы снова проверить документы.'],
  [/^Document (?:link or id|id or link|id) is required/, 'Вставьте ссылку на страницу или id документа.'],
  [/^Link does not match configured patterns/, 'Ссылка не подошла ни под один шаблон. Вставьте id документа или проверьте «Шаблоны ссылок» в настройках источника.'],
  [/^Link must belong to the connection service|^Use the connection service origin/, 'Ссылка ведёт на другой сервис, а не на адрес выбранного подключения.'],
  [/^(?:Probe )?[Tt]itle lookup (?:returned (\d+) documents|must return exactly one)/, m => `Поиск по заголовку ${m[1] ? 'нашёл ' + m[1] + ' документов' : 'должен найти ровно один документ'} — вставьте ссылку с id страницы.`],
  [/^Missing required field: (.+)/, m => `В ответе нет поля «${m[1]}» — проверьте «Поля в ответе».`],
  [/^Missing (?:body|id) field: (.+)/, m => `В ответе нет поля «${m[1]}» — проверьте «Поля в ответе».`],
  [/^Missing collection field: (.+)/, m => `В ответе списка нет поля «${m[1]}» — проверьте «Где список в ответе».`],
  [/^Response is not valid JSON/, 'Сервис ответил не JSON: путь неверный или открылась страница входа.'],
  [/^Response document id does not match/, 'Сервис вернул другой документ, чем запрошен — проверьте путь документа и поле id.'],
  [/^Remote HTTP 404/, 'Документ не найден (HTTP 404) — проверьте id и путь документа.'],
  [/^Remote HTTP (\d+)/, m => `Сервис ответил ошибкой HTTP ${m[1]}.`],
  [/^Children endpoint is not configured/, SECTIONS.noTree],
  [/^Unknown template parameter: (\w+)/, m => `Неизвестная подстановка {${m[1]}} в пути. В путях доступны {id}, а в поиске — {title} и {scope}.`],
  [/^Invalid JSON path: (\w+)/, m => `Неверный путь к полю «${FIELD_LABELS[m[1]] ?? m[1]}»: только буквы, цифры, «_», «-» и точки.`],
  [/^(\w+) must be a string/, m => `Не заполнено обязательное поле: ${FIELD_LABELS[m[1]] ?? (m[1] === 'endpoint' ? 'путь' : m[1])}.`],
  [/^Fields are required/, 'Укажите пути к полям id, заголовка и текста.'],
  [/^Expected source settings/, FORM.noConfig],
  [/^Invalid body format/, 'Формат текста: HTML или markdown.'],
  [/^Link patterns must be an array|^Invalid link pattern|^Link pattern is too long/, 'Шаблоны ссылок: JSON-массив с верными регулярными выражениями.'],
  [/^A link pattern must capture id or title|^Capture groups start at 1/, 'В шаблоне ссылки укажите id_group (или title_group) — номер группы в скобках, начиная с 1.'],
  [/^Invalid pagination mode|^Invalid page limit|^Invalid pagination parameter/, 'Проверьте постраничную загрузку: размер страницы 1–1000, имена параметров — латиница.'],
  [/^Conversion rules must be an array|^Invalid conversion action|^Invalid selector: (.+)/, 'Проверьте правила конвертации: массив правил, action — code, callout, unwrap, skip или unknown, верные CSS-селекторы.'],
  [/^Paths must be relative/, 'Пути должны быть относительными: начинаться с «/», без адреса сервиса и без «..».'],
  [/^Request must stay on the service origin/, 'Путь уводит на другой сервис — укажите путь внутри адреса подключения.'],
  [/already running/i, 'Синхронизация уже идёт.'],
  [/^Previous sync interrupted by server restart/, 'Прошлая синхронизация прервана перезапуском приложения — запустите её снова.'],
  [/manifest/i, 'Служебный файл справочника повреждён; синхронизация остановлена, чтобы не испортить скачанные документы.'],
  [/^Docs source with a connection is required/, 'У справочника не выбрано подключение.'],
  [/^Docs source not found/, 'Справочник не найден — возможно, его уже удалили.'],
  [/cycle/i, 'Дерево документов в сервисе зациклено — проверьте поля «Родитель» и «Предки».'],
  [/^Tree exceeds|^Pagination exceeded|^Ancestry exceeds/, 'Слишком много документов или страниц списка — выберите разделы поменьше.'],
  [/^Document (\S+): (.*)/, m => `Документ ${m[1]}: ${m[2]}`],
  [/^Secret vault unavailable/, 'Хранилище паролей недоступно — вход в сервис невозможен.'],
  [/^Обновите пароль|обновите пароль/, NEEDS_UPDATE.text],
  [/^Сервис вернул ошибку/, 'Сервис ответил ошибкой: возможно, документа с таким id нет или путь документа в настройках источника неверен.'],
  [/^Documentation operation failed|^Project operation failed|^Sync failed/, 'Операция не удалась. Повторите или проверьте настройки источника.'],
  [/^Not found$/, 'Не найдено — возможно, подключение удалили.'],
]
