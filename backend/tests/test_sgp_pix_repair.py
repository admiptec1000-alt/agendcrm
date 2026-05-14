"""Regression tests for the SGP Pix repair pipeline in
/app/backend/routes/super_admin_routes.py.

These tests cover the migration FROM the legacy 2-bubble Pix chain
(`pix_code_*` + `pix_footer_*` using `{{pix_copia_e_cola}}`) TO the new
single-bubble template that uses `{{link_pix_html}}`. They also assert
idempotency — running the repair twice on the same flow must NOT generate
duplicate bubbles or drift the structure.
"""
import sys
import os
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routes import super_admin_routes as sa  # noqa: E402


def _http_pix_node(node_id="pix_http"):
    return {
        "id": node_id,
        "type": "flow",
        "position": {"x": 0, "y": 0},
        "data": {
            "nodeType": "http",
            "label": "SGP: Pix",
            "config": {
                "url": "{{API_URL}}/api/sgp/pix_copia_e_cola",
                "method": "POST",
                "body": {"params": {"cpfcnpj": "{{cpf_cliente}}"}},
            },
        },
    }


def test_pix_repair_creates_single_link_bubble_from_scratch():
    """Brand-new Pix node (URL points at non-existent /api/sgp/pix_copia_e_cola)
    with no downstream edge: repair must rewrite URL + body and attach ONE
    message node using PIX_LINK_TEMPLATE."""
    flow = {
        "id": "f1",
        "nodes": [_http_pix_node()],
        "edges": [],
    }
    nodes, edges, changes = sa._repair_sgp_flow_data(flow)
    # URL was rewritten
    pix_http = next(n for n in nodes if n["id"] == "pix_http")
    assert pix_http["data"]["config"]["url"].endswith("/api/sgp/fatura2via")
    # Exactly ONE downstream message exists, of the new pix_link_* shape
    pix_msgs = [n for n in nodes if n["id"].startswith("pix_link_")]
    assert len(pix_msgs) == 1
    msg = pix_msgs[0]
    txt = msg["data"]["config"]["text"]
    assert "{{link_pix_html}}" in txt
    assert "{{pix_copia_e_cola}}" not in txt
    # There must be NO legacy pix_code_* / pix_footer_* nodes
    assert not [n for n in nodes if n["id"].startswith(("pix_code_", "pix_footer_"))]
    # The repair claims an attach_pix_link_message action
    actions = [c.get("action") for c in changes]
    assert "attach_pix_link_message" in actions


def test_pix_repair_migrates_legacy_two_bubble_chain():
    """A flow already repaired by an older version of the code has:
        pix_http (now points at fatura2via) → pix_code_xxx → pix_footer_yyy
    The new repair must DELETE both legacy bubbles and replace them with a
    single pix_link_* bubble using PIX_LINK_TEMPLATE."""
    flow = {
        "id": "f2",
        "nodes": [
            {
                "id": "pix_http", "type": "flow", "position": {"x": 0, "y": 0},
                "data": {
                    "nodeType": "http", "label": "SGP: Pix (via fatura2via)",
                    "config": {
                        "url": "{{API_URL}}/api/sgp/fatura2via",
                        "method": "POST",
                        "body": {"params": {"cpfcnpj": "{{cpf_cliente}}", "contrato": "{{contrato_id}}"}},
                    },
                },
            },
            {
                "id": "pix_code_abc123", "type": "flow", "position": {"x": 0, "y": 160},
                "data": {"nodeType": "message", "label": "Pix codigo",
                         "config": {"text": "```\n{{pix_copia_e_cola}}\n```"}},
            },
            {
                "id": "pix_footer_def456", "type": "flow", "position": {"x": 0, "y": 320},
                "data": {"nodeType": "message", "label": "Pix instrucoes",
                         "config": {"text": "Pague via Pix: {{link_pix_html}}"}},
            },
        ],
        "edges": [
            {"id": "e1", "source": "pix_http", "target": "pix_code_abc123"},
            {"id": "e2", "source": "pix_code_abc123", "target": "pix_footer_def456"},
        ],
    }
    nodes, edges, changes = sa._repair_sgp_flow_data(flow)
    node_ids = {n["id"] for n in nodes}
    assert "pix_code_abc123" not in node_ids
    assert "pix_footer_def456" not in node_ids
    pix_links = [n for n in nodes if n["id"].startswith("pix_link_")]
    assert len(pix_links) == 1
    # Edge from pix_http → pix_link_* exists
    new_target = pix_links[0]["id"]
    assert any(e["source"] == "pix_http" and e["target"] == new_target for e in edges)
    # Purge AND attach actions both registered
    actions = [c.get("action") for c in changes]
    assert "purge_legacy_pix_chain" in actions
    assert "attach_pix_link_message" in actions


def test_pix_repair_is_idempotent():
    """Running the repair twice must NOT keep adding new bubbles."""
    flow = {"id": "f3", "nodes": [_http_pix_node()], "edges": []}
    nodes1, edges1, _ = sa._repair_sgp_flow_data(flow)
    # Second pass on the already-repaired structure
    flow2 = {"id": "f3", "nodes": nodes1, "edges": edges1}
    nodes2, edges2, _ = sa._repair_sgp_flow_data(flow2)
    pix_link_count_1 = len([n for n in nodes1 if n["id"].startswith("pix_link_")])
    pix_link_count_2 = len([n for n in nodes2 if n["id"].startswith("pix_link_")])
    assert pix_link_count_1 == 1
    assert pix_link_count_2 == 1
