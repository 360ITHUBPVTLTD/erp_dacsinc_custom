// Customer Group / Supplier Group form: "Outstanding" opens Group Outstanding for this group (party_group.py,
// docs/bulk-payment.md › Group payment) — what every member owes, and one payment for all of them.
["Customer Group", "Supplier Group"].forEach(dt => frappe.ui.form.on(dt, {
	refresh(frm) {
		if (frm.is_new() || !frappe.user.has_role(["Admin", "System Manager", "Accounts Executive", "Accounts Manager"])) return;
		frm.add_custom_button(__("Outstanding"), () => frappe.set_route("group-outstanding", {
			party_type: dt === "Customer Group" ? "Customer" : "Supplier", group: frm.doc.name }));
	},
}));
