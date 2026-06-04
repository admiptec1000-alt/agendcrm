"""Spintax parser — converts `{a|b|c}` templates to a random variant.

Supports nesting: `{Ola|Oi}, {tudo bem|como vai}?`
Spintax is non-greedy and resolved depth-first (innermost first).

2026-02-28 — Bulk dispatcher humanization.
"""
from __future__ import annotations

import random
import re


_SPINTAX_RE = re.compile(r"\{([^{}|]*\|[^{}]+)\}")  # innermost {a|b|...} with at least one pipe


def spin(text: str) -> str:
    """Resolve every `{a|b|c}` group with a random choice, deepest first.

    Returns the original text if no spintax markers are found.
    """
    if not text or "{" not in text:
        return text
    out = text
    # Resolve up to 20 levels of nesting (safety cap).
    for _ in range(20):
        m = _SPINTAX_RE.search(out)
        if not m:
            break
        options = [opt for opt in m.group(1).split("|")]
        choice = random.choice(options) if options else ""
        out = out[: m.start()] + choice + out[m.end() :]
    return out


def render_with_vars(text: str, variables: dict) -> str:
    """Apply spintax FIRST then substitute `{{key}}` variables.

    Order matters: if user wrote `{Ola|Oi} {{nome}}`, spintax goes first so
    `{{` is preserved (Python `{{...}}` is not affected by spintax regex
    because it excludes nested braces).
    """
    spun = spin(text or "")
    if not variables:
        return spun
    for k, v in variables.items():
        spun = spun.replace(f"{{{{{k}}}}}", "" if v is None else str(v))
    return spun
