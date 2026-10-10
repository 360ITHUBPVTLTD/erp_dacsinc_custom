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
    "/assets/erp_dacsinc_custom/js/print_prompt.js?v=1.0.0"
]

app_include_css = [
    "/assets/erp_dacsinc_custom/style.css?v=1.0.5",
    "/assets/erp_dacsinc_custom/css/order_flow.css?v=1.0.10"
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
    # Close the POS: tables exist and the entry loads its opening amounts / invoices
    "POS Closing Entry": "public/js/pos_closing_entry.js",
	"Lead": "public/js/lead.js",
	"Sales Order": "public/js/sales_order.js",
	"Item": "public/js/item.js",
	"Purchase Order": ["public/js/so_qty_cap.js", "public/js/purchase_order.js"],
	"Purchase Invoice": "public/js/purchase_invoice.js",
	"Material Request": ["public/js/so_qty_cap.js", "public/js/material_request.js", "public/js/pos_stock.js"],
	"Stock Entry": "public/js/pos_stock.js",
	"BOM": "public/js/bom.js",
	"Sales Invoice": "public/js/sales_invoice.js",
	"Delivery Note": "public/js/delivery_note.js",
	"Pick List": "public/js/pick_list.js",
	"Customer": "public/js/customer.js"
}
doctype_list_js = {
	"Lead": "public/js/lead_list.js",
  "Employee": "public/js/employee_list.js",
	"Sales Order": "public/js/sales_order_list.js",
	"Item": "public/js/item_list.js",
	"BOM": "public/js/bom_list.js",
	"Customer": "public/js/customer_list.js",
	"Warehouse": "public/js/warehouse_list.js"
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

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
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
        "before_insert": "erp_dacsinc_custom.custom_script.before_insert",
        "after_insert": "erp_dacsinc_custom.custom_script.after_insert_quotation",
        "on_update": "erp_dacsinc_custom.custom_script.on_update_quotation",
        "on_submit": "erp_dacsinc_custom.custom_script.quotation_on_submit",
        "validate": ["erp_dacsinc_custom.custom_script.validate_non_zero_rate",
                        "erp_dacsinc_custom.custom_script.validate_quotation"]
        # "on_cancel": "erp_dacsinc_custom.custom_script.quotation_on_cancel"
    },
    "Sales Invoice": {
        # no second draft for the same source line (draft_guard.py)
        "before_insert": "erp_dacsinc_custom.draft_guard.guard_duplicate_draft",
        "before_validate": "erp_dacsinc_custom.custom_script.lock_item_rate_to_sales_order_early",
        "validate": [
            "erp_dacsinc_custom.custom_script.lock_item_rate_to_sales_order",
            "erp_dacsinc_custom.custom_script.guard_si_items_locked_to_pick_list",
            "erp_dacsinc_custom.custom_script.validate_non_zero_rate",
            "erp_dacsinc_custom.custom_script.sales_invoice_validate"
        ],
        "before_submit": [
            "erp_dacsinc_custom.custom_script.guard_so_fulfillment_route_lock",
            # stock held for another Sales Order can't go out (stock_hold.py)
            "erp_dacsinc_custom.stock_hold.guard_sales_invoice",
        ],
        "before_cancel": "erp_dacsinc_custom.stock_hold.guard_cancel",
        "on_submit": "erp_dacsinc_custom.custom_script.update_pick_lists_on_stock_si_submit",
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
        "on_trash": "erp_dacsinc_custom.custom_script.sales_order_on_trash",
        "before_insert": "erp_dacsinc_custom.custom_script.sales_order_before_insert",
       "before_validate": "erp_dacsinc_custom.custom_script.sales_order_before_insert",
       "validate": "erp_dacsinc_custom.custom_script.validate_non_zero_rate"
    },
    "Delivery Note": {
        # no second draft for the same source line (draft_guard.py)
        "before_insert": "erp_dacsinc_custom.draft_guard.guard_duplicate_draft",
        "before_validate": "erp_dacsinc_custom.custom_script.lock_item_rate_to_sales_order_early",
        "validate": [
            "erp_dacsinc_custom.custom_script.lock_item_rate_to_sales_order",
            "erp_dacsinc_custom.custom_script.guard_dn_items_locked_to_pick_list",
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
        # no second draft for the same source line (draft_guard.py)
        "before_insert": "erp_dacsinc_custom.draft_guard.guard_duplicate_draft",
        "validate": "erp_dacsinc_custom.procurement_purpose.set_procurement_purpose",
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
        "on_update": "erp_dacsinc_custom.party_address.on_address_save",
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
        "validate": "erp_dacsinc_custom.custom_customer.guard_protected_customer_fields",
        "on_update": "erp_dacsinc_custom.custom_customer.update_customer_sharing"
    },
    "Purchase Order": {
        # no second draft for the same source line (draft_guard.py)
        "before_insert": "erp_dacsinc_custom.draft_guard.guard_duplicate_draft",
        # before_validate, so it lands before buying_controller's own
        # validate_from_warehouse — it clears a source warehouse that merely
        # equals the target, which is the form a stale Material Request value
        # arrives in and the only form ERPNext would reject anyway.
        "before_validate": "erp_dacsinc_custom.custom_script.clear_po_from_warehouse_when_same_as_target",
        "validate": [
            "erp_dacsinc_custom.custom_script.validate_non_zero_rate",
            # Merchandiser User: Subcontract POs only (custom_script)
            "erp_dacsinc_custom.custom_script.guard_merchandiser_plain_po",
            "erp_dacsinc_custom.custom_script.guard_po_item_not_over_so_need",
            "erp_dacsinc_custom.procurement_purpose.set_procurement_purpose",
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
        "before_submit": [
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
        ],
        "before_cancel": "erp_dacsinc_custom.stock_hold.guard_cancel",
        "on_cancel": "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
    },
    "Stock Reconciliation": {
        "before_submit": "erp_dacsinc_custom.stock_hold.guard_stock_reconciliation",
        "before_cancel": "erp_dacsinc_custom.stock_hold.guard_cancel",
    },
    "Purchase Invoice": {
        # no second draft for the same source line (draft_guard.py)
        "before_insert": "erp_dacsinc_custom.draft_guard.guard_duplicate_draft",
        "validate": "erp_dacsinc_custom.custom_script.validate_non_zero_rate",
        "before_submit": "erp_dacsinc_custom.stock_hold.guard_return",
        "before_cancel": "erp_dacsinc_custom.stock_hold.guard_cancel",
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
            # no second draft for the same source line (draft_guard.py)
            "erp_dacsinc_custom.draft_guard.guard_duplicate_draft",
        ],
        # POS Requests only: email the request on submit (Admin Settings › POS Emails).
        "on_submit": "erp_dacsinc_custom.pos_notify.send_pos_mr_email",
        "before_validate": [
            # POS users' MRs are always Material Transfer (pos_notify) — before the next line.
            "erp_dacsinc_custom.pos_notify.force_pos_transfer_type",
            "erp_dacsinc_custom.custom_script.clear_mr_from_warehouse_unless_transfer",
        ],
        "validate": [
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
        "on_cancel": "erp_dacsinc_custom.order_flow_api.broadcast_order_flow_change",
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
override_whitelisted_methods = {
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

