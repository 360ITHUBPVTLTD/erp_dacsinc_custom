// Quotation / Sales Order / Sales Invoice: a Price List Rate already on a line stays as it is
// (docs/rate-read-only.md). ERPNext fetches the Price List Rate again from Item Price whenever Qty, UOM,
// Customer or Price List changes (transaction.js → apply_price_list). That replaced a rate the user had
// typed with the Item Price (₹10 placeholders), and the difference stayed on the line as a discount.
// Here apply_price_list fetches only lines with no Price List Rate yet (a new item) — except when the
// Price List itself has changed since the lines were priced: then every line takes the new list once.
(function () {
	function keep_typed_price(frm) {
		const c = frm.cscript;
		// an ERPNext update that renames either method leaves the standard behaviour in place
		if (!c || !c.apply_price_list || !c._get_item_list || c._keep_price_patched) return;
		const original_apply = c.apply_price_list;
		const original_list = c._get_item_list;
		c._priced_from = frm.doc.selling_price_list;

		c.apply_price_list = function (...args) {
			this._keep_priced_rows = true;
			try {
				return original_apply.apply(this, args);
			} finally {
				this._keep_priced_rows = false;
			}
		};
		c._get_item_list = function (item) {
			const list = original_list.call(this, item);
			if (!this._keep_priced_rows) return list;
			const price_list = this.frm.doc.selling_price_list;
			if (price_list !== this._priced_from) {
				// only a whole-document fetch has put every line on the new list; apply_price_list
				// also returns early while a fetch is running, so the next call takes the new list then
				if (!item && !this.in_apply_price_list) this._priced_from = price_list;
				return list;
			}
			return list.filter((d) => !flt((locals[d.doctype] || {})[d.name]?.price_list_rate));
		};
		c._keep_price_patched = true;
	}

	for (const doctype of ["Quotation", "Sales Order", "Sales Invoice"]) {
		frappe.ui.form.on(doctype, {
			onload: keep_typed_price,
			refresh: keep_typed_price,
		});
	}
})();
