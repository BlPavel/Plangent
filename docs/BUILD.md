# Сборка и релиз

Инструкция для разработчиков: как запустить проект локально, собрать
десктопное приложение и выпустить релиз.

## Требования

- Node.js 20+ (нативные модули `better-sqlite3` и `node-pty` собираются под
  конкретную версию Node/Electron ABI, см. ниже).
- На macOS для сборки нативных модулей нужны Xcode Command Line Tools
  (`xcode-select --install`).
- На Windows — Visual Studio Build Tools (обычно ставятся автоматически при
  `npm install`, если модули не находят прекомпилированный бинарник).

## Запуск в dev-режиме

```bash
npm install
npm run electron:dev
```

Поднимает сервер (`tsx watch server/index.ts`), Vite dev-сервер клиента и
Electron-окно параллельно, с горячей перезагрузкой.

### Частая ошибка: NODE_MODULE_VERSION mismatch

`better-sqlite3` и `node-pty` — нативные модули, скомпилированные под
конкретный ABI. В dev-режиме сервер (`tsx watch`) запускается под системным
Node, а `npm run electron:build` / `electron:release` пересобирают эти модули
под ABI самого Electron (через `@electron/rebuild`). Если после сборки
приложения снова запустить `npm run electron:dev`, сервер упадёт с ошибкой
вида:

```
The module '.../better-sqlite3/build/Release/better_sqlite3.node'
was compiled against a different Node.js version using NODE_MODULE_VERSION ...
```

Лечится пересборкой под системный Node:

```bash
npm rebuild better-sqlite3
npm rebuild node-pty
```

## Локальная сборка приложения

```bash
npm run electron:build
```

Собирает клиент и сервер, пересобирает нативные модули под Electron ABI и
запускает `electron-builder`. На выходе — неподписанный `.dmg` (на macOS) или
`.exe`-инсталлятор (на Windows) в `dist-electron/`. Сборка под конкретную ОС
делается только на этой же ОС — кросс-компиляции нет.

### Windows: ошибка MSB8040 про Spectre-библиотеки

На Windows `@electron/rebuild` пересобирает `better-sqlite3` и `node-pty` через
MSBuild. Если установлено несколько версий Visual Studio Build Tools, MSBuild
может выбрать toolset, для которого не установлены Spectre-библиотеки, и сборка
упадёт с ошибкой:

```text
error MSB8040: для этого проекта требуются библиотеки с устранением рисков Spectre
```

Для текущей Windows-машины рабочий вариант — явно выбрать установленный MSVC
toolset `14.41.34120`, у которого есть `lib\spectre`:

```powershell
$env:VCToolsVersion='14.41.34120'
npm run electron:build
```

Чтобы закрепить это для новых терминалов:

```powershell
setx VCToolsVersion 14.41.34120
```

После `setx` нужно закрыть PowerShell и открыть заново. Альтернатива — через
Visual Studio Installer установить компонент `MSVC ... библиотеки C++ x64/x86,
защищенные от Spectre` именно для той версии MSVC, которую выбирает сборка.

## Иконка

Источник иконки — `assets/icon.svg` (векторный) и растеризованный
`assets/icon.png` (1024×1024), на который ссылается `build.icon` в
`package.json`. `electron-builder` сам генерирует из него `.icns` (macOS) и
`.ico` (Windows) — отдельные файлы под каждую платформу готовить не нужно.

Чтобы поменять иконку: отредактируйте `assets/icon.svg`, затем перегенерируйте
PNG, например через `sips` на macOS:

```bash
sips -s format png assets/icon.svg --out assets/icon.png -Z 1024
```

## Версия

Единственный источник версии — поле `"version"` в `package.json`. Из него же
её читает `/api/health` (см. `server/infrastructure/http/server.ts`) и
показывает в подвале бокового меню в приложении. Отдельно нигде дублировать
версию не нужно.

## Релиз в GitHub Releases

Релиз собирается и публикуется автоматически через
`.github/workflows/release.yml` при пуше тега вида `vX.Y.Z`:

```bash
npm version 0.2.0   # обновит package.json и создаст git-тег v0.2.0
git push --follow-tags
```

Workflow соберёт `.dmg` и `.exe` на `macos-latest`/`windows-latest` и
прикрепит их к GitHub Release — публикация идёт через `electron-builder
--publish=always` (скрипт `electron:release`), используя встроенный
`GITHUB_TOKEN`, без дополнительной настройки секретов.

Сборки не подписаны сертификатом разработчика — при первом запуске
пользователи увидят предупреждение Gatekeeper (macOS) или SmartScreen
(Windows). Шаги обхода описаны в README.
