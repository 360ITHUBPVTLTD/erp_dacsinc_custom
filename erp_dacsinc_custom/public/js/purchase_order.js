



// --- Place this code in your Purchase Order client script file (e.g., purchase_order.js) ---

// --- Global CSS Definition (New Clean & Mild Style) ---
const CLEAN_MODAL_STYLE = `
    <style>
        .dialog-modal .so-item-table th, 
        .dialog-modal .summary-table th {
            background-color: #f7f9fb; /* Mild Off-White/Blue Header */
            color: black; /* Dark Gray Text */
            font-size: 13px !important;
            padding: 8px 10px;
            border: 1px solid #dee2e6 !important;
            text-transform: capitalize;
            font-weight: 600;
        }
        /* SWAPPED alternating rows: White for odd, very light grey for even */
        .dialog-modal .summary-table tbody tr:nth-child(odd) { 
             background-color: #ffffff; /* White background */
        }
        .dialog-modal .summary-table tbody tr:nth-child(even) { 
             background-color: #f8f9fb; /* Very light alternating background */
        }
        .dialog-modal .summary-table tbody td {
             vertical-align: top !important; /* Changed from middle to top for content flow */
             border-left: 1px solid #dce4ee;
             border-right: 1px solid #dce4ee;
        }
        .dialog-modal .summary-table tbody tr:last-child td {
            border-bottom: 1px solid #dce4ee; 
        }
        .dialog-modal .rm-detail-container { /* Style for collapsible RM section */
            background-color: #f8fcfd !important; /* Mild light-blue background */
            border: 1px solid #e0e6eb; 
        }
        .dialog-modal .so-item-table td {
            padding: 10px;
            border-top: 1px solid #dee2e6;
            background-color: white;
        }
        /* Custom Colors: Adjusted to be more business-mild */
        .dialog-modal .text-success { color: #28a745 !important; } /* Standard Green */
        .dialog-modal .text-danger { color: #dc3545 !important; } /* Standard Red */
        .dialog-modal .text-primary { color: #007bff !important; } /* Standard Blue */
        .dialog-modal .font-highlight { font-weight: 500 !important; }
        .procurement-qty-total { font-weight: 500; font-size: 14px;}
        
        /* Table highlight on hover/check - Mild blue */
        .dialog-modal .table-hover tbody tr:hover { background-color: #eff3f7 !important; }
        .dialog-modal .table-warning { background-color: #f2f7ff !important; } /* Very light blue for "disabled/partially reserved" */

        .dialog-modal .collapse.show button .fa-chevron-down { transform: rotate(-180deg); }
        
        .dialog-modal .qty-to-purchase {
             border-color: black;
             padding: 4px 8px; /* Slightly smaller input */
        }

        /* show_sales_order_dialog specific styles retained */
         .so-status-list li { line-height: 1.4; } 

        /* show_sales_order_selection_for_raw_materials specific styles retained */
        .rm-preview-col { max-height: 120px; overflow-y: auto; }
        .rm-preview { 
            display: block; 
            margin-bottom: 3px; 
            font-size: 12px;
            line-height: 1.4;
        }
        .rm-req { 
            font-weight: 500; 
            color: #c0392b; 
            background-color: #f8e1e1; /* Light red background */
            padding: 1px 3px; 
            border-radius: 4px;
            display: inline-block;
            margin-right: 5px; 
        }
        .rm-avail-wrap { /* General style for the avail span */
             background-color: #ebf6ec; /* Very light green background */
             padding: 1px 4px; 
             border-radius: 4px; 
             display: inline-block;
             font-weight: 600;
             color: #158c3a; /* Strong green for "Avail: " text */
        }
        .rm-avail-wrap .rm-avail { /* The actual available number value */
            color: #158c3a; /* Strong green for the number */
            font-weight: 500 !important;
        }
        .rm-low { 
            /* Highlighting warning area in red theme */
            background-color: #ffebeb !important; /* Very Soft Red/Pink Background */
            border: 1px solid #dc3545; /* Danger Red Border */
            font-weight: 600 !important;
            color: #dc3545 !important; /* Danger Red for "Avail: " text */
        }
        .rm-low .rm-avail {
            color: #dc3545 !important; /* Force the danger red color for the amount */
            font-weight: 500 !important;
        }
    </style>
`;
// --- End Global CSS ---

// ----------------------------------------------------------------------------------
// --- GLOBAL HELPER FUNCTIONS ---
// ----------------------------------------------------------------------------------

/**
 * Renders the Raw Material list with simple details and collapsible wrapper.
 */
const render_rm_list_for_dialog_enhanced = (materials, rm_id_suffix) => {
     const get_link = (doctype, name) => frappe.utils.get_form_link(doctype, name, true);
     if (!materials || materials.length === 0) return `<div class="p-1"><span class="text-muted small">.</span></div>`;
    
     const table_rows = materials.map(rm => {
         const has_enough_stock = rm.available_qty >= rm.required_qty; 
         const availability_color = has_enough_stock ? 'text-success' : 'text-danger';
         const status_icon = has_enough_stock ? 'fa-check-square-o' : 'fa-times-circle-o';
         return `
             <tr>
                 <td style="border:none;">${get_link("Item", rm.item_code)} <small class="text-muted d-block">${rm.item_name}</small></td>
                 <td class="text-right" style="width: 20%;">${rm.required_qty.toFixed(2)} ${rm.stock_uom}</td>
                 <td class="text-right font-weight-bold ${availability_color}" style="width: 20%;" title="Total Stock: ${rm.actual_qty || 0}">${rm.available_qty.toFixed(2)} ${rm.stock_uom}</td>
             </tr>
         `;
     }).join('');
     const container_id = `rm-details-${rm_id_suffix}`;
    
     return `
         <div class="rm-detail-container mt-2" style="border-radius: 4px;">
             <button class="btn btn-default btn-xs" type="button" data-toggle="collapse" data-target="#${container_id}"
                     style="width: 100%; text-align: left; padding: 5px 10px; background-color: #e8eff6; border-bottom: 1px solid #c8d3dd; font-weight: 500;">
                 <i class="fa fa-chevron-down toggle-icon" style="transition: transform 0.2s;"></i>
                 <strong class="text-muted" style="font-size: 14px;">View Raw Material Requirements</strong>
             </button>
             <div class="collapse" id="${container_id}">
                 <div style="padding: 10px;">
                     <table class="table table-sm" style="font-size: 14px; margin-bottom: 0; background-color: #fff;">
                         <thead style="background-color: #f0f4f7;">
                             <tr>
                                 <th style="font-weight: 600; color: black;">Raw Material</th>
                                 <th class="text-right" style="font-weight: 600; color: black;">Required</th>
                                 <th class="text-right" style="font-weight: 600; color: black;">Available</th>
                             </tr>
                         </thead>
                         <tbody>${table_rows}</tbody>
                     </table>
                 </div>
             </div>
         </div>
     `;
};

const update_summary_procurement = ($wrapper) => {
    let item_procurement_map = {};

    $wrapper.find(".so-item:checked").each(function () {
        let $checkbox = $(this);
        let fg_item_code = $checkbox.data("item-code");
        let pending_qty = parseFloat($checkbox.data("pending-qty") || 0); 
        if (pending_qty > 0.001) {
            item_procurement_map[fg_item_code] = (item_procurement_map[fg_item_code] || 0) + pending_qty;
        }
    });

    $wrapper.find(".summary-table tbody tr[data-fg-code]").each(function () {
        let $row = $(this);
        let fg_item_code = $row.data("fg-code");
        let new_procurement_qty = item_procurement_map[fg_item_code] || 0;

        let $qty_strong = $row.find(".procurement-qty-total");
        
        $qty_strong.text(new_procurement_qty.toFixed(2));

        $qty_strong.removeClass('text-danger font-highlight text-muted');
        if (new_procurement_qty > 0.001) {
            $qty_strong.addClass('text-danger font-highlight');
        } else {
            $qty_strong.addClass('text-muted');
        }
    });
}

const update_rm_details = ($row, new_purchase_qty) => {
    // This function can be expanded to dynamically update Raw Material requirements in the UI
    // if a user changes the purchase quantity for a finished good.
};


