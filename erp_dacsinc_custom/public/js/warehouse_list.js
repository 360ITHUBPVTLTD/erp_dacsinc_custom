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
            // A run already going (it can take hours for a large catalogue)
            // opens its live status instead of a new dialog.
            frappe.call({ method: "erp_dacsinc_custom.warehouse_add_stock.get_add_stock_status" }).then((r) => {
                const st = r.message;
                if (st && (st.status === "running" || st.status === "stopping")) show_status_dialog(listview, st);
                else show_add_stock_dialog(listview, preselected);
            });
        });
    };

    // The run happens in a background job (warehouse_add_stock.py), which
    // pushes progress and the final summary over realtime. The summary also
    // lands in the notification bell, so closing this page loses nothing.
    function watch_run(listview, run, quiet) {
        const title = __("Adding Stock");
        if (!quiet) frappe.show_alert({
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

    const fmt_dur = (sec) => {
        if (sec == null) return "—";
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
        return h ? `${h} h ${m} min` : `${m} min`;
    };

    // Live status of a running run: progress, Stop, and Resume for lanes that
    // stalled (e.g. after a worker restart) — they continue from where they stopped.
    function show_status_dialog(listview, st) {
        const d = new frappe.ui.Dialog({ title: __("Add Stock — running"), fields: [{ fieldtype: "HTML", fieldname: "body" }] });
        const paint = (s) => {
            const pct = s.total ? Math.round((100 * s.processed) / s.total) : 0;
            d.fields_dict.body.$wrapper.html(`
                <div style="font-size:13px;">
                    <div style="margin-bottom:6px;"><b>${s.status === "stopping" ? __("Stopping…") : __("Running in the background")}</b>
                        — ${frappe.utils.escape_html(s.warehouses.join(", "))} · ${__("qty")} ${s.qty}</div>
                    <div style="height:10px; background:#e5e7eb; border-radius:5px; overflow:hidden;">
                        <div style="height:100%; width:${pct}%; background:#2563eb;"></div></div>
                    <div style="margin-top:6px;">${__("{0} of {1} items ({2}%) · {3} rows added in {4} Stock Entries", [s.processed, s.total, pct, s.added_rows, s.entries])}</div>
                    <div class="text-muted">${__("Parallel lanes: {0} ({1} finished) · Time left: about {2}", [s.lanes, s.lanes_done, fmt_dur(s.eta_seconds)])}</div>
                    ${s.failed_rows ? `<div style="color:#b91c1c;">${__("{0} rows failed — details in the final summary", [s.failed_rows])}</div>` : ""}
                    ${s.stalled_lanes.length ? `<div style="color:#b45309; margin-top:6px;">${__("{0} lane(s) stopped moving (e.g. a server restart). Resume continues them from where they stopped — nothing is added twice.", [s.stalled_lanes.length])}</div>` : ""}
                    <div style="margin-top:10px; display:flex; gap:8px;">
                        ${s.stalled_lanes.length ? `<button class="btn btn-primary btn-sm wh-resume">${__("Resume")}</button>` : ""}
                        ${s.status === "running" ? `<button class="btn btn-default btn-sm wh-stop">${__("Stop")}</button>` : ""}
                        <button class="btn btn-default btn-sm wh-refresh">${__("Refresh")}</button>
                    </div>
                    <div class="text-muted" style="margin-top:8px; font-size:12px;">${__("You can close this — you'll get a notification (bell) when it finishes.")}</div>
                </div>`);
        };
        const reload = () => frappe.call({ method: "erp_dacsinc_custom.warehouse_add_stock.get_add_stock_status" })
            .then((r) => { if (r.message) paint(r.message); });
        d.$wrapper.on("click", ".wh-refresh", reload);
        d.$wrapper.on("click", ".wh-stop", () => frappe.confirm(__("Stop after the Stock Entry in progress? Everything added so far stays."), () =>
            frappe.call({ method: "erp_dacsinc_custom.warehouse_add_stock.stop_add_stock", args: { run_id: st.run_id } })
                .then((r) => r.message && paint(r.message))));
        d.$wrapper.on("click", ".wh-resume", () =>
            frappe.call({ method: "erp_dacsinc_custom.warehouse_add_stock.resume_add_stock", args: { run_id: st.run_id } })
                .then((r) => { frappe.show_alert({ message: __("Resumed {0} lane(s)", [r.message.resumed]), indicator: "green" }); paint(r.message); }));
        paint(st);
        d.show();
        watch_run(listview, { run_id: st.run_id, items: st.total, warehouses: st.warehouses.length }, true);
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
                {
                    // With perpetual inventory ERPNext needs a value for every
                    // receipt. Items that already have a rate always use it.
                    fieldname: "no_rate_action",
                    fieldtype: "Select",
                    label: __("Items with no valuation rate"),
                    options: [
                        { value: "skip", label: __("Skip them (report in the summary)") },
                        { value: "zero", label: __("Add at zero value") },
                        { value: "rate", label: __("Add at a rate I enter") },
                    ],
                    default: "skip",
                    description: __("An item has no rate when it has no stock history, no Valuation Rate / Standard Rate and no buying price."),
                },
                {
                    fieldname: "fallback_rate",
                    fieldtype: "Currency",
                    label: __("Rate per unit for those items"),
                    depends_on: "eval:doc.no_rate_action == 'rate'",
                    mandatory_depends_on: "eval:doc.no_rate_action == 'rate'",
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
                            args: { warehouses: warehouses, qty: values.qty, all_items: all_items ? 1 : 0, item_codes: item_codes,
                                    no_rate_action: values.no_rate_action || "skip", fallback_rate: values.fallback_rate || 0 },
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
