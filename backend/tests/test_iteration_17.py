"""
Iteration 17 Tests - WhatsApp Baileys Integration & Channels API
Tests:
- WhatsApp Node.js service health and instances
- Backend channels routes (connections, QR, webhooks)
- Connection lifecycle (create, connect, QR, disconnect)
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
WA_SERVICE_URL = "http://localhost:3002"

# Test credentials
BOSS_EMAIL = "admin@boss.com.br"
BOSS_PASSWORD = "boss123"
BOSS_SUBDOMAIN = "boss"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for Boss company"""
    response = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": BOSS_EMAIL, "password": BOSS_PASSWORD, "subdomain": BOSS_SUBDOMAIN}
    )
    assert response.status_code == 200, f"Login failed: {response.text}"
    data = response.json()
    assert "access_token" in data
    return data["access_token"]


@pytest.fixture(scope="module")
def auth_headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestWhatsAppNodeService:
    """Tests for WhatsApp Baileys Node.js microservice on port 3002"""
    
    def test_health_endpoint(self):
        """GET /health returns ok status"""
        response = requests.get(f"{WA_SERVICE_URL}/health", timeout=5)
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "ok"
        assert "instances" in data
        print(f"WhatsApp service healthy: {data}")
    
    def test_instances_list(self):
        """GET /instances returns list of active instances"""
        response = requests.get(f"{WA_SERVICE_URL}/instances", timeout=5)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Active instances: {len(data)}")
        for inst in data:
            assert "id" in inst
            assert "status" in inst
            print(f"  - Instance {inst['id']}: status={inst['status']}, hasQR={inst.get('hasQR')}")


