"""One-time: re-apply the Document access sheet with the companion rule:
- each sheet role gets the read-only part of the standard role for its documents
  (Sales / Stock / Purchase / Accounts / Manufacturing / POS User): supporting
  records, settings, and their reports and pages;
- desk pages (Point of Sale, Stock Balance…) and reports open through Custom
  Roles, the durable mechanism, replacing the direct report role rows an earlier
  version added.

Only on a site where the access sheet is switched on. Users' roles are untouched.
"""

from erp_dacsinc_custom.access_sync import apply_doc_access, is_active
from erp_dacsinc_custom.access_worksheet import load_sheet


def execute():
	sheet = load_sheet("doc_access")
	if sheet and is_active():
		apply_doc_access(sheet)