const render_rm_list = (materials) => {
    if (!materials || materials.length === 0) {
        return '';
    }
    const get_link = (doctype, name) => frappe.utils.get_form_link(doctype, name, true);
    const table_rows = materials.map(rm => {
        const has_enough_stock = rm.available_qty >= rm.required_qty;
        const availability_color = has_enough_stock ? 'text-success' : 'text-danger';
        const status_icon = has_enough_stock ? 'fa-check' : 'fa-times';
        const tooltip = `Total Stock: ${rm.actual_qty} | Reserved for Others: ${rm.reserved_qty}`;

        return `
            <tr>
                <td>${get_link("Item", rm.item_code)}<br><small class="text-muted">${rm.item_name}</small></td>
                <td class="text-right">${rm.required_qty} ${rm.stock_uom}</td>
                <td class="text-right font-weight-bold ${availability_color}" title="${tooltip}">
                    ${rm.available_qty} ${rm.stock_uom}
                </td>
                <td class="text-center">
                    <i class="fa ${status_icon} ${availability_color}"></i>
                </td>
            </tr>
        `;
    }).join('');

    const table_html = `
        <table class="table table-sm table-bordered" style="font-size: 12px; margin-bottom: 5px;">
            <thead class="thead-light">
                <tr>
                    <th>Raw Material</th>
                    <th class="text-right">Required</th>
                    <th class="text-right">Available</th>
                    <th class="text-center">Status</th>
                </tr>
            </thead>
            <tbody>
                ${table_rows}
            </tbody>
        </table>
    `;
    return table_html;
}

// ----------------------------------------------------------------------------------
// --- CLIENT SCRIPT HOOKS (Controller) ---
// ----------------------------------------------------------------------------------

frappe.ui.form.on('Purchase Order', {
    is_subcontracted(frm) {
        frm.trigger('refresh');
    },
    refresh(frm) {
        const wrapper = frm.fields_dict.custom_purchase_order_html.$wrapper;
		wrapper.empty();
        frm.remove_custom_button(__('Create Subcontracting Docs'));
        frm.remove_custom_button(__('Receive Finished Goods'));
        frm.clear_custom_buttons();
        
        let linked_subcontracting_docs = null

        if (frm.doc.docstatus === 1 && frm.doc.is_subcontracted) {
            frappe.call({
                method: "erp_dacsinc_custom.purchase_order.get_linked_subcontracting_docs",
                args: { purchase_order_name: frm.doc.name },
                callback: function(r) {
                    if (r.message) {
                        render_linked_docs_html(frm, r.message);
                        linked_subcontracting_docs = r.message
                    }
                }
            });
        }
        
        if (frm.doc.docstatus === 1 && frm.doc.is_subcontracted) {
            frappe.call({
                method: "erp_dacsinc_custom.purchase_order.get_sco_status_for_po",
                args: { purchase_order_name: frm.doc.name },
                callback: function(r) {
                    if (!r.message) return;
                    
                    if (r.message.sco_exists) {
                        if (r.message.items_pending) {
                            frm.add_custom_button(__('Receive Finished Goods'), function() {
                                show_receive_items_dialog(frm, r.message.sco_name,linked_subcontracting_docs);
                            });
                        }
                    } else {
                        frm.add_custom_button(__('Create Subcontracting Docs'), function() {
                            frappe.call({
                                method: "erp_dacsinc_custom.purchase_order.get_required_raw_materials_for_po",
                                args: { purchase_order_name: frm.doc.name },
                                freeze: true,
                                freeze_message: __("Checking stock for required raw materials..."),
                                callback: function(stock_check_r) {
                                    if (stock_check_r.message && stock_check_r.message.length > 0) {
                                        show_stock_check_dialog(frm, stock_check_r.message,linked_subcontracting_docs);
                                    } else {
                                        frappe.msgprint(__("Could not find any raw materials for this Purchase Order. Ensure the Finished Goods have a default BOM."));
                                    }
                                }
                            });
                        });
                    }
                }
            });
        }
   
        if (frm.is_new()) {
            frm.add_custom_button(__('Fetch Pending Sales Orders'), () => {
                const is_subcontracted = frm.doc.is_subcontracted || 0;
                frappe.call({
                    method: "erp_dacsinc_custom.purchase_order.get_pending_so_with_material_stock",
                    args: { is_subcontracted },
                    freeze: true,
                    freeze_message: __("Fetching pending Sales Orders & Material Stock..."),
                    callback: (r) => {
                        if (r.message?.sales_orders?.length) {
                            show_sales_order_dialog(frm, r.message, is_subcontracted);
                        } else {
                            frappe.msgprint(__("No pending Sales Orders found."));
                        }
                    }
                });
            });

            if (!frm.doc.is_subcontracted) {
                frm.add_custom_button(__('Fetch Raw Materials from SO'), () => {
                    frappe.call({
                        method: "erp_dacsinc_custom.purchase_order.get_pending_so_with_raw_materials_summary", 
                        freeze: true,
                        freeze_message: __("Fetching Sales Orders and Raw Material Stock..."),
                        callback: (r) => {
                            if (r.message?.sales_orders?.length) {
                                show_so_selection_and_rm_purchase_dialog(frm, r.message.sales_orders);
                            } else {
                                frappe.msgprint(__("No pending Sales Orders with required raw materials found."));
                            }
                        }
                    });                
                });
            }
        }
    }
});


// ----------------------------------------------------------------------------------
// --- DIALOG FUNCTIONS ---
// ----------------------------------------------------------------------------------

/**
 * [DEFINITIVE VERSION]
 * Displays a dialog to select pending sales order items to add to a purchase order.
 * - Input value defaults to the GROSS procure need for user clarity.
 * - Input is CAPPED at the NET procure need to prevent over-ordering.
 * - Line items are DISABLED if there is zero NET quantity to procure.
 */
// --- REPLACE THE existing show_sales_order_dialog FUNCTION with this enhanced version ---

// --- Purchase Order Client Script ---

