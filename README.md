# HARDY Fullstack Starter

Готовый монорепо-шаблон под твой кейс:

- **Desktop:** Electron
- **Backend:** Express + SQLite
- **Auth:** Discord OAuth2
- **Updates:** electron-updater + GitHub Releases
- **Mods:** категории, список, страница мода, админка
- **Install:** скачивание ZIP, backup, распаковка, замена файлов, rollback

## Что уже реализовано

- вход через Discord OAuth2 по deep link `hardy://auth-success`
- роли `user` / `admin`
- API для категорий и модов
- локальная админка в desktop-приложении
- установка ZIP в папку GTA V
- backup перед заменой файлов
- rollback при ошибке
- хранение данных в SQLite
- заготовка публикации обновлений через GitHub Releases

## Важно

Discord credentials уже положены **только в локальный env-файл сервера** и не должны коммититься в git.

Для **автозагрузки ZIP в GitHub Releases** тебе всё ещё нужен `GITHUB_TOKEN`.

## Быстрый старт

### 1. Установи зависимости
```bash
npm install
```

### 2. Запусти сервер
```bash
npm run dev:server
```

### 3. Запусти desktop
```bash
npm run dev:desktop
```

## Сборка Windows EXE
```bash
npm run dist:win
```

## Где что лежит

- `apps/server` — backend, Discord auth, API, SQLite
- `apps/desktop` — Electron app, UI, updater, installer

## GitHub Releases

Сейчас repo уже подставлен:
- owner: `hsoltanov2007-code`
- repo: `REDUXAPP`

Но чтобы **загружать моды в release автоматически**, добавь в `apps/server/.env.local`:
```env
GITHUB_TOKEN=your_github_token
```

## Как работает установка мода

1. пользователь нажимает установить
2. desktop скачивает ZIP
3. создаёт backup изменяемых файлов
4. распаковывает архив во временную папку
5. копирует файлы в GTA V
6. при ошибке делает rollback
7. пишет лог и сохраняет установку
