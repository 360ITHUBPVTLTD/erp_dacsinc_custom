frappe.ui.form.on('Material Request', {
    refresh: function(frm) {
        // Clean up standard buttons
        setTimeout(() => {
            frm.remove_custom_button('Bill of Materials', 'Get Items From');
            frm.remove_custom_button('Sales Order', 'Get Items From');
            frm.remove_custom_button('Product Bundle', 'Get Items From');
            // frm.remove_custom_button('Purchase Order', 'Create');
            // frm.remove_custom_button('Request for Quote', 'Create');
            // frm.remove_custom_button('Supplier Quotation', 'Create');
        }, 500);

        // Get Item From SO button
        if (frm.doc.docstatus === 0) {
            frm.add_custom_button(__('Get Item From SO'), function() {
                load_smart_planner(frm);
            });
        }

        // Subcontracted Purchase Order button
        if (frm.doc.custom_is_subcontracted == 1 && frm.doc.docstatus === 1) {
            frm.add_custom_button(__('Subcontracted Purchase Order'), function () {
                // Prompt to ask Supplier
                frappe.prompt([
                    {
                        fieldname: 'supplier',
                        fieldtype: 'Link',
                        options: 'Supplier',
                        label: 'Supplier',
                        reqd: 1
                    }
                ],
                function(values){
                    // Call server method with selected supplier
                    frappe.call({
                        method: "erp_dacsinc_custom.custom_script.make_purchase_order",
                        args: { 
                            source_name: frm.doc.name,
                            supplier: values.supplier
                        },
                        callback: function (r) {
                            if (r.message) {
                                frappe.model.with_doctype('Purchase Order', function () {
                                    let doc = frappe.model.sync(r.message)[0];
                                    frappe.set_route('Form', 'Purchase Order', doc.name);
                                });
                            }
                        }
                    });
                },
                'Select Supplier', // Dialog title
                'Create' // Primary button label
                );

            }, __('Create'));
        }
        
        // Render stock HTML
        if (!frm.is_new()) {
            render_stock_html(frm);
        }
    }
});

// Function to generate the stock availability table
function render_stock_html(frm) {
    frappe.call({
        method: "erp_dacsinc_custom.custom_script.get_material_request_stock_html",
        args: {
            items: frm.doc.items.map(i => ({
                item_code: i.item_code,
                bom_no: i.bom_no,
                sales_order: i.sales_order
            }))
        },
        callback: function (r) {
            if (r.message) {
                frm.fields_dict.custom_material_request_html.$wrapper.html(r.message);
            }
        }
    });
}

function load_smart_planner(frm) {
    frappe.dom.freeze(__('Fetching Live Status...'));
    frappe.call({
        method: 'erp_dacsinc_custom.custom_script.fetch_multi_order_requirements',
        args: {
            exclude_mr: frm.doc.name
        },
        callback: function(r) {
            frappe.dom.unfreeze();
            if (r.message) render_fulfillment_dialog(frm, r.message);
        }
    });
}

