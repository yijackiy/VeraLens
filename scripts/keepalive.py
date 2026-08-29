"""
Step 4.5 — keep-alive ping for the deployed demo.

Free-tier web services spin down after ~15 minutes idle and take ~1 minute to
wake. Hitting /health every 10 minutes keeps the demo warm, so it does not open
on a loading screen in front of an examiner.

Run it from a free scheduler (cron-job.org, GitHub Actions cron, UptimeRobot):

    python scripts/keepalive.py https://<your-app>/health

GitHub Actions equivalent — .github/workflows/keepalive.yml:

    on:
      schedule:
        - cron: "*/10 * * * *"
    jobs:
      ping:
        runs-on: ubuntu-latest
        steps:
          - run: curl -fsS "${{ secrets.APP_HEALTH_URL }}" || exit 1
"""

import sys
import time
import urllib.error
import urllib.request

TIMEOUT = 30  # generous: a cold start can take ~60s, but the retry covers that
ATTEMPTS = 3


def ping(url: str) -> bool:
    for attempt in range(1, ATTEMPTS + 1):
        started = time.monotonic()
        try:
            with urllib.request.urlopen(url, timeout=TIMEOUT) as resp:
                elapsed = time.monotonic() - started
                print(f"[keepalive] {resp.status} in {elapsed:.2f}s")
                if elapsed > 5:
                    print("[keepalive] slow response — the service had spun "
                          "down; check the ping is actually running on schedule")
                return resp.status == 200
        except (urllib.error.URLError, TimeoutError) as exc:
            print(f"[keepalive] attempt {attempt}/{ATTEMPTS} failed: {exc}")
            if attempt < ATTEMPTS:
                time.sleep(5 * attempt)
    return False


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python scripts/keepalive.py <health_url>")
        raise SystemExit(2)
    raise SystemExit(0 if ping(sys.argv[1]) else 1)
