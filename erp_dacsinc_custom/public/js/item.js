// ================================================================
//  Item DocType — Client Script
//  File: erp_dacsinc_custom/public/js/item.js
// ================================================================

frappe.ui.form.on('Item', {
    /**
     * This event triggers every time the form is loaded or refreshed.
     */
    refresh(frm) {
        if (frm.is_new()) {
            frm.set_df_property('custom_bom_html', 'hidden', 1);
            return;
        }

        // --- Custom Send to Embroidery Button ---
        // frm.add_custom_button(__('Send to Embroidery'), () => {
        //     const dialog = new frappe.ui.Dialog({
        //         title: __('Send to Embroidery'),
        //         fields: [
        //             {
        //                 fieldtype: 'Link',
        //                 fieldname: 'target_item',
        //                 options: 'Item',
        //                 label: __('Target Item (Embroidered)'),
        //                 reqd: 1
        //             },
        //             {
        //                 fieldtype: 'Link',
        //                 fieldname: 'from_warehouse',
        //                 options: 'Warehouse',
        //                 label: __('From Warehouse'),
        //                 reqd: 1,
        //                 onchange: function() {
        //                     const val = this.get_value();
        //                     if (val) {
        //                         frappe.call({
        //                             method: 'erp_dacsinc_custom.uniform_transfer_api.get_item_stock_details',
        //                             args: {
        //                                 item_code: frm.doc.name,
        //                                 warehouse: val
        //                             }
        //                         }).then(r => {
        //                             const d = r.message || {};
        //                             const html = `
        //                                 <div style="margin-top: 10px; padding: 12px; font-size: 12px; line-height: 1.6; border: 1px solid #d1ecf1; border-radius: 4px; background-color: #f8f9fa; color: #0c5460;">
        //                                     <strong style="font-size: 13px;">Stock Details for ${frappe.utils.escape_html(frm.doc.name)}:</strong><br>
        //                                     • Actual Physical Qty: <b>${d.actual_qty}</b><br>
        //                                     • Reserved for Sales: <b>${d.reserved_qty}</b><br>
        //                                     • Reserved for Production: <b>${d.reserved_qty_for_production}</b><br>
        //                                     • Reserved for Subcontract: <b>${d.reserved_qty_for_sub_contract}</b><br>
        //                                     <div style="border-top: 1px dashed #bee5eb; margin: 8px 0; padding-top: 8px;">
        //                                         <span style="color: #28a745; font-weight: 700; font-size: 13px;">✔ Fully Available (Unreserved): ${d.net_available}</span>
        //                                     </div>
        //                                 </div>
        //                             `;
        //                             dialog.fields_dict.stock_details_html.$wrapper.html(html);
        //                         });
        //                     } else {
        //                         dialog.fields_dict.stock_details_html.$wrapper.html('');
        //                     }
        //                 }
        //             },
        //             {
        //                 fieldtype: 'HTML',
        //                 fieldname: 'stock_details_html'
        //             },
        //             {
        //                 fieldtype: 'Link',
        //                 fieldname: 'wip_warehouse',
        //                 options: 'Warehouse',
        //                 label: __('WIP Warehouse (Embroiderer)'),
        //                 reqd: 1
        //             },
        //             {
        //                 fieldtype: 'Float',
        //                 fieldname: 'qty',
        //                 label: __('Quantity'),
        //                 reqd: 1
        //             }
        //         ],
        //         primary_action_label: __('Send'),
        //         primary_action: (values) => {
        //             dialog.get_primary_btn().attr('disabled', true);
        //             frappe.call({
        //                 method: 'erp_dacsinc_custom.uniform_transfer_api.create_embroidery_transfer',
        //                 args: {
        //                     source_item: frm.doc.name,
        //                     target_item: values.target_item,
        //                     qty: values.qty,
        //                     from_warehouse: values.from_warehouse,
        //                     wip_warehouse: values.wip_warehouse
        //                 }
        //             }).then(r => {
        //                 dialog.hide();
        //                 frappe.show_alert({message: __('Plain items transferred to embroidery WIP successfully'), color: 'green'});
        //                 frm.reload_doc();
        //             }).always(() => {
        //                 dialog.get_primary_btn().attr('disabled', false);
        //             });
        //         }
        //     });
        //     dialog.show();
        // });

        // --- BOM Overview Table ---
        if (frm.fields_dict['custom_bom_html']) {
            frm.set_df_property('custom_bom_html', 'hidden', 0);

            const bom_wrapper = frm.fields_dict['custom_bom_html'].$wrapper;
            bom_wrapper.html('<div class="text-muted" style="padding: 15px;">Loading BOM data...</div>');

            frappe.call({
                method: "erp_dacsinc_custom.custom_script.get_bom_data_for_item",
                args: {
                    item_code: frm.doc.name
                },
                callback: function(response) {
                    const boms_data = response.message;
                    const final_html = build_bom_html_table(boms_data, frm.doc.name);
                    bom_wrapper.html(final_html);

                    bom_wrapper.off('click', '.btn-create-bom').on('click', '.btn-create-bom', function(e) {
                        e.preventDefault();
                        let itemCode = decodeURIComponent($(this).data('item'));
                        if (itemCode) {
                            frappe.new_doc('BOM', {
                                'item': itemCode, 
                                'quantity': 1,
                                'currency': frm.doc.currency || 'INR'
                            });
                        }
                    });
                },
                error: function() {
                    bom_wrapper.html('<div class="text-danger" style="padding: 15px;">Failed to fetch BOM data.</div>');
                }
            });
        }
    }
});

