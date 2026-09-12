import frappe
from frappe.utils import getdate, nowdate, flt, date_diff, formatdate
import json
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


UNRESTRICTED_TASK_ROLES = {"Administrator", "System Manager", "Admin", "HR Manager", "Projects Manager"}


def has_unrestricted_task_access(user=None):
    """
    Checks whether the specified user has company-wide unrestricted Task viewing permissions.
    """
    user = user or frappe.session.user
    if user == "Administrator":
        return True
    user_roles = set(frappe.get_roles(user))
    return bool(user_roles.intersection(UNRESTRICTED_TASK_ROLES))


@frappe.whitelist()
def get_task_dashboard_data(filters=None):
    """
    Fetches aggregated summary counts and filtered task records for the Task Dashboard.
    Scopes tasks automatically to the logged-in user unless they have unrestricted manager/admin roles.
    """
    if isinstance(filters, str):
        try:
            filters = json.loads(filters)
        except Exception:
            filters = {}
    filters = filters or {}

    current_user = frappe.session.user
    today = nowdate()
    is_unrestricted = has_unrestricted_task_access(current_user)

    # -------------------------------------------------------------
    # 1. Base conditions for task list
    # -------------------------------------------------------------
    conditions = ["docstatus < 2"]
    params = {"today": today, "current_user": current_user, "user_assign": f"%{current_user}%"}

    # Automatic Role & User Scoping based on Scope Tab
    active_scope = filters.get("scope") or ("my_tasks" if filters.get("tab") == "my_tasks" else "all")

    if active_scope == "my_tasks":
        # My Tasks: Only tasks assigned to the current user
        scope_condition = "(task_owner = %(current_user)s OR _assign LIKE %(user_assign)s)"
        conditions.append(scope_condition)
    else:
        # All Tasks: For standard users, tasks assigned to them OR created by them to others
        if not is_unrestricted:
            user_scope_parts = [
                "task_owner = %(current_user)s",
                "owner = %(current_user)s",
                "_assign LIKE %(user_assign)s"
            ]
            if frappe.db.has_column("Task", "custom_dependency_on"):
                user_scope_parts.append("custom_dependency_on = %(current_user)s")
            if frappe.db.has_column("Task", "custom_red_flag_raised_by"):
                user_scope_parts.append("custom_red_flag_raised_by = %(current_user)s")

            scope_condition = f"({' OR '.join(user_scope_parts)})"
            conditions.append(scope_condition)
        else:
            scope_condition = None

    # Filter: Task Owner
    if filters.get("task_owner"):
        conditions.append("task_owner = %(task_owner)s")
        params["task_owner"] = filters["task_owner"]

    # Filter: Priority
    if filters.get("priority") and filters.get("priority") != "All":
        conditions.append("priority = %(priority)s")
        params["priority"] = filters["priority"]

    # Filter: Status / Overdue
    status_filter = filters.get("status")
    if status_filter and status_filter != "All":
        if status_filter == "Overdue":
            conditions.append("exp_end_date < %(today)s AND status NOT IN ('Completed', 'Cancelled')")
        elif status_filter == "RedFlag":
            conditions.append("custom_red_flag = 1")
        else:
            conditions.append("status = %(status)s")
            params["status"] = status_filter

    # Filter: Date Range (Creation Date)
    if filters.get("from_date"):
        conditions.append("DATE(creation) >= %(from_date)s")
        params["from_date"] = filters["from_date"]

    if filters.get("to_date"):
        conditions.append("DATE(creation) <= %(to_date)s")
        params["to_date"] = filters["to_date"]

    # Filter: Text Search (Subject / Task ID / Project / Description)
    if filters.get("search_text"):
        conditions.append("(subject LIKE %(search_text)s OR name LIKE %(search_text)s OR project LIKE %(search_text)s OR description LIKE %(search_text)s)")
        params["search_text"] = f"%{filters['search_text'].strip()}%"

    # Tab Navigation Filter (Alerts / Lifecycle nodes)
    active_tab = filters.get("tab", "all")
    if active_tab == "red_flag":
        conditions.append("custom_red_flag = 1")
    elif active_tab == "overdue":
        conditions.append("exp_end_date < %(today)s AND status NOT IN ('Completed', 'Cancelled')")

    where_clause = " AND ".join(conditions)

    # Check optional custom columns
    extra_cols = []
    for col in ["custom_dependency_on", "custom_red_flag_due_date", "custom_opening_notes", "custom_red_flag_raised_by"]:
        if frappe.db.has_column("Task", col):
            extra_cols.append(col)
    extra_select = (",\n            " + ",\n            ".join(extra_cols)) if extra_cols else ""

    # -------------------------------------------------------------
    # 2. Fetch Tasks Data
    # -------------------------------------------------------------
    tasks = frappe.db.sql(f"""
        SELECT 
            name,
            subject,
            task_owner,
            status,
            priority,
            type,
            exp_start_date,
            exp_end_date,
            act_start_date,
            act_end_date,
            expected_time,
            progress,
            custom_red_flag,
            project,
            description,
            modified{extra_select}
        FROM `tabTask`
        WHERE {where_clause}
        ORDER BY 
            custom_red_flag DESC,
            CASE priority 
                WHEN 'Urgent' THEN 1 
                WHEN 'High' THEN 2 
                WHEN 'Medium' THEN 3 
                WHEN 'Low' THEN 4 
                ELSE 5 
            END,
            exp_end_date ASC,
            modified DESC
        LIMIT 300
    """, params, as_dict=True)

    # Calculate additional dynamic fields for UI
    for task in tasks:
        task["is_overdue"] = False
        task["due_status_text"] = ""
        task["due_status_class"] = "text-muted"

        if task.get("exp_end_date") and task.get("status") not in ["Completed", "Cancelled"]:
            diff = date_diff(task["exp_end_date"], today)
            if diff < 0:
                task["is_overdue"] = True
                task["due_status_text"] = f"{abs(diff)}d overdue"
                task["due_status_class"] = "status-pill-overdue"
            elif diff == 0:
                task["due_status_text"] = "Due today"
                task["due_status_class"] = "status-pill-warning"
            elif diff <= 3:
                task["due_status_text"] = f"Due in {diff}d"
                task["due_status_class"] = "status-pill-warning"
            else:
                task["due_status_text"] = f"In {diff}d"
                task["due_status_class"] = "status-pill-neutral"

    # -------------------------------------------------------------
    # 3. Global Summary Counts (Scoped to current global filter conditions)
    # -------------------------------------------------------------
    summary_conditions = ["docstatus < 2"]
    summary_params = {"today": today, "current_user": current_user, "user_assign": f"%{current_user}%"}

    if scope_condition:
        summary_conditions.append(scope_condition)

    if filters.get("task_owner"):
        summary_conditions.append("task_owner = %(task_owner)s")
        summary_params["task_owner"] = filters["task_owner"]

    if filters.get("from_date"):
        summary_conditions.append("DATE(creation) >= %(from_date)s")
        summary_params["from_date"] = filters["from_date"]

    if filters.get("to_date"):
        summary_conditions.append("DATE(creation) <= %(to_date)s")
        summary_params["to_date"] = filters["to_date"]

    if filters.get("search_text"):
        summary_conditions.append("(subject LIKE %(search_text)s OR name LIKE %(search_text)s OR project LIKE %(search_text)s OR description LIKE %(search_text)s)")
        summary_params["search_text"] = f"%{filters['search_text'].strip()}%"

    summary_where = " AND ".join(summary_conditions)

    summary_data = frappe.db.sql(f"""
        SELECT
            COUNT(*) as total_tasks,
            SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END) as open_tasks,
            SUM(CASE WHEN status = 'Working' THEN 1 ELSE 0 END) as in_progress_tasks,
            SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed_tasks,
            SUM(CASE WHEN exp_end_date < %(today)s AND status NOT IN ('Completed', 'Cancelled') THEN 1 ELSE 0 END) as overdue_tasks,
            SUM(CASE WHEN custom_red_flag = 1 THEN 1 ELSE 0 END) as red_flag_tasks
        FROM `tabTask`
        WHERE {summary_where}
    """, summary_params, as_dict=True)

    summary = summary_data[0] if summary_data else {
        "total_tasks": 0,
        "open_tasks": 0,
        "in_progress_tasks": 0,
        "completed_tasks": 0,
        "overdue_tasks": 0,
        "red_flag_tasks": 0
    }

    # Fetch active user info for the hero header
    user_info = {
        "full_name": frappe.utils.get_fullname(current_user),
        "email": current_user,
        "today_formatted": formatdate(today, "dd MMMM yyyy"),
        "is_unrestricted": is_unrestricted
    }

    return {
        "tasks": tasks,
        "summary": summary,
        "user_info": user_info,
        "is_unrestricted": is_unrestricted
    }

