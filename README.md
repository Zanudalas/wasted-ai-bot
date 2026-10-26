# WASTED AI — Discord-бот для генерации видео

Discord-бот на Node.js + discord.js, который генерирует видео с помощью двух моделей:

| Команда | Модель | Провайдер | Длительность | Звук |
| --- | --- | --- | --- | --- |
| `/generate_seedance` | **Seedance 2.5** | ByteDance | 4–30 с или `auto` | да (можно отключить) |
| `/generate_omni` | **Gemini Omni Flash** (`gemini-omni-1.1-flash`) | Google | 3–10 с | да |
| `/ping` | Пинг бота | — | — | — |
| `/status` | Статус: пинг, аптайм, память, модели | — | — | — |

Обе модели работают через **kie.ai** или **fal.ai** — бот сам выбирает провайдера по заданному ключу
(`KIE_API_KEY` приоритетнее, иначе `FAL_KEY`). Оба провайдера хостят Seedance 2.5 и Gemini Omni Flash.

---

## English summary

**WASTED AI** is a self-hosted Discord bot (Node.js + discord.js) that generates short AI videos on demand:

- `/generate_seedance` — ByteDance **Seedance 2.5**
- `/generate_omni` — Google **Gemini Omni Flash**
- `/ping`, `/status` — health checks, including live provider balance

The bot abstracts two inference providers (**fal.ai** and **kie.ai**) behind one interface: switching providers is a
single environment variable (`KIE_API_KEY` takes priority over `FAL_KEY`). The adapter translates semantic
parameters (prompt, duration, aspect ratio, resolution, audio) into each provider's schema, polls the task queue
with progress updates, checks credits before spending, and falls back to a download link when a video exceeds the
Discord upload limit.

Motivation: make generative video accessible to small communities that cannot afford per-seat SaaS tools — a single
hosted bot instance serves a whole server, and the source stays easy to audit and self-host.

Built and maintained as an open-source personal/community project. MIT licensed.

---

## 1. Быстрый старт

```bat
start.bat
```

`start.bat` сам добавляет встроенный Node.js (`tools\node-v22.20.0-win-x64`) в PATH и запускает бота.
Бот уже авторизован — при старте в консоли появится:

```
[ready] logged in as WASTED AI!#2310 (1553835568071319552)
[commands] registered 4 commands in "WASTED AI / PRIVATE"
```

Остановить: `Ctrl + C` в окне консоли.

---

## 2. Ключ для генерации видео (обязательно для `/generate_*`)

Без ключа `/ping` и `/status` работают, а генерация отвечает подсказкой.

### Вариант А — kie.ai (есть бесплатные кредиты)

