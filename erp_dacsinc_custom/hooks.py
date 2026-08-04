app_name = "erp_dacsinc_custom"
app_title = "Erp Dacsinc Custom"
app_publisher = "Pankaj"
app_description = "Erp Dacsinc Custom"
app_email = "pankaj@360ithub.com"
app_license = "mit"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "erp_dacsinc_custom",
# 		"logo": "/assets/erp_dacsinc_custom/logo.png",
# 		"title": "Erp Dacsinc Custom",
# 		"route": "/erp_dacsinc_custom",
# 		"has_permission": "erp_dacsinc_custom.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/erp_dacsinc_custom/css/erp_dacsinc_custom.css"
app_include_js = [
    "/assets/erp_dacsinc_custom/js/workflow.js?v=1.0.4",
    "/assets/erp_dacsinc_custom/js/toogle.js?v=1.0.4"
]

app_include_css = [
    "/assets/erp_dacsinc_custom/style.css?v=1.0.4",
    "/assets/erp_dacsinc_custom/css/order_flow.css?v=1.0.4"
]

# include js, css files in header of web template
# web_include_css = "/assets/erp_dacsinc_custom/css/erp_dacsinc_custom.css"
# web_include_js = "/assets/erp_dacsinc_custom/js/erp_dacsinc_custom.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "erp_dacsinc_custom/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
doctype_js = {
	"Lead": "public/js/lead.js",
	"Sales Order": "public/js/sales_order.js"
}
doctype_list_js = {
	"Lead": "public/js/lead_list.js"
}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "erp_dacsinc_custom/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment

# jinja = {
# 	"methods": "erp_dacsinc_custom.utils.jinja_methods",
# 	"filters": "erp_dacsinc_custom.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "erp_dacsinc_custom.install.before_install"
# after_install = "erp_dacsinc_custom.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "erp_dacsinc_custom.uninstall.before_uninstall"
# after_uninstall = "erp_dacsinc_custom.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "erp_dacsinc_custom.utils.before_app_install"
# after_app_install = "erp_dacsinc_custom.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "erp_dacsinc_custom.utils.before_app_uninstall"
# after_app_uninstall = "erp_dacsinc_custom.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "erp_dacsinc_custom.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

permission_query_conditions = {
    "Sales Order": "erp_dacsinc_custom.custom_script.get_sales_order_permission_query_conditions",
}

has_permission = {
    "Sales Order": "erp_dacsinc_custom.custom_script.has_sales_order_permission",
}


# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
    "Item": {
        "before_save": "erp_dacsinc_custom.custom_script.item_before_save",
        "after_insert": "erp_dacsinc_custom.custom_script.item_after_insert",
        "on_update": "erp_dacsinc_custom.custom_script.item_on_update",
    },
    "Item Price": {
        "on_update": "erp_dacsinc_custom.custom_script.item_price_on_update",
        "after_insert": "erp_dacsinc_custom.custom_script.item_price_on_update",
    },
    "Event": {
        "after_insert": "erp_dacsinc_custom.custom_lead.after_insert_event",
        "before_save": "erp_dacsinc_custom.custom_lead.before_save_event"
    },
    "Lead": {
        "after_insert": "erp_dacsinc_custom.custom_lead.after_insert_lead",
        "on_update": "erp_dacsinc_custom.custom_lead.on_update_lead",
        "validate": "erp_dacsinc_custom.custom_lead.validate_lead"
    },
    "Quotation": {
        "before_insert": "erp_dacsinc_custom.custom_script.before_insert",
        "after_insert": "erp_dacsinc_custom.custom_script.after_insert_quotation",
        "on_update": "erp_dacsinc_custom.custom_script.on_update_quotation",
        "on_submit": "erp_dacsinc_custom.custom_script.quotation_on_submit",
        "validate": ["erp_dacsinc_custom.custom_script.validate_non_zero_rate",
                        "erp_dacsinc_custom.custom_script.validate_quotation"]
        # "on_cancel": "erp_dacsinc_custom.custom_script.quotation_on_cancel"
    },
    "Sales Invoice": {
        "validate": "erp_dacsinc_custom.custom_script.validate_non_zero_rate"
    },
    "Sales Order": {
        "on_submit": "erp_dacsinc_custom.custom_script.sales_order_on_submit",
        "on_cancel": "erp_dacsinc_custom.custom_script.sales_order_on_cancel",
       "after_insert": "erp_dacsinc_custom.notifications.notify_on_new_so",
       "on_update": "erp_dacsinc_custom.custom_script.sales_order_on_update",
        "on_trash": "erp_dacsinc_custom.custom_script.sales_order_on_trash",
        "before_insert": "erp_dacsinc_custom.custom_script.sales_order_before_insert",
       "before_validate": "erp_dacsinc_custom.custom_script.sales_order_before_insert",
       "validate": "erp_dacsinc_custom.custom_script.validate_non_zero_rate"
    },
    "Delivery Note": {
        "on_submit": "erp_dacsinc_custom.custom_script.update_pick_lists_on_dn_submit"
    },
    "BOM": {
        "on_submit": "erp_dacsinc_custom.bom_events.after_submit",
        "on_update_after_submit": "erp_dacsinc_custom.bom_events.on_update_after_submit",
        "on_cancel": "erp_dacsinc_custom.bom_events.on_cancel"
    },
    "Purchase Receipt": {
        "on_submit": "erp_dacsinc_custom.purchase_order.create_putaway_picklist",
        "on_cancel": "erp_dacsinc_custom.purchase_order.delete_putaway_picklist"
    },
    # "Customer": {
    #     "after_insert": "erp_dacsinc_custom.custom_customer.customer_after_insert",
    #     "on_update": "erp_dacsinc_custom.custom_customer.update_customer_sharing"
    # }
    "Customer": {
        "before_insert": "erp_dacsinc_custom.custom_customer.customer_before_insert",
        "after_insert": "erp_dacsinc_custom.custom_customer.customer_after_insert",
        "on_update": "erp_dacsinc_custom.custom_customer.update_customer_sharing"
    },
    "Purchase Order": {
        "validate": "erp_dacsinc_custom.custom_script.validate_non_zero_rate"
    },
    "Purchase Invoice": {
        "validate": "erp_dacsinc_custom.custom_script.validate_non_zero_rate"
    },
    "Notification Settings": {
        "on_update": "erp_dacsinc_custom.custom_script.share_notification_settings"
    }
    # "Material Request": {
    #     "validate": "erp_dacsinc_custom.custom_script.validate_non_zero_rate",
    # }
}



# jinjafiles = [
#     "erp_dacsinc_custom.custom_lead.sort_by_order",
#     "erp_dacsinc_custom.custom_lead.sort_closure_months", # Add this line
#     # Add other filters if you have them
# ]
# Scheduled Tasks
# ---------------

scheduler_events = {
    "cron": {
        # CRM reports. Each period runs on its own slot so the send time is
        # explicit rather than derived inside one job.
        #   daily   — 8:00 PM every day
        #   weekly  — 7:45 PM Friday, covering Sunday to Friday
        #   monthly — 7:30 PM, and the job itself exits unless it is the last
        #             day of the month (cron cannot express "last day")
        "0 20 * * *": [
            "erp_dacsinc_custom.notifications.send_daily_crm_report"
        ],
        "45 19 * * 5": [
            "erp_dacsinc_custom.notifications.send_weekly_crm_report"
        ],
        "30 19 * * *": [
            "erp_dacsinc_custom.notifications.send_monthly_crm_report"
        ],
        "0 2 * * *": [
            "erp_dacsinc_custom.custom_leave.cancel_expired_leave_ledger_entries"
        ]
    },
	# "all": [
	# 	"erp_dacsinc_custom.tasks.all"
	# ],
	# "daily": [
	# 	"erp_dacsinc_custom.tasks.daily"
	# ],
	# "hourly": [
	# 	"erp_dacsinc_custom.tasks.hourly"
	# ],
	# "weekly": [
	# 	"erp_dacsinc_custom.tasks.weekly"
	# ],
	"monthly": [
		"erp_dacsinc_custom.custom_leave.allocate_monthly_leaves"
	],
}

# Testing
# -------

# before_tests = "erp_dacsinc_custom.install.before_tests"

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "erp_dacsinc_custom.event.get_events"
# }

# Map Purchase Receipt to Purchase Invoice
override_whitelisted_methods = {
    "erpnext.stock.doctype.purchase_receipt.purchase_receipt.make_purchase_invoice": "erp_dacsinc_custom.purchase_order.make_purchase_invoice_custom"
}


#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "erp_dacsinc_custom.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["erp_dacsinc_custom.utils.before_request"]
# after_request = ["erp_dacsinc_custom.utils.after_request"]

# Job Events
# ----------
# before_job = ["erp_dacsinc_custom.utils.before_job"]
# after_job = ["erp_dacsinc_custom.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"erp_dacsinc_custom.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

