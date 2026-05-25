"""Shared helpers for finance modules (company-level + super-admin).

Centralises:
  • Date math for monthly/weekly/yearly recurrence
  • Late-fee (multa + juros) calculation
so both `routes/scheduling_routes.py` and `routes/super_admin_finance_routes.py`
emit consistent numbers without duplicating logic.
"""
from datetime import datetime, date, timedelta
from typing import Optional

from dateutil.relativedelta import relativedelta  # type: ignore


def parse_iso_date(s: str) -> Optional[date]:
    if not s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except Exception:
        return None


def generate_recurrence_dates(
    start: str,
    interval: str,
    until: Optional[str] = None,
    max_occurrences: int = 24,
) -> list[str]:
    """Yields a list of ISO dates starting at `start` and stepping forward
    by `interval` ('mensal'|'semanal'|'anual'). Stops at `until` (inclusive)
    or after `max_occurrences` to avoid runaway inserts.

    The FIRST date in the returned list is `start` itself — callers should
    use it for the seed transaction, then iterate over the rest to spawn
    the recurring siblings.
    """
    base = parse_iso_date(start)
    if not base:
        return []
    cap = parse_iso_date(until) if until else None
    out: list[str] = []
    current = base
    while len(out) < max_occurrences:
        if cap and current > cap:
            break
        out.append(current.isoformat())
        if interval == "mensal":
            current = current + relativedelta(months=1)
        elif interval == "semanal":
            current = current + timedelta(weeks=1)
        elif interval == "anual":
            current = current + relativedelta(years=1)
        else:
            break
    return out


def compute_late_fee_amount(
    base_amount: float,
    due_date_iso: Optional[str],
    multa_pct: float,
    juros_dia_pct: float,
    today: Optional[date] = None,
    discount: float = 0.0,
) -> dict:
    """Returns a dict with:
        days_overdue: int
        multa: float (one-shot)
        juros: float (simple daily, NOT compounded — keeps math predictable
                       for the operator dashboard)
        total: float (multa + juros)
        discount: float (echo of input)
        valor_devido: float (base_amount - discount + total)

    All values are 0 when the bill isn't overdue or the toggle is off.
    `discount` is always applied (whether overdue or not) so the operator
    UI shows the correct "to charge" number from day zero.
    """
    discount = max(0.0, float(discount or 0.0))
    base_after_discount = max(0.0, float(base_amount or 0.0) - discount)
    blank = {
        "days_overdue": 0,
        "multa": 0.0,
        "juros": 0.0,
        "total": 0.0,
        "discount": round(discount, 2),
        "valor_devido": round(base_after_discount, 2),
    }
    due = parse_iso_date(due_date_iso) if due_date_iso else None
    if not due:
        return blank
    today = today or datetime.utcnow().date()
    if today <= due:
        return blank
    days_overdue = (today - due).days
    # 2026-02-18 — multa/juros sao calculados sobre o `base_amount` da
    # parcela individual (NAO sobre o total recorrente).
    multa = float(base_amount) * (float(multa_pct or 0) / 100.0)
    juros = float(base_amount) * (float(juros_dia_pct or 0) / 100.0) * days_overdue
    total = max(0.0, multa) + max(0.0, juros)
    return {
        "days_overdue": days_overdue,
        "multa": round(multa, 2),
        "juros": round(juros, 2),
        "total": round(total, 2),
        "discount": round(discount, 2),
        "valor_devido": round(base_after_discount + total, 2),
    }
