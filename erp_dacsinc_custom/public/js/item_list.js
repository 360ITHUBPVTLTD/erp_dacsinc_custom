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

        // System Manager only.
        if (!frappe.user_roles.includes('System Manager')) return;

        listview.page.add_action_item(__("Add Stock"), function () {
            const checked_items = listview.get_checked_items();
            if (!checked_items || checked_items.length === 0) return;
            const item_codes = checked_items.map((d) => d.name);

            const dialog = new frappe.ui.Dialog({
                title: __("Add Stock — {0} item(s)", [item_codes.length]),
                fields: [
                    {
                        fieldname: "warehouse",
                        fieldtype: "Link",
                        options: "Warehouse",
                        label: __("Warehouse"),
                        reqd: 1,
                        get_query: () => ({ filters: { is_group: 0 } }),
                    },
                    {
                        fieldname: "qty",
                        fieldtype: "Float",
                        label: __("Quantity to add — same for every selected item"),
                        reqd: 1,
                    },
                ],
                primary_action_label: __("Add Stock"),
                primary_action: (values) => {
                    frappe.confirm(
                        __("Add {0} of stock for {1} item(s) into {2}? This creates and submits one Material Receipt Stock Entry.", [
                            values.qty, item_codes.length, values.warehouse,
                        ]),
                        () => {
                            frappe.call({
                                method: "erp_dacsinc_custom.custom_script.bulk_add_stock",
                                args: { item_codes: item_codes, qty: values.qty, warehouse: values.warehouse },
                                freeze: true,
                                freeze_message: __("Adding stock..."),
                                callback: (r) => {
                                    dialog.hide();
                                    if (!r.message) return;
                                    const { added, skipped, stock_entry } = r.message;
                                    let msg = `<p>${__("Added stock for {0} item(s)", [added])}` +
                                        (stock_entry ? ` — <a href="/app/stock-entry/${stock_entry}" target="_blank">${stock_entry}</a>` : "") +
                                        `</p>`;
                                    if (skipped && skipped.length) {
                                        msg += `<p>${__("Skipped")}:</p><ul>` +
                                            skipped.map((s) => `<li>${frappe.utils.escape_html(s.item_code)} — ${frappe.utils.escape_html(s.reason)}</li>`).join("") +
                                            `</ul>`;
                                    }
                                    frappe.msgprint({ title: __("Add Stock"), message: msg, indicator: added ? "green" : "orange" });
                                    listview.refresh();
                                },
                            });
                        }
                    );
                },
            });
            dialog.show();
        });
    };
})();