function render_fulfillment_dialog(frm, data) {
    let d = new frappe.ui.Dialog({
        title: '<span style="font-weight:900;">Global Procurement Planning (Material Request)</span>',
        size: 'extra-large',
        fields: [
            { fieldtype: 'Data', fieldname: 'search', placeholder: 'Global Search (Item, SO, Customer)...', label: 'Filter Workspace' },
            { fieldtype: 'Section Break', label: '1. Individual Purchase Requirements' },
            { fieldtype: 'HTML', fieldname: 'std_table' },
            { fieldtype: 'Section Break', label: '2. Consolidated BOM Components' },
            { fieldtype: 'HTML', fieldname: 'rm_table' }
        ],
        primary_action_label: 'Update Request Table (Clear & Add)',
        primary_action: function() { process_submission(d, frm, data); }
    });

    const link = (dt, id, txt = null) => `<a href="/app/${dt.toLowerCase().replace(/ /g, '-')}/${id}" target="_blank" style="font-weight:700; color:#2563eb;">${txt || id}</a>`;

    const format_links = (links) => {
        if (!links || links.length === 0) return '<div style="color:#cbd5e1; font-style:italic;">No links</div>';
        return links.map(l => `<div style="margin-bottom:6px; font-size:10px;">${link('Material Request', l.name)}<br><span style="color:${l.docstatus == 1 ? '#059669' : '#ea580c'}; font-weight:800;">${l.status}</span></div>`).join('');
    };

    // --- TABLE 1: Standard Items (Individual Requirements) ---
    let h_std = `
    <div style="max-height: 300px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
        <table class="table table-sm std-table-grid" style="margin:0; font-size:11px; vertical-align:middle;">
            <thead style="background:#f8fafc; position:sticky; top:0; z-index:10; font-size:10px; color:#64748b; ">
                <tr>
                    <th width="40px" class="text-center p-2"><input type="checkbox" id="m_check_std"></th>
                    <th width="30%" class="p-2">Item Code & Sales Order</th>
                    <th width="20%" class="p-2">Current Analysis</th>
                    <th width="20%" class="p-2">Existing MRs</th>
                    <th width="10%" class="text-center p-2">Warehouse</th>
                    <th width="15%" class="text-center p-2" style="background:#fffbeb; color:#854d0e;">Net Need</th>
                </tr>
            </thead><tbody>`;

    data.standard.forEach((row, i) => {
        let search_str = `${row.item_code} ${row.customer_name} ${row.so_id}`.toLowerCase();
        let group_pill = row.line_count > 1 ? `<span style="background:#fff1f2; color:#be123c; border:1px solid #fecaca; padding:1px 5px; border-radius:10px; font-size:8px; font-weight:800; margin-left:4px;">LINE GROUPED</span>` : '';

        h_std += `<tr class="planner-row-std" data-search="${search_str}" style="border-bottom: 1px solid #f1f5f9;">
            <td class="text-center p-2"><input type="checkbox" class="chk-std" data-idx="${i}"></td>
            <td class="p-2">
                <div style="font-weight:800; font-size:12px; color:#1e293b;">${link('Item', row.item_code)} ${group_pill}</div>
                <div style="margin-top:2px;">
                    ${link('Customer', row.customer, row.customer_name)}<br>
                    <small style="color:#64748b; font-weight:700;">Order: ${link('Sales Order', row.so_id)}</small>
                </div>
            </td>
            <td class="p-2" style="line-height:1.6;">
                Ord: <b>${row.order_qty}</b> | Pick: -${row.picked}<br>
                <span style="color:#6366f1;">Outstanding MR: -${row.on_request_pending}</span>
            </td>
            <td class="p-2">${format_links(row.mr_links)}</td>
            <td class="text-center p-2"><div style="font-weight:800;">${row.available}</div><small style="color:#94a3b8;">${row.uom}</small></td>
            <td class="p-2 text-center" style="background:#fffbeb;"><input type="number" min="0" class="form-control form-control-sm text-center qty-std font-weight-bold" style="color:#dc2626; border:0; background:transparent;" value="${row.shortage}"></td>
        </tr>`;
    });
    h_std += `</tbody></table></div>`;

    // --- TABLE 2: BOM Components (Raw Materials) ---
    let h_rm = `<div style="max-height: 250px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
        <table class="table table-sm rm-table-grid" style="margin:0; font-size:11px; vertical-align:middle;">
            <thead style="background:#f0f9ff; color:#0369a1; font-size:10px; position:sticky; top:0; z-index:10;">
                <tr>
                    <th width="40px" class="text-center p-2"><input type="checkbox" id="m_check_rm"></th>
                    <th width="20%" class="p-2">Item Code</th>
                    <th width="35%" class="p-2">Linked Orders & Customer</th>
                    <th width="15%" class="p-2">Current MRs</th>
                    <th width="15%" class="p-2">Math (Need-Sup)</th>
                    <th width="15%" class="text-center p-2" style="background:#ecfdf5;">Demand</th>
                </tr>
            </thead><tbody>`;

    data.raw.forEach((rm, i) => {
        let orders_meta = rm.linked_orders.map(o => `${o.name} ${o.customer_name}`).join(' ');
        let search_str = `${rm.item_code} ${orders_meta}`.toLowerCase();
        
        h_rm += `<tr class="planner-row-rm" data-search="${search_str}" style="border-bottom: 1px solid #f1f5f9;">
            <td class="text-center p-2"><input type="checkbox" class="chk-rm" data-idx="${i}" ${rm.final_shortage <= 0 ? 'disabled' : ''}></td>
            <td class="p-2">
                <b style="color:#111827;">${link('Item', rm.item_code)}</b><br>
                <small style="color:#059669; font-weight:700;">Stock: ${rm.available}</small>
            </td>
            <td class="p-2">
                <div style="max-height:60px; overflow-y:auto; border:1px solid #e2e8f0; padding:4px; border-radius:4px; display:flex; flex-direction:column; gap:3px;">
                    ${rm.linked_orders.map(o => `
                        <div style="background:#fff; border:1px solid #e2e8f0; padding:2px 4px; font-size:9px; border-radius:3px;">
                            ${link('Sales Order', o.name)} &bull; ${link('Customer', o.customer || o.customer_name, o.customer_name)}
                        </div>`).join('')}
                </div>
            </td>
            <td class="p-2">${format_links(rm.mr_links)}</td>
            <td class="p-2" style="line-height:1.4;">
                Need: <b>${rm.qty_needed.toFixed(2)}</b><br>
                <span style="color:#d97706;">Sup: -${rm.open_supply_qty.toFixed(2)}</span>
            </td>
            <td class="p-2 text-center" style="background:#ecfdf5;"><input type="number" min="0" class="form-control form-control-sm text-center qty-rm font-weight-bold" style="border:0; background:transparent;" value="${rm.final_shortage.toFixed(2)}"></td>
        </tr>`;
    });
    h_rm += `</tbody></table></div>`;

    d.fields_dict.std_table.$wrapper.html(h_std);
    d.fields_dict.rm_table.$wrapper.html(h_rm);

    // --- Search Filter logic ---
    d.fields_dict.search.$input.on('keyup', function() {
        let val = $(this).val().toLowerCase();
        d.$wrapper.find('.planner-row-std, .planner-row-rm').each(function() {
            let row_text = $(this).attr('data-search') || "";
            $(this).toggle(row_text.includes(val));
        });
    });

    // --- Bind Checkboxes ---
    d.$wrapper.find('#m_check_std').on('change', function() {
        d.$wrapper.find('.planner-row-std:visible .chk-std').prop('checked', $(this).is(':checked'));
    });
    d.$wrapper.find('#m_check_rm').on('change', function() {
        d.$wrapper.find('.planner-row-rm:visible .chk-rm').prop('checked', $(this).is(':checked'));
    });

    // --- Prevent Negatives ---
    d.$wrapper.on('change', 'input[type="number"]', function() {
        if(parseFloat($(this).val()) < 0) {
            $(this).val(0);
            frappe.show_alert({message: "Negative values not allowed", indicator: 'orange'});
        }
    });

    d.show();
}

