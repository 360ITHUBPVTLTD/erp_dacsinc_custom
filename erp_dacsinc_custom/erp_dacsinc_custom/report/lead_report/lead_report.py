import frappe
from frappe.utils import format_datetime
import json

def execute(filters=None):
    columns = get_columns(filters)
    data = get_data(filters)
    custom_custom_status_counts = get_custom_custom_status_counts(filters)
    html_content = get_custom_custom_status_cards_html(custom_custom_status_counts)
    return columns, data, html_content

# -------------------------
# Columns
# -------------------------
def get_columns(filters=None):
    if filters and filters.get("inverse_report"):
        # Columns for Inverse Report (Activities)
        return [
            {"label": "Activity ID", "fieldname": "activity_id", "fieldtype": "Link", "options": "Event Activity", "width": 120},
            {"label": "Subject", "fieldname": "subject", "fieldtype": "Data", "width": 150},
            {"label": "Status", "fieldname": "status", "fieldtype": "Data", "width": 100},
            {"label": "Category", "fieldname": "category", "fieldtype": "Data", "width": 120},
            {"label": "Reference Type", "fieldname": "reference_type", "fieldtype": "Data", "width": 120},
            {"label": "Reference Name", "fieldname": "reference_name", "fieldtype": "Dynamic Link", "options": "reference_type", "width": 150},
            {"label": "Lead Name", "fieldname": "lead_name", "fieldtype": "Data", "width": 150},
            {"label": "Lead Organization Name", "fieldname": "company_name", "fieldtype": "Data", "width": 150},
            {"label": "Lead Mobile", "fieldname": "mobile_no", "fieldtype": "Data", "width": 150},

            {"label": "Lead Email", "fieldname": "email_id", "fieldtype": "Data", "width": 150},
            # {"label": "Lead ID", "fieldname": "lead_id", "fieldtype": "Link", "options": "Lead", "width": 100},
            {"label": "Lead Owner", "fieldname": "lead_owner", "fieldtype": "Link", "options": "User", "width": 120},
            {"label": "Lead Category", "fieldname": "custom_lead_category", "fieldtype": "Data", "width": 120},
            {"label": "Lead Type", "fieldname": "custom_lead_type", "fieldtype": "Data", "width": 100},
            {"label": "Starts On", "fieldname": "starts_on", "fieldtype": "Datetime", "width": 150},
            {"label": "Ends On", "fieldname": "ends_on", "fieldtype": "Datetime", "width": 150},
            {"label": "Assigned To", "fieldname": "assigned_to", "fieldtype": "Link", "options": "User", "width": 120},
            {"label": "Notes", "fieldname": "notes", "fieldtype": "Data", "width": 200},
            {"label": "Actual Visit At", "fieldname": "actual_visit_at", "fieldtype": "Datetime", "width": 150},
            {"label": "Actual Checked Out At", "fieldname": "actual_checked_out_at", "fieldtype": "Datetime", "width": 150},

            # {"label": "Lead Name", "fieldname": "lead_name", "fieldtype": "Data", "width": 150},
            {"label": "Created At", "fieldname": "custom_created_at", "fieldtype": "Datetime", "width": 150},
        ]
    else:
        # Columns for Normal Lead Report
        return [
            {"label": "Lead ID", "fieldname": "lead_id", "fieldtype": "Link", "options": "Lead", "width": 100},
            {"label": "Lead Name", "fieldname": "lead_name", "fieldtype": "Data", "width": 150},
            {"label": "Organization", "fieldname": "company_name", "fieldtype": "Data", "width": 150},
            {"label": "Email", "fieldname": "email_id", "fieldtype": "Data", "width": 120},
            {"label": "Mobile No", "fieldname": "mobile_no", "fieldtype": "Data", "width": 120},
            {"label": "Status", "fieldname": "custom_lead_category", "fieldtype": "Data", "width": 120},
            {"label": "Lead Owner", "fieldname": "lead_owner", "fieldtype": "Link", "options": "User", "width": 150},
            {"label": "Revenue", "fieldname": "custom_expected_revenue", "fieldtype": "Currency", "width": 150},
            {"label": "PO Value", "fieldname": "custom_po_value", "fieldtype": "Currency", "width": 150},
            {"label": "Product Category", "fieldname": "custom_product_multi_category", "fieldtype": "Small Text", "width": 100},
            {"label": "Source", "fieldname": "source", "fieldtype": "Data", "width": 120},
			{"label": "Industry", "fieldname": "industry", "fieldtype": "Link","options":"Industry Type", "width": 120},
            {"label": "Description", "fieldname": "custom_lead_description", "fieldtype": "Data", "width": 200},
            {"label": "Quotation Count", "fieldname": "quotation_count", "fieldtype": "Int", "width": 120},
            {"label": "Followup Count", "fieldname": "followup_count", "fieldtype": "Data", "width": 100},
            {"label": "Next Followup Date", "fieldname": "custom_next_followup_date", "fieldtype": "Date", "width": 120},
            {"label": "Next Followup Description", "fieldname": "latest_open_description", "fieldtype": "Data", "width": 200},
            {"label": "Lead Age", "fieldname": "lead_age", "fieldtype": "Int", "width": 100},
            {"label": "Lead Type", "fieldname": "custom_lead_type", "fieldtype": "Data", "width": 100},
            {"label": "Direction Type", "fieldname": "custom_direction_type", "fieldtype": "Data", "width": 100},
            {"label": "Created At", "fieldname": "custom_created_at", "fieldtype": "Datetime", "width": 150},
        ]


