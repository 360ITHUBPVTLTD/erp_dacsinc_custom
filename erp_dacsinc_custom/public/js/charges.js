// "Add charges" — freight / packing / insurance as item lines at the goods' GST rate (docs/charges.md).
// On drafts of Quotation, Sales Order, Delivery Note, Sales Invoice, Purchase Order, Purchase Receipt
// and Purchase Invoice. The charge items (patches/charge_items.py) list every GST rate, so the line keeps
// the rate chosen here; the default is the rate of the goods already on the document (the one with the
// largest value when they differ). Amounts go in as the Price List Rate (Rate is read-only on these
// forms — docs/rate-read-only.md); 0 removes the line.
(function () {
	const CHARGES = [
		{ code: "Freight Charges", label: __("Freight / transport"), icon: "truck" },
		{ code: "Packing Charges", label: __("Packing"), icon: "archive" },
		{ code: "Insurance Charges", label: __("Insurance"), icon: "shield" },
	];
	const RATES = ["GST 5% - IND", "GST 12% - IND", "GST 18% - IND", "GST 28% - IND", "Exempted - IND"];
	const is_charge = (code) => CHARGES.some(c => c.code === code);
	const sleep = (ms) => new Promise(r => setTimeout(r, ms));

	// the goods' templates on the document, largest value first
	const goods_rates = (frm) => {
		const by = {};
		(frm.doc.items || []).forEach(r => {
			if (!r.item_code || is_charge(r.item_code)) return;
			const t = r.item_tax_template || __("(no template)");
			by[t] = (by[t] || 0) + flt(r.net_amount || r.amount);
		});
		return Object.entries(by).sort((a, b) => b[1] - a[1]);
	};

	const set_line = async (frm, code, amount, template) => {
		let row = (frm.doc.items || []).find(r => r.item_code === code);
		if (!flt(amount)) {
			if (row) { frm.get_field("items").grid.grid_rows_by_docname[row.name].remove(); }
			return;
		}
		if (!row) {
			// reuse an empty last line, else add one
			const last = (frm.doc.items || []).slice(-1)[0];
			row = last && !last.item_code ? last : frm.add_child("items");
			await frappe.model.set_value(row.doctype, row.name, "item_code", code);
			for (let i = 0; i < 40 && !row.item_name; i++) await sleep(100);   // item details arrive
			await sleep(300);
		}
		await frappe.model.set_value(row.doctype, row.name, "qty", 1);
		await frappe.model.set_value(row.doctype, row.name, "price_list_rate", flt(amount));
		await frappe.model.set_value(row.doctype, row.name, "rate", flt(amount));
		if (template) await frappe.model.set_value(row.doctype, row.name, "item_tax_template", template);
		// the SAC shows at once (it is also fetched on save)
		if (!row.gst_hsn_code && frappe.meta.has_field(row.doctype, "gst_hsn_code")) {
			const r = await frappe.db.get_value("Item", code, "gst_hsn_code");
			const sac = ((r && r.message) || {}).gst_hsn_code;
			if (sac) await frappe.model.set_value(row.doctype, row.name, "gst_hsn_code", sac);
		}
	};

	window.dacs_add_charges = (frm) => {
		const purchase = ["Purchase Order", "Purchase Receipt", "Purchase Invoice"].includes(frm.doctype);
		const rates = goods_rates(frm);
		const main = (rates.find(([t]) => RATES.includes(t)) || [])[0] || "GST 5% - IND";
		const now = Object.fromEntries((frm.doc.items || []).filter(r => is_charge(r.item_code)).map(r => [r.item_code, flt(r.price_list_rate || r.rate)]));
		const existing_rate = (frm.doc.items || []).find(r => is_charge(r.item_code) && r.item_tax_template);
		const money = (v) => format_currency(v, frm.doc.currency);
		const d = new frappe.ui.Dialog({
			title: __("Add freight / packing / insurance"),
			fields: [
				{ fieldtype: "HTML", fieldname: "note" },
				...CHARGES.map(c => ({ fieldtype: "Currency", fieldname: frappe.scrub(c.code), label: c.label, options: frm.doc.currency, default: now[c.code] || undefined })),
				{ fieldtype: "Section Break" },
				{ fieldtype: "Select", fieldname: "rate", label: __("GST rate on these charges"), reqd: 1,
				  options: RATES.join("\n"), default: (existing_rate && existing_rate.item_tax_template) || main,
				  description: purchase ? __("Use the rate printed on the supplier's bill — normally the same as the goods.")
				                        : __("Charges billed with goods take the goods' GST rate.") },
			],
			primary_action_label: __("Add to {0}", [__(frm.doctype)]),
			primary_action: async (v) => {
				d.get_primary_btn().prop("disabled", true);
				try {
					for (const c of CHARGES) await set_line(frm, c.code, v[frappe.scrub(c.code)], v.rate);
					frm.refresh_field("items");
					frappe.show_alert({ indicator: "green", message: __("Charges added at {0}", [v.rate]) });
					d.hide();
				} finally { d.get_primary_btn().prop("disabled", false); }
			},
		});
		const lines = rates.map(([t, amt]) => `<b>${frappe.utils.escape_html(t)}</b> ${money(amt)}`).join(" · ");
		d.fields_dict.note.$wrapper.html(`<div style="font-size:12.5px;padding:8px 10px;border-radius:8px;background:#eff6ff;color:#1e3a8a;margin-bottom:8px;">
			${__("Charges billed on the same invoice as the goods are part of the goods' value (GST): they take the goods' rate.")}
			${rates.length ? `<div style="margin-top:4px;">${__("Goods on this {0}", [__(frm.doctype)])}: ${lines}</div>` : ""}
			${rates.filter(([t]) => RATES.includes(t)).length > 1 ? `<div style="margin-top:4px;color:#92400e;"><b>${__("Goods at different rates")}</b> — ${__("the rate of the largest is chosen; change it if the bill says otherwise.")}</div>` : ""}
			${__("Leave an amount empty (or 0) to remove that line.")}</div>`);
		d.show();
	};

	const on_refresh = (frm) => {
		if (frm.doc.docstatus !== 0 || !frappe.model.can_write(frm.doctype)) return;
		frm.add_custom_button(__("Add charges"), () => dacs_add_charges(frm)).attr("title", __("Freight / packing / insurance at the goods' GST rate"));
	};
	["Quotation", "Sales Order", "Delivery Note", "Sales Invoice", "Purchase Order", "Purchase Receipt", "Purchase Invoice"]
		.forEach(dt => frappe.ui.form.on(dt, { refresh: on_refresh }));
})();
