// All user-facing texts of the «Подключения» tab: field hints, statuses, check results, errors.
// The user guide (docs) quotes these, so change them here and keep the guide in step.
import type { SettingField } from '@shared/ui/SettingsFields.vue'
import type { ErrorDictionary } from '@shared/utils/errorText'

export const INTRO = 'Подключение — это адрес сервиса и способ входа в него. Логин и пароль хранятся в учётной записи; организация объединяет учётные записи и подключения одной компании, чтобы при смене пароля обновить его в одном месте. Подключение затем выбирают в справочниках типа «Документация».'

export const STORAGE = {
  insecureDev: 'Режим разработки: пароли шифруются ключом из файла рядом с базой данных. Это не защищает от доступа к диску — для рабочих паролей используйте установленное приложение.',
  unavailable: 'Хранилище паролей недоступно: система не даёт приложению шифровать данные. Пароли не сохраняются, вход в сервисы невозможен.',
}

export const EMPTY = {
  title: 'Подключений пока нет',
  steps: [
    'Учётная запись — ваш логин и пароль в сервисе. Можно сразу внутри подключения («Свой логин и пароль»).',
    'Подключение — адрес сервиса и способ входа. Для известных сервисов нажмите «Заполнить как: …».',
    'Справочник типа «Документация» — выберите в нём подключение и добавьте разделы ссылками из браузера.',
  ],
  organizations: 'Организации нужны, если у вас несколько компаний или одна учётная запись на много сервисов. Можно обойтись без них.',
}

export const ORGANIZATION = {
  name: 'Например «Компания A» или «Личное». Название видно в списках и в ошибках.',
  credential: 'Подключения в режиме «От организации» входят под этой записью. Сменили пароль в ней — все такие подключения продолжают работать.',
  credentialAfterSave: 'Общая учётная запись выбирается после сохранения: создайте организацию, добавьте в неё учётную запись и вернитесь сюда.',
}

export const CREDENTIAL = {
  name: 'Как запись будет называться в списках, например «Доменная учётка».',
  organization: 'Организацию записи нельзя сменить после создания.',
  username: 'Логин, которым вы входите в сервис. После смены логина пароль нужно задать заново.',
  password: 'Пароль шифруется и больше никогда не показывается. Оставьте пустым, чтобы не менять.',
  passwordNew: 'Пароль шифруется и больше никогда не показывается. Можно задать позже кнопкой «Изменить пароль».',
}

export const CONNECTION = {
  name: 'Как подключение будет называться в списках и в форме справочника, например «Вики компании».',
  baseUrl: 'Корень сервиса: протокол, домен и порт, если он есть — без пути к странице. Один адрес используется и для входа, и для скачивания; все пути в параметрах приклеиваются к нему.',
  baseUrlFind: 'Откройте сервис в браузере и скопируйте адрес до первого «/» после домена. Если сервис установлен в подпапке (https://host/wiki), укажите только https://host, а подпапку допишите в начало каждого пути.',
  baseUrlInvalid: 'Адрес должен начинаться с http:// или https://, например https://wiki.example.com',
  trimSuggestion: (root: string) => `Похоже, это ссылка на страницу. Адрес подключения — корень сервиса: ${root}`,
  trimAction: 'Обрезать до корня',
  organization: 'Подключение показывается в группе организации и может входить под её общей учётной записью.',
  presetNote: 'Преднастройка заполняет только «Параметры входа»; значения копируются в подключение, их можно поправить. Для незнакомого сервиса заполните параметры вручную.',
  ownUsername: 'Логин только для этого подключения — в общем списке учётных записей его нет.',
  ownPassword: 'Пароль шифруется и больше никогда не показывается. Оставьте пустым, чтобы не менять.',
  autoCheck: 'После сохранения подключение будет проверено, если пароль задан.',
  authSummary: 'Параметры входа',
  authIntro: 'Как Plangent входит в сервис и как понимает, что вход удался. Все пути относительные: они приклеиваются к адресу сервиса, итоговый URL показан под полем. Пароль здесь не задаётся.',
  json: 'Все параметры входа одним JSON — для копирования между подключениями. Изменения здесь и в полях выше синхронизированы.',
  jsonInvalid: 'Неверный JSON — проверьте скобки, кавычки и запятые.',
}