# -------------------------
# Fetch Data
# -------------------------
def get_data(filters):
    if filters and filters.get("inverse_report"):
        return get_event_activity_with_reference(filters)
    return get_leads(filters)

import frappe
from datetime import datetime, timedelta
def get_leads(filters=None):
    conditions = []
    values = {}

    if filters is None:
        filters = {}

    # Force custom_created_at_option to "Custom"
    date_option = "Custom"

    today = datetime.today().date()

    # Apply the date filter based on custom_created_at
    if filters.get("custom_created_at"):
        start_date, end_date = filters.get("custom_created_at")
        conditions.append("DATE(l.custom_created_at) BETWEEN %(start_date)s AND %(end_date)s")
        values["start_date"] = start_date
        values["end_date"] = end_date
    else:
        # If custom_created_at not provided, default to show all leads
        pass

    # ------------------ Other Filters ------------------
    if filters.get("custom_lead_category"):
        conditions.append("custom_lead_category = %(custom_lead_category)s")
        values["custom_lead_category"] = filters["custom_lead_category"]

    if filters.get("mobile_no"):
        conditions.append("mobile_no = %(mobile_no)s")
        values["mobile_no"] = filters["mobile_no"]

    if filters.get("source"):
        conditions.append("source = %(source)s")
        values["source"] = filters["source"]

    # Get all roles of session user
    session_roles = frappe.get_roles(frappe.session.user)

    # Lead Owner filter
    if filters.get("lead_owner"):
        conditions.append("l.lead_owner = %(lead_owner)s")
        values["lead_owner"] = filters.get("lead_owner")
    else:
        # Restrict only if user has DAC CRM but NOT CRM Head
        if "DAC CRM" in session_roles and "CRM Head" not in session_roles:
            conditions.append("l.lead_owner = %(session_user)s")
            values["session_user"] = frappe.session.user


    if filters.get("lead_type"):
        conditions.append("custom_lead_type = %(custom_lead_type)s")
        values["custom_lead_type"] = filters["lead_type"]

    if filters.get("industry"):
        conditions.append("industry = %(industry)s")
        values["industry"] = filters["industry"]

    if filters.get("direction_type"):
        conditions.append("custom_direction_type = %(custom_direction_type)s")
        values["custom_direction_type"] = filters["direction_type"]

    # Lead Activity Status
    if filters.get("lead_activity_status") == "With Activity":
        conditions.append("""EXISTS (SELECT 1 FROM `tabEvent Activity` la WHERE la.reference_name = l.name)""")
    elif filters.get("lead_activity_status") == "Without Activity":
        conditions.append("""NOT EXISTS (SELECT 1 FROM `tabEvent Activity` la WHERE la.reference_name = l.name)""")

    where_clause = " AND ".join(conditions) if conditions else "1=1"

    leads = frappe.db.sql(f"""
        SELECT 
            GROUP_CONCAT(msi.product_category SEPARATOR ', ') AS custom_product_multi_category,
            l.name AS lead_id,
            l.lead_name,
            l.company_name,
            l.email_id,
            l.mobile_no,
            l.custom_lead_type,
            l.custom_direction_type,
            l.industry,
            l.custom_next_followup_date,
            l.custom_expected_revenue,
            l.source,
            l.custom_po_value,
            l.custom_lead_description,
            l.custom_lead_category,
            DATEDIFF(CURDATE(), DATE(l.creation)) AS lead_age,
            l.custom_created_at,
            l.lead_owner,
            (SELECT COUNT(*) 
            FROM `tabEvent Activity` la 
            WHERE la.reference_name = l.name) AS followup_count,
            (SELECT CONCAT(la.subject, ' | ', la.category) 
            FROM `tabEvent Activity` la 
            WHERE la.reference_name = l.name AND la.status='Open' 
            ORDER BY la.creation DESC LIMIT 1) AS latest_open_description,
            (SELECT COUNT(*) 
            FROM `tabQuotation` q 
            WHERE q.quotation_to = 'Lead' 
            AND q.party_name = l.name 
            AND q.docstatus = 1) AS quotation_count
        FROM `tabLead` l
        LEFT JOIN `tabProduct Category Multiselect` msi 
            ON msi.parent = l.name AND msi.parentfield = 'custom_product_multi_category'
        WHERE {where_clause}
        GROUP BY l.name
    """, values, as_dict=True)



    # Wrap followup count as link
    for lead in leads:
        lead["followup_count"] = f"<a href='#' onclick='showFollowupDetails(\"{lead['lead_id']}\")'>{lead['followup_count']}</a>"

    return leads

