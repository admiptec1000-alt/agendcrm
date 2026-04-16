import requests
import sys
from datetime import datetime, timedelta
import json

class SchedulingAPITester:
    def __init__(self, base_url="https://agentcrm-book.preview.emergentagent.com"):
        self.base_url = base_url
        self.token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.company_id = None

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.base_url}/api/{endpoint}"
        req_headers = {'Content-Type': 'application/json'}
        if self.token:
            req_headers['Authorization'] = f'Bearer {self.token}'
        if headers:
            req_headers.update(headers)

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=req_headers)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=req_headers)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=req_headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=req_headers)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    return success, response.json()
                except:
                    return success, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    print(f"   Response: {response.text}")
                except:
                    pass
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_login(self):
        """Test login with scheduling company credentials"""
        success, response = self.run_test(
            "Login Scheduling Company",
            "POST",
            "auth/login",
            200,
            data={"email": "maria@teste.com", "password": "senha123"}
        )
        if success and 'access_token' in response:
            self.token = response['access_token']
            self.company_id = response.get('user', {}).get('company_id')
            print(f"   Company ID: {self.company_id}")
            return True
        return False

    def test_business_hours(self):
        """Test business hours endpoints"""
        # Get business hours
        success, hours = self.run_test(
            "Get Business Hours",
            "GET",
            "scheduling/business-hours",
            200
        )
        if not success:
            return False

        # Update business hours
        new_hours = {
            "hours": {
                "seg": {"start": "09:00", "end": "19:00", "active": True},
                "ter": {"start": "09:00", "end": "19:00", "active": True},
                "qua": {"start": "09:00", "end": "19:00", "active": True},
                "qui": {"start": "09:00", "end": "19:00", "active": True},
                "sex": {"start": "09:00", "end": "19:00", "active": True},
                "sab": {"start": "08:00", "end": "14:00", "active": True},
                "dom": {"start": "00:00", "end": "00:00", "active": False}
            }
        }
        success, _ = self.run_test(
            "Update Business Hours",
            "PUT",
            "scheduling/business-hours",
            200,
            data=new_hours
        )
        return success

    def test_professional_suspensions(self):
        """Test professional suspension endpoints"""
        # First get professionals
        success, profs = self.run_test(
            "Get Professionals for Suspension Test",
            "GET",
            "scheduling/professionals",
            200
        )
        if not success or not profs:
            print("   No professionals found, creating one...")
            # Create a test professional
            prof_data = {
                "name": "Test Professional",
                "phone": "11999999999",
                "email": "test@prof.com",
                "specialties": ["test"]
            }
            success, prof = self.run_test(
                "Create Test Professional",
                "POST",
                "scheduling/professionals",
                200,
                data=prof_data
            )
            if not success:
                return False
            prof_id = prof['id']
        else:
            prof_id = profs[0]['id']

        # Add suspension
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        day_after = (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%d")
        
        suspension_data = {
            "start_date": tomorrow,
            "end_date": day_after,
            "reason": "Test suspension"
        }
        success, suspension = self.run_test(
            "Add Professional Suspension",
            "POST",
            f"scheduling/professionals/{prof_id}/suspensions",
            200,
            data=suspension_data
        )
        if not success:
            return False

        # Remove suspension
        suspension_id = suspension.get('id')
        if suspension_id:
            success, _ = self.run_test(
                "Remove Professional Suspension",
                "DELETE",
                f"scheduling/professionals/{prof_id}/suspensions/{suspension_id}",
                200
            )
            return success
        return False

    def test_indoor_settings(self):
        """Test indoor display settings endpoints"""
        # Get indoor settings
        success, settings = self.run_test(
            "Get Indoor Settings",
            "GET",
            "scheduling/indoor",
            200
        )
        if not success:
            return False

        # Update indoor settings
        new_settings = {
            "enabled": True,
            "slide_duration": 15,
            "media_links": [
                "https://example.com/image1.jpg",
                "https://example.com/video1.mp4"
            ]
        }
        success, _ = self.run_test(
            "Update Indoor Settings",
            "PUT",
            "scheduling/indoor",
            200,
            data=new_settings
        )
        return success

    def test_smart_availability(self):
        """Test smart availability endpoint"""
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        
        # Test without specific professional
        success, availability = self.run_test(
            "Get Smart Availability (All Professionals)",
            "GET",
            f"scheduling/smart-availability?date={tomorrow}",
            200
        )
        if not success:
            return False

        # Test with specific professional
        success, profs = self.run_test(
            "Get Professionals for Availability Test",
            "GET",
            "scheduling/professionals",
            200
        )
        if success and profs:
            prof_id = profs[0]['id']
            success, _ = self.run_test(
                "Get Smart Availability (Specific Professional)",
                "GET",
                f"scheduling/smart-availability?date={tomorrow}&professional_id={prof_id}",
                200
            )
            return success
        return True  # Pass if no professionals exist

    def test_public_indoor_display(self):
        """Test public indoor display endpoint"""
        success, response = self.run_test(
            "Get Public Indoor Display",
            "GET",
            "public/indoor/salaoteste",
            200
        )
        if success:
            # Check if response has expected structure
            expected_keys = ['company_name', 'appointments', 'indoor_settings', 'date']
            has_all_keys = all(key in response for key in expected_keys)
            if has_all_keys:
                print(f"   Company: {response.get('company_name')}")
                print(f"   Appointments today: {len(response.get('appointments', []))}")
                print(f"   Indoor settings: {response.get('indoor_settings', {})}")
                return True
            else:
                print(f"   Missing keys in response: {set(expected_keys) - set(response.keys())}")
        return success

    def test_booking_page_features(self):
        """Test booking page related features"""
        # Get booking page
        success, page = self.run_test(
            "Get Booking Page",
            "GET",
            "scheduling/booking-page",
            200
        )
        if not success:
            return False

        # Test public booking page access
        success, public_page = self.run_test(
            "Get Public Booking Page",
            "GET",
            "public/booking/salaoteste",
            200
        )
        return success

def main():
    print("🚀 Starting Scheduling API Tests...")
    tester = SchedulingAPITester()

    # Login first
    if not tester.test_login():
        print("❌ Login failed, stopping tests")
        return 1

    # Test all new features
    tests = [
        ("Business Hours", tester.test_business_hours),
        ("Professional Suspensions", tester.test_professional_suspensions),
        ("Indoor Settings", tester.test_indoor_settings),
        ("Smart Availability", tester.test_smart_availability),
        ("Public Indoor Display", tester.test_public_indoor_display),
        ("Booking Page Features", tester.test_booking_page_features),
    ]

    print(f"\n📋 Running {len(tests)} test suites...")
    
    for test_name, test_func in tests:
        print(f"\n{'='*50}")
        print(f"🧪 Testing: {test_name}")
        print(f"{'='*50}")
        
        try:
            result = test_func()
            if result:
                print(f"✅ {test_name} - PASSED")
            else:
                print(f"❌ {test_name} - FAILED")
        except Exception as e:
            print(f"❌ {test_name} - ERROR: {str(e)}")

    # Print final results
    print(f"\n{'='*60}")
    print(f"📊 FINAL RESULTS")
    print(f"{'='*60}")
    print(f"Tests passed: {tester.tests_passed}/{tester.tests_run}")
    success_rate = (tester.tests_passed / tester.tests_run * 100) if tester.tests_run > 0 else 0
    print(f"Success rate: {success_rate:.1f}%")
    
    if success_rate >= 80:
        print("🎉 Overall: GOOD")
        return 0
    elif success_rate >= 60:
        print("⚠️  Overall: NEEDS IMPROVEMENT")
        return 1
    else:
        print("❌ Overall: CRITICAL ISSUES")
        return 1

if __name__ == "__main__":
    sys.exit(main())