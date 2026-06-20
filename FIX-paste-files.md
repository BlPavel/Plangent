# Фикс: вставка/перетаскивание файлов в терминал (Claude видел заглушку)

> Контекст для следующей сессии Claude Code, если после перезапуска баг не починился.
> Дата: 2026-06-20.

## Симптом
При `Cmd+V` или drag-drop файла в плангент-терминал у Claude появляется `[Image #1]`,
но нейронка видит **системную иконку файла macOS** (серый «PNG»), а не реальный файл.
Касается и картинок, и текстовых файлов. Через `@` всё работает (Claude читает файл по пути напрямую).

## Корень проблемы
1. `webUtils.getPathForFile()` возвращает `''` для вставки из буфера (работает только для drag-drop).
2. Запасной путь через `osascript` (`/api/clipboard/paths`) ненадёжен: коэрция
   `the clipboard as «class furl»` превращает любой текст из буфера в мусорный путь
   (проверено: вернул `/Image #1]`).
3. Не получив путь, код заливал «картинку из буфера» — но у скопированного файла в буфере
   лежит его **иконка-превью**, а не сам файл. Её и видел Claude → заглушка.

## Что сделано (файлы)
- `electron/main.ts` — IPC-хендлер `clipboard:file-paths`: читает реальные пути нативным
  Electron-буфером (`clipboard.read('public.file-url')` + `NSFilenamesPboardType`).
- `electron/preload.ts` — проброшен `getClipboardFilePaths()`.
- `client/src/electron.d.ts` — тип нового метода.
- `client/src/components/TerminalPane.vue` — `onPaste`: синхронно распознаёт файл
  (`cd.files` / image-item / `cd.types.includes('Files')`), сразу `preventDefault`,
  берёт реальный путь через нативный буфер, заливает картинку ТОЛЬКО для настоящих
  скриншотов (когда файла на диске нет).

Формат вставки пути (bracketed-paste, `\x1b[200~...\x1b[201~`) НЕ трогали — он уже работал
(раз появлялся `[Image #1]`).

## Как проверить после перезапуска
Перезапустить: `npm run electron:dev` (пересоберёт preload/main через tsc).
1. Скопировать файл в Finder → `Cmd+V` в терминал → должен вставиться реальный путь,
   Claude видит настоящий файл.
2. Скриншот (`Cmd+Shift+4`) → `Cmd+V` → зальётся реальная картинка.
3. Drag-drop файла из Finder в терминал → реальный путь (этот путь и раньше работал через webUtils).

## РАУНД 2 (2026-06-20, после первого рестарта баг ОСТАЛСЯ)

### Диагноз цепочки (подтверждён)
PTY передаёт ТОЛЬКО текст, внутри крутится `claude`. Inline-картинку он получить не может —
получает ПУТЬ и читает файл. Значит заглушка = `claude` прочитал путь к файлу-иконке.
Цепочка бага:
1. `Cmd+V` файла → `onPaste` → `getClipboardFilePaths()` вернул `[]` (не достал путь).
2. Код провалился в шаг 2 `uploadImageAndInsert` → залил macOS-ИКОНКУ файла в
   `/tmp/plangent-uploads/upload-*.png` → вставил путь к иконке.
3. `claude` прочитал иконку → заглушка (кэш `~/.claude/image-cache/.../1.png`).

### Корень: почему `getClipboardFilePaths()` вернул `[]`
Старый код гейтил чтение на `clipboard.availableFormats().includes('public.file-url')`.
На современной macOS имена в `availableFormats()` НЕ совпадают с теми, что принимает
`clipboard.read()` → условие false → путь не извлекался вообще.

### Что изменено в РАУНДЕ 2 (`electron/main.ts`, хендлер `clipboard:file-paths`)
- Убран гейт на `availableFormats()`. Теперь `public.file-url` и `NSFilenamesPboardType`
  читаются НАПРЯМУЮ через новый хелпер `safeRead()` (try/catch, не падает).
- Добавлены ДВА console.log в main-процесс:
  - `[clipboard:file-paths] { availableFormats: [...], fileUrl: '...' }`
  - `[clipboard:file-paths] resolved [...]`
- `tsc -p tsconfig.electron.json` — проходит, `dist-electron/main.js` пересобран и содержит
  хендлер + `safeRead`.