function show_sales_order_dialog(frm, data, is_subcontracted) {
    
    const { item_summary, sales_orders } = data;
    const get_link = (doctype, name) => name ? frappe.utils.get_form_link(doctype, name, true) : "";
    const show_rm_info = !!is_subcontracted; 

    let dialog_html = CLEAN_MODAL_STYLE; 
   
    // --- Summary Table ---
    if (item_summary && item_summary.length > 0) {
        
        const rm_list_helper = render_rm_list_for_dialog_enhanced;
        
        let summary_rows_html = item_summary.map((item, idx) => {
            const item_rm_html = show_rm_info ? rm_list_helper(item.raw_materials, `summary-${idx}`) : ''; 
           
            const fg_available_stock = (item.fg_available_qty || 0);
            const display_available_stock = Math.max(0, fg_available_stock).toFixed(0);
            const initial_purchase_needed = (item.total_pending_qty || 0);
            const initial_pending_qty = parseFloat(initial_purchase_needed.toFixed(0)); 
            const initial_pending_color = initial_pending_qty > 0 ? 'text-danger font-highlight' : 'text-muted';
            const available_stock_color = fg_available_stock < 0 ? 'text-danger font-highlight' : 'text-success';

            return `<tr data-fg-code="${item.item_code}">
                        <td class="align-middle" style="vertical-align: top; width: 25%;">
                            <div>${get_link("Item", item.item_code)}</div>
                            <div><small class="text-muted">${item.item_name}</small></div>
                        </td>
                        <td class="text-right align-middle ${available_stock_color}">
                            ${display_available_stock}
                        </td>
                        <td class="text-right align-middle">${(item.fg_picked_submitted || 0)}</td>
                        <td class="text-right align-middle">${(item.fg_picked_draft || 0)}</td>
                        <td class="text-right align-middle"><strong class="procurement-qty-total ${initial_pending_color}">${initial_pending_qty}</strong></td>
                        <td class="text-center align-middle">${item.order_count}</td>
                    </tr>
                    ${show_rm_info ? 
                        `<tr class="summary-rm-row" data-is-summary-row="1">
                            <td colspan="6" style="padding: 0px 0px 10px 0px; border-top: none;">
                                <div style="margin: 0;">${item_rm_html}</div>
                            </td>
                        </tr>` 
                        : ''
                    }
            `;
        }).join('');
       
        dialog_html += `
            <div class="mb-4">
                <div style="font-weight: 600; margin-bottom: 10px; color: black;">Summary of Pending Items (For Reference)</div>
                <table class="table table-bordered table-sm summary-table" style="font-size: 15px;">
                    <thead class="thead-dark"><tr>
                        <th style="width: 25%;">Finished Good</th>
                        <th class="text-right" style="width: 12%;">Available Stock</th>
                        <th class="text-right" style="width: 12%;">Pick List Submitted</th>
                        <th class="text-right" style="width: 12%;">Pick List Draft</th>
                        <th class="text-right" style="width: 12%;">Need to Procure</th>
                        <th class="text-center" style="width: 8%;">No. of SO Lines</th>
                    </tr></thead><tbody>${summary_rows_html}</tbody>
                </table>
            </div><hr style="border-top: 1px solid #d1d8dd; margin-top:0;">
            <div style="font-weight: 600; margin-top: 20px; margin-bottom: 10px; color: black;">Select Individual Sales Order Items to Purchase</div>
        `;
    }

    // --- ADDED SEARCH BAR HTML HERE ---
    let search_bar_html = `
        <div class="form-group" style="margin-bottom: 15px;">
            <input type="text" id="so-dialog-search-input" class="form-control" 
                placeholder="🔍 Search by Sales Order, Item Code, or Customer..." 
                style="background-color: #f8f9fa; border: 1px solid #d1d8dd;">
        </div>
    `;
    dialog_html += search_bar_html;

    // --- Selectable SO Items Table Headers ---
    let table_headers = `
        <th style="width: 3%;"><input type="checkbox" id="select-all-so" style="transform: scale(1.3);"></th>
        <th style="width: 35%;">Sales Order / Item</th>
        <th style="width: 35%;">Finished Good Status (Pick List Based)</th>
        <th class="text-right" style="width: 27%;">Qty to Purchase</th>
    `;

    // --- Selectable SO Items Table ---
    let table_html = `
        <div style="max-height: 50vh; overflow-y: auto;" class="p-1">
        <table class="table table-bordered table-sm so-item-table" style="font-size:15px; width: 100%;">
            <thead style="position: sticky; top: -1px; z-index: 2;"><tr>
                ${table_headers}
            </tr></thead><tbody>
    `;
   
    sales_orders.forEach((so, idx) => {
        let so_line_qty = (so.qty || 0);
        let delivered_qty = (so.delivered_qty || 0);
        let current_available_stock = (so.fg_available_qty || 0);
        let reserved_for_this_so_item = (so.fg_reserved_for_so_qty || 0); 
        let available_for_new_pick_raw = current_available_stock - reserved_for_this_so_item;
        let available_for_new_pick = Math.max(0, available_for_new_pick_raw); 
        let pending_purchase = Math.max(0, so.pending_qty); 
        pending_purchase = parseFloat(pending_purchase.toFixed(0)); 
        available_for_new_pick = parseFloat(available_for_new_pick.toFixed(0));
        let incoming_po = (so.incoming_po_qty || 0);
        let po_names = (so.incoming_po_names || "");
        let received_po = (so.received_po_qty || 0);
        const display_available_stock = Math.max(0, current_available_stock).toFixed(0);
        const available_stock_color = current_available_stock < 0 ? 'text-danger' : 'text-success';
        const new_pick_color = available_for_new_pick_raw > 0 ? '#28a745' : '#6c757d';
        // let po_display_html = po_names 
        //     ? `<div style="font-size:10px; color:#6f42c1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;">
        //         <span class="text-muted">Ref:</span> ${po_names}
        //       </div>` 
        //     : '';
        let po_display_html = '';

if (po_names) {
    // 1. Convert comma-separated string into individual clickable links
    let po_links = po_names.split(',').map(name => {
        let id = name.trim();
        return `<a href="/app/purchase-order/${id}" target="_blank" style="color: #6f42c1; font-weight: 600;">${id}</a>`;
    }).join(', ');

    // 2. Render container without 'overflow: hidden' or 'text-overflow: ellipsis'
    po_display_html = `
        <div style="font-size:10px; line-height: 1.4; word-wrap: break-word;">
            <span class="text-muted">Ref:</span> ${po_links}
        </div>`;
}
        let fg_status_html = `<ul class="list-unstyled mb-0 so-status-list" style="line-height: 1.2; font-size: 12px; margin: -5px 0;">
            <li><span class="text-muted small">Available Stock:</span> <strong class="${available_stock_color}">${display_available_stock}</strong> 
                <span class="text-muted small">/ Total:</span> <strong class="text-info">${so.fg_total_stock || 0}</strong></li>
            <hr class="my-1 border-light">
        
        <!-- NEW SECTION: Shows Incoming PO and Received Info -->
        <li>
                <span class="text-muted small">Incoming PO:</span> <strong style="color: #6f42c1;">${incoming_po}</strong>
                <span class="text-muted small" style="font-size: 13px;">(Recv: ${received_po})</span>
                ${po_display_html} 
            </li>
        
            <li><span class="text-muted small">Picked (Submitted):</span> ${so.fg_picked_submitted || 0}
                <span class="text-muted small">/ Pending:</span> ${so.fg_picked_draft || 0}</li>
            <li class="font-highlight text-primary"><span class="text-primary small">Committed to Pick:</span> <strong>${so.fg_reserved_for_so_qty || 0}</strong></li>
            <hr class="my-1 border-light">
            <li><span class="text-muted small">Required:</span> ${so_line_qty} 
                <span class="text-muted small">/ Delivered:</span> <strong class="text-success">${delivered_qty}</strong></li>
            <li class="font-weight-bold"><span class="text-primary small">Available for New Pick:</span> <strong style="color: ${new_pick_color}">${available_for_new_pick}</strong></li>
            <li class="font-weight-bold"><span class="text-muted small">Max Procure Needed:</span> <strong class="text-danger">${pending_purchase}</strong></li>
        </ul>`;
       
        let rm_html = show_rm_info ? render_rm_list_for_dialog_enhanced(so.raw_materials, `so-${idx}`) : '';
       
        const row_class = pending_purchase > 0 ? '' : (available_for_new_pick > 0 ? 'table-warning' : 'table-secondary text-muted');
        
        // Pass extra data for easier searching (optional, but text-based search works too)
        let selectable_tds = `
            <td class="text-center align-middle"><input type="checkbox" class="so-item" style="transform: scale(1.3);"
                data-sales-order="${so.sales_order}" data-item-code="${so.item_code}" 
                data-item-name="${so.item_name}" data-customer="${so.customer || ''}"
                data-qty="${so.qty}" data-max-pending-qty="${pending_purchase}" data-pending-qty="${pending_purchase}" data-bom="${so.bom || ''}"
                ${pending_purchase > 0 ? 'checked' : 'disabled'}
            ></td>
            <td class="align-top">
                <div class="search-target-so">${get_link("Sales Order", so.sales_order)}</div>
                <div class="font-highlight search-target-item">${so.item_name}</div>
                <div><small style="font-size: 12px;">${get_link("Customer", so.customer)} / ${get_link("Item", so.item_code)}</small></div>
            </td>
            <td class="align-top">${fg_status_html}</td>
            <td class="text-right align-middle">
                <input type="number" step="any" min="0" max="${pending_purchase}" 
                       value="${pending_purchase}" 
                       data-max-val="${pending_purchase}"
                       class="form-control qty-to-purchase text-right ${pending_purchase > 0 ? 'text-danger font-highlight' : 'text-muted'}" 
                       style="font-size: 14px; font-weight: 500;">
            </td>
            ${show_rm_info ? `<td class="align-top">${rm_html}</td>` : ''}
        `;

        table_html += `<tr class="${row_class}" data-so-row="1" data-fg-code="${so.item_code}">${selectable_tds}</tr>`;
    });

    table_html += "</tbody></table></div>";
    dialog_html += table_html;
    
    let dialog = new frappe.ui.Dialog({
        title: __("Pending Sales Orders & Material Availability"),
        size: "extra-large",
        fields: [{ fieldname: "sales_order_html", fieldtype: "HTML", options: dialog_html }],
        primary_action_label: __("Add to Purchase Order"),
        // primary_action: function () {
        //     // (Same primary action logic as provided...)
        //     const selected = dialog.$wrapper.find(".so-item:checked").map(function () {
        //         let $checkbox = $(this);
        //         let $input = $checkbox.closest('tr').find('.qty-to-purchase');
        //         let input_qty = parseFloat($input.val()) || 0;

        //         if (input_qty > 0) {
        //             return {
        //                 salesOrder: $checkbox.data('sales-order'), 
        //                 itemCode: $checkbox.data('item-code'), 
        //                 itemName: $checkbox.data('item-name'),
        //                 qty: $checkbox.data('qty'), 
        //                 pendingQty: input_qty, 
        //                 bom: $checkbox.data('bom')
        //             };
        //         }
        //     }).get().filter(Boolean); 
            
        //     if (selected.length === 0) {
        //         frappe.msgprint(__("Please select at least one item and ensure the quantity is greater than zero."));
        //         return;
        //     }
            
        //     frappe.call({
        //         method: "erp_dacsinc_custom.purchase_order.validate_and_get_items_for_po",
        //         args: {
        //             selected_items: JSON.stringify(selected),
        //             is_subcontracted: is_subcontracted
        //         },
        //         freeze: true,
        //         freeze_message: __("Validating and adding items..."),
        //         callback: function(r) {
        //           if (r.message) {
        //                 const { valid_items, rejected_items } = r.message;
        //                 if (valid_items && valid_items.length > 0) {
        //                     frm.clear_table("items");
        //                     valid_items.forEach((item_data) => {
        //                         const so_item_code_to_match = item_data.fg_item || item_data.item_code;
        //                         const original_selected_data = selected.find(s => 
        //                              s.salesOrder === item_data.sales_order && 
        //                              s.itemCode === so_item_code_to_match
        //                          );
        //                         let clientInputQty = Number(original_selected_data?.pendingQty); 
        //                         if (isNaN(clientInputQty) || clientInputQty <= 0) {
        //                              clientInputQty = Number(item_data.qty || 0); 
        //                         }
        //                         item_data.qty = clientInputQty; 
        //                         const conversion_factor = Number(item_data.conversion_factor) || 1;
        //                         item_data.stock_qty = clientInputQty * conversion_factor; 

        //                         if (is_subcontracted) {
        //                             item_data.fg_item_qty = clientInputQty;
        //                         }
        //                         item_data.schedule_date = frm.doc.transaction_date || frappe.datetime.nowdate();
        //                         let new_item_row = frm.add_child("items");
        //                         frappe.model.set_value(new_item_row.doctype, new_item_row.name, item_data);
                                
        //                         if (new_item_row.qty != clientInputQty) {
        //                              frappe.model.set_value(new_item_row.doctype, new_item_row.name, 'qty', clientInputQty);
        //                              frappe.model.set_value(new_item_row.doctype, new_item_row.name, 'stock_qty', item_data.stock_qty);
        //                         }
        //                     });
        //                     frm.refresh_field("items");
        //                 }
        //             }
        //         }
        //     });
        //     dialog.hide();
        // }       
        
        primary_action: function () {
            // 1. Capture User Selections
            const selected = dialog.$wrapper.find(".so-item:checked").map(function () {
                let $checkbox = $(this);
                let $input = $checkbox.closest('tr').find('.qty-to-purchase');
                let input_qty = parseFloat($input.val()) || 0;

                if (input_qty > 0) {
                    return {
                        salesOrder: $checkbox.data('sales-order'), 
                        itemCode: $checkbox.data('item-code'), 
                        itemName: $checkbox.data('item-name'),
                        qty: $checkbox.data('qty'), 
                        pendingQty: input_qty, 
                        bom: $checkbox.data('bom')
                    };
                }
            }).get().filter(Boolean); 
            
            if (selected.length === 0) {
                frappe.msgprint(__("Please select at least one item and ensure the quantity is greater than zero."));
                return;
            }
            
            // 2. Send to backend for pricing/details fetch
            frappe.call({
                method: "erp_dacsinc_custom.purchase_order.validate_and_get_items_for_po",
                args: {
                    selected_items: JSON.stringify(selected),
                    is_subcontracted: is_subcontracted
                },
                freeze: true,
                freeze_message: __("Validating and adding items..."),
                callback: function(r) {
                   if (r.message) {
                        const { valid_items } = r.message;
                        if (valid_items && valid_items.length > 0) {
                            
                            // Clear existing lines to prevent duplicates if preferred, 
                            // OR remove this line if you want to append to existing lines.
                            frm.clear_table("items");

                            // 3. CHANGED LOGIC: Iterate the USER SELECTIONS, not the backend result.
                            // This ensures every check box tick becomes a specific PO row with an SO Link.
                            selected.forEach((ui_item) => {
                                
                                // Find matching enriched details from backend (Price, Description, UOM, etc)
                                const master_data = valid_items.find(api_item => {
                                    // Match Item Code (Standard) OR FG Item Code (Subcontracting)
                                    return api_item.item_code === ui_item.itemCode || 
                                           api_item.fg_item === ui_item.itemCode;
                                });

                                if (master_data) {
                                    // Clone API data to a new object
                                    let new_row_data = { ...master_data };

                                    // --- CRITICAL LINKS ---
                                    // Force link to the specific Sales Order from the dialog selection
                                    new_row_data.sales_order = ui_item.salesOrder;
                                    
                                    // Set Quantities
                                    new_row_data.qty = ui_item.pendingQty;
                                    
                                    const conversion_factor = Number(new_row_data.conversion_factor) || 1;
                                    new_row_data.stock_qty = ui_item.pendingQty * conversion_factor; 

                                    // Subcontracting Specifics
                                    if (is_subcontracted) {
                                        // The 'qty' field is usually the Service Item Qty
                                        // 'fg_item_qty' tracks the Finished Good qty required
                                        new_row_data.fg_item_qty = ui_item.pendingQty;
                                    }

                                    // Dates
                                    new_row_data.schedule_date = frm.doc.transaction_date || frappe.datetime.nowdate();
                                    
                                    // Add the Row
                                    let new_item_row = frm.add_child("items");
                                    frappe.model.set_value(new_item_row.doctype, new_item_row.name, new_row_data);
                                }
                            });
                            
                            frm.refresh_field("items");
                        }
                    }
                }
            });
            dialog.hide();
        }
    });
   
    dialog.$wrapper.addClass('dialog-modal');
    dialog.show();
    dialog.$wrapper.find('.modal-dialog').css("max-width", "1300px");
   
    if (show_rm_info) {
        dialog.$wrapper.find('.collapse').on('show.bs.collapse', function () {
            $(this).prev('button').find('.fa-chevron-down').css('transform', 'rotate(-180deg)');
        });
        dialog.$wrapper.find('.collapse').on('hide.bs.collapse', function () {
            $(this).prev('button').find('.fa-chevron-down').css('transform', 'rotate(0deg)');
        });
    }

    const all_items = dialog.$wrapper.find(".so-item:not(:disabled)");
    const select_all = dialog.$wrapper.find("#select-all-so");
    const qty_inputs = dialog.$wrapper.find(".qty-to-purchase");

    const run_all_updates = () => {
         let item_procurement_map = {};
         dialog.$wrapper.find("tr[data-so-row] .so-item").each(function () {
             let $checkbox = $(this);
             let $input = $checkbox.closest('tr').find('.qty-to-purchase');
             let input_qty = parseFloat($input.val() || 0);

             if ($checkbox.is(':checked') && input_qty > 0) {
                 let fg_item_code = $checkbox.data("item-code");
                 if(show_rm_info) update_rm_details($checkbox.closest('tr'), input_qty);
                 
                 $checkbox.data('pending-qty', input_qty);
                 item_procurement_map[fg_item_code] = (item_procurement_map[fg_item_code] || 0) + input_qty;
             } else {
                 if(show_rm_info) update_rm_details($checkbox.closest('tr'), 0);
                 $checkbox.data('pending-qty', 0);
             }
         });
         dialog.$wrapper.find(".summary-table tbody tr[data-fg-code]").each(function () {
             let $fg_row = $(this);
             let fg_item_code = $fg_row.data("fg-code");
             let new_procurement_qty = item_procurement_map[fg_item_code] || 0;
             let $qty_strong = $fg_row.find(".procurement-qty-total");

             $qty_strong.text(new_procurement_qty.toFixed(0));
             $qty_strong.removeClass('text-danger font-highlight text-muted');
             if (new_procurement_qty > 0) {
                 $qty_strong.addClass('text-danger font-highlight');
             } else {
                 $qty_strong.addClass('text-muted');
             }
         });
    }

    run_all_updates(); 
    
    // --- ADDED SEARCH FUNCTIONALITY LISTENER ---
    dialog.$wrapper.find('#so-dialog-search-input').on('keyup input', function() {
        const search_term = $(this).val().toLowerCase().trim();
        
        dialog.$wrapper.find('.so-item-table tbody tr[data-so-row]').each(function() {
            const $row = $(this);
            // Search inside the checkbox data (Customer/Code) and the Text content of the row
            const item_code = ($row.find('.so-item').data('item-code') || '').toLowerCase();
            const customer = ($row.find('.so-item').data('customer') || '').toLowerCase();
            const row_text = $row.text().toLowerCase(); // Captures SO ID, Item Name, etc. visible in text
            
            if (row_text.includes(search_term) || item_code.includes(search_term) || customer.includes(search_term)) {
                $row.show();
            } else {
                $row.hide();
            }
        });
    });
    // ----------------------------------------

    select_all.on("change", () => {
        const is_checked = select_all.prop("checked");
        // FIX: Ensure we only toggle Visible items if a search is active? 
        // Or keep behavior simple (Select All matches filtered or not).
        // Standard Behavior here: Select visible rows
        const $targets = dialog.$wrapper.find(".so-item:not(:disabled)").filter(":visible");
        
        $targets.each(function() {
            let $checkbox = $(this);
            let $input = $checkbox.closest('tr').find('.qty-to-purchase');
            if (!$checkbox.is(':disabled')) {
                const new_val = is_checked ? $input.data('max-val') : 0;
                $checkbox.prop("checked", is_checked);
                $input.val(new_val).trigger('input'); 
            }
        });
    });
   
    all_items.on("change", function() {
        const $checkbox = $(this);
        const $input = $checkbox.closest('tr').find('.qty-to-purchase');
        const is_checked = $checkbox.prop("checked");
        const new_val = is_checked ? $input.data('max-val') : 0;
        $input.val(new_val).trigger('input'); 
        
        const checked_count = dialog.$wrapper.find(".so-item:checked:not(:disabled)").length;
        // Logic might need check vs Visible length, but keep it simple
        const visible_items = dialog.$wrapper.find(".so-item:not(:disabled):visible");
        const visible_checked = dialog.$wrapper.find(".so-item:checked:not(:disabled):visible");
        select_all.prop("checked", visible_items.length > 0 && visible_checked.length === visible_items.length);
    });

    qty_inputs.on('input', function() {
        let $input = $(this);
        let max_val = parseFloat($input.data('max-val'));
        let new_val = parseFloat($input.val()) || 0;
        
        if (new_val > max_val) {
            new_val = max_val;
            $input.val(max_val);
        } else if (new_val < 0) {
             new_val = 0;
            $input.val(0);
        }
        
        let $checkbox = $input.closest('tr').find('.so-item');
        if (!$checkbox.is(':disabled')) {
             $checkbox.prop('checked', new_val > 0);
        }
        
        $input.toggleClass('text-muted', new_val === 0).toggleClass('text-danger font-highlight', new_val > 0);
        run_all_updates();
    }).trigger('input');
}
function show_so_selection_and_rm_purchase_dialog(frm, sales_orders) {
    const get_link = (doctype, name) => name ? frappe.utils.get_form_link(doctype, name, true) : "";
    
    // --- STYLES ---
    const STYLES = `
        <style>
            .rm-dialog-table { font-size: 15px; width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid #d1d8dd; border-radius: 6px; overflow: hidden; }
            .rm-dialog-table thead th { background-color: #f8f9fa; color: black; font-weight: 600; text-transform: capitalize; font-size: 14px; padding: 12px 10px; border-bottom: 1px solid #d1d8dd; letter-spacing: 0.5px; }
            .rm-dialog-table tbody td { padding: 10px; border-bottom: 1px solid #eee; vertical-align: middle; color: #36414c; }
            .rm-dialog-table tr:last-child td { border-bottom: none; }
            .rm-dialog-table tr:hover { background-color: #fcfcfc; }
            
            .text-highlight { color: #171717; font-weight: 600; }
            .status-tag { padding: 3px 6px; border-radius: 4px; font-size: 13px; font-weight: 600; text-transform: capitalize; letter-spacing: 0.3px; }
            .st-green { background: #e6f6ec; color: #00994d; }
            .st-red { background: #ffebeb; color: #d62222; }
            
            .qty-input { border: 1px solid #dfe2e5; background: #fff; font-weight: bold; border-radius: 4px; padding: 4px 8px; font-size: 15px; height: 30px; transition: all 0.2s; }
            .qty-input:focus { border-color: #5e64ff; box-shadow: 0 0 0 3px rgba(94,100,255,0.1); }
            
            .rm-preview-line { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; font-size: 14px; border-bottom: 1px dashed #eee; padding-bottom: 2px; }
            .rm-preview-line:last-child { border-bottom: none; }
            .rm-prev-stat { font-family: monospace; }
        </style>
    `;

    // --- STEP 1: GENERATE TABLE ROWS ---
    let fg_rows = sales_orders.map((so, idx) => {
        let awaiting_pick = parseFloat(so.qty_awaiting_pick);
        
        // Minimal Status per RM for "Waiting Input" preview
        let rm_status_html = "";
        if (so.raw_materials && so.raw_materials.length) {
            let preview_lines = so.raw_materials.map(rm => {
                let required_for_1_unit = rm.bom_qty_per_unit || 0;
                return `<div class="rm-preview-line" data-base-qty="${required_for_1_unit}">
                    <span class="rm-prev-name" title="${rm.item_name}">${rm.item_code}</span>
                    <span class="rm-prev-stat status-text" style="color: #999;">Waiting...</span>
                </div>`;
            }).join('');
            rm_status_html = `<div style="max-height:80px; overflow-y:auto; padding-right:5px;">${preview_lines}</div>`;
        } else {
            rm_status_html = `<span class="text-muted" style="font-size:11px; font-style:italic;">No BOM Linked</span>`;
        }

        // Search Metadata attached to the row for filtering
        const search_str = `${so.sales_order} ${so.item_code} ${so.item_name || ''} ${so.customer || ''}`.toLowerCase();

        return `<tr class="rm-so-row" data-idx="${idx}" data-search="${search_str}">
            <td class="text-center">
                <input type="checkbox" class="so-check" style="transform: scale(1.2); cursor: pointer;" checked>
            </td>
            <td>
                <div class="text-highlight">${get_link("Sales Order", so.sales_order)}</div>
                <div style="font-size:12px; color:#666;">${get_link("Item", so.item_code)}</div>
                <div style="font-size:11px; color:#999;">${get_link("Customer", so.customer)}</div>
            </td>
            <td class="text-right text-muted">${flt(so.pending_qty)}</td>
            <td class="text-right text-muted">${flt(so.picked_submitted)} / ${flt(so.picked_draft)}</td>
            <td class="text-right text-highlight" style="font-size: 14px;">${flt(so.qty_awaiting_pick)} ${so.uom}</td>
            <td class="text-center">
                <input type="number" step="any" min="0" max="${so.qty_awaiting_pick}"
                       class="form-control qty-input text-center fg-fulfill-input"
                       data-max="${so.qty_awaiting_pick}" value="${flt(so.qty_awaiting_pick)}">
            </td>
            <td>${rm_status_html}</td>
        </tr>`;
    }).join('');

    // --- STEP 2: BUILD DIALOG BODY WITH SEARCH ---
    let dialog_body = `
        ${STYLES}
        <div style="padding: 10px;">
            <!-- SECTION 1 HEADER & SEARCH -->
            <div class="d-flex justify-content-between align-items-end mb-2">
                <h6 style="text-transform: capitalize; letter-spacing: 0.5px; font-size: 14px; color: black; margin-bottom: 0;">1. Select Sales Orders & Confirm Qty</h6>
                <div style="width: 300px;">
                    <input type="text" id="so-list-search" class="form-control form-control-sm" 
                           placeholder="🔍 Search SO, Item or Customer..." 
                           style="background-color: #f8f9fa; border: 1px solid #d1d8dd; border-radius: 4px;">
                </div>
            </div>

            <!-- SALES ORDER TABLE -->
            <div style="max-height: 250px; overflow-y: auto; border: 1px solid #d1d8dd; border-radius: 6px; margin-bottom: 25px;">
                <table class="rm-dialog-table" id="rm-so-table">
                    <thead style="position: sticky; top: 0; z-index: 5;"><tr>
                        <th width="4%" class="text-center"><input type="checkbox" id="so-check-all" checked></th>
                        <th width="28%">Order / Item</th>
                        <th width="10%" class="text-right">Org. Qty</th>
                        <th width="10%" class="text-right">Picked (S/D)</th>
                        <th width="12%" class="text-right">Remaining</th>
                        <th width="12%" class="text-center">Qty to Make</th>
                        <th width="24%">RM Availability Status</th>
                    </tr></thead>
                    <tbody>${fg_rows}</tbody>
                </table>
            </div>

            <!-- SECTION 2 HEADER -->
            <div class="d-flex justify-content-between align-items-center mb-2">
                <h6 style="text-transform: capitalize; letter-spacing: 0.5px; font-size: 14px; color: black; margin:0;">2. Raw Material Requirements (Consolidated)</h6>
                <div style="font-size: 14px; color: #666; font-style: italic;">Net Need = (Required - Stock - Pending POs)</div>
            </div>
            
            <!-- CALCULATED RESULTS AREA -->
            <div style="max-height: 250px; overflow-y: auto; border: 1px solid #d1d8dd; border-radius: 6px;">
                <div id="rm-calc-area">
                    <div class="text-center p-4 text-muted" style="font-size:12px;">Calculating...</div>
                </div>
            </div>
        </div>
    `;

    // --- FUNCTION: RECALCULATE GRID ---
    const recalc_materials = () => {
        let consolidated_rms = {};

        dialog.$wrapper.find('.fg-fulfill-input').each(function() {
            let $input = $(this);
            let $row = $input.closest('tr');
            
            // If row is hidden by search, usually we treat it as unchecked?
            // Standard UX: Filtered items are "Out of scope" if visual selection.
            // But if checking boxes logic is handled correctly, it's fine.
            // For safety, let's only calculate VISIBLE OR CHECKED items? 
            // Simple logic: If it's checked, count it.
            let is_checked = $row.find('.so-check').prop('checked');
            let fg_qty = parseFloat($input.val()) || 0;
            
            if (fg_qty > 0) update_inline_rm_status($row, fg_qty, is_checked);
            
            if (!is_checked || fg_qty <= 0.0001) return;

            let so_idx = $row.data('idx');
            let so_data = sales_orders[so_idx];

            if (so_data.raw_materials) {
                so_data.raw_materials.forEach(rm => {
                    if (!consolidated_rms[rm.item_code]) {
                        consolidated_rms[rm.item_code] = {
                            name: rm.item_name,
                            uom: rm.uom,
                            available_stock: flt(rm.available_qty), 
                            general_po_coming: flt(rm.incoming_general_qty), 
                            required_qty: 0,
                            linked_po_qty_total: 0,
                            po_refs: rm.existing_po_list || [],
                            breakdown: [] 
                        };
                    }
                    let req = fg_qty * flt(rm.bom_qty_per_unit);
                    consolidated_rms[rm.item_code].required_qty += req;
                    consolidated_rms[rm.item_code].linked_po_qty_total += flt(rm.ordered_linked_qty);
                    consolidated_rms[rm.item_code].breakdown.push({
                        so: so_data.sales_order, fg: so_data.item_code, 
                        fg_qty: fg_qty, rm_qty: req
                    });
                });
            }
        });
        render_rm_table(consolidated_rms);
    };

    const update_inline_rm_status = ($row, fg_qty, is_checked) => {
        let so_data = sales_orders[$row.data('idx')];
        if(!is_checked) { $row.find('.rm-prev-stat').text('Ignored').css('color', '#ccc'); return; }

        $row.find('.rm-preview-line').each(function(i) {
            let $line = $(this);
            let base_bom = parseFloat($line.data('base-qty'));
            let total_rm_req = base_bom * fg_qty;
            let rm_data = so_data.raw_materials[i];
            let coverage = flt(rm_data.available_qty) + flt(rm_data.ordered_linked_qty) + flt(rm_data.incoming_general_qty);
            let shortfall = total_rm_req - coverage;
            
            if (shortfall > 0.001) {
                $line.find('.rm-prev-stat').html(`<span style="color:#d62222; font-weight:bold;">-${shortfall.toFixed(1)}</span>`);
            } else {
                $line.find('.rm-prev-stat').html(`<span style="color:#00994d;">OK</span>`);
            }
        });
    }

    const render_rm_table = (rms) => {
        let html = `
            <table class="rm-dialog-table">
            <thead><tr>
                <th width="20%">Raw Material</th>
                <th width="12%" class="text-right">Required</th>
                <th width="12%" class="text-right">Stock</th>
                <th width="12%" class="text-right">Incoming PO</th>
                <th width="12%" class="text-right">Effective</th>
                <th width="20%">Existing Ref</th>
                <th width="12%" class="text-right" style="background: #ebf8ff; border-bottom: 2px solid #5e64ff;">Purchase</th>
            </tr></thead>
            <tbody>`;

        if (Object.keys(rms).length === 0) {
            html += `<tr><td colspan="7" class="text-center p-3 text-muted">No Selection or No Requirements</td></tr>`;
        } else {
            Object.keys(rms).forEach(code => {
                let d = rms[code];
                let effective_stock = d.available_stock + d.linked_po_qty_total + d.general_po_coming;
                let purchase_rec = Math.max(0, d.required_qty - effective_stock);
                
                html += `<tr data-item-code="${code}" data-meta='${JSON.stringify(d)}'>
                    <td><div class="text-highlight">${get_link("Item", code)}</div><small class="text-muted">${d.name}</small></td>
                    <td class="text-right" style="font-weight:bold;">${d.required_qty.toFixed(2)}</td>
                    <td class="text-right text-muted">${d.available_stock.toFixed(2)}</td>
                    <td class="text-right text-primary">${(d.linked_po_qty_total + d.general_po_coming).toFixed(2)}</td>
                    <td class="text-right text-dark">${effective_stock.toFixed(2)}</td>
                    <td style="font-size:10px;">${d.po_refs.slice(0,3).join(", ")}</td>
                    <td class="text-right">
                        <input type="number" class="form-control qty-input final-buy-input text-right" 
                            style="${purchase_rec > 0 ? 'color:#d62222; background:#fff5f5;' : 'color:#999;'}"
                            value="${purchase_rec.toFixed(2)}">
                    </td>
                </tr>`;
            });
        }
        html += "</tbody></table>";
        dialog.$wrapper.find('#rm-calc-area').html(html);
    }

    // --- SETUP DIALOG ---
    let dialog = new frappe.ui.Dialog({
        title: "Fetch Raw Materials",
        size: "extra-large",
        fields: [{ fieldname: "html_area", fieldtype: "HTML", options: dialog_body }],
        primary_action_label: "Create Purchase Rows",
        primary_action: function() {
            let to_add = [];
            let has_breakdown = frm.get_docfield("custom_rm_source_breakdown"); 
            
            dialog.$wrapper.find('.final-buy-input').each(function() {
                let qty = parseFloat($(this).val()) || 0;
                if (qty > 0) {
                    let $row = $(this).closest('tr');
                    let meta = JSON.parse($row.attr('data-meta'));
                    to_add.push({
                        item_code: $row.data('item-code'),
                        item_name: meta.name,
                        qty: qty,
                        uom: meta.uom,
                        breakdown: meta.breakdown
                    });
                }
            });

            if (to_add.length === 0) {
                frappe.msgprint("No quantities entered.");
                return;
            }

            frm.clear_table("items");
            if (has_breakdown) frm.clear_table("custom_rm_source_breakdown");

            to_add.forEach(row => {
                frm.add_child("items", {
                    item_code: row.item_code,
                    item_name: row.item_name,
                    qty: row.qty,
                    uom: row.uom,
                    schedule_date: frappe.datetime.get_today()
                });
                
                if (has_breakdown) {
                     row.breakdown.forEach(b => {
                         frm.add_child("custom_rm_source_breakdown", {
                             raw_material_item: row.item_code,
                             source_sales_order: b.so,
                             source_finished_good: b.fg,
                             order_for_fg: b.fg_qty,
                             order_for_rm: b.rm_qty 
                         });
                    });
                }
            });

            frm.refresh_field("items");
            if(has_breakdown) frm.refresh_field("custom_rm_source_breakdown");
            dialog.hide();
        }
    });

    dialog.show();
    dialog.$wrapper.find('.modal-dialog').css("min-width", "90%");

    // --- EVENTS & SEARCH LOGIC ---

    // 1. Search Functionality
    dialog.$wrapper.on('keyup', '#so-list-search', function() {
        let val = $(this).val().toLowerCase();
        
        dialog.$wrapper.find('.rm-so-row').each(function() {
            let $row = $(this);
            // We search against the prepared 'data-search' attribute
            // which contains SO Name + Item Name/Code + Customer
            let text = $row.data('search');
            
            if (text.indexOf(val) !== -1) {
                $row.show();
            } else {
                $row.hide();
            }
        });
    });

    // 2. Selection and Input Changes
    dialog.$wrapper.on('input change', '.fg-fulfill-input, .so-check', function() {
        if ($(this).hasClass('fg-fulfill-input')) {
            let val = parseFloat($(this).val());
            let max = parseFloat($(this).data('max'));
            if(val > max) $(this).val(max);
            $(this).closest('tr').find('.so-check').prop('checked', val > 0);
        }
        recalc_materials();
    });

    // 3. Select All (Filters to only Visible items if search is active)
    dialog.$wrapper.on('click', '#so-check-all', function() {
        let state = $(this).prop('checked');
        // Only target visible rows
        dialog.$wrapper.find('.rm-so-row:visible .so-check').prop('checked', state).trigger('change');
    });

    // Init
    setTimeout(recalc_materials, 500);
}
function show_stock_check_dialog(frm, materials,linked_subcontracting_docs) {
    let all_stock_available = true;
    let table_rows = materials.map(item => {
        let icon = item.available_qty >= item.required_qty ? 'fa-check text-success' : 'fa-times text-danger';
        if (item.available_qty < item.required_qty) all_stock_available = false;
        return `<tr>
            <td>${frappe.utils.get_form_link("Item", item.item_code, true)}</td>
            <td>${item.required_qty} ${item.uom}</td>
            <td class="font-weight-bold ${icon.includes('danger') ? 'text-danger' : ''}">${item.available_qty} ${item.uom}</td>
            <td class="text-center"><i class="fa ${icon}"></i></td>
        </tr>`;
    }).join('');

    let dialog_html = `<p>Review the stock availability for the required raw materials.</p>
        <table class="table table-bordered table-sm">
            <thead class="thead-light"><tr>
                <th>Raw Material</th><th>Required Qty</th><th>Available Qty</th><th>Status</th>
            </tr></thead>
            <tbody>${table_rows}</tbody>
        </table>`;
    
    if (!all_stock_available) {
        dialog_html += `<div class="alert alert-warning"><b>Cannot Proceed with Transfer:</b> One or more raw materials have insufficient stock. You can create a Material Request to procure them.</div>`;
    }

    let dialog = new frappe.ui.Dialog({
        title: __("Raw Material Stock Check"),
        size: "large",
        fields: [{ fieldname: "stock_info", fieldtype: "HTML", options: dialog_html }],
        
        primary_action_label: __("Create SCO & Material Transfer"),
        primary_action: function() {
            frappe.call({
                method: "erp_dacsinc_custom.purchase_order.create_subcontracting_docs",
                args: { purchase_order_name: frm.doc.name },
                freeze: true, 
                freeze_message: __("Creating Subcontracting Order and Stock Entry..."),
                callback: function(r) {
                    if (r.message && r.message.ste_name) {
                        dialog.hide();
                        
                        frappe.show_alert({
                            message: __("Successfully Created Subcontracting Order and Stock Entry"),
                            indicator: 'green'
                        }, 5);
                        frm.refresh_field("custom_purchase_order_html"); 
                        // location.reload(); 
                        frm.refresh()
                        render_linked_docs_html(frm, linked_subcontracting_docs)
                    }
                }
            });
        },

        secondary_action_label: __("Create Material Request"),
        secondary_action: function() {
            frappe.call({
                method: "erp_dacsinc_custom.purchase_order.create_material_request_for_shortage",
                args: { purchase_order_name: frm.doc.name },
                freeze: true, freeze_message: __("Creating Material Request..."),
                callback: function(r) {
                    if (r.message && r.message.mr_name) {
                        frappe.msgprint({
                            title: __("Material Request Created"),
                            message: __("Created {0} for the missing items.", [frappe.utils.get_form_link("Material Request", r.message.mr_name, true)]),
                            indicator: 'green'
                        });
                    }
                }
            });
            dialog.hide();
        }
    });

    if (all_stock_available) {
        dialog.get_secondary_btn().hide();
    } else {
        dialog.get_primary_btn().prop('disabled', true);
    }

    dialog.show();
}

