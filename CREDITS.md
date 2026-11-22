# Благодарности и лицензии

Лицензии указаны по состоянию на выбор версий; перед сдачей сверьте с `node_modules/*/LICENSE`.

## Библиотеки

| что | для чего | лицензия |
|---|---|---|
| React, React DOM, React Router | интерфейс и маршруты | MIT |
| three.js | WebGL-рендер отпечатка | MIT |
| Dexie | IndexedDB | Apache-2.0 |
| exifr | EXIF: время и GPS съёмки | MIT |
| Meyda | RMS, спектральный центроид, амплитудный спектр | MIT |
| web-audio-beat-detector | темп и первая доля | MIT |
| @huggingface/transformers (transformers.js) | карта глубины в браузере | Apache-2.0 |
| onnxruntime-web (зависимость transformers.js) | выполнение модели: WebGPU / WASM | MIT |
| JSZip | ZIP папки дня | MIT или GPLv3 (двойная) — используем на условиях MIT |
| jpeg-js | сборка демо-дней (кодирование заглушек, чтение фото) | BSD-3-Clause |
| Express | API-сервер | MIT |
| zod | валидация запросов и ответов | MIT |
| @anthropic-ai/sdk | Claude для анализа дня | MIT |
| openai | OpenAI для анализа и озвучки | Apache-2.0 |
| Vite, TypeScript, tsx, concurrently | сборка, тесты, разработка | MIT / Apache-2.0 |

## Модели

| модель | для чего | лицензия / условия |
|---|---|---|
| Depth Anything V2 **Small** (`onnx-community/depth-anything-v2-small`) | карта глубины: параллакс и туман | Apache-2.0. Только Small: у Base и Large некоммерческая лицензия CC-BY-NC-4.0 |
| Claude (`claude-opus-5-5` по умолчанию), Anthropic | смысл текста и кадров → JSON по схеме | Anthropic Commercial Terms; текст и кадры уходят провайдеру только при заданном ключе |
| OpenAI (`gpt-4.1-mini` по умолчанию) | то же, альтернативный провайдер | OpenAI Terms of Use |
| OpenAI `gpt-4o-mini-tts` | озвучка текста дня | OpenAI Terms of Use; голос синтезирован — в интерфейсе это указано |

Веса модели глубины скачиваются с Hugging Face Hub при первом использовании и кэшируются браузером;
WASM onnxruntime-web входит в сборку и раздаётся тем же сервером. Фото при этом не покидают браузер.

## Шрифты

| шрифт | лицензия |
|---|---|
| Caveat (@fontsource/caveat) | SIL OFL 1.1 |
| JetBrains Mono (@fontsource/jetbrains-mono) | SIL OFL 1.1 |
| Playfair Display, курсив заголовка на входе (@fontsource/playfair-display) | SIL OFL 1.1 |
| DSEG7 Classic, Keshikan (npm `dseg`) | SIL OFL 1.1 |

## API и данные

| сервис | для чего | условия |
|---|---|---|
| Deezer API | поиск треков, 30-секундные превью, BPM, обложки | Deezer API Terms; превью проксируются на лету и не сохраняются (кроме записи `memory.webm`, см. README) |
| iTunes Search API | запасной поиск и превью | Apple Search API terms |
| oEmbed (Spotify, YouTube, SoundCloud) | название трека по ссылке | условия соответствующих сервисов |

Демо-дни ссылаются на треки Deezer: John Legend — All of Me, Avicii — Levels, Sam Smith — Stay With Me,
Calvin Harris — Summer, Radiohead — No Surprises. Аудио в репозитории нет.

## Изображения

Фото демо-дней — процедурные заглушки (градиенты и фигуры, `client/scripts/build-demo.ts`), не нейросеть.
Тестовая таблица `/lab` рисуется кодом; цвета полей — приблизительные значения классической таблицы ColorChecker.

## Алгоритмы

- Профили тональностей Крумхансла — Кесслера (Krumhansl & Kessler, 1982).
- Палитра — собственная реализация median cut.

## Звуки

Своих звуков нет: звучат только превью выбранной песни, файл пользователя и синтезированная озвучка.
