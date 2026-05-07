"""Iteration 50 — Test:
1. _flatten_sgp_response unit tests for consultacliente/fatura2via/verificaacesso/manutencao
2. Flow engine debug endpoints: /tickets/{id}/flow-state, /reset-flow, /test-flow
3. Appointment block (is_block) creation without service_id (Boss tenant)
"""
import os
import sys
import uuid
import pytest
import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://agentcrm-book.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

CRM_EMAIL = "crm@test.com"
CRM_PASS = "crm123"
BOSS_EMAIL = "admin@boss.com.br"
BOSS_PASS = "boss123"


@pytest.fixture(scope="module")
def crm_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": CRM_EMAIL, "password": CRM_PASS}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"CRM login failed: {r.status_code} {r.text}")
    tok = r.json().get("access_token") or r.json().get("token")
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def boss_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": BOSS_EMAIL, "password": BOSS_PASS}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"Boss login failed: {r.status_code} {r.text}")
    tok = r.json().get("access_token") or r.json().get("token")
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


# ============================================================================
# 1. _flatten_sgp_response — pure unit tests
# ============================================================================
class TestFlattenSgpResponse:
    def test_consultacliente_extracts_top_level_vars(self):
        from flow_engine import _flatten_sgp_response
        sample = {"clientes": [{
            "nome": "Joao da Silva",
            "cpfcnpj": "12345678900",
            "email": "joao@x.com",
            "contratos": [{
                "contrato": "9876", "status": "Ativo",
                "plano": "Fibra 500", "endereco": "Rua A, 123",
            }],
        }]}
        out = _flatten_sgp_response("consultacliente", sample)
        assert out["nome_cliente"] == "Joao da Silva"
        assert out["cpfcnpj_cliente"] == "12345678900"
        assert out["email_cliente"] == "joao@x.com"
        assert out["numero_contrato"] == "9876"
        assert out["status_contrato"] == "Ativo"
        assert out["plano_cliente"] == "Fibra 500"

    def test_consultacliente_handles_missing_fields(self):
        from flow_engine import _flatten_sgp_response
        out = _flatten_sgp_response("consultacliente", {"clientes": [{"razaosocial": "Empresa X"}]})
        assert out["nome_cliente"] == "Empresa X"
        assert out["cpfcnpj_cliente"] == ""

    def test_fatura2via_extracts_boleto_url_and_linha(self):
        from flow_engine import _flatten_sgp_response
        sample = {"faturas": [{
            "link": "https://sgp/x/boleto.pdf",
            "linhadigitavel": "00190.00009 03372.397109 99999.999999 9 12345",
            "valor": 199.90, "vencimento": "2026-01-20",
        }]}
        out = _flatten_sgp_response("fatura2via", sample)
        assert out["boleto_url"] == "https://sgp/x/boleto.pdf"
        assert "00190" in out["linha_digitavel"]
        assert out["valor_fatura"] == "199.9"
        assert out["vencimento_fatura"] == "2026-01-20"

    def test_fatura2via_fallback_to_top_level(self):
        from flow_engine import _flatten_sgp_response
        out = _flatten_sgp_response("fatura2via", {"link": "https://x/b.pdf", "linhadigitavel": "111"})
        assert out["boleto_url"] == "https://x/b.pdf"
        assert out["linha_digitavel"] == "111"

    def test_verificaacesso_online_status(self):
        from flow_engine import _flatten_sgp_response
        assert _flatten_sgp_response("verificaacesso", {"online": True})["status_online_offline"] == "Online"
        assert _flatten_sgp_response("verificaacesso", {"online": False})["status_online_offline"] == "Offline"
        assert _flatten_sgp_response("verificaacesso", {"status": "Cliente Online"})["status_online_offline"] == "Online"

    def test_manutencao_with_active_and_empty(self):
        from flow_engine import _flatten_sgp_response
        out = _flatten_sgp_response("manutencao", {"manutencoes": [
            {"descricao": "Cabo rompido", "mensagem": "Previsao 18h", "status": "Em andamento"}
        ]})
        assert out["descricao"] == "Cabo rompido"
        assert "Previsao" in out["mensagem_central"]

        out2 = _flatten_sgp_response("manutencao", {"manutencoes": []})
        assert "Sem manutencoes" in out2["descricao"]

    def test_invalid_input_returns_empty_dict(self):
        from flow_engine import _flatten_sgp_response
        assert _flatten_sgp_response("consultacliente", None) == {}
        assert _flatten_sgp_response("consultacliente", "not-a-dict") == {}