// function show_receive_items_dialog(frm, sco_name) {
//     frappe.call({
//         method: "erp_dacsinc_custom.purchase_order.get_pending_sco_items",
//         args: { sco_name: sco_name },
//         freeze: true, freeze_message: __("Fetching pending items..."),
//         callback: function(r) {
//             if (!r.message || r.message.length === 0) {
//                 frappe.msgprint(__("No items are currently pending receipt for {0}", [sco_name]));
//                 frm.reload_doc();
//                 return;
//             }
//             let dialog_html = `
//                 <p>Enter the quantities of finished goods you are receiving from the supplier.</p>
//                 <table class="table table-bordered table-sm">
//                     <thead class="thead-light"><tr>
//                         <th>Finished Good</th><th class="text-right">Ordered</th>
//                         <th class="text-right">Received</th><th style="width: 25%;">Qty to Receive</th>
//                     </tr></thead>
//                     <tbody>`;
//             r.message.forEach(item => {
//                 dialog_html += `
//                     <tr data-child-id="${item.name}">
//                         <td>${item.item_name}</td>
//                         <td class="text-right">${item.ordered_qty}</td>
//                         <td class="text-right text-success">${item.received_qty}</td>
//                         <td>
//                             <input type="number" class="form-control" data-max="${item.pending_qty}" value="${item.pending_qty}">
//                         </td>
//                     </tr>`;
//             });
//             dialog_html += '</tbody></table>';
//             let dialog = new frappe.ui.Dialog({
//                 title: __("Receive Finished Goods from {0}", [sco_name]),
//                 size: "large",
//                 fields: [{ fieldname: "receive_table", fieldtype: "HTML", options: dialog_html }],
               
