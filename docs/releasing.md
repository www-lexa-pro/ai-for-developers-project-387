# Выпуск версии

У приложения одна версия для Go и React. Release-please собирает Conventional
Commits в PR с `CHANGELOG.md`, `version.txt` и `.release-please-manifest.json`.
После принятия этого PR в `main` следующий запуск создаёт тег `v<версия>` и
GitHub Release. Сборка, развёртывание, npm publish и Docker сюда не входят.

## Начальная версия и история

Корневой пакет использует стратегию `simple`. При первоначальной настройке
manifest был пустым, а `version.txt` содержал исходное `0.0.0`.
`initial-version: 0.1.0` задаёт первую предлагаемую версию, а не принудительную
версию каждого следующего выпуска. После первого выпуска версия вычисляется
по Conventional Commits: `feat` повышает minor, `fix` — patch,
`BREAKING CHANGE` — major. Документация и служебные изменения сами по себе
обычно не создают релиз.

`bootstrap-sha` указывает на `2f2a9c27535076ca3ac28e8eeba48643324bf51b`:
коммиты после него включают первую реальную функцию каталога #6. После первого
принятого release PR эта граница больше не применяется. Не нужно добавлять
фиктивный `feat` или вручную создавать тег для запуска автоматики.

## Перенос в репозиторий продолжения

В историю 387 перенесён тег `v0.1.0` первого календаря. GitHub Release
первого проекта и задачи о его настройке доступны в 386.

## Настройки владельца

В Settings → Actions → General → Workflow permissions включить
**Allow GitHub Actions to create and approve pull requests**. Политика
организации может запрещать эту настройку — тогда её меняет владелец организации.
В первом проекте (386) проверка API 16.11.2026 показала `can_approve_pull_request_reviews: false`:
создание PR тогда требовало этого действия владельца. 17 ноября по прямому
поручению Алексея настройка включена: API подтвердил
`can_approve_pull_request_reviews: true`; разрешение по умолчанию осталось `read`.

Workflow запрашивает `contents: write` для ветки/тега/Release и
`pull-requests: write` для release PR и `issues: write` для служебных меток
release-please; используется встроенный `GITHUB_TOKEN`,
добавлять секрет не нужно. Вне release job остаётся `contents: read`.
Защита `main`, требуемые проверки и правила создания тегов продолжают действовать;
автоматического принятия PR нет.

События от `GITHUB_TOKEN` не запускают другие workflows. Поэтому созданный ботом
release PR не получает обычные проверки по push/pull_request автоматически.
Перед его принятием проверить **точную вершину** ветки PR локально командой
`mise run check` и `node scripts/check-commits.mjs`. Если правила требуют именно
GitHub checks и не разрешают принятие, остановиться: применение GitHub App/PAT
или изменение правил требует отдельного решения владельца. В этом решении
другого токена нет. Release-событие также не запускает публикацию приложения.

## Проверка и выпуск

1. Принять настройку вместе с реальной функцией #6 в `main`. До этого workflow
   не работает: он слушает только push в `main` и ручной запуск на `main`.
2. Проверить запуск «Подготовка и выпуск версии» и созданный release PR.
   Первый ожидаемый результат: версия `0.1.0`, запись каталога в CHANGELOG,
   обновлённые `version.txt` и manifest. Проверить отсутствие лишних изменений.
3. Выполнить проверки точной вершины release PR, затем принять его в `main`.
4. Дождаться следующего запуска workflow; проверить GitHub Release `v0.1.0`,
   одноимённый тег и соответствие тега коммиту принятого release PR.
   Версия в manifest, `version.txt` и CHANGELOG должна совпадать.
   Только после этого подтверждён полный цикл #11.

Для повторного запуска после исправления разрешений можно выбрать Actions →
«Подготовка и выпуск версии» → Run workflow → `main`. Это настоящий запуск:
он может создать/обновить PR либо выпустить уже принятый release PR.

Для предварительного расчёта используется официальный CLI с `--dry-run`:

```bash
release-please release-pr \
  --repo-url=www-lexa-pro/ai-for-developers-project-387 \
  --target-branch=main --dry-run \
  --token=/path/to/protected-token-file
```

CLI версии 17.3.0 требует явный параметр `--token`: одной переменной
`GITHUB_TOKEN` недостаточно. Параметр принимает путь к файлу токена;
ограничьте доступ к нему владельцем и не сохраняйте его в Git. В workflow
токен передаёт сам action; дополнительный секрет для него не нужен.
CLI читает конфигурацию, manifest и историю **с GitHub**, а не из локального
checkout. Не печатайте токен в терминал или журнал. Для проверки до `main` нужна
опубликованная ветка с этой конфигурацией и `--target-branch=<ветка>`.
Dry-run показывает рассчитанные изменения PR, но не подтверждает право создать
PR, работу Actions или выпуск тега и Release.

17 ноября 2026 года официальный CLI 17.3.0 успешно выполнил `release-pr
--dry-run` для опубликованной ветки `integration/booking-spec-5`. Рассчитан один
PR версии `0.1.0` с пятью функциями #6–#10 и исправлениями; изменения затрагивают
только `CHANGELOG.md`, `version.txt` и `.release-please-manifest.json`.
Журнал проверки: `/mnt/projects/tmp/cal/implement-spec-5/release-dry-run-20261117.log`
(вне Git). Для запуска токен передавался через анонимный канал и не сохранялся
в файл или аргументы процесса.

## Подтверждённый первый выпуск — 17 ноября 2026 года

После успешных проверок исправлений интеграционная ветка включена в `main`
коммитом `8e8997e`. [Первый запуск workflow](https://github.com/www-lexa-pro/ai-for-developers-project-386/actions/runs/44088237844)
успешно создал [release PR #12](https://github.com/www-lexa-pro/ai-for-developers-project-386/pull/12).
Проверены только три ожидаемых файла: `CHANGELOG.md`, `version.txt` и manifest;
версия во всех них — `0.1.0`.

Точная вершина PR `063e03c6b5ff89311298b4e8ad591d940ed7efc3` прошла полный
`mise run check` (Go, 55 UI-тестов, настоящий Chromium E2E, линтеры, типы,
сборки, актуальность генерации), `node scripts/check-commits.mjs` и сверку
версии. PR принят с squash-коммитом
`fe3288c7e8ae2720d10461fe72cf45cc082acf46`; дерево файлов совпадает
с проверенной вершиной PR.

[Следующий запуск выпуска](https://github.com/www-lexa-pro/ai-for-developers-project-386/actions/runs/44088754443)
завершился успешно и создал тег `v0.1.0` и
[GitHub Release](https://github.com/www-lexa-pro/ai-for-developers-project-386/releases/tag/v0.1.0)
в 13:02:24 UTC. Релиз опубликован, не является draft или prerelease. Тег
получен через Git и разрешается в тот же коммит `fe3288c`; `version.txt`
и manifest внутри тега содержат `0.1.0`.

Для release-коммита также прошли
[проверки приложения](https://github.com/www-lexa-pro/ai-for-developers-project-386/actions/runs/44088754605)
и [Хекслет](https://github.com/www-lexa-pro/ai-for-developers-project-386/actions/runs/44088754527).
Полный цикл #11 подтверждён фактическим выпуском, а не только dry-run.

Источники: [action и ограничения токена](https://github.com/googleapis/release-please-action),
[manifest и начальная история](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md),
[схема initial-version](https://github.com/googleapis/release-please/blob/main/schemas/config.json),
[CLI](https://github.com/googleapis/release-please/blob/main/docs/cli.md).
