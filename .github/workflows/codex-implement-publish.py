"""Find or publish the single implementation PR for the approved specification."""
import json
import os
import subprocess
import sys
from pathlib import Path

BRANCH = "implement/spec-10"
REF = f"refs/heads/{BRANCH}"
BASE = "main"


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def main(mode):
    repo = os.environ["GITHUB_REPOSITORY"]
    owner = repo.split("/")[0]
    token_id = os.environ["TRUSTED_BOT_ID"]
    if mode == "publish":
        if os.environ["APP_SLUG"] != "hexlet-ai" or not token_id or token_id != run(
            "gh", "api", "users/hexlet-ai%5Bbot%5D", "--jq", ".id"
        ):
            raise ValueError("ID приложения не совпадает с PR_REVIEW_APP_BOT_ID.")

    pages = json.loads(run(
        "gh", "api", "--paginate", "--slurp", "--method", "GET", f"repos/{repo}/pulls",
        "-f", f"base={BASE}", "-f", f"head={owner}:{BRANCH}", "-f", "state=all",
    ))
    pulls = [pr for page in pages for pr in page]
    if pulls:
        if len(pulls) != 1 or str(pulls[0]["user"]["id"]) != token_id:
            raise ValueError("Для ветки найден чужой PR или несколько PR.")
        output("pr", pulls[0]["html_url"])
        return

    ref = run("git", "ls-remote", "origin", REF)
    remote_sha = ref.split()[0] if ref else ""
    if mode == "inspect":
        output("remote_sha", remote_sha)
        return

    sha = os.environ["CHECKED_SHA"]
    bundle = Path(os.environ["RUNNER_TEMP"], "implement-artifact", "result.bundle")
    run("git", "fetch", str(bundle), REF)
    if run("git", "rev-parse", "FETCH_HEAD") != sha:
        raise ValueError("Коммит артефакта отличается от проверенного SHA.")
    if remote_sha and remote_sha != sha:
        raise ValueError("Ветка изменилась после проверок.")
    if not remote_sha:
        run("gh", "auth", "setup-git")
        # An empty lease permits only creation, even if another writer races the check.
        run("git", "push", f"--force-with-lease={REF}:", "origin", f"{sha}:{REF}")

    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    context = json.loads(Path(os.environ["RUNNER_TEMP"], "implement-spec.json").read_text())
    url = f"{os.environ['GITHUB_SERVER_URL']}/{repo}"
    log = f"{url}/actions/runs/{os.environ['GITHUB_RUN_ID']}/attempts/{os.environ['CHECK_ATTEMPT']}"
    body = f"""## Что изменилось

Тема звонка в бронировании. [Обращение #5]({url}/issues/5),
[команда]({event['comment']['html_url']}), [спецификация #10]({url}/issues/10),
[тикет #11]({url}/issues/11), [тикет #12]({url}/issues/12), [тикет #13]({url}/issues/13)
и [согласование]({context['approval']}).

## Проверки

- `mise run check` — успешно на `{sha}`. [Прогон]({log})

## Риск

Может нарушиться создание бронирования у гостя или показ темы в списке владельца.

## Откат

Отменить коммиты этого PR в Git и повторить бронирование без темы
и просмотр предстоящих записей. Проверить полный набор через `mise run check`.
"""
    output("pr", run("gh", "pr", "create", "--repo", repo, "--base", BASE, "--head", BRANCH,
                     "--title", "Показать тему звонка в списке предстоящих записей", "--body", body))


def output(name, value):
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as stream:
        print(f"{name}={value}", file=stream)


if __name__ == "__main__":
    main(sys.argv[1])
