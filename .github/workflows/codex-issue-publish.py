"""Publish the validated output of the manual Codex commands."""

import base64
import json
import os
import re
import subprocess
import sys

REPO = os.environ["GITHUB_REPOSITORY"]
API = f"repos/{REPO}"
BOT = "github-actions[bot]"
LABEL = "ready-for-agent"
PLAN_PREFIX = "<!-- codex-ticket-plan:"
PLAN_MAX_BYTES = 45000


class GitHubError(RuntimeError):
    pass


def reject_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"повторяющееся поле JSON: {key}")
        result[key] = value
    return result


def parse_answer(payload):
    return json.loads(payload, object_pairs_hook=reject_duplicate_keys)


def api(path, payload=None, *, paginate=False):
    command = ["gh", "api", path]
    if paginate:
        command.extend(["--paginate", "--slurp"])
    if payload is not None:
        command.extend(["--method", "POST", "--input", "-"])
    result = subprocess.run(
        command, input=None if payload is None else json.dumps(payload),
        capture_output=True, text=True, timeout=30, check=False,
    )
    if result.returncode:
        raise GitHubError(result.stderr.strip())
    data = json.loads(result.stdout)
    return [item for page in data for item in page] if paginate else data


def validate_text(record, limit):
    title, body = record.get("title"), record.get("body")
    if (not isinstance(title, str) or not title.strip()
            or len(title) > 256 or len(title.splitlines()) != 1
            or title != title.strip() or any(ord(char) < 32 for char in title)
            or not isinstance(body, str) or not body.strip()
            or len(body) > limit or "\x00" in body):
        raise ValueError("некорректный заголовок или текст")


def validate_plan(data):
    if not isinstance(data, dict) or set(data) != {"tickets"}:
        raise ValueError("ожидался объект с полем tickets")
    tickets = data["tickets"]
    if not isinstance(tickets, list) or not 1 <= len(tickets) <= 20:
        raise ValueError("ожидалось от 1 до 20 тикетов")
    by_id = {}
    for ticket in tickets:
        if not isinstance(ticket, dict) or set(ticket) != {"id", "title", "body", "blocked_by"}:
            raise ValueError("некорректные поля тикета")
        validate_text(ticket, 12000)
        key, blockers = ticket["id"], ticket["blocked_by"]
        if (not isinstance(key, str) or not re.fullmatch(r"[a-z0-9-]{1,40}", key)
                or key in by_id or not isinstance(blockers, list)
                or not all(isinstance(item, str) for item in blockers)
                or len(set(blockers)) != len(blockers)):
            raise ValueError("некорректные идентификаторы тикетов или зависимостей")
        by_id[key] = ticket
    if any(set(ticket["blocked_by"]) - by_id.keys() for ticket in tickets):
        raise ValueError("зависимость ссылается на неизвестный тикет")
    ordered = []
    done = set()
    pending = dict(by_id)
    while pending:
        ready = [key for key, ticket in pending.items() if set(ticket["blocked_by"]) <= done]
        if not ready:
            raise ValueError("циклические зависимости")
        for key in ready:
            ordered.append(pending.pop(key))
            done.add(key)
    return ordered


def first_line(issue):
    return (issue.get("body") or "").partition("\n")[0]


def is_bot(item):
    return item["user"]["login"] == BOT


def find_issue(issues, marker):
    matches = [issue for issue in issues if first_line(issue) == marker]
    if len(matches) > 1:
        raise ValueError(f"найдено несколько issue с отметкой {marker}")
    return matches[0] if matches else None


def create_issue(record, prefix):
    return api(f"{API}/issues", {
        "title": record["title"], "body": f'{prefix}\n\n{record["body"]}',
        "labels": [LABEL],
    })


def publish_spec(issues, source, answer, report):
    marker = f"<!-- codex-spec source={source} -->"
    issue = find_issue(issues, marker)
    if issue is None:
        data = parse_answer(answer)
        if not isinstance(data, dict) or set(data) != {"title", "body"}:
            raise ValueError("ожидалась спецификация с полями title и body")
        validate_text(data, 12000)
        issue = create_issue(data, f"{marker}\nИсходное обращение: #{source}")
    report.append(f'Спецификация — {issue["html_url"]}')