export const CREDENTIAL_MODES: Record<string, { label: string; hint: string }> = {
  inherit: { label: 'От организации', hint: 'Входит под общей учётной записью организации.' },
  credential: { label: 'Выбрать запись', hint: 'Входит под выбранной учётной записью этой организации, например сервисной.' },
  own: { label: 'Свой логин и пароль', hint: 'Отдельные логин и пароль только для этого подключения.' },
}

export const STRATEGIES: Record<string, { label: string; hint: string }> = {
  auto: { label: 'Автоматически', hint: 'Пробует способы по порядку и запоминает сработавший. Однозначный «неверный пароль» останавливает перебор, чтобы не заблокировать учётную запись.' },
  basic: { label: 'Basic', hint: 'Логин и пароль уходят в заголовке каждого запроса. Подходит, если API сервиса принимает базовую аутентификацию.' },
  form: { label: 'Форма входа', hint: 'Один вход, как в браузере: логин и пароль отправляются в форму, дальше запросы идут с cookie сессии.' },
}

const usesForm = (c: Record<string, unknown>, strategy: string) => strategy === 'form' || (strategy === 'auto' && Array.isArray(c.strategies) && c.strategies.includes('form'))
const OPEN_IN_BROWSER = 'Откройте итоговый URL в браузере, где вы уже вошли в сервис: должен открыться JSON.'
const DEVTOOLS_LOGIN = 'Откройте страницу входа сервиса, нажмите F12 → вкладка «Сеть» (Network), войдите и найдите POST-запрос, ушедший при нажатии «Войти».'

/** Login settings, grouped as the form shows them. `strategy` decides which groups are relevant. */
export function authFields(strategy: string): { title: string; fields: SettingField[] }[] {
  return [
    { title: 'Проверка входа', fields: [
      { path: 'check_path', kind: 'path', required: true, label: 'Путь проверки «кто я»', placeholder: '/api/user/current', hint: 'Запрос, которым «Проверить» убеждается, что вход удался. Должен отвечать только вошедшему пользователю — обычно JSON с данными текущего пользователя.', find: 'В документации API сервиса ищите «current user», «me», «whoami». ' + OPEN_IN_BROWSER },
      { path: 'user_path', label: 'Поле имени в ответе', placeholder: 'displayName', hint: 'Путь через точку к имени пользователя в ответе проверки — из него берётся «Вошли как …». Пусто — проверяется только, что ответ успешный.', find: OPEN_IN_BROWSER + ' Найдите поле с вашим именем; вложенные поля пишутся через точку: user.name.' },
      { path: 'expect_json', kind: 'bool', label: 'Ответ должен быть JSON', hint: 'Если вместо JSON пришла HTML-страница, значит сервис показал страницу входа — вход считается неудачным.' },
    ] },
    { title: 'Порядок способов', fields: [
      { path: 'strategies', kind: 'list', required: true, label: 'Способы по порядку', placeholder: 'basic, form', hint: 'Через запятую: basic, form. Первый сработавший запоминается для следующих запросов.', visible: () => strategy === 'auto' },
    ] },
    { title: 'Вход формой', fields: [
      { path: 'login_path', kind: 'path', required: true, label: 'Путь формы входа', placeholder: '/login', hint: 'Куда отправляются логин и пароль при входе (POST). После входа сохраняется cookie сессии.', find: DEVTOOLS_LOGIN + ' Путь этого запроса — значение поля.' },
      { path: 'username_field', required: true, label: 'Имя поля логина', placeholder: 'username', hint: 'Как называется поле с логином в этой форме.', find: DEVTOOLS_LOGIN + ' На вкладке «Полезная нагрузка» (Payload) найдите поле, в котором стоит ваш логин.' },
      { path: 'password_field', required: true, label: 'Имя поля пароля', placeholder: 'password', hint: 'Как называется поле с паролем в этой форме.', find: 'В том же запросе — поле, в котором стоит пароль (значение скрыто или звёздочки).' },
      { path: 'fields', kind: 'pairs', label: 'Дополнительные поля формы', placeholder: 'remember: true', hint: 'Постоянные поля, которые форма отправляет вместе с логином, по одному на строку: «имя: значение». Только публичные константы — пароли и токены сюда не пишутся.', find: 'Остальные поля того же запроса входа, значения которых не меняются от входа к входу.' },
    ].map(f => ({ ...f, visible: (c: Record<string, unknown>) => usesForm(c, strategy) })) as SettingField[] },
    { title: 'Дополнительно', fields: [
      { path: 'headers', kind: 'pairs', label: 'Заголовки запросов', placeholder: 'X-Requested-With: XMLHttpRequest', hint: 'Заголовки, которые сервис требует во всех запросах, по одному на строку: «Имя: значение». Не для секретов: Authorization и Cookie Plangent ставит сам.' },
      { path: 'timeout_ms', kind: 'number', label: 'Таймаут запроса, мс', placeholder: '15000', hint: 'Сколько ждать ответа сервиса. По умолчанию 15000 (15 секунд); увеличьте для медленного VPN.' },
    ] },
    { title: 'Признаки неверного пароля', fields: rule('invalid_password', 'неверный пароль', 'Сразу помечает учётную запись «нужен новый пароль» без повторных попыток — так учётку не заблокирует.') },
    { title: 'Признаки истёкшей сессии', fields: rule('invalid_session', 'сессия истекла', 'Plangent один раз входит заново и повторяет запрос.') },
  ]
}

