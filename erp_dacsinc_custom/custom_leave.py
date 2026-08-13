import frappe
from frappe import _
from frappe.utils import get_last_day, getdate

# 1 SL + 1 CL per month => 12 + 12 per leave year.
LEAVES_TO_ALLOCATE = {
	"Sick Leave": 1,
	"Casual Leave": 1,
}

# Single doctype in mobile_app_360ithub holding the branch allowlist.
SETTINGS = "Mobile App Admin Settings"


def get_eligible_branches():
	"""Branches whose employees receive CL/SL, from Mobile App Admin Settings.

	Branches left out of the list (Varthur) are not entitled to CL/SL --
	their leaves are treated as LOP.
	"""
	settings = frappe.get_single(SETTINGS)
	return [row.branch for row in (settings.get("leave_policy_branches") or []) if row.branch]


def get_eligible_employees(branches, start_date, end_date):
	"""Employees entitled to an allocation for the month `start_date`..`end_date`.

	Eligibility is judged as of that month, not as of today, so a backfill run
	still credits someone who has since left:

	  * joined on or before month end
	  * did not leave before the month started
	  * Active, or Left with a relieving date inside/after the month
	    (Inactive is treated as not employed)
	"""
	employees = frappe.get_all(
		"Employee",
		filters={
			"branch": ["in", branches],
			"date_of_joining": ["<=", end_date],
			"status": ["in", ["Active", "Left"]],
		},
		fields=["name", "employee_name", "company", "status", "relieving_date"],
	)

	eligible = []
	for emp in employees:
		if emp.relieving_date and getdate(emp.relieving_date) < start_date:
			# Left before this month began.
			continue
		if emp.status == "Left" and not emp.relieving_date:
			# Left with no relieving date -- cannot place them in time, skip.
			continue
		eligible.append(emp)

	return eligible


def allocate_monthly_leaves():
	"""Scheduled monthly run: allocate 1 CL + 1 SL for the CURRENT month only.

	Deliberately never touches past months, so an automated job cannot quietly
	write allocations into historical periods. Back-dated months are handled by
	hand from the UI (Leave Allocation Tool / `allocate_for_employees`).
	"""
	today = getdate()
	return _allocate_for_months([today.replace(day=1)])


def _allocate_for_months(month_starts, dry_run=0):
	"""Allocation engine: one CL + one SL per eligible employee per month."""
	branches = get_eligible_branches()
	if not branches:
		msg = f"No branches configured in {SETTINGS} > Leave Policy Branches."
		frappe.log_error(message=msg, title="Monthly Leave Allocation Skipped")
		print(msg)
		return {"created": 0, "already_present": 0, "overlapping": 0, "failed": 0}

	stats = {"created": 0, "already_present": 0, "overlapping": 0, "failed": 0}
	prefix = "[DRY RUN] " if dry_run else ""

	for start_date in month_starts:
		end_date = get_last_day(start_date)

		for emp in get_eligible_employees(branches, start_date, end_date):
			for leave_type, amount in LEAVES_TO_ALLOCATE.items():
				create_allocation(
					emp, leave_type, amount, start_date, end_date, stats, dry_run
				)

		if not dry_run:
			frappe.db.commit()

		print(f"{prefix}{start_date.strftime('%B %Y')}: {stats}")

	if stats["overlapping"]:
		frappe.log_error(
			message=f"{stats['overlapping']} allocation(s) skipped because an existing "
			"allocation already covers the period. A leave type allocated annually by a "
			"Leave Policy cannot also be allocated monthly -- remove that leave type "
			"from the Leave Policy, or from LEAVES_TO_ALLOCATE.",
			title="Monthly Leave Allocation: Overlapping Allocations Skipped",
		)

	print(f"{prefix}Total: {stats}")
	return stats


def create_allocation(emp, leave_type, amount, start_date, end_date, stats, dry_run=0):
	exists = frappe.db.exists(
		"Leave Allocation",
		{
			"employee": emp.name,
			"leave_type": leave_type,
			"from_date": start_date,
			"to_date": end_date,
			"docstatus": 1,
		},
	)
	if exists:
		stats["already_present"] += 1
		return

	# HRMS throws OverlapError for any submitted allocation covering these dates.
	# Detect it up front so an annually-allocated leave type reports as skipped
	# rather than disappearing into the Error Log 99 times.
	overlapping = frappe.db.sql(
		"""SELECT name FROM `tabLeave Allocation`
		WHERE employee=%s AND leave_type=%s AND docstatus=1
		AND to_date >= %s AND from_date <= %s LIMIT 1""",
		(emp.name, leave_type, start_date, end_date),
	)
	if overlapping:
		stats["overlapping"] += 1
		return

	if dry_run:
		stats["created"] += 1
		return

	try:
		allocation = frappe.get_doc(
			{
				"doctype": "Leave Allocation",
				"employee": emp.name,
				"employee_name": emp.employee_name,
				"company": emp.company,
				"leave_type": leave_type,
				"from_date": start_date,
				"to_date": end_date,
				"new_leaves_allocated": amount,
				"carry_forward": 0,
				"description": f"Auto-allocated for {start_date.strftime('%B %Y')}",
			}
		)
		allocation.insert(ignore_permissions=True)
		allocation.submit()
		stats["created"] += 1
	except Exception:
		stats["failed"] += 1
		frappe.log_error(
			message=frappe.get_traceback(),
			title=f"Failed to allocate {leave_type} for {emp.name}",
		)


MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
]


def month_range(year, month):
	"""('2026', 'August') -> (date(2026, 8, 1), date(2026, 8, 31))."""
	if month not in MONTHS:
		frappe.throw(_("Invalid month: {0}").format(month))

	start_date = getdate(f"{int(year)}-{MONTHS.index(month) + 1:02d}-01")
	return start_date, get_last_day(start_date)


def check_eligibility(emp, branches, start_date, end_date):
	"""Why this employee can or cannot receive an allocation for this month.

	Returns None when eligible, otherwise a human-readable reason.
	"""
	if emp.branch not in branches:
		return _("Branch not configured for leave")

	if not emp.date_of_joining:
		return _("No joining date")

	if getdate(emp.date_of_joining) > end_date:
		return _("Joined after this month")

	if emp.relieving_date and getdate(emp.relieving_date) < start_date:
		return _("Left before this month")

	if emp.status == "Left" and not emp.relieving_date:
		return _("Left, no relieving date")

	if emp.status == "Inactive" and not emp.relieving_date:
		return _("Inactive")

	present, overlapping = [], []
	for leave_type in LEAVES_TO_ALLOCATE:
		if frappe.db.exists(
			"Leave Allocation",
			{
				"employee": emp.name,
				"leave_type": leave_type,
				"from_date": start_date,
				"to_date": end_date,
				"docstatus": 1,
			},
		):
			present.append(leave_type)
		elif frappe.db.sql(
			"""SELECT name FROM `tabLeave Allocation`
			WHERE employee=%s AND leave_type=%s AND docstatus=1
			AND to_date >= %s AND from_date <= %s LIMIT 1""",
			(emp.name, leave_type, start_date, end_date),
		):
			overlapping.append(leave_type)

	if len(present) == len(LEAVES_TO_ALLOCATE):
		return _("Already allocated")
	if overlapping:
		return _("Overlaps existing: {0}").format(", ".join(overlapping))

	return None


@frappe.whitelist()
def get_employees_for_month(year, month):
	"""Every employee with a verdict for the given month, for the allocation dialog.

	Returns all statuses (Active / Inactive / Left) so nobody is invisible;
	those who cannot be allocated carry a reason and are not pre-selected.
	"""
	frappe.has_permission("Leave Allocation", "create", throw=True)

	start_date, end_date = month_range(year, month)
	branches = get_eligible_branches()

	employees = frappe.get_all(
		"Employee",
		fields=[
			"name",
			"employee_name",
			"branch",
			"status",
			"date_of_joining",
			"relieving_date",
		],
		order_by="employee_name asc",
	)

	rows = []
	for emp in employees:
		reason = check_eligibility(emp, branches, start_date, end_date)
		rows.append(
			{
				"employee": emp.name,
				"employee_name": emp.employee_name,
				"branch": emp.branch,
				"status": emp.status,
				"eligible": reason is None,
				"reason": reason or _("Eligible"),
			}
		)

	return {
		"from_date": str(start_date),
		"to_date": str(end_date),
		"eligible_count": sum(1 for r in rows if r["eligible"]),
		"employees": rows,
	}


@frappe.whitelist()
def allocate_for_employees(year, month, employees):
	"""Allocate 1 CL + 1 SL for the given month to the selected employees.

	Every row is re-validated here -- the dialog's selection is only a request.
	"""
	frappe.has_permission("Leave Allocation", "create", throw=True)

	if isinstance(employees, str):
		employees = frappe.parse_json(employees)
	if not employees:
		frappe.throw(_("No employees selected."))

	start_date, end_date = month_range(year, month)
	branches = get_eligible_branches()

	stats = {"created": 0, "already_present": 0, "overlapping": 0, "failed": 0}
	skipped = []

	for employee in employees:
		emp = frappe.db.get_value(
			"Employee",
			employee,
			[
				"name",
				"employee_name",
				"company",
				"branch",
				"status",
				"date_of_joining",
				"relieving_date",
			],
			as_dict=True,
		)
		if not emp:
			stats["failed"] += 1
			continue

		reason = check_eligibility(emp, branches, start_date, end_date)
		if reason:
			skipped.append(f"{emp.employee_name}: {reason}")
			if "Already allocated" in reason:
				stats["already_present"] += 1
			elif "Overlaps" in reason:
				stats["overlapping"] += 1
			else:
				stats["failed"] += 1
			continue

		for leave_type, amount in LEAVES_TO_ALLOCATE.items():
			create_allocation(emp, leave_type, amount, start_date, end_date, stats)

	frappe.db.commit()

	return {"stats": stats, "skipped": skipped}


