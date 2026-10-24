#!/usr/bin/env python3
"""Fail if anything identifying is in this repository, in the tree or in any commit.

    python3 scripts/check_no_pii.py            # from the repository root, no dependencies

Exit 0 clean, 1 on a finding, 2 when it could not do its job (shallow clone, git missing).

This repository is public. What the script guards: every text file in the tree and every version
of every file in history (EXCLUDED_PATHS aside: vendored code and lock files carry other people's
addresses and long hashes), every commit message, and the author and committer of every commit
(ALLOWED_IDENTITIES only). Generic rules: an email address outside the RFC 2606 example domains and
the role or upstream addresses listed with their reason, a MAC address that is not a documentation
one, a tailnet host name, a long token-like string. Private markers: one literal per line in
~/.config/pii/markers.txt (or $PII_MARKERS), matched case-insensitively over the same tree and
history; the list is private on purpose, a public checker that spells the names it looks for is
itself the leak. CI has no list and runs the generic rules only.

A finding in history CANNOT be fixed by a commit: it needs a rewrite and a force-push (done once,
2026-10-24, for the owner's identity and names). Findings print masked: CI logs are public.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

SELF = "scripts/check_no_pii.py"  # excluded: it names the things it looks for
EXCLUDED_PATHS = (
    "node_modules/", "package-lock.json", "public/vendor/", ".min.js",
    "custom_components/frame_art_shuffler/samsungtvws/",  # vendored upstream library, its authors' addresses
    "archive/",  # dead code kept for the record; scanned for markers only, below
)
ALLOWED_IDENTITIES = {
    "71735642+billyfw@users.noreply.github.com",  # the owner's GitHub noreply address (every commit since the 2026-10-24 rewrite)
    "noreply@github.com",  # GitHub's own web merges
    "noreply@anthropic.com",  # the coding assistant's Co-Authored-By line
}
ALLOWED_EMAILS = {
    "git@github.com": "the ssh remote URL form, not a mailbox",
    "xchwarze@gmail.com": "author credit of the vendored samsungtvws library",
    "n.waterton@outlook.com": "author credit of the vendored samsungtvws art code",
    "mjg59@srcf.ucam.org": "author credit in the vendored samsungtvws code",
}
ALLOWED_EMAIL_DOMAINS = ("example.com", "example.org", "example.net", "homeassistant.local", "fly.io")  # RFC 2606 and role addresses
DOC_MACS = {"aa:bb:cc:dd:ee:ff", "aa:bb:cc:dd:ee:01", "a1:b2:c3:d4:e5:f6", "ff:ff:ff:ff:ff:ff", "00:11:22:33:44:55", "ff:ee:dd:cc:bb:aa",
            "11:22:33:44:55:66", "22:33:44:55:66:77", "77:66:55:44:33:22"}  # the test fixtures' made-up addresses
RULES = {
    "email": re.compile(r"(?<![\w.+-])[\w+][\w.+-]*@[\w-]+(?:\.[\w-]+)+"),  # no leading punctuation: `-git@github.com` is a flag plus a URL
    "mac-address": re.compile(r"\b(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b"),
    "tailnet-name": re.compile(r"\b[\w-]+\.tail[0-9a-f]{4,}\.ts\.net\b|\btail[0-9a-f]{5,}\.ts\.net\b"),
    "long-secret": re.compile(r"\b[A-Za-z0-9+/=]{64,}\b"),  # base64 or hex runs; identifiers with underscores are not tokens
}
MARKERS_FILE = Path(os.environ.get("PII_MARKERS", Path.home() / ".config/pii/markers.txt"))


def git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


def mask(value: str) -> str:
    return value[:2] + "*" * max(len(value) - 2, 3)


def excluded(path: str) -> bool:
    return path == SELF or any(x in path for x in EXCLUDED_PATHS)


def markers_only(path: str) -> bool:
    return path.startswith("archive/")


def scan_text(text: str, where: str, markers: list[str], findings: list[str], *, generic: bool = True) -> None:
    for n, line in enumerate(text.splitlines(), 1):
        if generic:
            for rule, rx in RULES.items():
                for m in rx.finditer(line):
                    v = m.group(0)
                    domain = v.lower().rsplit("@", 1)[-1]
                    if rule == "email" and (v in ALLOWED_IDENTITIES or v in ALLOWED_EMAILS
                                            or domain == "example"
                                            or any(domain == d or domain.endswith("." + d) for d in ALLOWED_EMAIL_DOMAINS)):
                        continue
                    if rule == "mac-address" and v.lower() in DOC_MACS:
                        continue
                    findings.append(f"{rule}: {where} line {n}: {mask(v)}")
        low = line.lower()
        for mk in markers:
            if mk in low:
                findings.append(f"marker: {where} line {n}: {mask(mk)}")


def main() -> int:
    if git("rev-parse", "--is-shallow-repository").strip() == "true":
        print("shallow clone: history cannot be scanned (fetch-depth: 0)")
        return 2
    markers = []
    if MARKERS_FILE.exists():
        markers = [ln.strip().lower() for ln in MARKERS_FILE.read_text().splitlines() if ln.strip() and not ln.startswith("#")]
    findings: list[str] = []

    for path in git("ls-files").splitlines():  # 1. the tree
        if excluded(path):
            continue
        try:
            text = Path(path).read_text()
        except (UnicodeDecodeError, OSError):
            continue  # binary or gone
        scan_text(text, path, markers, findings, generic=not markers_only(path))

    commits = git("rev-list", "--all").split()  # 2. every commit: message, identities, every version of every file
    for sha in commits:
        short = sha[:7]
        subject, ae, ce, body = git("show", "-s", "--format=%s%n%ae%n%ce%n%b", sha).split("\n", 3)
        scan_text(subject + "\n" + body, f"commit {short} message", markers, findings)
        for who, email in (("author", ae), ("committer", ce)):
            if email not in ALLOWED_IDENTITIES:
                findings.append(f"identity: commit {short} {who}: {mask(email)}")
        for path in git("diff-tree", "--no-commit-id", "--name-only", "-r", "-m", "--root", sha).split():
            if excluded(path):
                continue
            try:
                blob = git("show", f"{sha}:{path}")
            except (subprocess.CalledProcessError, UnicodeDecodeError):
                continue  # deleted in this commit, or binary
            scan_text(blob, f"commit {short}:{path}", markers, findings, generic=not markers_only(path))

    for f in sorted(set(findings)):
        print(f)
    label = f"{len(markers)} private markers" if markers else "no private marker list (generic rules only)"
    print(f"{'FAIL' if findings else 'clean'}: {len(set(findings))} finding(s); {len(commits)} commits; {label}")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