function rule(key: string, what: string, effect: string): SettingField[] {
  return [
    { path: key + '.statuses', kind: 'numbers', label: 'Коды ответа', placeholder: '401', hint: `Если сервис ответил одним из этих кодов — ${what}. ${effect}` },
    { path: key + '.header.name', label: 'Заголовок ответа', placeholder: 'X-Login-Reason', hint: `Имя заголовка, по значению которого видно, что ${what}. Задаётся вместе со значением.` },
    { path: key + '.header.value', label: 'Значение заголовка', placeholder: 'FAILED', hint: 'Значение этого заголовка (без учёта регистра).' },
    { path: key + '.redirect_path', label: 'Перенаправление на путь', placeholder: '/login*', hint: `Если сервис перенаправил на этот путь — ${what}. «*» в конце — любое продолжение.` },
    { path: key + '.html_instead_of_json', kind: 'bool', label: 'HTML-страница вместо JSON', hint: `Если на запрос API пришла HTML-страница (обычно страница входа) — ${what}.` },
  ]
}

export const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'error' | 'muted' }> = {
  ok: { label: 'Работает', tone: 'ok' },
  error: { label: 'Ошибка', tone: 'error' },
  needs_update: { label: 'Нужен новый пароль', tone: 'warn' },
  unchecked: { label: 'Не проверялось', tone: 'muted' },
}
export const CREDENTIAL_STATUS = {
  needsUpdate: { label: 'Пароль не подходит', tone: 'warn' as const },
  noSecret: { label: 'Пароль не задан', tone: 'muted' as const },
  ready: { label: 'Пароль сохранён', tone: 'ok' as const },
}

export const NEEDS_UPDATE = {
  banner: (names: string) => `Пароль больше не подходит: ${names}. Plangent не входит повторно, чтобы не заблокировать учётную запись, — задайте новый пароль.`,
  action: 'Изменить пароль',
}

/** «Проверить» results by server status; the server message is kept where it adds detail. */
export function checkText(status: string, message: string, url: string): string {
  let host = ''
  try { host = new URL(url).host } catch { /* shown without a host */ }
  switch (status) {
    case 'ok': return message
    case 'network': return `Нет связи${host ? ' с ' + host : ''}. VPN подключён? Проверьте также адрес сервиса.`
    case 'invalid_credentials': return 'Неверный логин или пароль. Повторных попыток не будет, чтобы не заблокировать учётную запись, — задайте новый пароль.'
    case 'needs_update': return 'Пароль требует обновления: вход не выполняется, пока не задан новый пароль.'
    case 'forbidden': return 'Нет прав: вход выполнен, но этой учётной записи запрос проверки запрещён.'
    case 'unsupported_auth': return `Способ входа не подходит: ${message.replace(/^Способ входа не подходит:?\s*/, '') || 'сервис ответил не так, как описано в параметрах'}. Возможно, сервис использует SSO — сверьте «Параметры входа».`
    case 'remote_error': return 'Сервис ответил ошибкой. Проверьте путь проверки в «Параметрах входа».'
    case 'configuration_changed': return 'Настройки изменились во время проверки — нажмите «Проверить» ещё раз.'
    default: return message
  }
}

