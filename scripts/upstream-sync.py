🗜️ #!/usr/bin/env python3
"""
upstream-sync.py — Interactive cherry-pick tool for syncing upstream changes into RiverCode.

Fetches new commits from upstream/develop, presents them interactively,
and allows selective cherry-picking with conflict resolution support.

State is persisted in .rivercode/upstream-sync.json (gitignored).

Usage:
    python scripts/upstream-sync.py                # Full interactive review
    python scripts/upstream-sync.py --category fix  # Only bugfixes
    python scripts/upstream-sync.py --dry-run       # Preview without acting
    python scripts/upstream-sync.py --reset-deferred # Re-review deferred commits
"""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

UPSTREAM_REMOTE = "upstream"
UPSTREAM_BRANCH = "develop"
STATE_DIR = ".rivercode"
STATE_FILE = os.path.join(STATE_DIR, "upstream-sync.json")

# Conventional commit category patterns
CATEGORY_PATTERNS = {
    "feat": re.compile(r"^feat[\(:]", re.IGNORECASE),
    "fix": re.compile(r"^fix[\(:]", re.IGNORECASE),
    "refactor": re.compile(r"^refactor[\(:]", re.IGNORECASE),
    "chore": re.compile(r"^chore[\(:]", re.IGNORECASE),
    "docs": re.compile(r"^docs[\(:]", re.IGNORECASE),
    "perf": re.compile(r"^perf[\(:]", re.IGNORECASE),
    "test": re.compile(r"^test[\(:]", re.IGNORECASE),
    "ci": re.compile(r"^ci[\(:]", re.IGNORECASE),
    "style": re.compile(r"^style[\(:]", re.IGNORECASE),
    "build": re.compile(r"^build[\(:]", re.IGNORECASE),
}

# ANSI colors
class C:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"


# ─────────────────────────────────────────────────────────────────────────────
# Git helpers
# ─────────────────────────────────────────────────────────────────────────────

def run_git(*args: str, check: bool = True, capture: bool = True) -> subprocess.CompletedProcess:
    """Run a git command and return the result."""
    cmd = ["git"] + list(args)
    return subprocess.run(
        cmd,
        capture_output=capture,
        text=True,
        check=check,
    )


def get_current_branch() -> str:
    result = run_git("rev-parse", "--abbrev-ref", "HEAD")
    return result.stdout.strip()


def fetch_upstream() -> None:
    print(f"{C.CYAN}Fetching {UPSTREAM_REMOTE}...{C.RESET}")
    run_git("fetch", UPSTREAM_REMOTE, capture=False)
    print()


def get_head_commit() -> str:
    result = run_git("rev-parse", "HEAD")
    return result.stdout.strip()


def get_commits_between(base: str, target: str) -> list[dict]:
    """Get non-merge commits between base and target."""
    result = run_git(
        "log",
        "--no-merges",
        "--format=%H|%h|%s|%an|%ai",
        f"{base}..{target}",
    )
    commits = []
    for line in result.stdout.strip().split("\n"):
        if not line:
            continue
        parts = line.split("|", 4)
        if len(parts) < 5:
            continue
        commits.append({
            "hash": parts[0],
            "short_hash": parts[1],
            "subject": parts[2],
            "author": parts[3],
            "date": parts[4],
        })
    # Reverse to get chronological order (oldest first)
    commits.reverse()
    return commits


def categorize_commit(subject: str) -> str:
    """Categorize a commit based on conventional commit prefix."""
    for cat, pattern in CATEGORY_PATTERNS.items():
        if pattern.match(subject):
            return cat
    # Fallback heuristics
    lower = subject.lower()
    if lower.startswith("merge"):
        return "merge"
    if "fix" in lower:
        return "fix"
    if "add" in lower or "implement" in lower:
        return "feat"
    return "other"


def get_commit_diff(commit_hash: str) -> str:
    """Get the diff for a commit."""
    result = run_git("show", "--stat", "--patch", commit_hash)
    return result.stdout


def cherry_pick_commit(commit_hash: str) -> tuple[bool, str]:
    """Cherry-pick a commit. Returns (success, message)."""
    result = run_git("cherry-pick", commit_hash, check=False)
    if result.returncode == 0:
        return True, "Cherry-pick successful"
    else:
        return False, result.stderr or result.stdout or "Cherry-pick failed"


def abort_cherry_pick() -> None:
    """Abort an in-progress cherry-pick."""
    run_git("cherry-pick", "--abort", check=False)


def has_conflicts() -> bool:
    """Check if there are unresolved conflicts."""
    result = run_git("diff", "--name-only", "--diff-filter=U")
    return bool(result.stdout.strip())


# ─────────────────────────────────────────────────────────────────────────────
# State management
# ─────────────────────────────────────────────────────────────────────────────

def load_state() -> dict:
    """Load the sync state from disk."""
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, "r") as f:
            return json.load(f)
    return {
        "last_synced_commit": None,
        "reviewed_commits": {},
    }


def save_state(state: dict) -> None:
    """Save the sync state to disk."""
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


# ─────────────────────────────────────────────────────────────────────────────
# Display helpers
# ─────────────────────────────────────────────────────────────────────────────