//                 primary_action_label: __("Create Receipts & Invoice"),
//                 primary_action: function() {
//                     let items_to_receive = [];
//                     dialog.$wrapper.find("tbody tr").each(function() {
//                         let row = $(this);
//                         let qty_to_receive = parseFloat(row.find("input").val());
//                         if (qty_to_receive > 0) {
//                             items_to_receive.push({
//                                 name: row.data("child-id"),
//                                 qty_to_receive: qty_to_receive
//                             });
//                         }
//                     });
//                     if (items_to_receive.length === 0) {
//                         frappe.msgprint(__("Please enter a quantity for at least one item."));
//                         return;
//                     }
//                     frappe.call({
//                         method: "erp_dacsinc_custom.purchase_order.create_receipt_documents",
//                         args: {
//                             sco_name: sco_name,
//                             items_to_receive: JSON.stringify(items_to_receive)
//                         },
//                         freeze: true,
//                         freeze_message: __("Creating Purchase Receipts"),
//                         callback: function(r) {
//                             if (r.message && r.message.pi_name) {
//                                 dialog.hide();
//                                 frappe.show_alert({
//                                     message: __("Successfully Created:<br>• {0}<br>• {1}<br>• {2}"),
//                                     indicator: 'green'
//                                 }, 10);
//                                 frm.refresh_field("custom_purchase_order_html"); 
//                                 location.reload();
//                             }
//                         }
//                     });
//                 }
//             });
//             dialog.show();
//         }
//     });
// }

