import requests
import sys
import json
from datetime import datetime

class AgentCRMAPITester:
    def __init__(self, base_url="https://agentcrm-book.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.super_admin_token = None
        self.company_admin_token = None
        self.crm_admin_token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def log_test(self, name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            print(f"❌ {name} - {details}")
        
        self.test_results.append({
            "test": name,
            "success": success,
            "details": details
        })

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        test_headers = {'Content-Type': 'application/json'}
        
        if headers:
            test_headers.update(headers)

        try:
            if method == 'GET':
                response = requests.get(url, headers=test_headers)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=test_headers)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=test_headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=test_headers)

            success = response.status_code == expected_status
            details = f"Status: {response.status_code}"
            
            if not success:
                details += f" (Expected {expected_status})"
                try:
                    error_data = response.json()
                    details += f" - {error_data.get('detail', 'Unknown error')}"
                except:
                    details += f" - {response.text[:100]}"

            self.log_test(name, success, details)
            return success, response.json() if success and response.content else {}

        except Exception as e:
            self.log_test(name, False, f"Exception: {str(e)}")
            return False, {}

    def test_super_admin_login(self):
        """Test Super Admin login"""
        success, response = self.run_test(
            "Super Admin Login",
            "POST",
            "auth/super-admin/login",
            200,
            data={"email": "admin@agentcrm.com", "password": "admin123"}
        )
        if success and 'access_token' in response:
            self.super_admin_token = response['access_token']
            return True
        return False

    def test_public_business_types(self):
        """Test public business types endpoint"""
        success, response = self.run_test(
            "Public Business Types",
            "GET",
            "auth/business-types",
            200
        )
        return success and isinstance(response, list)

    def test_super_admin_dashboard(self):
        """Test Super Admin dashboard"""
        if not self.super_admin_token:
            self.log_test("Super Admin Dashboard", False, "No super admin token")
            return False

        headers = {"Authorization": f"Bearer {self.super_admin_token}"}
        success, response = self.run_test(
            "Super Admin Dashboard",
            "GET",
            "super-admin/dashboard",
            200,
            headers=headers
        )
        
        if success:
            required_fields = ['total_companies', 'active_companies', 'trial_companies', 'total_business_types']
            missing_fields = [field for field in required_fields if field not in response]
            if missing_fields:
                self.log_test("Dashboard Fields Check", False, f"Missing fields: {missing_fields}")
                return False
            else:
                self.log_test("Dashboard Fields Check", True)
        
        return success

    def test_super_admin_business_types(self):
        """Test Super Admin business types management"""
        if not self.super_admin_token:
            self.log_test("Super Admin Business Types", False, "No super admin token")
            return False

        headers = {"Authorization": f"Bearer {self.super_admin_token}"}
        
        # Get business types
        success, response = self.run_test(
            "Get Business Types",
            "GET",
            "super-admin/business-types",
            200,
            headers=headers
        )
        
        if success and isinstance(response, list) and len(response) >= 4:
            self.log_test("Business Types Count Check", True, f"Found {len(response)} types")
            
            # Check for expected default types
            type_names = [bt.get('name', '') for bt in response]
            expected_types = ['Salao de Beleza', 'Clinica', 'Atendimento ao Cliente', 'Completo']
            found_types = [t for t in expected_types if any(t in name for name in type_names)]
            
            if len(found_types) >= 3:  # Allow some flexibility
                self.log_test("Default Business Types Check", True, f"Found: {found_types}")
            else:
                self.log_test("Default Business Types Check", False, f"Expected types not found. Got: {type_names}")
        else:
            self.log_test("Business Types Count Check", False, f"Expected at least 4 types, got {len(response) if isinstance(response, list) else 0}")
        
        return success

    def test_super_admin_companies(self):
        """Test Super Admin companies management"""
        if not self.super_admin_token:
            self.log_test("Super Admin Companies", False, "No super admin token")
            return False

        headers = {"Authorization": f"Bearer {self.super_admin_token}"}
        
        # Get companies
        success, response = self.run_test(
            "Get Companies",
            "GET",
            "super-admin/companies",
            200,
            headers=headers
        )
        
        return success

    def test_create_company(self):
        """Test creating a new company"""
        if not self.super_admin_token:
            self.log_test("Create Company", False, "No super admin token")
            return False

        headers = {"Authorization": f"Bearer {self.super_admin_token}"}
        
        # First get business types to use one
        _, bt_response = self.run_test(
            "Get Business Types for Company Creation",
            "GET",
            "super-admin/business-types",
            200,
            headers=headers
        )
        
        if not bt_response or not isinstance(bt_response, list) or len(bt_response) == 0:
            self.log_test("Create Company", False, "No business types available")
            return False

        business_type_id = bt_response[0]['id']
        
        company_data = {
            "name": f"Test Company {datetime.now().strftime('%H%M%S')}",
            "cnpj": "12.345.678/0001-90",
            "email": f"test{datetime.now().strftime('%H%M%S')}@testcompany.com",
            "phone": "(11) 99999-9999",
            "plan_type": "both",
            "business_type_id": business_type_id,
            "admin_name": "Test Admin",
            "admin_email": f"admin{datetime.now().strftime('%H%M%S')}@testcompany.com",
            "admin_password": "testpass123"
        }
        
        success, response = self.run_test(
            "Create Company",
            "POST",
            "super-admin/companies",
            200,
            data=company_data,
            headers=headers
        )
        
        if success and 'id' in response:
            self.created_company_id = response['id']
            self.log_test("Company Creation Response Check", True, f"Company ID: {response['id']}")
        
        return success

    def test_company_admin_login(self):
        """Test company admin login with pre-existing credentials"""
        success, response = self.run_test(
            "Company Admin Login",
            "POST",
            "auth/login",
            200,
            data={"email": "maria@teste.com", "password": "senha123"}
        )
        if success and 'access_token' in response:
            self.company_admin_token = response['access_token']
            self.log_test("Company Admin Token Check", True)
            return True
        return False

    def test_crm_admin_login(self):
        """Test CRM company admin login"""
        success, response = self.run_test(
            "CRM Admin Login",
            "POST",
            "auth/login",
            200,
            data={"email": "joao@crm.com", "password": "senha123"}
        )
        if success and 'access_token' in response:
            self.crm_admin_token = response['access_token']
            self.log_test("CRM Admin Token Check", True)
            return True
        return False

    def test_whatsapp_connections(self):
        """Test WhatsApp connections API"""
        if not hasattr(self, 'crm_admin_token') or not self.crm_admin_token:
            self.log_test("WhatsApp Connections", False, "No CRM admin token")
            return False

        headers = {"Authorization": f"Bearer {self.crm_admin_token}"}
        
        # Test GET connections
        success, response = self.run_test(
            "GET WhatsApp Connections",
            "GET",
            "whatsapp/connections",
            200,
            headers=headers
        )
        
        if not success:
            return False
        
        # Test GET connection stats
        success, stats = self.run_test(
            "GET WhatsApp Connection Stats",
            "GET",
            "whatsapp/connections/stats",
            200,
            headers=headers
        )
        
        if success and isinstance(stats, dict):
            required_stats = ['total', 'connected', 'disconnected']
            if all(key in stats for key in required_stats):
                self.log_test("WhatsApp Stats Fields Check", True)
            else:
                self.log_test("WhatsApp Stats Fields Check", False, f"Missing stats fields")
        
        # Test POST create connection
        connection_data = {"name": f"Test Connection {datetime.now().strftime('%H%M%S')}"}
        success, conn_response = self.run_test(
            "POST Create WhatsApp Connection",
            "POST",
            "whatsapp/connections",
            200,
            data=connection_data,
            headers=headers
        )
        
        if success and 'id' in conn_response:
            conn_id = conn_response['id']
            self.log_test("Connection Creation Response Check", True, f"Connection ID: {conn_id}")
            
            # Test POST connect
            success, connect_response = self.run_test(
                "POST Connect WhatsApp",
                "POST",
                f"whatsapp/connections/{conn_id}/connect",
                200,
                headers=headers
            )
            
            if success and connect_response.get('status') == 'connecting':
                self.log_test("WhatsApp Connect Status Check", True)
                
                # Test simulate connected
                success, sim_response = self.run_test(
                    "POST Simulate Connected",
                    "POST",
                    f"whatsapp/connections/{conn_id}/simulate-connected",
                    200,
                    headers=headers
                )
                
                if success and sim_response.get('status') == 'connected':
                    self.log_test("WhatsApp Simulate Connected Check", True)
                
            # Test DELETE connection
            success, delete_response = self.run_test(
                "DELETE WhatsApp Connection",
                "DELETE",
                f"whatsapp/connections/{conn_id}",
                200,
                headers=headers
            )
        
        return True

    def test_public_booking_apis(self):
        """Test public booking APIs"""
        slug = "salaoteste"
        
        # Test GET booking page
        success, page_response = self.run_test(
            "GET Public Booking Page",
            "GET",
            f"public/booking/{slug}",
            200
        )
        
        if not success:
            return False
        
        # Test GET services
        success, services_response = self.run_test(
            "GET Public Services",
            "GET",
            f"public/booking/{slug}/services",
            200
        )
        
        if success and 'services' in services_response:
            self.log_test("Public Services Response Check", True)
        
        # Test GET professionals
        success, profs_response = self.run_test(
            "GET Public Professionals",
            "GET",
            f"public/booking/{slug}/professionals",
            200
        )
        
        if success and isinstance(profs_response, list):
            self.log_test("Public Professionals Response Check", True)
        
        # Test client lookup
        phone = "62912345678"
        success, lookup_response = self.run_test(
            "GET Public Client Lookup",
            "GET",
            f"public/booking/{slug}/client-lookup/{phone}",
            200
        )
        
        if success:
            if lookup_response.get('found'):
                client = lookup_response.get('client', {})
                subscription = lookup_response.get('subscription')
                if client.get('name') and subscription:
                    self.log_test("Client Lookup with Subscription Check", True, f"Found: {client.get('name')}")
                else:
                    self.log_test("Client Lookup Data Check", False, "Missing client or subscription data")
            else:
                self.log_test("Client Lookup Not Found", True, "Client not found (expected for some cases)")
        
        return True

    def test_reports_apis(self):
        """Test reports APIs"""
        if not self.company_admin_token:
            self.log_test("Reports APIs", False, "No company admin token")
            return False

        headers = {"Authorization": f"Bearer {self.company_admin_token}"}
        
        # Test GET commissions report
        success, comm_response = self.run_test(
            "GET Commissions Report",
            "GET",
            "reports/commissions",
            200,
            headers=headers
        )
        
        if success:
            if 'report' in comm_response and 'summary' in comm_response:
                summary = comm_response['summary']
                required_fields = ['total_revenue', 'total_commission', 'total_appointments', 'avg_ticket']
                if all(field in summary for field in required_fields):
                    self.log_test("Commissions Report Structure Check", True)
                else:
                    self.log_test("Commissions Report Structure Check", False, f"Missing summary fields")
            else:
                self.log_test("Commissions Report Structure Check", False, "Missing report or summary")
        
        # Test GET financial report
        success, fin_response = self.run_test(
            "GET Financial Report",
            "GET",
            "reports/financial",
            200,
            headers=headers
        )
        
        if success:
            required_fields = ['total_revenue', 'completed_revenue', 'pending_revenue', 'completed_count', 'pending_count', 'cancelled_count']
            if all(field in fin_response for field in required_fields):
                self.log_test("Financial Report Structure Check", True)
            else:
                self.log_test("Financial Report Structure Check", False, f"Missing financial fields")
        
        return success

    def test_notifications_apis(self):
        """Test notifications APIs"""
        if not self.company_admin_token:
            self.log_test("Notifications APIs", False, "No company admin token")
            return False

        headers = {"Authorization": f"Bearer {self.company_admin_token}"}
        
        # Test GET notification settings
        success, settings_response = self.run_test(
            "GET Notification Settings",
            "GET",
            "notifications/settings",
            200,
            headers=headers
        )
        
        if success:
            required_fields = ['booking_confirmation', 'booking_reminder_24h', 'booking_cancelled', 'new_client', 'daily_summary', 'channel']
            if all(field in settings_response for field in required_fields):
                self.log_test("Notification Settings Structure Check", True)
            else:
                self.log_test("Notification Settings Structure Check", False, f"Missing settings fields")
        
        # Test PUT notification settings
        update_data = {"booking_confirmation": True, "channel": "whatsapp"}
        success, update_response = self.run_test(
            "PUT Notification Settings",
            "PUT",
            "notifications/settings",
            200,
            data=update_data,
            headers=headers
        )
        
        if success and update_response.get('booking_confirmation') == True:
            self.log_test("Notification Settings Update Check", True)
        
        # Test POST send test notification
        success, test_response = self.run_test(
            "POST Send Test Notification",
            "POST",
            "notifications/send-test",
            200,
            headers=headers
        )
        
        if success:
            required_fields = ['id', 'type', 'title', 'message', 'status']
            if all(field in test_response for field in required_fields):
                self.log_test("Test Notification Structure Check", True)
            else:
                self.log_test("Test Notification Structure Check", False, f"Missing notification fields")
        
        # Test GET notification history
        success, history_response = self.run_test(
            "GET Notification History",
            "GET",
            "notifications/history",
            200,
            headers=headers
        )
        
        if success and isinstance(history_response, list):
            self.log_test("Notification History Structure Check", True)
        
        return success

    def test_all_features_endpoint(self):
        """Test getting all available features"""
        if not self.super_admin_token:
            self.log_test("All Features Endpoint", False, "No super admin token")
            return False

        headers = {"Authorization": f"Bearer {self.super_admin_token}"}
        success, response = self.run_test(
            "Get All Features",
            "GET",
            "super-admin/features",
            200,
            headers=headers
        )
        
        if success and isinstance(response, list):
            # Check for expected feature categories
            categories = set(feature.get('category') for feature in response)
            expected_categories = {'crm', 'scheduling', 'shared'}
            if expected_categories.issubset(categories):
                self.log_test("Feature Categories Check", True, f"Found categories: {categories}")
            else:
                self.log_test("Feature Categories Check", False, f"Missing categories. Found: {categories}")
        
        return success

    def run_all_tests(self):
        """Run all tests in sequence"""
        print("🚀 Starting AgentCRM API Tests...")
        print(f"Testing against: {self.base_url}")
        print("=" * 60)

        # Test sequence
        tests = [
            ("Public API", self.test_public_business_types),
            ("Super Admin Auth", self.test_super_admin_login),
            ("Super Admin Dashboard", self.test_super_admin_dashboard),
            ("Business Types Management", self.test_super_admin_business_types),
            ("Companies Management", self.test_super_admin_companies),
            ("All Features Endpoint", self.test_all_features_endpoint),
            ("Company Creation", self.test_create_company),
            ("Company Admin Auth", self.test_company_admin_login),
            ("CRM Admin Auth", self.test_crm_admin_login),
            ("WhatsApp Connections API", self.test_whatsapp_connections),
            ("Public Booking APIs", self.test_public_booking_apis),
            ("Reports APIs", self.test_reports_apis),
            ("Notifications APIs", self.test_notifications_apis),
        ]

        for test_name, test_func in tests:
            print(f"\n📋 Testing {test_name}...")
            try:
                test_func()
            except Exception as e:
                self.log_test(f"{test_name} (Exception)", False, str(e))

        # Print summary
        print("\n" + "=" * 60)
        print(f"📊 Test Summary: {self.tests_passed}/{self.tests_run} tests passed")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All tests passed!")
            return 0
        else:
            print("❌ Some tests failed. Check the details above.")
            return 1

def main():
    tester = AgentCRMAPITester()
    return tester.run_all_tests()

if __name__ == "__main__":
    sys.exit(main())