function process_submission(d, frm, data) {
    let to_be_added = [];

    // Standards
    d.$wrapper.find('.chk-std:checked').each(function() {
        let i = $(this).data('idx'); let row = data.standard[i];
        let q = parseFloat($(this).closest('tr').find('.qty-std').val()) || 0;
        if(q > 0) to_be_added.push({ item_code: row.item_code, qty: q, warehouse: row.warehouse, sales_order: row.so_id, uom: row.uom });
    });

    // RMs
    d.$wrapper.find('.chk-rm:checked').each(function() {
        let i = $(this).data('idx'); let rm = data.raw[i];
        let q = parseFloat($(this).closest('tr').find('.qty-rm').val()) || 0;
        if(q > 0) to_be_added.push({ item_code: rm.item_code, qty: q, warehouse: rm.warehouse, uom: rm.uom, description: `Consolidated BOM Items: ${rm.linked_orders.map(o => o.name).join(', ')}` });
    });

    if (to_be_added.length === 0) return frappe.msgprint("Please select items with a quantity greater than zero.");

    frm.clear_table('items');
    to_be_added.forEach(it => {
        let child = frm.add_child('items');
        frappe.model.set_value(child.doctype, child.name, 'item_code', it.item_code);
        frappe.model.set_value(child.doctype, child.name, 'qty', it.qty);
        frappe.model.set_value(child.doctype, child.name, 'warehouse', it.warehouse);
        frappe.model.set_value(child.doctype, child.name, 'uom', it.uom);
        if (it.sales_order) frappe.model.set_value(child.doctype, child.name, 'sales_order', it.sales_order);
        if (it.description) frappe.model.set_value(child.doctype, child.name, 'description', it.description);
    });

    frm.refresh_field('items');
    d.hide();
    frappe.show_alert({message: "Child table successfully cleared and repopulated.", indicator: 'green'});
}
