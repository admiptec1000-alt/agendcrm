# PRD - AgentCRM & Booking System

## Current State
- Super Admin: admin@agentcrm.com / admin123 → /admin-login
- Boss Company: admin@boss.com.br / boss123 → /boss/login → /boss/painel

## Implemented Features

### Multi-tenant Core
- JWT Auth, PWA dinâmico (manifest+favicon por empresa)
- Super Admin: Companies, Business Types, Subdomain
- Logo global em header/sidebar/site público/TV/PWA

### CRM
- Atendimentos, FlowBuilder, Kanban, AI Agent (GPT-5.2)
- **WhatsApp Baileys** microserviço externo (Render) com keep-alive + auto-rehydrate
- Badge visual de health do serviço (online/offline)
- Message Templates (6 processos)
- Chat Interno

### Agendamento
- **Agenda**: lista com filtros; Editar (data/hora/serviço/items extras/valor com permissão); Concluir com valor final e forma pagamento
- **Calendário**: Mês/Semana/Dia
- **Financeiro**: filtros dinâmicos
- **Suspensão** por dias OU horas (hour-window só bloqueia o intervalo correto)
- **Clientes**: accordion inline, form modernizado com avatar, máscara BR, data de nascimento, chip 🎂 aniversário próximo, auto-book ao criar
- **Usuários + Perfis de Acesso**: 31 permissões agrupadas

### 🆕 Planos & Assinaturas (iter 23)
- **CRUD de Planos**: nome, preço, ciclo em dias, total de créditos, items [{service_id, credits_per_use}]
- **Assinaturas**: vinculadas a plano, end_date calculada, barra de progresso de créditos, status active/expired/cancelled
- **Booking público**: identifica assinante por telefone, mostra banner (verde ativa / amarela vencida), toggle "usar créditos" no resumo, valor=0 quando usar créditos
- **Consumo inteligente**: abate `credits_per_use` do serviço; auto-expire quando chega a 0
- **Auto-confirmação**: ao criar agendamento (público ou admin), envia WhatsApp para cliente E profissional e tageia como `confirmado` se mensagem despachada
- **Mensagem inclui** `{{link_cancelar}}` → direciona ao `/slug/agenda?phone=X`

### Permissões granulares
- edit_appointment, edit_appointment_price
- Non-admin filtra automaticamente por profissional vinculado (fail-closed)

## Architecture
- FastAPI backend (port 8001)
- React frontend (port 3000)
- **WhatsApp Baileys** externo no Render (agendcrm.onrender.com)
- MongoDB + supervisor

## Recent Changes (Feb 2026 - iter 23)
- [x] Backend: SubscriptionPlan com items[], cycle_days, total_credits
- [x] Backend: ClientSubscription com end_date, credits_total/used/remaining, status lazy via _calc_sub_status
- [x] Backend: endpoint público /booking/{slug}/subscription
- [x] Backend: booking público aceita use_subscription, abate créditos
- [x] Backend: notifications.py — módulo que envia WhatsApp client+prof com template confirmacao
- [x] Backend: create_appointment (admin+public) auto-envia WhatsApp e tagga confirmado
- [x] Frontend: PlanosPage + PlanoModal CRUD completo
- [x] Frontend: SubscriptionsPage redesenhada com cards e progress bar
- [x] Frontend: Booking público com subscription-banner + use-credits-toggle
- [x] Frontend: Modais com font-page-title (Space Grotesk 300)
- [x] Frontend: Label "Telefone / WhatsApp" alinhada com "Data de Nascimento"

## Recent Changes (Feb 2026 - iter 24)
- [x] **PWA "Add to Home Screen" (iOS)**: script inline em index.html roda ANTES do React mount, detecta slug da URL, atualiza `<title>`, `apple-mobile-web-app-title`, `apple-touch-icon`, `theme-color` e troca `<link rel="manifest">` para `/api/public/manifest/:slug` (same-origin). Resultado: iOS "Adicionar à Tela de Início" agora mostra o nome e URL corretos da empresa.
- [x] Manifest endpoint prioriza `page.title` > `company.name`; gera ícones em múltiplos tamanhos (96/152/180/192/512 + maskable) quando logo_url existe.
- [x] Hook `useCompanyBranding` usa URL relativa para manifest (evita CORS), atualiza todos os apple-touch-icon variants.
- [x] Service Worker `CACHE_NAME` bumpado para `agentcrm-v2` para invalidar index.html antigo em usuários existentes.
- [x] **Domínio**: CORS ampliado para `https://agentcrm.8ip.com.br` (novo domínio de produção).
- [x] **Landing Page**: atalho discreto "Administracao" no rodapé -> /admin-login.

## Recent Changes (Feb 2026 - iter 25)
- [x] **Agenda — novo layout**: 4 cards de métricas no topo (Total Geral / Hoje / Concluidos / Taxa Conclusao %) com ícones coloridos; barra de filtros avançados (busca por cliente/servico/profissional, status dropdown, profissional dropdown, data inicial + final) com botão "Limpar filtros"; pills de filtro rápido mantidas (Hoje/Pendentes/Confirmados/Concluidos/Todos) com contador.
- [x] **WhatsApp — não enviava mensagem após agendamento**: fix em `notifications.py`. Causa 1: template salvo com `{var}` (chave única) mas o renderer só trocava `{{var}}` (duplas). Agora o `render_template` aceita ambas as sintaxes + mapa de aliases (`nome`→`nome_cliente`, `profissional`→`nome_profissional`, etc.). Causa 2: antes o backend tentava enviar mesmo com a conexão marcada como `disconnected` no Baileys; agora valida status no microserviço antes e loga claramente quando pula.

## Backlog
### P1
- [ ] Extrair lógica de consumo de créditos duplicada (scheduling + public) para helper
- [ ] Unit test / ESLint no-undef CI gate para pegar ReferenceError em runtime
- [ ] Refatorar Dashboard.js (>3300 linhas) e SchedulingPages.js (>1200 linhas)
- [ ] **Guia ao cliente**: ícone no atalho só aparece se empresa fizer upload em Config > Personalização (logo_url vazia → logo padrão)
### P2
- [ ] Stripe integration
- [ ] Notificações push
- [ ] Relatórios gráficos
- [ ] Campanha de aniversário automática (varre clients com birth_date=hoje)
- [ ] Shadcn Calendar no lugar dos HTML5 date
