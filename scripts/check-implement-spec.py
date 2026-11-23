import os
import runpy
import subprocess
import tempfile
from pathlib import Path

workflow = Path(".github/workflows/codex-issue.yml").read_text()
gate = workflow.split("          # Validate before", 1)[1].split("\n\n  codex:", 1)[0]
gate = gate.split("\n", 1)[1]
gate = "\n".join(line[10:] for line in gate.splitlines())
with tempfile.TemporaryDirectory() as directory:
    out = Path(directory, "output")
    for command, expected in [
        ("/oc implement-spec #10", "implementation=true"),
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
    "issues/10": {"state": "open", "body": "<!-- codex-spec source=5 -->"},
    "issues/10/sub_issues": [{"number": n, "state": "open", "body": str(n)} for n in (11, 12, 13)],
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
context = prepare(event)
assert context["order"] == [[11], [12, 13]]
for key in ("mode", "source", "spec", "order"):
    print(f"{key}={context[key]}")
for target, key, invalid in [
    (event["comment"], "user", {"login": "other", "type": "User"}),
    (event["comment"], "body", "/oc implement-spec #99"),
    (approval, "body", "позже"),
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