def ensure_red_flag_custom_fields():
    """
    Guarantees custom_red_flag, custom_dependency_on, custom_red_flag_due_date,
    custom_opening_notes, custom_red_flag_raised_by, and custom_red_flag_closing_notes
    exist in tabCustom Field and tabTask schema with raw fields hidden from form layout.
    """
    custom_fields = {
        "Task": [
            {
                "fieldname": "custom_red_flag",
                "label": "Red Flag",
                "fieldtype": "Check",
                "insert_after": "priority",
                "in_list_view": 1,
                "in_standard_filter": 1,
                "description": "Mark task as critical / high risk requiring special attention"
            },
            {
                "fieldname": "custom_dependency_on",
                "label": "Dependency On",
                "fieldtype": "Link",
                "options": "User",
                "insert_after": "custom_red_flag",
                "hidden": 1,
                "in_list_view": 0,
                "in_standard_filter": 0,
                "print_hide": 1,
                "description": "User on whom the Red Flag resolution is dependent"
            },
            {
                "fieldname": "custom_red_flag_due_date",
                "label": "Red Flag Due Date",
                "fieldtype": "Date",
                "insert_after": "custom_dependency_on",
                "hidden": 1,
                "in_list_view": 0,
                "print_hide": 1,
                "description": "Due Date for resolving the Red Flag"
            },
            {
                "fieldname": "custom_opening_notes",
                "label": "Opening Notes",
                "fieldtype": "Small Text",
                "insert_after": "custom_red_flag_due_date",
                "hidden": 1,
                "print_hide": 1,
                "description": "Opening notes explaining why the task was flagged"
            },
            {
                "fieldname": "custom_red_flag_raised_by",
                "label": "Red Flag Raised By",
                "fieldtype": "Link",
                "options": "User",
                "insert_after": "custom_red_flag",
                "hidden": 1,
                "read_only": 1,
                "print_hide": 1,
                "description": "User who flagged the task as Red Flag"
            },
            {
                "fieldname": "custom_red_flag_closing_notes",
                "label": "Red Flag Closing Notes",
                "fieldtype": "Small Text",
                "insert_after": "custom_opening_notes",
                "hidden": 1,
                "read_only": 1,
                "print_hide": 1,
                "description": "Closing notes provided when resolving Red Flag"
            }
        ]
    }
    create_custom_fields(custom_fields, update=True)

