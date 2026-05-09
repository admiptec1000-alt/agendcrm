import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { UserPlus, Mail, Lock, User, Building, Gift } from 'lucide-react';

const RegisterPage = () => {
  const [searchParams] = useSearchParams();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    company_name: '',
    plan_type: 'both',
    referred_by: '',
  });
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  // Capture ?ref= from URL or fall back to localStorage (set by /r/<code> bounce)
  useEffect(() => {
    const fromUrl = searchParams.get('ref');
    const stored = window.localStorage.getItem('agentcrm_ref');
    const code = (fromUrl || stored || '').trim().toUpperCase();
    if (code) {
      setFormData(prev => ({ ...prev, referred_by: code }));
      // Persist for cases where user opens register tab manually after the bounce
      try { window.localStorage.setItem('agentcrm_ref', code); } catch {}
    }
  }, [searchParams]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const result = await register(formData);

    if (result.success) {
      toast.success('Cadastro realizado com sucesso!');
      // Clear referral cookie now that conversion is recorded server-side
      try { window.localStorage.removeItem('agentcrm_ref'); } catch {}
      navigate('/');
    } else {
      toast.error(result.error || 'Erro ao fazer cadastro');
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 py-12">
      <div className="w-full max-w-md">
        <div className="glass rounded-2xl shadow-2xl p-8 border border-slate-200">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary mb-4">
              <UserPlus className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold font-heading tracking-tight text-slate-900">
              Criar Conta
            </h1>
            <p className="text-slate-600 mt-2">
              Comece a usar o AgentCRM hoje
            </p>
          </div>

          {/* Referral badge (visible only when ?ref= is present) */}
          {formData.referred_by && (
            <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200" data-testid="register-ref-badge">
              <Gift className="w-4 h-4 text-emerald-600" />
              <p className="text-xs text-emerald-800">
                Voce foi indicado pelo codigo <code className="font-mono font-bold">{formData.referred_by}</code>
              </p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Nome Completo
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  data-testid="register-name-input"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="input-field pl-10"
                  placeholder="João Silva"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Nome da Empresa
              </label>
              <div className="relative">
                <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  data-testid="register-company-input"
                  value={formData.company_name}
                  onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                  className="input-field pl-10"
                  placeholder="Minha Empresa"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="email"
                  data-testid="register-email-input"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="input-field pl-10"
                  placeholder="seu@email.com"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Senha
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="password"
                  data-testid="register-password-input"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="input-field pl-10"
                  placeholder="••••••••"
                  required
                  minLength={6}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Plano
              </label>
              <select
                data-testid="register-plan-select"
                value={formData.plan_type}
                onChange={(e) => setFormData({ ...formData, plan_type: e.target.value })}
                className="input-field"
              >
                <option value="both">CRM + Agendamento</option>
                <option value="crm">Apenas CRM</option>
                <option value="scheduling">Apenas Agendamento</option>
              </select>
            </div>

            <button
              type="submit"
              data-testid="register-submit-button"
              disabled={loading}
              className="btn-primary w-full"
            >
              {loading ? 'Criando conta...' : 'Criar Conta'}
            </button>
          </form>

          {/* Login Link */}
          <div className="mt-6 text-center">
            <p className="text-sm text-slate-600">
              Já tem uma conta?{' '}
              <Link to="/login" className="text-primary font-medium hover:underline">
                Fazer login
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
