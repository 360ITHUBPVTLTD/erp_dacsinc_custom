// Journal Entry list: the Journal Entry prompt with ready-made patterns — the same one as
// Order Flow › Finance › New › Journal Entry (public/js/journal_prompt.js, journal_prompt.py).
// Extends ERPNext's listview_settings, never replaces them.
(function () {
	const s = (frappe.listview_settings["Journal Entry"] = frappe.listview_settings["Journal Entry"] || {});
	if (s.__dacs_je_prompt) return;
	s.__dacs_je_prompt = true;
	const prev_onload = s.onload;
	s.onload = function (lv) {
		if (prev_onload) { try { prev_onload(lv); } catch (e) { /* keep ours working */ } }
		if (!frappe.model.can_create("Journal Entry")) return;
		lv.page.add_inner_button(__("Journal Entry (guided)"), () => frappe.require("/assets/erp_dacsinc_custom/js/journal_prompt.js",
			() => dacs_journal_prompt({ on_done: () => lv.refresh() })));
	};
})();