import frappe
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta

def get_event_activity_with_reference(filters=None):
    conditions = []
    values = {}

    today = datetime.today().date()

    if filters:
        # Category filter
        if filters.get("category"):
            conditions.append("ea.category = %(category)s")
            values["category"] = filters.get("category")

        # Status filter
        if filters.get("status"):
            conditions.append("ea.status = %(status)s")
            values["status"] = filters.get("status")

        # Determine session user roles
        session_roles = frappe.get_roles(frappe.session.user)

        # Assigned To filter
        if filters.get("assigned_to"):
            conditions.append("ea.assigned_to = %(assigned_to)s")
            values["assigned_to"] = filters.get("assigned_to")
        else:
            # Restrict only if user has DAC CRM but NOT CRM Head
            if "DAC CRM" in session_roles and "CRM Head" not in session_roles:
                conditions.append("ea.assigned_to = %(session_user)s")
                values["session_user"] = frappe.session.user


        # Date filter options
        option = filters.get("custom_created_at_option")
        if option == "Today":
            conditions.append("DATE(ea.starts_on) = %(today)s")
            values["today"] = today
        elif option == "Upcoming":
            conditions.append("DATE(ea.starts_on) > %(today)s")
            values["today"] = today
        elif option == "Overdue":
            conditions.append("DATE(ea.starts_on) < %(today)s AND ea.status != 'Completed'")
            values["today"] = today
        elif option == "This Month":
            start_date = today.replace(day=1)
            end_date = (start_date + relativedelta(months=1)) - timedelta(days=1)
            conditions.append("DATE(ea.starts_on) BETWEEN %(start_date)s AND %(end_date)s")
            values["start_date"], values["end_date"] = start_date, end_date
        elif option == "This Week":
            start_date = today - timedelta(days=today.weekday())
            end_date = start_date + timedelta(days=6)
            conditions.append("DATE(ea.starts_on) BETWEEN %(start_date)s AND %(end_date)s")
            values["start_date"], values["end_date"] = start_date, end_date
        elif option == "Custom" and filters.get("custom_created_at"):
            start_date, end_date = filters.get("custom_created_at")
            conditions.append("DATE(ea.starts_on) BETWEEN %(start_date)s AND %(end_date)s")
            values["start_date"], values["end_date"] = start_date, end_date

    # If no filters or no date filter applied → show all
    where_clause = " AND ".join(conditions) if conditions else "1=1"

    # Fetch activities
    activities = frappe.db.sql(f"""
        SELECT 
            ea.name AS activity_id,
            ea.subject,
            ea.status,
            ea.category,
            ea.starts_on,
            ea.ends_on,
            ea.assigned_to,
            ea.actual_visit_at,
            ea.actual_checked_out_at,
            ea.notes,
            ea.reference_type,
            ea.reference_name
        FROM `tabEvent Activity` ea
        WHERE {where_clause}
        ORDER BY ea.starts_on DESC
    """, values, as_dict=True)
    # print("ddddddddddddddddddddddddddd",activities)
    # Add reference info dynamically
    for row in activities:
        reference_type = row.get("reference_type")
        reference_name = row.get("reference_name")
        if reference_type and reference_name:
            try:
                ref_doc = frappe.get_doc(reference_type, reference_name)
                if reference_type == "Lead":
                    row["lead_id"] = ref_doc.name
                    row["lead_name"] = ref_doc.lead_name
                    row["company_name"] = ref_doc.company_name
                    row["lead_owner"] = ref_doc.lead_owner
                    row["email_id"] = ref_doc.email_id
                    row["mobile_no"] = ref_doc.mobile_no
                    row["custom_lead_category"] = getattr(ref_doc, "custom_lead_category", "")
                    row["custom_lead_type"] = getattr(ref_doc, "custom_lead_type", "")
                    row["custom_created_at"] = getattr(ref_doc, "custom_created_at", "")
                else:
                    row[f"{reference_type.lower()}_id"] = ref_doc.name
                    row[f"{reference_type.lower()}_title"] = getattr(ref_doc, "title", getattr(ref_doc, "name", ""))
            except frappe.DoesNotExistError:
                pass

        # Format datetime fields to DD-MM-YYYY HH:MM:SS
        for field in ["starts_on", "ends_on", "custom_created_at"]:
            value = row.get(field)

            if not value:
                row[field] = ""
                continue

            if isinstance(value, datetime):
                valid_datetime = value
            else:
                valid_datetime = None
                for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d-%m-%Y %H:%M:%S", "%d-%m-%Y"):
                    try:
                        valid_datetime = datetime.strptime(str(value), fmt)
                        break
                    except (ValueError, TypeError):
                        continue

            if valid_datetime:
                # Send in ISO format for JS
                row[field] = valid_datetime.strftime("%Y-%m-%dT%H:%M:%S")
            else:
                row[field] = ""


    return activities





