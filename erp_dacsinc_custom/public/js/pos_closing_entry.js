// POS Closing Entry. "Close the POS" now opens the entry already filled (built on the
// server, pos_closing.make_closing_entry). Here:
// - the tables always exist (ERPNext's before_save loops over them; an entry made
//   without them failed with "payment_reconciliation is not iterable");
// - a new entry that still opens empty with its opening entry set (made some other
//   way) is filled once from the same server call, not by firing the opening-entry
//   trigger again: ERPNext may already be running that load, and two loads at once
//   wipe each other.
// - closing the cash drawer (pos_cash.py), as steps above the payment table; every
//   Closing Amount starts at the expected amount. "1. Cash counted" is changed there and copied into the cash row's Closing Amount (either can be
//   typed; they stay the same); expected, short / extra and left in drawer follow; "2. Why
//   short / extra" shows only when something differs; "3. Cash taken out now" can't be
//   more than the cash counted. Card / UPI are checked in the table.
// ERPNext's file is untouched.
const dacs_cash = {
	modes: {},
	async load(frm) {
		const names = (frm.doc.payment_reconciliation || []).map((r) => r.mode_of_payment).filter((m) => m && !(m in this.modes));
		if (names.length) {
			const r = await frappe.call({ method: "erp_dacsinc_custom.pos_cash.which_are_cash", args: { modes: names } });
			names.forEach((n) => { this.modes[n] = ((r && r.message) || []).includes(n); });
		}
	},
	cash_rows(frm) { return (frm.doc.payment_reconciliation || []).filter((r) => this.modes[r.mode_of_payment]); },
	// "1. Cash counted" typed: into the (only) cash row.
	async counted_typed(frm) {
		if (frm.doc.docstatus !== 0 || this.syncing) return;
		await this.load(frm);
		const rows = this.cash_rows(frm);
		if (rows.length === 1 && flt(rows[0].closing_amount) !== flt(frm.doc.custom_cash_counted)) {
			this.syncing = true;
			await frappe.model.set_value(rows[0].doctype, rows[0].name, "closing_amount", flt(frm.doc.custom_cash_counted));
			await frappe.model.set_value(rows[0].doctype, rows[0].name, "difference", flt(frm.doc.custom_cash_counted) - flt(rows[0].expected_amount));
			this.syncing = false;
		}
		this.update(frm);
	},
	explain(frm) {
		// how the expected cash is made up: opening + cash received (sales − refunds − change)
		const cash = this.cash_rows(frm);
		const opening = flt(cash.reduce((t, r) => t + flt(r.opening_amount), 0), 2);
		const expected = flt(cash.reduce((t, r) => t + flt(r.expected_amount), 0), 2);
		frm.set_df_property("custom_expected_cash", "description", cash.length
			? __("Opening cash {0} + cash received in this shift {1} (sales − refunds − change given back) = {2}",
				[format_currency(opening), format_currency(expected - opening), format_currency(expected)])
			: __("No cash payment mode in this shift."));
	},
	async update(frm) {
		await this.load(frm);
		this.explain(frm);
		if (frm.doc.docstatus !== 0) return;
		const rows = frm.doc.payment_reconciliation || [];
		const cash = this.cash_rows(frm);
		const counted = flt(cash.reduce((t, r) => t + flt(r.closing_amount), 0), 2);
		const expected = flt(cash.reduce((t, r) => t + flt(r.expected_amount), 0), 2);
		let handed = flt(frm.doc.custom_cash_handed_over);
		if (handed > counted + 0.004) {
			frappe.show_alert({ message: __("Cash taken out can't be more than the cash counted ({0}). Enter the cash counted first.", [format_currency(counted)]), indicator: "red" });
			handed = 0;
		}
		const set = (f, v) => { if (flt(frm.doc[f]) !== flt(v, 2)) frm.doc[f] = flt(v, 2); };
		this.syncing = true;
		set("custom_cash_counted", counted); set("custom_expected_cash", expected);
		set("custom_cash_short_extra", counted - expected); set("custom_cash_handed_over", handed);
		set("custom_cash_left_in_drawer", counted - handed);
		this.syncing = false;
		frm.refresh_fields(["custom_cash_counted", "custom_expected_cash", "custom_cash_short_extra", "custom_cash_handed_over", "custom_cash_left_in_drawer"]);
		// several cash modes: count them in the table (step 1 then shows their total)
		frm.set_df_property("custom_cash_counted", "read_only", cash.length > 1 ? 1 : 0);
		frm.set_df_property("payment_reconciliation", "description",
			__("Card / UPI: check the Closing Amount against the card machine / UPI app and change it only if it differs. Cash comes from step 1 above."));
		frm.layout.refresh_dependency();
		const off = rows.filter((r) => Math.abs(flt(r.closing_amount) - flt(r.expected_amount)) > 0.004);
		frm.set_intro("");   // the message area adds to what's there: clear it first
		if (off.length && !(frm.doc.custom_difference_reason || "").trim()) {
			frm.set_intro(__("Step 2: {0} differs from expected. Say why in <b>2. Why short / extra</b>.",
				[off.map((r) => frappe.utils.escape_html(r.mode_of_payment)).join(", ")]), "red");
		} else if (frm.is_new() && expected && !off.length) {
			frm.set_intro(__("Closing amounts are filled with what is expected ({0} cash). Count the cash and change <b>1. Cash counted in the drawer</b> only if it differs.",
				[format_currency(expected)]), "blue");
		}
	},
};
frappe.ui.form.on("POS Closing Entry Detail", {
	closing_amount(frm) { if (!dacs_cash.syncing) dacs_cash.update(frm); },
	payment_reconciliation_remove(frm) { dacs_cash.update(frm); },
});
frappe.ui.form.on("POS Closing Entry", {
	custom_cash_counted(frm) { if (!dacs_cash.syncing) dacs_cash.counted_typed(frm); },
	custom_cash_handed_over(frm) { if (!dacs_cash.syncing) dacs_cash.update(frm); },
	custom_difference_reason(frm) { if (!dacs_cash.syncing) dacs_cash.update(frm); },
	onload(frm) {
		["payment_reconciliation", "pos_transactions", "taxes"].forEach((f) => {
			if (!Array.isArray(frm.doc[f])) frm.doc[f] = [];
		});
	},

	refresh(frm) {
		dacs_cash.update(frm);
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
