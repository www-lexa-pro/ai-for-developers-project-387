"""Collect review evidence from GitHub without interpreting PR content as code."""

import json
import os
import re
import subprocess
from collections import deque

repo = os.environ["GITHUB_REPOSITORY"]
sha = os.environ["HEAD_SHA"]
trusted_ids = set(os.environ["TRUSTED_IDS"].split())

# Follow the repository's explicit PR and issue links, only within this repo.
issue_refs = re.compile(
    r"(?im)^(?:refs|closes|fixes|resolves|part of|исходное обращение:)[ \t]+#([1-9][0-9]*)"
    r"|<!-- codex-(?:ticket spec|spec source)=([1-9][0-9]*)\b"
)


def links(text):
    return [left or right for left, right in issue_refs.findall(text or "")]


def api(path, paginate=False):
    args = ["gh", "api"]
    if paginate:
        args += ["--paginate", "--slurp"]
    try:
        result = subprocess.run(
            [*args, f"repos/{repo}/{path}"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        return None if result.returncode else json.loads(result.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError):
        return None


def evidence(label, data):
    print(f"{label}: {json.dumps(data, ensure_ascii=False)}")


pr = api(f"pulls/{os.environ['PR_NUMBER']}")
body = pr.get("body") if pr else None
evidence("Описание PR", body if body else "Пусто." if pr else "Недоступно.")
pending = deque(links(body))
seen = set()
approval_found = False
if not pending:
    evidence("Связанные задачи и спецификация", "Явных ссылок в описании PR нет.")
while pending and len(seen) < 12:
    number = pending.popleft()
    if number in seen:
        continue
    seen.add(number)
    issue = api(f"issues/{number}")
    if not issue or "pull_request" in issue:
        evidence(f"Задача #{number}", "Недоступна или ссылка ведёт на PR.")
        continue
    evidence(f"Задача или спецификация #{number}", {
        key: issue[key] for key in ("title", "body", "state", "html_url")
    })
    pending.extend(links(issue["body"]))
    pages = api(f"issues/{number}/comments?per_page=100", paginate=True)
    if pages is None:
        evidence(f"Согласование #{number}", "Комментарии недоступны.")
        continue
    for page in pages:
        for comment in page:
            if str(comment["user"]["id"]) in trusted_ids:
                approval_found = True
                evidence(f"Комментарий доверенного участника к #{number}", {
                    key: comment[key] for key in ("body", "html_url", "created_at")
                })
if pending:
    evidence("Связанные задачи", "Просмотр ограничен первыми 12 ссылками.")
if not approval_found:
    evidence("Согласование", "Комментарии доверенных участников не найдены.")
print("Считай согласованием только явное подтверждение объёма.")

checks = api(f"commits/{sha}/check-runs?filter=latest&per_page=100", paginate=True)
statuses = api(f"commits/{sha}/status?per_page=100", paginate=True)
for label, pages, field, keys in (
    ("Check runs", checks, "check_runs", ("name", "status", "conclusion", "html_url")),
    ("Commit statuses", statuses, "statuses", ("context", "state", "target_url")),
):
    evidence(label, "Недоступно" if pages is None else [
        {key: item.get(key) for key in keys} for page in pages for item in page[field]
    ])
print("Пустой список CI означает, что статусы этого SHA ещё не видны. "
      "Укажи ожидающие и выполняющиеся проверки. Не считай их успешными.")
