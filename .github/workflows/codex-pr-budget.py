"""Reserve one persistent attempt before exposing the model key."""
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


def main():
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    discussion = os.environ["GITHUB_EVENT_NAME"] == "issue_comment"
    pr = str(event["issue"]["number"] if discussion else event["pull_request"]["number"])
    comment_id = str(event["comment"]["id"])
    if not all(re.fullmatch(r"[1-9][0-9]*", item) for item in (pr, comment_id)):
        raise ValueError("Invalid PR or comment ID")
    endpoint = "issues/comments" if discussion else "pulls/comments"
    comment = read(f"{endpoint}/{comment_id}")
    target = comment.get("issue_url" if discussion else "pull_request_url", "")
    expected = f"{os.environ['GITHUB_API_URL']}/repos/{os.environ['GITHUB_REPOSITORY']}"
    expected += f"/{'issues' if discussion else 'pulls'}/{pr}"
    if (
        target != expected
        or comment["user"]["type"] != "User"
        or comment["user"]["login"] != OWNER
        or not re.match(r"^/oc +\S", comment["body"].lstrip(), re.IGNORECASE)
    ):
        return
    pull = read(f"pulls/{pr}")
    if pull["state"] != "open" or (pull["head"]["repo"] or {}).get("full_name") != os.environ["GITHUB_REPOSITORY"]:
        return
    sha = pull["head"]["sha"]
    run_id = os.environ["GITHUB_RUN_ID"]
    attempt = os.environ["GITHUB_RUN_ATTEMPT"]
    if reserve(pr, sha, run_id, attempt):
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            output.write(f"admitted=true\nattempt={attempt}\npr={pr}\nsha={sha}\n")
        return
    log = f"{os.environ['GITHUB_SERVER_URL']}/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{run_id}/attempts/{attempt}"
    body = f"limit_exhausted\n\nSHA: `{sha}`\n\n[Лог попытки]({log})"
    api(f"issues/{pr}/comments", "-f", f"body={body}").check_returncode()


if __name__ == "__main__":
    main()