# Lead Activity Table HTML
@frappe.whitelist()
def get_lead_activities(custom_lead_category, filters=None):
    if isinstance(filters, str):
        filters = json.loads(filters)

    conditions = ["l.custom_lead_category = %(custom_lead_category)s"]
    values = {"custom_lead_category": custom_lead_category}

    if filters.get("lead_owner"):
        conditions.append("l.lead_owner = %(lead_owner)s")
        values["lead_owner"] = filters["lead_owner"]

    where_clause = " AND ".join(conditions)

    data = frappe.db.sql(f"""
        SELECT l.name AS lead_id, l.lead_name, l.mobile_no
        FROM `tabLead` l
        WHERE {where_clause}
    """, values, as_dict=True)

    html = "<table class='table table-bordered'>"
    html += "<tr><th>Lead ID</th><th>Lead Name</th><th>Mobile</th></tr>"
    for d in data:
        html += f"<tr><td>{d.lead_id}</td><td>{d.lead_name}</td><td>{d.mobile_no}</td></tr>"
    html += "</table>"

    return html




from frappe.utils import format_datetime


@frappe.whitelist()
def get_lead_activities_record(lead_id):
    activities = frappe.db.sql(
        """
        SELECT 
            name AS activity_id,
            subject,
            status,
            category,
            starts_on,
            ends_on,
            assigned_to,
            created_on
        FROM `tabEvent Activity`
        WHERE reference_name = %s
        ORDER BY created_on DESC
        """,
        (lead_id,), as_dict=True
    )
    
    html_table = """
    <style>
        .lead-activity-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }
        .lead-activity-table th, .lead-activity-table td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }
        .lead-activity-table th {
            font-weight: bold;
            background: #f5f5f5;
        }
        .lead-activity-table tr:nth-child(even) {
            background-color: #f9f9f9;
        }
        .lead-link {
            text-decoration: none;
            font-weight: bold;
            color: #007bff;
        }
        .lead-link:hover {
            text-decoration: underline;
        }
    </style>
    <table class="lead-activity-table">
        <tr>
            <th>Activity ID</th>
            <th>Subject</th>
            <th>Status</th>
            <th>Category</th>
            <th>Starts On</th>
            <th>Ends On</th>
            <th>Assigned To</th>
            <th>Created On</th>
        </tr>
    """
    
    for activity in activities:
        activity_link = f"<a href='/app/event-activity/{activity['activity_id']}' target='_blank'>{activity['activity_id']}</a>"
        
        html_table += f"""
        <tr>
            <td>{activity_link}</td>
            <td>{activity['subject'] or ''}</td>
            <td>{activity['status'] or ''}</td>
            <td>{activity['category'] or ''}</td>
			<td>{format_datetime(activity['starts_on']) if activity['starts_on'] else ''}</td>
            <td>{format_datetime(activity['ends_on']) if activity['ends_on'] else ''}</td>
            <td>{activity['assigned_to'] or ''}</td>
            <td>{format_datetime(activity['created_on']) if activity['created_on'] else ''}</td>
        </tr>
        """
    
    html_table += "</table>"
    return html_table