CATEGORY_COLORS = {
    "feat": C.GREEN,
    "fix": C.RED,
    "refactor": C.BLUE,
    "chore": C.DIM,
    "docs": C.MAGENTA,
    "perf": C.YELLOW,
    "test": C.CYAN,
    "ci": C.DIM,
    "other": C.RESET,
}


def format_commit(commit: dict, index: int, total: int) -> str:
    """Format a commit for display."""
    cat = categorize_commit(commit["subject"])
    color = CATEGORY_COLORS.get(cat, C.RESET)
    cat_label = f"[{cat}]".ljust(10)
    return (
        f"  {C.DIM}[{index + 1}/{total}]{C.RESET} "
        f"{C.YELLOW}{commit['short_hash']}{C.RESET} "
        f"{color}{cat_label}{C.RESET} "
        f"{commit['subject']}"
    )


def print_summary(picked: int, skipped: int, deferred: int, failed: int) -> None:
    """Print final summary."""
    print()
    print(f"{C.BOLD}{'─' * 60}{C.RESET}")
    print(f"{C.BOLD}Summary:{C.RESET}")
    print(f"  {C.GREEN}Picked:   {picked}{C.RESET}")
    print(f"  {C.DIM}Skipped:  {skipped}{C.RESET}")
    print(f"  {C.YELLOW}Deferred: {deferred}{C.RESET}")
    if failed:
        print(f"  {C.RED}Failed:   {failed}{C.RESET}")
    print(f"{C.BOLD}{'─' * 60}{C.RESET}")


# ─────────────────────────────────────────────────────────────────────────────
# Interactive menu
# ─────────────────────────────────────────────────────────────────────────────

def handle_conflict_resolution(commit: dict) -> bool:
    """Handle conflict resolution interactively. Returns True if resolved."""
    print(f"\n{C.RED}Conflict detected!{C.RESET}")
    print(f"  Resolve conflicts manually, then press Enter to continue.")
    print(f"  Or type 'abort' to skip this commit.\n")

    while True:
        choice = input(f"  {C.BOLD}[Enter] continue / [a]bort > {C.RESET}").strip().lower()
        if choice in ("a", "abort"):
            abort_cherry_pick()
            return False
        elif choice == "":
            # Check if conflicts are resolved
            if has_conflicts():
                print(f"  {C.RED}Unresolved conflicts remain. Resolve them first.{C.RESET}")
                continue
            # Continue the cherry-pick
            result = run_git("cherry-pick", "--continue", check=False)
            if result.returncode == 0:
                return True
            else:
                print(f"  {C.RED}Cherry-pick --continue failed:{C.RESET}")
                print(f"  {result.stderr}")
                continue


