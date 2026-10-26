// Bulk Payment form (docs/bulk-payment.md). Rows carry their party / invoice type from the header (the
// server checks the links before any hook); "Pick Invoices" opens the Receive / Pay prompt
// (public/js/bulk_payment.js) and fills the table; a submitted one prints its receipt.
frappe.ui.form.on("Bulk Payment", {
	setup(frm) {
		frm.set_query("mode_of_payment", () => ({ filters: { enabled: 1, custom_show_in_payment_entry: 1 } }));
		frm.set_query("reference_name", "allocations", (doc, cdt, cdn) => {
			const row = locals[cdt][cdn];
			const party_field = doc.payment_type === "Pay" ? "supplier" : "customer";
			return { filters: Object.assign({ docstatus: 1, is_return: 0, outstanding_amount: [">", 0], company: doc.company },
				row.party ? { [party_field]: row.party } : {}) };
		});
	},
	onload(frm) {
		if (frm.is_new() && !frm.doc.company) frm.set_value("company", frappe.defaults.get_user_default("Company"));
	},
	refresh(frm) {
		frm.trigger("set_row_types");
		if (frm.doc.docstatus === 0) {
			frm.add_custom_button(__("Pick Invoices"), () =>
				frappe.require("/assets/erp_dacsinc_custom/js/bulk_payment.js", () => dacs_bulk_payment_dialog({ frm })))
				.addClass("btn-primary");
		}
		if (frm.doc.docstatus === 1) {
			frm.add_custom_button(__("Print Receipt"), () => window.open(dacs_print_url("Bulk Payment", frm.doc.name), "_blank"))
				.css({ "background-color": "#000", "color": "#fff" });
			frm.set_intro(__("Payment Entries made: {0}. Cancel this Bulk Payment to cancel them all together.", [frm.doc.payment_entries || "—"]), "green");
		}
	},
	payment_type(frm) {
		frm.set_value("party_type", frm.doc.payment_type === "Pay" ? "Supplier" : "Customer");
		frm.clear_table("allocations");
		frm.refresh_field("allocations");
	},
	set_row_types(frm) {
		const pt = frm.doc.payment_type === "Pay" ? "Supplier" : "Customer";
		const dt = frm.doc.payment_type === "Pay" ? "Purchase Invoice" : "Sales Invoice";
		(frm.doc.allocations || []).forEach(r => { r.party_type = pt; r.reference_doctype = dt; });
	},
	allocations_add(frm, cdt, cdn) {
		frappe.model.set_value(cdt, cdn, "party_type", frm.doc.payment_type === "Pay" ? "Supplier" : "Customer");
		frappe.model.set_value(cdt, cdn, "reference_doctype", frm.doc.payment_type === "Pay" ? "Purchase Invoice" : "Sales Invoice");
	},
	before_save(frm) { frm.trigger("set_row_types"); },
});
