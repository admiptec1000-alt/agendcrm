import axios from 'axios';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Add token to requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle response errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Don't redirect on login endpoints - let the component handle the error
      const url = error.config?.url || '';
      if (!url.includes('/auth/login') && !url.includes('/auth/super-admin/login')) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        // Redirect to the company login based on current URL
        const slug = window.location.pathname.split('/')[1];
        if (slug && slug !== 'super-admin' && slug !== 'admin-login' && slug !== 'landing') {
          window.location.href = `/${slug}/login`;
        } else if (window.location.pathname.includes('super-admin')) {
          window.location.href = '/admin-login';
        } else {
          window.location.href = '/landing';
        }
      }
    }
    return Promise.reject(error);
  }
);

export default api;

// Auth API
export const authAPI = {
  login: (credentials) => api.post('/auth/login', credentials),
  superAdminLogin: (credentials) => api.post('/auth/super-admin/login', credentials),
  register: (data) => api.post('/auth/register', data),
  getCurrentUser: () => api.get('/auth/me')
};

// Super Admin API
export const superAdminAPI = {
  getDashboard: () => api.get('/super-admin/dashboard'),
  getCompanies: (params) => api.get('/super-admin/companies', { params }),
  createCompany: (data) => api.post('/super-admin/companies', data),
  updateCompany: (id, data) => api.put(`/super-admin/companies/${id}`, data),
  updateCompanyFeatures: (id, features) => api.put(`/super-admin/companies/${id}/features`, features),
  resyncCompanyFeatures: (id) => api.post(`/super-admin/companies/${id}/resync-features`),
  deleteCompany: (id) => api.delete(`/super-admin/companies/${id}`),
  getBusinessTypes: () => api.get('/super-admin/business-types'),
  getBusinessType: (id) => api.get(`/super-admin/business-types/${id}`),
  createBusinessType: (data) => api.post('/super-admin/business-types', data),
  updateBusinessType: (id, data) => api.put(`/super-admin/business-types/${id}`, data),
  deleteBusinessType: (id) => api.delete(`/super-admin/business-types/${id}`),
  getAllFeatures: () => api.get('/super-admin/features'),
  // Indoor management
  getGlobalIndoor: () => api.get('/super-admin/indoor-global'),
  updateGlobalIndoor: (data) => api.put('/super-admin/indoor-global', data),
  getCompanyIndoor: (companyId) => api.get(`/super-admin/companies/${companyId}/indoor`),
  updateCompanyIndoor: (companyId, data) => api.put(`/super-admin/companies/${companyId}/indoor`, data)
};

