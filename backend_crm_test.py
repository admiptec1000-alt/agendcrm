import requests
import sys
import json
from datetime import datetime

class CRMAtendimentosAPITester:
    def __init__(self, base_url="https://agentcrm-book.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []
        self.created_ticket_id = None

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

    def test_crm_login(self):
        """Test CRM company login"""
        success, response = self.run_test(
            "CRM Company Login",
            "POST",
            "auth/login",
            200,
            data={"email": "joao@crm.com", "password": "senha123"}
        )
        if success and 'access_token' in response:
            self.token = response['access_token']
            return True
        return False

    def test_get_ticket_counts(self):
        """Test GET /api/crm/tickets/counts"""
        if not self.token:
            self.log_test("Get Ticket Counts", False, "No auth token")
            return False

        headers = {"Authorization": f"Bearer {self.token}"}
        success, response = self.run_test(
            "Get Ticket Counts",
            "GET",
            "crm/tickets/counts",
            200,
            headers=headers
        )
        
        if success:
            required_fields = ['atendendo', 'aguardando', 'total']
            missing_fields = [field for field in required_fields if field not in response]
            if missing_fields:
                self.log_test("Ticket Counts Fields Check", False, f"Missing fields: {missing_fields}")
                return False
            else:
                self.log_test("Ticket Counts Fields Check", True, f"atendendo: {response['atendendo']}, aguardando: {response['aguardando']}")
        
        return success

    def test_get_tickets_atendendo(self):
        """Test GET /api/crm/tickets?tab=atendendo"""
        if not self.token:
            self.log_test("Get Tickets Atendendo", False, "No auth token")
            return False

        headers = {"Authorization": f"Bearer {self.token}"}
        success, response = self.run_test(
            "Get Tickets Atendendo",
            "GET",
            "crm/tickets?tab=atendendo",
            200,
            headers=headers
        )
        
        if success and isinstance(response, list):
            self.log_test("Tickets Atendendo Response Check", True, f"Found {len(response)} tickets")
            
            # Check if tickets have required fields for UI
            if len(response) > 0:
                ticket = response[0]
                required_fields = ['id', 'customer_name', 'customer_phone', 'channel', 'status', 'updated_at']
                missing_fields = [field for field in required_fields if field not in ticket]
                if missing_fields:
                    self.log_test("Ticket Fields Check", False, f"Missing fields: {missing_fields}")
                else:
                    self.log_test("Ticket Fields Check", True)
        
        return success

    def test_get_tickets_aguardando(self):
        """Test GET /api/crm/tickets?tab=aguardando"""
        if not self.token:
            self.log_test("Get Tickets Aguardando", False, "No auth token")
            return False

        headers = {"Authorization": f"Bearer {self.token}"}
        success, response = self.run_test(
            "Get Tickets Aguardando",
            "GET",
            "crm/tickets?tab=aguardando",
            200,
            headers=headers
        )
        
        if success and isinstance(response, list):
            self.log_test("Tickets Aguardando Response Check", True, f"Found {len(response)} tickets")
        
        return success

    def test_get_tickets_with_channel_filter(self):
        """Test GET /api/crm/tickets?channel=whatsapp"""
        if not self.token:
            self.log_test("Get Tickets Channel Filter", False, "No auth token")
            return False

        headers = {"Authorization": f"Bearer {self.token}"}
        success, response = self.run_test(
            "Get Tickets Channel Filter",
            "GET",
            "crm/tickets?channel=whatsapp",
            200,
            headers=headers
        )
        
        if success and isinstance(response, list):
            self.log_test("Channel Filter Response Check", True, f"Found {len(response)} WhatsApp tickets")
        
        return success

    def test_get_tickets_with_search(self):
        """Test GET /api/crm/tickets?search=test"""
        if not self.token:
            self.log_test("Get Tickets Search", False, "No auth token")
            return False

        headers = {"Authorization": f"Bearer {self.token}"}
        success, response = self.run_test(
            "Get Tickets Search",
            "GET",
            "crm/tickets?search=test",
            200,
            headers=headers
        )
        
        if success and isinstance(response, list):
            self.log_test("Search Response Check", True, f"Found {len(response)} tickets matching 'test'")
        
        return success

    def test_create_ticket(self):
        """Test POST /api/crm/tickets"""
        if not self.token:
            self.log_test("Create Ticket", False, "No auth token")
            return False

        headers = {"Authorization": f"Bearer {self.token}"}
        
        ticket_data = {
            "customer_name": f"Test Customer {datetime.now().strftime('%H%M%S')}",
            "customer_phone": "+55 11 99999-9999",
            "customer_email": "test@example.com",
            "description": "Test ticket for Atendimentos page",
            "priority": "medium",
            "channel": "whatsapp",
            "status": "aberto"
        }
        
        success, response = self.run_test(
            "Create Ticket",
            "POST",
            "crm/tickets",
            200,
            data=ticket_data,
            headers=headers
        )
        
        if success and 'id' in response:
            self.created_ticket_id = response['id']
            self.log_test("Ticket Creation Response Check", True, f"Ticket ID: {response['id']}")
        
        return success

    def test_add_message_to_ticket(self):
        """Test POST /api/crm/tickets/{id}/messages"""
        if not self.token or not self.created_ticket_id:
            self.log_test("Add Message to Ticket", False, "No auth token or ticket ID")
            return False

        headers = {"Authorization": f"Bearer {self.token}"}
        
        message_data = {
            "content": "Test message from agent",
            "sender_type": "agent"
        }
        
        success, response = self.run_test(
            "Add Message to Ticket",
            "POST",
            f"crm/tickets/{self.created_ticket_id}/messages",
            200,
            data=message_data,
            headers=headers
        )
        
        if success and 'id' in response:
            self.log_test("Message Creation Response Check", True, f"Message ID: {response['id']}")
        
        return success

    def test_get_ticket_with_messages(self):
        """Test that ticket now has messages after adding one"""
        if not self.token:
            self.log_test("Get Ticket with Messages", False, "No auth token")
            return False

        headers = {"Authorization": f"Bearer {self.token}"}
        success, response = self.run_test(
            "Get Tickets with Messages",
            "GET",
            "crm/tickets",
            200,
            headers=headers
        )
        
        if success and isinstance(response, list):
            # Find our created ticket
            created_ticket = None
            for ticket in response:
                if ticket.get('id') == self.created_ticket_id:
                    created_ticket = ticket
                    break
            
            if created_ticket:
                if 'messages' in created_ticket and len(created_ticket['messages']) > 0:
                    self.log_test("Ticket Messages Check", True, f"Found {len(created_ticket['messages'])} messages")
                else:
                    self.log_test("Ticket Messages Check", False, "No messages found in ticket")
            else:
                self.log_test("Find Created Ticket", False, "Could not find created ticket")
        
        return success

    def run_all_tests(self):
        """Run all CRM Atendimentos tests"""
        print("🚀 Starting CRM Atendimentos API Tests...")
        print(f"Testing against: {self.base_url}")
        print("=" * 60)

        # Test sequence
        tests = [
            ("CRM Login", self.test_crm_login),
            ("Get Ticket Counts", self.test_get_ticket_counts),
            ("Get Tickets Atendendo", self.test_get_tickets_atendendo),
            ("Get Tickets Aguardando", self.test_get_tickets_aguardando),
            ("Channel Filter", self.test_get_tickets_with_channel_filter),
            ("Search Filter", self.test_get_tickets_with_search),
            ("Create Ticket", self.test_create_ticket),
            ("Add Message", self.test_add_message_to_ticket),
            ("Verify Messages", self.test_get_ticket_with_messages),
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
            print("🎉 All CRM tests passed!")
            return 0
        else:
            print("❌ Some CRM tests failed. Check the details above.")
            return 1

def main():
    tester = CRMAtendimentosAPITester()
    return tester.run_all_tests()

if __name__ == "__main__":
    sys.exit(main())