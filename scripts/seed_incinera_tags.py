"""Seed script: cria as Tags + Colunas do Kanban da empresa INCINERA.

Idempotente: só cria o que ainda não existe (compara por nome, case-insensitive).

Uso:
    BASE_URL=https://agentcrm.8ip.com.br/api \
    EMAIL=adm@incinera.com PASSWORD=a12345 SUBDOMAIN=incinera \
    python3 /app/scripts/seed_incinera_tags.py
"""
import os
import sys
import requests

BASE_URL = os.environ.get("BASE_URL", "https://agentcrm.8ip.com.br/api").rstrip("/")
EMAIL = os.environ["EMAIL"]
PASSWORD = os.environ["PASSWORD"]
SUBDOMAIN = os.environ.get("SUBDOMAIN", "incinera")

# (name, color, is_kanban) — is_kanban=True cria também coluna Kanban
ITEMS = [
    # ENCERRADO group (Kanban)
    ("ENCERRADO - ARQUIVADO", "#282828", True),
    ("ENCERRADO - CANCELADO", "#282828", True),
    ("ENCERRADO - PERDIDO", "#282828", True),
    ("ENCERRADO - WON", "#282828", True),
    # FATURAMENTO group (Kanban)
    ("FATURAMENTO - AGUARD. FATURA", "#6943A0", True),
    ("FATURAMENTO - AGUARD. PAGAMENTO", "#6943A0", True),
    # LOGÍSTICA group (Kanban)
    ("LOGÍSTICA - AGUARD. AGENDAMENTO", "#E076E6", True),
    ("LOGÍSTICA - AGUARD. COLETA", "#E076E6", True),
    # NEGOCIAÇÃO (Kanban)
    ("NEGOCIAÇÃO", "#D5B33C", True),
    # PROPOSTA group (Kanban)
    ("PROPOSTA - AGUARD. GER / DIR", "#D94486", True),
    ("PROPOSTA - EM ELABORAÇÃO", "#9933CC", True),
    ("PROPOSTA - ENVIADA", "#CC66CC", True),
    # WON group (Kanban)
    ("WON - CONTRATO ASSINADO", "#9966FF", True),
    ("WON - CONTRATO ATUALIZADO/RENOVADO", "#66CC00", True),
    ("WON - CONTRATO ENVIADO", "#9966FF", True),
    ("WON - CONTRATO PAGO", "#66CC00", True),
    ("WON - PROP. FECHADA", "#66CC00", True),
    # Tags comuns (NÃO Kanban)
    ("Falta de Coleta", "#F5883A", False),
    ("LOG – Resolvido", "#D4D48F", False),
    ("mandou por outro contato", "#B366E2", False),
    ("Novo Cliente", "#E89ED6", False),
    ("Pesquisa 2026", "#E65A5A", False),
    ("Portal do Cliente", "#8C90D7", False),
    ("Prest. Serviço – Esporádico", "#67E067", False),
    ("PROSPECTAR", "#00CC00", False),
    ("SAC-SGQ", "#FF8000", False),
    ("Urgente", "#FF3333", False),
    ("Wboleto", "#CC3333", False),
]


def login() -> str:
    r = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def fetch(path: str, headers: dict) -> list:
    r = requests.get(f"{BASE_URL}{path}", headers=headers, timeout=30)
    r.raise_for_status()
    return r.json()


def upsert_tag(name: str, color: str, headers: dict, existing: dict) -> str:
    key = name.strip().lower()
    if key in existing:
        return f"  [tag] já existe: {name}"
    r = requests.post(
        f"{BASE_URL}/crm/tags",
        json={"name": name, "color": color},
        headers=headers,
        timeout=15,
    )
    if r.status_code >= 400:
        return f"  [tag] FALHOU {name}: {r.status_code} {r.text[:120]}"
    existing[key] = r.json().get("id")
    return f"  [tag] criada: {name}  ({color})"


def upsert_column(name: str, color: str, order: int, headers: dict, existing: dict) -> str:
    key = name.strip().lower()
    if key in existing:
        return f"  [kanban] já existe: {name}"
    payload = {"name": name, "color": color, "order": order}
    r = requests.post(
        f"{BASE_URL}/crm/kanban-columns",
        json=payload,
        headers=headers,
        timeout=15,
    )
    if r.status_code >= 400:
        return f"  [kanban] FALHOU {name}: {r.status_code} {r.text[:160]}"
    existing[key] = r.json().get("id")
    return f"  [kanban] criada: {name}  ({color})"


def main() -> int:
    print(f"[*] Login em {BASE_URL} como {EMAIL} (subdomain={SUBDOMAIN})...")
    token = login()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    print("[*] Carregando tags e colunas existentes...")
    tags = {(t.get("name") or "").strip().lower(): t.get("id") for t in fetch("/crm/tags", headers)}
    cols = {(c.get("name") or "").strip().lower(): c.get("id") for c in fetch("/crm/kanban-columns", headers)}
    print(f"    Tags atuais: {len(tags)}  |  Colunas Kanban atuais: {len(cols)}")

    # Counters for summary
    tag_created = tag_skipped = tag_failed = 0
    col_created = col_skipped = col_failed = 0

    next_order = max(
        [int(c.get("order", 0) or 0) for c in fetch("/crm/kanban-columns", headers)] + [0]
    ) + 1

    print("\n[*] Inserindo / sincronizando...")
    for name, color, is_kanban in ITEMS:
        # Tag
        msg = upsert_tag(name, color, headers, tags)
        print(msg)
        if "criada" in msg:
            tag_created += 1
        elif "já existe" in msg:
            tag_skipped += 1
        elif "FALHOU" in msg:
            tag_failed += 1

        # Kanban column when applicable
        if is_kanban:
            msg = upsert_column(name, color, next_order, headers, cols)
            print(msg)
            if "criada" in msg:
                col_created += 1
                next_order += 1
            elif "já existe" in msg:
                col_skipped += 1
            elif "FALHOU" in msg:
                col_failed += 1

    print("\n========== RESUMO ==========")
    print(f"Tags     - criadas: {tag_created}  já existentes: {tag_skipped}  falhas: {tag_failed}")
    print(f"Kanban   - criadas: {col_created}  já existentes: {col_skipped}  falhas: {col_failed}")
    print("============================")
    return 0 if (tag_failed + col_failed) == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