def interactive_review(commits: list[dict], state: dict, dry_run: bool = False) -> None:
    """Run interactive review of commits."""
    picked = 0
    skipped = 0
    deferred = 0
    failed = 0

    for i, commit in enumerate(commits):
        commit_hash = commit["hash"]

        # Skip already-reviewed commits
        if commit_hash in state["reviewed_commits"]:
            prev = state["reviewed_commits"][commit_hash]
            if prev["action"] != "deferred":
                continue

        print()
        print(format_commit(commit, i, len(commits)))
        print(f"    {C.DIM}by {commit['author']} on {commit['date'][:10]}{C.RESET}")

        if dry_run:
            print(f"    {C.CYAN}(dry-run: would prompt for action){C.RESET}")
            continue

        while True:
            choice = input(
                f"    {C.BOLD}[p]ick [s]kip [d]efer [v]iew diff [q]uit > {C.RESET}"
            ).strip().lower()

            if choice in ("p", "pick"):
                success, msg = cherry_pick_commit(commit_hash)
                if success:
                    print(f"    {C.GREEN}✓ Picked{C.RESET}")
                    state["reviewed_commits"][commit_hash] = {
                        "action": "picked",
                        "date": datetime.now().isoformat(),
                        "subject": commit["subject"],
                    }
                    state["last_synced_commit"] = commit_hash
                    save_state(state)
                    picked += 1
                else:
                    # Conflict
                    resolved = handle_conflict_resolution(commit)
                    if resolved:
                        print(f"    {C.GREEN}✓ Picked (after conflict resolution){C.RESET}")
                        state["reviewed_commits"][commit_hash] = {
                            "action": "picked",
                            "date": datetime.now().isoformat(),
                            "subject": commit["subject"],
                            "note": "had conflicts",
                        }
                        state["last_synced_commit"] = commit_hash
                        save_state(state)
                        picked += 1
                    else:
                        print(f"    {C.RED}✗ Aborted{C.RESET}")
                        state["reviewed_commits"][commit_hash] = {
                            "action": "skipped",
                            "date": datetime.now().isoformat(),
                            "subject": commit["subject"],
                            "note": "conflict - aborted",
                        }
                        save_state(state)
                        failed += 1
                break

            elif choice in ("s", "skip"):
                note = input(f"    {C.DIM}Note (optional): {C.RESET}").strip()
                state["reviewed_commits"][commit_hash] = {
                    "action": "skipped",
                    "date": datetime.now().isoformat(),
                    "subject": commit["subject"],
                    "note": note or None,
                }
                save_state(state)
                skipped += 1
                print(f"    {C.DIM}– Skipped{C.RESET}")
                break

            elif choice in ("d", "defer"):
                state["reviewed_commits"][commit_hash] = {
                    "action": "deferred",
                    "date": datetime.now().isoformat(),
                    "subject": commit["subject"],
                }
                save_state(state)
                deferred += 1
                print(f"    {C.YELLOW}~ Deferred{C.RESET}")
                break

            elif choice in ("v", "view"):
                diff = get_commit_diff(commit_hash)
                # Page output if long
                lines = diff.split("\n")
                if len(lines) > 40:
                    try:
                        proc = subprocess.Popen(
                            ["less", "-R"],
                            stdin=subprocess.PIPE,
                            text=True,
                        )
                        proc.communicate(diff)
                    except FileNotFoundError:
                        print(diff)
                else:
                    print(diff)

            elif choice in ("q", "quit"):
                print(f"\n{C.YELLOW}Quitting review.{C.RESET}")
                print_summary(picked, skipped, deferred, failed)
                return

            else:
                print(f"    {C.DIM}Invalid choice. Use p/s/d/v/q.{C.RESET}")

    print_summary(picked, skipped, deferred, failed)


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Interactive upstream sync for RiverCode",
    )
    parser.add_argument(
        "--category",
        choices=list(CATEGORY_PATTERNS.keys()) + ["other"],
        help="Only show commits of this category",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview available commits without acting",
    )
    parser.add_argument(
        "--reset-deferred",
        action="store_true",
        help="Re-review previously deferred commits",
    )
    args = parser.parse_args()

    # Verify we're in a git repo
    try:
        run_git("rev-parse", "--is-inside-work-tree")
    except subprocess.CalledProcessError:
        print(f"{C.RED}Error: Not inside a git repository.{C.RESET}", file=sys.stderr)
        sys.exit(1)

    # Verify upstream remote exists
    result = run_git("remote", check=False)
    if UPSTREAM_REMOTE not in result.stdout:
        print(
            f"{C.RED}Error: Remote '{UPSTREAM_REMOTE}' not found.{C.RESET}",
            file=sys.stderr,
        )
        print(f"Add it with: git remote add {UPSTREAM_REMOTE} <url>", file=sys.stderr)
        sys.exit(1)

    # Load state
    state = load_state()

    # Reset deferred if requested
    if args.reset_deferred:
        count = 0
        for commit_hash, info in list(state["reviewed_commits"].items()):
            if info.get("action") == "deferred":
                del state["reviewed_commits"][commit_hash]
                count += 1
        save_state(state)
        print(f"{C.GREEN}Reset {count} deferred commits.{C.RESET}")
        if count == 0:
            return

    # Fetch upstream
    fetch_upstream()

    # Determine base: use last synced commit, or find the merge base
    current_head = get_head_commit()
    upstream_ref = f"{UPSTREAM_REMOTE}/{UPSTREAM_BRANCH}"

    if state["last_synced_commit"]:
        base = state["last_synced_commit"]
    else:
        # Find the merge base between current branch and upstream
        result = run_git("merge-base", "HEAD", upstream_ref)
        base = result.stdout.strip()

    # Get new commits
    commits = get_commits_between(base, upstream_ref)

    if not commits:
        print(f"{C.GREEN}Already up to date with {upstream_ref}.{C.RESET}")
        return

    # Filter by category if requested
    if args.category:
        commits = [
            c for c in commits
            if categorize_commit(c["subject"]) == args.category
        ]
        if not commits:
            print(f"{C.YELLOW}No '{args.category}' commits found.{C.RESET}")
            return

    # Filter out already-reviewed (except deferred)
    pending = []
    for c in commits:
        h = c["hash"]
        if h in state["reviewed_commits"]:
            action = state["reviewed_commits"][h].get("action")
            if action == "deferred":
                pending.append(c)
            # picked/skipped → skip
        else:
            pending.append(c)

    if not pending:
        print(f"{C.GREEN}All commits have been reviewed. Nothing to do.{C.RESET}")
        return

    # Display header
    branch = get_current_branch()
    print(f"{C.BOLD}{'─' * 60}{C.RESET}")
    print(f"{C.BOLD}RiverCode Upstream Sync{C.RESET}")
    print(f"  Branch: {C.CYAN}{branch}{C.RESET}")
    print(f"  Base:   {C.DIM}{base[:12]}{C.RESET}")
    print(f"  Target: {C.DIM}{upstream_ref}{C.RESET}")
    print(f"  Pending: {C.BOLD}{len(pending)}{C.RESET} commits")
    if args.category:
        print(f"  Filter: {C.YELLOW}{args.category}{C.RESET}")
    if args.dry_run:
        print(f"  Mode:   {C.YELLOW}DRY RUN{C.RESET}")
    print(f"{C.BOLD}{'─' * 60}{C.RESET}")

    # Run interactive review
    interactive_review(pending, state, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