def get_expiry_exempt_leave_types():
	"""Leave types whose expiry entries get cancelled nightly.

	Configured in Mobile App Admin Settings > Leave Types Exempt From Expiry.
	Anything not listed expires the way HRMS intends.
	"""
	settings = frappe.get_single(SETTINGS)
	return [row.leave_type for row in (settings.get("expiry_exempt_leave_types") or []) if row.leave_type]


def clear_expiry_for_exempt_leave_types():
	"""DELETE expiry ledger entries for the exempt leave types.

	Why this exists: allocations are monthly, so July's allocation expires on
	31 July. HRMS validates a Leave Application against the *whole* allocation
	period, so once that expiry entry exists a leave dated 14 July can no longer
	be applied for in September -- the balance reads negative.

	Why DELETE and not cancel: `get_manually_expired_leaves` in HRMS filters on
	is_expired and transaction_type but NOT on docstatus, so a *cancelled*
	expiry entry still reduces the balance. Cancelling looks like it works and
	does nothing. Measured on DAC-EMP-020: balance -3.0 with the cancelled rows
	present, 1.0 once they were deleted.

	Deleting also means nothing accumulates -- the old cancel-then-keep approach
	left ~470 dead rows a day behind.

	Note: HRMS re-creates these every night at ~00:02, so balances read negative
	between then and this job at 00:45. That fails closed (applications blocked,
	never wrongly approved), but keep HR Settings > auto_leave_encashment OFF,
	because generate_leave_encashment runs at ~00:03, inside that window.
	"""
	leave_types = get_expiry_exempt_leave_types()
	if not leave_types:
		frappe.log_error(
			message=f"No leave types configured in {SETTINGS} > Leave Types Exempt "
			"From Expiry. No expiry entries cleared.",
			title="Expiry Clearing Skipped",
		)
		return 0

	# docstatus 1 = created by tonight's expiry run;
	# docstatus 2 = cancelled by the old job, still counted by HRMS. Both must go.
	names = frappe.get_all(
		"Leave Ledger Entry",
		filters={"is_expired": 1, "leave_type": ["in", leave_types], "docstatus": ["in", [1, 2]]},
		pluck="name",
	)

	deleted = 0
	for name in names:
		try:
			frappe.db.sql("DELETE FROM `tabLeave Ledger Entry` WHERE name=%s", (name,))
			deleted += 1
			if deleted % 200 == 0:
				frappe.db.commit()
		except Exception:
			frappe.log_error(
				message=frappe.get_traceback(),
				title=f"Failed to delete expiry ledger entry {name}",
			)

	frappe.db.commit()
	frappe.logger().info(f"Deleted {deleted} expiry ledger entries for {leave_types}")
	print(f"Deleted {deleted} expiry ledger entries for {leave_types}.")
	return deleted


def purge_cancelled_expiry_entries(older_than_days=7):
	"""Delete cancelled expiry ledger entries older than `older_than_days`.

	Clears the backlog the old nightly cancel job left behind (~470 rows/day,
	20,000+ by August 2026). Nothing accumulates any more now that
	clear_expiry_for_exempt_leave_types deletes rather than cancels, so this is
	effectively a one-time cleanup that also catches any other leave type whose
	expiry rows were cancelled historically.

	These rows are NOT inert: HRMS' get_manually_expired_leaves ignores
	docstatus, so a cancelled expiry row still reduces the leave balance.
	"""
	cutoff = frappe.utils.add_days(getdate(), -frappe.utils.cint(older_than_days))

	names = frappe.get_all(
		"Leave Ledger Entry",
		filters={"docstatus": 2, "is_expired": 1, "creation": ["<", cutoff]},
		pluck="name",
	)

	deleted = 0
	for name in names:
		try:
			frappe.delete_doc("Leave Ledger Entry", name, force=True, ignore_permissions=True)
			deleted += 1
			if deleted % 200 == 0:
				frappe.db.commit()
		except Exception:
			frappe.log_error(
				message=frappe.get_traceback(),
				title=f"Failed to purge cancelled ledger entry {name}",
			)

	frappe.db.commit()
	print(f"Purged {deleted} cancelled expiry ledger entries older than {cutoff}.")
	return deleted
