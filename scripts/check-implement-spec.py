import json
import os
import runpy
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import patch

workflow = Path(".github/workflows/codex-issue.yml").read_text()
assert "ref: ${{ github.sha }}" in workflow.split("\n  implement-spec:", 1)[1]
gate = workflow.split("          # Validate before", 1)[1].split("\n\n  codex:", 1)[0]
gate = gate.split("\n", 1)[1]
gate = "\n".join(line[10:] for line in gate.splitlines())
with tempfile.TemporaryDirectory() as directory:
    out = Path(directory, "output")
    for command, expected in [
        ("/oc implement-spec #10", "implementation=true"),
        ("/oc \nimplement-spec #10", "implementation=true"),
        ("/oc\nimplement-spec #10", "implementation=true"),
        ("/octopus", ""),
        ("/oc implement-spec", "implementation=true"),
        ("/oc to-spec", "accepted=true"),
        ("/oc to-tickets #10", "accepted=true"),
    ]:
        out.write_text("")
        subprocess.run(["bash", "-e", "-c", gate], check=True, env={
            **os.environ, "COMMAND": command, "GITHUB_EVENT_NAME": "issue_comment",
            "GITHUB_OUTPUT": str(out),
        })
        assert out.read_text().strip() == expected

module = runpy.run_path(".github/workflows/codex-implement-spec.py")
prepare = module["prepare"]
repo = module["REPO"]
api_url = f"https://api.github.com/repos/{repo}"
user = {"login": module["OWNER"], "type": "User"}
time = "2026-11-23T00:00:00Z"
approval = {"issue_url": f"{api_url}/issues/5", "user": user, "updated_at": time,
            "body": module["AGREEMENT"], "html_url": "approval"}
blocker = {"number": 11, "repository_url": api_url}
data = {
    "issues/5": {"state": "open"},
    f"issues/comments/{module['APPROVAL']}": approval,
    "issues/10": {"state": "open", "title": "Spec", "body": "<!-- codex-spec source=5 -->", "updated_at": time},
    "issues/10/sub_issues": [{"number": n, "state": "open", "title": str(n), "body": str(n), "updated_at": time} for n in (11, 12, 13)],
    "issues/11/dependencies/blocked_by": [],
    "issues/12/dependencies/blocked_by": [blocker],
    "issues/13/dependencies/blocked_by": [blocker],
    "pulls/17": {"state": "open", "head": {"repo": {"full_name": repo},
                 "ref": "feat/387-booking-topic"}, "base": {"ref": "main"}},
    "pulls/17/commits": [{"sha": module["COMMIT"]}],
}
prepare.__globals__["api"] = lambda path, **kw: data[path]
event = {"action": "created", "repository": {"full_name": repo},
         "issue": {"number": 5, "state": "open"}, "comment": {
             "user": user, "body": "/oc implement-spec #10", "created_at": time}}
prepare.__globals__["APPROVED_AT"] = time
prepare.__globals__["APPROVED_TEXT"] = {
    item["number"]: module["fingerprint"](item)
    for item in data["issues/10/sub_issues"]
}
prepare.__globals__["APPROVED_TEXT"][10] = module["fingerprint"](data["issues/10"])
context = prepare(event)
assert context["order"] == [[11], [12, 13]]
for key in ("mode", "source", "spec", "order"):
    print(f"{key}={context[key]}")
for target, key, invalid in [
    (event["comment"], "user", {"login": "other", "type": "User"}),
    (event["comment"], "body", "/oc implement-spec #99"),
    (event["comment"], "body", "/oc \nimplement-spec #10"),
    (approval, "body", "позже"),
    (data["issues/10"], "body", "<!-- codex-spec source=5 --> новая редакция"),
    (data["issues/10/sub_issues"][0], "title", "другой заголовок"),
    (data["issues/10"], "updated_at", "2026-11-24T00:00:00Z"),
    *((ticket, "updated_at", "2026-11-24T00:00:00Z")
      for ticket in data["issues/10/sub_issues"]),
    (data, "issues/12/dependencies/blocked_by", []),
]:
    old = target[key]
    target[key] = invalid
    try:
        prepare(event)
    except ValueError as error:
        print(f"blocked: {error}")
    else:
        raise AssertionError(key)
    finally:
        target[key] = old

