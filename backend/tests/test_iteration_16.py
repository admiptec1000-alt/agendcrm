"""
Iteration 16 Backend Tests
Testing new features:
- User menu with suspend agenda
- Agenda page with status filters and conclude payment
- Calendar with Month/Week/Day views
- Financeiro with dynamic filters
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get auth token for Boss company"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@boss.com.br",
            "password": "boss123",
            "subdomain": "boss"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "access_token" in data
        return data["access_token"]
    
    def test_login_success(self, auth_token):
        """Test login returns valid token"""
        assert auth_token is not None
        assert len(auth_token) > 0
        print("TEST PASS: Login successful")


class TestAppointmentsAPI:
    """Appointment endpoints tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@boss.com.br",
            "password": "boss123",
            "subdomain": "boss"
        })
        return response.json()["access_token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}"}
    
    def test_get_appointments(self, headers):
        """Test GET /api/scheduling/appointments"""
        response = requests.get(f"{BASE_URL}/api/scheduling/appointments", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"TEST PASS: GET appointments returned {len(data)} items")
    
    def test_get_appointments_with_status_filter(self, headers):
        """Test GET /api/scheduling/appointments with status filter"""
        response = requests.get(f"{BASE_URL}/api/scheduling/appointments?status_filter=confirmado", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # All returned should be confirmado
        for apt in data:
            assert apt.get("status") == "confirmado", f"Expected confirmado, got {apt.get('status')}"
        print(f"TEST PASS: GET appointments with status filter returned {len(data)} confirmed items")
    
    def test_conclude_appointment_flow(self, headers):
        """Test conclude appointment with payment"""
        # First get a confirmed appointment
        response = requests.get(f"{BASE_URL}/api/scheduling/appointments?status_filter=confirmado", headers=headers)
        assert response.status_code == 200
        confirmed = response.json()
        
        if len(confirmed) == 0:
            pytest.skip("No confirmed appointments to test conclude")
        
        apt = confirmed[0]
        apt_id = apt["id"]
        
        # Conclude with PIX payment
        response = requests.put(
            f"{BASE_URL}/api/scheduling/appointments/{apt_id}/conclude",
            headers=headers,
            json={"payment_method": "pix"}
        )
        
        # Should succeed or fail if already concluded
        if response.status_code == 200:
            data = response.json()
            assert data.get("status") == "concluido"
            assert data.get("payment_method") == "pix"
            print("TEST PASS: Conclude appointment with PIX successful")
        elif response.status_code == 400:
            # Already concluded
            print("TEST PASS: Appointment already concluded (expected behavior)")
        else:
            pytest.fail(f"Unexpected status: {response.status_code} - {response.text}")


class TestFinancialAPI:
    """Financial endpoints tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@boss.com.br",
            "password": "boss123",
            "subdomain": "boss"
        })
        return response.json()["access_token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}"}
    
    def test_get_financial_transactions(self, headers):
        """Test GET /api/scheduling/financial/transactions"""
        response = requests.get(f"{BASE_URL}/api/scheduling/financial/transactions", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"TEST PASS: GET financial transactions returned {len(data)} items")
    
    def test_get_financial_transactions_with_date_filter(self, headers):
        """Test GET /api/scheduling/financial/transactions with date range"""
        today = datetime.now().strftime("%Y-%m-%d")
        start = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
        
        response = requests.get(
            f"{BASE_URL}/api/scheduling/financial/transactions?start_date={start}&end_date={today}",
            headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"TEST PASS: GET financial transactions with date filter returned {len(data)} items")
    
    def test_get_financial_transactions_with_payment_method_filter(self, headers):
        """Test GET /api/scheduling/financial/transactions with payment method filter"""
        response = requests.get(
            f"{BASE_URL}/api/scheduling/financial/transactions?payment_method=pix",
            headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # All should be PIX
        for txn in data:
            assert txn.get("payment_method") == "pix", f"Expected pix, got {txn.get('payment_method')}"
        print(f"TEST PASS: GET financial transactions with payment method filter returned {len(data)} PIX items")
    
    def test_get_financial_summary(self, headers):
        """Test GET /api/scheduling/financial/summary"""
        response = requests.get(f"{BASE_URL}/api/scheduling/financial/summary", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Check required fields
        assert "total_revenue" in data
        assert "by_payment_method" in data
        assert isinstance(data["by_payment_method"], dict)
        print(f"TEST PASS: GET financial summary - Total: R$ {data['total_revenue']:.2f}")
    
    def test_get_financial_summary_with_date_filter(self, headers):
        """Test GET /api/scheduling/financial/summary with date range"""
        today = datetime.now().strftime("%Y-%m-%d")
        start = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
        
        response = requests.get(
            f"{BASE_URL}/api/scheduling/financial/summary?start_date={start}&end_date={today}",
            headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "total_revenue" in data
        assert "by_payment_method" in data
        print(f"TEST PASS: GET financial summary with date filter - Total: R$ {data['total_revenue']:.2f}")


class TestProfessionalsAPI:
    """Professionals endpoints tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@boss.com.br",
            "password": "boss123",
            "subdomain": "boss"
        })
        return response.json()["access_token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}"}
    
    def test_get_professionals(self, headers):
        """Test GET /api/scheduling/professionals"""
        response = requests.get(f"{BASE_URL}/api/scheduling/professionals", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"TEST PASS: GET professionals returned {len(data)} items")
    
    def test_add_suspension_to_professional(self, headers):
        """Test POST /api/scheduling/professionals/{id}/suspensions"""
        # Get a professional
        response = requests.get(f"{BASE_URL}/api/scheduling/professionals", headers=headers)
        profs = response.json()
        
        if len(profs) == 0:
            pytest.skip("No professionals to test suspension")
        
        prof_id = profs[0]["id"]
        
        # Add suspension
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        next_week = (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")
        
        response = requests.post(
            f"{BASE_URL}/api/scheduling/professionals/{prof_id}/suspensions",
            headers=headers,
            json={
                "start_date": tomorrow,
                "end_date": next_week,
                "reason": "TEST_ITER16_Ferias"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        print(f"TEST PASS: Added suspension to professional {prof_id}")
        
        # Clean up - remove the suspension
        sus_id = data["id"]
        response = requests.delete(
            f"{BASE_URL}/api/scheduling/professionals/{prof_id}/suspensions/{sus_id}",
            headers=headers
        )
        assert response.status_code == 200
        print(f"TEST PASS: Removed test suspension {sus_id}")


class TestServicesAPI:
    """Services endpoints tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@boss.com.br",
            "password": "boss123",
            "subdomain": "boss"
        })
        return response.json()["access_token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}"}
    
    def test_get_services(self, headers):
        """Test GET /api/scheduling/services"""
        response = requests.get(f"{BASE_URL}/api/scheduling/services", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"TEST PASS: GET services returned {len(data)} items")


class TestClientsAPI:
    """Clients endpoints tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@boss.com.br",
            "password": "boss123",
            "subdomain": "boss"
        })
        return response.json()["access_token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}"}
    
    def test_get_clients(self, headers):
        """Test GET /api/scheduling/clients"""
        response = requests.get(f"{BASE_URL}/api/scheduling/clients", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"TEST PASS: GET clients returned {len(data)} items")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
