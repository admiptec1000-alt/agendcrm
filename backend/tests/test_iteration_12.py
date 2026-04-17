"""
Iteration 12 Backend Tests
Tests for new URL structure: /:slug/login, /:slug/agenda, /:slug/indoor
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://agentcrm-book.preview.emergentagent.com')

class TestPublicEndpoints:
    """Test public API endpoints"""
    
    def test_public_booking_boss(self):
        """GET /api/public/booking/boss returns Boss company data"""
        response = requests.get(f"{BASE_URL}/api/public/booking/boss")
        assert response.status_code == 200
        data = response.json()
        assert "page" in data
        assert "company" in data
        assert data["company"]["name"] == "Boss"
        assert data["page"]["slug"] == "boss"
        print(f"SUCCESS: GET /api/public/booking/boss - Boss company data returned")
    
    def test_public_indoor_boss(self):
        """GET /api/public/indoor/boss returns Boss indoor data"""
        response = requests.get(f"{BASE_URL}/api/public/indoor/boss")
        assert response.status_code == 200
        data = response.json()
        assert "company_name" in data
        assert data["company_name"] == "Boss"
        assert "appointments" in data
        assert "indoor_settings" in data
        print(f"SUCCESS: GET /api/public/indoor/boss - Boss indoor data returned")
    
    def test_business_types(self):
        """GET /api/auth/business-types returns business types for landing page"""
        response = requests.get(f"{BASE_URL}/api/auth/business-types")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0
        print(f"SUCCESS: GET /api/auth/business-types - {len(data)} business types returned")


class TestAuthEndpoints:
    """Test authentication endpoints"""
    
    def test_boss_company_login(self):
        """POST /api/auth/login with admin@boss.com.br/boss123 works"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@boss.com.br", "password": "boss123"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "user" in data
        assert data["user"]["email"] == "admin@boss.com.br"
        assert data["user"]["company"]["name"] == "Boss"
        print(f"SUCCESS: POST /api/auth/login - Boss company login works")
        return data["access_token"]
    
    def test_super_admin_login(self):
        """POST /api/auth/super-admin/login with admin@agentcrm.com/admin123 works"""
        response = requests.post(
            f"{BASE_URL}/api/auth/super-admin/login",
            json={"email": "admin@agentcrm.com", "password": "admin123"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "user" in data
        assert data["user"]["email"] == "admin@agentcrm.com"
        print(f"SUCCESS: POST /api/auth/super-admin/login - Super admin login works")
        return data["access_token"]
    
    def test_invalid_login(self):
        """POST /api/auth/login with invalid credentials returns 401"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "invalid@test.com", "password": "wrongpassword"}
        )
        assert response.status_code == 401
        print(f"SUCCESS: POST /api/auth/login - Invalid credentials return 401")


class TestSuperAdminEndpoints:
    """Test super admin endpoints"""
    
    @pytest.fixture
    def admin_token(self):
        """Get super admin token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/super-admin/login",
            json={"email": "admin@agentcrm.com", "password": "admin123"}
        )
        if response.status_code == 200:
            return response.json()["access_token"]
        pytest.skip("Super admin login failed")
    
    def test_get_companies(self, admin_token):
        """GET /api/super-admin/companies returns only Boss (1 company)"""
        response = requests.get(
            f"{BASE_URL}/api/super-admin/companies",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 1
        assert data[0]["name"] == "Boss"
        print(f"SUCCESS: GET /api/super-admin/companies - 1 company (Boss) returned")


class TestCompanyEndpoints:
    """Test company-specific endpoints"""
    
    @pytest.fixture
    def company_token(self):
        """Get Boss company token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@boss.com.br", "password": "boss123"}
        )
        if response.status_code == 200:
            return response.json()["access_token"]
        pytest.skip("Company login failed")
    
    def test_get_booking_page(self, company_token):
        """GET /api/scheduling/booking-page returns Boss booking page with correct slug"""
        response = requests.get(
            f"{BASE_URL}/api/scheduling/booking-page",
            headers={"Authorization": f"Bearer {company_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["slug"] == "boss"
        print(f"SUCCESS: GET /api/scheduling/booking-page - Boss booking page with slug 'boss'")
    
    def test_get_services(self, company_token):
        """GET /api/scheduling/services returns services list"""
        response = requests.get(
            f"{BASE_URL}/api/scheduling/services",
            headers={"Authorization": f"Bearer {company_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"SUCCESS: GET /api/scheduling/services - {len(data)} services returned")
    
    def test_get_professionals(self, company_token):
        """GET /api/scheduling/professionals returns professionals list"""
        response = requests.get(
            f"{BASE_URL}/api/scheduling/professionals",
            headers={"Authorization": f"Bearer {company_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"SUCCESS: GET /api/scheduling/professionals - {len(data)} professionals returned")
    
    def test_get_appointments(self, company_token):
        """GET /api/scheduling/appointments returns appointments list"""
        response = requests.get(
            f"{BASE_URL}/api/scheduling/appointments",
            headers={"Authorization": f"Bearer {company_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"SUCCESS: GET /api/scheduling/appointments - {len(data)} appointments returned")


class TestURLStructure:
    """Test that the new URL structure is supported by backend"""
    
    def test_slug_based_booking_endpoint(self):
        """Verify /api/public/booking/:slug works with 'boss' slug"""
        response = requests.get(f"{BASE_URL}/api/public/booking/boss")
        assert response.status_code == 200
        data = response.json()
        # Verify the slug matches
        assert data["page"]["slug"] == "boss"
        print(f"SUCCESS: Slug-based booking endpoint works for 'boss'")
    
    def test_slug_based_indoor_endpoint(self):
        """Verify /api/public/indoor/:slug works with 'boss' slug"""
        response = requests.get(f"{BASE_URL}/api/public/indoor/boss")
        assert response.status_code == 200
        data = response.json()
        # Verify company name
        assert data["company_name"] == "Boss"
        print(f"SUCCESS: Slug-based indoor endpoint works for 'boss'")
    
    def test_invalid_slug_returns_404(self):
        """Verify invalid slug returns 404"""
        response = requests.get(f"{BASE_URL}/api/public/booking/nonexistent-company")
        assert response.status_code == 404
        print(f"SUCCESS: Invalid slug returns 404")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
