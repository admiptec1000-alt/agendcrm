"""Migration: upgrade existing SGP "Atendimento Web Internet" flow.

What it does, for every flow whose name starts with "SGP" (case-insensitive)
OR whose nodes reference `{{contratos_menu}}`:

  1. Identifies the *menu* node that lists contracts (heuristic: question
     contains `{{contratos_menu}}` or `contrato` in label/text).
     Patches its config to use the dynamic interactive menu:
        - options_format = "list"
        - dynamic_source = "contratos_lista"
        - capture_var    = "contrato_id"
        - header / footer / button_label friendly defaults
        - replaces the long `{{contratos_menu}}` inline text with a short prompt
  2. If a "fatura2via" SGP action node is present and its NEXT message node
     mentions only the boleto link, rewrites the message to include the PDF
     URL + Pix + linha digitavel block. (Idempotent — re-running is safe.)
  3. Reports what changed.

Usage:
    python /app/backend/scripts/migrate_sgp_flow_to_dynamic_menu.py            # apply
    python /app/backend/scripts/migrate_sgp_flow_to_dynamic_menu.py --dry-run  # preview only
"""
import asyncio, os, sys
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient


SECOND_VIA_TEMPLATE = (
    "Aqui esta sua 2a via!\n\n"
    "📄 Boleto / link de cobranca:\n{{boleto_url}}\n\n"
    "💳 Linha digitavel:\n{{linha_digitavel}}\n\n"
    "⚡ PIX Copia-e-Cola:\n{{pix_copia_e_cola}}\n\n"
    "Vencimento: {{vencimento_fatura}}\n"
    "Valor: R$ {{valor_fatura}}\n\n"
    "_Se ja pagou, desconsidere esta mensagem._"
)


def find_contract_menu(nodes):
    for n in nodes:
        d = n.get("data") or {}
        nt = d.get("nodeType") or n.get("type")
        cfg = d.get("config") or {}
        text = (cfg.get("question") or cfg.get("text") or "")
        label = (d.get("label") or "")
        if nt != "menu":
            continue
        if "{{contratos_menu}}" in text or "contrato" in label.lower() or "contrato" in text.lower():
            return n
    return None


def find_fatura2via_node(nodes):
    for n in nodes:
        d = n.get("data") or {}
        cfg = d.get("config") or {}
        action = cfg.get("action") or cfg.get("sgp_action")
        if action == "fatura2via":
            return n
    return None


def patch_menu(node):
    d = node["data"] = node.get("data") or {}
    cfg = d.get("config") or {}
    new_cfg = dict(cfg)
    new_cfg.update({
        "options_format": cfg.get("options_format") or "list",
        "dynamic_source": "contratos_lista",
        "capture_var": "contrato_id",
        "header": cfg.get("header") or "Selecione o contrato",
        "footer": cfg.get("footer") or "Toque para escolher",
        "button_label": cfg.get("button_label") or "Ver contratos",
    })
    q = cfg.get("question") or ""
    if "{{contratos_menu}}" in q:
        new_q = q.replace("{{contratos_menu}}", "").strip()
        if not new_q:
            new_q = "Selecione abaixo o contrato desejado:"
        new_cfg["question"] = new_q
    d["config"] = new_cfg


def patch_fatura2via_followup(nodes, edges, action_node):
    """If the node directly downstream of the fatura2via action is a message
    that only shows the link, replace its content with the rich PDF+Pix block.
    """
    src = action_node["id"]
    next_ids = [e.get("target") for e in (edges or []) if e.get("source") == src]
    changes = 0
    for nid in next_ids:
        nd = next((x for x in nodes if x.get("id") == nid), None)
        if not nd:
            continue
        d = nd.get("data") or {}
        if (d.get("nodeType") or nd.get("type")) != "message":
            continue
        cfg = d.get("config") or {}
        cur = (cfg.get("text") or "")
        # Heuristic: only auto-rewrite when the operator hasn't customised
        # heavily (i.e. message is short or already references boleto_url).
        if len(cur) < 600 and ("boleto_url" in cur or "linha" in cur.lower() or not cur.strip()):
            cfg["text"] = SECOND_VIA_TEMPLATE
            d["config"] = cfg
            nd["data"] = d
            changes += 1
    return changes


async def run_migration(db, dry_run: bool = False) -> dict:
    """Run the migration against the supplied motor `db` and return a
    structured report (no stdout). Used by the CLI entrypoint AND the
    admin HTTP endpoint that triggers the migration from production.
    """
    log: list = []
    cursor = db.flow_builders.find(
        {"$or": [
            {"name": {"$regex": "SGP", "$options": "i"}},
            {"nodes.data.config.question": {"$regex": "contratos_menu", "$options": "i"}},
        ]},
        {"_id": 0},
    )
    flows = await cursor.to_list(200)
    log.append(f"candidate flows: {len(flows)}")
    total_changes = 0
    flows_changed = 0
    for f in flows:
        nodes = f.get("nodes") or []
        edges = f.get("edges") or []
        changes_here = 0

        menu_node = find_contract_menu(nodes)
        if menu_node:
            patch_menu(menu_node)
            changes_here += 1
            log.append(f"flow={f.get('name')!r} company={f.get('company_id','?')[:8]} menu={menu_node['id']!r} → list+dynamic")

        fatura_node = find_fatura2via_node(nodes)
        if fatura_node:
            c = patch_fatura2via_followup(nodes, edges, fatura_node)
            if c:
                changes_here += c
                log.append(f"flow={f.get('name')!r} segunda-via followup messages updated: {c}")

        if changes_here:
            total_changes += changes_here
            flows_changed += 1
            if not dry_run:
                await db.flow_builders.update_one(
                    {"id": f["id"]},
                    {"$set": {"nodes": nodes, "updated_at": __import__("datetime").datetime.utcnow().isoformat()}},
                )
                log.append(f"  ↳ saved flow {f.get('name')!r} ({changes_here} changes)")
            else:
                log.append(f"  ↳ DRY-RUN: would save {changes_here} changes")

    summary = f"done — total changes: {total_changes}{' (dry-run, nothing saved)' if dry_run else ''}"
    log.append(summary)
    return {
        "dry_run": dry_run,
        "candidate_flows": len(flows),
        "flows_changed": flows_changed,
        "total_changes": total_changes,
        "log": log,
    }


async def main(dry_run: bool = False):
    load_dotenv()
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    report = await run_migration(db, dry_run=dry_run)
    for line in report["log"]:
        print(f"[migrate] {line}")


if __name__ == "__main__":
    asyncio.run(main(dry_run="--dry-run" in sys.argv))

