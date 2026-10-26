// List views of Sales Invoice, Delivery Note, Purchase Invoice and Purchase Receipt: three buttons
// "All · Normal · Returns" — a standard list filter on is_return (0 / 1, or none), so it combines
// with every other filter and shows in the filter bar. Wired per doctype by its *_list.js
// (dacs_return_list_toggle(doctype)), extending ERPNext's own listview_settings, never replacing them.
window.dacs_return_list_toggle = function (doctype) {
	const s = (frappe.listview_settings[doctype] = frappe.listview_settings[doctype] || {});
	if (s.__dacs_return_toggle) return;
	s.__dacs_return_toggle = true;
	const label_ret = { "Sales Invoice": __("Returns (Credit Notes)"), "Purchase Invoice": __("Returns (Debit Notes)"),
		"Delivery Note": __("Returns (Sales Returns)"), "Purchase Receipt": __("Returns (Purchase Returns)") }[doctype] || __("Returns");
	const choices = [["all", __("All")], ["0", __("Normal")], ["1", label_ret]];

	const current = (lv) => {
		const f = (lv.filter_area.get() || []).find(x => x[1] === "is_return" && x[2] === "=");
		return f ? String(cint(f[3])) : "all";
	};
	const paint = (lv) => {
		const cur = current(lv);
		(lv.__dacs_ret_btns || []).forEach(([key, $b]) => $b.toggleClass("btn-primary", key === cur).toggleClass("btn-default", key !== cur));
	};
	const pick = async (lv, key) => {
		await lv.filter_area.remove("is_return");
		if (key !== "all") await lv.filter_area.add([[doctype, "is_return", "=", cint(key)]]);
		paint(lv);
	};

	const prev_onload = s.onload, prev_refresh = s.refresh;
	s.onload = function (lv) {
		if (prev_onload) { try { prev_onload(lv); } catch (e) { /* keep ours working */ } }
		lv.__dacs_ret_btns = choices.map(([key, label]) => [key, lv.page.add_inner_button(label, () => pick(lv, key))]);
		paint(lv);
	};
	s.refresh = function (lv) {
		if (prev_refresh) { try { prev_refresh(lv); } catch (e) { /* keep ours working */ } }
		paint(lv);
	};
};
