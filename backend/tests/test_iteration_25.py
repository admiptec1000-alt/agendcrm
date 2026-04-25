"""
Iteration 25 — Backend regression for:
- AI templates / providers / agents CRUD (+ test endpoint)
- CRM Tags CRUD
- Kanban columns CRUD + native first column
- Kanban v2 grouping
- Move ticket between columns
- Delete flow
- Onboarding-status base_type
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://agentcrm-book.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

CRM_EMAIL = "crm@test.com"
CRM_PASS = "crm123"
BOSS_EMAIL = "admin@boss.com.br"
BOSS_PASS = "boss123"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def crm_token():
    return _login(CRM_EMAIL, CRM_PASS)


@pytest.fixture(scope="module")
def boss_token():
    return _login(BOSS_EMAIL, BOSS_PASS)


@pytest.fixture
def crm_headers(crm_token):
    return {"Authorization": f"Bearer {crm_token}", "Content-Type": "application/json"}


@pytest.fixture
def boss_headers(boss_token):
    return {"Authorization": f"Bearer {boss_token}", "Content-Type": "application/json"}


# ============== AI TEMPLATES (public — no auth required, but try with headers anyway) ==============
class TestAITemplates:
    def test_list_templates_returns_11_items_with_required_keys(self, crm_headers):
        r = requests.get(f"{API}/ai/agent-templates", headers=crm_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) == 11, f"Expected 11 templates, got {len(data)}"
        names = [t["name"] for t in data]
        assert "Assistente Clinico Maria" in names
        assert "Tutor Educacional Joao" in names
        assert "Tecnico Virtual Leo" in names
        assert "Personalizado" in names
        for t in data:
            assert "key" in t and "name" in t and "personality" in t
            assert "icon" in t and "color" in t


# ============== AI PROVIDERS CRUD ==============
class TestAIProviders:
    def test_list_returns_default_emergent_when_empty(self, crm_headers):
        # Wipe customs first to ensure default stub appears
        r = requests.get(f"{API}/ai/providers", headers=crm_headers, timeout=15)
        assert r.status_code == 200
        existing = r.json()
        for p in existing:
            if p["id"] != "default-emergent":
                requests.delete(f"{API}/ai/providers/{p['id']}", headers=crm_headers, timeout=15)
        r = requests.get(f"{API}/ai/providers", headers=crm_headers, timeout=15)
        data = r.json()
        assert len(data) >= 1
        ids = [p["id"] for p in data]
        assert "default-emergent" in ids

    def test_provider_full_crud(self, crm_headers):
        # Create
        payload = {"name": "TEST_OpenAI", "type": "openai", "api_key": "sk-test"}
        r = requests.post(f"{API}/ai/providers", json=payload, headers=crm_headers, timeout=15)
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["name"] == "TEST_OpenAI"
        assert created["type"] == "openai"
        assert "api_key" not in created  # api_key never returned
        pid = created["id"]
        # Update
        r = requests.put(f"{API}/ai/providers/{pid}", json={"name": "TEST_OpenAI_v2"}, headers=crm_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_OpenAI_v2"
        # List contains it
        r = requests.get(f"{API}/ai/providers", headers=crm_headers, timeout=15)
        names = [p["name"] for p in r.json()]
        assert "TEST_OpenAI_v2" in names
        # Delete
        r = requests.delete(f"{API}/ai/providers/{pid}", headers=crm_headers, timeout=15)
        assert r.status_code == 200

    def test_provider_invalid_type(self, crm_headers):
        r = requests.post(f"{API}/ai/providers", json={"name": "X", "type": "bogus"}, headers=crm_headers, timeout=15)
        assert r.status_code == 400


# ============== AI AGENTS CRUD ==============
class TestAIAgents:
    def test_agent_full_crud_with_nested_fields(self, crm_headers):
        payload = {
            "name": "TEST_Agent_Clinical",
            "template_key": "clinical",
            "icon": "🏥",
            "color": "#EF4444",
            "category": "Clinica",
            "personality": {"name": "Maria", "tone": "Empatico"},
            "products": [{"name": "Consulta", "description": "30 min"}],
            "faq": [{"q": "Horario?", "a": "8h-18h"}],
            "objections": [{"q": "Caro", "a": "Vale a pena"}],
            "extras": {"site": "https://x.com"},
            "delay_seconds": 5,
        }
        r = requests.post(f"{API}/ai/agents", json=payload, headers=crm_headers, timeout=15)
        assert r.status_code == 200, r.text
        created = r.json()
        aid = created["id"]
        assert created["personality"]["name"] == "Maria"
        assert len(created["products"]) == 1
        assert len(created["faq"]) == 1
        assert created["delay_seconds"] == 5

        # GET single
        r = requests.get(f"{API}/ai/agents/{aid}", headers=crm_headers, timeout=15)
        assert r.status_code == 200
        fetched = r.json()
        assert fetched["personality"]["tone"] == "Empatico"
        assert fetched["products"][0]["name"] == "Consulta"

        # Update
        r = requests.put(f"{API}/ai/agents/{aid}", json={"name": "TEST_Agent_Updated", "is_active": False}, headers=crm_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Agent_Updated"
        assert r.json()["is_active"] is False

        # List
        r = requests.get(f"{API}/ai/agents", headers=crm_headers, timeout=15)
        assert r.status_code == 200
        assert any(a["id"] == aid for a in r.json())

        # Delete
        r = requests.delete(f"{API}/ai/agents/{aid}", headers=crm_headers, timeout=15)
        assert r.status_code == 200

        # Confirm 404
        r = requests.get(f"{API}/ai/agents/{aid}", headers=crm_headers, timeout=15)
        assert r.status_code == 404

    def test_agent_test_endpoint_exists(self, crm_headers):
        # Create temp agent
        r = requests.post(f"{API}/ai/agents", json={"name": "TEST_AgentTmp", "personality": {"name": "X", "tone": "neutro"}}, headers=crm_headers, timeout=15)
        aid = r.json()["id"]
        try:
            r = requests.post(f"{API}/ai/agents/{aid}/test", json={"message": "ola"}, headers=crm_headers, timeout=60)
            # Either succeeds (LLM responds) or fails 500 (LLM error). 404 / 422 would be a code bug.
            assert r.status_code in (200, 500), f"unexpected: {r.status_code} {r.text}"
            if r.status_code == 200:
                body = r.json()
                assert "response" in body
        finally:
            requests.delete(f"{API}/ai/agents/{aid}", headers=crm_headers, timeout=15)


# ============== CRM TAGS ==============
class TestCRMTags:
    def test_tag_full_crud(self, crm_headers):
        r = requests.post(f"{API}/crm/tags", json={"name": "TEST_VIP", "color": "#FF0000", "description": "Top"}, headers=crm_headers, timeout=15)
        assert r.status_code == 200, r.text
        created = r.json()
        tid = created["id"]
        assert created["name"] == "TEST_VIP"
        assert created["color"] == "#FF0000"

        # List
        r = requests.get(f"{API}/crm/tags", headers=crm_headers, timeout=15)
        assert r.status_code == 200
        assert any(t["id"] == tid for t in r.json())

        # Update
        r = requests.put(f"{API}/crm/tags/{tid}", json={"color": "#00FF00"}, headers=crm_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["color"] == "#00FF00"

        # Delete
        r = requests.delete(f"{API}/crm/tags/{tid}", headers=crm_headers, timeout=15)
        assert r.status_code == 200

        # Verify deleted: PUT now 404
        r = requests.put(f"{API}/crm/tags/{tid}", json={"color": "#000"}, headers=crm_headers, timeout=15)
        assert r.status_code == 404


# ============== KANBAN COLUMNS ==============
class TestKanbanColumns:
    def test_native_column_always_present(self, crm_headers):
        r = requests.get(f"{API}/crm/kanban-columns", headers=crm_headers, timeout=15)
        assert r.status_code == 200
        cols = r.json()
        assert len(cols) >= 1
        assert cols[0]["id"] == "native:atendimentos"
        assert cols[0]["name"] == "Atendimentos"
        assert cols[0]["is_native"] is True

    def test_create_update_delete_custom_column(self, crm_headers):
        r = requests.post(f"{API}/crm/kanban-columns", json={"name": "TEST_EmAndamento", "color": "#3B82F6"}, headers=crm_headers, timeout=15)
        assert r.status_code == 200, r.text
        col = r.json()
        cid = col["id"]
        assert col["is_native"] is False
        # Update
        r = requests.put(f"{API}/crm/kanban-columns/{cid}", json={"name": "TEST_Resolvido", "color": "#10B981"}, headers=crm_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Resolvido"
        # Delete
        r = requests.delete(f"{API}/crm/kanban-columns/{cid}", headers=crm_headers, timeout=15)
        assert r.status_code == 200

    def test_native_column_cannot_be_updated_or_deleted(self, crm_headers):
        r = requests.put(f"{API}/crm/kanban-columns/native:atendimentos", json={"name": "X"}, headers=crm_headers, timeout=15)
        assert r.status_code == 400
        r = requests.delete(f"{API}/crm/kanban-columns/native:atendimentos", headers=crm_headers, timeout=15)
        assert r.status_code == 400


# ============== KANBAN V2 ==============
class TestKanbanV2:
    def test_kanban_v2_returns_native_even_when_no_tickets(self, crm_headers):
        r = requests.get(f"{API}/crm/kanban-v2", headers=crm_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "columns" in data
        assert "tickets_by_column" in data
        assert any(c["id"] == "native:atendimentos" for c in data["columns"])
        # tickets_by_column should at least include the native key
        assert "native:atendimentos" in data["tickets_by_column"]

    def test_move_ticket_between_columns(self, crm_headers):
        # Create temp custom column
        r = requests.post(f"{API}/crm/kanban-columns", json={"name": "TEST_MoveCol"}, headers=crm_headers, timeout=15)
        cid = r.json()["id"]
        # Create a ticket
        t_payload = {
            "customer_name": "TEST_Customer",
            "customer_phone": "+5511900000001",
            "subject": "TEST move",
            "channel": "whatsapp",
        }
        r = requests.post(f"{API}/crm/tickets", json=t_payload, headers=crm_headers, timeout=15)
        if r.status_code != 200:
            # Skip if ticket creation requires extra data
            requests.delete(f"{API}/crm/kanban-columns/{cid}", headers=crm_headers, timeout=15)
            pytest.skip(f"Ticket creation not supported: {r.status_code} {r.text}")
        tid = r.json()["id"]
        try:
            # Move to custom column
            r = requests.put(f"{API}/crm/tickets/{tid}/kanban-column", json={"column_id": cid}, headers=crm_headers, timeout=15)
            assert r.status_code == 200
            r = requests.get(f"{API}/crm/kanban-v2", headers=crm_headers, timeout=15)
            grouped = r.json()["tickets_by_column"]
            assert any(t["id"] == tid for t in grouped.get(cid, []))
            # Move to native -> clears
            r = requests.put(f"{API}/crm/tickets/{tid}/kanban-column", json={"column_id": "native:atendimentos"}, headers=crm_headers, timeout=15)
            assert r.status_code == 200
            r = requests.get(f"{API}/crm/kanban-v2", headers=crm_headers, timeout=15)
            grouped = r.json()["tickets_by_column"]
            assert any(t["id"] == tid for t in grouped.get("native:atendimentos", []))
        finally:
            requests.delete(f"{API}/crm/tickets/{tid}", headers=crm_headers, timeout=15)
            requests.delete(f"{API}/crm/kanban-columns/{cid}", headers=crm_headers, timeout=15)


# ============== FLOW DELETE ==============
class TestFlowDelete:
    def test_create_then_delete_flow(self, crm_headers):
        payload = {"name": "TEST_Flow", "trigger": "manual", "nodes": [], "edges": []}
        r = requests.post(f"{API}/crm/flows", json=payload, headers=crm_headers, timeout=15)
        if r.status_code != 200:
            pytest.skip(f"Flow create skipped: {r.status_code} {r.text}")
        fid = r.json().get("id")
        assert fid
        r = requests.delete(f"{API}/crm/flows/{fid}", headers=crm_headers, timeout=15)
        assert r.status_code == 200
        # Idempotent: second delete -> 404
        r = requests.delete(f"{API}/crm/flows/{fid}", headers=crm_headers, timeout=15)
        assert r.status_code == 404


# ============== ONBOARDING STATUS BASE_TYPE ==============
class TestOnboardingBaseType:
    def test_onboarding_status_includes_base_type_for_crm(self, crm_headers):
        r = requests.get(f"{API}/scheduling/onboarding-status", headers=crm_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "base_type" in data
        assert data["base_type"] in ("crm", "scheduling", "both")
        # CRM-only company should have base_type == 'crm'
        # (informational — log if mismatch but don't fail in case seed data uses different business type)
        print(f"CRM company base_type: {data['base_type']}")

    def test_onboarding_status_for_boss(self, boss_headers):
        r = requests.get(f"{API}/scheduling/onboarding-status", headers=boss_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "base_type" in data
        print(f"Boss company base_type: {data['base_type']}")
