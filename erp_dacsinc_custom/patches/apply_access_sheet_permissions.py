"""One-time: switch the agreed access sheet on — apply it to the ERP.

Applies the Document access sheet (document permissions, linked documents, report
access) and the Order Flow tab / sub-tab roles in Admin Settings, working the tab
sheet out from the Document access sheet first (the stored one was never hand-made).

Users' roles and Role Profiles are NOT changed — nobody loses a role. Resetting the
profiles is a separate Admin action on the sheet page.

Runs once per site (Patch Log); a later migrate never re-runs it.
"""

from erp_dacsinc_custom.access_sync import apply_permissions
from erp_dacsinc_custom.access_worksheet import load_sheet


def execute():
	if load_sheet("doc_access"):
		apply_permissions(derive_tabs=True)
