frappe.ui.form.on('Purchase Invoice', {
    onload_post_render: function(frm) {
        clean_up_get_items_buttons(frm);
    },
    
    refresh: function(frm) {
        clean_up_get_items_buttons(frm);
        
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
                    label: __('Show Subcontracted Receipts'),
                    fieldtype: 'Check',
                    default: default_subcon_filter,
                    onchange: () => load_data()
                },
                { fieldname: 'html_area', fieldtype: 'HTML' }
            ],
            primary_action_label: __("Update Invoice Lines"),
            primary_action: function() {
                const selected = dialog.$wrapper.find('.pr-check-input:checked');
                if (!selected.length) return frappe.msgprint("Please select items.");

                const filter_val = dialog.get_value('is_subcontracted_filter') ? 1 : 0;
                if (frm.doc.is_subcontracted !== filter_val) frm.set_value('is_subcontracted', filter_val);

                frm.clear_table("items");

                selected.each(function() {
                    const d = JSON.parse($(this).closest('tr').attr('data-row-obj')); 
                    const qty = flt($(this).closest('tr').find('.qty-billing-input').val());

                    if (qty > 0) {
                        let row = frm.add_child('items');
                        
                        // FIX: Setting fields individually ensures Rate is not overwritten 
                        // by Frappe's Price List fetching background triggers
                        frappe.model.set_value(row.doctype, row.name, 'item_code', d.item_code);
                        frappe.model.set_value(row.doctype, row.name, 'qty', qty);
                        frappe.model.set_value(row.doctype, row.name, 'uom', d.uom);
                        frappe.model.set_value(row.doctype, row.name, 'purchase_receipt', d.pr_name);
                        frappe.model.set_value(row.doctype, row.name, 'pr_detail', d.pr_detail);
                        frappe.model.set_value(row.doctype, row.name, 'cost_center', d.cost_center);
                        frappe.model.set_value(row.doctype, row.name, 'expense_account', d.expense_account);
                        
                        if (filter_val === 1) {
                            frappe.model.set_value(row.doctype, row.name, 'supplier_warehouse', "Jobbers Warehouse - IND");
                        }

                        // Set Rate last as the absolute override
                        frappe.model.set_value(row.doctype, row.name, 'rate', flt(d.rate));
                    }
                });

                frm.refresh_field('items');
                dialog.hide();
                frappe.show_alert({message: __("Lines and Rates populated."), indicator: 'green'});
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
            let rows_html = data.map((d) => {
                let searchVal = `${d.pr_name} ${d.item_code} ${d.item_name}`.toLowerCase();
                let history_links = (d.history_links || []).map(h => `<a href="/app/purchase-invoice/${h.inv_id}" target="_blank" class="pill inv-pill">${h.inv_id}</a>`).join('');

                return `
                <tr class="pro-row" data-row-obj='${JSON.stringify(d)}' data-search-tag="${searchVal}">
                    <td class="text-center"><input type="checkbox" class="pr-check-input"></td>
                    <td>
                        <a href="/app/purchase-receipt/${d.pr_name}" target="_blank" class="pill pr-pill" style="margin-bottom:4px;">${d.pr_name}</a>
                        <div class="lbl-meta">Post Date: ${frappe.datetime.str_to_user(d.posting_date)}</div>
                    </td>
                    <td>
                        <a href="/app/item/${d.item_code}" target="_blank" class="item-title">${d.item_code}</a>
                        <div style="font-size:11px; color:#64748b;">${d.item_name}</div>
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
    });
}