# ============================================================================
# 2. Flow debug endpoints  (CRM tenant)
# ============================================================================
@pytest.fixture(scope="module")
def crm_test_ticket_and_flow(crm_session):
    flow_body = {
        "name": f"TEST_iter50_flow_{uuid.uuid4().hex[:6]}",
        "nodes": [
            {"id": "start", "type": "flow", "data": {"nodeType": "start", "label": "Inicio"}},
            {"id": "welcome", "type": "flow", "data": {"nodeType": "message", "config": {"text": "Olá {{customer_name}}!"}}},
            {"id": "menu", "type": "flow", "data": {"nodeType": "menu", "config": {
                "text": "Escolha:",
                "options": [{"label": "Planos", "key": "1"}, {"label": "Suporte", "key": "2"}],
            }}},
            {"id": "planos", "type": "flow", "data": {"nodeType": "message", "config": {"text": "Plano A"}}},
            {"id": "support", "type": "flow", "data": {"nodeType": "ticket", "config": {"queue": "Suporte"}}},
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "welcome"},
            {"id": "e2", "source": "welcome", "target": "menu"},
            {"id": "e3", "source": "menu", "target": "planos", "sourceHandle": "option-0"},
            {"id": "e4", "source": "menu", "target": "support", "sourceHandle": "option-1"},
        ],
    }
    r = crm_session.post(f"{API}/crm/flows", json=flow_body, timeout=20)
    assert r.status_code in (200, 201), f"flow create: {r.status_code} {r.text}"
    flow = r.json()
    flow_id = flow.get("id") or flow.get("_id")
    assert flow_id

    rc = crm_session.get(f"{API}/channels/connections", timeout=20)
    assert rc.status_code == 200, rc.text
    conns = rc.json()
    if not conns:
        # Seed a connection for the test
        cnew = crm_session.post(
            f"{API}/channels/connections",
            json={"name": f"TEST_iter50_conn_{uuid.uuid4().hex[:6]}", "type": "whatsapp", "phone": "5511900000000"},
            timeout=20,
        )
        assert cnew.status_code in (200, 201), f"create conn: {cnew.status_code} {cnew.text}"
        conn_id = cnew.json()["id"]
    else:
        conn_id = conns[0]["id"]

    crm_session.put(f"{API}/channels/connections/{conn_id}", json={"default_flow_id": flow_id}, timeout=20)

    # Generate 13-digit Brazilian phone
    suffix = f"{uuid.uuid4().int % 100000000:08d}"
    phone = f"55119{suffix}"  # 13 digits total
    payload = {
        "instance_id": conn_id, "phone": phone,
        "name": "TEST iter50 Cliente", "message": "Oi",
        "message_id": f"TEST_iter50_{uuid.uuid4().hex[:8]}",
    }
    rw = crm_session.post(f"{API}/channels/webhook/message", json=payload, timeout=30)
    assert rw.status_code in (200, 201, 202), f"webhook: {rw.status_code} {rw.text}"
    wb = rw.json()
    if wb.get("ok") is False:
        pytest.skip(f"Webhook rejected: {wb}")

    rt = crm_session.get(f"{API}/crm/tickets", params={"search": phone}, timeout=20)
    assert rt.status_code == 200, rt.text
    tickets = rt.json()
    if isinstance(tickets, dict):
        tickets = tickets.get("tickets") or tickets.get("items") or []
    matched = [t for t in tickets if (t.get("customer_phone") or "").endswith(phone[-9:])]
    if not matched:
        pytest.skip(f"Could not find ticket for phone {phone}")
    return {"ticket_id": matched[0]["id"], "flow_id": flow_id, "conn_id": conn_id, "phone": phone}


