"""One-time: Customer › POS Store field, back-filled from existing data (see pos_scope.py)."""

from erp_dacsinc_custom.pos_scope import backfill, ensure_field


def execute():
	ensure_field()
	backfill()
