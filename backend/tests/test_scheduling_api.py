"""
Backend API Tests for AgentCRM Scheduling Module
Tests: Business Hours, Suspensions, Booking Page (slug/custom_domain), Public Booking
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://agentcrm-book.preview.emergentagent.com')

# Test credentials
SCHEDULING_USER = {"email": "maria@teste.com", "password": "senha123"}
CRM_USER = {"email": "joao@crm.com", "password": "senha123"}


class TestAuth:
    """Authentication tests"""
    
    def test_login_scheduling_company(self):
        """Test login with scheduling company credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json=SCHEDULING_USER)
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "access_token" in data, "No access_token in response"
        assert "user" in data, "No user in response"
        print(f"SUCCESS: Login with scheduling company - user: {data['user'].get('name')}")
        return data["access_token"]
    
    def test_login_crm_company(self):
        """Test login with CRM company credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json=CRM_USER)
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "access_token" in data
        print(f"SUCCESS: Login with CRM company - user: {data['user'].get('name')}")


@pytest.fixture
def auth_token():
    """Get authentication token for scheduling company"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json=SCHEDULING_USER)
    if response.status_code == 200:
        return response.json()["access_token"]
    pytest.skip("Authentication failed")


@pytest.fixture
def auth_headers(auth_token):
    """Get headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestBusinessHours:
    """Business Hours API tests"""
    
    def test_get_business_hours(self, auth_headers):
        """GET /api/scheduling/business-hours returns day-by-day hours"""
        response = requests.get(f"{BASE_URL}/api/scheduling/business-hours", headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Should have 7 days
        expected_days = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"]
        for day in expected_days:
            assert day in data, f"Missing day: {day}"
            assert "start" in data[day], f"Missing start for {day}"
            assert "end" in data[day], f"Missing end for {day}"
            assert "active" in data[day], f"Missing active for {day}"
        
        print(f"SUCCESS: GET business-hours - {len(data)} days configured")
    
    def test_update_business_hours(self, auth_headers):
        """PUT /api/scheduling/business-hours saves business hours"""
        new_hours = {
            "seg": {"start": "09:00", "end": "19:00", "active": True},
            "ter": {"start": "09:00", "end": "19:00", "active": True},
            "qua": {"start": "09:00", "end": "19:00", "active": True},
            "qui": {"start": "09:00", "end": "19:00", "active": True},
            "sex": {"start": "09:00", "end": "19:00", "active": True},
            "sab": {"start": "08:00", "end": "14:00", "active": True},
            "dom": {"start": "00:00", "end": "00:00", "active": False},
        }
        
        response = requests.put(
            f"{BASE_URL}/api/scheduling/business-hours",
            headers=auth_headers,
            json={"hours": new_hours}
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify update
        assert data["seg"]["start"] == "09:00"
        assert data["dom"]["active"] == False
        print("SUCCESS: PUT business-hours - hours updated")


class TestProfessionalSuspensions:
    """Professional Suspensions API tests"""
    
    def test_get_professionals(self, auth_headers):
        """Get list of professionals to use for suspension tests"""
        response = requests.get(f"{BASE_URL}/api/scheduling/professionals", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) > 0, "No professionals found"
        print(f"SUCCESS: GET professionals - found {len(data)} professionals")
        return data[0]["id"]
    
    def test_add_suspension(self, auth_headers):
        """POST /api/scheduling/professionals/{id}/suspensions creates suspension"""
        # First get a professional
        prof_response = requests.get(f"{BASE_URL}/api/scheduling/professionals", headers=auth_headers)
        assert prof_response.status_code == 200
        professionals = prof_response.json()
        assert len(professionals) > 0
        prof_id = professionals[0]["id"]
        
        # Add suspension
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        next_week = (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")
        
        suspension_data = {
            "start_date": tomorrow,
            "end_date": next_week,
            "reason": "TEST_Ferias de teste"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/scheduling/professionals/{prof_id}/suspensions",
            headers=auth_headers,
            json=suspension_data
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "id" in data, "No suspension ID returned"
        assert data["start_date"] == tomorrow
        assert data["end_date"] == next_week
        print(f"SUCCESS: POST suspension - created suspension ID: {data['id']}")
        return prof_id, data["id"]
    
    def test_remove_suspension(self, auth_headers):
        """DELETE /api/scheduling/professionals/{id}/suspensions/{sus_id} removes suspension"""
        # First add a suspension
        prof_response = requests.get(f"{BASE_URL}/api/scheduling/professionals", headers=auth_headers)
        professionals = prof_response.json()
        prof_id = professionals[0]["id"]
        
        # Add suspension to remove
        tomorrow = (datetime.now() + timedelta(days=10)).strftime("%Y-%m-%d")
        next_week = (datetime.now() + timedelta(days=17)).strftime("%Y-%m-%d")
        
        add_response = requests.post(
            f"{BASE_URL}/api/scheduling/professionals/{prof_id}/suspensions",
            headers=auth_headers,
            json={"start_date": tomorrow, "end_date": next_week, "reason": "TEST_To be deleted"}
        )
        assert add_response.status_code == 200
        sus_id = add_response.json()["id"]
        
        # Now remove it
        response = requests.delete(
            f"{BASE_URL}/api/scheduling/professionals/{prof_id}/suspensions/{sus_id}",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        print(f"SUCCESS: DELETE suspension - removed suspension ID: {sus_id}")


class TestBookingPage:
    """Booking Page API tests (slug and custom_domain)"""
    
    def test_get_booking_page(self, auth_headers):
        """GET /api/scheduling/booking-page returns booking page config"""
        response = requests.get(f"{BASE_URL}/api/scheduling/booking-page", headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Should have slug
        assert "slug" in data or data == {}, "No slug in response"
        print(f"SUCCESS: GET booking-page - slug: {data.get('slug', 'not set')}")
    
    def test_update_booking_page_slug(self, auth_headers):
        """PUT /api/scheduling/booking-page accepts slug field"""
        response = requests.put(
            f"{BASE_URL}/api/scheduling/booking-page",
            headers=auth_headers,
            json={"slug": "salaoteste"}
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data.get("slug") == "salaoteste"
        print("SUCCESS: PUT booking-page slug updated")
    
    def test_update_booking_page_custom_domain(self, auth_headers):
        """PUT /api/scheduling/booking-page accepts custom_domain field"""
        response = requests.put(
            f"{BASE_URL}/api/scheduling/booking-page",
            headers=auth_headers,
            json={"custom_domain": "test-domain.com.br"}
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data.get("custom_domain") == "test-domain.com.br"
        print("SUCCESS: PUT booking-page custom_domain updated")
        
        # Clean up - remove custom domain
        requests.put(
            f"{BASE_URL}/api/scheduling/booking-page",
            headers=auth_headers,
            json={"custom_domain": None}
        )


class TestPublicBooking:
    """Public Booking API tests"""
    
    def test_get_public_booking_page_by_slug(self):
        """GET /api/public/booking/{slug} works with slug lookup"""
        response = requests.get(f"{BASE_URL}/api/public/booking/salaoteste")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "page" in data, "No page in response"
        assert "company" in data, "No company in response"
        assert data["company"]["name"], "No company name"
        print(f"SUCCESS: GET public booking by slug - company: {data['company']['name']}")
    
    def test_get_public_services(self):
        """GET /api/public/booking/{slug}/services returns services"""
        response = requests.get(f"{BASE_URL}/api/public/booking/salaoteste/services")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "services" in data, "No services in response"
        print(f"SUCCESS: GET public services - found {len(data['services'])} services")
    
    def test_get_public_professionals(self):
        """GET /api/public/booking/{slug}/professionals returns professionals"""
        response = requests.get(f"{BASE_URL}/api/public/booking/salaoteste/professionals")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), "Response should be a list"
        print(f"SUCCESS: GET public professionals - found {len(data)} professionals")
    
    def test_get_public_availability(self):
        """GET /api/public/booking/{slug}/availability returns available slots"""
        # Get a professional first
        prof_response = requests.get(f"{BASE_URL}/api/public/booking/salaoteste/professionals")
        professionals = prof_response.json()
        if len(professionals) == 0:
            pytest.skip("No professionals available")
        
        prof_id = professionals[0]["id"]
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        
        response = requests.get(
            f"{BASE_URL}/api/public/booking/salaoteste/availability",
            params={"professional_id": prof_id, "date": tomorrow}
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "date" in data, "No date in response"
        assert "available_slots" in data, "No available_slots in response"
        print(f"SUCCESS: GET public availability - {len(data['available_slots'])} slots for {tomorrow}")


class TestSmartAvailability:
    """Smart Availability API tests (considers business hours, professional hours, suspensions)"""
    
    def test_smart_availability(self, auth_headers):
        """GET /api/scheduling/smart-availability returns slots considering all factors"""
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        
        response = requests.get(
            f"{BASE_URL}/api/scheduling/smart-availability",
            headers=auth_headers,
            params={"date": tomorrow}
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "date" in data, "No date in response"
        assert "available_slots" in data, "No available_slots in response"
        print(f"SUCCESS: GET smart-availability - {len(data['available_slots'])} slots")
    
    def test_smart_availability_with_service(self, auth_headers):
        """GET /api/scheduling/smart-availability considers service duration"""
        # Get a service first
        svc_response = requests.get(f"{BASE_URL}/api/scheduling/services", headers=auth_headers)
        services = svc_response.json()
        if len(services) == 0:
            pytest.skip("No services available")
        
        service_id = services[0]["id"]
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        
        response = requests.get(
            f"{BASE_URL}/api/scheduling/smart-availability",
            headers=auth_headers,
            params={"date": tomorrow, "service_id": service_id}
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "duration" in data, "No duration in response"
        print(f"SUCCESS: GET smart-availability with service - duration: {data['duration']}min")


class TestIndoorDisplay:
    """Indoor Display API tests"""
    
    def test_get_indoor_settings(self, auth_headers):
        """GET /api/scheduling/indoor returns indoor settings"""
        response = requests.get(f"{BASE_URL}/api/scheduling/indoor", headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "slide_duration" in data, "No slide_duration in response"
        print(f"SUCCESS: GET indoor settings - slide_duration: {data['slide_duration']}s")
    
    def test_get_public_indoor(self):
        """GET /api/public/indoor/{slug} returns public indoor display data"""
        response = requests.get(f"{BASE_URL}/api/public/indoor/salaoteste")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "company_name" in data, "No company_name in response"
        assert "appointments" in data, "No appointments in response"
        print(f"SUCCESS: GET public indoor - company: {data['company_name']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
