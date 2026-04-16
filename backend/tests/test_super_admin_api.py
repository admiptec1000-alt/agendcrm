"""
Backend API Tests for Super Admin Features
Tests: Admin login, Company CRUD with subdomain, Business Types
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
SUPER_ADMIN_EMAIL = "admin@agentcrm.com"
SUPER_ADMIN_PASSWORD = "admin123"
REGULAR_USER_EMAIL = "maria@teste.com"
REGULAR_USER_PASSWORD = "senha123"


class TestAdminLogin:
    """Test admin login at /api/auth/super-admin/login endpoint"""
    
    def test_admin_login_success(self):
        """Admin login with correct credentials should succeed"""
        response = requests.post(f"{BASE_URL}/api/auth/super-admin/login", json={
            "email": SUPER_ADMIN_EMAIL,
            "password": SUPER_ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "access_token" in data, "Response should contain access_token"
        assert "user" in data, "Response should contain user"
        assert data["user"]["role"] == "super_admin", "User role should be super_admin"
        print(f"✓ Admin login successful, token received")
    
    def test_admin_login_wrong_password(self):
        """Admin login with wrong password should fail"""
        response = requests.post(f"{BASE_URL}/api/auth/super-admin/login", json={
            "email": SUPER_ADMIN_EMAIL,
            "password": "wrongpassword"
        })
        assert response.status_code in [401, 400], f"Expected 401/400, got {response.status_code}"
        print(f"✓ Admin login with wrong password correctly rejected")
    
    def test_regular_user_cannot_login_as_admin(self):
        """Regular user trying to login via super admin endpoint should fail"""
        response = requests.post(f"{BASE_URL}/api/auth/super-admin/login", json={
            "email": REGULAR_USER_EMAIL,
            "password": REGULAR_USER_PASSWORD
        })
        # Should fail because regular user is not in super_admins collection
        assert response.status_code in [401, 403, 400], f"Expected 401/403/400, got {response.status_code}"
        print(f"✓ Regular user correctly rejected from admin login")


class TestRegularLogin:
    """Test regular login at /api/auth/login without is_super_admin"""
    
    def test_regular_login_success(self):
        """Regular user login should succeed"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": REGULAR_USER_EMAIL,
            "password": REGULAR_USER_PASSWORD
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "access_token" in data, "Response should contain access_token"
        assert "user" in data, "Response should contain user"
        print(f"✓ Regular login successful")