# Exercise the publication decisions without a GitHub token or a remote write.
publisher = runpy.run_path(".github/workflows/codex-implement-publish.py")["main"]
sha = "a" * 40
pr_url = f"https://github.com/{repo}/pull/99"


def pull(head_sha=sha, base="main"):
    return {"user": {"id": 123}, "html_url": pr_url, "head": {"sha": head_sha},
            "base": {"ref": base}, "body": f"- `mise run check` — успешно на `{sha}`."}


def publication(mode, *, pulls=(), remote="", app_id="123", checked_sha=sha,
                created_sha=sha, expected_error=None):
    calls, outputs = [], {}

    def fake_run(*args):
        calls.append(args)
        if args[:3] == ("gh", "api", "users/hexlet-ai%5Bbot%5D"):
            return app_id
        if args[:3] == ("gh", "api", "--paginate"):
            assert not any(arg.startswith("base=") for arg in args)
            return json.dumps([pulls])
        if args[:2] == ("git", "ls-remote"):
            return remote
        if args[:2] == ("git", "rev-parse"):
            return checked_sha
        if args[:4] == ("gh", "api", "--method", "POST"):
            assert sha in args[-1] and "attempts/2" in args[-1]
            return json.dumps(pull(created_sha))
        return ""

    with tempfile.TemporaryDirectory() as directory:
        event_path = Path(directory, "event.json")
        event_path.write_text(json.dumps({"comment": {"html_url": "command"}}))
        Path(directory, "implement-spec.json").write_text(json.dumps({"approval": "approval"}))
        with patch.dict(os.environ, {
            "GITHUB_REPOSITORY": repo, "TRUSTED_BOT_ID": "123", "APP_SLUG": "hexlet-ai",
            "CHECKED_SHA": sha, "CHECK_ATTEMPT": "2", "RUNNER_TEMP": directory,
            "GITHUB_EVENT_PATH": str(event_path), "GITHUB_SERVER_URL": "https://github.com",
            "GITHUB_RUN_ID": "1234",
        }), patch.dict(publisher.__globals__, {"run": fake_run, "output": outputs.__setitem__}):
            if expected_error:
                try:
                    publisher(mode)
                except ValueError as error:
                    assert expected_error in str(error), str(error)
                else:
                    raise AssertionError(expected_error)
                assert outputs == {}
            else:
                publisher(mode)
    return calls, outputs


calls, outputs = publication("publish")
assert outputs == {"pr": pr_url}
assert sum(args[:2] == ("git", "push") for args in calls) == 1
calls, outputs = publication("inspect", pulls=[pull()])
assert outputs == {"pr": pr_url} and len(calls) == 1
calls, outputs = publication("publish", remote=f"{sha}\trefs/heads/implement/spec-10")
assert outputs == {"pr": pr_url} and all(args[:2] != ("git", "push") for args in calls)
for invalid in ({"app_id": "456"}, {"remote": "b" * 40}, {"checked_sha": "b" * 40},
                {"pulls": [{"user": {"id": 456}, "html_url": pr_url}]}):
    try:
        publication("publish", **invalid)
    except ValueError:
        pass
    else:
        raise AssertionError(invalid)
assert "always()" not in workflow.split("\n  publish-implementation:", 1)[1].split("\n  report-", 1)[0]
print("Публикация, повторный запуск и восстановление после push проверены на имитации GitHub.")

for changed, message in [
    (pull(head_sha="b" * 40), "SHA PR отличается"),
    (pull(base="another-base"), "Целевая ветка PR изменена на another-base"),
]:
    calls, _ = publication("inspect", pulls=[changed], expected_error=message)
    assert len(calls) == 1
    print(f"Повторный запуск остановлен: {message}.")

calls, _ = publication("publish", created_sha="b" * 40, expected_error="SHA PR отличается")
assert any(args[:4] == ("gh", "api", "--method", "POST") for args in calls)
print("Созданный PR с другим head.sha не подтверждён.")
