"""
Step 0.6 — configuration from environment variables only.

Secrets are read from the process environment (populated from a git-ignored
.env in development, from the hosting provider's secret store in deployment).
Nothing here reads a committed config file, and no default is ever a real key.
See .env.example for the full list of names.
"""

import os

from dotenv import load_dotenv

APP_DIR = os.path.dirname(__file__)
PROJECT_ROOT = os.path.normpath(os.path.join(APP_DIR, "..", ".."))

# override=False: a real environment variable (e.g. set by the host) always
# beats the local .env file.
load_dotenv(os.path.join(PROJECT_ROOT, ".env"), override=False)

def _int_env(name: str, default: int) -> int:
    """
    Blank is treated as unset — .env.example is a template people copy and
    blank out, and int("") would otherwise crash at import time in every
    module that reads config, with a message that names neither the file nor
    the variable.
    """
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        raise RuntimeError(
            f"{name} must be an integer, got {raw!r}. Check your .env."
        ) from None


JUDGE_PROVIDER = (os.environ.get("JUDGE_PROVIDER") or "gemini").strip()
JUDGE_MODEL = (os.environ.get("JUDGE_MODEL") or "gemini-2.5-flash").strip()
JUDGE_RPM = _int_env("JUDGE_RPM", 10)
JUDGE_DAILY_QUOTA = _int_env("JUDGE_DAILY_QUOTA", 250)

# Empty DATABASE_URL falls back to local SQLite so the judge layer runs without
# a Postgres instance. Development convenience only — final thesis results
# belong in Neon/Supabase (Render's free Postgres expires after 30 days).
_DEFAULT_SQLITE = "sqlite:///" + os.path.join(PROJECT_ROOT, "data", "judge.db")
DATABASE_URL = os.environ.get("DATABASE_URL") or _DEFAULT_SQLITE


def require(name: str) -> str:
    """
    Returns a required secret, or raises with the name that is missing.
    Never log or print the return value.
    """
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(
            f"{name} is not set. Copy .env.example to .env and fill it in, "
            f"or export {name} in the deployment environment."
        )
    return value


def is_sqlite_fallback() -> bool:
    return DATABASE_URL == _DEFAULT_SQLITE


if __name__ == "__main__":
    # Prints presence, never values.
    print(f"JUDGE_PROVIDER    = {JUDGE_PROVIDER}")
    print(f"JUDGE_MODEL       = {JUDGE_MODEL}")
    print(f"JUDGE_RPM         = {JUDGE_RPM}")
    print(f"JUDGE_DAILY_QUOTA = {JUDGE_DAILY_QUOTA}")
    print(f"GEMINI_API_KEY    = {'set' if os.environ.get('GEMINI_API_KEY') else 'MISSING'}")
    print(f"DATABASE_URL      = {'sqlite fallback' if is_sqlite_fallback() else 'set'}")
