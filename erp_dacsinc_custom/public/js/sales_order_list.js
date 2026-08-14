// Old/superseded Sales Orders (custom_old_record_item_is_disabled = 1) should
// not clutter the default view — matches core Item's own "disabled = 0"
// default filter.
//
// The static `filters` property below only seeds a brand-new list view with
// no saved state. Every real user on this site already has a saved (empty)
// Sales Order list filter from before this field existed, and that saved
// state wins over the static default every time (see list_view.js
// setup_defaults: view_user_settings.filters takes priority). So the
// onload below actively re-applies the filter on every visit instead —
// idempotent (filter_area.add() no-ops if it's already present), and a user
// who explicitly removes it during a session keeps it off until they
// navigate away and back.
frappe.listview_settings['Sales Order'] = frappe.listview_settings['Sales Order'] || {};
frappe.listview_settings['Sales Order'].filters = [["Sales Order", "custom_old_record_item_is_disabled", "=", 0]];

(function () {
    const existing_onload = frappe.listview_settings['Sales Order'].onload;
    frappe.listview_settings['Sales Order'].onload = function (listview) {
        if (existing_onload) {
            try { existing_onload(listview); } catch (e) { /* keep ours working */ }
        }
        listview.filter_area.add([["Sales Order", "custom_old_record_item_is_disabled", "=", 0]]);
    };
})();
