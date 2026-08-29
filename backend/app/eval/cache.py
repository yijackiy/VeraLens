"""
Step 4.4c — cache key for judge scores.

Keyed on everything that can change a score: rubric version, model, temperature,
the explanation, and the ground-truth signals. A hit returns the stored score
without an API call, which keeps repeat runs inside the 250/day free-tier quota
and guarantees identical inputs never produce two different numbers.

The cache lives in the database (see storage.py), not in memory — it has to
survive a restart and a redeploy.
"""

import hashlib
import json


def cache_key(rubric_version: str, model: str, temperature: float,
              explanation: str, signals) -> str:
    payload = json.dumps(
        [rubric_version, model, temperature, explanation, signals],
        sort_keys=True,
        ensure_ascii=False,
        default=str,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
