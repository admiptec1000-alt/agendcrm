"""Iteration 74 — Integracao 8IP Admin -> Financeiro Admin (pull + autoblock).

Sobe um mock do 8IP Admin em thread (http.server) e aponta a integracao
para ele. Roda contra o backend vivo (REACT_APP_BACKEND_URL) + Mongo local.
"""
import asyncio
import json
import os
import sys
import threading
import uuid
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
_fe = {}
with open(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", ".env")) as fh:
    for line in fh:
        if "=" in line:
            k, v = line.strip().split("=", 1)
            _fe[k] = v
BASE_URL = _fe["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
SA_EMAIL, SA_PASSWORD = "admin@agentcrm.com", "admin123"
KEY = "test-key-" + uuid.uuid4().hex[:8]
TAG = "TEST_it74"

STATE = {"tenants": [], "calls": []}


class MockHandler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _auth(self):
        if self.headers.get("X-Integration-Key") != KEY:
            self.send_response(401); self.end_headers(); self.wfile.write(b'{"detail":"bad key"}')
            return False
        return True

    def do_GET(self):
        if self.path == "/api/integrations/billing/tenants":
            if not self._auth():
                return
            body = json.dumps({"tenants": STATE["tenants"]}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        if not self._auth():
            return
        parts = self.path.strip("/").split("/")
        if len(parts) == 6 and parts[-1] in ("block", "unblock"):
            STATE["calls"].append((parts[-2], parts[-1]))
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b'{"ok":true}')
        else:
            self.send_response(404); self.end_headers()


def _mongo():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


def _run(c):
    return asyncio.run(c)


def _tenant(ext_id, name, price, day=10, active=True, phone="5562999990000"):
    return {"id": ext_id, "name": name, "slug": name.lower().replace(" ", ""), "owner_name": "Dono " + name,
            "email": f"{ext_id}@x.com", "phone": phone, "cnpj": None, "is_active": active, "plan_name": "Pro",
            "monthly_price": price, "billing_day": day, "discount": 0, "created_at": "2026-01-05T00:00:00+00:00"}


@pytest.fixture(scope="module")
def env():
    srv = HTTPServer(("127.0.0.1", 0), MockHandler)
    port = srv.server_address[1]
    th = threading.Thread(target=srv.serve_forever, daemon=True); th.start()

    r = requests.post(f"{BASE_URL}/api/auth/super-admin/login", json={"email": SA_EMAIL, "password": SA_PASSWORD}, timeout=30)
    r.raise_for_status()
    tok = r.json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}

    async def _snapshot():
        return await _mongo().system_settings.find_one({"key": "integration_8ip"}, {"_id": 0})
    prev_settings = _run(_snapshot())

    STATE["tenants"] = [
        _tenant(f"{TAG}_a", f"{TAG} Mega Brasil", 197.0, day=10),
        _tenant(f"{TAG}_b", f"{TAG} Izabela Modas", 487.0, day=25),
        _tenant(f"{TAG}_c", f"{TAG} Inativa", 99.0, active=False),
    ]
    yield {"h": h, "port": port, "base": f"http://127.0.0.1:{port}"}

    async def _clean():
        db = _mongo()
        ids = [c["id"] for c in await db.external_billing_clients.find({"source": "8ip", "external_id": {"$regex": f"^{TAG}"}}, {"_id": 0, "id": 1}).to_list(50)]
        await db.super_admin_transactions.delete_many({"external_client_id": {"$in": ids}})
        await db.billing_reminder_history.delete_many({"external_client_id": {"$in": ids}})
        await db.integration_8ip_block_log.delete_many({"external_client_id": {"$in": ids}})
        await db.external_billing_clients.delete_many({"id": {"$in": ids}})
        await db.system_settings.delete_one({"key": "integration_8ip"})
        if prev_settings:
            await db.system_settings.insert_one(prev_settings)
    _run(_clean())
    srv.shutdown()


def _clients(env):
    rows = requests.get(f"{BASE_URL}/api/super-admin/external-clients", headers=env["h"], timeout=30).json()
    return {c["external_id"]: c for c in rows if c.get("source") == "8ip" and str(c.get("external_id", "")).startswith(TAG)}


def _txns(cid):
    async def _q():
        return await _mongo().super_admin_transactions.find({"external_client_id": cid}, {"_id": 0}).sort("due_date", 1).to_list(50)
    return _run(_q())


class TestSettingsAndTest:
    def test_settings_roundtrip_masks_key(self, env):
        r = requests.put(f"{BASE_URL}/api/super-admin/integrations/8ip/settings", headers=env["h"], timeout=30,
                         json={"base_url": env["base"] + "/", "api_key": KEY, "enabled": True, "sync_interval_hours": 6,
                               "auto_block_enabled": True, "auto_block_days": 3})
        assert r.status_code == 200, r.text
        s = r.json()
        assert "api_key" not in s and s["has_api_key"] is True
        assert s["base_url"] == env["base"]
        assert s["auto_block_days"] == 3
        g = requests.get(f"{BASE_URL}/api/super-admin/integrations/8ip/settings", headers=env["h"], timeout=30).json()
        assert g["enabled"] is True and g["api_key_masked"].count("•") >= 8

    def test_empty_key_keeps_existing(self, env):
        r = requests.put(f"{BASE_URL}/api/super-admin/integrations/8ip/settings", headers=env["h"], timeout=30, json={"api_key": ""})
        assert r.json()["has_api_key"] is True

    def test_connection_test(self, env):
        r = requests.post(f"{BASE_URL}/api/super-admin/integrations/8ip/test", headers=env["h"], timeout=30)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["total"] == 3
        assert b["sample"][0]["monthly_price"] == 197.0 and b["sample"][0]["billing_day"] == 10

    def test_wrong_key_rejected(self, env):
        requests.put(f"{BASE_URL}/api/super-admin/integrations/8ip/settings", headers=env["h"], timeout=30, json={"api_key": "wrong"})
        r = requests.post(f"{BASE_URL}/api/super-admin/integrations/8ip/test", headers=env["h"], timeout=30)
        assert r.status_code == 400 and "401" in r.json()["detail"]
        requests.put(f"{BASE_URL}/api/super-admin/integrations/8ip/settings", headers=env["h"], timeout=30, json={"api_key": KEY})


class TestSync:
    def test_sync_creates_clients_and_parcelas(self, env):
        r = requests.post(f"{BASE_URL}/api/super-admin/integrations/8ip/sync", headers=env["h"], timeout=60)
        assert r.status_code == 200, r.text
        res = r.json()
        assert res["ok"] and res["created"] == 3 and res["total"] == 3
        cl = _clients(env)
        a = cl[f"{TAG}_a"]
        assert a["monthly_price"] == 197.0 and a["billing_day"] == 10 and a["is_active"] is True
        assert a["phone"] == "5562999990000" and a["owner_name"].startswith("Dono")
        assert a["first_due_date"] >= date.today().isoformat()
        assert a["first_due_date"].endswith("-10")
        assert cl[f"{TAG}_c"]["is_active"] is False
        # materializacao: pelo menos a proxima mensalidade existe pra 'a'
        tx = _txns(a["id"])
        assert tx, "nenhuma parcela materializada"
        t0 = tx[0]
        assert t0["kind"] == "licenca" and t0["amount"] == 197.0 and t0["status"] == "pendente"
        assert t0["external_client_name"] == a["name"] and t0["source"] == "8ip"
        assert t0["billing_period"] == t0["due_date"][:7]
        assert "company_id" not in t0
        assert t0["recurrence_total"] is None
        assert t0["description"].startswith(f"Mensalidade {a['name']} - ")
        # inativa nao gera parcela
        assert _txns(cl[f"{TAG}_c"]["id"]) == []

    def test_sync_is_idempotent(self, env):
        before = {k: len(_txns(v["id"])) for k, v in _clients(env).items()}
        r = requests.post(f"{BASE_URL}/api/super-admin/integrations/8ip/sync", headers=env["h"], timeout=60).json()
        assert r["created"] == 0 and r["updated"] == 3
        after = {k: len(_txns(v["id"])) for k, v in _clients(env).items()}
        assert before == after

    def test_price_change_updates_pending(self, env):
        STATE["tenants"][0]["monthly_price"] = 250.0
        requests.post(f"{BASE_URL}/api/super-admin/integrations/8ip/sync", headers=env["h"], timeout=60)
        a = _clients(env)[f"{TAG}_a"]
        assert a["monthly_price"] == 250.0
        for t in _txns(a["id"]):
            if t["status"] == "pendente":
                assert t["amount"] == 250.0

    def test_removed_tenant_deactivated(self, env):
        removed = STATE["tenants"].pop(1)  # Izabela
        r = requests.post(f"{BASE_URL}/api/super-admin/integrations/8ip/sync", headers=env["h"], timeout=60).json()
        assert r["deactivated"] == 1
        b = _clients(env)[f"{TAG}_b"]
        assert b["is_active"] is False and b["missing_in_source"] is True
        STATE["tenants"].insert(1, removed)
        requests.post(f"{BASE_URL}/api/super-admin/integrations/8ip/sync", headers=env["h"], timeout=60)
        assert _clients(env)[f"{TAG}_b"]["is_active"] is True

    def test_transactions_list_shows_external(self, env):
        a = _clients(env)[f"{TAG}_a"]
        rows = requests.get(f"{BASE_URL}/api/super-admin/finance/transactions", headers=env["h"], timeout=30,
                            params={"kind": "licenca", "status": "pendente"}).json()
        mine = [t for t in rows if t.get("external_client_id") == a["id"]]
        assert mine and mine[0]["external_client_name"] == a["name"]


class TestAutoblock:
    def test_overdue_blocks_and_payment_unblocks(self, env):
        from services.integration_8ip import process_autoblock
        a = _clients(env)[f"{TAG}_a"]
        old_due = (date.today() - timedelta(days=10)).isoformat()

        async def _seed():
            db = _mongo()
            await db.super_admin_transactions.insert_one({
                "id": str(uuid.uuid4()), "direction": "entrada", "status": "pendente", "amount": 250.0,
                "description": f"Mensalidade {a['name']} - vencida", "date": old_due, "due_date": old_due,
                "kind": "licenca", "external_client_id": a["id"], "external_client_name": a["name"],
                "source": "8ip", "billing_period": old_due[:7], "auto_company_billing": True,
                "created_at": "2026-01-01T00:00:00+00:00"})
            return await process_autoblock(db)
        STATE["calls"].clear()
        res = _run(_seed())
        assert res["blocked"] == 1, res
        assert (f"{TAG}_a", "block") in STATE["calls"]
        a2 = _clients(env)[f"{TAG}_a"]
        assert a2["blocked_by_billing"] is True and a2["block_reason"]

        async def _pay_and_run():
            db = _mongo()
            await db.super_admin_transactions.update_many(
                {"external_client_id": a["id"], "status": "pendente", "due_date": {"$lte": old_due}},
                {"$set": {"status": "pago"}})
            return await process_autoblock(db)
        STATE["calls"].clear()
        res2 = _run(_pay_and_run())
        assert res2["unblocked"] == 1, res2
        assert (f"{TAG}_a", "unblock") in STATE["calls"]
        assert _clients(env)[f"{TAG}_a"]["blocked_by_billing"] is False

    def test_manual_block_endpoint(self, env):
        a = _clients(env)[f"{TAG}_a"]
        STATE["calls"].clear()
        r = requests.post(f"{BASE_URL}/api/super-admin/integrations/8ip/clients/{a['id']}/block", headers=env["h"], timeout=30)
        assert r.status_code == 200 and r.json()["blocked_by_billing"] is True
        r = requests.post(f"{BASE_URL}/api/super-admin/integrations/8ip/clients/{a['id']}/unblock", headers=env["h"], timeout=30)
        assert r.status_code == 200 and r.json()["blocked_by_billing"] is False
        assert STATE["calls"] == [(f"{TAG}_a", "block"), (f"{TAG}_a", "unblock")]
        log = requests.get(f"{BASE_URL}/api/super-admin/integrations/8ip/block-log", headers=env["h"], timeout=30).json()
        assert any(l["external_client_id"] == a["id"] and l["by"] == "manual" for l in log)

    def test_disabled_autoblock_noop(self, env):
        from services.integration_8ip import process_autoblock
        requests.put(f"{BASE_URL}/api/super-admin/integrations/8ip/settings", headers=env["h"], timeout=30, json={"auto_block_enabled": False})
        assert _run(process_autoblock(_mongo())) == {"blocked": 0, "unblocked": 0, "errors": 0}


class TestHelpers:
    def test_first_due_from(self):
        from services.integration_8ip import _first_due_from
        today = date.today()
        d = date.fromisoformat(_first_due_from(10, None))
        assert d >= today and d.day == 10
        d31 = date.fromisoformat(_first_due_from(31, None))
        assert d31 >= today and d31.day in (31, 28)
        past = date.fromisoformat(_first_due_from(5, "2025-01-01T00:00:00Z"))
        assert past >= today  # nunca retroage antes de hoje

    def test_map_tenant_variants(self):
        from services.integration_8ip import map_tenant
        m = map_tenant({"id": 7, "name": " X ", "mensalidade": "197,50", "due_day": "15", "phone": "(62) 9 9999-0000", "active": False})
        assert m["external_id"] == "7" and m["name"] == "X" and m["monthly_price"] == 197.5
        assert m["billing_day"] == 15 and m["phone"] == "62999990000" and m["is_active"] is False