@frappe.whitelist()
def toggle_red_flag(task_name, red_flag, dependency_on=None, due_date=None, opening_notes=None, closing_notes=None):
    """
    Toggles or resolves red flag status.
    When red_flag = 1: requires dependency_on, due_date, opening_notes. Saves raised_by = session user.
    When red_flag = 0: saves closing_notes, clears red flag.
    """
    if not task_name:
        frappe.throw("Task ID is required")

    try:
        ensure_red_flag_custom_fields()
    except Exception:
        pass

    val = 1 if int(red_flag) else 0
    update_data = {"custom_red_flag": val}
    meta = frappe.get_meta("Task")

    if meta.has_field("custom_resolve_red_flag"):
        update_data["custom_resolve_red_flag"] = 0

    if val == 1:
        current_status = frappe.db.get_value("Task", task_name, "status")
        if current_status in ["Completed", "Cancelled"]:
            frappe.throw(f"Cannot raise Red Flag on a {current_status} task.")

        if not dependency_on or not due_date or not str(opening_notes or '').strip():
            frappe.throw("Dependency On, Due Date, and Description are all mandatory to mark a task as Red Flag.")

        if meta.has_field("custom_dependency_on"):
            update_data["custom_dependency_on"] = dependency_on
        if meta.has_field("custom_red_flag_due_date"):
            update_data["custom_red_flag_due_date"] = due_date
        if meta.has_field("custom_opening_notes"):
            update_data["custom_opening_notes"] = opening_notes
        if meta.has_field("custom_red_flag_raised_by"):
            update_data["custom_red_flag_raised_by"] = frappe.session.user

        # Audit comment in Task timeline
        try:
            raised_by_fullname = frappe.utils.get_fullname(frappe.session.user) or frappe.session.user
            dep_fullname = frappe.utils.get_fullname(dependency_on) or dependency_on
            date_display = formatdate(due_date, "dd-MM-yyyy") if due_date else ""
            comment_html = (
                f"🚩 <b>Task marked as Red Flag</b><br>"
                f"<b>Raised By:</b> {raised_by_fullname} ({frappe.session.user})<br>"
                f"<b>Dependency On:</b> {dep_fullname} ({dependency_on})<br>"
                f"<b>Due Date:</b> {date_display}<br>"
                f"<b>Description:</b> {opening_notes}"
            )
            doc = frappe.get_doc("Task", task_name)
            doc.add_comment("Comment", comment_html)
        except Exception:
            pass
    else:
        # Resolving / Removing Red Flag
        if meta.has_field("custom_red_flag_closing_notes") and closing_notes:
            update_data["custom_red_flag_closing_notes"] = closing_notes
        if meta.has_field("custom_dependency_on"):
            update_data["custom_dependency_on"] = None
        if meta.has_field("custom_red_flag_due_date"):
            update_data["custom_red_flag_due_date"] = None
        if meta.has_field("custom_opening_notes"):
            update_data["custom_opening_notes"] = None
        if meta.has_field("custom_red_flag_raised_by"):
            update_data["custom_red_flag_raised_by"] = None

        try:
            resolved_by = frappe.utils.get_fullname(frappe.session.user) or frappe.session.user
            comment_html = f"🏁 <b>Red Flag Resolved</b><br><b>Resolved By:</b> {resolved_by} ({frappe.session.user})"
            if closing_notes:
                comment_html += f"<br><b>Closing Notes:</b> {closing_notes}"
            doc = frappe.get_doc("Task", task_name)
            doc.add_comment("Comment", comment_html)
        except Exception:
            pass

    frappe.db.set_value("Task", task_name, update_data, update_modified=True)
    frappe.db.commit()

    return {"task_name": task_name, "custom_red_flag": val}

@frappe.whitelist()
def update_task_status(task_name, status):
    """
    Quick status update from the slide-over preview drawer.
    """
    if not task_name or not status:
        frappe.throw("Task ID and Status are required")

    frappe.db.set_value("Task", task_name, "status", status, update_modified=True)
    frappe.db.commit()

    return {"task_name": task_name, "status": status}
