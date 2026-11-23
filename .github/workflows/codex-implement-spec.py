"""Validate the agreed implementation before handing repository data to Codex."""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

OWNER = "www-lexa-pro"
REPO = f"{OWNER}/ai-for-developers-project-387"
COMMIT = "8d57905dd7c4760a1339d811ff6396c116002235"
APPROVAL = 7062208806
AGREEMENT = (
    "Согласовано. Берём в работу спецификацию #10 и тикеты #11, #12 и #13. "
    "Сначала выполняем #11, затем #12 и #13. Тема необязательна и показывается "
    "в списке предстоящих записей, если указана."
)


def api(path, *, pages=False):
    flags = ["--paginate", "--slurp"] if pages else []
    data = json.loads(subprocess.check_output(["gh", "api", *flags, f"repos/{REPO}/{path}"]))
    return [item for page in data for item in page] if pages else data


def require(condition, message):
    if not condition:
        raise ValueError(message)


def route(event):
    issue = event.get("issue", {})
    comment = event.get("comment", {})
    user = comment.get("user", {})
    require(
        event.get("action") == "created"
        and event.get("repository", {}).get("full_name") == REPO
        and issue.get("state") == "open"
        and "pull_request" not in issue
        and user.get("type") == "User"
        and user.get("login") == OWNER,
        "Команда доступна владельцу в новом комментарии к открытому issue.",
    )
    match = re.fullmatch(r"/oc[ \t]+implement-spec[ \t]+#([1-9][0-9]*)[ \t]*",
                         comment.get("body", ""), re.IGNORECASE)
    require(match, "Синтаксис: /oc implement-spec #10 в исходном issue #5.")
    require((issue.get("number"), int(match[1])) == (5, 10),
            "Для этого маршрута согласована только спецификация #10 в issue #5.")
    return 5, 10


def prepare(event):
    source, number = route(event)
    requested_at = event["comment"]["created_at"]
    issue = api(f"issues/{source}")
    require(issue["state"] == "open", "Исходное обращение закрыто.")
    approval = api(f"issues/comments/{APPROVAL}")
    require(
        approval["issue_url"] == f"https://api.github.com/repos/{REPO}/issues/{source}"
        and approval["user"]["login"] == OWNER
        and approval["user"]["type"] == "User"
        and approval["body"].strip() == AGREEMENT
        and approval["updated_at"] <= requested_at,
        "Не найдено действующее согласование владельца по #10 и #11–#13.",
    )
    spec = api(f"issues/{number}")
    require(spec["state"] == "open" and spec["body"].startswith("<!-- codex-spec source=5 -->"),
            "Спецификация закрыта или не связана с исходным обращением.")
    require(spec["updated_at"] <= requested_at, "Спецификация #10 изменилась после команды.")
    tickets = {ticket["number"]: ticket for ticket in api(f"issues/{number}/sub_issues", pages=True)}
    require(set(tickets) == {11, 12, 13}, "Состав тикетов отличается от согласованного.")
    graph = {11: set(), 12: {11}, 13: {11}}
    for ticket, expected in graph.items():
        require(tickets[ticket]["state"] == "open", f"Изменился статус тикета #{ticket}.")
        require(tickets[ticket]["updated_at"] <= requested_at,
                f"Тикет #{ticket} изменился после команды.")
        blockers = api(f"issues/{ticket}/dependencies/blocked_by", pages=True)
        local = {item["number"] for item in blockers
                 if item["repository_url"] == f"https://api.github.com/repos/{REPO}"}
        require(local == expected and len(blockers) == len(expected),
                f"Изменились зависимости #{ticket}.")
    pull = api("pulls/17")
    require(pull["state"] == "open" and pull["head"]["repo"]["full_name"] == REPO
            and pull["head"]["ref"] == "feat/387-booking-topic" and pull["base"]["ref"] == "main",
            "PR #17 больше не подходит как источник #11.")
    require(any(item["sha"] == COMMIT for item in api("pulls/17/commits", pages=True)),
            "Коммит #11 отсутствует в PR #17.")
    return {
        "mode": "implement-spec", "source": source, "spec": number,
        "order": [[11], [12, 13]], "specification": spec["body"],
        "tickets": {key: value["body"] for key, value in tickets.items()},
        "approval": approval["html_url"],
    }


if __name__ == "__main__":
    try:
        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
        context = prepare(event)
    except (ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        print(f"Подготовка остановлена. {error}", file=sys.stderr)
        sys.exit(1)
    Path(os.environ["RUNNER_TEMP"], "implement-spec.json").write_text(
        json.dumps(context, ensure_ascii=False, indent=2)
    )
    print("mode=implement-spec\nsource=5\nspec=10\norder=#11 → #12, #13")