// CRM API
export const crmAPI = {
  // Tickets
  getTickets: (params) => api.get('/crm/tickets', { params }),
  getTicket: (id) => api.get(`/crm/tickets/${id}`),
  getTicketCounts: () => api.get('/crm/tickets/counts'),
  createTicket: (data) => api.post('/crm/tickets', data),
  updateTicket: (id, data) => api.put(`/crm/tickets/${id}`, data),
  deleteTicket: (id) => api.delete(`/crm/tickets/${id}`),
  addMessage: (ticketId, data) => api.post(`/crm/tickets/${ticketId}/messages`, data),
  addTicketTag: (ticketId, tag) => api.post(`/crm/tickets/${ticketId}/tags/add`, { tag }),
  removeTicketTag: (ticketId, tag) => api.post(`/crm/tickets/${ticketId}/tags/remove`, { tag }),
  // Kanban
  getKanban: () => api.get('/crm/kanban'),
  getKanbanV2: () => api.get('/crm/kanban-v2'),
  listKanbanColumns: () => api.get('/crm/kanban-columns'),
  createKanbanColumn: (data) => api.post('/crm/kanban-columns', data),
  updateKanbanColumn: (id, data) => api.put(`/crm/kanban-columns/${id}`, data),
  deleteKanbanColumn: (id) => api.delete(`/crm/kanban-columns/${id}`),
  moveTicketColumn: (ticketId, columnId) => api.put(`/crm/tickets/${ticketId}/kanban-column`, { column_id: columnId }),
  // AI chat (legacy)
  aiChat: (data) => api.post('/crm/ai/chat', data),
  // Quick Responses + Campaigns
  getQuickResponses: () => api.get('/crm/quick-responses'),
  createQuickResponse: (data) => api.post('/crm/quick-responses', data),
  getCampaigns: () => api.get('/crm/campaigns'),
  createCampaign: (data) => api.post('/crm/campaigns', data),
  // Flows
  getFlows: () => api.get('/crm/flows'),
  listFlows: () => api.get('/crm/flows'),
  createFlow: (data) => api.post('/crm/flows', data),
  updateFlow: (id, data) => api.put(`/crm/flows/${id}`, data),
  deleteFlow: (id) => api.delete(`/crm/flows/${id}`),
  // Tags
  listTags: () => api.get('/crm/tags'),
  createTag: (data) => api.post('/crm/tags', data),
  updateTag: (id, data) => api.put(`/crm/tags/${id}`, data),
  deleteTag: (id) => api.delete(`/crm/tags/${id}`),
  // Queues
  listQueues: () => api.get('/crm/queues'),
  createQueue: (data) => api.post('/crm/queues', data),
  updateQueue: (id, data) => api.put(`/crm/queues/${id}`, data),
  deleteQueue: (id) => api.delete(`/crm/queues/${id}`),
  // Contact Lists
  listContactLists: () => api.get('/crm/contact-lists'),
  createContactList: (data) => api.post('/crm/contact-lists', data),
  updateContactList: (id, data) => api.put(`/crm/contact-lists/${id}`, data),
  deleteContactList: (id) => api.delete(`/crm/contact-lists/${id}`),
  // Campaigns extended
  updateCampaign: (id, data) => api.put(`/crm/campaigns/${id}`, data),
  deleteCampaign: (id) => api.delete(`/crm/campaigns/${id}`),
  previewCampaignAudience: (id) => api.post(`/crm/campaigns/${id}/preview-audience`),
  runCampaign: (id) => api.post(`/crm/campaigns/${id}/run`),
  // Retry
  retryMessage: (ticketId, messageId) => api.post(`/crm/tickets/${ticketId}/messages/${messageId}/retry`),
};

