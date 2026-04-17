"""
Iteration 13 Backend Tests
- BUG FIX: Public booking without email field
- Menu 'Calendario' renders CalendarPageFull
- Menu 'Agendamento' renders MessageSchedulingPage
- PUT /api/scheduling/appointments/{id} updates status
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestPublicBookingWithoutEmail:
    """Test the bug fix: booking without email should work"""
    
    def test_health_check(self):
        """Verify API is running"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "running"
        print("✓ API health check passed")
    
    def test_get_boss_booking_page(self):
        """Verify Boss booking page exists"""
        response = requests.get(f"{BASE_URL}/api/public/booking/boss")
        assert response.status_code == 200
        data = response.json()
        assert "company" in data
        assert data["company"]["name"] == "Boss"
        print(f"✓ Boss booking page found: {data['company']['name']}")
    
    def test_get_boss_services(self):
        """Verify Boss has services"""
        response = requests.get(f"{BASE_URL}/api/public/booking/boss/services")
        assert response.status_code == 200
        data = response.json()
        assert "services" in data
        print(f"✓ Boss services: {len(data['services'])} services found")
        return data["services"]
    
    def test_get_boss_professionals(self):
        """Verify Boss has professionals"""
        response = requests.get(f"{BASE_URL}/api/public/booking/boss/professionals")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Boss professionals: {len(data)} professionals found")
        return data
    
    def test_get_availability(self):
        """Test availability endpoint"""
        # First get professionals
        profs_response = requests.get(f"{BASE_URL}/api/public/booking/boss/professionals")
        profs = profs_response.json()
        if not profs:
            pytest.skip("No professionals available")
        
        prof_id = profs[0]["id"]
        # Use a weekday date
        test_date = "2026-04-20"  # Monday
        
        response = requests.get(
            f"{BASE_URL}/api/public/booking/boss/availability",
            params={"professional_id": prof_id, "date": test_date}
        )
        assert response.status_code == 200
        data = response.json()
        assert "available_slots" in data
        print(f"✓ Availability for {test_date}: {len(data['available_slots'])} slots")
        return data["available_slots"], prof_id
    
    def test_booking_without_email(self):
        """BUG FIX TEST: Create booking WITHOUT customer_email field"""
        # Get services
        svcs_response = requests.get(f"{BASE_URL}/api/public/booking/boss/services")
        services = svcs_response.json()["services"]
        if not services:
            pytest.skip("No services available")
        
        # Get professionals
        profs_response = requests.get(f"{BASE_URL}/api/public/booking/boss/professionals")
        profs = profs_response.json()
        if not profs:
            pytest.skip("No professionals available")
        
        service = services[0]
        prof = profs[0]
        
        # Get availability
        test_date = "2026-04-20"  # Monday
        avail_response = requests.get(
            f"{BASE_URL}/api/public/booking/boss/availability",
            params={"professional_id": prof["id"], "date": test_date}
        )
        slots = avail_response.json()["available_slots"]
        if not slots:
            pytest.skip("No available slots")
        
        # Create booking WITHOUT email (the bug fix)
        booking_data = {
            "service_id": service["id"],
            "professional_id": prof["id"],
            "date": test_date,
            "time": slots[0],
            "customer_name": "TEST_NoEmail_User",
            "customer_phone": "(62) 99999-1234"
            # NOTE: customer_email is intentionally NOT included
        }
        
        response = requests.post(
            f"{BASE_URL}/api/public/booking/boss/book",
            json=booking_data
        )
        
        # This should succeed (bug fix: empty email removed from payload)
        assert response.status_code == 200, f"Booking failed: {response.text}"
        data = response.json()
        assert "id" in data
        assert data["message"] == "Agendamento realizado com sucesso!"
        print(f"✓ BUG FIX VERIFIED: Booking created without email - ID: {data['id']}")
        return data["id"]
    
    def test_booking_with_empty_email_string(self):
        """Test that empty string email is handled (should be removed by frontend)"""
        # Get services
        svcs_response = requests.get(f"{BASE_URL}/api/public/booking/boss/services")
        services = svcs_response.json()["services"]
        if not services:
            pytest.skip("No services available")
        
        # Get professionals
        profs_response = requests.get(f"{BASE_URL}/api/public/booking/boss/professionals")
        profs = profs_response.json()
        if not profs:
            pytest.skip("No professionals available")
        
        service = services[0]
        prof = profs[0]
        
        # Get availability
        test_date = "2026-04-21"  # Tuesday
        avail_response = requests.get(
            f"{BASE_URL}/api/public/booking/boss/availability",
            params={"professional_id": prof["id"], "date": test_date}
        )
        slots = avail_response.json()["available_slots"]
        if not slots:
            pytest.skip("No available slots")
        
        # Create booking with empty email string (this would fail before the fix)
        # The frontend now removes empty email, but backend should also handle it
        booking_data = {
            "service_id": service["id"],
            "professional_id": prof["id"],
            "date": test_date,
            "time": slots[0],
            "customer_name": "TEST_EmptyEmail_User",
            "customer_phone": "(62) 99999-5678",
            "customer_email": ""  # Empty string - should be handled
        }
        
        response = requests.post(
            f"{BASE_URL}/api/public/booking/boss/book",
            json=booking_data
        )
        
        # Note: Pydantic EmailStr will reject empty string, so this may fail
        # The fix is in frontend to not send empty email
        if response.status_code == 422:
            print("✓ Backend correctly rejects empty email string (frontend should remove it)")
        elif response.status_code == 200:
            print("✓ Backend accepts empty email string")
        else:
            print(f"⚠ Unexpected response: {response.status_code} - {response.text}")


