// "Print it now?" right after a document is created (MOM 8 Oct 2026, 1a-iii): Sales Invoice,
// Purchase Order / Subcontract PO (on submit), Uniform Embroidery Transfer (on first save),
// and every Embroidery Work Order the dialogs create (they call dacs_print_prompt with the
// new name). Yes opens the same PDF as the Print buttons elsewhere (same print format).
(function () {
	const FORMATS = {
		"Embroidery Work Order": { format: "Embroidery Work Order Print Format", no_letterhead: 1 },
		"Purchase Order": { format: "Purchase Order Print Format", no_letterhead: 1 },
		// The form's "Print Sales Invoice" format (print_format/sales_invoice_multi_copy_master):
		// copies (Original / Duplicate …); a return (Credit Note) hands over to "Credit Note DAC".
		"Sales Invoice": { format: "Sales Invoice Multi Copy Master", copies: 1 },
		"Uniform Embroidery Transfer": {},
		// Receipt (Receive) / Voucher (Pay) / Internal Transfer — print_format/payment_receipt_dac
		"Payment Entry": { format: "Payment Receipt DAC" },
		// Same print as Order Flow › Job Work (of_print_sco)
		"Subcontracting Order": { format: "Subcontracting Order Print Format 3", no_letterhead: 1, letterhead: "DAC Letter Header" },
	};
	// A Purchase Invoice return prints as a Debit Note (copies too); an ordinary one, its default.
	const RETURN_FORMATS = { "Purchase Invoice": "Debit Note DAC", "Sales Invoice": "Credit Note DAC" };
	const COPIES = ["Original", "Duplicate", "Triplicate", "Quadruplicate"];

	// opts: { is_return, copy_name, print_all }
	window.dacs_print_url = function (doctype, name, opts) {
		opts = opts || {};
		const f = (opts.is_return && RETURN_FORMATS[doctype] && doctype !== "Sales Invoice")
			? { format: RETURN_FORMATS[doctype], copies: 1 } : (FORMATS[doctype] || {});
		let url = `/api/method/frappe.utils.print_format.download_pdf?doctype=${encodeURIComponent(doctype)}`
			+ `&name=${encodeURIComponent(name)}&_lang=${encodeURIComponent((frappe.boot && frappe.boot.lang) || "en")}`;
		if (f.format) url += `&format=${encodeURIComponent(f.format)}`;
		if (f.copies) {
			url += "&no_letterhead=0";
			if (opts.print_all) url += "&print_all=1";
			else if (opts.copy_name) url += `&copy_name=${encodeURIComponent(opts.copy_name)}`;
		}
		if (f.no_letterhead) url += `&no_letterhead=1&letterhead=${encodeURIComponent(f.letterhead || "No Letterhead")}`;
		return url;
	};

	window.dacs_print_prompt = function (doctype, name, label) {
		if (!doctype || !name) return;
		const what = label || __(doctype);
		frappe.confirm(
			__("{0} <b>{1}</b> is created. Do you want to print it now?", [frappe.utils.escape_html(what), frappe.utils.escape_html(name)]),
			() => (FORMATS[doctype] || {}).copies || doctype === "Purchase Invoice"
				? dacs_print_copies(doctype, name)
				: window.open(dacs_print_url(doctype, name), "_blank")
		);
	};

	// Print with a choice of copy — the same choice as the form's "Print Sales Invoice" button.
	// Used by Order Flow › Finance (every invoice and Returns / Notes row) and after submit.
	// A draft prints as DRAFT COPY straight away. Credit / Debit Notes print as such.
	window.dacs_print_copies = function (doctype, name, opts) {
		opts = opts || {};
		const go = (o) => window.open(dacs_print_url(doctype, name, Object.assign({}, opts, o)), "_blank");
		const ask = (is_return, docstatus) => {
			opts.is_return = is_return;
			const f = (is_return && RETURN_FORMATS[doctype] && doctype !== "Sales Invoice") ? { copies: 1 } : (FORMATS[doctype] || {});
			if (!f.copies) return go({});                       // no copies for this format
			if (cint(docstatus) === 0) return go({ copy_name: "DRAFT COPY" });
			const title = is_return ? (doctype === "Sales Invoice" ? __("Print Credit Note") : __("Print Debit Note")) : __("Print {0}", [__(doctype)]);
			const d = new frappe.ui.Dialog({
				title: `${title} — ${name}`,
				fields: [{ fieldtype: "Select", fieldname: "copy", label: __("Copy"), reqd: 1, default: "Original",
					options: COPIES.map(c => ({ label: __(c), value: c })).concat([{ label: __("All 4 copies"), value: "__all" }]) }],
				primary_action_label: __("Print"),
				primary_action(v) {
					go(v.copy === "__all" ? { print_all: 1 } : { copy_name: v.copy });
					d.hide();
				},
			});
			d.show();
		};
		if (opts.is_return !== undefined && opts.docstatus !== undefined) return ask(cint(opts.is_return), opts.docstatus);
		frappe.db.get_value(doctype, name, ["is_return", "docstatus"]).then(r => {
			const x = (r && r.message) || {};
			ask(cint(x.is_return), x.docstatus);
		});
	};

	// A "new" link opened in its own tab (Order Flow › Finance › New) can ask for a return:
	// /app/sales-invoice/new?is_return=1. Is Return is a no-copy field, so Frappe's route options
	// skip it — read it here, before the router rewrites the URL, and set it when the form loads.
	let new_return = (() => {
		const m = location.pathname.match(/^\/app\/(sales|purchase)-invoice\/new/);
		return m && /[?&]is_return=1(&|$)/.test(location.search) ? (m[1] === "sales" ? "Sales Invoice" : "Purchase Invoice") : null;
	})();
	const set_new_return = (frm) => {
		if (new_return !== frm.doctype) return;
		new_return = null;
		if (frm.is_new() && !cint(frm.doc.is_return)) frm.set_value("is_return", 1);
	};
	frappe.ui.form.on("Purchase Invoice", { onload: set_new_return });

	// Submitted from the form.
	frappe.ui.form.on("Sales Invoice", {
		onload: set_new_return,
		on_submit(frm) { dacs_print_prompt("Sales Invoice", frm.doc.name); },
	});
	// A subcontracted PO is not printed on submit: what goes to the jobber is its Subcontracting
	// Order — asked when that is created (purchase_order.js, the send-raw-material dialog) or
	// submitted from its own form.
	frappe.ui.form.on("Purchase Order", {
		on_submit(frm) {
			if (cint(frm.doc.is_subcontracted)) return;
			dacs_print_prompt("Purchase Order", frm.doc.name, __("Purchase Order"));
		},
	});
	frappe.ui.form.on("Subcontracting Order", {
		on_submit(frm) { dacs_print_prompt("Subcontracting Order", frm.doc.name, __("Subcontracting Order")); },
	});
	// Not submittable: asked once, when it is first saved.
	frappe.ui.form.on("Uniform Embroidery Transfer", {
		before_save(frm) { frm.__dacs_was_new = frm.is_new(); },
		after_save(frm) {
			if (frm.__dacs_was_new) { frm.__dacs_was_new = false; dacs_print_prompt("Uniform Embroidery Transfer", frm.doc.name, __("Embroidery transfer")); }
		},
	});
})();