// Scheduling API
export const schedulingAPI = {
  getAppointments: (params) => api.get('/scheduling/appointments', { params }),
  createAppointment: (data) => api.post('/scheduling/appointments', data),
  updateAppointment: (id, data) => api.put(`/scheduling/appointments/${id}`, data),
  deleteAppointment: (id) => api.delete(`/scheduling/appointments/${id}`),
  getCalendar: (params) => api.get('/scheduling/calendar', { params }),
  getServices: (params) => api.get('/scheduling/services', { params }),
  createService: (data) => api.post('/scheduling/services', data),
  updateService: (id, data) => api.put(`/scheduling/services/${id}`, data),
  deleteService: (id) => api.delete(`/scheduling/services/${id}`),
  getProfessionals: (params) => api.get('/scheduling/professionals', { params }),
  getProfessionalsStats: () => api.get('/scheduling/professionals/stats'),
  createProfessional: (data) => api.post('/scheduling/professionals', data),
  updateProfessional: (id, data) => api.put(`/scheduling/professionals/${id}`, data),
  deleteProfessional: (id) => api.delete(`/scheduling/professionals/${id}`),
  addSuspension: (profId, data) => api.post(`/scheduling/professionals/${profId}/suspensions`, data),
  removeSuspension: (profId, susId) => api.delete(`/scheduling/professionals/${profId}/suspensions/${susId}`),
  getCategories: () => api.get('/scheduling/categories'),
  createCategory: (data) => api.post('/scheduling/categories', data),
  updateCategory: (id, data) => api.put(`/scheduling/categories/${id}`, data),
  deleteCategory: (id) => api.delete(`/scheduling/categories/${id}`),
  getClients: (params) => api.get('/scheduling/clients', { params }),
  createClient: (data) => api.post('/scheduling/clients', data),
  lookupClient: (phone) => api.get(`/scheduling/clients/lookup/${phone}`),
  lookupClientSubscription: (phone) => api.get('/scheduling/client-subscription-lookup', { params: { phone } }),
  getSubscriptionPlans: () => api.get('/scheduling/subscription-plans'),
  createSubscriptionPlan: (data) => api.post('/scheduling/subscription-plans', data),
  updateSubscriptionPlan: (id, data) => api.put(`/scheduling/subscription-plans/${id}`, data),
  deleteSubscriptionPlan: (id) => api.delete(`/scheduling/subscription-plans/${id}`),
  getSubscriptions: () => api.get('/scheduling/subscriptions'),
  createSubscription: (data) => api.post('/scheduling/subscriptions', data),
  cancelSubscription: (id) => api.delete(`/scheduling/subscriptions/${id}`),
  getBookingPage: () => api.get('/scheduling/booking-page'),
  updateBookingPage: (data) => api.put('/scheduling/booking-page', data),
  getBusinessHours: () => api.get('/scheduling/business-hours'),
  updateBusinessHours: (hours) => api.put('/scheduling/business-hours', { hours }),
  getIndoorSettings: () => api.get('/scheduling/indoor'),
  updateIndoorSettings: (data) => api.put('/scheduling/indoor', data),
  getSmartAvailability: (params) => api.get('/scheduling/smart-availability', { params }),
  getOnboardingStatus: () => api.get('/scheduling/onboarding-status'),
  completeOnboarding: () => api.post('/scheduling/onboarding-complete'),
  concludeAppointment: (id, data) => api.put(`/scheduling/appointments/${id}/conclude`, data),
  sendAppointmentReminder: (id) => api.post(`/scheduling/appointments/${id}/send-reminder`),
  getFinancialTransactions: (params) => api.get('/scheduling/financial/transactions', { params }),
  createFinancialTransaction: (data) => api.post('/scheduling/financial/transactions', data),
  updateFinancialTransaction: (id, data) => api.put(`/scheduling/financial/transactions/${id}`, data),
  payFinancialTransaction: (id) => api.post(`/scheduling/financial/transactions/${id}/pay`),
  deleteFinancialTransaction: (id) => api.delete(`/scheduling/financial/transactions/${id}`),
  getFinancialSummary: (params) => api.get('/scheduling/financial/summary', { params }),
  getPaymentFees: () => api.get('/scheduling/financial/payment-fees'),
  updatePaymentFees: (data) => api.put('/scheduling/financial/payment-fees', data),
  getPermissionProfiles: () => api.get('/scheduling/permission-profiles'),
  createPermissionProfile: (data) => api.post('/scheduling/permission-profiles', data),
  updatePermissionProfile: (id, data) => api.put(`/scheduling/permission-profiles/${id}`, data),
  deletePermissionProfile: (id) => api.delete(`/scheduling/permission-profiles/${id}`),
  updateClient: (id, data) => api.put(`/scheduling/clients/${id}`, data),
  deleteClient: (id) => api.delete(`/scheduling/clients/${id}`),
  getCompanyUsers: () => api.get('/scheduling/company-users'),
  createCompanyUser: (data) => api.post('/scheduling/company-users', data),
  updateCompanyUser: (id, data) => api.put(`/scheduling/company-users/${id}`, data),
  deleteCompanyUser: (id) => api.delete(`/scheduling/company-users/${id}`),
  getAllFeatures: () => api.get('/scheduling/all-features'),
};

// Public API
export const publicAPI = {
  getBookingPage: (slug) => axios.get(`${API_URL}/public/booking/${slug}`),
  getServices: (slug, params) => axios.get(`${API_URL}/public/booking/${slug}/services`, { params }),
  getProfessionals: (slug, params) => axios.get(`${API_URL}/public/booking/${slug}/professionals`, { params }),
  getAvailability: (slug, params) => axios.get(`${API_URL}/public/booking/${slug}/availability`, { params }),
  createBooking: (slug, data) => axios.post(`${API_URL}/public/booking/${slug}/book`, data),
  getBusinessTypes: () => axios.get(`${API_URL}/auth/business-types`),
  lookupClient: (slug, phone) => axios.get(`${API_URL}/public/booking/${slug}/client-lookup/${phone}`),
  getIndoorDisplay: (slug) => axios.get(`${API_URL}/public/indoor/${slug}`),
  getMyAppointments: (slug, phone) => axios.get(`${API_URL}/public/booking/${slug}/my-appointments/${phone}`),
  getSubscription: (slug, phone) => axios.get(`${API_URL}/public/booking/${slug}/subscription`, { params: { phone } }),
  cancelMyAppointment: (slug, appointmentId) => axios.put(`${API_URL}/public/booking/${slug}/my-appointments/${appointmentId}/cancel`),
  confirmMyAppointment: (slug, appointmentId) => axios.put(`${API_URL}/public/booking/${slug}/my-appointments/${appointmentId}/confirm`),
};

