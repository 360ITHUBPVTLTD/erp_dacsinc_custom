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
# Customer form / list: may this user change POS Store / Industry / Merchandiser User (custom_customer.py)
extend_bootinfo = "erp_dacsinc_custom.custom_customer.extend_bootinfo"

app_include_js = [
    "/assets/erp_dacsinc_custom/js/workflow.js?v=1.0.7",
    "/assets/erp_dacsinc_custom/js/toogle.js?v=1.0.5",
    # "Print it now?" after creating SI / PO / embroidery documents (MOM 8 Oct 2026)
    "/assets/erp_dacsinc_custom/js/print_prompt.js?v=1.0.5",
    # All · Normal · Returns on the SI / DN / PI / PR lists (called by their *_list.js)
    "/assets/erp_dacsinc_custom/js/return_list_toggle.js?v=1.0.0",
    # outstanding balance on the Customer / Supplier lists (called by their *_list.js)
    "/assets/erp_dacsinc_custom/js/party_balance_list.js?v=1.0.5",
    # one "Search everything" box on the Customer / Supplier lists (called by their *_list.js)
    "/assets/erp_dacsinc_custom/js/party_list_search.js?v=1.0.0",
    # list filter boxes match parts of words: "mo ra" finds "Mohan Madhan Raj" (list_words.js)
    "/assets/erp_dacsinc_custom/js/list_words.js?v=1.0.0",
    # POS store requests board + dialogs (workspace block and Material Request form) — bump ?v= on change
    "/assets/erp_dacsinc_custom/js/pos_requests_board.js?v=1.0.6",
    # Overall discount skips items ticked "Exclude from Overall Discount" (overall_discount.py)
    "/assets/erp_dacsinc_custom/js/overall_discount.js?v=1.0.1",
    # Workspace shortcuts without a count filter are not counted (single DocTypes have no table)
    "/assets/erp_dacsinc_custom/js/shortcut_count_fix.js?v=1.0.0",
    # "Add charges": freight / packing / insurance lines at the goods' GST rate (docs/charges.md)
    "/assets/erp_dacsinc_custom/js/charges.js?v=1.0.1"
]