/**
 * Builds an HTML string with a button that has a data attribute for the item code.
 * The button will be controlled by our JavaScript event handler.
 * @param {Array} data The array of BOM data.
 * @param {String} item_code The item code for the current document.
 * @returns {String} The complete HTML string for the table.
 */
function build_bom_html_table(data, item_code) {
    const create_bom_button_html = `
        <a href="#" class="btn-create-bom" data-item="${encodeURIComponent(item_code)}">
            <i class="fa fa-plus"></i> Create BOM
        </a>`;

    let html = `
        <style>
            .bom-wrapper { font-family: 'Helvetica Neue', Arial, sans-serif; border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px; background-color: #f9f9f9; }
            .bom-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #4A90E2; padding-bottom: 5px; }
            .bom-header h3 { border-bottom: none; padding-bottom: 0; margin: 0; color: #2c3e50; font-size: 16px; font-weight: 600; }
            .btn-create-bom { background-color: #5cb85c; color: white !important; padding: 6px 12px; border-radius: 4px; font-size: 0.9em; font-weight: bold; white-space: nowrap; }
            .btn-create-bom:hover { background-color: #4cae4c; color: white !important; text-decoration: none; }
            .bom-table, .materials-table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            .bom-table th, .materials-table th { background-color: #4A90E2; color: white; padding: 10px 12px; text-align: left; }
            .bom-table td, .materials-table td { border: 1px solid #ddd; padding: 8px 12px; }
            .materials-table { margin-bottom: 20px; }
            .bom-table > tbody > tr:nth-of-type(odd) { background-color: #f2f2f2; }
            .bom-wrapper a { text-decoration: none; font-weight: bold; color: #3498db; }
            .bom-wrapper a:hover { text-decoration: underline; }
            .col-amount { text-align: right; }
            .status-active { color: #28a745; font-weight: bold; }
            .status-inactive { color: #dc3545; font-weight: bold; }
            .status-draft { color: #e67e22; font-weight: bold; }
        </style>
        <div class="bom-wrapper">
            <div class="bom-header">
                <h3>Bill of Materials Overview</h3>
                ${create_bom_button_html}
            </div>
    `;

    if (!data || data.length === 0) {
        html += `<p style="margin-top: 15px;">No Bill of Materials found for this item.</p></div>`;
        return html;
    }

    html += `
            <table class="bom-table">
                <thead>
                    <tr>
                        <th>BOM Name</th>
                        <th>Status</th>
                        <th>Default</th>
                    </tr>
                </thead>
                <tbody>
    `;
    data.forEach(bom => {
        const bom_url = `/app/bom/${encodeURIComponent(bom.name)}`;
        const is_default_class = bom.is_default ? 'default-bom' : '';
        let status_text, status_class;
        if (cint(bom.docstatus) === 0) {
            status_text = 'Draft';
            status_class = 'status-draft';
        } else if (bom.is_active) {
            status_text = 'Active';
            status_class = 'status-active';
        } else {
            status_text = 'Inactive';
            status_class = 'status-inactive';
        }
        const is_default_text = bom.is_default ? 'Yes' : 'No';

        html += `
            <tr class="${is_default_class}">
                <td><a href="${bom_url}" target="_blank"><strong>${bom.name}</strong></a></td>
                <td><span class="${status_class}">${status_text}</span></td>
                <td>${is_default_text}</td>
            </tr>
            <tr>
                <td colspan="3" style="padding: 15px;">
                    <strong>Raw Materials for ${bom.name}:</strong>
                    <table class="materials-table">
                        <thead>
                            <tr>
                                <th>Item Code</th>
                                <th>Item Name</th>
                                <th>Qty</th>
                                <th>UOM</th>
                                <th class="col-amount">Rate</th>
                                <th class="col-amount">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        if (bom.items && bom.items.length > 0) {
            bom.items.forEach(item => {
                const item_url = `/app/item/${encodeURIComponent(item.item_code)}`;
                const uom = item.uom || '';
                const rate = frappe.format(item.rate, {fieldtype: 'Currency'});
                const amount = frappe.format(item.amount, {fieldtype: 'Currency'});
                html += `
                    <tr>
                        <td><a href="${item_url}" target="_blank">${item.item_code}</a></td>
                        <td>${item.item_name || ''}</td>
                        <td>${item.qty}</td>
                        <td>${uom}</td>
                        <td class="col-amount">${rate}</td>
                        <td class="col-amount">${amount}</td>
                    </tr>
                `;
            });
        } else {
             html += `<tr><td colspan="6">No raw materials listed.</td></tr>`;
        }
        html += `
                        </tbody>
                    </table>
                </td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>
        </div>
    `;

    return html;
}
