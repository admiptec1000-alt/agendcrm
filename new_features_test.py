#!/usr/bin/env python3
import requests
import sys
import json
from datetime import datetime

class NewFeaturesTester:
    def __init__(self, base_url="https://agentcrm-book.preview.emergentagent.com"):
        self.base_url = base_url
        self.token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.company_id = None

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.base_url}/api/{endpoint}"
        test_headers = {'Content-Type': 'application/json'}
        if self.token:
            test_headers['Authorization'] = f'Bearer {self.token}'
        if headers:
            test_headers.update(headers)

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=test_headers, timeout=30)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=test_headers, timeout=30)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=test_headers, timeout=30)
            elif method == 'DELETE':
                response = requests.delete(url, headers=test_headers, timeout=30)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    return True, response.json()
                except:
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    print(f"Response: {response.text}")
                except:
                    pass
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_login(self, email, password, is_super_admin=False):
        """Test login and get token"""
        login_data = {"email": email, "password": password}
        if is_super_admin:
            login_data["is_super_admin"] = True
            
        success, response = self.run_test(
            f"Login ({'Super Admin' if is_super_admin else 'Company Admin'})",
            "POST",
            "auth/login",
            200,
            data=login_data
        )
        if success and 'access_token' in response:
            self.token = response['access_token']
            if 'user' in response and 'company_id' in response['user']:
                self.company_id = response['user']['company_id']
            return True
        return False

    def test_onboarding_features(self):
        """Test onboarding wizard features"""
        print("\n🎯 Testing Onboarding Features")
        
        # Test onboarding status
        success, response = self.run_test(
            "Get Onboarding Status",
            "GET",
            "scheduling/onboarding-status",
            200
        )
        if success:
            print(f"   Onboarding done: {response.get('onboarding_done', False)}")
            print(f"   Steps: {response.get('steps', {})}")
            print(f"   Services count: {response.get('services_count', 0)}")
            print(f"   Professionals count: {response.get('professionals_count', 0)}")

        # Test complete onboarding
        success2, response2 = self.run_test(
            "Complete Onboarding",
            "POST",
            "scheduling/onboarding-complete",
            200
        )
        
        return success and success2

    def test_kanban_features(self):
        """Test Kanban drag-and-drop features"""
        print("\n📋 Testing Kanban Features")
        
        # Test get kanban
        success, response = self.run_test(
            "Get Kanban Data",
            "GET",
            "crm/kanban",
            200
        )
        
        if success:
            print(f"   Kanban columns: {list(response.keys()) if response else 'Empty'}")
        
        # Test create ticket (should appear in kanban)
        ticket_data = {
            "customer_name": "Test Customer",
            "customer_phone": "+55 11 99999-9999",
            "description": "Test ticket for kanban",
            "priority": "medium",
            "channel": "whatsapp"
        }
        success2, response2 = self.run_test(
            "Create Ticket for Kanban",
            "POST",
            "crm/tickets",
            200,
            data=ticket_data
        )
        
        ticket_id = None
        if success2 and 'id' in response2:
            ticket_id = response2['id']
            print(f"   Created ticket ID: {ticket_id}")
        
        # Test update ticket status (drag-and-drop simulation)
        if ticket_id:
            update_data = {"status": "em_cobranca"}
            success3, response3 = self.run_test(
                "Update Ticket Status (Drag-Drop)",
                "PUT",
                f"crm/tickets/{ticket_id}",
                200,
                data=update_data
            )
            return success and success2 and success3
        
        return success and success2

    def test_whatsapp_features(self):
        """Test WhatsApp connection features (mocked)"""
        print("\n📱 Testing WhatsApp Features")
        
        # Note: WhatsApp is mocked, so we just test that endpoints exist
        # The actual connection simulation happens in frontend
        
        # Test get connections (if endpoint exists)
        success, response = self.run_test(
            "Get WhatsApp Connections",
            "GET",
            "crm/connections",
            200
        )
        
        return success

    def test_upload_features(self):
        """Test upload features for Meu Site"""
        print("\n📤 Testing Upload Features")
        
        # Test booking page endpoints
        success, response = self.run_test(
            "Get Booking Page",
            "GET",
            "scheduling/booking-page",
            200
        )
        
        if success:
            print(f"   Booking page data: {response}")
        
        # Test update booking page colors
        update_data = {
            "primary_color": "#4F46E5",
            "secondary_color": "#10B981"
        }
        success2, response2 = self.run_test(
            "Update Booking Page Colors",
            "PUT",
            "scheduling/booking-page",
            200,
            data=update_data
        )
        
        # Note: File upload test would require multipart/form-data
        # For now, just test that the endpoint exists
        success3, response3 = self.run_test(
            "Upload Booking Image (no file - should fail)",
            "POST",
            "upload/booking-image",
            422  # Expecting validation error without file
        )
        
        return success and success2 and success3

    def test_service_creation(self):
        """Test service creation for onboarding"""
        print("\n✂️ Testing Service Creation")
        
        service_data = {
            "name": "Test Service for Onboarding",
            "description": "Test service description",
            "type": "service",
            "duration": 60,
            "price": 50.0
        }
        success, response = self.run_test(
            "Create Service",
            "POST",
            "scheduling/services",
            200,
            data=service_data
        )
        
        if success and 'id' in response:
            print(f"   Created service ID: {response['id']}")
        
        return success

    def test_professional_creation(self):
        """Test professional creation for onboarding"""
        print("\n👨‍💼 Testing Professional Creation")
        
        prof_data = {
            "name": "Test Professional for Onboarding",
            "phone": "+55 11 99999-9999",
            "specialties": ["Test Specialty"]
        }
        success, response = self.run_test(
            "Create Professional",
            "POST",
            "scheduling/professionals",
            200,
            data=prof_data
        )
        
        if success and 'id' in response:
            print(f"   Created professional ID: {response['id']}")
        
        return success

def main():
    print("🚀 Starting AgentCRM New Features Backend Tests")
    print("=" * 60)
    
    tester = NewFeaturesTester()
    
    # Test with scheduling company (maria@teste.com)
    print("\n📋 Testing with Scheduling Company (maria@teste.com)")
    if not tester.test_login("maria@teste.com", "senha123"):
        print("❌ Login failed for scheduling company, stopping tests")
        return 1

    # Test all new features
    tester.test_onboarding_features()
    tester.test_service_creation()
    tester.test_professional_creation()
    tester.test_upload_features()
    
    # Test with CRM company (joao@crm.com) for Kanban
    print("\n📋 Testing with CRM Company (joao@crm.com)")
    if not tester.test_login("joao@crm.com", "senha123"):
        print("❌ Login failed for CRM company")
    else:
        tester.test_kanban_features()
        tester.test_whatsapp_features()

    # Print results
    print(f"\n📊 Test Results: {tester.tests_passed}/{tester.tests_run} passed")
    success_rate = (tester.tests_passed / tester.tests_run * 100) if tester.tests_run > 0 else 0
    print(f"📈 Success Rate: {success_rate:.1f}%")
    
    return 0 if success_rate >= 80 else 1

if __name__ == "__main__":
    sys.exit(main())