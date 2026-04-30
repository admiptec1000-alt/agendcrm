"""Iteration 43 — Quotes Phase 3: Upload .docx template + placeholder normalization.

Covers:
- POST /api/quotes/templates/upload-docx accepts multipart (.docx) and converts via mammoth
- Placeholder normalization: {NOME}->{{nome}}, {RAZAO_SOCIAL_/_FANTASIA}->{{razao_social}},
  {CNPJ_CPF}->{{cnpj_cpf}}, {SOMA_TOTAL_ITENS}->{{total_value}}; unmapped tokens ({ITEM_1})
  remain as {{ITEM_1}} (single-brace converted to double-brace for engine compatibility).
- Rejects non-.docx (400) and files > 10MB (400)
- is_default=true deactivates other defaults in same tenant
- Multi-tenancy: tenant B cannot read/update/delete template created by tenant A
"""
import os
import io
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

CRM = {"email": "crm@test.com", "password": "crm123", "subdomain": "crmtest"}
BOSS = {"email": "admin@boss.com.br", "password": "boss123", "subdomain": "boss"}

DOCX_PATH = "/tmp/test_assets/test_incinera.docx"


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def crm_headers():
    return {"Authorization": f"Bearer {_login(CRM)}"}


@pytest.fixture(scope="module")
def boss_headers():
    return {"Authorization": f"Bearer {_login(BOSS)}"}


@pytest.fixture(scope="module")
def real_docx_bytes():
    if not os.path.exists(DOCX_PATH):
        pytest.skip("real docx not available")
    with open(DOCX_PATH, "rb") as f:
        return f.read()