function show_receive_items_dialog(frm, sco_name,linked_subcontracting_docs) {
    frappe.call({
        method: "erp_dacsinc_custom.purchase_order.get_pending_sco_items",
        args: { sco_name: sco_name },
        freeze: true, freeze_message: __("Fetching pending items..."),
        callback: function(r) {
            if (!r.message || r.message.length === 0) {
                frappe.msgprint(__("No items are currently pending receipt for {0}", [sco_name]));
                frm.reload_doc();
                return;
            }
            let dialog_html = `
                <p>Enter the quantities of finished goods you are receiving from the supplier.</p>
                <table class="table table-bordered table-sm">
                    <thead class="thead-light"><tr>
                        <th>Finished Good</th><th class="text-right">Ordered</th>
                        <th class="text-right">Received</th><th style="width: 25%;">Qty to Receive</th>
                    </tr></thead>
                    <tbody>`;
            r.message.forEach(item => {
                dialog_html += `
                    <tr data-child-id="${item.name}">
                        <td>${item.item_name}</td>
                        <td class="text-right">${item.ordered_qty}</td>
                        <td class="text-right text-success">${item.received_qty}</td>
                        <td>
                            <input type="number" class="form-control" data-max="${item.pending_qty}" value="${item.pending_qty}">
                        </td>
                    </tr>`;
            });
            dialog_html += '</tbody></table>';
            
            let dialog = new frappe.ui.Dialog({
                title: __("Receive Finished Goods from {0}", [sco_name]),
                size: "large",
                fields: [{ fieldname: "receive_table", fieldtype: "HTML", options: dialog_html }],
                
                // CHANGE 1: Update Button Label
                primary_action_label: __("Create Receipts"), 
                
                primary_action: function() {
                    let items_to_receive = [];
                    dialog.$wrapper.find("tbody tr").each(function() {
                        let row = $(this);
                        let qty_to_receive = parseFloat(row.find("input").val());
                        if (qty_to_receive > 0) {
                            items_to_receive.push({
                                name: row.data("child-id"),
                                qty_to_receive: qty_to_receive
                            });
                        }
                    });
                    if (items_to_receive.length === 0) {
                        frappe.msgprint(__("Please enter a quantity for at least one item."));
                        return;
                    }
                    frappe.call({
                        method: "erp_dacsinc_custom.purchase_order.create_receipt_documents",
                        args: {
                            sco_name: sco_name,
                            items_to_receive: JSON.stringify(items_to_receive)
                        },
                        freeze: true,
                        freeze_message: __("Creating Purchase Receipts"),
                        callback: function(r) {
                            // CHANGE 2: Check for pr_name, NOT pi_name
                            if (r.message && r.message.pr_name) {
                                dialog.hide();
                                
                                // CHANGE 3: Update Alert to show only SCR and PR
                                frappe.show_alert({
                                    message: __("Successfully Created:<br>• {0} (Subcon Receipt)<br>• {1} (Purchase Receipt)", 
                                    [r.message.scr_name, r.message.pr_name]),
                                    indicator: 'green'
                                }, 7);
                                
                                frm.refresh_field("custom_purchase_order_html"); 
                                frm.refresh();
                                render_linked_docs_html(frm, linked_subcontracting_docs)
                                // location.reload();
                            }
                        }
                    });
                }
            });
            dialog.show();
        }
    });
}




