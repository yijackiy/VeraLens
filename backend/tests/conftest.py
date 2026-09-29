import os
import sys

# Every backend module imports as `backend.app...`, which only resolves when
# the repo root (veralens/) is on sys.path. `python -m pytest` from that
# directory already provides it; this makes the tests work from any cwd too,
# matching how `python -m uvicorn backend.app.api.main:app` is documented to
# be run.
REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)