1. Зарегистрируйся на [kie.ai](https://kie.ai) — новым аккаунтам дают **80 бесплатных кредитов** ($0.40).
2. Открой [kie.ai/api-key](https://kie.ai/api-key) и создай ключ.
3. Вставь в `.env`:

```ini
KIE_API_KEY=твой_ключ_сюда
```

4. Перезапусти бота. Проверка: `/status` покажет реальный остаток кредитов.

Сколько стоит: Omni 1.1 Flash — 63 кредита за 4 с (720p), 105 за 8 с; Seedance 2.5 — от 112 кредитов
(4 с, 480p). То есть 80 бесплатных кредитов хватает ровно на один клип Omni 4 с — для Seedance нужен докредит.

### Вариант Б — fal.ai

1. Зарегистрируйся на [fal.ai](https://fal.ai) (вход через GitHub/Google).
2. Пополни баланс: **Dashboard → Billing → Add funds**. Без баланса fal вернёт `403` («Exhausted balance»).
3. Открой [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys) → **Add key** → скопируй ключ.
4. Вставь в `.env`:

```ini
FAL_KEY=твой_ключ_сюда
```

5. Перезапусти бота (`start.bat`).

Проверка: `/status` покажет состояние ключа и баланса. Если ключей несколько, приоритет — `KIE_API_KEY`;
принудительно выбрать провайдера можно строкой `PROVIDER=kie` или `PROVIDER=fal`.

> `.env` уже в `.gitignore` — ключ не попадёт в репозиторий. Никому не пересылай токен бота и ключи.

---

## 3. Команды и параметры

### `/generate_seedance`
| Параметр | Значения | По умолчанию |
| --- | --- | --- |
| `prompt` | текст до 2000 символов | обязателен |
| `duration` | `auto`, 4–30 с | `auto` |
| `aspect_ratio` | `auto`, `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `21:9` | `auto` |
| `resolution` | `480p`, `720p`, `1080p` | `720p` |
| `audio` | да / нет | да |

### `/generate_omni`
| Параметр | Значения | По умолчанию |
| --- | --- | --- |
| `prompt` | текст до 2000 символов | обязателен |
| `duration` | 3–10 с | 8 |
| `aspect_ratio` | `16:9`, `9:16` | `16:9` |

### `/ping`
WebSocket-heartbeat, время ответа на команду, время правки сообщения, shard, аптайм.

### `/status`
Пинг, аптайм, число серверов, память (RSS/heap), версии Node.js и discord.js,
активный провайдер, состояние ключа и баланса, список моделей.

Как это выглядит в чате: сообщение «Генерация видео — …» обновляется (позиция в очереди → сколько прошло),
затем в том же сообщении появляется готовый `.mp4` вложением и кнопка «Открыть видео».
Готовое видео приходит с упоминанием автора запроса (`@ник`), так что его не потерять в чате.

Перед отправкой на видео накладывается водяной знак из `assets/watermark.png`
(локально, через ffmpeg). Логотип уже вырезан из зелёного фона — прозрачный PNG.

---

## 4. Настройки (`.env`)

| Переменная | По умолчанию | Описание |
| --- | --- | --- |
| `DISCORD_TOKEN` | — | токен бота (обязателен) |
| `KIE_API_KEY` | пусто | ключ kie.ai; если задан — используется он (80 бесплатных кредитов новым аккаунтам) |
| `FAL_KEY` | пусто | ключ fal.ai (нужен положительный баланс) |
| `PROVIDER` | авто | `kie` или `fal` — принудительный выбор провайдера |
| `GUILD_ID` | пусто | ID сервера для мгновенной регистрации команд |
| `COOLDOWN_SECONDS` | `60` | кулдаун генерации на пользователя (админы игнорируются) |
| `MAX_UPLOAD_MB` | `50` | жёсткий потолок вложения в МБ (фактический лимит Discord зависит от буст-уровня; если видео больше — придёт ссылка) |
| `GENERATION_TIMEOUT_MS` | `720000` | максимум ожидания генерации |
| `POLL_INTERVAL_MS` | `2500` | интервал опроса статуса |
| `PROGRESS_UPDATE_MS` | `6000` | как часто обновляется сообщение с прогрессом |
| `WATERMARK` | `1` | `0` — выключить водяной знак |
| `WATERMARK_PATH` | `assets/watermark.png` | PNG-логотип (прозрачный фон) |
| `WATERMARK_SCALE` | `0.16` | размер логотипа как доля ширины видео |
| `WATERMARK_OPACITY` | `0.85` | прозрачность логотипа (0–1) |
| `FFMPEG_PATH` | авто | путь к ffmpeg, если он не в `tools/ffmpeg/ffmpeg.exe` |

---

## 5. Как это устроено

```
src/
  index.js              вход: логин, регистрация команд, обработчик слэш-команд
  config.js             переменные окружения + описание моделей
  commands/
    index.js            реестр команд
    generation.js       общий пайплайн: кулдаун → очередь → прогресс → скачивание → отправка
    seedance.js         /generate_seedance
    omni.js             /generate_omni
    ping.js             /ping
    status.js           /status
  providers/
    index.js            выбор провайдера (kie.ai / fal.ai), общий интерфейс
    kie.js              kie.ai: createTask → recordInfo, остаток кредитов
    fal.js              очередь fal.ai: submit → poll → result
    errors.js           ProviderError — единый тип ошибки
  utils/                форматирование, скачивание файла, водяной знак (ffmpeg)
    watermark.js        поиск ffmpeg, наложение PNG-логотипа
test/
  smoke.mjs             полный пайплайн генерации на моках
  commands.mjs          /ping и /status без живого gateway
  watermark.mjs         наложение логотипа на синтетический клип
```

Особенности:
- Команды регистрируются и глобально, и на каждом сервере — на сервере они появляются сразу.
- Прогресс идёт в одном сообщении (эдит), без спама.
- Файл скачивается во временную папку и удаляется после отправки.
- Если Discord отклонит вложение (лимит размера), бот автоматически пришлёт ссылку.
- Все ошибки переведены на русский: неверный ключ, нет баланса, таймаут, лимиты.
- В готовом сообщении бот упоминает автора запроса.
- Водяной знак накладывается локально (ffmpeg), без дополнительных затрат на API;
  если ffmpeg или логотип недоступны, видео уходит без знака.

---

## 6. Разработка

```bat
npm test        :: автотесты (не требуют ключей и интернета)
npm start       :: запуск
npm run dev     :: запуск с авто-перезагрузкой

:: управление слэш-командами приложения
node --env-file-if-exists=.env scripts/commands-admin.mjs list    :: показать все команды (глобальные и по серверам)
node --env-file-if-exists=.env scripts/commands-admin.mjs clean   :: удалить всё, чего нет в src/commands
node --env-file-if-exists=.env scripts/commands-admin.mjs reset   :: удалить все команды и зарегистрировать заново
```

### Водяной знак

Нужен `ffmpeg` (в репозиторий он не входит — бинарник ~160 МБ).
Положи `ffmpeg.exe` в `tools\ffmpeg\ffmpeg.exe` или укажи путь в `FFMPEG_PATH`.
Логотип — прозрачный PNG в `assets/watermark.png` (уже вырезан из зелёного фона).

Без ffmpeg бот продолжает работать: видео приходит без знака.

---

## 7. Если что-то не работает

| Симптом | Что делать |
| --- | --- |
| Команд не видно в чате | Перезапусти бота (регистрация на сервере) или подожди до часа (глобальные). Проверь, что у бота есть `applications.commands`. |
| Видны старые/удалённые команды | Это кэш клиента Discord: `Ctrl + R` в окне Discord. Серверные списки чистит `scripts/commands-admin.mjs reset`. |
| `Неверный FAL_KEY` | Ключ скопирован не полностью либо удалён на fal.ai. |
| `Доступ запрещён` (403) | На балансе fal.ai нет средств — пополни [fal.ai/dashboard/billing](https://fal.ai/dashboard/billing). |
| `Неверный KIE_API_KEY` | Ключ скопирован не полностью либо удалён на [kie.ai/api-key](https://kie.ai/api-key). |
| `На балансе kie.ai недостаточно кредитов` | Пополни [kie.ai/pricing](https://kie.ai/pricing); 4 с Omni ≈ 63 кредита, 4 с Seedance 480p ≈ 112. |
| Видео не пришло вложением | Файл больше `MAX_UPLOAD_MB` — бот прислал ссылку. Для 1080p/30 c это нормально. |
| `Превышено время ожидания` | Генерация 1080p/30 c может идти дольше — подними `GENERATION_TIMEOUT_MS`. |
| Бот офлайн | Запусти `start.bat`; проверь, что токен в `.env` не сброшен. |

---

## 8. Безопасность

Токен бота был передан в переписке открытым текстом. Если переписка не приватная —
перевыпусти токен: [Discord Developer Portal](https://discord.com/developers/applications) → твоё приложение →
**Bot → Reset Token**, затем вставь новый в `.env`. Старый токен после сброса перестанет работать.
