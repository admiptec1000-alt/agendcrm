"""
Test suite for Channels API (iteration 14)
Tests: Connections, Message Templates, Scheduled Messages, Internal Chat
All features now persist in MongoDB via /api/channels/* endpoints
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials for Boss company
BOSS_EMAIL = "admin@boss.com.br"
BOSS_PASSWORD = "boss123"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for Boss company"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": BOSS_EMAIL,
        "password": BOSS_PASSWORD
    })
    if response.status_code != 200:
        pytest.skip(f"Authentication failed: {response.status_code} - {response.text}")
    data = response.json()
    # API returns access_token, not token
    return data.get("access_token") or data.get("token")


@pytest.fixture(scope="module")
def auth_headers(auth_token):
    """Headers with auth token"""
    return {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }


# ============ CONNECTIONS TESTS ============
class TestConnections:
    """Test /api/channels/connections endpoints"""
    
    created_connection_id = None
    
    def test_get_connections(self, auth_headers):
        """GET /api/channels/connections returns connections for company"""
        response = requests.get(f"{BASE_URL}/api/channels/connections", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"Found {len(data)} existing connections")
    
    def test_create_whatsapp_connection(self, auth_headers):
        """POST /api/channels/connections creates new WhatsApp connection"""
        payload = {
            "name": "TEST_WhatsApp_Connection",
            "type": "whatsapp",
            "phone": "+5562999990000"
        }
        response = requests.post(f"{BASE_URL}/api/channels/connections", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "id" in data, "Response should contain id"
        assert data["name"] == payload["name"], f"Name mismatch: {data['name']} != {payload['name']}"
        assert data["type"] == "whatsapp", f"Type should be whatsapp, got {data['type']}"
        assert data["status"] == "disconnected", f"Initial status should be disconnected, got {data['status']}"
        TestConnections.created_connection_id = data["id"]
        print(f"Created connection: {data['id']}")
    
    def test_create_instagram_connection(self, auth_headers):
        """POST /api/channels/connections creates new Instagram connection"""
        payload = {
            "name": "TEST_Instagram_Connection",
            "type": "instagram"
        }
        response = requests.post(f"{BASE_URL}/api/channels/connections", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["type"] == "instagram", f"Type should be instagram, got {data['type']}"
        print(f"Created Instagram connection: {data['id']}")
    
    def test_connect_channel_sets_waiting_qr(self, auth_headers):
        """POST /api/channels/connections/{id}/connect sets status to waiting_qr"""
        if not TestConnections.created_connection_id:
            pytest.skip("No connection created")
        
        conn_id = TestConnections.created_connection_id
        response = requests.post(f"{BASE_URL}/api/channels/connections/{conn_id}/connect", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        # 'connecting' quando o microservico Baileys esta acessivel,
        # 'waiting_qr' quando inacessivel (fallback). Ambos validos.
        assert data["status"] in ("connecting", "waiting_qr"), f"Status should be connecting/waiting_qr, got {data['status']}"
        # QR real eh gerado assincronamente pelo microservico Baileys e
        # buscado via GET /connections/{id}/qr — o doc do DB pode nao ter
        # qr_code preenchido neste momento. Apenas valida a presenca da chave.
        assert "qr_code" in data
        print(f"Connection status: {data['status']}")
    
    def test_disconnect_channel(self, auth_headers):
        """POST /api/channels/connections/{id}/disconnect sets status to disconnected"""
        if not TestConnections.created_connection_id:
            pytest.skip("No connection created")
        
        conn_id = TestConnections.created_connection_id
        response = requests.post(f"{BASE_URL}/api/channels/connections/{conn_id}/disconnect", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["status"] == "disconnected", f"Status should be disconnected, got {data['status']}"
        assert data["qr_code"] is None, "QR code should be cleared"
        print(f"Connection disconnected: {data['status']}")
    
    def test_verify_connection_persisted(self, auth_headers):
        """GET /api/channels/connections verifies connection was persisted"""
        response = requests.get(f"{BASE_URL}/api/channels/connections", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        test_conns = [c for c in data if c["name"].startswith("TEST_")]
        assert len(test_conns) >= 1, "Test connections should be persisted"
        print(f"Found {len(test_conns)} test connections persisted")
    
    def test_delete_connection(self, auth_headers):
        """DELETE /api/channels/connections/{id} removes connection"""
        if not TestConnections.created_connection_id:
            pytest.skip("No connection created")
        
        conn_id = TestConnections.created_connection_id
        response = requests.delete(f"{BASE_URL}/api/channels/connections/{conn_id}", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "message" in data, "Response should contain message"
        print(f"Connection deleted: {data['message']}")
        
        # Verify deletion
        response = requests.get(f"{BASE_URL}/api/channels/connections", headers=auth_headers)
        data = response.json()
        deleted = [c for c in data if c["id"] == conn_id]
        assert len(deleted) == 0, "Connection should be deleted"


# ============ MESSAGE TEMPLATES TESTS ============
class TestMessageTemplates:
    """Test /api/channels/templates endpoints"""
    
    def test_get_templates(self, auth_headers):
        """GET /api/channels/templates returns message templates"""
        response = requests.get(f"{BASE_URL}/api/channels/templates", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"Found {len(data)} existing templates")
    
    def test_create_template(self, auth_headers):
        """POST /api/channels/templates creates/upserts template by process_key"""
        payload = {
            "process_key": "test_confirmacao",
            "label": "TEST Confirmacao",
            "description": "Test template for confirmation",
            "message": "Ola {nome}, seu agendamento de {servico} foi confirmado para {data} as {hora}.",
            "active": True
        }
        response = requests.post(f"{BASE_URL}/api/channels/templates", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "id" in data, "Response should contain id"
        assert data["process_key"] == payload["process_key"], f"process_key mismatch"
        assert data["message"] == payload["message"], f"message mismatch"
        assert data["active"] == True, f"active should be True"
        print(f"Created template: {data['id']} - {data['process_key']}")
    
    def test_upsert_template_updates_existing(self, auth_headers):
        """POST /api/channels/templates with same process_key updates existing"""
        payload = {
            "process_key": "test_confirmacao",
            "label": "TEST Confirmacao Updated",
            "description": "Updated test template",
            "message": "UPDATED: Ola {nome}, confirmado para {data}!",
            "active": False
        }
        response = requests.post(f"{BASE_URL}/api/channels/templates", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["message"] == payload["message"], f"Message should be updated"
        assert data["active"] == False, f"active should be updated to False"
        print(f"Template updated: {data['message'][:30]}...")
    
    def test_verify_template_persisted(self, auth_headers):
        """GET /api/channels/templates verifies template was persisted"""
        response = requests.get(f"{BASE_URL}/api/channels/templates", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        test_templates = [t for t in data if t["process_key"] == "test_confirmacao"]
        assert len(test_templates) == 1, "Test template should be persisted (exactly 1)"
        assert test_templates[0]["message"].startswith("UPDATED:"), "Template should have updated message"
        print(f"Template persisted: {test_templates[0]['process_key']}")


# ============ SCHEDULED MESSAGES TESTS ============
class TestScheduledMessages:
    """Test /api/channels/scheduled-messages endpoints"""
    
    created_message_id = None
    
    def test_get_scheduled_messages(self, auth_headers):
        """GET /api/channels/scheduled-messages returns scheduled messages"""
        response = requests.get(f"{BASE_URL}/api/channels/scheduled-messages", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"Found {len(data)} existing scheduled messages")
    
    def test_create_scheduled_message(self, auth_headers):
        """POST /api/channels/scheduled-messages creates scheduled message with status=pendente"""
        scheduled_time = (datetime.now() + timedelta(hours=2)).isoformat()
        payload = {
            "recipient": "+5562999990001",
            "channel": "whatsapp",
            "message": "TEST: Lembrete do seu agendamento amanha!",
            "scheduled_at": scheduled_time,
            "template_key": "lembrete"
        }
        response = requests.post(f"{BASE_URL}/api/channels/scheduled-messages", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "id" in data, "Response should contain id"
        assert data["recipient"] == payload["recipient"], f"recipient mismatch"
        assert data["channel"] == "whatsapp", f"channel should be whatsapp"
        assert data["status"] == "pendente", f"Initial status should be pendente, got {data['status']}"
        TestScheduledMessages.created_message_id = data["id"]
        print(f"Created scheduled message: {data['id']} - status: {data['status']}")
    
    def test_update_scheduled_message_status(self, auth_headers):
        """PUT /api/channels/scheduled-messages/{id} updates status (e.g., cancelada)"""
        if not TestScheduledMessages.created_message_id:
            pytest.skip("No scheduled message created")
        
        msg_id = TestScheduledMessages.created_message_id
        payload = {"status": "cancelada"}
        response = requests.put(f"{BASE_URL}/api/channels/scheduled-messages/{msg_id}", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["status"] == "cancelada", f"Status should be cancelada, got {data['status']}"
        print(f"Message status updated to: {data['status']}")
    
    def test_verify_scheduled_message_persisted(self, auth_headers):
        """GET /api/channels/scheduled-messages verifies message was persisted"""
        response = requests.get(f"{BASE_URL}/api/channels/scheduled-messages", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        test_msgs = [m for m in data if m.get("message", "").startswith("TEST:")]
        assert len(test_msgs) >= 1, "Test scheduled message should be persisted"
        print(f"Found {len(test_msgs)} test scheduled messages persisted")
    
    def test_filter_by_status(self, auth_headers):
        """GET /api/channels/scheduled-messages?status=cancelada filters by status"""
        response = requests.get(f"{BASE_URL}/api/channels/scheduled-messages?status=cancelada", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        for msg in data:
            assert msg["status"] == "cancelada", f"All messages should have status cancelada"
        print(f"Found {len(data)} cancelled messages")
    
    def test_delete_scheduled_message(self, auth_headers):
        """DELETE /api/channels/scheduled-messages/{id} removes message"""
        if not TestScheduledMessages.created_message_id:
            pytest.skip("No scheduled message created")
        
        msg_id = TestScheduledMessages.created_message_id
        response = requests.delete(f"{BASE_URL}/api/channels/scheduled-messages/{msg_id}", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print(f"Scheduled message deleted")


# ============ INTERNAL CHAT TESTS ============
class TestInternalChat:
    """Test /api/channels/chat/* endpoints"""
    
    def test_get_chat_channels(self, auth_headers):
        """GET /api/channels/chat/channels returns or creates default 'general' channel"""
        response = requests.get(f"{BASE_URL}/api/channels/chat/channels", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        assert len(data) >= 1, "Should have at least 1 channel (general)"
        general = [c for c in data if c["id"] == "general" or c["name"] == "Geral"]
        assert len(general) >= 1, "Should have 'general' or 'Geral' channel"
        print(f"Found {len(data)} chat channels, including general")
    
    def test_get_chat_messages(self, auth_headers):
        """GET /api/channels/chat/messages returns chat messages for channel"""
        response = requests.get(f"{BASE_URL}/api/channels/chat/messages?channel_id=general&limit=50", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"Found {len(data)} messages in general channel")
    
    def test_send_chat_message(self, auth_headers):
        """POST /api/channels/chat/messages sends message with sender_name"""
        payload = {
            "content": "TEST: Hello from automated test!",
            "channel_id": "general"
        }
        response = requests.post(f"{BASE_URL}/api/channels/chat/messages", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "id" in data, "Response should contain id"
        assert data["content"] == payload["content"], f"content mismatch"
        assert data["channel_id"] == "general", f"channel_id should be general"
        assert "sender_name" in data, "Response should contain sender_name"
        assert "sender_id" in data, "Response should contain sender_id"
        assert "created_at" in data, "Response should contain created_at"
        print(f"Sent message: {data['id']} by {data['sender_name']}")
    
    def test_verify_message_persisted(self, auth_headers):
        """GET /api/channels/chat/messages verifies message was persisted"""
        response = requests.get(f"{BASE_URL}/api/channels/chat/messages?channel_id=general&limit=50", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        test_msgs = [m for m in data if m.get("content", "").startswith("TEST:")]
        assert len(test_msgs) >= 1, "Test message should be persisted"
        print(f"Found {len(test_msgs)} test messages persisted in chat")


# ============ CLEANUP ============
class TestCleanup:
    """Cleanup test data"""
    
    def test_cleanup_test_connections(self, auth_headers):
        """Remove TEST_ prefixed connections"""
        response = requests.get(f"{BASE_URL}/api/channels/connections", headers=auth_headers)
        if response.status_code == 200:
            for conn in response.json():
                if conn["name"].startswith("TEST_"):
                    requests.delete(f"{BASE_URL}/api/channels/connections/{conn['id']}", headers=auth_headers)
                    print(f"Cleaned up connection: {conn['name']}")
    
    def test_cleanup_test_scheduled_messages(self, auth_headers):
        """Remove TEST: prefixed scheduled messages"""
        response = requests.get(f"{BASE_URL}/api/channels/scheduled-messages", headers=auth_headers)
        if response.status_code == 200:
            for msg in response.json():
                if msg.get("message", "").startswith("TEST:"):
                    requests.delete(f"{BASE_URL}/api/channels/scheduled-messages/{msg['id']}", headers=auth_headers)
                    print(f"Cleaned up scheduled message: {msg['id']}")
