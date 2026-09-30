"""One-time: "Created by POS User" fields on Material Request / Stock Entry, and tick the
ones POS users (POS Admin / POS Store Manager) already created (pos_notify.py)."""

from erp_dacsinc_custom.pos_notify import backfill_flags, ensure_fields


def execute():
	ensure_fields()
	backfill_flags()
