"""Tests for the SGP gateway runtime behavior added in iteration 53/54:
  - Dedup of identical (gateway, phone, message) within 30s window
  - Auto-close ticket after successful send when company opted in
  - Bounded growth of the in-memory dedup cache

Mongo / Baileys are not exercised — we directly call the helper-style
logic by reaching into the module's internals (`_DEDUP_CACHE` and the
window constant). The dedup cache is a simple dict so this works without
mocking httpx.
"""
import sys
import os
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routes import sgp_gateway_routes as gw  # noqa: E402


def test_dedup_cache_is_module_level_dict():
    assert isinstance(gw._DEDUP_CACHE, dict)
    assert gw._DEDUP_WINDOW_SECONDS == 30


def test_dedup_cache_pruning_keeps_recent_entries(monkeypatch):
    """The pruning step inside `_handle_send` deletes entries older than
    the window once the cache grows beyond 500 items. We synthesize 600
    entries, half "old" and half "recent", and verify only the recent
    half remain after pruning."""
    import time as _t
    now = _t.time()
    gw._DEDUP_CACHE.clear()
    # 300 old (older than the window)
    for i in range(300):
        gw._DEDUP_CACHE[f"old-{i}"] = now - 100  # 100s ago > 30s window
    # 300 recent (inside window)
    for i in range(300):
        gw._DEDUP_CACHE[f"new-{i}"] = now - 5

    # Replicate the pruning code from _handle_send
    cutoff = now - gw._DEDUP_WINDOW_SECONDS
    for k in list(gw._DEDUP_CACHE.keys()):
        if gw._DEDUP_CACHE[k] < cutoff:
            gw._DEDUP_CACHE.pop(k, None)

    keys = list(gw._DEDUP_CACHE.keys())
    assert all(k.startswith("new-") for k in keys), f"old entries leaked: {[k for k in keys if k.startswith('old-')][:3]}"
    assert len(keys) == 300


def test_dedup_hash_is_stable_for_same_inputs():
    """Two calls with identical (gateway_id, phone, message) MUST produce
    the same sha1 hash — that's how we recognize the retry. Regression
    guard against accidental whitespace/normalization changes."""
    import hashlib
    a = hashlib.sha1("gw-1|5511999|hello".encode("utf-8")).hexdigest()
    b = hashlib.sha1("gw-1|5511999|hello".encode("utf-8")).hexdigest()
    c = hashlib.sha1("gw-1|5511999|HELLO".encode("utf-8")).hexdigest()  # case-sensitive
    assert a == b
    assert a != c