def get_custom_custom_status_counts(filters=None):
    conditions, values = [], {}
    session_roles = frappe.get_roles(frappe.session.user)
    if filters:
        if filters.get("mobile_no"):
            conditions.append("mobile_no = %(mobile_no)s")
            values["mobile_no"] = filters["mobile_no"]

        if filters.get("source"):
            conditions.append("source = %(source)s")
            values["source"] = filters["source"]

        if filters.get("lead_owner"):
            conditions.append("lead_owner = %(lead_owner)s")
            values["lead_owner"] = filters["lead_owner"]
        else:
            # Restrict only if user has DAC CRM but NOT CRM Head
            if "DAC CRM" in session_roles and "CRM Head" not in session_roles:
                conditions.append("lead_owner = %(session_user)s")
                values["session_user"] = frappe.session.user


        if filters.get("custom_created_at") and isinstance(filters["custom_created_at"], (list, tuple)):
            start_date, end_date = filters["custom_created_at"]
            conditions.append("DATE(custom_created_at) BETWEEN %(start_date)s AND %(end_date)s")
            values["start_date"], values["end_date"] = start_date, end_date

    where_clause = " AND ".join(conditions) if conditions else "1=1"

    # Get count and total expected revenue per custom_lead_category
    status_counts = frappe.db.sql(f"""
        SELECT 
            custom_lead_category, 
            COUNT(*) AS count,
            SUM(
            CASE 
                WHEN custom_lead_category = 'Order' THEN IFNULL(custom_po_value, 0)
                ELSE IFNULL(custom_expected_revenue, 0)
            END
        ) AS total_revenue
        FROM `tabLead`
        WHERE {where_clause}
        GROUP BY custom_lead_category
    """, values, as_dict=True)

    # Get overall total revenue
    total_revenue = frappe.db.sql(f"""
        SELECT SUM(
            CASE 
                WHEN custom_lead_category = 'Order' THEN IFNULL(custom_po_value, 0)
                ELSE IFNULL(custom_expected_revenue, 0)
            END
        ) AS total_revenue
        FROM `tabLead`
        WHERE {where_clause}
    """, values, as_dict=True)

    return status_counts, total_revenue[0]["total_revenue"]