### КАК ПРОВЕРИТЬ после рестарта (ВАЖНО где смотреть лог)
Лог идёт из MAIN-процесса Electron → он печатается в ТЕРМИНАЛ, где запущен
`npm run electron:dev`, строки помечены cyan-префиксом `electron`. Это НЕ DevTools.
(DevTools `Cmd+Opt+I` показывает логи RENDERER'а, а наши логи там НЕ появятся.)

Шаги:
1. `npm run electron:dev` (рестарт обязателен — main/preload грузятся только при старте,
   HMR их не подхватывает).
2. Скопировать PNG в Finder → `Cmd+V` в терминал плангента.
3. Посмотреть в терминале строку `[clipboard:file-paths] resolved [...]`.

### Развилка по результату
- `resolved: ['/Users/.../file.png']` → ФИКС СРАБОТАЛ. `claude` получит реальный путь.
- `resolved: []` → смотреть `availableFormats` в первом логе: там видно, под каким
  ИМЕНЕМ реально лежит file-url в буфере. Поправить строку
  `safeRead('public.file-url')` на это имя (или добавить ещё один `safeRead(...)`).
  Возможные кандидаты: `'NSPasteboardTypeFileURL'`, `'public.url'`, чтение через
  `clipboard.readBuffer('NSFilenamesPboardType')` + парс bplist.

### Что сказать Claude в новой сессии
- Вставить сюда обе строки лога `[clipboard:file-paths]` из cyan-панели `electron`.
- Действие: paste/drag, файл/скриншот.
- Что вставилось в терминал и что увидела нейронка.

## РАУНД 3 (2026-06-20, баг ВСЁ ЕЩЁ воспроизводится → найдена настоящая причина)

### Корень (наконец-то, по Electron API)
`clipboard.read(format)` на macOS под капотом вызывает `[NSPasteboard stringForType:]`.
Для `public.file-url` и `NSFilenamesPboardType` данные в буфере лежат как **DATA, а не
строка** → `stringForType:` отдаёт `nil` → `clipboard.read()` всегда возвращал `''`.
Вот почему в раундах 1-2 `getClipboardFilePaths()` стабильно отдавал `[]` и код
проваливался в `uploadImageAndInsert` → заливал иконку → заглушка.

### Что изменено (`electron/main.ts`)
- `safeRead()` переписан: сначала `clipboard.readBuffer(format)` (это `dataForType:`,
  читает data-типы), декод `toString('utf8')`; фолбэк на `clipboard.read()` для
  настоящих строковых форматов.
- `fileUrlToPath()` теперь чистит хвостовые `\0`/пробелы из URL-байтов и проверяет
  префикс `file:` перед `new URL()`.
- `tsc -p tsconfig.electron.json` — проходит, `dist-electron/main.js` содержит
  `readBuffer` (строки ~63-65), `safeRead`, оба console.log.

### КАК ПРОВЕРИТЬ
1. РЕСТАРТ обязателен: `npm run electron:dev` (main грузится только при старте).
2. Скопировать PNG в Finder → `Cmd+V` в терминал плангента.
3. В cyan-панели `electron` смотреть `[clipboard:file-paths] resolved [...]`.
   - `resolved: ['/Users/.../file.png']` → ФИКС СРАБОТАЛ.
   - `resolved: []` → в первом логе глянуть `availableFormats`, под каким UTI лежит
     file-url; добавить ещё один `safeRead('<это-имя>')`.

## РАУНД 4 (2026-06-20, БАГ НАЙДЕН И ПОЧИНЕН — две настоящие причины)

Раунды 1-3 чинили МЁРТВЫЙ код: `onPaste` вообще не вызывался, поэтому
`getClipboardFilePaths()` никогда не дёргался и в main печатать было нечего
(оттого «ни одного лога ни в DevTools, ни в electron-панели»).

### Причина №1: `onPaste` не срабатывал (`TerminalPane.vue`)
Listener висел на BUBBLING-фазе: `wrapEl.addEventListener('paste', onPaste)`.
Когда терминал в фокусе, paste прилетает в скрытую `<textarea>` самого xterm,
xterm обрабатывает и зовёт `stopPropagation()` → до `wrapEl` событие НЕ всплывает.
- ФИКС: capture-фаза → `wrapEl.addEventListener('paste', onPaste, true)`
  (и `removeEventListener(..., true)` в dispose). Capture идёт сверху вниз,
  wrapEl получает paste РАНЬШЕ textarea xterm.
- Добавлен renderer-лог `console.log('[onPaste]', {...})` (видно в DevTools).
- Подтверждено логом юзера: `[onPaste] {types:['Files'], files:1, items:['file:image/png']}`.

### Причина №2: macOS отдавал file-reference URL (`electron/main.ts`)
После фикса №1 в терминал вставлялось `/.file/id=6571367.3871525` — это macOS
file-REFERENCE URL (`file:///.file/id=...`), а не нормальный путь. `claude` такой
прочитать не может → заглушка. `fileUrlToPath` честно декодировал именно его.
- ФИКС: `resolveRealPath()` через `fs.realpathSync()` — резолвит reference-URL в
  реальный `/Users/...` путь (для уже-нормальных путей просто канонизирует, безвредно).
  Применяется ко всем путям в хендлере `clipboard:file-paths` перед возвратом.
- `tsc -p tsconfig.electron.json` exit 0, `dist-electron/main.js` содержит
  `resolveRealPath` + `fs.realpathSync` (строки ~14-21).

### Что осталось проверить
Перезапустить `npm run electron:dev` → скопировать PNG в Finder → Cmd+V →
в cyan-панели `electron` должно быть `resolved ['/Users/.../file.png']` (реальный
путь, НЕ `/.file/id=...`), `claude` читает настоящий файл без заглушки.

## РАУНД 5 (2026-06-20, ПОДТВЕРЖДЁН лог `resolved ['/.file/id=...']` → найдена и починена истинная причина)

### Лог юзера (cyan-панель electron)
```
[clipboard:file-paths] { availableFormats: ['text/plain','text/uri-list'],
                         fileUrl: 'file:///.file/id=6571367.3871525' }
[clipboard:file-paths] resolved [ '/.file/id=6571367.3871525' ]
```
Т.е. РАУНД 4 (`resolveRealPath` через `fs.realpathSync`) НЕ развернул reference-URL.

### Корень (доказан экспериментом)
`fs.realpathSync('/.file/id=NN.MM')` на macOS бросает **ENOTDIR** — POSIX `realpath(3)`
не умеет разворачивать file-REFERENCE ссылки `.file/id=`. В `catch` путь возвращался
как есть → `claude` читал несуществующий `/.file/id=...` → заглушка.
Проверено живьём: `node -e fs.realpathSync('/.file/id=...')` → `throw ENOTDIR`.

### Правильный инструмент (проверен round-trip)
`NSURL.filePathURL` разворачивает reference-URL в реальный путь:
```
osascript -l JavaScript -e 'function run(a){ObjC.import("AppKit");
  var u=$.NSURL.URLWithString(a[0]);if(!u.js)return"";
  var p=u.filePathURL;if(!p.js)return"";return ObjC.unwrap(p.path);}' \
  "file:///.file/id=6571367.3965737"
→ /Users/pavel/Projects/plangent/FIX-paste-files.md   ✅
```
(Это НЕ старый ненадёжный `furl`-coercion из раунда 1 — тут детерминированный
resolve конкретного URL, а не коэрция произвольного текста буфера.)

### Что изменено (`electron/main.ts`)
- Добавлен `resolveFileUrl(url)`: чистит `\0`, проверяет префикс `file:`, зовёт
  osascript/JXA `NSURL.filePathURL` через `execFileSync` (argv, timeout 2s).
- Хендлер: `const fromUrl = resolveFileUrl(fileUrl) || fileUrlToPath(fileUrl)`.
- `resolveRealPath`/`realpathSync` оставлен ТОЛЬКО для plain-путей из
  `NSFilenamesPboardType` (там это безвредная канонизация).
- `import { execFileSync } from 'child_process'`.
- `tsc -p tsconfig.electron.json` exit 0; `dist-electron/main.js` содержит
  `resolveFileUrl` + `execFileSync` + `filePathURL`.

### КАК ПРОВЕРИТЬ
1. РЕСТАРТ: `npm run electron:dev` (main грузится только при старте).
2. Скопировать PNG в Finder → `Cmd+V` в терминал.
3. В cyan-панели должно быть `resolved [ '/Users/.../file.png' ]` (НЕ `/.file/id=...`).
   `claude` читает настоящий файл, без заглушки.

## Статус
- ✅ РАУНД 5 ПОДТВЕРЖДЁН РАБОЧИМ (2026-06-20). Лог юзера после рестарта:
  ```
  [clipboard:file-paths] { availableFormats: ['text/plain','text/uri-list'],
                           fileUrl: 'file:///.file/id=6571367.3871525' }
  [clipboard:file-paths] resolved [ '/Users/pavel/Desktop/Снимок экрана ....png' ]
  ```
  Реальный путь (НЕ `/.file/id=...`). Claude увидел НАСТОЯЩУЮ картинку (содержимое
  диалога), а не серую иконку-заглушку. Баг закрыт.
- РАУНД 5: причина reference-URL добита правильным API (`NSURL.filePathURL` вместо
  `realpath`). Лог `resolved ['/.file/id=...']` из раунда 4 был прямым доказательством.
- Изменения НЕ закоммичены: `TerminalPane.vue` (capture-фаза + лог),
  `electron/main.ts` (resolveFileUrl/NSURL.filePathURL) + раунд-1..4 файлы.
