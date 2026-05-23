"""Regression test: flow engine MUST preserve pending_node_id even when an
outbound WhatsApp send fails. Reintroducing the old `send_failed_in_round`
logic that cleared the state would re-break the bot mid-flow.

Reference: Emergent Support guidance — commit 5e662d0 removed the offending
block. This test ensures it stays removed.
"""
import inspect
import re

import flow_engine


def test_flow_engine_does_not_use_send_failed_in_round_flag():
    src = inspect.getsource(flow_engine)
    assert "send_failed_in_round" not in src, (
        "Regression: `send_failed_in_round` flag re-introduced into "
        "flow_engine.py. This flag historically cleared pending_node_id "
        "on transient send failures and permanently broke flow resumption. "
        "Refer to the support-team fix and commit 5e662d0."
    )


def test_flow_engine_does_not_discard_pending_node_on_failure():
    src = inspect.getsource(flow_engine)
    assert "discarding pending_node_id" not in src, (
        "Regression: code path that discards `pending_node_id` on send "
        "failure was re-added. Must remain removed per support guidance."
    )
    # Defensive: also catch any explicit assignment that nukes pending_node_id
    # immediately before _save_state.
    forbidden = re.compile(
        r"pending_node_id\s*=\s*None[^\n]*\n[^\n]*_save_state",
        re.DOTALL,
    )
    assert not forbidden.search(src), (
        "Regression: detected `pending_node_id = None` immediately before "
        "_save_state. State must be preserved on send failure."
    )


def test_advance_flow_save_state_uses_pending_node_id_variable():
    """The final _save_state call must pass the live `pending_node_id`,
    not a hard-coded None or any conditional zeroing."""
    src = inspect.getsource(flow_engine.advance_flow)
    # The last _save_state at the end of advance_flow should pass
    # pending_node_id directly.
    assert "_save_state(db, ticket[\"id\"], flow_id, pending_node_id, vars_)" in src, (
        "advance_flow's final _save_state call signature changed. Ensure it "
        "still persists `pending_node_id` so the flow can resume."
    )
