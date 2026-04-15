import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { publicAPI } from '../../services/api';
import {
  ArrowRight, CheckCircle, Scissors, Stethoscope, Headphones,
  LayoutGrid, Settings, Sparkles, Calendar, MessageSquare, Zap
} from 'lucide-react';

const LandingPage = () => {
  const [businessTypes, setBusinessTypes] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    publicAPI.getBusinessTypes().then(res => setBusinessTypes(res.data)).catch(() => {});
  }, []);

  const iconMap = {
    Scissors, Stethoscope, Headphones, LayoutGrid, Settings
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Navbar */}
      <nav className="glass border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold font-heading text-slate-900 tracking-tight">
            Agent<span className="text-primary">CRM</span>
          </h1>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/login')} data-testid="landing-login-btn" className="btn-secondary text-sm">
              Entrar
            </button>
            <button onClick={() => navigate('/register')} data-testid="landing-register-btn" className="btn-primary text-sm flex items-center gap-2">
              Comecar agora <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary mb-4">
            CRM + Agendamento
          </p>
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold font-heading tracking-tight text-slate-900 leading-tight">
            Gerencie seus clientes e agendamentos em um so lugar
          </h2>
          <p className="mt-6 text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
            Sistema completo de CRM e agendamento para saloes, clinicas, e qualquer negocio
            que precisa de atendimento profissional com conexao WhatsApp.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <button onClick={() => navigate('/register')} data-testid="hero-cta-btn"
              className="btn-primary text-lg px-8 py-3 flex items-center gap-2">
              Experimente Gratis <ArrowRight className="w-5 h-5" />
            </button>
            <button onClick={() => document.getElementById('plans').scrollIntoView({ behavior: 'smooth' })}
              className="btn-secondary text-lg px-8 py-3">
              Ver Planos
            </button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-slate-50 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary mb-3">Funcionalidades</p>
            <h3 className="text-3xl sm:text-4xl font-bold font-heading tracking-tight text-slate-900">
              Tudo que voce precisa
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <FeatureCard icon={<MessageSquare />} title="CRM Completo" description="Kanban, tickets, atendimento multicanal, chat interno, campanhas e muito mais." />
            <FeatureCard icon={<Calendar />} title="Agendamento Online" description="Pagina personalizavel, calendarios, profissionais, servicos e produtos." />
            <FeatureCard icon={<Zap />} title="WhatsApp Integrado" description="Conecte seu WhatsApp para receber e enviar mensagens diretamente pelo sistema." />
            <FeatureCard icon={<Sparkles />} title="Agente de IA" description="Assistente inteligente para ajudar seus atendentes com respostas automaticas." />
            <FeatureCard icon={<LayoutGrid />} title="Flowbuilder Visual" description="Crie fluxos de automacao visuais para seus atendimentos e campanhas." />
            <FeatureCard icon={<Settings />} title="Personalizavel" description="Cada empresa configura suas cores, logo, funcionalidades e pagina publica." />
          </div>
        </div>
      </section>

      {/* Business Types / Plans */}
      <section id="plans" className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary mb-3">Escolha seu plano</p>
            <h3 className="text-3xl sm:text-4xl font-bold font-heading tracking-tight text-slate-900">
              Qual tipo de negocio voce tem?
            </h3>
            <p className="mt-4 text-slate-600">Selecione o tipo que mais se adequa ao seu negocio ou escolha personalizado</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {businessTypes.map(bt => {
              const Icon = iconMap[bt.icon] || LayoutGrid;
              return (
                <div key={bt.id} className="card hover:shadow-xl hover:-translate-y-2 transition-all duration-300 cursor-pointer group"
                  onClick={() => navigate(`/register?type=${bt.id}`)}
                  data-testid={`plan-card-${bt.id}`}>
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-4 group-hover:bg-primary group-hover:text-white transition-colors">
                    <Icon className="w-7 h-7" />
                  </div>
                  <h4 className="text-xl font-bold font-heading text-slate-900 mb-2">{bt.name}</h4>
                  <p className="text-sm text-slate-600 mb-4">{bt.description}</p>
                  <div className="flex items-center gap-2 mb-4">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                      bt.base_type === 'both' ? 'bg-violet-100 text-violet-700' :
                      bt.base_type === 'crm' ? 'bg-indigo-100 text-indigo-700' :
                      'bg-teal-100 text-teal-700'
                    }`}>
                      {bt.base_type === 'both' ? 'CRM + Agendamento' : bt.base_type === 'crm' ? 'CRM' : 'Agendamento'}
                    </span>
                  </div>
                  <button className="w-full btn-primary flex items-center justify-center gap-2 text-sm">
                    Comecar <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
            {/* Custom Option */}
            <div className="card hover:shadow-xl hover:-translate-y-2 transition-all duration-300 cursor-pointer group border-2 border-dashed border-slate-300"
              onClick={() => navigate('/register?type=custom')}
              data-testid="plan-card-custom">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-500 mb-4 group-hover:bg-primary group-hover:text-white transition-colors">
                <Settings className="w-7 h-7" />
              </div>
              <h4 className="text-xl font-bold font-heading text-slate-900 mb-2">Personalizado</h4>
              <p className="text-sm text-slate-600 mb-4">
                Precisa de algo diferente? Cadastre-se e nosso time configurara um setup especifico para voce.
              </p>
              <button className="w-full btn-secondary flex items-center justify-center gap-2 text-sm">
                Solicitar <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-white py-12 px-6">
        <div className="max-w-6xl mx-auto text-center">
          <h2 className="text-2xl font-bold font-heading mb-2">AgentCRM</h2>
          <p className="text-slate-400 text-sm">Sistema de CRM e Agendamento - Todos os direitos reservados</p>
        </div>
      </footer>
    </div>
  );
};

const FeatureCard = ({ icon, title, description }) => (
  <div className="card hover:shadow-lg transition-all group">
    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary mb-4 group-hover:bg-primary group-hover:text-white transition-colors">
      {React.cloneElement(icon, { className: 'w-6 h-6' })}
    </div>
    <h4 className="text-lg font-semibold font-heading text-slate-900 mb-2">{title}</h4>
    <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
  </div>
);

export default LandingPage;
