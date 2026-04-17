import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { publicAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'sonner';
import { Lock, Mail } from 'lucide-react';

const CompanyLoginPage = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [companyData, setCompanyData] = useState(null);
  const [pageLoading, setPageLoading] = useState(true);

  const API_BASE = process.env.REACT_APP_BACKEND_URL;

  useEffect(() => {
    publicAPI.getBookingPage(slug)
      .then(res => setCompanyData(res.data))
      .catch(() => toast.error('Empresa nao encontrada'))
      .finally(() => setPageLoading(false));
  }, [slug]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const result = await login({ email, password }, false);
    if (result.success) {
      toast.success('Login realizado!');
      navigate(`/${slug}/painel`);
    } else {
      toast.error(result.error || 'Email ou senha incorretos');
    }
    setLoading(false);
  };

  if (pageLoading) {
    return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" /></div>;
  }

  const primaryColor = companyData?.page?.primary_color || '#4F46E5';
  const companyName = companyData?.company?.name || slug;
  const logoUrl = companyData?.page?.logo_url;

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: `linear-gradient(135deg, ${primaryColor}15 0%, white 50%, ${primaryColor}08 100%)` }}>
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-200">
          <div className="text-center mb-8">
            {logoUrl ? (
              <img src={`${API_BASE}${logoUrl}`} alt={companyName} className="h-16 w-16 rounded-xl object-cover mx-auto mb-3" />
            ) : (
              <div className="w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-3 text-white text-2xl font-bold" style={{ background: primaryColor }}>
                {companyName.charAt(0).toUpperCase()}
              </div>
            )}
            <h1 className="text-2xl font-bold font-heading text-slate-900">{companyName}</h1>
            <p className="text-sm text-slate-500 mt-1">Acesse sua conta</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="email" data-testid="company-login-email" value={email} onChange={e => setEmail(e.target.value)}
                  className="input-field pl-10" placeholder="seu@email.com" required />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Senha</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="password" data-testid="company-login-password" value={password} onChange={e => setPassword(e.target.value)}
                  className="input-field pl-10" placeholder="••••••••" required />
              </div>
            </div>
            <button type="submit" data-testid="company-login-submit" disabled={loading}
              className="w-full text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60"
              style={{ background: primaryColor }}>
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <a href={`/${slug}/agenda`} className="text-sm hover:underline" style={{ color: primaryColor }}>
              Agendar horario
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompanyLoginPage;
