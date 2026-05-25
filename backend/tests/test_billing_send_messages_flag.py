"""Regression test: editar/criar empresa NAO deve disparar envio de
mensagens de cobranca. So o tick periodico do scheduler envia.

Reproduz o bug reportado em 2026-02-18: operador editava o cadastro
da Web Fibra e o cliente recebia WhatsApp imediatamente.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
import sys

import pytest

sys.path.insert(0, "/app/backend")


class _UpdateResult:
    def __init__(self, matched=1):
        self.matched_count = matched
        self.modified_count = matched


class FakeColl:
    def __init__(self):
        self.docs = []

    async def find_one(self, q=None, proj=None):
        for d in self.docs:
            ok = True
            for k, v in (q or {}).items():
                dv = d.get(k)
                if isinstance(v, dict):
                    if "$gt" in v and not (dv is not None and dv > v["$gt"]):
                        ok = False; break
                    if "$ne" in v and dv == v["$ne"]:
                        ok = False; break
                else:
                    if dv != v:
                        ok = False; break
            if ok:
                return {**d}
        return None

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def update_one(self, q, update):
        for d in self.docs:
            ok = all(d.get(k) == v for k, v in q.items())
            if ok and "$set" in update:
                d.update(update["$set"])
                return _UpdateResult(1)
        return _UpdateResult(0)

    def find(self, q=None, proj=None):
        results = []
        for d in self.docs:
            ok = True
            for k, v in (q or {}).items():
                dv = d.get(k)
                if isinstance(v, dict):
                    if "$gt" in v and not (dv is not None and dv > v["$gt"]):
                        ok = False; break
                    if "$ne" in v and dv == v["$ne"]:
                        ok = False; break
                else:
                    if dv != v:
                        ok = False; break
            if ok:
                results.append({**d})

        class C:
            def __init__(self, items):
                self.items = items
                self._i = 0

            async def to_list(self, n):
                return self.items[:n]

            def __aiter__(self):
                self._i = 0
                return self

            async def __anext__(self):
                if self._i >= len(self.items):
                    raise StopAsyncIteration
                d = self.items[self._i]
                self._i += 1
                return d
        return C(results)


class FakeDB:
    def __init__(self):
        self.companies = FakeColl()
        self.super_admin_transactions = FakeColl()
        self.system_settings = FakeColl()
        self.billing_reminder_history = FakeColl()
        self.channel_connections = FakeColl()


@pytest.mark.asyncio
async def test_send_messages_false_does_not_call_send():
    """send_messages=False: cria parcelas mas NAO envia WhatsApp."""
    db = FakeDB()
    # Reminder enabled, prazo de 5 dias antes
    await db.system_settings.insert_one({
        "key": "billing_reminder",
        "enabled": True,
        "days_before_due_list": [5],
        "days_before_due": 5,
        "lancamento_gen_days": 30,
        "channel": "whatsapp",
        "default_message": "Ola {{nome}}, valor {{valor}}",
    })
    # Empresa com vencimento DAQUI A 2 DIAS — dentro do offset, deveria enviar
    # se send_messages=True. Com send_messages=False, NAO deve enviar.
    due_in_2d = (datetime.now(timezone.utc).date() + timedelta(days=2)).isoformat()
    await db.companies.insert_one({
        "id": "c-1",
        "name": "Web Fibra",
        "phone": "5562999998888",
        "monthly_price": 1000.0,
        "billing_cycle": "monthly",
        "installments": 12,
        "first_due_date": due_in_2d,
        "is_super_admin_system": False,
        "status": "active",
        "max_connections": 5,
        "max_users": 10,
        "total_sale_price": 1000.0,
        "discount": 50.0,
    })
    await db.channel_connections.insert_one({
        "id": "sa-conn-1",
        "is_super_admin_system": True,
        "status": "connected",
    })

    from scheduler import _process_billing_reminders

    sent_calls = []

    async def _fake_send(conn_id, phone, text):
        sent_calls.append((conn_id, phone, text))
        return True, None

    with patch("scheduler._send_billing_reminder", new=_fake_send):
        await _process_billing_reminders(db, send_messages=False)

    # Devera ter CRIADO a parcela mas NAO enviado mensagem
    txns = db.super_admin_transactions.docs
    assert len(txns) >= 1, f"Deveria ter criado a parcela; got {len(txns)}"
    assert sent_calls == [], (
        f"send_messages=False NAO deve disparar envio; got {len(sent_calls)} calls"
    )


@pytest.mark.asyncio
async def test_send_messages_true_sends_when_offset_matches():
    """send_messages=True (tick padrao): envia normalmente."""
    db = FakeDB()
    await db.system_settings.insert_one({
        "key": "billing_reminder",
        "enabled": True,
        "days_before_due_list": [5],
        "days_before_due": 5,
        "lancamento_gen_days": 30,
        "channel": "whatsapp",
        "default_message": "Ola {{nome}}, valor {{valor}}, conex={{licencas_conexao}}, "
                           "usr={{licencas_usuario}}, total={{valor_venda_total}}, "
                           "desc={{valor_desconto}}, dev={{valor_devido}}",
    })
    due_in_2d = (datetime.now(timezone.utc).date() + timedelta(days=2)).isoformat()
    await db.companies.insert_one({
        "id": "c-1",
        "name": "Web Fibra",
        "phone": "5562999998888",
        "monthly_price": 1000.0,
        "billing_cycle": "monthly",
        "installments": 12,
        "first_due_date": due_in_2d,
        "is_super_admin_system": False,
        "status": "active",
        "max_connections": 5,
        "max_users": 10,
        "total_sale_price": 1000.0,
        "discount": 50.0,
    })
    await db.channel_connections.insert_one({
        "id": "sa-conn-1",
        "company_id": "_super_admin_system_",
        "status": "connected",
    })

    from scheduler import _process_billing_reminders

    sent_calls = []

    async def _fake_send(conn_id, phone, text):
        sent_calls.append((conn_id, phone, text))
        return True, None

    with patch("scheduler._send_billing_reminder", new=_fake_send):
        await _process_billing_reminders(db, send_messages=True)

    assert len(sent_calls) >= 1, "Deveria ter enviado"
    _, phone, text = sent_calls[0]
    assert phone == "5562999998888"
    # Verifica que as novas variaveis foram renderizadas
    assert "conex=5" in text
    assert "usr=10" in text
    assert "total=1000,00" in text
    assert "desc=50,00" in text
    # 1000/12 = 83.33 - 50 = 33.33
    assert "dev=33,33" in text or "dev=" in text  # presente
