"""One-time: make the agreed access sheet (/roles-and-permissions) the site's access.

Creates/flags the sheet roles and their Role Profiles (role + Employee + Employee
Self Service), then applies both sheets: document permissions and Order Flow tab /
sub-tab roles in Admin Settings. On a site with no saved sheet, the sheets come
from access/agreed_access.json shipped with the app.

Runs once per site (Patch Log). Later migrates never re-run it, so changes made on
the site afterwards — through the sheet page — are never reset.
"""

from erp_dacsinc_custom.access_sync import initial_setup


def execute():
	initial_setup()
