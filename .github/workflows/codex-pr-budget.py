"""Reserve one persistent attempt before exposing the model key."""
from datetime import datetime, timedelta
import json
import os
import re
import subprocess
from pathlib import Path

LIMIT = 3
OWNER = "www-lexa-pro"


def api(endpoint, *args):
    result = subprocess.run(
        ["gh", "api", f"repos/{os.environ['GITHUB_REPOSITORY']}/{endpoint}", *args],
        text=True,
        capture_output=True,
    )
    return result


def read(endpoint):
    result = api(endpoint)
    result.check_returncode()
    return json.loads(result.stdout)


def reserve(pr, sha, run_id, attempt):
    for slot in range(1, LIMIT + 1):
        ref = f"tags/codex-pr-budget/{pr}/{slot}"
        result = api("git/refs", "-f", f"ref=refs/{ref}", "-f", f"sha={sha}")
        if result.returncode == 0:
            print(f"Reserved {slot}/{LIMIT} for {run_id}/{attempt}")
            return True
        # Confirm a conflict through GitHub. An API failure must stop before Codex.
        if "Reference already exists" not in result.stderr:
            raise RuntimeError(f"Cannot reserve budget: {result.stderr}")
        read(f"git/ref/{ref}")
    return False


def command_timestamp(pr, comment, discussion):
    created = comment["created_at"]
    updated = comment["updated_at"]
    if created == updated:
        return created

    # Submit review updates pending inline comments even when their text is unchanged.
    review_id = comment.get("pull_request_review_id")
    if discussion or not isinstance(review_id, int) or review_id <= 0:
        return None
    review = read(f"pulls/{pr}/reviews/{review_id}")
    if review["user"]["id"] == comment["user"]["id"] and review.get("submitted_at") == updated:
        return updated
    return None


def main():
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    source = event["workflow_run"]
    if (source["path"] != ".github/workflows/codex-pr.yml"
        or source["repository"]["full_name"] != os.environ["GITHUB_REPOSITORY"]
        or source["actor"]["login"] != OWNER
        or source["event"] not in {"issue_comment", "pull_request_review_comment"}):
        return
    signal_path = Path(os.environ["RUNNER_TEMP"], "pr-command", "request.json")
    if signal_path.stat().st_size > 1024:
        raise ValueError("Invalid signal size")
    signal = json.loads(signal_path.read_text())
    discussion = source["event"] == "issue_comment"
    pr = signal["pr"]
    comment_id = signal["comment"]
    if not all(re.fullmatch(r"[1-9][0-9]*", item) for item in (pr, comment_id)):
        raise ValueError("Invalid PR or comment ID")
    endpoint = "issues/comments" if discussion else "pulls/comments"
    comment = read(f"{endpoint}/{comment_id}")
    target = comment.get("issue_url" if discussion else "pull_request_url", "")
    expected = f"{os.environ['GITHUB_API_URL']}/repos/{os.environ['GITHUB_REPOSITORY']}"
    expected += f"/{'issues' if discussion else 'pulls'}/{pr}"
    if (
        target != expected
        or comment["user"]["id"] != source["actor"]["id"]
        or comment["user"]["type"] != "User"
        or comment["user"]["login"] != OWNER
        or not re.match(r"^/oc +\S", comment["body"].lstrip(), re.IGNORECASE)
    ):
        return
    timestamp = command_timestamp(pr, comment, discussion)
    if timestamp is None or not timedelta(0) <= (
        datetime.fromisoformat(source["created_at"]) - datetime.fromisoformat(timestamp)
    ) <= timedelta(minutes=5):
        return
    pull = read(f"pulls/{pr}")
    if pull["state"] != "open" or (pull["head"]["repo"] or {}).get("full_name") != os.environ["GITHUB_REPOSITORY"]:
        return
    branch = pull["head"]["ref"]
    if branch == "main" or (not discussion and branch != source["head_branch"]):
        return
    sha = pull["head"]["sha"]
    run_id = os.environ["GITHUB_RUN_ID"]
    attempt = os.environ["GITHUB_RUN_ATTEMPT"]
    if reserve(pr, sha, run_id, attempt):
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            output.write(
                f"admitted=true\nattempt={attempt}\npr={pr}\nsha={sha}\n"
                f"branch={branch}\nendpoint={endpoint}/{comment_id}\n"
            )
        return
    log = f"{os.environ['GITHUB_SERVER_URL']}/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{run_id}/attempts/{attempt}"
    body = f"limit_exhausted\n\nSHA: `{sha}`\n\n[Лог попытки]({log})"
    api(f"issues/{pr}/comments", "-f", f"body={body}").check_returncode()


if __name__ == "__main__":
    main()
