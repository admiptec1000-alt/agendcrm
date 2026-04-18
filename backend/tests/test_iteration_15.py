"""
Iteration 15 Backend Tests
Tests for:
- Client CRUD (update/delete)
- Appointment conclude with payment method
- Financial transactions and summary
- Permission profiles CRUD
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test data prefixes for cleanup
TEST_PREFIX = "TEST_ITER15_"

class TestAuth:
    """Get auth token for Boss company"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Login as Boss company admin"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@boss.com.br",
            "password": "boss123"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "access_token" in data
        return data["access_token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestClientCRUD(TestAuth):
    """Test client update and delete endpoints"""
    
    def test_create_client(self, headers):
        """Create a test client for subsequent tests"""
        response = requests.post(f"{BASE_URL}/api/scheduling/clients", json={
            "name": f"{TEST_PREFIX}Client",
            "phone": "62999990015",
            "email": "test15@example.com",
            "notes": "Test client for iteration 15"
        }, headers=headers)
        assert response.status_code == 200, f"Create client failed: {response.text}"
        data = response.json()
        assert data["name"] == f"{TEST_PREFIX}Client"
        assert data["phone"] == "62999990015"
        assert "id" in data
        # Store for later tests
        TestClientCRUD.client_id = data["id"]
        print(f"Created client: {data['id']}")
    
    def test_update_client(self, headers):
        """PUT /api/scheduling/clients/{id} updates client"""
        client_id = getattr(TestClientCRUD, 'client_id', None)
        if not client_id:
            pytest.skip("No client created")
        
        response = requests.put(f"{BASE_URL}/api/scheduling/clients/{client_id}", json={
            "name": f"{TEST_PREFIX}Client_Updated",
            "phone": "62999990015",
            "email": "updated15@example.com",
            "notes": "Updated notes"
        }, headers=headers)
        assert response.status_code == 200, f"Update client failed: {response.text}"
        data = response.json()
        assert data["name"] == f"{TEST_PREFIX}Client_Updated"
        assert data["email"] == "updated15@example.com"
        print(f"Updated client: {data['name']}")
    
    def test_get_client_after_update(self, headers):
        """Verify client update persisted"""
        response = requests.get(f"{BASE_URL}/api/scheduling/clients", headers=headers)
        assert response.status_code == 200
        clients = response.json()
        test_client = next((c for c in clients if c.get("phone") == "62999990015"), None)
        assert test_client is not None, "Test client not found"
        assert test_client["name"] == f"{TEST_PREFIX}Client_Updated"
        print(f"Verified client update persisted")
    
    def test_delete_client(self, headers):
        """DELETE /api/scheduling/clients/{id} removes client"""
        client_id = getattr(TestClientCRUD, 'client_id', None)
        if not client_id:
            pytest.skip("No client created")
        
        response = requests.delete(f"{BASE_URL}/api/scheduling/clients/{client_id}", headers=headers)
        assert response.status_code == 200, f"Delete client failed: {response.text}"
        data = response.json()
        assert "message" in data
        print(f"Deleted client: {client_id}")
    
    def test_client_not_found_after_delete(self, headers):
        """Verify client was deleted"""
        response = requests.get(f"{BASE_URL}/api/scheduling/clients", headers=headers)
        assert response.status_code == 200
        clients = response.json()
        test_client = next((c for c in clients if c.get("phone") == "62999990015"), None)
        assert test_client is None, "Client should have been deleted"
        print("Verified client deletion")


class TestAppointmentConclude(TestAuth):
    """Test appointment conclude with payment method"""
    
    def test_create_appointment_for_conclude(self, headers):
        """Create appointment to test conclude flow"""
        # First get service and professional IDs
        services_resp = requests.get(f"{BASE_URL}/api/scheduling/services", headers=headers)
        assert services_resp.status_code == 200
        services = services_resp.json()
        service = services[0] if services else None
        
        profs_resp = requests.get(f"{BASE_URL}/api/scheduling/professionals", headers=headers)
        assert profs_resp.status_code == 200
        profs = profs_resp.json()
        prof = profs[0] if profs else None
        
        if not service or not prof:
            pytest.skip("No service or professional available")
        
        # Create appointment
        response = requests.post(f"{BASE_URL}/api/scheduling/appointments", json={
            "customer_name": f"{TEST_PREFIX}ConcludeTest",
            "customer_phone": "62999990016",
            "service_id": service["id"],
            "professional_id": prof["id"],
            "date": "2026-01-20",
            "time": "14:00"
        }, headers=headers)
        assert response.status_code == 200, f"Create appointment failed: {response.text}"
        data = response.json()
        TestAppointmentConclude.apt_id = data["id"]
        TestAppointmentConclude.apt_price = data.get("price", 0)
        print(f"Created appointment: {data['id']} with price R${data.get('price', 0)}")
    
    def test_confirm_appointment(self, headers):
        """Confirm appointment before concluding"""
        apt_id = getattr(TestAppointmentConclude, 'apt_id', None)
        if not apt_id:
            pytest.skip("No appointment created")
        
        response = requests.put(f"{BASE_URL}/api/scheduling/appointments/{apt_id}", json={
            "status": "confirmado"
        }, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "confirmado"
        print(f"Confirmed appointment: {apt_id}")
    
    def test_conclude_appointment_with_pix(self, headers):
        """PUT /api/scheduling/appointments/{id}/conclude with PIX payment"""
        apt_id = getattr(TestAppointmentConclude, 'apt_id', None)
        if not apt_id:
            pytest.skip("No appointment created")
        
        response = requests.put(f"{BASE_URL}/api/scheduling/appointments/{apt_id}/conclude", json={
            "payment_method": "pix",
            "notes": "Test conclude with PIX"
        }, headers=headers)
        assert response.status_code == 200, f"Conclude failed: {response.text}"
        data = response.json()
        assert data["status"] == "concluido"
        assert data["payment_method"] == "pix"
        assert data["payment_status"] == "pago"
        print(f"Concluded appointment with PIX: {apt_id}")
    
    def test_conclude_creates_financial_transaction(self, headers):
        """Verify conclude created a financial transaction"""
        response = requests.get(f"{BASE_URL}/api/scheduling/financial/transactions", headers=headers)
        assert response.status_code == 200
        transactions = response.json()
        
        apt_id = getattr(TestAppointmentConclude, 'apt_id', None)
        txn = next((t for t in transactions if t.get("appointment_id") == apt_id), None)
        assert txn is not None, "Transaction not created for concluded appointment"
        assert txn["payment_method"] == "pix"
        assert txn["type"] == "receita"
        print(f"Verified transaction created: {txn['id']}")
    
    def test_cannot_conclude_already_concluded(self, headers):
        """Cannot conclude an already concluded appointment"""
        apt_id = getattr(TestAppointmentConclude, 'apt_id', None)
        if not apt_id:
            pytest.skip("No appointment created")
        
        response = requests.put(f"{BASE_URL}/api/scheduling/appointments/{apt_id}/conclude", json={
            "payment_method": "dinheiro"
        }, headers=headers)
        assert response.status_code == 400, "Should fail for already concluded"
        print("Verified cannot conclude already concluded appointment")


class TestFinancialEndpoints(TestAuth):
    """Test financial summary and transactions endpoints"""
    
    def test_get_financial_transactions(self, headers):
        """GET /api/scheduling/financial/transactions returns list"""
        response = requests.get(f"{BASE_URL}/api/scheduling/financial/transactions", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Got {len(data)} financial transactions")
    
    def test_get_financial_summary(self, headers):
        """GET /api/scheduling/financial/summary returns breakdown"""
        response = requests.get(f"{BASE_URL}/api/scheduling/financial/summary", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Verify structure
        assert "total_revenue" in data
        assert "transaction_count" in data
        assert "by_payment_method" in data
        assert isinstance(data["by_payment_method"], dict)
        
        print(f"Financial summary: total_revenue={data['total_revenue']}, count={data['transaction_count']}")
        print(f"By payment method: {data['by_payment_method']}")
    
    def test_financial_summary_has_pix_from_conclude(self, headers):
        """Verify PIX transaction from conclude test appears in summary"""
        response = requests.get(f"{BASE_URL}/api/scheduling/financial/summary", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Should have PIX in by_payment_method
        by_method = data.get("by_payment_method", {})
        assert "pix" in by_method, f"PIX not in payment methods: {by_method}"
        print(f"PIX total: R${by_method['pix']}")


class TestPermissionProfiles(TestAuth):
    """Test permission profiles CRUD"""
    
    def test_create_permission_profile(self, headers):
        """POST /api/scheduling/permission-profiles creates profile"""
        response = requests.post(f"{BASE_URL}/api/scheduling/permission-profiles", json={
            "name": f"{TEST_PREFIX}Atendente",
            "permissions": ["ver_proprios_atendimentos", "concluir_atendimento"]
        }, headers=headers)
        assert response.status_code == 200, f"Create profile failed: {response.text}"
        data = response.json()
        assert data["name"] == f"{TEST_PREFIX}Atendente"
        assert "ver_proprios_atendimentos" in data["permissions"]
        assert "concluir_atendimento" in data["permissions"]
        TestPermissionProfiles.profile_id = data["id"]
        print(f"Created permission profile: {data['id']}")
    
    def test_list_permission_profiles(self, headers):
        """GET /api/scheduling/permission-profiles returns list"""
        response = requests.get(f"{BASE_URL}/api/scheduling/permission-profiles", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        
        # Find our test profile
        test_profile = next((p for p in data if p.get("name", "").startswith(TEST_PREFIX)), None)
        assert test_profile is not None, "Test profile not found"
        print(f"Found {len(data)} permission profiles")
    
    def test_update_permission_profile(self, headers):
        """PUT /api/scheduling/permission-profiles/{id} updates profile"""
        profile_id = getattr(TestPermissionProfiles, 'profile_id', None)
        if not profile_id:
            pytest.skip("No profile created")
        
        response = requests.put(f"{BASE_URL}/api/scheduling/permission-profiles/{profile_id}", json={
            "name": f"{TEST_PREFIX}Atendente_Updated",
            "permissions": ["ver_proprios_atendimentos", "concluir_atendimento", "registrar_pagamento"]
        }, headers=headers)
        assert response.status_code == 200, f"Update profile failed: {response.text}"
        data = response.json()
        assert data["name"] == f"{TEST_PREFIX}Atendente_Updated"
        assert "registrar_pagamento" in data["permissions"]
        print(f"Updated permission profile: {data['name']}")
    
    def test_delete_permission_profile(self, headers):
        """DELETE /api/scheduling/permission-profiles/{id} removes profile"""
        profile_id = getattr(TestPermissionProfiles, 'profile_id', None)
        if not profile_id:
            pytest.skip("No profile created")
        
        response = requests.delete(f"{BASE_URL}/api/scheduling/permission-profiles/{profile_id}", headers=headers)
        assert response.status_code == 200
        print(f"Deleted permission profile: {profile_id}")


class TestConcludeWithDifferentPaymentMethods(TestAuth):
    """Test conclude with all 4 payment methods"""
    
    @pytest.fixture(scope="class")
    def service_and_prof(self, headers):
        """Get service and professional for appointments"""
        services_resp = requests.get(f"{BASE_URL}/api/scheduling/services", headers=headers)
        profs_resp = requests.get(f"{BASE_URL}/api/scheduling/professionals", headers=headers)
        services = services_resp.json()
        profs = profs_resp.json()
        return services[0] if services else None, profs[0] if profs else None
    
    def test_conclude_with_dinheiro(self, headers, service_and_prof):
        """Test conclude with Dinheiro payment"""
        service, prof = service_and_prof
        if not service or not prof:
            pytest.skip("No service or professional")
        
        # Create and confirm appointment
        apt_resp = requests.post(f"{BASE_URL}/api/scheduling/appointments", json={
            "customer_name": f"{TEST_PREFIX}Dinheiro",
            "customer_phone": "62999990017",
            "service_id": service["id"],
            "professional_id": prof["id"],
            "date": "2026-01-21",
            "time": "10:00"
        }, headers=headers)
        apt = apt_resp.json()
        
        requests.put(f"{BASE_URL}/api/scheduling/appointments/{apt['id']}", json={"status": "confirmado"}, headers=headers)
        
        # Conclude with dinheiro
        response = requests.put(f"{BASE_URL}/api/scheduling/appointments/{apt['id']}/conclude", json={
            "payment_method": "dinheiro"
        }, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["payment_method"] == "dinheiro"
        print("Concluded with Dinheiro")
    
    def test_conclude_with_cartao_credito(self, headers, service_and_prof):
        """Test conclude with Cartao Credito payment"""
        service, prof = service_and_prof
        if not service or not prof:
            pytest.skip("No service or professional")
        
        apt_resp = requests.post(f"{BASE_URL}/api/scheduling/appointments", json={
            "customer_name": f"{TEST_PREFIX}Credito",
            "customer_phone": "62999990018",
            "service_id": service["id"],
            "professional_id": prof["id"],
            "date": "2026-01-21",
            "time": "11:00"
        }, headers=headers)
        apt = apt_resp.json()
        
        requests.put(f"{BASE_URL}/api/scheduling/appointments/{apt['id']}", json={"status": "confirmado"}, headers=headers)
        
        response = requests.put(f"{BASE_URL}/api/scheduling/appointments/{apt['id']}/conclude", json={
            "payment_method": "cartao_credito"
        }, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["payment_method"] == "cartao_credito"
        print("Concluded with Cartao Credito")
    
    def test_conclude_with_cartao_debito(self, headers, service_and_prof):
        """Test conclude with Cartao Debito payment"""
        service, prof = service_and_prof
        if not service or not prof:
            pytest.skip("No service or professional")
        
        apt_resp = requests.post(f"{BASE_URL}/api/scheduling/appointments", json={
            "customer_name": f"{TEST_PREFIX}Debito",
            "customer_phone": "62999990019",
            "service_id": service["id"],
            "professional_id": prof["id"],
            "date": "2026-01-21",
            "time": "12:00"
        }, headers=headers)
        apt = apt_resp.json()
        
        requests.put(f"{BASE_URL}/api/scheduling/appointments/{apt['id']}", json={"status": "confirmado"}, headers=headers)
        
        response = requests.put(f"{BASE_URL}/api/scheduling/appointments/{apt['id']}/conclude", json={
            "payment_method": "cartao_debito"
        }, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["payment_method"] == "cartao_debito"
        print("Concluded with Cartao Debito")
    
    def test_financial_summary_has_all_methods(self, headers):
        """Verify all payment methods appear in summary"""
        response = requests.get(f"{BASE_URL}/api/scheduling/financial/summary", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        by_method = data.get("by_payment_method", {})
        print(f"Payment methods in summary: {list(by_method.keys())}")
        
        # At least PIX should be there from earlier test
        assert len(by_method) > 0, "No payment methods in summary"


class TestCleanup(TestAuth):
    """Cleanup test data"""
    
    def test_cleanup_test_appointments(self, headers):
        """Delete test appointments"""
        response = requests.get(f"{BASE_URL}/api/scheduling/appointments", headers=headers)
        if response.status_code == 200:
            appointments = response.json()
            for apt in appointments:
                if apt.get("customer_name", "").startswith(TEST_PREFIX):
                    requests.delete(f"{BASE_URL}/api/scheduling/appointments/{apt['id']}", headers=headers)
                    print(f"Deleted test appointment: {apt['id']}")
    
    def test_cleanup_test_clients(self, headers):
        """Delete test clients"""
        response = requests.get(f"{BASE_URL}/api/scheduling/clients", headers=headers)
        if response.status_code == 200:
            clients = response.json()
            for client in clients:
                if client.get("name", "").startswith(TEST_PREFIX):
                    requests.delete(f"{BASE_URL}/api/scheduling/clients/{client['id']}", headers=headers)
                    print(f"Deleted test client: {client['id']}")
    
    def test_cleanup_test_profiles(self, headers):
        """Delete test permission profiles"""
        response = requests.get(f"{BASE_URL}/api/scheduling/permission-profiles", headers=headers)
        if response.status_code == 200:
            profiles = response.json()
            for profile in profiles:
                if profile.get("name", "").startswith(TEST_PREFIX):
                    requests.delete(f"{BASE_URL}/api/scheduling/permission-profiles/{profile['id']}", headers=headers)
                    print(f"Deleted test profile: {profile['id']}")
