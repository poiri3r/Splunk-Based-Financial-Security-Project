#!/usr/bin/env python3
"""Validate local collection without printing raw logs or using real accounts."""
import argparse
from collections import Counter
import gzip
import json
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]


def compose(*args):
    return subprocess.check_output(
        ["docker", "compose", *args], cwd=ROOT, text=True, stderr=subprocess.PIPE
    ).strip()


def records():
    container = compose("ps", "-q", "log-collector")
    assert container, "log-collector is not running"
    with tempfile.TemporaryDirectory(prefix="bank-log-check-") as directory:
        subprocess.run(
            ["docker", "cp", f"{container}:/data/collected/.", directory],
            check=True, capture_output=True,
        )
        rows = []
        for path in Path(directory).iterdir():
            read = gzip.open if path.suffix == ".gz" else open
            with read(path, "rt", encoding="utf-8") as stream:
                rows.extend(json.loads(line) for line in stream if line.strip())
        return rows


def probe(base_url):
    secret = "collector-probe-" + uuid.uuid4().hex
    request = urllib.request.Request(
        base_url.rstrip("/") + "/api/v2/auth/login?probe_secret=" + secret,
        data=json.dumps({"username": secret, "password": secret}).encode(),
        headers={"Content-Type": "application/json", "X-Collector-Probe": secret},
        method="POST",
    )
    try:
        response = urllib.request.urlopen(request, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        assert response.status == 401, f"Expected 401, got {response.status}"
        request_id = response.headers.get("X-Request-ID")
    assert request_id, "Backend request ID missing"
    return request_id, secret


def wait_for_probe(request_id, secret):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        rows = records()
        selected = [row for row in rows if row.get("requestId") == request_id]
        audit = [row for row in selected if row.get("logType") == "audit"]
        access = [row for row in selected if row.get("logType") == "access"]
        if len(audit) >= 2 and access:
            assert len(audit) == 2 and len(access) == 1, "Unexpected duplicate records"
            assert {row["event"] for row in audit} == {"login", "http.error"}
            assert all(row["outcome"] == "FAILURE" for row in audit)
            assert all(row["service"] == "backend" for row in audit)
            assert access[0]["service"] == "frontend"
            assert access[0]["path"] == "/api/v2/auth/login"
            assert access[0]["nginxRequestId"]
            assert all(row["httpStatus"] == 401 for row in selected)
            assert secret not in json.dumps(rows), "Probe secret leaked into collected logs"
            return {
                "audit": Counter(row["eventId"] for row in audit),
                "access": Counter(row["nginxRequestId"] for row in access),
            }
        time.sleep(1)
    raise AssertionError("Audit/access records did not arrive within 30 seconds")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:5500")
    parser.add_argument(
        "--check-restart", action="store_true",
        help="Recreate only the collector and check saved positions/output persistence",
    )
    args = parser.parse_args()
    first_id, first_secret = probe(args.base_url)
    expected = wait_for_probe(first_id, first_secret)
    print("PASS: audit/access JSON, request correlation, metadata and secret exclusion")
    if args.check_restart:
        compose("up", "-d", "--no-deps", "--force-recreate", "log-collector")
        second_id, second_secret = probe(args.base_url)
        wait_for_probe(second_id, second_secret)
        old_rows = [row for row in records() if row.get("requestId") == first_id]
        actual = {
            "audit": Counter(row["eventId"] for row in old_rows if row.get("logType") == "audit"),
            "access": Counter(row["nginxRequestId"] for row in old_rows if row.get("logType") == "access"),
        }
        assert actual == expected, "Old records were lost or duplicated after recreation"
        print("PASS: collector recreation preserves output and resumes without replaying probe")


if __name__ == "__main__":
    main()
