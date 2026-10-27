// Payment Entry list: Receive / Pay — the same prompt as Order Flow › Finance › New
// (public/js/bulk_payment.js, docs/bulk-payment.md). Extends ERPNext's listview_settings, never replaces them.
(function () {
	const s = (frappe.listview_settings["Payment Entry"] = frappe.listview_settings["Payment Entry"] || {});
	if (s.__dacs_pay_prompt) return;
	s.__dacs_pay_prompt = true;
	const prev_onload = s.onload;
	s.onload = function (lv) {
		if (prev_onload) { try { prev_onload(lv); } catch (e) { /* keep ours working */ } }
		if (!frappe.model.can_create("Payment Entry")) return;
		const open = (payment_type) => frappe.require("/assets/erp_dacsinc_custom/js/bulk_payment.js",
			() => dacs_payment_dialog({ payment_type, on_done: () => lv.refresh() }));
		lv.page.add_inner_button(__("Receive"), () => open("Receive"));
		lv.page.add_inner_button(__("Pay"), () => open("Pay"));
	};
})();
