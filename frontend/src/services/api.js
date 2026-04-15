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
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
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
  deleteCompany: (id) => api.delete(`/super-admin/companies/${id}`),
  getBusinessTypes: () => api.get('/super-admin/business-types'),
  getBusinessType: (id) => api.get(`/super-admin/business-types/${id}`),
  createBusinessType: (data) => api.post('/super-admin/business-types', data),
  updateBusinessType: (id, data) => api.put(`/super-admin/business-types/${id}`, data),
  deleteBusinessType: (id) => api.delete(`/super-admin/business-types/${id}`),
  getAllFeatures: () => api.get('/super-admin/features')
};

// CRM API
export const crmAPI = {
  getTickets: (params) => api.get('/crm/tickets', { params }),
  createTicket: (data) => api.post('/crm/tickets', data),
  updateTicket: (id, data) => api.put(`/crm/tickets/${id}`, data),
  deleteTicket: (id) => api.delete(`/crm/tickets/${id}`),
  addMessage: (ticketId, data) => api.post(`/crm/tickets/${ticketId}/messages`, data),
  getKanban: () => api.get('/crm/kanban'),
  aiChat: (data) => api.post('/crm/ai/chat', data),
  getQuickResponses: () => api.get('/crm/quick-responses'),
  createQuickResponse: (data) => api.post('/crm/quick-responses', data),
  getCampaigns: () => api.get('/crm/campaigns'),
  createCampaign: (data) => api.post('/crm/campaigns', data),
  getFlows: () => api.get('/crm/flows'),
  createFlow: (data) => api.post('/crm/flows', data),
  updateFlow: (id, data) => api.put(`/crm/flows/${id}`, data)
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
  getProfessionals: () => api.get('/scheduling/professionals'),
  createProfessional: (data) => api.post('/scheduling/professionals', data),
  updateProfessional: (id, data) => api.put(`/scheduling/professionals/${id}`, data),
  deleteProfessional: (id) => api.delete(`/scheduling/professionals/${id}`),
  getCategories: () => api.get('/scheduling/categories'),
  createCategory: (data) => api.post('/scheduling/categories', data),
  getBookingPage: () => api.get('/scheduling/booking-page'),
  updateBookingPage: (data) => api.put('/scheduling/booking-page', data),
  getOnboardingStatus: () => api.get('/scheduling/onboarding-status'),
  completeOnboarding: () => api.post('/scheduling/onboarding-complete'),
};

// Public API
export const publicAPI = {
  getBookingPage: (slug) => axios.get(`${API_URL}/public/booking/${slug}`),
  getServices: (slug, params) => axios.get(`${API_URL}/public/booking/${slug}/services`, { params }),
  getProfessionals: (slug, params) => axios.get(`${API_URL}/public/booking/${slug}/professionals`, { params }),
  getAvailability: (slug, params) => axios.get(`${API_URL}/public/booking/${slug}/availability`, { params }),
  createBooking: (slug, data) => axios.post(`${API_URL}/public/booking/${slug}/book`, data),
  getBusinessTypes: () => axios.get(`${API_URL}/auth/business-types`)
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
