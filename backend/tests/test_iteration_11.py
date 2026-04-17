"""
Iteration 11 Backend Tests
Tests for:
- Super Admin login and companies endpoint
- Boss company login
- Public booking page at /boss (without /booking/ prefix)
- Indoor TV endpoint
- Legacy route support
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
SUPER_ADMIN_EMAIL = "admin@agentcrm.com"
SUPER_ADMIN_PASSWORD = "admin123"
BOSS_EMAIL = "admin@boss.com.br"
BOSS_PASSWORD = "boss123"


class TestSuperAdminAuth:
    """Super Admin authentication tests"""
    
    def test_super_admin_login_success(self):
        """Test super admin login with correct credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/super-admin/login", json={
            "email": SUPER_ADMIN_EMAIL,
            "password": SUPER_ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "access_token" in data
        assert data["user"]["email"] == SUPER_ADMIN_EMAIL
        assert data["user"]["role"] == "super_admin"
        print("✓ Super admin login works")
    
    def test_super_admin_login_wrong_password(self):
        """Test super admin login with wrong password"""
        response = requests.post(f"{BASE_URL}/api/auth/super-admin/login", json={
            "email": SUPER_ADMIN_EMAIL,
            "password": "wrongpassword"
        })
        assert response.status_code == 401
        print("✓ Super admin rejects wrong password")


class TestBossCompanyAuth:
    """Boss company authentication tests"""
    
    def test_boss_login_success(self):
        """Test Boss company login with correct credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": BOSS_EMAIL,
            "password": BOSS_PASSWORD
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "access_token" in data
        assert data["user"]["email"] == BOSS_EMAIL
        assert data["user"]["company"]["name"] == "Boss"
        assert data["user"]["company"]["subdomain"] == "boss"
        print("✓ Boss company login works")
    
    def test_boss_login_wrong_password(self):
        """Test Boss company login with wrong password"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": BOSS_EMAIL,
            "password": "wrongpassword"
        })
        assert response.status_code == 401
        print("✓ Boss login rejects wrong password")


class TestSuperAdminCompanies:
    """Super Admin companies endpoint tests"""
    
    @pytest.fixture
    def super_admin_token(self):
        """Get super admin token"""
        response = requests.post(f"{BASE_URL}/api/auth/super-admin/login", json={
            "email": SUPER_ADMIN_EMAIL,
            "password": SUPER_ADMIN_PASSWORD
        })
        return response.json()["access_token"]
    
    def test_get_companies_returns_only_boss(self, super_admin_token):
        """Test that GET /api/super-admin/companies returns only Boss company"""
        response = requests.get(
            f"{BASE_URL}/api/super-admin/companies",
            headers={"Authorization": f"Bearer {super_admin_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        companies = response.json()
        assert isinstance(companies, list)
        assert len(companies) == 1, f"Expected 1 company (Boss), got {len(companies)}"
        assert companies[0]["name"] == "Boss"
        assert companies[0]["subdomain"] == "boss"
        print(f"✓ Super admin companies endpoint returns only Boss ({len(companies)} company)")
    
    def test_get_dashboard_stats(self, super_admin_token):
        """Test super admin dashboard stats"""
        response = requests.get(
            f"{BASE_URL}/api/super-admin/dashboard",
            headers={"Authorization": f"Bearer {super_admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "total_companies" in data
        assert data["total_companies"] == 1
        print("✓ Super admin dashboard shows 1 company")


class TestPublicBookingPage:
    """Public booking page tests - /boss route"""
    
    def test_public_booking_boss_returns_data(self):
        """Test GET /api/public/booking/boss returns Boss company data"""
        response = requests.get(f"{BASE_URL}/api/public/booking/boss")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "page" in data
        assert "company" in data
        assert data["page"]["slug"] == "boss"
        assert data["company"]["name"] == "Boss"
        print("✓ Public booking /boss returns Boss company data")
    
    def test_public_booking_services(self):
        """Test GET /api/public/booking/boss/services"""
        response = requests.get(f"{BASE_URL}/api/public/booking/boss/services")
        assert response.status_code == 200
        data = response.json()
        assert "services" in data
        assert "categories" in data
        print(f"✓ Public booking services endpoint works ({len(data['services'])} services)")
    
    def test_public_booking_professionals(self):
        """Test GET /api/public/booking/boss/professionals"""
        response = requests.get(f"{BASE_URL}/api/public/booking/boss/professionals")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Public booking professionals endpoint works ({len(data)} professionals)")
    
    def test_public_booking_nonexistent_slug(self):
        """Test that nonexistent slug returns 404"""
        response = requests.get(f"{BASE_URL}/api/public/booking/nonexistent-company-xyz")
        assert response.status_code == 404
        print("✓ Nonexistent slug returns 404")


class TestIndoorTV:
    """Indoor TV display tests"""
    
    def test_indoor_boss_returns_data(self):
        """Test GET /api/public/indoor/boss returns data"""
        response = requests.get(f"{BASE_URL}/api/public/indoor/boss")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "company_name" in data
        assert data["company_name"] == "Boss"
        assert "appointments" in data
        assert "indoor_settings" in data
        print("✓ Indoor TV /boss returns Boss company data")
    
    def test_indoor_nonexistent_slug(self):
        """Test that nonexistent indoor slug returns 404"""
        response = requests.get(f"{BASE_URL}/api/public/indoor/nonexistent-xyz")
        assert response.status_code == 404
        print("✓ Nonexistent indoor slug returns 404")


class TestBusinessTypes:
    """Business types endpoint tests"""
    
    def test_public_business_types(self):
        """Test public business types endpoint for landing page"""
        response = requests.get(f"{BASE_URL}/api/auth/business-types")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0, "Expected at least one business type"
        print(f"✓ Public business types returns {len(data)} types")


class TestBossCompanyDashboard:
    """Boss company dashboard API tests"""
    
    @pytest.fixture
    def boss_token(self):
        """Get Boss company token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": BOSS_EMAIL,
            "password": BOSS_PASSWORD
        })
        return response.json()["access_token"]
    
    def test_get_booking_page(self, boss_token):
        """Test Boss company can get their booking page"""
        response = requests.get(
            f"{BASE_URL}/api/scheduling/booking-page",
            headers={"Authorization": f"Bearer {boss_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["slug"] == "boss"
        print("✓ Boss company booking page shows slug 'boss'")
    
    def test_get_services(self, boss_token):
        """Test Boss company can get services"""
        response = requests.get(
            f"{BASE_URL}/api/scheduling/services",
            headers={"Authorization": f"Bearer {boss_token}"}
        )
        assert response.status_code == 200
        print("✓ Boss company services endpoint works")
    
    def test_get_professionals(self, boss_token):
        """Test Boss company can get professionals"""
        response = requests.get(
            f"{BASE_URL}/api/scheduling/professionals",
            headers={"Authorization": f"Bearer {boss_token}"}
        )
        assert response.status_code == 200
        print("✓ Boss company professionals endpoint works")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
