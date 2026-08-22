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

    // MR and PO references are kept in visually separate, clearly labeled
    // groups — mixing them together with no heading made it hard to tell,
    // at a glance, which reference was a Material Request and which was a
    // Purchase Order (their doctype is only implied by the link's own name
    // prefix otherwise).
    const format_links = (links) => {
        if (!links || links.length === 0) return '';
        return `<div style="font-size:9px; font-weight:800; color:#805ad5; text-transform:uppercase; letter-spacing:.02em; margin-bottom:2px;">Material Request</div>`
            + links.map(l => `<div style="margin-bottom:6px; font-size:10px;">${link('Material Request', l.name)}<br><span style="color:${l.docstatus == 1 ? '#059669' : '#ea580c'}; font-weight:800;">${l.status}</span></div>`).join('');
    };

    // Why the number was reduced, not just the number — clicking through
    // shows exactly which Purchase Order already covers part of this need.
    const format_po_links = (links) => {
        if (!links || links.length === 0) return '';
        return `<div style="font-size:9px; font-weight:800; color:#2563eb; text-transform:uppercase; letter-spacing:.02em; margin-bottom:2px;">Purchase Order</div>`
            + links.map(l => `<div style="margin-bottom:6px; font-size:10px;">${link('Purchase Order', l.name)}
            ${l.is_subcontracted ? '<span style="background:#ede9fe; color:#6d28d9; border-radius:8px; padding:0 5px; font-size:8px; font-weight:800;">SC</span>' : ''}<br>
            <span style="color:${l.docstatus == 1 ? '#059669' : '#ea580c'}; font-weight:800;">${l.docstatus == 1 ? 'Submitted' : 'Draft'}</span></div>`).join('');
    };

    // The SAME Material Request/Purchase Order can legitimately show up as
    // "coverage" for more than one row here for two very different reasons:
    // (a) it's an untagged, general PO/MR not earmarked to any one order, so
    // every row FOR THE SAME ITEM that could use it shows it — that's the
    // real conflict, since it's one physical quantity that can only cover
    // ONE of those rows despite being netted against each independently; or
    // (b) it's one document with separate line items for DIFFERENT raw
    // materials (e.g. one MR requesting both Fabric blue and fabric red) —
    // that's not a conflict at all, each line covers its own item. Keying
    // the usage count by (item_code, doc name) instead of just doc name
    // tells these apart: only case (a) — the same item, same document,
    // counted on more than one row — is worth warning about.
    const doc_usage_count = {};
    const count_ref = (item_code, links) => (links || []).forEach(l => {
        const key = `${item_code}::${l.name}`;
        doc_usage_count[key] = (doc_usage_count[key] || 0) + 1;
    });
    data.standard.forEach(r => { count_ref(r.item_code, r.mr_links); count_ref(r.item_code, r.po_links); });
    data.raw.forEach(r => { count_ref(r.item_code, r.mr_links); count_ref(r.item_code, r.po_links); });

    // Combines the MR and PO reference groups for one cell — "No links" only
    // when there is truly nothing covering this line from either side.
    const format_mr_po_links = (item_code, mr_links, po_links) => {
        const mr_html = format_links(mr_links);
        const po_html = format_po_links(po_links);
        if (!mr_html && !po_html) {
            return '<div style="color:#cbd5e1; font-style:italic;">No links</div>';
        }
        const shared = [...(mr_links || []), ...(po_links || [])]
            .filter(l => doc_usage_count[`${item_code}::${l.name}`] > 1);
        const warning_html = shared.length ? `
            <div style="margin-top:2px;">
                <span style="background:#fef3c7; color:#92400e; border:1px solid #fde68a; border-radius:4px; padding:2px 6px; font-size:9px; font-weight:800; display:inline-block;"
                      title="${shared.map(l => l.name).join(', ')} also shows as coverage for ${item_code} on another row here — it's the same document and item, so it can only actually cover ONE of those rows. If you select more than one row citing it, reduce all but one row's qty by hand or you'll request more than you actually need.">
                    &#9888; Shared with another row
                </span>
            </div>` : '';
        return `<div style="display:flex; flex-direction:column; gap:8px;">${mr_html}${po_html}${warning_html}</div>`;
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
                    <th width="20%" class="p-2">Existing MRs / POs</th>
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
            <td class="p-2">
                <table style="width:100%; font-size:11px; border-collapse:collapse; line-height:1.4;">
                    <tr><td style="color:#475569;">Total Ordered</td><td class="text-right font-weight-bold">${(Number(row.order_qty) || 0).toFixed(2)}</td></tr>
                    ${(Number(row.picked) || 0) > 0 ? `<tr><td style="color:#475569;">&minus; Already Picked</td><td class="text-right">${(Number(row.picked) || 0).toFixed(2)}</td></tr>` : ''}
                    ${(Number(row.available) || 0) > 0 ? `<tr><td style="color:#059669;">&minus; In Stock</td><td class="text-right" style="color:#059669;">${(Number(row.available) || 0).toFixed(2)}</td></tr>` : ''}
                    ${(Number(row.on_request_pending) || 0) > 0 ? `<tr><td style="color:#6366f1;">&minus; Pending MR</td><td class="text-right" style="color:#6366f1;">${(Number(row.on_request_pending) || 0).toFixed(2)}</td></tr>` : ''}
                    ${(Number(row.po_pending) || 0) > 0 ? `<tr><td style="color:#2563eb;">&minus; Pending PO</td><td class="text-right" style="color:#2563eb;">${(Number(row.po_pending) || 0).toFixed(2)}</td></tr>` : ''}
                    <tr style="border-top:1px solid #e2e8f0;">
                        <td style="font-weight:800; padding-top:2px;">= Still Needed</td>
                        <td class="text-right" style="font-weight:800; color:#dc2626; padding-top:2px;">${(Number(row.shortage) || 0).toFixed(2)}</td>
                    </tr>
                </table>
                ${(Number(row.general_po_qty) || 0) > 0 ? `
                <div style="margin-top:4px; font-size:10px; color:#92400e; background:#fef3c7; border:1px solid #fde68a; border-radius:4px; padding:3px 6px;"
                     title="Not tied to any Sales Order, so it can't be assumed to be reserved for this one — shown for awareness only and NOT subtracted from Still Needed. Check it manually before deciding whether it covers this order too.">
                    &#9432; ${(Number(row.general_po_qty) || 0).toFixed(2)} on unclaimed ${(row.general_po_links || []).map(l => link('Purchase Order', l.name)).join(', ') || 'PO'} (not counted above)
                </div>` : ''}
            </td>
            <td class="p-2">${format_mr_po_links(row.item_code, row.mr_links, row.po_links)}</td>
            <td class="text-center p-2"><div style="font-weight:800;">${row.available}</div><small style="color:#94a3b8;">${row.uom}</small></td>
            <td class="p-2 text-center" style="background:#fffbeb;"><input type="number" min="0" class="form-control form-control-sm text-center qty-std font-weight-bold" style="color:#dc2626; border:0; background:transparent;" value="${row.shortage}"></td>
        </tr>`;
    });
    h_std += `</tbody></table></div>`;

    // Renders the "Total Needed → ... → = Still to Request" table for one
    // RM row. Pulled out as its own function so both the initial render and
    // the live recalculation on checkbox toggle (see chk-rm-order below)
    // produce byte-identical markup — otherwise the two were free to drift,
    // e.g. one hiding a zero row the other didn't.
    const render_coverage_breakdown = (need, stock, mr, po, shortage) => `
        <table style="width:100%; font-size:11px; border-collapse:collapse; line-height:1.4;">
            <tr><td style="color:#475569;">Total Needed</td><td class="text-right font-weight-bold rm-need-val">${need.toFixed(2)}</td></tr>
            ${stock > 0 ? `<tr><td style="color:#059669;">&minus; In Stock</td><td class="text-right" style="color:#059669;">${stock.toFixed(2)}</td></tr>` : ''}
            ${mr > 0 ? `<tr><td style="color:#d97706;">&minus; Pending MR</td><td class="text-right rm-mr-val" style="color:#d97706;">${mr.toFixed(2)}</td></tr>` : ''}
            ${po > 0 ? `<tr><td style="color:#2563eb;">&minus; Pending PO</td><td class="text-right rm-po-val" style="color:#2563eb;">${po.toFixed(2)}</td></tr>` : ''}
            <tr style="border-top:1px solid #e2e8f0;">
                <td style="font-weight:800; padding-top:2px;">= Still to Request</td>
                <td class="text-right rm-shortage-val" style="font-weight:800; color:#dc2626; padding-top:2px;">${shortage.toFixed(2)}</td>
            </tr>
        </table>`;

    // --- TABLE 2: BOM Components (Raw Materials) ---
    let h_rm = `<div style="max-height: 250px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
        <table class="table table-sm rm-table-grid" style="margin:0; font-size:11px; vertical-align:middle;">
            <thead style="background:#f0f9ff; color:#0369a1; font-size:10px; position:sticky; top:0; z-index:10;">
                <tr>
                    <th width="40px" class="text-center p-2"><input type="checkbox" id="m_check_rm"></th>
                    <th width="20%" class="p-2" title="One shared, warehouse-wide figure per raw material — the same stock number applies no matter which order(s) you're planning for below, since it's the same physical material either way. It only actually changes once you receive more or consume some of it.">Item Code</th>
                    <th width="35%" class="p-2" title="Uncheck an order below to leave it out of this raw material's demand — its share won't be requested and won't get its own line on the Material Request.">Linked Orders & Customer</th>
                    <th width="15%" class="p-2">Current MRs / POs</th>
                    <th width="15%" class="p-2" title="Stock/MR/PO reflect everything currently available or already requested for this raw material, regardless of which linked orders are ticked — unticking an order only reduces 'Total Needed', not what's already covering it.">Coverage Breakdown</th>
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
                <small style="color:#059669; font-weight:700;" title="Shared across every order that needs this material — not reserved for any one of them. Requesting or consuming it here reduces what's left for all of them, not just the ones checked below.">Stock: ${rm.available}</small>
            </td>
            <td class="p-2">
                <div class="rm-orders-summary" style="font-size:9px; font-weight:800; color:#475569; margin-bottom:3px;"
                     title="How many Sales Orders contribute to this raw material's demand, and how many are currently ticked below.">
                    ${rm.linked_orders.length} order${rm.linked_orders.length === 1 ? '' : 's'} linked &middot;
                    <span class="rm-orders-checked-count">${rm.linked_orders.length}</span> ticked
                </div>
                <div style="max-height:110px; overflow-y:auto; border:1px solid #e2e8f0; padding:4px; border-radius:4px; display:flex; flex-direction:column; gap:3px;">
                    ${rm.linked_orders.map(o => `
                        <div style="background:#fff; border:1px solid #e2e8f0; padding:2px 4px; font-size:9px; border-radius:3px; display:flex; align-items:flex-start; gap:4px;">
                            <input type="checkbox" class="chk-rm-order" data-rm-idx="${i}" data-so="${o.name}"
                                   title="Untick to leave ${o.name} out of this raw material's demand" checked style="margin-top:2px;">
                            <div style="flex:1;">
                                ${link('Sales Order', o.name)} &bull; ${link('Customer', o.customer || o.customer_name, o.customer_name)}
                                ${o.fg_qty != null ? `<div style="font-family:monospace; color:#888;">
                                    ${(Number(o.fg_covered) || 0) > 0 ? `<div title="This order's own finished-good qty ordered, minus what's already covered by its own stock/picks/MR/PO — the remainder is what still needs producing, and only THAT drives raw material demand.">
                                        Ordered ${(Number(o.fg_order_qty) || 0).toFixed(2)} &minus; ${(Number(o.fg_covered) || 0).toFixed(2)} already covered = ${(Number(o.fg_qty) || 0).toFixed(2)} to produce</div>` : ''}
                                    <span title="${o.fg_item_code || ''}: qty-to-make &times; BOM qty per unit">${(Number(o.fg_qty) || 0).toFixed(2)} &times; ${(Number(o.bom_qty_per_unit) || 0).toFixed(2)}/unit = ${(Number(o.qty) || 0).toFixed(2)}</span>
                                </div>` : ''}
                            </div>
                        </div>`).join('')}
                </div>
            </td>
            <td class="p-2">${format_mr_po_links(rm.item_code, rm.mr_links, rm.po_links)}</td>
            <td class="p-2 rm-coverage-cell">${render_coverage_breakdown(
                rm.qty_needed, Number(rm.available) || 0, Number(rm.open_supply_qty) || 0,
                Number(rm.po_supply_qty) || 0, rm.final_shortage)}</td>
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

    // --- Per-order include/exclude for a raw material's demand ---
    // rm.qty_needed is exactly the sum of every linked_orders[].qty (each
    // order's own BOM-scaled share — see fetch_multi_order_requirements),
    // so unchecking one here subtracts precisely that order's share before
    // Stock/MR/PO supply is netted off again, same formula the server used
    // to produce final_shortage in the first place. Pending MR/PO are ALSO
    // recomputed here, not just held fixed — an MR/PO raised for one
    // specific Sales Order (so_mr_qty/so_po_qty) only counts while THAT
    // order stays ticked; only genuinely general/untagged supply
    // (general_mr_qty/general_po_qty) always applies. Without this, a
    // Material Request raised for SAL-ORD-B kept quietly reducing SAL-ORD-A's
    // demand even after SAL-ORD-B was unticked here.
    d.$wrapper.on('change', '.chk-rm-order', function() {
        const idx = parseInt($(this).data('rm-idx'), 10);
        const rm = data.raw[idx];
        const $tr = $(this).closest('tr.planner-row-rm');

        const included = new Set();
        $tr.find('.chk-rm-order:checked').each(function() { included.add($(this).data('so')); });
        const checked_orders = (rm.linked_orders || []).filter(o => included.has(o.name));

        $tr.find('.rm-orders-checked-count').text(included.size);

        const new_need = checked_orders.reduce((sum, o) => sum + (Number(o.qty) || 0), 0);
        const stock = Number(rm.available) || 0;
        const new_mr = (Number(rm.general_mr_qty) || 0)
            + checked_orders.reduce((sum, o) => sum + (Number(o.so_mr_qty) || 0), 0);
        const new_po = (Number(rm.general_po_qty) || 0)
            + checked_orders.reduce((sum, o) => sum + (Number(o.so_po_qty) || 0), 0);

        const new_shortage = Math.max(0, new_need - stock - new_mr - new_po);

        $tr.find('.rm-coverage-cell').html(render_coverage_breakdown(new_need, stock, new_mr, new_po, new_shortage));
        $tr.find('.qty-rm').val(new_shortage.toFixed(2));

        // Nothing left to request once every linked order is excluded (or
        // the rest are already fully covered) — same disabled state the row
        // starts in when the server itself found nothing to buy.
        const $rowChk = $tr.find('.chk-rm');
        if (new_shortage <= 0) {
            $rowChk.prop('checked', false).prop('disabled', true);
        } else {
            $rowChk.prop('disabled', false);
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

    // RMs — split into one row PER source Sales Order rather than one
    // consolidated row with a free-text description. A raw material's
    // shortage is inherently many-orders-to-one-item, but the Item Stock &
    // Action Plan's own RM tracking (custom_script.get_item_stock_details_bulk)
    // finds pending MRs by filtering Material Request Item.sales_order —
    // a description mentioning the orders isn't queryable, so an MR built the
    // old way was invisible on every one of those orders' own dashboards.
    // Each order's own qty share (linked_orders[].qty, from
    // fetch_multi_order_requirements) is used to split the — possibly
    // user-edited — total proportionally.
    d.$wrapper.find('.chk-rm:checked').each(function() {
        let i = $(this).data('idx'); let rm = data.raw[i];
        let $tr = $(this).closest('tr');
        let q = parseFloat($tr.find('.qty-rm').val()) || 0;
        if (q <= 0) return;

        // Only the orders the user left ticked in "Linked Orders & Customer"
        // — one unticked there means "don't raise this order's share at all",
        // not just "don't show it".
        let included = new Set();
        $tr.find('.chk-rm-order:checked').each(function() { included.add($(this).data('so')); });
        let orders = (rm.linked_orders || []).filter(o => included.has(o.name));
        let total_need = orders.reduce((s, o) => s + (o.qty || 0), 0);

        if (!orders.length || total_need <= 0) {
            // No traceable per-order share — fall back to one untracked row
            // rather than silently dropping the requirement.
            to_be_added.push({ item_code: rm.item_code, qty: q, warehouse: rm.warehouse, uom: rm.uom,
                description: `Consolidated BOM Items: ${orders.map(o => o.name).join(', ')}` });
            return;
        }

        orders.forEach(o => {
            let share_qty = q * ((o.qty || 0) / total_need);
            if (share_qty <= 0) return;
            to_be_added.push({
                item_code: rm.item_code, qty: share_qty, warehouse: rm.warehouse, uom: rm.uom,
                sales_order: o.name,
                description: `Raw material for ${o.name} (BOM component)`
            });
        });
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