def get_custom_custom_status_cards_html(status_counts):
    status_counts, total_revenue = status_counts

    def format_currency(value):
        if not value:
            value = 0
        return "{:,.2f}".format(float(value))  # adds commas and 2 decimal places


    # Desired fixed order
    fixed_order = ["Enquiry", "Pipeline", "Order", "Lost Enquiry", "Lost Pipeline"]

    # Convert list into dict for quick lookup
    category_map = {row["custom_lead_category"]: row for row in status_counts}

    # Create Lead + Create Activity buttons (top-right)
    html = """
    <div class='row'>
        <div class='col-md-12 text-right' style='margin-bottom:10px;'>
            <button class="btn btn-primary btn-sm" onclick="window.createNewLead()">Create Lead</button>
            <button class="btn btn-secondary btn-sm" onclick="window.openActivityPrompt()">Create Activity</button>
        </div>
    </div>
    """

    # Cards row
    html += "<div class='row'>"
    for category in fixed_order:
        row = category_map.get(category, {"count": 0, "total_revenue": 0})
        html += f"""
        <div class='col-md-2'>
            <div class='card text-center' style='padding:10px; margin:5px; border:1px solid #ccc;'>
                <h5>{category} ({row['count']})</h5>
                <h6>{format_currency(row['total_revenue'])}</h6>
            </div>
        </div>
        """

    # Total Revenue card
    html += f"""
    <div class='col-md-2'>
        <div class='card text-center' style='padding:10px; margin:5px; border:1px solid #ccc;'>
            <h5>Total Revenue</h5>
            <h6>{format_currency(total_revenue)}</h6>
        </div>
    </div>
    </div>
    """

    # JS functions
    html += """
    <script>
    // Open new Lead in new tab
    window.createNewLead = function() {
        var url = "/app/lead/new-lead";
        window.open(url, "_blank");
    }

    // Open Create Activity prompt
    window.openActivityPrompt = function() {
        frappe.prompt([
            {
                fieldname: "reference_type",
                label: "Reference Type",
                fieldtype: "Select",
                options: ["Lead", "Customer", "Supplier"].join("\\n"),
                default: "Lead",
                reqd: 1
            },
            {
                fieldname: "reference_name",
                label: "Reference Name",
                fieldtype: "Dynamic Link",
                options: "reference_type",
                reqd: 1
            },
            {
                fieldname: "mark_completed",
                label: "Mark as Completed",
                fieldtype: "Check",
                default: 0
            },
            {
                fieldname: "category",
                label: "Category",
                fieldtype: "Select",
                options: [
                    "Initial Call",
                    "Follow up Call",
                    "Initial Meeting",
                    "Follow up meetings",
                    "Meeting (Sample)",
                    "Proposal/Quotation",
                    "Order Closure"
                ].join("\\n"),
                default: "Initial Call",
                reqd: 1
            },
            {
                fieldname: "subject",
                label: "Subject",
                fieldtype: "Data",
                reqd: 1
            },
            {
                fieldname: "starts_on",
                label: "Starts On",
                fieldtype: "Datetime",
                default: frappe.datetime.now_datetime(),
                reqd: 1
            },
            {
                fieldname: "assigned_to",
                label: "Assigned To",
                fieldtype: "Link",
                options: "User",
                default: frappe.session.user,
                reqd: 1
            },
            {
                fieldname: "description",
                label: "Description",
                fieldtype: "Small Text"
            }
        ],
        function(values) {
            frappe.call({
                method: "frappe.client.insert",
                args: {
                    doc: {
                        doctype: "Event Activity",
                        reference_type: values.reference_type,
                        reference_name: values.reference_name,
                        subject: values.subject,
                        category: values.category,
                        starts_on: values.starts_on,
                        assigned_to: values.assigned_to,
                        description: values.description,
                        status: values.mark_completed ? "Completed" : "Open"
                    }
                },
                callback: function(r) {
                    if (r.message) {
                        frappe.msgprint("Activity Created Successfully");
                    }
                }
            });
        },
        "New Activity",
        "Create");
    }
    </script>
    """

    return html


