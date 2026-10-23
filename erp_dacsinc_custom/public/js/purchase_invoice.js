frappe.ui.form.on('Purchase Invoice', {
    // Rate is read-only on every row (Property Setter): users change the Price List Rate and
    // the discount instead. ERPNext's own refresh flips it back to editable on rows without a
    // Purchase Receipt when Buying Settings > Maintain Same Rate is on, so keep it locked here.
    setup: function(frm) {
        const grid = frm.fields_dict.items && frm.fields_dict.items.grid;
        if (!grid || grid.__dacs_rate_locked) return;
        grid.__dacs_rate_locked = true;
        const orig = grid.update_docfield_property.bind(grid);
        grid.update_docfield_property = function(fieldname, property, value) {
            if (fieldname === 'rate' && property === 'read_only') value = 1;
            return orig(fieldname, property, value);
        };
    },

    onload_post_render: function(frm) {
        clean_up_get_items_buttons(frm);
    },
    
    refresh: function(frm) {
        clean_up_get_items_buttons(frm);
        // The Make Payment prompt (public/js/payment_prompt.js — the same one as Order Flow ›
        // Finance) in place of ERPNext's Create › Payment, which is removed (added after async
        // calls, so removed again a few times).
        const drop_payment = () => frm.remove_custom_button(__('Payment'), __('Create'));
        drop_payment();
        [300, 800, 1500, 2500].forEach(delay => setTimeout(drop_payment, delay));
        // A Debit Note (return): its own actions — Receive Refund / Adjust (public/js/return_actions.js).
        dacs_load_return_actions(frm);
        if (frm.doc.docstatus === 1 && !cint(frm.doc.is_return) && flt(frm.doc.outstanding_amount) > 0 && frappe.model.can_create('Payment Entry')) {
            frm.add_custom_button(__('Make Payment'), () => {
                frappe.require('/assets/erp_dacsinc_custom/js/payment_prompt.js', () =>
                    of_payment_prompt('Purchase Invoice', frm.doc.name, () => frm.reload_doc(), { from_form: 1 }));
            }).addClass('btn-primary');
        }
        
        if(frm.doc.docstatus === 0) {
            frm.add_custom_button(__('Get Items from PR'), function() {
                render_custom_pr_selector(frm);
            });
        }
    }
});

function clean_up_get_items_buttons(frm) {
    const parent = __('Get Items From');
    const standard_buttons = [
        __('Purchase Order'), 
        __('Purchase Receipt'), 
        __('Supplier Quotation'), 
        __('Material Request'), 
        __('Product Bundle')
    ];
    const remover = () => {
        standard_buttons.forEach(btn => frm.remove_custom_button(btn, parent));
    };
    remover();
    [200, 500, 1000, 2000].forEach(delay => setTimeout(remover, delay));
}

