"""Regression tests for the Super Admin feature toggle flow. We test the
key business logic without spinning up the full FastAPI app: the
SUPER_ADMIN_FEATURES catalog stays in sync with the Dashboard.js sidebar
items, and the SA business_type repair migration keeps the feature set
canonical."""
import sys
import os
import asyncio
import re
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routes.scheduling_routes import SUPER_ADMIN_FEATURES, ALL_SYSTEM_FEATURES  # noqa: E402


SIDEBAR_KEYS_FROM_FRONTEND = {
    "dashboard", "companies", "business-types", "partners",
    "financial", "indoor", "my-panel", "sgp-repair", "settings",
}


def test_super_admin_features_match_frontend_sidebar():
    """The keys in SUPER_ADMIN_FEATURES MUST match the sidebar items in
    /app/frontend/src/pages/SuperAdmin/Dashboard.js::allSidebarItems.
    If you add a new sidebar item but forget to add its feature_key here,
    the toggle won't show up in the Business Types editor."""
    backend_keys = {f["feature_key"] for f in SUPER_ADMIN_FEATURES}
    assert backend_keys == SIDEBAR_KEYS_FROM_FRONTEND, (
        f"Mismatch:\n"
        f"  Only in backend: {backend_keys - SIDEBAR_KEYS_FROM_FRONTEND}\n"
        f"  Only in frontend: {SIDEBAR_KEYS_FROM_FRONTEND - backend_keys}"
    )


def test_super_admin_features_match_frontend_sidebar_live():
    """Parse the actual frontend file at runtime to guarantee the sidebar
    keys haven't drifted (the hardcoded set above might get out of date)."""
    dashboard_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "frontend", "src", "pages", "SuperAdmin", "Dashboard.js",
    )
    if not os.path.exists(dashboard_path):
        pytest.skip("Frontend Dashboard.js not present in this environment")
    src = open(dashboard_path, "r").read()
    # Extract `allSidebarItems = [...]` block.
    m = re.search(r"const\s+allSidebarItems\s*=\s*\[([\s\S]*?)\]", src)
    assert m, "could not locate allSidebarItems in Dashboard.js"
    keys_in_src = set(re.findall(r"key:\s*['\"]([\w\-]+)['\"]", m.group(1)))
    backend_keys = {f["feature_key"] for f in SUPER_ADMIN_FEATURES}
    assert keys_in_src == backend_keys, (
        f"Frontend sidebar keys diverged from backend SUPER_ADMIN_FEATURES:\n"
        f"  Only in frontend: {keys_in_src - backend_keys}\n"
        f"  Only in backend: {backend_keys - keys_in_src}"
    )


def test_super_admin_features_dont_leak_into_tenant_catalog():
    """ALL_SYSTEM_FEATURES is the tenant-facing catalog. SUPER_ADMIN_FEATURES
    must NOT bleed into it because tenant business types should never see
    super-admin sidebar keys in their feature toggles."""
    tenant_keys = {f["feature_key"] for f in ALL_SYSTEM_FEATURES}
    sa_only_keys = {"companies", "business-types", "partners", "financial",
                    "my-panel", "sgp-repair"}
    overlap = tenant_keys & sa_only_keys
    assert overlap == set(), f"SA-only keys leaked into tenant catalog: {overlap}"


def test_super_admin_features_have_super_admin_category():
    for f in SUPER_ADMIN_FEATURES:
        assert f["category"] == "Super Admin", (
            f"Feature {f['feature_key']!r} has wrong category: {f.get('category')!r}"
        )


def test_plan_type_includes_super_admin():
    """The PlanType enum MUST include `super_admin`, otherwise the Pydantic
    validation on the Business Type editor rejects ANY save with
    base_type=super_admin with HTTP 422. That's what caused the user-reported
    "save doesn't persist and screen goes blank" bug — the toast error fired
    so fast it was invisible and the modal stayed open with stale data."""
    from models import PlanType
    assert PlanType.SUPER_ADMIN == "super_admin"
    # Defensive: ensure all 4 values are present (regression guard for any
    # future enum reorganization).
    values = {p.value for p in PlanType}
    assert "super_admin" in values
    assert {"crm", "scheduling", "both"}.issubset(values)