def load_plan(spec, answer):
    path = f"{API}/issues/{spec}/comments"
    comments = api(f"{path}?per_page=100", paginate=True)
    saved = [first_line(item) for item in comments
             if is_bot(item) and first_line(item).startswith(PLAN_PREFIX)]
    if len(saved) > 1:
        raise ValueError("найдено несколько сохранённых планов")
    if saved:
        match = re.fullmatch(r"<!-- codex-ticket-plan:([A-Za-z0-9+/=]+) -->", saved[0])
        if not match:
            raise ValueError("повреждён сохранённый план")
        return validate_plan(parse_answer(base64.b64decode(match[1], validate=True)))
    if len(answer.encode("utf-8")) > PLAN_MAX_BYTES:
        raise ValueError("план превышает допустимый размер в UTF-8")
    data = parse_answer(answer)
    ordered = validate_plan(data)
    serialized = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(serialized) > PLAN_MAX_BYTES:
        raise ValueError("план превышает допустимый размер")
    encoded = base64.b64encode(serialized).decode()
    # Persist the plan before creating any issues so retries keep the same IDs and graph.
    api(path, {"body": f"{PLAN_PREFIX}{encoded} -->\nПлан публикации тикетов Codex."})
    return ordered


def ensure_link(path, field, target, report):
    try:
        existing = api(f"{path}?per_page=100", paginate=True)
        if not any(item["id"] == target["id"] for item in existing):
            api(path, {field: target["id"]})
    except GitHubError as error:
        # A 403 can be temporary throttling. Only explicit unsupported methods use text links.
        if not re.search(r"HTTP (405|501)\b", str(error)):
            raise
        note = "Часть связей представлена текстовыми ссылками в тикетах."
        if note not in report:
            report.append(note)


def publish_tickets(issues, spec, source, answer, report):
    specification = api(f"{API}/issues/{spec}")
    if ("pull_request" in specification or not is_bot(specification)
            or first_line(specification) != f"<!-- codex-spec source={source} -->"):
        raise ValueError("ссылка больше не указывает на спецификацию этого workflow")
    tickets = load_plan(spec, answer)
    published = {}
    for ticket in tickets:
        key = ticket["id"]
        marker = f"<!-- codex-ticket spec={spec} id={key} -->"
        existing = find_issue(issues, marker)
        if existing:
            published[key] = existing
            report.append(f'- {existing["html_url"]} (существующий)')
    for ticket in tickets:
        key = ticket["id"]
        blockers = [published[item] for item in ticket["blocked_by"]]
        if key not in published:
            prefix = f"<!-- codex-ticket spec={spec} id={key} -->\nPart of #{spec}\nИсходное обращение: #{source}"
            if blockers:
                prefix += "\nBlocked by " + ", ".join(f'#{item["number"]}' for item in blockers)
            published[key] = create_issue(ticket, prefix)
            report.append(f'- {published[key]["html_url"]} (создан)')
        issue = published[key]
        ensure_link(f"{API}/issues/{spec}/sub_issues", "sub_issue_id", issue, report)
        for blocker in blockers:
            ensure_link(f'{API}/issues/{issue["number"]}/dependencies/blocked_by', "issue_id", blocker, report)


def main():
    target = int(os.environ["ISSUE_NUMBER"])
    mode = os.environ["MODE"]
    answer = os.environ.get("CODEX_ANSWER", "")
    report = []
    failed = False
    try:
        repository = api(API)
        if repository["full_name"] != REPO:
            raise ValueError("репозиторий публикации не совпадает с целевым")
        issues = api(f"{API}/issues?state=all&per_page=100", paginate=True)
        issues = [issue for issue in issues if "pull_request" not in issue and is_bot(issue)]
        if mode == "to-spec":
            publish_spec(issues, target, answer, report)
        elif mode == "to-tickets":
            publish_tickets(issues, int(os.environ["SPEC_NUMBER"]),
                            int(os.environ["SOURCE_NUMBER"]), answer, report)
        else:
            raise ValueError("неизвестная команда публикации")
    except (ValueError, GitHubError, subprocess.TimeoutExpired) as error:
        print(f"Publication stopped: {error}", file=sys.stderr)
        if not report:
            report.append("Подтверждённых опубликованных issue пока нет.")
        report.append("Публикация прервана. Повторите ту же команду, чтобы продолжить с уже созданных issue.")
        failed = True
    run_url = f'{os.environ["GITHUB_SERVER_URL"]}/{REPO}/actions/runs/{os.environ["GITHUB_RUN_ID"]}'
    report.append(f"[Прогон GitHub Actions]({run_url})")
    body = "\n\n".join(report)
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
        summary.write(body + "\n")
    api(f"{API}/issues/{target}/comments", {"body": body})
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
