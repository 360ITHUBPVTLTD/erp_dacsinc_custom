// Overall (Additional) Discount that leaves chosen items alone — the form side of
// overall_discount.py (keep the two in step). Rows whose Item is ticked
// "Exclude from Overall Discount" (freight, packing ...) on Quotation / Sales Order /
// Delivery Note / Sales Invoice / POS Invoice: Discount % is taken on the other rows only, and the discount amount
// is spread over the other rows only. See docs/overall-discount.md.
(function () {
	const FIELD = "custom_exclude_from_overall_discount";
	const DOCTYPES = ["Quotation", "Sales Order", "Delivery Note", "Sales Invoice", "POS Invoice"];

	function patch() {
		const proto = erpnext.taxes_and_totals.prototype;
		if (proto._overall_discount_patched) return;
		const original_set = proto.set_discount_amount;
		const original_apply = proto.apply_discount_amount;

		function excluded_items(me) {
			if (!DOCTYPES.includes(me.frm.doc.doctype)) return [];
			return (me.frm._items || []).filter((item) => item[FIELD]);
		}

		// net amount of the excluded rows, plus (Grand Total) the percentage taxes on them
		function excluded_value(me, items) {
			const doc = me.frm.doc;
			let total = items.reduce((sum, item) => sum + flt(item.net_amount), 0);
			if (doc.apply_discount_on !== "Grand Total") return total;
			items.forEach((item) => {
				const item_tax_map = item.item_tax_rate ? JSON.parse(item.item_tax_rate) : {};
				(doc.taxes || []).forEach((tax) => {
					if (tax.charge_type !== "On Net Total" || tax.category === "Valuation") return;
					const rate = flt(tax.account_head in item_tax_map ? item_tax_map[tax.account_head] : tax.rate);
					const sign = tax.add_deduct_tax === "Deduct" ? -1 : 1;
					total += (sign * flt(item.net_amount) * rate) / 100;
				});
			});
			return total;
		}

		proto.set_discount_amount = function () {
			original_set.call(this);
			const items = excluded_items(this);
			const doc = this.frm.doc;
			if (items.length && doc.additional_discount_percentage) {
				const base = flt(doc[frappe.scrub(doc.apply_discount_on)]) - excluded_value(this, items);
				doc.discount_amount = flt(
					(Math.max(base, 0) * doc.additional_discount_percentage) / 100,
					precision("discount_amount")
				);
			}
		};

		proto.apply_discount_amount = function () {
			const me = this;
			const doc = this.frm.doc;
			const items = excluded_items(this);
			if (
				!items.length ||
				!doc.discount_amount ||
				(doc.apply_discount_on === "Grand Total" && doc.is_cash_or_non_trade_discount)
			) {
				return original_apply.call(this);
			}
			if (!doc.apply_discount_on) frappe.throw(__("Please select Apply Discount On"));

			doc.base_discount_amount = flt(doc.discount_amount * doc.conversion_rate, precision("base_discount_amount"));
			const total_for_discount_amount = this.get_total_for_discount_amount() - excluded_value(this, items);
			if (total_for_discount_amount <= 0) return;

			let net_total = 0;
			let expected_net_total = 0;
			(this.frm._items || []).forEach((item) => {
				const distributed_amount = item[FIELD]
					? 0
					: (flt(doc.discount_amount) * item.net_amount) / total_for_discount_amount;
				const adjusted_net_amount = item.net_amount - distributed_amount;
				expected_net_total += adjusted_net_amount;
				item.net_amount = flt(adjusted_net_amount, precision("net_amount", item));
				net_total += item.net_amount;

				// rounding difference goes on a discounted row, never on an excluded one
				const rounding_difference = flt(expected_net_total - net_total, precision("net_total"));
				if (!item[FIELD] && rounding_difference) {
					item.net_amount = flt(item.net_amount + rounding_difference, precision("net_amount", item));
					net_total += rounding_difference;
				}
				item.net_rate = item.qty ? flt(item.net_amount / item.qty, precision("net_rate", item)) : 0;
				me.set_in_company_currency(item, ["net_rate", "net_amount"]);
			});

			this.discount_amount_applied = true;
			this._calculate_taxes_and_totals();
		};

		proto._overall_discount_patched = true;
	}

	function try_patch() {
		if (!(window.erpnext && erpnext.taxes_and_totals)) return false;
		try {
			patch();
		} catch (e) {
			// standard ERPNext discount stays in place; make the failure visible
			console.error("overall_discount.js: could not patch erpnext.taxes_and_totals", e);
		}
		return true;
	}
	if (!try_patch()) {
		$(document).ready(() => {
			if (!try_patch()) console.error("overall_discount.js: erpnext.taxes_and_totals not found");
		});
	}
})();