app_include_css = [
    "/assets/erp_dacsinc_custom/style.css?v=1.0.5",
    "/assets/erp_dacsinc_custom/css/order_flow.css?v=1.0.12"
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
# Point of Sale: walk-in name / mobile under the customer, loading indicator (pos_walkin.py)
page_js = {"point-of-sale": "public/js/pos_page_extend.js"}

# include js in doctype views  
doctype_js = {
    # Mode of Payment: only modes ticked "Show in Payment Entry" (payment_modes.py)
    "Payment Entry": "public/js/payment_entry.js",
    # filled in from the "Adjust" links on Credit / Debit Notes (Order Flow › Finance › Returns / Notes)
    "Payment Reconciliation": "public/js/payment_reconciliation.js",
    # Close the POS: tables exist and the entry loads its opening amounts / invoices
    "POS Closing Entry": "public/js/pos_closing_entry.js",
	"Lead": "public/js/lead.js",
	"Sales Order": ["public/js/sales_order.js", "public/js/merchant_export.js"],
	"Item": "public/js/item.js",
	"Purchase Order": ["public/js/so_qty_cap.js", "public/js/purchase_order.js"],
	"Purchase Invoice": "public/js/purchase_invoice.js",
	"Material Request": ["public/js/so_qty_cap.js", "public/js/material_request.js", "public/js/pos_stock.js"],
	"Stock Entry": "public/js/pos_stock.js",
	"BOM": "public/js/bom.js",
	"Sales Invoice": ["public/js/sales_invoice.js", "public/js/merchant_export.js"],
	"Delivery Note": ["public/js/delivery_note.js", "public/js/merchant_export.js"],
	# the "Merchant Export - GST 0.1%" tick (merchant_export.py)
	"Quotation": "public/js/merchant_export.js",
	# Purchase Return: Debit Note status + "Make Debit Note" (return_goods.py)
	"Purchase Receipt": "public/js/purchase_receipt.js",
	"Pick List": "public/js/pick_list.js",
	# Account Summary at the top of the form (public/js/party_summary.js, party_balance.py)
	"Customer": ["public/js/customer.js", "public/js/party_summary.js"],
	"Supplier": "public/js/party_summary.js",
	# "Outstanding" → Group Outstanding page (party_group.py)
	"Customer Group": "public/js/party_group_form.js",
	"Supplier Group": "public/js/party_group_form.js",
	# job work is received from the Sub PO ("Receive Finished Goods"), not from the SCO
	"Subcontracting Order": "public/js/subcontracting_order.js"
}
doctype_list_js = {
	"Lead": "public/js/lead_list.js",
  "Employee": "public/js/employee_list.js",
	"Sales Order": "public/js/sales_order_list.js",
	"Item": "public/js/item_list.js",
	"BOM": "public/js/bom_list.js",
	"Customer": "public/js/customer_list.js",
	"Warehouse": "public/js/warehouse_list.js",
	# All · Normal · Returns buttons (public/js/return_list_toggle.js)
	"Sales Invoice": "public/js/sales_invoice_list.js",
	"Delivery Note": "public/js/delivery_note_list.js",
	"Purchase Invoice": "public/js/purchase_invoice_list.js",
	"Purchase Receipt": "public/js/purchase_receipt_list.js",
	# outstanding balance on each row (public/js/party_balance_list.js)
	"Supplier": "public/js/supplier_list.js",
	# Receive / Pay and the Journal Entry prompt, as on Order Flow › Finance › New
	"Payment Entry": "public/js/payment_entry_list.js",
	"Journal Entry": "public/js/journal_entry_list.js",
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

# A merchandiser sees their own work and nothing else: the Sales Orders of
# the customers assigned to them plus any they raised themselves, and every
# document hanging off those orders. Both hooks are needed for each doctype —
# permission_query_conditions filters the LIST, has_permission gates opening
# one by URL. Registering only the first is what let a merchandiser reach any
# hidden order by pasting its link.
permission_query_conditions = {
    "Sales Order": "erp_dacsinc_custom.custom_script.get_sales_order_permission_query_conditions",
    "Pick List": "erp_dacsinc_custom.custom_script.get_pick_list_permission_query_conditions",
    "Purchase Order": "erp_dacsinc_custom.custom_script.get_purchase_order_permission_query_conditions",
    # Merchandiser User: the SCOs of the orders they may see (via the SCO's Purchase Order).
    "Subcontracting Order": "erp_dacsinc_custom.custom_script.get_subcontracting_order_permission_query_conditions",
    "Material Request": [
        "erp_dacsinc_custom.custom_script.get_material_request_permission_query_conditions",
        "erp_dacsinc_custom.pos_scope.material_request_query",
        # View-only HO approvers (e.g. Warehouse Incharge) see POS store requests only.
        "erp_dacsinc_custom.pos_request.material_request_query",
    ],
    "Stock Entry": [
        "erp_dacsinc_custom.pos_scope.stock_entry_query",
        # Merchandiser User: the jobber transfers of their own orders (custom_script)
        "erp_dacsinc_custom.custom_script.get_stock_entry_merchandiser_conditions",
    ],
    # POS logins see the Items of their stores' brands (POS Profile › Brands).
    "Item": "erp_dacsinc_custom.pos_scope.item_query",
    "Delivery Note": "erp_dacsinc_custom.custom_script.get_delivery_note_permission_query_conditions",
    "Sales Invoice": [
        "erp_dacsinc_custom.custom_script.get_sales_invoice_permission_query_conditions",
        # POS Admin: only POS Sales Invoices (pos_scope.py).
        "erp_dacsinc_custom.pos_scope.sales_invoice_query",
    ],
    "Purchase Receipt": "erp_dacsinc_custom.custom_script.get_purchase_receipt_permission_query_conditions",
    # Merchandiser User: their customers; POS roles: store-wise (pos_scope.py);
    # pick-only users: no list (master_guard.py). Each returns "" for everyone else.
    "Customer": [
        "erp_dacsinc_custom.custom_script.get_customer_permission_query_conditions",
        "erp_dacsinc_custom.pos_scope.customer_query",
        "erp_dacsinc_custom.master_guard.customer_query",
    ],
    "Supplier": "erp_dacsinc_custom.master_guard.supplier_query",
    "Item Price": "erp_dacsinc_custom.master_guard.item_price_query",
    "POS Invoice": "erp_dacsinc_custom.pos_scope.pos_invoice_query",
    "POS Opening Entry": "erp_dacsinc_custom.pos_scope.pos_opening_query",
    "POS Closing Entry": "erp_dacsinc_custom.pos_scope.pos_closing_query",
    "POS Profile": "erp_dacsinc_custom.pos_scope.pos_profile_query",
}

has_permission = {
    "Sales Order": "erp_dacsinc_custom.custom_script.has_sales_order_permission",
    "Pick List": "erp_dacsinc_custom.custom_script.has_pick_list_permission",
    "Purchase Order": "erp_dacsinc_custom.custom_script.has_purchase_order_permission",
    "Subcontracting Order": "erp_dacsinc_custom.custom_script.has_subcontracting_order_permission",
    "Material Request": [
        "erp_dacsinc_custom.custom_script.has_material_request_permission",
        "erp_dacsinc_custom.pos_scope.has_material_request_permission",
        "erp_dacsinc_custom.pos_request.has_material_request_permission",
    ],
    "Stock Entry": [
        "erp_dacsinc_custom.pos_scope.has_stock_entry_permission",
        "erp_dacsinc_custom.custom_script.has_stock_entry_merchandiser_permission",
    ],
    "Item": "erp_dacsinc_custom.pos_scope.has_item_permission",
    "Delivery Note": "erp_dacsinc_custom.custom_script.has_delivery_note_permission",
    "Sales Invoice": [
        "erp_dacsinc_custom.custom_script.has_sales_invoice_permission",
        "erp_dacsinc_custom.pos_scope.has_sales_invoice_permission",
    ],
    "Purchase Receipt": "erp_dacsinc_custom.custom_script.has_purchase_receipt_permission",
    # Evaluated last-first; the first non-None answer wins.
    "Customer": [
        "erp_dacsinc_custom.custom_script.has_customer_permission",
        "erp_dacsinc_custom.pos_scope.has_customer_permission",
        "erp_dacsinc_custom.master_guard.has_permission",
    ],
    "Supplier": "erp_dacsinc_custom.master_guard.has_permission",
    "Item Price": "erp_dacsinc_custom.master_guard.has_permission",
    # contents only for those who may edit it (read stays for everyone else's server-side use)
    "Admin Settings": "erp_dacsinc_custom.erp_dacsinc_custom.doctype.admin_settings.admin_settings.has_permission",
    "POS Invoice": "erp_dacsinc_custom.pos_scope.has_store_permission",
    "POS Opening Entry": "erp_dacsinc_custom.pos_scope.has_store_permission",
    "POS Closing Entry": "erp_dacsinc_custom.pos_scope.has_store_permission",
    "POS Profile": "erp_dacsinc_custom.pos_scope.has_pos_profile_permission",
}


# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document numbers PREFIX/26-27/00001: .FYS. is the short financial year (naming.py, docs/naming-series.md)
naming_series_variables = {"FYS": "erp_dacsinc_custom.naming.short_fiscal_year"}

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
    # the series of a new sales / purchase / stock / payment document, never picked by hand (naming.py)
    "*": {"before_insert": "erp_dacsinc_custom.naming.set_series"},
    "Unreconcile Payment": {
        # not on a Bulk Payment's Payment Entry (bulk_payment.py)
        "before_submit": "erp_dacsinc_custom.erp_dacsinc_custom.doctype.bulk_payment.bulk_payment.unreconcile_before_submit",
    },
    # A Quotation shared with a DAC CRM user can be submitted by them (quotation_sharing.py)
    "DocShare": {
        "after_insert": "erp_dacsinc_custom.quotation_sharing.grant_submit_on_quotation_share",
        "on_update": "erp_dacsinc_custom.quotation_sharing.grant_submit_on_quotation_share",
    },
    # Finance tab: another user's payment changes outstanding amounts — tell open dashboards
    "Payment Entry": {
        "on_trash": "erp_dacsinc_custom.erp_dacsinc_custom.doctype.bulk_payment.bulk_payment.payment_entry_on_trash",
        "on_submit": "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
        "on_cancel": [
            # an entry of a Bulk Payment may be cancelled on its own: the Bulk Payment becomes Partly Cancelled,
            # or Cancelled with its last entry (bulk_payment.py)
            "erp_dacsinc_custom.erp_dacsinc_custom.doctype.bulk_payment.bulk_payment.payment_entry_on_cancel",
            "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
        ],
    },
    # Role Permission Manager edits reach the access sheet (access_reverse.py).
    "Custom DocPerm": {
        "after_insert": "erp_dacsinc_custom.access_reverse.on_custom_docperm_change",
        "on_update": "erp_dacsinc_custom.access_reverse.on_custom_docperm_change",
        "on_trash": "erp_dacsinc_custom.access_reverse.on_custom_docperm_change",
    },
    # Submitted closing → sales report email with Excel (pos_notify.py).
    # Cash in the drawer: counted / handed over / left, a reason for any short or extra (pos_cash.py).
    "POS Closing Entry": {
        "validate": "erp_dacsinc_custom.pos_cash.closing_validate",
        "before_submit": "erp_dacsinc_custom.pos_cash.closing_before_submit",
        "on_submit": "erp_dacsinc_custom.pos_notify.send_closing_report",
    },
    # Card / UPI open at 0; the cash opening is carried from the last closing, or has a reason.
    "POS Opening Entry": {
        "validate": "erp_dacsinc_custom.pos_cash.opening_validate",
    },
    # A customer's first POS Invoice gives them that store (pos_scope.py).
    "POS Invoice": {
        # GST 0.1% lines only for a merchant exporter (merchant_export.py)
        "validate": "erp_dacsinc_custom.merchant_export.guard_merchant_export",
        "on_update": "erp_dacsinc_custom.pos_scope.set_store_from_pos_invoice",
    },
    # A page / report whose Custom Role the access sheet manages keeps the roles
    # set on the page / report itself (access_sync.on_page_update).
    "Page": {"on_update": "erp_dacsinc_custom.access_sync.on_page_update"},
    "Report": {"on_update": "erp_dacsinc_custom.access_sync.on_report_update"},
    # Flagging a role for the access sheet gives it its Role Profile at once.
    "Role": {
        "on_update": "erp_dacsinc_custom.access_sync.on_role_update",
    },
    "User": {
        "before_validate": "erp_dacsinc_custom.erp_dacsinc_custom.doctype.user_access_profile.user_access_profile.guard_role_profile_name",
        "on_update": "erp_dacsinc_custom.erp_dacsinc_custom.doctype.user_access_profile.user_access_profile.resync_after_user_save",
    },
    "Item": {
        # Barcode field → Barcodes table, before ERPNext's own barcode check (item_barcode.py)
        "before_validate": "erp_dacsinc_custom.item_barcode.before_validate",
        "validate": "erp_dacsinc_custom.custom_script.item_before_save",
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
        "before_validate": [
            "erp_dacsinc_custom.tax_category.set_document_tax_category",
            # the "Merchant Export - GST 0.1%" tick puts every line on GST 0.1% (merchant_export.py)
            "erp_dacsinc_custom.merchant_export.apply_document_tick",
        ],
        "before_insert": "erp_dacsinc_custom.custom_script.before_insert",
        "after_insert": "erp_dacsinc_custom.custom_script.after_insert_quotation",
        "on_update": "erp_dacsinc_custom.custom_script.on_update_quotation",
        "on_submit": "erp_dacsinc_custom.custom_script.quotation_on_submit",
        "validate": ["erp_dacsinc_custom.custom_script.validate_non_zero_rate",
                        "erp_dacsinc_custom.custom_script.validate_quotation",
                        # GST 0.1% lines only for a merchant exporter (merchant_export.py)
                        "erp_dacsinc_custom.merchant_export.guard_merchant_export"]
        # "on_cancel": "erp_dacsinc_custom.custom_script.quotation_on_cancel"
    },
    "Sales Invoice": {
        # no second draft for the same source line (draft_guard.py)
        "before_insert": "erp_dacsinc_custom.draft_guard.guard_duplicate_draft",
        "before_validate": [
            "erp_dacsinc_custom.custom_script.lock_item_rate_to_sales_order_early",
            "erp_dacsinc_custom.tax_category.set_document_tax_category",
            # the "Merchant Export - GST 0.1%" tick puts every line on GST 0.1% (merchant_export.py)
            "erp_dacsinc_custom.merchant_export.apply_document_tick",
            # direct invoice ticks Update Stock; from Delivery Notes unticks it (si_stock.py)
            "erp_dacsinc_custom.si_stock.set_update_stock",
        ],
        "validate": [
            "erp_dacsinc_custom.custom_script.lock_item_rate_to_sales_order",
            "erp_dacsinc_custom.custom_script.guard_si_items_locked_to_pick_list",
            "erp_dacsinc_custom.custom_script.validate_non_zero_rate",
            "erp_dacsinc_custom.custom_script.sales_invoice_validate",
            # GST 0.1% lines only for a merchant exporter (merchant_export.py)
            "erp_dacsinc_custom.merchant_export.guard_merchant_export",
        ],
        "before_submit": [
            "erp_dacsinc_custom.custom_script.guard_so_fulfillment_route_lock",
            # stock held for another Sales Order can't go out (stock_hold.py)
            "erp_dacsinc_custom.stock_hold.guard_sales_invoice",
        ],
        "before_cancel": [
            # a Credit Note's own Sales Return goes first (return_goods.py)
            "erp_dacsinc_custom.return_goods.on_note_cancel",
            # paid by a Bulk Payment: cancel that first (bulk_payment.py)
            "erp_dacsinc_custom.erp_dacsinc_custom.doctype.bulk_payment.bulk_payment.invoice_before_cancel",
            "erp_dacsinc_custom.stock_hold.guard_cancel",
        ],
        "on_submit": [
            "erp_dacsinc_custom.custom_script.update_pick_lists_on_stock_si_submit",
            # Credit Note ticked "Update Stock (return the goods)": make + submit the Sales Return
            "erp_dacsinc_custom.return_goods.on_note_submit",
        ],
        "on_update": "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
        "on_cancel": [
            "erp_dacsinc_custom.custom_script.update_pick_lists_on_stock_si_cancel",
            "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
        ]
    },
    "Sales Order": {
        "on_submit": "erp_dacsinc_custom.custom_script.sales_order_on_submit",
        "on_cancel": [
            "erp_dacsinc_custom.custom_script.sales_order_on_cancel",
            "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
        ],
       "after_insert": "erp_dacsinc_custom.notifications.notify_on_new_so",
       "on_update": [
            "erp_dacsinc_custom.custom_script.sales_order_on_update",
            "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
            # after sales_order_on_update, which may set custom_lead_owner (so_share.py)
            "erp_dacsinc_custom.so_share.share_with_lead_owner",
       ],
        "on_update_after_submit": "erp_dacsinc_custom.so_share.share_with_lead_owner",
        # Close / Re-open / Hold set the status by db_set → the list's Order Stage (so_stage.py)
        "on_change": "erp_dacsinc_custom.so_stage.on_change",
        "on_trash": "erp_dacsinc_custom.custom_script.sales_order_on_trash",
        "before_insert": "erp_dacsinc_custom.custom_script.sales_order_before_insert",
       "before_validate": [
            "erp_dacsinc_custom.custom_script.sales_order_before_insert",
            "erp_dacsinc_custom.tax_category.set_document_tax_category",
            # the "Merchant Export - GST 0.1%" tick puts every line on GST 0.1% (merchant_export.py)
            "erp_dacsinc_custom.merchant_export.apply_document_tick",
        ],
       "validate": [
            "erp_dacsinc_custom.custom_script.validate_non_zero_rate",
            # GST 0.1% lines only for a merchant exporter (merchant_export.py)
            "erp_dacsinc_custom.merchant_export.guard_merchant_export",
       ],
    },
    "Delivery Note": {
        # no second draft for the same source line (draft_guard.py)
        "before_insert": "erp_dacsinc_custom.draft_guard.guard_duplicate_draft",
        "before_validate": [
            "erp_dacsinc_custom.custom_script.lock_item_rate_to_sales_order_early",
            "erp_dacsinc_custom.tax_category.set_document_tax_category",
            # the "Merchant Export - GST 0.1%" tick puts every line on GST 0.1% (merchant_export.py)
            "erp_dacsinc_custom.merchant_export.apply_document_tick",
        ],
        "validate": [
            "erp_dacsinc_custom.custom_script.lock_item_rate_to_sales_order",
            "erp_dacsinc_custom.custom_script.guard_dn_items_locked_to_pick_list",
            # GST 0.1% lines only for a merchant exporter (merchant_export.py)
            "erp_dacsinc_custom.merchant_export.guard_merchant_export",
        ],
        "before_submit": [
            "erp_dacsinc_custom.custom_script.guard_so_fulfillment_route_lock",
            # only its own orders' held stock may be delivered (stock_hold.py)
            "erp_dacsinc_custom.stock_hold.guard_delivery_note",
        ],
        "before_cancel": "erp_dacsinc_custom.stock_hold.guard_cancel",
        "on_submit": "erp_dacsinc_custom.custom_script.update_pick_lists_on_dn_submit",
        "on_update": "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
        "on_cancel": [
            "erp_dacsinc_custom.custom_script.update_pick_lists_on_dn_cancel",
            "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
        ]
    },
    "BOM": {
        "on_submit": "erp_dacsinc_custom.bom_events.after_submit",
        "on_update_after_submit": "erp_dacsinc_custom.bom_events.on_update_after_submit",
        "on_cancel": "erp_dacsinc_custom.bom_events.on_cancel"
    },
    "Purchase Receipt": {
        # service line of a job-work receipt: the account its Subcontracting Receipt credited (job_work.py)
        "before_validate": [
            "erp_dacsinc_custom.job_work.match_subcontracting_receipt_account",
            # In-State / Out-State from the supplier's state, the right GST template (tax_category.py)
            "erp_dacsinc_custom.tax_category.set_document_tax_category",
        ],
        # no second draft for the same source line (draft_guard.py)
        "before_insert": "erp_dacsinc_custom.draft_guard.guard_duplicate_draft",
        "validate": [
            "erp_dacsinc_custom.procurement_purpose.set_procurement_purpose",
            # a service line has no warehouse (job_work.py) — no "No accounting entries…" message
            "erp_dacsinc_custom.job_work.clear_service_line_warehouse",
            # a Purchase Return only from the Debit Note (return_goods.py)
            "erp_dacsinc_custom.return_goods.guard_purchase_return_from_note",
        ],
        # a return sends stock back out; cancelling takes the received stock away (stock_hold.py)
        "before_submit": "erp_dacsinc_custom.stock_hold.guard_return",
        "before_cancel": "erp_dacsinc_custom.stock_hold.guard_cancel",
        "on_submit": "erp_dacsinc_custom.purchase_order.create_putaway_picklist",
        "on_update": "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
        "on_cancel": [
            "erp_dacsinc_custom.purchase_order.delete_putaway_picklist",
            "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
        ]
    },
    # "Customer": {
    #     "after_insert": "erp_dacsinc_custom.custom_customer.customer_after_insert",
    #     "on_update": "erp_dacsinc_custom.custom_customer.update_customer_sharing"
    # }
    "Address": {
        # its Customers / Suppliers without a primary address get this one (party_address.py)
        "after_insert": "erp_dacsinc_custom.party_address.on_address_save",
        "on_update": [
            "erp_dacsinc_custom.party_address.on_address_save",
            "erp_dacsinc_custom.tax_category.address_on_update",
        ],
    },
    "Role Profile": {
        # its access-sheet flag ticked / unticked locally → access/flagged_profiles.json
        "on_update": "erp_dacsinc_custom.access_sync.write_flagged_profiles",
    },
    "POS Profile": {
        # Store Name set / changed: bills of this store without one get it.
        "on_update": "erp_dacsinc_custom.pos_receipt_email.fill_store_names",
    },
    "Customer": {
        "before_insert": [
            "erp_dacsinc_custom.custom_customer.customer_before_insert",
            # POS staff's new customers belong to their store (pos_scope.py).
            "erp_dacsinc_custom.pos_scope.set_store_on_new_customer",
        ],
        "after_insert": "erp_dacsinc_custom.custom_customer.customer_after_insert",
        # POS Store / Industry / Merchandiser User: only the roles in Admin Settings › Customer
        "validate": [
            "erp_dacsinc_custom.custom_customer.guard_protected_customer_fields",
            "erp_dacsinc_custom.tax_category.customer_validate",
        ],
        "on_update": "erp_dacsinc_custom.custom_customer.update_customer_sharing"
    },
    # Tax Category follows the supplier's GSTIN / address (tax_category.py)
    "Supplier": {
        "validate": "erp_dacsinc_custom.tax_category.supplier_validate",
    },
    "Purchase Order": {
        # no second draft for the same source line (draft_guard.py)
        "before_insert": "erp_dacsinc_custom.draft_guard.guard_duplicate_draft",
        # before_validate, so it lands before buying_controller's own
        # validate_from_warehouse — it clears a source warehouse that merely
        # equals the target, which is the form a stale Material Request value
        # arrives in and the only form ERPNext would reject anyway.
        "before_validate": [
            "erp_dacsinc_custom.custom_script.clear_po_from_warehouse_when_same_as_target",
            # In-State / Out-State from the supplier's state, the right GST template (tax_category.py)
            "erp_dacsinc_custom.tax_category.set_document_tax_category",
        ],
        "validate": [
            "erp_dacsinc_custom.custom_script.validate_non_zero_rate",
            # Merchandiser User: Subcontract POs only (custom_script)
            "erp_dacsinc_custom.custom_script.guard_merchandiser_plain_po",
            "erp_dacsinc_custom.custom_script.guard_po_item_not_over_so_need",
            "erp_dacsinc_custom.procurement_purpose.set_procurement_purpose",
            # Subcontracted PO only on a jobber (Supplier › Is Jobber)
            "erp_dacsinc_custom.purchase_order.guard_subcontract_po_jobber",
            # lines from a Material Request: not more than it has open; not on another draft
            "erp_dacsinc_custom.purchase_order.guard_po_against_mr",
        ],
        # Subcontract PO: raw material for all its rows together must be the PO's own.
        "before_submit": "erp_dacsinc_custom.purchase_order.guard_subcontract_po_rm",
        "on_update": "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
        "on_cancel": "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
        # Never leave an Embroidery Work Order pointing at a PO/SCO that is gone.
        "before_cancel": "erp_dacsinc_custom.so_embroidery.guard_linked_embroidery",
        "on_trash": "erp_dacsinc_custom.so_embroidery.guard_linked_embroidery",
    },
    "Stock Entry": {
        # A subcontracting transfer is where raw material physically leaves,
        # so it is the point where one order's material actually becomes
        # another's. Both checks run before_submit (while the pools still
        # reflect the pre-transfer position) and BLOCK — picked stock, and
        # stock reserved for another Sales Order, never go to a jobber.
        # POS: "POS Transfer" tick on Stock Entries made from a POS login (pos_notify.py).
        "before_insert": "erp_dacsinc_custom.pos_notify.mark_pos_transfer",
        # POS Store Manager's own transfer: from their store; target another store / VV Puram (pos_scope).
        "before_validate": "erp_dacsinc_custom.pos_scope.enforce_se_warehouses",
        # POS store requests: HO's transfer tells the store; the status follows drafts too (pos_request.py).
        "after_insert": "erp_dacsinc_custom.pos_request.mail_store_on_transfer",
        "on_update": "erp_dacsinc_custom.pos_request.update_from_stock_entry",
        "on_trash": "erp_dacsinc_custom.pos_request.update_from_stock_entry",
        "before_submit": [
            # A transfer against a POS store request: only that store's POS user submits it (pos_request.py).
            "erp_dacsinc_custom.pos_request.guard_transfer_submit",
            # POS transfers to / from the supply warehouse need warehouse approval (pos_notify).
            "erp_dacsinc_custom.pos_notify.guard_pos_approval",
            # POS: a transfer into a store is submitted by that store (pos_scope).
            "erp_dacsinc_custom.pos_scope.guard_pos_transfer_submit",
            # Every purpose: stock held for a Sales Order (Pick Lists, embroidery, earmarks)
            # doesn't leave VV Puram (stock_hold.py).
            "erp_dacsinc_custom.stock_hold.guard_stock_entry",
            # Hard block first: stock a Pick List (draft or submitted) holds
            # for a delivery never goes to a jobber, whichever screen sends it.
            "erp_dacsinc_custom.custom_script.block_subcontract_transfer_of_picked_stock",
            "erp_dacsinc_custom.custom_script.flag_subcontract_rm_borrowing",
        ],
        "on_submit": [
            "erp_dacsinc_custom.custom_script.record_subcontract_rm_borrowing",
            # Stock moved (RM to a jobber, a receipt, a transfer) — open
            # Sales Orders / the Order Flow page refresh without a reload.
            "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
            # POS store requests follow their dispatch / receipt entries (pos_request.py).
            "erp_dacsinc_custom.pos_request.update_from_stock_entry",
        ],
        "before_cancel": "erp_dacsinc_custom.stock_hold.guard_cancel",
        "on_cancel": [
            "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
            "erp_dacsinc_custom.pos_request.update_from_stock_entry",
        ],
    },
    "Stock Reconciliation": {
        "before_submit": "erp_dacsinc_custom.stock_hold.guard_stock_reconciliation",
        "before_cancel": "erp_dacsinc_custom.stock_hold.guard_cancel",
    },
    "Purchase Invoice": {
        # no second draft for the same source line (draft_guard.py)
        "before_insert": "erp_dacsinc_custom.draft_guard.guard_duplicate_draft",
        # Debit Note: received qty follows qty, or later Debit Notes are refused (return_goods.py)
        "before_validate": [
            "erp_dacsinc_custom.return_goods.sync_debit_note_received_qty",
            # In-State / Out-State from the supplier's state, the right GST template (tax_category.py)
            "erp_dacsinc_custom.tax_category.set_document_tax_category",
        ],
        "validate": [
            "erp_dacsinc_custom.custom_script.validate_non_zero_rate",
            # goods only from a Purchase Receipt; Service items may be billed directly (purchase_bill.py)
            "erp_dacsinc_custom.purchase_bill.guard_direct_goods",
        ],
        "before_submit": "erp_dacsinc_custom.stock_hold.guard_return",
        "before_cancel": [
            "erp_dacsinc_custom.return_goods.on_note_cancel",
            # paid by a Bulk Payment: cancel that first (bulk_payment.py)
            "erp_dacsinc_custom.erp_dacsinc_custom.doctype.bulk_payment.bulk_payment.invoice_before_cancel",
            "erp_dacsinc_custom.stock_hold.guard_cancel",
        ],
        # Debit Note ticked "Update Stock (send the goods back)": make + submit the Purchase Return
        "on_submit": "erp_dacsinc_custom.return_goods.on_note_submit",
        "on_update": "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
        "on_cancel": "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
    },
    "Notification Settings": {
        "on_update": "erp_dacsinc_custom.custom_script.share_notification_settings"
    },
    "Material Request": {
        # A hidden-but-still-stored Source Warehouse on a non-transfer MR is
        # what makes "Accepted Warehouse and Supplier Warehouse cannot be
        # same" fire later, on the PO made from it. Must be before_validate:
        # Material Request extends BuyingController too, so the controller's
        # own validate_from_warehouse would throw on the equal-warehouse case
        # before a plain "validate" hook ever ran.
        # POS: "POS Request" tick on MRs made from a POS login (pos_notify.py).
        "before_insert": [
            "erp_dacsinc_custom.pos_notify.mark_pos_request",
            # a POS Store Manager's request starts as Draft for HO approval (pos_request.py)
            "erp_dacsinc_custom.pos_request.mark_request",
            # no second draft for the same source line (draft_guard.py)
            "erp_dacsinc_custom.draft_guard.guard_duplicate_draft",
        ],
        # POS store requests: submitting one is HO's approval (pos_request.py).
        "before_submit": "erp_dacsinc_custom.pos_request.guard_submit",
        "on_submit": "erp_dacsinc_custom.pos_request.on_submit",
        "before_validate": [
            # POS users' MRs are always Material Transfer (pos_notify) — before the next line.
            "erp_dacsinc_custom.pos_notify.force_pos_transfer_type",
            # POS Store Manager: source VV Puram, target their store, header and rows (pos_scope).
            "erp_dacsinc_custom.pos_scope.enforce_mr_warehouses",
            "erp_dacsinc_custom.custom_script.clear_mr_from_warehouse_unless_transfer",
        ],
        "validate": [
            # POS request status is set only by pos_request.py; frozen while HO reviews it.
            "erp_dacsinc_custom.pos_request.guard_edit",
            "erp_dacsinc_custom.custom_script.validate_material_request_no_bom_items",
            # Mirrors guard_po_item_not_over_so_need — without it the
            # over-order cap could be walked around by requesting the excess
            # on a Material Request and then converting that to a PO.
            "erp_dacsinc_custom.custom_script.guard_mr_item_not_over_so_need",
            # Records Raw Material vs For Sale on each line, so the RM
            # allocation reads it instead of re-deriving it later.
            "erp_dacsinc_custom.procurement_purpose.set_procurement_purpose",
            # Raw-material rows against a Sales Order can't ask for more than
            # that order's own RM shortfall — after set_procurement_purpose,
            # which is what marks a row as Raw Material.
            "erp_dacsinc_custom.custom_script.guard_mr_rm_not_over_so_shortfall",
        ],
        "on_update": "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
        "on_cancel": [
            "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
            "erp_dacsinc_custom.pos_request.on_cancel",
        ],
    },
    "Pick List": {
        # A Pick List can't be finalised while some of its qty is still out
        # at a Full Piece embroidery jobber — see so_embroidery.py.
        "before_submit": [
            "erp_dacsinc_custom.so_embroidery.guard_pick_list_submit",
            # can't pick more than is free of other orders' holds (stock_hold.py)
            "erp_dacsinc_custom.stock_hold.guard_pick_list_submit",
        ],
        # ...nor deleted / cut below the qty that is out at the jobber.
        "validate": "erp_dacsinc_custom.so_embroidery.guard_pick_list_hold_edit",
        # after ERPNext's own allocation: a draft only claims stock that is free for it (stock_hold.py)
        "before_save": "erp_dacsinc_custom.stock_hold.fit_pick_list_to_free",
        "on_trash": "erp_dacsinc_custom.so_embroidery.guard_pick_list_hold_edit",
        "on_update": "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
        "on_cancel": "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
    },
    "Subcontracting Order": {
        # no second draft for the same source line (draft_guard.py)
        "before_insert": "erp_dacsinc_custom.draft_guard.guard_duplicate_draft",
        "on_update": "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
        "on_cancel": "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
        # Never leave an Embroidery Work Order pointing at a PO/SCO that is gone.
        "before_cancel": "erp_dacsinc_custom.so_embroidery.guard_linked_embroidery",
        "on_trash": "erp_dacsinc_custom.so_embroidery.guard_linked_embroidery",
    },
    "Subcontracting Receipt": {
        # ITC-04: the challans (Send to Subcontractor) its goods went out on (job_work.py)
        "before_validate": "erp_dacsinc_custom.job_work.fill_itc04_references",
        # no second draft for the same source line (draft_guard.py)
        "before_insert": "erp_dacsinc_custom.draft_guard.guard_duplicate_draft",
        "before_submit": "erp_dacsinc_custom.stock_hold.guard_return",
        "before_cancel": "erp_dacsinc_custom.stock_hold.guard_cancel",
        "on_update": "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
        "on_cancel": "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
    },
    "Embroidery Work Order": {
        "on_update": "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
        "on_cancel": "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
    },
    "Uniform Embroidery Transfer": {
        # Not a submittable doctype — its Sent/Partially Received/Received
        # lifecycle is a plain status field, so on_update alone covers it;
        # there is no on_cancel to hook.
        "on_update": "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
    },
    "Admin Settings": {
        # The Order Flow page's role gate is derived from the six tab-role
        # fields on this Single — regenerate it whenever they change. See
        # order_flow_permissions.sync_order_flow_page_roles.
        #
        # sync_sales_order_final_approver_role keeps the bridge role for the
        # Sales Order Workflow's "Pending Final Approval" transition in sync
        # with the Sales Order Final Approval user list on this same Single.
        "on_update": [
            "erp_dacsinc_custom.order_flow_permissions.sync_order_flow_page_roles",
            "erp_dacsinc_custom.order_flow_permissions.sync_sales_order_final_approver_role",
            # Tab / sub-tab roles changed here reach the /roles-and-permissions tab sheet.
            "erp_dacsinc_custom.access_reverse.on_admin_settings_update",
        ]
    }
}

# Regenerates the Order Flow page's derived Custom Role, and the Sales Order
# Final Approver role assignments, on every deploy — so a fresh site (or one
# where nobody has touched Admin Settings yet) still ends up correct instead
# of relying on a one-shot patch that could drift from the real config over
# time.
after_migrate = [
    # Mode of Payment › "Show in Payment Entry" tick (payment_modes.py). Idempotent.
    "erp_dacsinc_custom.payment_modes.ensure_field",
    # POS store requests: fields, Goods In Transit warehouse, workspace board block (pos_request.py). Idempotent.
    "erp_dacsinc_custom.pos_request.setup",
    # Cash-in-the-drawer fields on POS Opening / Closing Entry (pos_cash.py). Idempotent.
    "erp_dacsinc_custom.pos_cash.create_fields",
    # Sheets changed locally and pushed with the code are taken once (access_sync).
    "erp_dacsinc_custom.access_sync.sync_from_bundle",
    "erp_dacsinc_custom.order_flow_permissions.sync_order_flow_page_roles",
    "erp_dacsinc_custom.order_flow_permissions.sync_sales_order_final_approver_role",
    # Records whether a purchase is raw material or goods to sell, so the RM
    # allocation reads it instead of inferring it. Idempotent.
    "erp_dacsinc_custom.procurement_purpose.create_procurement_purpose_fields",
    # LR Number / Signed Copy on Sales Invoice, for the Logistics tab. Idempotent.
    "erp_dacsinc_custom.logistics_tab.create_logistics_fields",
    # Embroidery hold fields on Pick List + the source-Pick-List field on
    # Embroidery Work Order Item, for Full Piece embroidery sent from a
    # Sales Order's own stock. Idempotent.
    "erp_dacsinc_custom.so_embroidery.create_embroidery_pick_list_fields",
    # POS Invoice › Store Name on bills without one, from their POS Profile.
    "erp_dacsinc_custom.pos_receipt_email.fill_store_names",
    # Role Profiles flagged for the access sheet by hand (Admin, HR, Employee…).
    "erp_dacsinc_custom.access_sync.apply_flagged_profiles",
    # Item / Quotation / SO / SI Item › "Exclude from Overall Discount". Idempotent.
    "erp_dacsinc_custom.overall_discount.create_fields",
]

# Ships these Custom Fields with the app rather than leaving them to be
# recreated by hand on each site.
fixtures = [
    {
        "dt": "Custom Field",
        "filters": [["name", "in", [
            "Material Request Item-custom_procurement_purpose",
            "Purchase Order Item-custom_procurement_purpose",
            "Purchase Receipt Item-custom_procurement_purpose",
            "Sales Invoice-custom_signed_copy",
        ]]],
    },
]



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
        # Runs at 00:45, shortly after HRMS' process_expired_allocation (~00:02),
        # to keep the window where balances read negative as short as practical.
        # Only touches the leave types listed under Mobile App Admin Settings >
        # Leave Types Exempt From Expiry.
        "45 0 * * *": [
            "erp_dacsinc_custom.custom_leave.clear_expiry_for_exempt_leave_types"
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
	# The Sales Order list's Order Stage for open orders: stock arriving for an
	# item changes orders the receipt doesn't name (so_stage.py).
	"hourly": [
		"erp_dacsinc_custom.so_stage.refresh_open"
	],
	# Nothing accumulates now that expiry entries are deleted rather than
	# cancelled; this only clears the backlog the old job left behind.
	"weekly": [
		"erp_dacsinc_custom.custom_leave.purge_cancelled_expiry_entries"
	],
	# Allocates 1 CL + 1 SL for the current month to employees in the branches
	# listed under Mobile App Admin Settings > Leave Policy Branches.
	# Current month only -- past months are never touched automatically.
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
# A store's shift is shared: its closing may carry bills of any of the store's users (pos_closing.py).
override_doctype_class = {
    "POS Closing Entry": "erp_dacsinc_custom.pos_closing.StorePOSClosingEntry",
}

override_whitelisted_methods = {
    # search by parts of words in every Link field: "mo ra" finds "Mohan Madhan Raj" (search_words.py)
    "frappe.desk.search.search_link": "erp_dacsinc_custom.search_words.search_link",
    "frappe.desk.search.search_widget": "erp_dacsinc_custom.search_words.search_widget",
    # Point of Sale: continue the store's open shift, not only one you opened (pos_cash.py)
    "erpnext.selling.page.point_of_sale.point_of_sale.check_opening_entry": "erp_dacsinc_custom.pos_cash.check_opening_entry",
    # POS Closing Entry form: the store's bills in the shift, by any user (pos_closing.py)
    "erpnext.accounts.doctype.pos_closing_entry.pos_closing_entry.get_pos_invoices": "erp_dacsinc_custom.pos_closing.get_pos_invoices",
    # Barcode scan in forms: POS logins only find their stores' brands (pos_scope.py)
    "erpnext.stock.utils.scan_barcode": "erp_dacsinc_custom.pos_scope.scan_barcode",
    # Global search without master records the user may not open (master_guard.py)
    "frappe.utils.global_search.search": "erp_dacsinc_custom.master_guard.global_search",
    "erpnext.stock.doctype.purchase_receipt.purchase_receipt.make_purchase_invoice": "erp_dacsinc_custom.purchase_order.make_purchase_invoice_custom",
    # POS Profile "Brands" table — see pos_brand_filter.py
    "erpnext.selling.page.point_of_sale.point_of_sale.get_items": "erp_dacsinc_custom.pos_brand_filter.get_items",
    # Recent Orders also searches the walk-in name / mobile — see pos_walkin.py
    "erpnext.selling.page.point_of_sale.point_of_sale.get_past_order_list": "erp_dacsinc_custom.pos_walkin.get_past_order_list",
    # Role Permission Manager: the core action, then the access sheet follows (access_reverse.py)
    "frappe.core.page.permission_manager.permission_manager.add": "erp_dacsinc_custom.access_reverse.rpm_add",
    "frappe.core.page.permission_manager.permission_manager.update": "erp_dacsinc_custom.access_reverse.rpm_update",
    "frappe.core.page.permission_manager.permission_manager.remove": "erp_dacsinc_custom.access_reverse.rpm_remove",
    "frappe.core.page.permission_manager.permission_manager.reset": "erp_dacsinc_custom.access_reverse.rpm_reset",
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
# Link search on Customer / Supplier / Item Price for pick-only users: capped rows.
before_request = [
    "erp_dacsinc_custom.master_guard.before_request",
    # Reports run by POS logins: their brands' items and their stores' warehouses only.
    "erp_dacsinc_custom.pos_report_scope.install",
]
# Prepared reports run in the background: the same report rule there.
before_job = ["erp_dacsinc_custom.pos_report_scope.install"]
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