// WhatsApp API
export const whatsappAPI = {
  getConnections: () => api.get('/whatsapp/connections'),
  getConnectionStats: () => api.get('/whatsapp/connections/stats'),
  createConnection: (data) => api.post('/whatsapp/connections', data),
  updateConnection: (id, data) => api.put(`/whatsapp/connections/${id}`, data),
  connectWhatsApp: (id) => api.post(`/whatsapp/connections/${id}/connect`),
  disconnectWhatsApp: (id) => api.post(`/whatsapp/connections/${id}/disconnect`),
  simulateConnected: (id) => api.post(`/whatsapp/connections/${id}/simulate-connected`),
  deleteConnection: (id) => api.delete(`/whatsapp/connections/${id}`)
};

// Channels API (Connections, Templates, Scheduled Messages, Chat)
export const channelsAPI = {
  getConnections: () => api.get('/channels/connections'),
  createConnection: (data) => api.post('/channels/connections', data),
  connectChannel: (id) => api.post(`/channels/connections/${id}/connect`),
  getConnectionQR: (id) => api.get(`/channels/connections/${id}/qr`),
  disconnectChannel: (id) => api.post(`/channels/connections/${id}/disconnect`),
  syncConnection: (id) => api.post(`/channels/connections/${id}/sync`),
  sendWhatsAppMessage: (connId, data) => api.post(`/channels/connections/${connId}/send`, data),
  deleteConnection: (id) => api.delete(`/channels/connections/${id}`),
  getTemplates: () => api.get('/channels/templates'),
  createTemplate: (data) => api.post('/channels/templates', data),
  updateTemplate: (id, data) => api.put(`/channels/templates/${id}`, data),
  getScheduledMessages: (params) => api.get('/channels/scheduled-messages', { params }),
  createScheduledMessage: (data) => api.post('/channels/scheduled-messages', data),
  updateScheduledMessage: (id, data) => api.put(`/channels/scheduled-messages/${id}`, data),
  deleteScheduledMessage: (id) => api.delete(`/channels/scheduled-messages/${id}`),
  remarketingPreview: (data) => api.post('/channels/remarketing/preview', data),
  remarketingBulkSend: (data) => api.post('/channels/remarketing/bulk-send', data),
  getChatChannels: () => api.get('/channels/chat/channels'),
  getChatMessages: (params) => api.get('/channels/chat/messages', { params }),
  sendChatMessage: (data) => api.post('/channels/chat/messages', data),
  getServiceHealth: () => api.get('/channels/service-health'),
  getWaContacts: (connId) => api.get(`/channels/connections/${connId}/wa-contacts`),
  importWaContacts: (connId, data) => api.post(`/channels/connections/${connId}/import-contacts`, data),
};

// Reports API
export const reportsAPI = {
  getCommissions: (params) => api.get('/reports/commissions', { params }),
  getFinancial: (params) => api.get('/reports/financial', { params }),
};

// Notifications API
export const notificationsAPI = {
  getSettings: () => api.get('/notifications/settings'),
  updateSettings: (data) => api.put('/notifications/settings', data),
  getHistory: () => api.get('/notifications/history'),
  sendTest: () => api.post('/notifications/send-test'),
};

// Upload API
export const uploadAPI = {
  uploadFile: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  uploadBookingImage: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/upload/booking-image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  deleteFile: (fileId) => api.delete(`/upload/files/${fileId}`)
};

// CRM additions moved into crmAPI above. AI Providers + Agents:
export const aiAPI = {
  listAgentTemplates: () => api.get('/ai/agent-templates'),
  // Providers
  listProviders: () => api.get('/ai/providers'),
  createProvider: (data) => api.post('/ai/providers', data),
  updateProvider: (id, data) => api.put(`/ai/providers/${id}`, data),
  deleteProvider: (id) => api.delete(`/ai/providers/${id}`),
  // Agents
  listAgents: () => api.get('/ai/agents'),
  getAgent: (id) => api.get(`/ai/agents/${id}`),
  createAgent: (data) => api.post('/ai/agents', data),
  updateAgent: (id, data) => api.put(`/ai/agents/${id}`, data),
  deleteAgent: (id) => api.delete(`/ai/agents/${id}`),
  testAgent: (id, data) => api.post(`/ai/agents/${id}/test`, data),
};