function render_linked_docs_html(frm, docs) {
    const wrapper = frm.fields_dict.custom_purchase_order_html.$wrapper;
	wrapper.empty();
		
    if (Object.values(docs).every(list => list.length === 0)) {
        frm.get_field("custom_purchase_order_html").$wrapper.html(
            `<div class="text-muted p-4 text-center">No linked subcontracting documents found.</div>`
        );
        return;
    }

    const currency_symbol = frm.doc.currency || ""; 

    const custom_style_sheet = `
        .subcontracting-dashboard .nav-tabs { border-bottom: 1px solid #d1d8dd; }
        .subcontracting-dashboard .nav-tabs .nav-link { background-color: #f8f9fa; border: 1px solid #d1d8dd; border-bottom: none; margin-right: 2px; border-top-left-radius: .25rem; border-top-right-radius: .25rem; color: black; font-weight: 500; font-size: 12px; }
        .subcontracting-dashboard .nav-tabs .nav-link.active { background-color: #ffffff; border: 1px solid #d1d8dd; border-bottom: 1px solid #ffffff; color: #000; }
        .subcontracting-dashboard .tab-content { background-color: #ffffff; border: 1px solid #d1d8dd; border-top: none; }
        .subcontracting-dashboard .table thead th { background-color: #F0F4F7; color: #1F272D; font-weight: 600; font-size: 14px; text-transform: capitalize; border-bottom: 2px solid #d1d8dd; }
        .subcontracting-dashboard .table tbody td { vertical-align: middle; padding: 8px; font-size: 12px; }
        .subcontracting-dashboard .table-hover tbody tr:hover { background-color: #fbfbfb; }
        .item-list-wrapper { max-height: 80px; overflow-y: auto; font-size: 14px; }
        .item-row { display: flex; justify-content: space-between; border-bottom: 1px dashed #eee; padding-bottom: 2px; margin-bottom: 2px; }
        .item-row:last-child { border-bottom: none; }
    `;

    // Updated configs to include Items and broader columns
    const doc_configs = {
        sco: { 
            title: "Subcontract Orders", icon: "fa fa-truck", doctype: "Subcontracting Order", 
            headers: ["ID", "Items Details", "Date", "Amount", "Status"], 
            fields: ["name", "items", "transaction_date", "grand_total", "status"],
            col_widths: ["15%", "45%", "15%", "15%", "10%"]
        },
        ste: { 
            title: "Material Transfers", icon: "fa fa-exchange", doctype: "Stock Entry", 
            headers: ["ID", "Items Details", "Posting Date", "Type"], 
            fields: ["name", "items", "posting_date", "stock_entry_type"],
            col_widths: ["20%", "45%", "15%", "20%"]
        },
        scr: { 
            title: "Subcontract Receipts", icon: "fa fa-archive", doctype: "Subcontracting Receipt", 
            headers: ["ID", "Items Details", "Posting Date", "Status"], 
            fields: ["name", "items", "posting_date", "status"],
            col_widths: ["20%", "45%", "20%", "15%"]
        },
        pr: { 
            title: "Purchase Receipts", icon: "fa fa-receipt", doctype: "Purchase Receipt", 
            headers: ["ID", "Items Details", "Posting Date", "Amount", "Status"], 
            fields: ["name", "items", "posting_date", "rounded_total", "status"],
            col_widths: ["15%", "45%", "15%", "15%", "10%"]
        },
        pi: { 
            title: "Purchase Invoices", icon: "fa fa-file-invoice-dollar", doctype: "Purchase Invoice", 
            headers: ["ID", "Items Details", "Posting Date", "Due Date", "Status"], 
            fields: ["name", "items", "posting_date", "due_date", "status"],
            col_widths: ["15%", "40%", "15%", "15%", "15%"]
        }
    };

    const get_status_badge = (status) => {
        let indicator = "gray";
        if (["Completed", "Paid", "Received", "Submitted"].includes(status)) indicator = "green";
        if (["To Receive", "Partially Received", "Unpaid", "To Pay", "To Bill"].includes(status)) indicator = "orange";
        if (["Overdue", "Cancelled", "Rejected"].includes(status)) indicator = "red";
        return `<span class="indicator-pill ${indicator} no-indicator-dot" style="font-size: 13px; padding: 2px 6px;">${status}</span>`;
    };

    let tabs_nav_html = '<ul class="nav nav-tabs" role="tablist">';
    let tabs_content_html = '<div class="tab-content p-3">';
    let first_tab = true;

    for (const key in doc_configs) {
        if (docs[key] && docs[key].length > 0) {
            const config = doc_configs[key];
            const active_class = first_tab ? 'active' : '';
            
            tabs_nav_html += `
                <li class="nav-item">
                    <a class="nav-link ${active_class}" data-toggle="tab" href="#tab-pane-${key}" role="tab">
                        <i class="${config.icon} mr-1 d-none d-md-inline"></i> ${config.title} 
                        <span class="badge badge-light ml-1" style="background-color: #e2e6ea;">${docs[key].length}</span>
                    </a>
                </li>`;
            
            // Build Table Headers with Widths
            let table_html = `<div class="table-responsive"><table class="table table-bordered table-sm table" style="margin-bottom: 0;"><thead><tr>`;
            config.headers.forEach((h, index) => {
                const widthStyle = config.col_widths ? `style="width:${config.col_widths[index]}"` : '';
                table_html += `<th ${widthStyle}>${h}</th>`;
            });
            table_html += `</tr></thead><tbody>`;

            docs[key].forEach(doc => {
                table_html += `<tr>`;
                config.fields.forEach(field => {
                    let value = doc[field];
                    let cell_content = value || '';

                    if (field === 'name') {
                        const route = `/app/${frappe.router.slug(config.doctype)}/${value}`;
                        cell_content = `<a href="${route}" class="font-weight-bold" target="_blank" rel="noopener noreferrer">${value}</a>`;
                    } 
                    else if (field === 'items' && Array.isArray(value)) {
                        // RENDER ITEMS HERE
                        let items_html = `<div class="item-list-wrapper">`;
                        value.forEach(item => {
                            // Show Code, Qty, and Amount if available
                            let item_txt = `<span class="text-primary font-weight-bold">${item.item_code}</span>`;
                            
                            // Determine quantity display
                            let qty = item.qty || 0;
                            // Check item name text (optional, remove if too cluttered)
                            let desc = item.item_name ? `<br><span class="text-muted" style="font-size: 13px;">${item.item_name.substring(0,30)}...</span>` : '';

                            // Add amount if it exists and > 0
                            let amt_str = "";
                            if(item.amount && item.amount > 0) {
                                amt_str = `<span class="ml-2 text-muted">(${frappe.format(item.amount, { type: 'Currency', currency: currency_symbol })})</span>`;
                            }
                            
                            items_html += `
                                <div class="item-row">
                                    <div>${item_txt}: <b>${qty}</b></div>
                                    <div>${amt_str}</div>
                                </div>`;
                        });
                        items_html += `</div>`;
                        cell_content = items_html;
                    } 
                    else if (field.includes('date')) {
                        cell_content = value ? frappe.datetime.str_to_user(value) : '';
                    } 
                    else if (field.includes('total')) {
                        cell_content = frappe.format(value, { type: 'Currency', currency: currency_symbol });
                    } 
                    else if (field === 'status') {
                        cell_content = get_status_badge(value);
                    }
                    
                    table_html += `<td>${cell_content}</td>`;
                });
                table_html += `</tr>`;
            });
            
            table_html += `</tbody></table></div>`;
            tabs_content_html += `<div class="tab-pane fade show ${active_class}" id="tab-pane-${key}" role="tabpanel">${table_html}</div>`;
            first_tab = false;
        }
    }
    tabs_nav_html += '</ul>';
    tabs_content_html += '</div>';
    
    const final_html = `<style>${custom_style_sheet}</style><div class="subcontracting-dashboard border rounded shadow-sm mb-3 bg-white">${tabs_nav_html}${tabs_content_html}</div>`;
                       
    const $wrapper = frm.get_field("custom_purchase_order_html").$wrapper;
    $wrapper.off('click', 'a[data-toggle="tab"]');
    $wrapper.html(final_html);
    $wrapper.on('click', 'a[data-toggle="tab"]', function(e) {
        e.preventDefault();
        e.stopPropagation();
        $(this).tab('show');
    });
}