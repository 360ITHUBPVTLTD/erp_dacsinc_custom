"""One-time: each access sheet role's Role Profile holds exactly that role +
Employee + Employee Self Service (the extra roles the old profiles carried — Sales
User, Accounts User, Item Manager… — are removed from the profiles).

Users on those profiles lose the extra roles that came only through the profile.
Roles held for another reason (another profile, assigned directly to a user on the
multi-profile system) are kept. Runs once per site (Patch Log).
"""

from erp_dacsinc_custom.access_sync import ensure_roles_and_profiles


def execute():
	ensure_roles_and_profiles(reset=True)