class TestFlowDebugEndpoints:
    def test_get_flow_state_returns_active_flow_after_webhook(self, crm_session, crm_test_ticket_and_flow):
        ctx = crm_test_ticket_and_flow
        r = crm_session.get(f"{API}/crm/tickets/{ctx['ticket_id']}/flow-state", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ticket"]["id"] == ctx["ticket_id"]
        assert body["ticket"].get("active_flow_id") == ctx["flow_id"]
        assert body["flow"] is not None
        assert body["flow"]["node_count"] >= 5
        assert body["flow"]["current_node"] is not None
        assert body["flow"]["current_node"]["id"] == "menu"

    def test_get_flow_state_404_for_unknown_ticket(self, crm_session):
        r = crm_session.get(f"{API}/crm/tickets/nonexistent-ticket-id/flow-state", timeout=20)
        assert r.status_code == 404

    def test_test_flow_dry_run_for_menu_reply(self, crm_session, crm_test_ticket_and_flow):
        ctx = crm_test_ticket_and_flow
        r = crm_session.post(
            f"{API}/crm/tickets/{ctx['ticket_id']}/test-flow",
            json={"incoming_text": "1", "is_initial": False}, timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert any("Plano A" in m for m in body["messages_sent"])
        assert body["is_initial"] is False

    def test_test_flow_initial_returns_welcome_and_menu(self, crm_session, crm_test_ticket_and_flow):
        ctx = crm_test_ticket_and_flow
        r = crm_session.post(
            f"{API}/crm/tickets/{ctx['ticket_id']}/test-flow",
            json={"is_initial": True}, timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["messages_sent"]) >= 2
        assert "Olá" in body["messages_sent"][0]
        assert "Escolha:" in body["messages_sent"][1]

    def test_reset_flow_clears_state(self, crm_session, crm_test_ticket_and_flow):
        ctx = crm_test_ticket_and_flow
        r = crm_session.post(f"{API}/crm/tickets/{ctx['ticket_id']}/reset-flow", timeout=20)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        r2 = crm_session.get(f"{API}/crm/tickets/{ctx['ticket_id']}/flow-state", timeout=20)
        assert r2.status_code == 200
        st = r2.json()
        assert st["ticket"].get("active_flow_id") in (None, "")
        assert st["ticket"].get("active_flow_node_id") in (None, "")
        assert st["flow"] is None

    def test_reset_flow_404(self, crm_session):
        r = crm_session.post(f"{API}/crm/tickets/nonexistent/reset-flow", timeout=20)
        assert r.status_code == 404


# ============================================================================
# 3. Appointment block (is_block) — Boss tenant
# ============================================================================
@pytest.fixture(scope="module")
def boss_professional(boss_session):
    r = boss_session.get(f"{API}/scheduling/professionals", timeout=20)
    assert r.status_code == 200, r.text
    profs = r.json()
    if not profs:
        pytest.skip("No professionals in Boss tenant.")
    return profs[0]


class TestAppointmentBlock:
    def test_create_block_without_service_id(self, boss_session, boss_professional):
        body = {
            "is_block": True, "block_duration": 60, "block_reason": "Almoço",
            "professional_id": boss_professional["id"],
            "date": "2030-01-15", "time": "12:00",
            "customer_name": "Bloqueio", "customer_phone": "",
        }
        r = boss_session.post(f"{API}/scheduling/appointments", json=body, timeout=20)
        assert r.status_code in (200, 201), f"create block: {r.status_code} {r.text}"
        apt = r.json()
        assert apt.get("is_block") is True
        assert apt.get("service_id") in (None, "")
        assert apt.get("duration") == 60
        assert apt.get("block_reason") == "Almoço"
        assert apt.get("professional_id") == boss_professional["id"]
        boss_session.delete(f"{API}/scheduling/appointments/{apt['id']}", timeout=20)

    def test_block_appears_in_list_appointments(self, boss_session, boss_professional):
        body = {
            "is_block": True, "block_duration": 30,
            "block_reason": "TEST_iter50 reuniao",
            "professional_id": boss_professional["id"],
            "date": "2030-02-20", "time": "10:00",
            "customer_name": "Bloqueio", "customer_phone": "",
        }
        rc = boss_session.post(f"{API}/scheduling/appointments", json=body, timeout=20)
        assert rc.status_code in (200, 201), rc.text
        apt = rc.json()
        try:
            r = boss_session.get(f"{API}/scheduling/appointments", params={"date": "2030-02-20"}, timeout=20)
            assert r.status_code == 200
            apts = r.json()
            ids = [a["id"] for a in apts]
            assert apt["id"] in ids
            found = next(a for a in apts if a["id"] == apt["id"])
            assert found.get("is_block") is True
            assert found.get("block_reason") == "TEST_iter50 reuniao"
        finally:
            boss_session.delete(f"{API}/scheduling/appointments/{apt['id']}", timeout=20)

    def test_normal_appointment_still_requires_service_id(self, boss_session, boss_professional):
        body = {
            "is_block": False,
            "professional_id": boss_professional["id"],
            "date": "2030-03-10", "time": "14:00",
            "customer_name": "Cliente Teste", "customer_phone": "11999999999",
        }
        r = boss_session.post(f"{API}/scheduling/appointments", json=body, timeout=20)
        assert r.status_code == 400
        assert "service_id" in r.text.lower() or "servic" in r.text.lower()
