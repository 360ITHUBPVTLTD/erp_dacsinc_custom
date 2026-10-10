// "Print it now?" right after a document is created (MOM 8 Oct 2026, 1a-iii): Sales Invoice,
// Purchase Order / Subcontract PO (on submit), Uniform Embroidery Transfer (on first save),
// and every Embroidery Work Order the dialogs create (they call dacs_print_prompt with the
// new name). Yes opens the same PDF as the Print buttons elsewhere (same print format).
(function () {
	const FORMATS = {
		"Embroidery Work Order": { format: "Embroidery Work Order Print Format", no_letterhead: 1 },
		"Purchase Order": { format: "Purchase Order Print Format", no_letterhead: 1 },
		"Sales Invoice": {},          // the doctype's default print format
		"Uniform Embroidery Transfer": {},
	};

	window.dacs_print_url = function (doctype, name) {
		const f = FORMATS[doctype] || {};
		let url = `/api/method/frappe.utils.print_format.download_pdf?doctype=${encodeURIComponent(doctype)}`
			+ `&name=${encodeURIComponent(name)}&_lang=${encodeURIComponent((frappe.boot && frappe.boot.lang) || "en")}`;
		if (f.format) url += `&format=${encodeURIComponent(f.format)}`;
		if (f.no_letterhead) url += `&no_letterhead=1&letterhead=${encodeURIComponent("No Letterhead")}`;
		return url;
	};

	window.dacs_print_prompt = function (doctype, name, label) {
		if (!doctype || !name) return;
		const what = label || __(doctype);
		frappe.confirm(
			__("{0} <b>{1}</b> is created. Do you want to print it now?", [frappe.utils.escape_html(what), frappe.utils.escape_html(name)]),
			() => window.open(dacs_print_url(doctype, name), "_blank")
		);
	};

	// Submitted from the form.
	frappe.ui.form.on("Sales Invoice", {
		on_submit(frm) { dacs_print_prompt("Sales Invoice", frm.doc.name); },
	});
	frappe.ui.form.on("Purchase Order", {
		on_submit(frm) {
			dacs_print_prompt("Purchase Order", frm.doc.name, frm.doc.is_subcontracted ? __("Subcontract PO") : __("Purchase Order"));
		},
	});
	// Not submittable: asked once, when it is first saved.
	frappe.ui.form.on("Uniform Embroidery Transfer", {
		before_save(frm) { frm.__dacs_was_new = frm.is_new(); },
		after_save(frm) {
			if (frm.__dacs_was_new) { frm.__dacs_was_new = false; dacs_print_prompt("Uniform Embroidery Transfer", frm.doc.name, __("Embroidery transfer")); }
		},
	});
})();
