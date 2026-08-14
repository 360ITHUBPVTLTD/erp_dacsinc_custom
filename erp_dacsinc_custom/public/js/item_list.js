// Core ERPNext already declares a static "disabled = 0" default filter for
// the Item list (erpnext/stock/doctype/item/item_list.js), but that only
// seeds a brand-new list view with no saved state. Every real user on this
// site already has a saved (empty) Item list filter from before, which wins
// over the static default every time (see list_view.js setup_defaults:
// view_user_settings.filters takes priority). So actively re-apply it on
// every visit instead — idempotent (filter_area.add() no-ops if the filter
// is already present), and a user who explicitly removes it during a
// session keeps it off until they navigate away and back.
frappe.listview_settings['Item'] = frappe.listview_settings['Item'] || {};

(function () {
    const existing_onload = frappe.listview_settings['Item'].onload;
    frappe.listview_settings['Item'].onload = function (listview) {
        if (existing_onload) {
            try { existing_onload(listview); } catch (e) { /* keep ours working */ }
        }
        listview.filter_area.add([["Item", "disabled", "=", 0]]);
    };
})();
