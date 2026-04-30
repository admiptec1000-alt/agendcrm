"""Iteration 45 — Phase 7 Orcamentos: PDF download + upload public endpoint.

Covers:
- GET /api/quotes/{id}/pdf returns %PDF-1.x binary (regression)
- POST /api/upload/ with binary file + auth returns {id, path, filename, url}
- GET /api/upload/files/{path} returns file WITHOUT auth (public read for WeasyPrint)
"""
import os
import io
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

CRM = {"email": "crm@test.com", "password": "crm123"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def crm_headers():
    return {"Authorization": f"Bearer {_login(CRM)}"}


# ─── PDF endpoint regression ─────────────────────────────────────────────────
class TestQuotePDF:
    def test_pdf_binary_returned(self, crm_headers):
        # Provision ticket + quote
        t = requests.post(f"{API}/crm/tickets", headers=crm_headers, json={
            "customer_name": "TEST_iter45 PDF", "customer_phone": "5562911110045",
        }, timeout=20).json()
        tid = t["id"]
        q = requests.post(f"{API}/quotes", headers=crm_headers, json={
            "ticket_id": tid,
            "items": [{"description": "Item PDF", "quantity": 2, "unit_price": 50}],
            "freights": [],
        }, timeout=20).json()
        qid = q["id"]
        try:
            r = requests.get(f"{API}/quotes/{qid}/pdf", headers=crm_headers, timeout=60)
            assert r.status_code == 200, r.text[:500]
            assert r.headers.get("content-type", "").startswith("application/pdf")
            body = r.content
            assert body[:5] == b"%PDF-", f"Not a PDF: {body[:20]!r}"
            # Reasonable size (>1KB)
            assert len(body) > 1024, f"PDF too small: {len(body)} bytes"
        finally:
            requests.delete(f"{API}/quotes/{qid}", headers=crm_headers, timeout=20)
            requests.delete(f"{API}/crm/tickets/{tid}", headers=crm_headers, timeout=20)


# ─── Upload endpoints ────────────────────────────────────────────────────────
# Tiny 1x1 PNG as binary payload
PNG_1x1 = bytes.fromhex(
    "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4"
    "890000000D49444154789C6360000002000005000100A5F645400000000049454E44AE426082"
)


class TestUpload:
    uploaded_path = None
    uploaded_id = None

    def test_upload_requires_auth(self):
        r = requests.post(f"{API}/upload/", files={
            "file": ("px.png", io.BytesIO(PNG_1x1), "image/png")
        }, timeout=30)
        assert r.status_code in (401, 403), r.text[:200]

    def test_upload_returns_url(self, crm_headers):
        r = requests.post(f"{API}/upload/",
                          headers=crm_headers,
                          files={"file": ("test_iter45.png", io.BytesIO(PNG_1x1), "image/png")},
                          timeout=60)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert "id" in d and isinstance(d["id"], str) and len(d["id"]) > 0
        assert "path" in d and d["path"]
        assert d.get("filename") == "test_iter45.png"
        assert d.get("url", "").startswith("/api/upload/files/")
        assert d["url"].endswith(d["path"])
        TestUpload.uploaded_path = d["path"]
        TestUpload.uploaded_id = d["id"]

    def test_download_public_no_auth(self):
        """WeasyPrint fetches images without auth — endpoint must be public."""
        assert TestUpload.uploaded_path, "upload test did not run"
        url = f"{API}/upload/files/{TestUpload.uploaded_path}"
        # NO Authorization header
        r = requests.get(url, timeout=30)
        assert r.status_code == 200, f"Public download failed: {r.status_code} {r.text[:200]}"
        assert r.headers.get("content-type", "").startswith("image/")
        assert r.content[:4] == b"\x89PNG", "Returned content is not a PNG"
        assert len(r.content) == len(PNG_1x1)

    def test_download_nonexistent_404(self):
        r = requests.get(f"{API}/upload/files/agentcrm/uploads/nope/does-not-exist.png", timeout=20)
        assert r.status_code == 404