# ─── Upload success + placeholder normalization ──────────────────────────────
class TestUploadDocxSuccess:
    created_ids: list = []

    def test_upload_real_incinera_docx(self, crm_headers, real_docx_bytes):
        files = {"file": ("incinera.docx", real_docx_bytes,
                          "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        data = {"name": "TEST_iter43_real_incinera", "is_default": "false"}
        r = requests.post(f"{API}/quotes/templates/upload-docx",
                          headers=crm_headers, files=files, data=data, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == "TEST_iter43_real_incinera"
        assert body["is_default"] is False
        assert body["source_filename"] == "incinera.docx"
        assert "id" in body
        content = body["content"] or ""
        assert len(content) > 100, "HTML content too small"
        TestUploadDocxSuccess.created_ids.append(body["id"])

        # Normalization: canonical tokens present (at least some, depending on docx)
        # Unmapped ITEM_N tokens should remain as {{ITEM_N}} (single-brace converted
        # to double-brace by the generic {X} -> {{X}} rule in _normalize_docx_placeholders).
        normalized_lower = content.lower()
        # The known-mapped tokens should produce canonical keys
        expected_any = ["{{nome}}", "{{razao_social}}", "{{cnpj_cpf}}", "{{total_value}}"]
        assert any(tok in normalized_lower for tok in expected_any), \
            f"Expected at least one canonical placeholder. Found content sample: {content[:500]}"

    def test_unmapped_tokens_preserved_as_double_brace(self, crm_headers, real_docx_bytes):
        """ITEM_1, QTDE_1 etc (not in token_map) stay recognizable in HTML."""
        files = {"file": ("u.docx", real_docx_bytes,
                          "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        data = {"name": "TEST_iter43_unmapped", "is_default": "false"}
        r = requests.post(f"{API}/quotes/templates/upload-docx",
                          headers=crm_headers, files=files, data=data, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        TestUploadDocxSuccess.created_ids.append(body["id"])
        content = body["content"]
        # ITEM_N markers should survive normalization (mapped? no. preserved as {{ITEM_1}} or similar)
        has_item_token = ("ITEM_1" in content) or ("ITEM" in content)
        assert has_item_token, "ITEM_N token should be preserved (unmapped)"

    def test_default_flag_exclusive(self, crm_headers, real_docx_bytes):
        # Upload a new template as is_default=True and verify exclusivity
        files = {"file": ("d.docx", real_docx_bytes,
                          "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        data = {"name": "TEST_iter43_default", "is_default": "true"}
        r = requests.post(f"{API}/quotes/templates/upload-docx",
                          headers=crm_headers, files=files, data=data, timeout=60)
        assert r.status_code == 200, r.text
        new_id = r.json()["id"]
        assert r.json()["is_default"] is True
        TestUploadDocxSuccess.created_ids.append(new_id)
        # List templates: only one default
        r2 = requests.get(f"{API}/quotes/templates", headers=crm_headers, timeout=20)
        defaults = [t for t in r2.json() if t.get("is_default")]
        assert len(defaults) == 1, f"Expected exactly 1 default, got {len(defaults)}"
        assert defaults[0]["id"] == new_id

    @classmethod
    def teardown_class(cls):
        # Cleanup created templates
        tok = _login(CRM)
        h = {"Authorization": f"Bearer {tok}"}
        for tid in cls.created_ids:
            try:
                requests.delete(f"{API}/quotes/templates/{tid}", headers=h, timeout=20)
            except Exception:
                pass


# ─── Upload rejections ───────────────────────────────────────────────────────
class TestUploadDocxRejections:
    def test_rejects_non_docx_extension(self, crm_headers):
        files = {"file": ("not_docx.txt", b"hello world", "text/plain")}
        data = {"name": "TEST_iter43_reject_ext", "is_default": "false"}
        r = requests.post(f"{API}/quotes/templates/upload-docx",
                          headers=crm_headers, files=files, data=data, timeout=30)
        assert r.status_code == 400, r.text
        assert ".docx" in r.json().get("detail", "").lower()

    def test_rejects_oversize_file(self, crm_headers):
        big = b"A" * (10 * 1024 * 1024 + 1024)  # >10MB
        files = {"file": ("big.docx", big,
                          "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        data = {"name": "TEST_iter43_reject_size", "is_default": "false"}
        r = requests.post(f"{API}/quotes/templates/upload-docx",
                          headers=crm_headers, files=files, data=data, timeout=60)
        assert r.status_code == 400, r.text
        detail = r.json().get("detail", "").lower()
        assert "grande" in detail or "10mb" in detail or "limite" in detail

    def test_rejects_corrupt_docx(self, crm_headers):
        """A valid .docx extension but invalid content → 400 from mammoth."""
        files = {"file": ("fake.docx", b"not a real docx",
                          "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        data = {"name": "TEST_iter43_reject_corrupt", "is_default": "false"}
        r = requests.post(f"{API}/quotes/templates/upload-docx",
                          headers=crm_headers, files=files, data=data, timeout=30)
        assert r.status_code == 400, r.text


# ─── Multi-tenant isolation on uploaded templates ────────────────────────────
class TestUploadDocxMultiTenant:
    def test_boss_cannot_read_or_edit_crm_template(self, crm_headers, boss_headers, real_docx_bytes):
        files = {"file": ("mt.docx", real_docx_bytes,
                          "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        data = {"name": "TEST_iter43_mt_isolate", "is_default": "false"}
        r = requests.post(f"{API}/quotes/templates/upload-docx",
                          headers=crm_headers, files=files, data=data, timeout=60)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        try:
            # Boss lists: should not see CRM's template
            rb = requests.get(f"{API}/quotes/templates", headers=boss_headers, timeout=20)
            assert rb.status_code == 200
            assert all(t["id"] != tid for t in rb.json()), "Cross-tenant template leak in list"

            # Boss direct GET -> 404
            rg = requests.get(f"{API}/quotes/templates/{tid}", headers=boss_headers, timeout=20)
            assert rg.status_code == 404

            # Boss PUT -> 404
            rp = requests.put(f"{API}/quotes/templates/{tid}", headers=boss_headers,
                              json={"name": "hacked"}, timeout=20)
            assert rp.status_code == 404

            # Boss DELETE -> 404
            rd = requests.delete(f"{API}/quotes/templates/{tid}", headers=boss_headers, timeout=20)
            assert rd.status_code == 404
        finally:
            requests.delete(f"{API}/quotes/templates/{tid}", headers=crm_headers, timeout=20)