function render_custom_pr_selector(frm) {
    if (!frm.doc.supplier) {
        frappe.msgprint(__("Please select a Supplier first."));
        return;
    }

    frappe.db.get_value('Supplier', frm.doc.supplier, 'custom_is_jobber', (r) => {
        const is_jobber = r && r.custom_is_jobber === 1;
        const default_subcon_filter = is_jobber ? 1 : (frm.doc.is_subcontracted ? 1 : 0);

        let dialog = new frappe.ui.Dialog({
            title: `Procurement Planner: ${frm.doc.supplier_name || frm.doc.supplier}`,
            size: 'extra-large',
            fields: [
                {
                    fieldname: 'is_subcontracted_filter',
                    label: __('Show Subcontracted (Job Work) Receipts'),
                    fieldtype: 'Check',
                    default: default_subcon_filter,
                    description: '',
                    onchange: () => load_data()
                },
                { fieldname: 'html_area', fieldtype: 'HTML' }
            ],
            primary_action_label: __("Update Invoice Lines"),
            primary_action: function() {
                const selected = dialog.$wrapper.find('.pr-check-input:checked');
                if (!selected.length) return frappe.msgprint("Please select items.");

                // "Is Subcontracted" and the supplier warehouse are set from the receipt below.

                // Lines are built on the server with ERPNext's own Purchase Receipt →
                // Purchase Invoice mapping (purchase_order.map_pr_items_for_invoice), so UOM,
                // conversion factor, rate, warehouse and PO link match the receipt. Setting
                // item_code on a blank row let ERPNext's item fetch overwrite the UOM afterwards
                // ("UOM must be equal to 'Meter'").
                const picks = [];
                selected.each(function() {
                    // Row data is kept in dialog._pr_rows (an index on the row), not as JSON in an
                    // HTML attribute: a name with an apostrophe ("Men's …") cut that JSON short.
                    const d = (dialog._pr_rows || [])[cint($(this).closest('tr').attr('data-row-idx'))];
                    const qty = flt($(this).closest('tr').find('.qty-billing-input').val());
                    if (d && qty > 0) picks.push({ pr_detail: d.pr_detail, qty });
                });
                if (!picks.length) return frappe.msgprint(__("Enter a quantity to bill."));

                frappe.call({
                    method: "erp_dacsinc_custom.purchase_order.map_pr_items_for_invoice",
                    args: { rows: picks },
                    freeze: true,
                }).then(r => {
                    const res = r.message || {};
                    const items = res.items || [];
                    const header = res.header || {};
                    // Header from the same receipt mapping: a subcontract (SCO) receipt makes a
                    // subcontracted invoice with the receipt's supplier warehouse.
                    if (cint(frm.doc.is_subcontracted) !== cint(header.is_subcontracted)) frm.doc.is_subcontracted = cint(header.is_subcontracted);
                    if (header.supplier_warehouse) frm.doc.supplier_warehouse = header.supplier_warehouse;
                    else if (cint(header.is_subcontracted) && !frm.doc.supplier_warehouse) frm.doc.supplier_warehouse = "Jobbers Warehouse - IND";
                    frm.refresh_fields(['is_subcontracted', 'supplier_warehouse']);
                    frm.clear_table("items");
                    items.forEach(it => frm.add_child('items', it));
                    frm.refresh_field('items');
                    if (frm.cscript && frm.cscript.calculate_taxes_and_totals) frm.cscript.calculate_taxes_and_totals();
                    frm.dirty();
                    dialog.hide();
                    frappe.show_alert({message: __("Lines added from the receipt."), indicator: 'green'});
                });
            }
        });

        const SCOPED_STYLE = `
            <style>
                .custom-invoice-planner-container .pro-planner-table { width: 100%; border-collapse: separate; border-spacing: 0 8px; font-size: 12.5px; table-layout: fixed; }
                .custom-invoice-planner-container .pro-row { background: #fff; border: 1px solid #ebedef; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); transition: background 0.2s; }
                .custom-invoice-planner-container .pro-row td { padding: 12px; vertical-align: middle; }
                .custom-invoice-planner-container .pro-row.row-selected { border-color: #2490ef !important; background-color: #f5faff !important; }
                
                .custom-invoice-planner-container .item-title { font-weight: 700; color: #1e293b; text-decoration: none !important; font-size: 13px; }
                .custom-invoice-planner-container .pill { padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 700; display: inline-flex; border: 1px solid transparent; }
                .custom-invoice-planner-container .pr-pill { background: #fffbeb; color: #92400e; border-color: #fef3c7; }
                .custom-invoice-planner-container .inv-pill { background: #eff6ff; color: #1e40af; border-color: #bfdbfe; }
                
                .custom-invoice-planner-container .sum-card { background: #f8fafc; padding: 8px 10px; border-radius: 6px; border: 1px solid #f1f5f9; display: flex; flex-direction: column; width: 115px; }
                .custom-invoice-planner-container .sum-line { display: flex; justify-content: space-between; font-size: 10px; font-weight: 700; margin-bottom: 2px;}
                
                .custom-invoice-planner-container .qty-billing-input { width: 85px; text-align: center; border: 1px solid #d1d5db; font-weight: 800; color: #c2410c; border-radius: 4px; height: 32px; font-size: 14px; }
                .custom-invoice-planner-container .unique-search-input { width: 100%; padding: 8px 12px; border: 1px solid #d1d8dd; border-radius: 6px; margin-bottom: 15px; }
                .custom-invoice-planner-container .lbl-meta { font-size: 9px; font-weight: 800; color: #94a3b8;  margin-bottom: 3px; display: block; }
                .custom-invoice-planner-container .badge-stack { display: flex; flex-wrap: wrap; gap: 4px; }
            </style>`;

        function load_data() {
            let is_sub = dialog.get_value('is_subcontracted_filter') ? 1 : 0;
            frappe.call({
                method: "erp_dacsinc_custom.purchase_order.get_pending_pr_items",
                args: { supplier: frm.doc.supplier, is_subcontracted: is_sub },
                callback: (r) => render_table(r.message || [], is_sub)
            });
        }

        function render_table(data, is_sub) {
            dialog._pr_rows = data;
            const esc = (v) => frappe.utils.escape_html(v == null ? '' : String(v));
            let rows_html = data.map((d, idx) => {
                let searchVal = `${d.pr_name} ${d.item_code} ${d.item_name}`.toLowerCase();
                let history_links = (d.history_links || []).map(h => `<a href="/app/purchase-invoice/${h.inv_id}" target="_blank" class="pill inv-pill">${h.inv_id}</a>`).join('');

                return `
                <tr class="pro-row" data-row-idx="${idx}" data-search-tag="${esc(searchVal)}">
                    <td class="text-center"><input type="checkbox" class="pr-check-input"></td>
                    <td>
                        <a href="/app/purchase-receipt/${d.pr_name}" target="_blank" class="pill pr-pill" style="margin-bottom:4px;">${d.pr_name}</a>
                        <div class="lbl-meta">Post Date: ${frappe.datetime.str_to_user(d.posting_date)}</div>
                    </td>
                    <td>
                        <a href="/app/item/${d.item_code}" target="_blank" class="item-title">${d.item_code}</a>
                        <div style="font-size:11px; color:#64748b;">${esc(d.item_name)}</div>
                        ${d.finished_good_item_code ? `<div class="pill" style="background:#f0fdf4; color:#166534; margin-top:4px;">FG: ${d.finished_good_item_code}</div>` : ''}
                    </td>
                    <td>
                        <div class="sum-card">
                            <div class="sum-line" style="color:#64748b;"><span>TOTAL PR:</span><span>${d.total_pr_qty}</span></div>
                            <div class="sum-line" style="color:#ef4444; border-bottom:1px solid #ebedef;"><span>BILLED:</span><span>-${d.billed_qty}</span></div>
                            <div class="sum-line" style="color:#3b82f6; padding-top:2px; font-size:11px;"><span>BALANCE:</span><span>${d.pending_qty}</span></div>
                        </div>
                    </td>
                    <td>
                        <span class="lbl-meta">Invoice Audit Logs</span>
                        <div class="badge-stack">${history_links || '<span style="color:#ccc;">No History</span>'}</div>
                    </td>
                    <td class="text-right">
                        <input type="number" class="qty-billing-input" value="${d.pending_qty}" max="${d.pending_qty}" min="0">
                        <div class="lbl-meta" style="text-align:center; margin-top:5px; color:#1e293b !important; font-weight:bold !important;">RATE: ${format_currency(d.rate, frm.doc.currency)}</div>
                    </td>
                </tr>`;
            }).join('');

            let html = SCOPED_STYLE + `
                <div class="custom-invoice-planner-container">
                    <input type="text" class="unique-search-input" id="pro-local-filter" placeholder="Search item, receipt id...">
                    <div style="max-height: 55vh; overflow-y:auto; overflow-x:hidden;">
                        <table class="pro-planner-table">
                            <thead><tr style="color: #80848a; font-size: 10px; font-weight: 800; ">
                                <th width="45px" class="text-center"><input type="checkbox" id="pro-master-checkbox" style="cursor:pointer;"></th>
                                <th width="20%">${__('Receipt')}</th>
                                <th width="25%">${__('Item Info')}</th>
                                <th width="15%">${__('Analysis')}</th>
                                <th width="25%">${__('Previously Billed')}</th>
                                <th width="110px" class="text-right">${__('Qty to Bill')}</th>
                            </tr></thead>
                            <tbody>${rows_html || '<tr><td colspan="6" class="text-center p-4">All items in this supplier/mode filtered have been billed.</td></tr>'}</tbody>
                        </table>
                    </div>
                </div>`;
            
            dialog.fields_dict.html_area.$wrapper.html(html);
            
            // Logic Hooks
            dialog.$wrapper.find('#pro-local-filter').on('keyup', function() {
                let v = $(this).val().toLowerCase();
                dialog.$wrapper.find('.pro-row').each(function() {
                    $(this).toggle($(this).attr('data-search-tag').includes(v));
                });
            });

            dialog.$wrapper.find('#pro-master-checkbox').on('change', function() {
                let active = this.checked;
                dialog.$wrapper.find('.pr-check-input:visible').each(function() {
                    $(this).prop('checked', active).trigger('change');
                });
            });

            dialog.$wrapper.find('.pr-check-input').on('change', function() {
                $(this).closest('tr').toggleClass('row-selected', this.checked);
            });
            
            // Fix: Re-force positive quantities if user types manual numbers
            dialog.$wrapper.find('.qty-billing-input').on('change', function() {
                if (flt($(this).val()) < 0) $(this).val(0);
            });
        }

        dialog.show();
        load_data();

        // Open on the kind of receipt this supplier actually has waiting: the jobber flag on
        // the supplier is not always set, and subcontract receipts stayed hidden behind the box.
        frappe.call({
            method: "erp_dacsinc_custom.purchase_order.pending_pr_line_counts",
            args: { supplier: frm.doc.supplier },
        }).then(r => {
            const c = r.message || {};
            const n = cint(c.normal), sc = cint(c.subcontracted);
            const fld = dialog.fields_dict.is_subcontracted_filter;
            fld.set_description(__('Waiting to bill: {0} normal receipt line(s), {1} subcontract (job work) receipt line(s).', [n, sc]));
            const want = (sc && !n) ? 1 : ((n && !sc) ? 0 : null);
            if (want !== null && cint(dialog.get_value('is_subcontracted_filter')) !== want && !is_jobber && !frm.doc.is_subcontracted) {
                dialog.set_value('is_subcontracted_filter', want);
            }
        });
    });
}

// Credit / Debit Note actions on the form: public/js/return_actions.js (shared with Sales Invoice).
if (typeof window.dacs_load_return_actions !== 'function') {
    window.dacs_load_return_actions = function (frm) {
        // Print: a return prints as a Credit Note / Debit Note (print_format credit_note_dac /
        // debit_note_dac); an ordinary invoice keeps its own default.
        const ret_pf = frm.doc.doctype === 'Sales Invoice' ? 'Credit Note DAC' : 'Debit Note DAC';
        frm.return_print_format = ret_pf;
        if (cint(frm.doc.is_return)) {
            if (frm.meta.default_print_format !== ret_pf) {
                frm.meta._dacs_default_print_format = frm.meta.default_print_format || null;
                frm.meta.default_print_format = ret_pf;
            }
        } else if (frm.meta.default_print_format === ret_pf) {
            frm.meta.default_print_format = frm.meta._dacs_default_print_format || null;
        }
        if (!cint(frm.doc.is_return)) { $(frm.layout.wrapper).find('.dacs-rp').remove(); return; }
        frappe.require('/assets/erp_dacsinc_custom/js/return_actions.js', () => window.dacs_return_actions(frm));
    };
}