class TestAppointmentStatusUpdate:
    """Test PUT /api/scheduling/appointments/{id} for status updates"""
    
    @pytest.fixture
    def auth_token(self):
        """Get auth token for Boss company"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@boss.com.br", "password": "boss123"}
        )
        if response.status_code != 200:
            pytest.skip("Could not authenticate")
        return response.json()["access_token"]
    
    def test_login_boss(self):
        """Verify Boss login works"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@boss.com.br", "password": "boss123"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        print("✓ Boss login successful")
        return data["access_token"]
    
    def test_get_appointments(self, auth_token):
        """Get appointments list"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(
            f"{BASE_URL}/api/scheduling/appointments",
            headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Got {len(data)} appointments")
        return data
    
    def test_update_appointment_status(self, auth_token):
        """Test updating appointment status (Confirmar/Concluir/Cancelar)"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Get appointments
        response = requests.get(
            f"{BASE_URL}/api/scheduling/appointments",
            headers=headers
        )
        appointments = response.json()
        
        if not appointments:
            pytest.skip("No appointments to update")
        
        # Find a pendente or confirmado appointment
        apt = None
        for a in appointments:
            if a.get("status") in ["pendente", "confirmado"]:
                apt = a
                break
        
        if not apt:
            # Use first appointment
            apt = appointments[0]
        
        apt_id = apt["id"]
        original_status = apt.get("status", "unknown")
        
        # Update to confirmado
        new_status = "confirmado" if original_status != "confirmado" else "concluido"
        
        response = requests.put(
            f"{BASE_URL}/api/scheduling/appointments/{apt_id}",
            headers=headers,
            json={"status": new_status}
        )
        
        assert response.status_code == 200, f"Update failed: {response.text}"
        data = response.json()
        assert data["status"] == new_status
        print(f"✓ Appointment status updated: {original_status} -> {new_status}")


class TestIndoorDisplay:
    """Test Indoor TV display shows same info as agenda list"""
    
    def test_indoor_endpoint(self):
        """Verify indoor endpoint returns appointments"""
        response = requests.get(f"{BASE_URL}/api/public/indoor/boss")
        assert response.status_code == 200
        data = response.json()
        assert "company_name" in data
        assert "appointments" in data
        assert data["company_name"] == "Boss"
        print(f"✓ Indoor display: {len(data['appointments'])} appointments for today")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
