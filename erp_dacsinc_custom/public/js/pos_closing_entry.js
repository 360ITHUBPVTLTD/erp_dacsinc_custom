// POS Closing Entry. "Close the POS" now opens the entry already filled (built on the
// server, pos_closing.make_closing_entry). Here:
// - the tables always exist (ERPNext's before_save loops over them; an entry made
//   without them failed with "payment_reconciliation is not iterable");
// - a new entry that still opens empty with its opening entry set (made some other
//   way) is filled once from the same server call, not by firing the opening-entry
//   trigger again: ERPNext may already be running that load, and two loads at once
//   wipe each other.
// ERPNext's file is untouched.
frappe.ui.form.on("POS Closing Entry", {
	onload(frm) {
		["payment_reconciliation", "pos_transactions", "taxes"].forEach((f) => {
			if (!Array.isArray(frm.doc[f])) frm.doc[f] = [];
		});
	},

	refresh(frm) {
		if (!frm.is_new() || !frm.doc.pos_opening_entry || frm.__dacs_fill) return;
		frm.__dacs_fill = true;
		// give ERPNext's own load (if it started) the chance to finish first
		setTimeout(() => {
			if (!frm.is_new() || (frm.doc.payment_reconciliation || []).length || $(".freeze-message-container:visible").length) return;
			frappe.call({
				method: "erp_dacsinc_custom.pos_closing.make_closing_entry",
				args: { pos_opening_entry: frm.doc.pos_opening_entry },
				freeze: true, freeze_message: __("Loading the closing entry…"),
			}).then((r) => {
				const d = r && r.message;
				if (!d || (frm.doc.payment_reconciliation || []).length) return;
				["period_start_date", "period_end_date", "pos_profile", "user", "company", "grand_total", "net_total", "total_quantity"]
					.forEach((f) => { frm.doc[f] = d[f]; });
				["pos_transactions", "payment_reconciliation", "taxes"].forEach((t) => {
					frm.doc[t] = [];
					(d[t] || []).forEach((row) => { const c = frm.add_child(t); Object.keys(row).forEach((k) => {
						if (!["name", "parent", "parentfield", "parenttype", "idx", "doctype", "__islocal", "__unsaved"].includes(k)) c[k] = row[k];
					}); });
				});
				frm.refresh_fields();
				frm.trigger("refresh");
			});
		}, 1500);
	},
});
