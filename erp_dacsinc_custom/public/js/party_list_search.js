// Customer / Supplier lists: one "Search everything" box in the filter row — id, name, mobile, phone (also on their
// Contacts / Addresses), email, GSTIN, group, city, pincode, address (party_list_search.search, the payment prompt's
// search). The list is filtered to the matches (ID "in" …), together with any other filter; clearing the box removes
// it. Wired by customer_list.js / supplier_list.js; extends ERPNext's own list settings (docs/list-search.md).
window.dacs_party_list_search = function (doctype) {
	const s = (frappe.listview_settings[doctype] = frappe.listview_settings[doctype] || {});
	if (s.__dacs_party_search) return;
	s.__dacs_party_search = true;
	const prev = s.onload;
	s.onload = function (listview) {
		if (prev) { try { prev(listview); } catch (e) { console.error(e); } }   // keep ours working
		if (listview.__dacs_q) return;
		let seq = 0, ours = false;
		const apply = (txt) => {
			const mine = ++seq;
			txt = (txt || "").trim();
			const done = () => { ours = true; };
			if (!txt) {
				if (!ours) return;
				ours = false;
				return listview.filter_area.remove("name");
			}
			frappe.call({ method: "erp_dacsinc_custom.party_list_search.search", args: { doctype, txt } }).then(r => {
				if (mine !== seq) return;
				const names = r.message || [];
				// nothing found: a filter that matches nothing, so the list says so
				listview.filter_area.remove("name").then(() =>
					listview.filter_area.add([[doctype, "name", "in", names.length ? names : ["__no_match__"]]]).then(done));
				if (names.length >= 500) frappe.show_alert({ message: __("Showing the first 500 matches — type more to narrow it."), indicator: "orange" });
			});
		};
		// a plain input, not page.add_field: every page field is sent to the list as a column filter
		const $w = $(`<div class="form-group frappe-control dacs-q" style="min-width:270px; position:relative;">
			<input type="text" class="form-control input-xs" autocomplete="off"
				placeholder="${frappe.utils.escape_html(__("Search everything: name, ID, mobile, GSTIN, group, city…"))}"
				title="${frappe.utils.escape_html(__("Matches ID, name, mobile, phone (also on Contacts / Addresses), email, GSTIN, group, city, pincode, address"))}"></div>`);
		const $row = listview.page.page_form.find(".standard-filter-section");
		$w.prependTo($row.length ? $row : listview.page.page_form);
		const f = { $input: $w.find("input") };
		let t;
		f.$input.on("input", () => { clearTimeout(t); t = setTimeout(() => apply(f.$input.val()), 400); });
		f.$input.on("keydown", (e) => { if (e.key === "Enter") { clearTimeout(t); apply(f.$input.val()); } });
		listview.__dacs_q = f;
	};
};
