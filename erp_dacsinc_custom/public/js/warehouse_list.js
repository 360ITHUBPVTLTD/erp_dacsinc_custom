// Warehouse list "Add Stock" button: pick several warehouses, a qty, and
// either all stock items or chosen ones. Server side adds that qty of each
// item into each warehouse as submitted Material Receipt Stock Entries, in a
// background job (warehouse_add_stock.py). Warehouses ticked in the list
// are pre-selected in the dialog.
frappe.listview_settings['Warehouse'] = frappe.listview_settings['Warehouse'] || {};

(function () {
    const existing_onload = frappe.listview_settings['Warehouse'].onload;
    frappe.listview_settings['Warehouse'].onload = function (listview) {
        if (existing_onload) {
            try { existing_onload(listview); } catch (e) { /* keep ours working */ }
        }

        // System Manager only.
        if (!frappe.user_roles.includes('System Manager')) return;

        listview.page.add_inner_button(__("Add Stock"), function () {
            const preselected = (listview.get_checked_items() || [])
                .filter((d) => !d.is_group)
                .map((d) => d.name);
            show_add_stock_dialog(listview, preselected);
        });
    };

    // The run happens in a background job (warehouse_add_stock.py), which
    // pushes progress and the final summary over realtime. The summary also
    // lands in the notification bell, so closing this page loses nothing.
    function watch_run(listview, run) {
        const title = __("Adding Stock");
        frappe.show_alert({
            message: __("Add Stock started for {0} item(s) × {1} warehouse(s). You can keep working — you'll get a notification when it finishes.", [
                run.items, run.warehouses,
            ]),
            indicator: "blue",
        }, 10);
        const handler = (msg) => {
            if (!msg || msg.run_id !== run.run_id) return;
            if (msg.done) {
                frappe.realtime.off("dacsinc_add_stock_progress", handler);
                frappe.hide_progress();
                frappe.msgprint({ title: __("Add Stock"), message: msg.message, indicator: msg.ok ? "green" : "orange" });
                listview.refresh();
                return;
            }
            frappe.show_progress(title, msg.processed, msg.total,
                __("{0} of {1} items checked — {2} rows added in {3} Stock Entries", [msg.processed, msg.total, msg.added_rows, msg.entries]),
                true);
        };
        frappe.realtime.on("dacsinc_add_stock_progress", handler);
    }

    function show_add_stock_dialog(listview, preselected) {
        const dialog = new frappe.ui.Dialog({
            title: __("Add Stock"),
            fields: [
                {
                    fieldname: "warehouses",
                    fieldtype: "MultiSelectList",
                    label: __("Warehouses"),
                    reqd: 1,
                    default: preselected,
                    get_data: (txt) => frappe.db.get_link_options("Warehouse", txt, { is_group: 0, disabled: 0 }),
                },
                {
                    fieldname: "item_scope",
                    fieldtype: "Select",
                    label: __("Items"),
                    options: ["All Items", "Selected Items"].join("\n"),
                    default: "All Items",
                    reqd: 1,
                },
                {
                    fieldname: "item_codes",
                    fieldtype: "MultiSelectList",
                    label: __("Select Items"),
                    depends_on: "eval:doc.item_scope == 'Selected Items'",
                    mandatory_depends_on: "eval:doc.item_scope == 'Selected Items'",
                    get_data: (txt) => frappe.db.get_link_options("Item", txt, { is_stock_item: 1, disabled: 0 }),
                },
                {
                    fieldname: "qty",
                    fieldtype: "Float",
                    label: __("Qty — added for each item in each warehouse"),
                    reqd: 1,
                },
            ],
            primary_action_label: __("Add Stock"),
            primary_action: (values) => {
                const warehouses = values.warehouses || [];
                const all_items = values.item_scope === "All Items";
                const item_codes = all_items ? [] : (values.item_codes || []);
                if (!warehouses.length) {
                    frappe.msgprint(__("Select at least one warehouse."));
                    return;
                }
                if (!all_items && !item_codes.length) {
                    frappe.msgprint(__("Select at least one item."));
                    return;
                }
                if (flt(values.qty) <= 0) {
                    frappe.msgprint(__("Quantity must be greater than zero."));
                    return;
                }
                const what = all_items ? __("all stock items") : __("{0} item(s)", [item_codes.length]);
                frappe.confirm(
                    __("Add {0} of {1} into {2} warehouse(s)? This runs in the background and creates submitted Material Receipt Stock Entries.", [
                        values.qty, what, warehouses.length,
                    ]),
                    () => {
                        frappe.call({
                            method: "erp_dacsinc_custom.warehouse_add_stock.add_stock_to_warehouses",
                            args: { warehouses: warehouses, qty: values.qty, all_items: all_items ? 1 : 0, item_codes: item_codes },
                            freeze: true,
                            freeze_message: __("Starting..."),
                            callback: (r) => {
                                if (!r.message) return;
                                dialog.hide();
                                watch_run(listview, r.message);
                            },
                        });
                    }
                );
            },
        });
        dialog.show();
    }
})();
