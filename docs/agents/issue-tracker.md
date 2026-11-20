# Трекер: GitHub Issues

Репозиторий: www-lexa-pro/ai-for-developers-project-387.
Адрес: https://github.com/www-lexa-pro/ai-for-developers-project-387/issues.
Используй gh из каталога проекта; перед первой записью проверяй
целевой репозиторий через gh repo view --json nameWithOwner.

Публикация спецификации означает создание GitHub Issue.
Чтение задачи: gh issue view <номер> --json number,title,body,labels,comments.
Создание: gh issue create --title "..." --body-file <файл>.
Список: gh issue list. Метки: gh issue edit --add-label / --remove-label.
Перед закрытием публикуй результат через gh issue comment, затем gh issue close.

Связывай дочерние задачи через GitHub sub-issues, зависимости — через
native issue dependencies. Если они недоступны, используй строки
Part of #<номер> и Blocked by: #<номер> в начале описания.
Задача готова к выполнению, когда все блокирующие задачи закрыты.

Для wayfinder карта — Issue с меткой wayfinder:map; дочерние задачи —
с метками wayfinder:research, wayfinder:prototype, wayfinder:grilling
или wayfinder:task. Выбирай первую свободную задачу без открытых
блокировок, назначай её на @me. После решения публикуй ответ,
закрывай задачу и добавляй ссылку с выводом в карту.

PRs as a request surface: no.
