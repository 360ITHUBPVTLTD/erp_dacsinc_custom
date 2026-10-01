// Copyright (c) 2025, Pankaj and contributors
// For license information, please see license.txt

frappe.ui.form.on("Admin Settings", {
	setup(frm) {
		// Customer › who may change POS Store / Industry / Merchandiser User: Access Sheet roles (and Admin) only
		frm.set_query("customer_protected_field_roles", () => ({
			query: "erp_dacsinc_custom.erp_dacsinc_custom.doctype.admin_settings.admin_settings.access_role_query",
		}));
	},
});