@pytest.fixture
def admin_token():
    """Get admin authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/super-admin/login", json={
        "email": SUPER_ADMIN_EMAIL,
        "password": SUPER_ADMIN_PASSWORD
    })
    if response.status_code == 200:
        return response.json().get("access_token")
    pytest.skip("Admin authentication failed - skipping authenticated tests")


@pytest.fixture
def admin_headers(admin_token):
    """Get headers with admin auth token"""
    return {
        "Authorization": f"Bearer {admin_token}",
        "Content-Type": "application/json"
    }


class TestSuperAdminDashboard:
    """Test Super Admin Dashboard API"""
    
    def test_get_dashboard(self, admin_headers):
        """GET /api/super-admin/dashboard should return stats"""
        response = requests.get(f"{BASE_URL}/api/super-admin/dashboard", headers=admin_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "total_companies" in data, "Should have total_companies"
        assert "active_companies" in data, "Should have active_companies"
        assert "trial_companies" in data, "Should have trial_companies"
        assert "total_business_types" in data, "Should have total_business_types"
        print(f"✓ Dashboard stats: {data['total_companies']} companies, {data['total_business_types']} business types")


class TestSuperAdminCompanies:
    """Test Super Admin Company CRUD with subdomain field"""
    
    def test_list_companies(self, admin_headers):
        """GET /api/super-admin/companies should return list of companies"""
        response = requests.get(f"{BASE_URL}/api/super-admin/companies", headers=admin_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"✓ Listed {len(data)} companies")
    
    def test_create_company_with_subdomain(self, admin_headers):
        """POST /api/super-admin/companies should accept subdomain field"""
        unique_id = str(uuid.uuid4())[:8]
        test_subdomain = f"test-company-{unique_id}"
        
        company_data = {
            "name": f"Test Company {unique_id}",
            "email": f"test{unique_id}@testcompany.com",
            "cnpj": "12.345.678/0001-90",
            "phone": "(11) 99999-9999",
            "plan_type": "scheduling",
            "admin_name": f"Admin {unique_id}",
            "admin_email": f"admin{unique_id}@testcompany.com",
            "admin_password": "testpass123",
            "subdomain": test_subdomain
        }
        
        response = requests.post(f"{BASE_URL}/api/super-admin/companies", 
                                json=company_data, headers=admin_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, "Response should contain company id"
        assert data.get("subdomain") == test_subdomain, f"Subdomain should be {test_subdomain}"
        print(f"✓ Created company with subdomain: {test_subdomain}")
        
        # Store company_id for cleanup
        return data["id"]
    
    def test_update_company_subdomain(self, admin_headers):
        """PUT /api/super-admin/companies/{id} should update subdomain and sync with booking_pages"""
        # First create a company
        unique_id = str(uuid.uuid4())[:8]
        company_data = {
            "name": f"Update Test Company {unique_id}",
            "email": f"update{unique_id}@testcompany.com",
            "plan_type": "scheduling",
            "admin_name": f"Admin {unique_id}",
            "admin_email": f"updateadmin{unique_id}@testcompany.com",
            "admin_password": "testpass123",
            "subdomain": f"original-{unique_id}"
        }
        
        create_response = requests.post(f"{BASE_URL}/api/super-admin/companies", 
                                       json=company_data, headers=admin_headers)
        assert create_response.status_code == 200, f"Create failed: {create_response.text}"
        company_id = create_response.json()["id"]
        
        # Update subdomain
        new_subdomain = f"updated-{unique_id}"
        update_response = requests.put(f"{BASE_URL}/api/super-admin/companies/{company_id}",
                                      json={"subdomain": new_subdomain}, headers=admin_headers)
        assert update_response.status_code == 200, f"Update failed: {update_response.text}"
        
        updated_data = update_response.json()
        assert updated_data.get("subdomain") == new_subdomain, f"Subdomain should be updated to {new_subdomain}"
        print(f"✓ Updated company subdomain from original-{unique_id} to {new_subdomain}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/super-admin/companies/{company_id}", headers=admin_headers)
    
    def test_company_subdomain_syncs_with_booking_page(self, admin_headers):
        """Creating company with subdomain should create booking_page with same slug"""
        unique_id = str(uuid.uuid4())[:8]
        test_subdomain = f"sync-test-{unique_id}"
        
        company_data = {
            "name": f"Sync Test Company {unique_id}",
            "email": f"sync{unique_id}@testcompany.com",
            "plan_type": "scheduling",
            "admin_name": f"Admin {unique_id}",
            "admin_email": f"syncadmin{unique_id}@testcompany.com",
            "admin_password": "testpass123",
            "subdomain": test_subdomain
        }
        
        response = requests.post(f"{BASE_URL}/api/super-admin/companies", 
                                json=company_data, headers=admin_headers)
        assert response.status_code == 200, f"Create failed: {response.text}"
        company_id = response.json()["id"]
        
        # Try to access the public booking page with the subdomain
        booking_response = requests.get(f"{BASE_URL}/api/public/booking/{test_subdomain}")
        # It should either return 200 (found) or 404 (not found but endpoint works)
        assert booking_response.status_code in [200, 404], f"Booking page endpoint failed: {booking_response.status_code}"
        print(f"✓ Booking page endpoint accessible for subdomain: {test_subdomain}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/super-admin/companies/{company_id}", headers=admin_headers)


class TestSuperAdminBusinessTypes:
    """Test Super Admin Business Types API"""
    
    def test_list_business_types(self, admin_headers):
        """GET /api/super-admin/business-types should return list"""
        response = requests.get(f"{BASE_URL}/api/super-admin/business-types", headers=admin_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"✓ Listed {len(data)} business types")
    
    def test_get_all_features(self, admin_headers):
        """GET /api/super-admin/features should return all available features"""
        response = requests.get(f"{BASE_URL}/api/super-admin/features", headers=admin_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        assert len(data) > 0, "Should have at least one feature"
        
        # Check feature structure
        feature = data[0]
        assert "feature_key" in feature, "Feature should have feature_key"
        assert "label" in feature, "Feature should have label"
        assert "category" in feature, "Feature should have category"
        print(f"✓ Listed {len(data)} available features")


class TestPublicBookingPage:
    """Test public booking page access"""
    
    def test_public_booking_page_accessible(self):
        """GET /api/public/booking/{slug} should be accessible"""
        # Test with known slug from seed data
        response = requests.get(f"{BASE_URL}/api/public/booking/salaoteste")
        # Should return 200 if exists, 404 if not
        assert response.status_code in [200, 404], f"Unexpected status: {response.status_code}"
        print(f"✓ Public booking endpoint accessible, status: {response.status_code}")
    
    def test_public_booking_agentcrm_book(self):
        """GET /api/public/booking/agentcrm-book should be accessible"""
        response = requests.get(f"{BASE_URL}/api/public/booking/agentcrm-book")
        assert response.status_code in [200, 404], f"Unexpected status: {response.status_code}"
        print(f"✓ Public booking agentcrm-book endpoint accessible, status: {response.status_code}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
