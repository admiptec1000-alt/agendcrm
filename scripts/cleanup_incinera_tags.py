"""Remove as tags que viraram coluna do Kanban (não deveriam ser tags).
Mantém apenas as 11 tags 'comuns' que estavam sem 'Kanban' nas imagens.
"""
import os
import requests

BASE_URL = os.environ.get("BASE_URL", "https://agentcrm.8ip.com.br/api").rstrip("/")
EMAIL = os.environ["EMAIL"]
PASSWORD = os.environ["PASSWORD"]

# Tags que DEVEM ser removidas (são exclusivamente colunas do Kanban)
KANBAN_ONLY_NAMES = {n.strip().lower() for n in [
    "ENCERRADO - ARQUIVADO", "ENCERRADO - CANCELADO", "ENCERRADO - PERDIDO", "ENCERRADO - WON",
    "FATURAMENTO - AGUARD. FATURA", "FATURAMENTO - AGUARD. PAGAMENTO",
    "LOGÍSTICA - AGUARD. AGENDAMENTO", "LOGÍSTICA - AGUARD. COLETA",
    "NEGOCIAÇÃO",
    "PROPOSTA - AGUARD. GER / DIR", "PROPOSTA - EM ELABORAÇÃO", "PROPOSTA - ENVIADA",
    "WON - CONTRATO ASSINADO", "WON - CONTRATO ATUALIZADO/RENOVADO",
    "WON - CONTRATO ENVIADO", "WON - CONTRATO PAGO", "WON - PROP. FECHADA",
]}


def main() -> int:
    r = requests.post(f"{BASE_URL}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    r.raise_for_status()
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    tags = requests.get(f"{BASE_URL}/crm/tags", headers=headers, timeout=15).json()
    print(f"[*] Tags antes: {len(tags)}")

    deleted = kept = failed = 0
    for t in tags:
        name = (t.get("name") or "").strip()
        if name.lower() in KANBAN_ONLY_NAMES:
            d = requests.delete(f"{BASE_URL}/crm/tags/{t['id']}", headers=headers, timeout=15)
            if d.status_code < 400:
                print(f"  [del] {name}")
                deleted += 1
            else:
                print(f"  [FAIL] {name}: {d.status_code} {d.text[:120]}")
                failed += 1
        else:
            kept += 1

    tags_after = requests.get(f"{BASE_URL}/crm/tags", headers=headers, timeout=15).json()
    print(f"\n[*] Tags depois: {len(tags_after)}")
    print(f"    Deletadas: {deleted}  Mantidas: {kept}  Falhas: {failed}")
    print("\nTags remanescentes:")
    for t in sorted(tags_after, key=lambda x: x.get("name", "")):
        print(f"  - {t['name']}  {t.get('color')}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