export const CONFIRM = {
  organization: (name: string) => `Удалить организацию «${name}»? Учётные записи и подключения останутся без организации, а подключения «От организации» перестанут входить, пока вы не выберете им учётную запись.`,
  credential: (name: string, used: number) => `Удалить учётную запись «${name}»? Пароль будет стёрт.${used ? ` Её используют подключения (${used}) — они перестанут входить.` : ''}`,
  connection: (name: string) => `Удалить подключение «${name}»?`,
  inUse: (sources: string) => `Подключение используется справочниками ${sources}. Сначала удалите их или выберите в них другое подключение.`,
}

const FIELD_NAMES: Record<string, string> = { name: 'Название', username: 'Логин', base_url: 'Адрес сервиса', username_field: 'Имя поля логина', password_field: 'Имя поля пароля', 'relative path': 'Путь', 'header name': 'Заголовок ответа', 'header value': 'Значение заголовка' }

export const ERRORS: ErrorDictionary = [
  [/^(.+) is required$/, m => `Не заполнено поле «${FIELD_NAMES[m[1]] ?? m[1]}»`],
  [/^Invalid service URL/, CONNECTION.baseUrlInvalid],
  [/^Use an HTTP\(S\) service URL/, 'Адрес должен начинаться с http:// или https:// и не содержать логин и пароль.'],
  [/^Paths must be relative/, 'Пути в параметрах входа должны быть относительными: начинаться с «/», без адреса сервиса и без «..».'],
  [/^Request must stay on the service origin/, 'Путь уводит на другой сервис — укажите путь внутри адреса подключения.'],
  [/^Unknown auth setting: (.+)/, m => `Неизвестный параметр входа «${m[1]}» — уберите его из JSON.`],
  [/^Invalid JSON user path/, 'Поле имени: допустимы буквы, цифры, «_», «-» и точки.'],
  [/^Invalid timeout/, 'Таймаут — целое число от 100 до 120000 мс.'],
  [/^auto requires/, 'Для способа «Автоматически» укажите порядок: basic, form (без повторов).'],
  [/^Login field names must differ/, 'Имена полей логина и пароля должны различаться.'],
  [/^Secrets must be set through/, 'В дополнительных полях и заголовках нельзя хранить пароли, токены и cookie — пароль задаётся отдельно.'],
  [/^Unknown response rule/, 'Неизвестный признак ответа — уберите его из JSON.'],
  [/^Invalid response statuses/, 'Коды ответа — целые числа от 100 до 599 через запятую.'],
  [/^Invalid HTML rule/, 'Признак «HTML вместо JSON» — включён или выключен.'],
  [/^Organization account must belong/, 'Общая учётная запись должна принадлежать этой организации.'],
  [/^Organization not found/, 'Организация не найдена — возможно, её уже удалили.'],
  [/^Account organization cannot be changed/, 'Организацию учётной записи сменить нельзя — создайте новую запись.'],
  [/^Choose an account from this organization/, 'Выберите учётную запись из организации подключения.'],
  [/^Delete the owning connection first/, 'Это собственная учётная запись подключения — она удаляется вместе с подключением.'],
  [/^Use the account password endpoint/, 'Пароль этого подключения задаётся в его учётной записи.'],
  [/^Invalid account mode|^Invalid login strategy/, 'Выберите учётную запись и способ входа из списка.'],
  [/^Not found$/, 'Запись не найдена — возможно, её уже удалили.'],
  [/^Хранилище секретов недоступно/, STORAGE.unavailable],
]
