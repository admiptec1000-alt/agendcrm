# Importação da base de Contatos da Incinera (XLSX)

## O que foi entregue
- **Endpoint backend**: `POST /api/crm/clients/import-xlsx` (multipart `file` com `.xlsx`).
- **Botão "Importar XLSX"** na página *Clientes / Leads* (visível só para admin/owner).
- **Lógica de matching** dos rótulos da coluna `tags e Kambam`:
  - Se o rótulo bater (case/trim/whitespace-insensitive) com o nome de uma **Tag** da empresa → vira `client.tags` (array de nomes).
  - Se bater com o nome de uma **Coluna do Kanban** → cria/atualiza **um único ticket** vinculado ao cliente e ancora ele nessa coluna (último rótulo Kanban encontrado vence).
  - Se não bater em nenhum dos dois → o rótulo é guardado como tag livre e listado no relatório.
- **Deduplicação por telefone** (digits-only): cliente já existente é **atualizado** (nome + email + união de tags).
- **Telefones “anômalos”** (LIDs, 15+ dígitos) também são importados.

## Validação local (preview)
- Empresa `crm@test.com` rodou a importação 2x:
  - 1ª execução: `1153 criados`, `0 atualizados`, `103 tickets criados`, `0 ignorados`.
  - 2ª execução: `0 criados`, `1153 atualizados`, `103 tickets movidos` — dedup OK.
- Após validação a base de teste foi **purgada** (`created_via='xlsx_import'` + tickets `channel='import'` deletados).

## Como rodar em produção (Incinera)
1. **Redeploy do backend** com a release que inclui este endpoint (Save to GitHub → deploy).
2. Logar em produção como `adm@incinera.com`.
3. Abrir **Clientes / Leads** → botão `Importar XLSX` (canto superior direito).
4. Selecionar `backup_contatos incinera (10) (1).xlsx`.
5. Aguardar — em ~5–15s aparece um relatório verde:
   - `created` / `updated` / `tickets_created` / `tickets_updated`
   - `unknown_labels_top`: rótulos que **não** bateram com nenhuma Tag/Coluna existente (idealmente este número será baixo, pois a Incinera afirma já ter cadastrado as tags/colunas em produção).

## Alternativa via curl (caso queira rodar headless)
```bash
TOKEN=$(curl -s -X POST "$PROD/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"adm@incinera.com","password":"a12345"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

curl -X POST "$PROD/api/crm/clients/import-xlsx" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@backup_contatos.xlsx"
```

## Observações
- O endpoint é **idempotente**: pode rodar de novo sem medo (reimporta = atualiza).
- Os 39 rótulos que apareceram como `unknown` no preview (ex.: `ENCERRADO - ARQUIVADO`, `Contrato`, `Novo Cliente`, `LOG - Resolvido`, `PROSPECTAR`, `LOGÍSTICA - AGUARD. COLETA`, etc.) provavelmente já estão criados em produção pela Incinera; se algum continuar listado como `unknown_labels_top` no relatório de produção, basta criar a Tag ou a Coluna do Kanban com o nome **exato** (ou rodar a importação novamente — o matching é case-insensitive).
