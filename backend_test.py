import requests
import sys
import json
from datetime import datetime

class AgentCRMAPITester:
    def __init__(self, base_url="https://agentcrm-book.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.super_admin_token = None
        self.company_admin_token = None
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