class TestChannelConnectionsAPI:
    """Tests for backend /api/channels/connections endpoints"""
    
    def test_list_connections(self, auth_headers):
        """GET /api/channels/connections returns connection list"""
        response = requests.get(f"{BASE_URL}/api/channels/connections", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Connections found: {len(data)}")
        for conn in data:
            print(f"  - {conn.get('name')}: type={conn.get('type')}, status={conn.get('status')}")
    
    def test_create_connection(self, auth_headers):
        """POST /api/channels/connections creates new WhatsApp connection"""
        payload = {
            "name": "TEST_WhatsApp_Connection",
            "type": "whatsapp",
            "phone": "+5562999990000"
        }
        response = requests.post(
            f"{BASE_URL}/api/channels/connections",
            headers=auth_headers,
            json=payload
        )
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data.get("name") == "TEST_WhatsApp_Connection"
        assert data.get("type") == "whatsapp"
        assert data.get("status") == "disconnected"
        print(f"Created connection: {data['id']}")
        return data["id"]
    
    def test_connect_triggers_baileys(self, auth_headers):
        """POST /api/channels/connections/{id}/connect triggers Baileys connection"""
        # First get existing connections
        response = requests.get(f"{BASE_URL}/api/channels/connections", headers=auth_headers)
        connections = response.json()
        
        # Find a WhatsApp connection to test
        wa_conn = next((c for c in connections if c.get("type") == "whatsapp"), None)
        if not wa_conn:
            # Create one
            create_resp = requests.post(
                f"{BASE_URL}/api/channels/connections",
                headers=auth_headers,
                json={"name": "TEST_Connect_WA", "type": "whatsapp"}
            )
            wa_conn = create_resp.json()
        
        conn_id = wa_conn["id"]
        
        # Trigger connect
        response = requests.post(
            f"{BASE_URL}/api/channels/connections/{conn_id}/connect",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        # Status should be connecting or waiting_qr
        assert data.get("status") in ["connecting", "waiting_qr", "connected"]
        print(f"Connect triggered for {conn_id}: status={data.get('status')}")
        return conn_id
    
    def test_get_qr_code(self, auth_headers):
        """GET /api/channels/connections/{id}/qr returns QR code from Baileys"""
        # Get connections
        response = requests.get(f"{BASE_URL}/api/channels/connections", headers=auth_headers)
        connections = response.json()
        
        # Find a WhatsApp connection
        wa_conn = next((c for c in connections if c.get("type") == "whatsapp"), None)
        if not wa_conn:
            pytest.skip("No WhatsApp connection available")
        
        conn_id = wa_conn["id"]
        
        # First trigger connect to generate QR
        requests.post(f"{BASE_URL}/api/channels/connections/{conn_id}/connect", headers=auth_headers)
        
        # Wait a bit for QR generation
        time.sleep(2)
        
        # Get QR
        response = requests.get(
            f"{BASE_URL}/api/channels/connections/{conn_id}/qr",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        print(f"QR response for {conn_id}: status={data.get('status')}, has_qr_base64={bool(data.get('qr_base64'))}")
        
        # If status is waiting_qr, qr_base64 should be present
        if data.get("status") == "waiting_qr":
            assert data.get("qr_base64") is not None, "QR base64 should be present when status is waiting_qr"
            assert data["qr_base64"].startswith("data:image/png;base64,"), "QR should be base64 PNG"
            print("QR code is REAL from Baileys (base64 PNG)")
    
    def test_disconnect_connection(self, auth_headers):
        """POST /api/channels/connections/{id}/disconnect disconnects WhatsApp"""
        # Get connections
        response = requests.get(f"{BASE_URL}/api/channels/connections", headers=auth_headers)
        connections = response.json()
        
        # Find a WhatsApp connection
        wa_conn = next((c for c in connections if c.get("type") == "whatsapp"), None)
        if not wa_conn:
            pytest.skip("No WhatsApp connection available")
        
        conn_id = wa_conn["id"]
        
        # Disconnect
        response = requests.post(
            f"{BASE_URL}/api/channels/connections/{conn_id}/disconnect",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "disconnected"
        print(f"Disconnected {conn_id}: status={data.get('status')}")
    
    def test_send_message_not_connected(self, auth_headers):
        """POST /api/channels/connections/{id}/send returns error when not connected"""
        # Get connections
        response = requests.get(f"{BASE_URL}/api/channels/connections", headers=auth_headers)
        connections = response.json()
        
        # Find a disconnected WhatsApp connection
        wa_conn = next((c for c in connections if c.get("type") == "whatsapp" and c.get("status") != "connected"), None)
        if not wa_conn:
            pytest.skip("No disconnected WhatsApp connection available")
        
        conn_id = wa_conn["id"]
        
        # Try to send message
        response = requests.post(
            f"{BASE_URL}/api/channels/connections/{conn_id}/send",
            headers=auth_headers,
            json={"phone": "+5562999990000", "message": "Test message"}
        )
        # Should fail with 400 because not connected
        assert response.status_code == 400
        data = response.json()
        assert "detail" in data
        print(f"Send message error (expected): {data.get('detail')}")


class TestChannelWebhooks:
    """Tests for webhook endpoints (called by WhatsApp service)"""
    
    def test_webhook_connected(self):
        """POST /api/channels/webhook/connected updates connection status"""
        # This endpoint is called by WhatsApp service, no auth required
        payload = {
            "instance_id": "test-instance-id",
            "phone": "5562999990000",
            "name": "Test User"
        }
        response = requests.post(
            f"{BASE_URL}/api/channels/webhook/connected",
            json=payload
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") == True
        print("Webhook /connected processed successfully")
    
    def test_webhook_message(self):
        """POST /api/channels/webhook/message logs incoming message"""
        payload = {
            "instance_id": "test-instance-id",
            "phone": "5562999990000",
            "name": "Test Sender",
            "message": "Hello from test",
            "message_id": "test-msg-123",
            "timestamp": 1704067200
        }
        response = requests.post(
            f"{BASE_URL}/api/channels/webhook/message",
            json=payload
        )
        assert response.status_code == 200
        data = response.json()
        # ok can be True or False depending on if instance exists
        assert "ok" in data
        print(f"Webhook /message processed: ok={data.get('ok')}")


class TestCleanup:
    """Cleanup test data"""
    
    def test_cleanup_test_connections(self, auth_headers):
        """Delete TEST_ prefixed connections"""
        response = requests.get(f"{BASE_URL}/api/channels/connections", headers=auth_headers)
        connections = response.json()
        
        deleted = 0
        for conn in connections:
            if conn.get("name", "").startswith("TEST_"):
                del_resp = requests.delete(
                    f"{BASE_URL}/api/channels/connections/{conn['id']}",
                    headers=auth_headers
                )
                if del_resp.status_code == 200:
                    deleted += 1
        
        print(f"Cleaned up {deleted} test connections")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
