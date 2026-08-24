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
        const required_qty = flt(rm.required_qty, 2);
        const available_qty = flt(rm.available_qty, 2);
        const has_enough_stock = available_qty >= required_qty;
        const availability_color = has_enough_stock ? 'text-success' : 'text-danger';
        const status_icon = has_enough_stock ? 'fa-check' : 'fa-times';
        const tooltip = `Total Stock: ${flt(rm.actual_qty, 2)} | Reserved for Others: ${flt(rm.reserved_qty, 2)}`;

        return `
            <tr>
                <td>${get_link("Item", rm.item_code)}<br><small class="text-muted">${rm.item_name}</small></td>
                <td class="text-right">${required_qty} ${rm.stock_uom}</td>
                <td class="text-right font-weight-bold ${availability_color}" title="${tooltip}">
                    ${available_qty} ${rm.stock_uom}
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
    is_subcontracted: function (frm) {
        apply_supplier_filter(frm);
        if (frm.doc.is_subcontracted) {
            frm.remove_custom_button(__('Get Items from MR'));
        } else {
            if (frm.doc.docstatus == 0) {
                frm.add_custom_button(__('Get Items from MR'), function () {
                    load_mr_suggestions(frm);
                });
            }
        }
        frm.trigger('refresh');
    },

    schedule_date: function (frm) {
        if (frm.doc.schedule_date) {
            frm.doc.items.forEach(row => {
                frappe.model.set_value(row.doctype, row.name, 'schedule_date', frm.doc.schedule_date);
            });
            frm.refresh_field('items');
        }
    },

    refresh: function (frm) {
        apply_supplier_filter(frm);

        setTimeout(() => {
            frm.page.remove_inner_button('Purchase Invoice', 'Create');
            // frm.page.remove_inner_button('Payment Request', 'Create');
            // frm.page.remove_inner_button('Purchase Receipt', 'Create');
            frm.remove_custom_button('Supplier Quotation', 'Get Items From');
            frm.remove_custom_button('Material Request', 'Get Items From');
            frm.remove_custom_button('Product Bundle', 'Get Items From');
        }, 500);

        const wrapper = frm.fields_dict.custom_purchase_order_html.$wrapper;
        wrapper.empty();
        frm.remove_custom_button(__('Create Subcontracting Docs'));
        frm.remove_custom_button(__('Receive Finished Goods'));
        frm.clear_custom_buttons();

        let linked_subcontracting_docs = null;

        if (frm.doc.docstatus === 1) {
            frappe.call({
                method: "erp_dacsinc_custom.purchase_order.get_linked_subcontracting_docs",
                args: { purchase_order_name: frm.doc.name },
                callback: function (r) {
                    if (r.message) {
                        render_linked_docs_html(frm, r.message);
                        linked_subcontracting_docs = r.message;
                    }
                }
            });
        }

        if (frm.doc.docstatus === 1) {
            frappe.call({
                method: "erp_dacsinc_custom.purchase_order.get_sco_status_for_po",
                args: { purchase_order_name: frm.doc.name },
                callback: function (r) {
                    if (!r.message) return;

                    const {
                        sco_exists, items_pending, sco_name,
                        is_panel_job_open, fg_received, has_closed_panel_job
                    } = r.message;

                    const is_sub = frm.doc.is_subcontracted;

                    if (is_sub && sco_exists && !fg_received) {
                        frm.add_custom_button(__('Panel Job Work'), function () {
                            show_panel_process_dashboard(frm);
                        }).addClass('btn-secondary');
                    }

                    let can_do_full_piece = false;

                    if (is_sub) {
                        can_do_full_piece = sco_exists && !items_pending;
                    } else {
                        can_do_full_piece = fg_received;
                    }
                    if (can_do_full_piece) {
                        frm.add_custom_button(__('Full Piece Job Work'), function () {
                            show_po_full_piece_dashboard(frm);
                        }).addClass('btn-info');
                    }

                    if (is_sub && sco_exists && items_pending && !is_panel_job_open) {
                        frm.add_custom_button(__('Receive Finished Goods'), function () {
                            show_receive_items_dialog(frm, sco_name, null);
                        }).addClass('btn-primary');
                    }

                    if (is_sub) {
                        if (sco_exists) {
                            frm.add_custom_button(__('Print SCO'), () => {
                                window.open(
                                    `/api/method/frappe.utils.print_format.download_pdf` +
                                    `?doctype=Subcontracting%20Order` +
                                    `&name=${sco_name}` +
                                    `&format=Subcontracting%20Order%20Print%20Format%203` +
                                    `&no_letterhead=1` +
                                    `&letterhead=DAC%20Letter%20Header` +
                                    `&settings=%7B%7D` +
                                    `&_lang=en`
                                );
                            }).css({ 'color': '#555' });
                        } else {
                            frm.add_custom_button(__('Create Subcontracting Docs'), function () {
                                frappe.call({
                                    method: "erp_dacsinc_custom.purchase_order.get_required_raw_materials_for_po",
                                    args: { purchase_order_name: frm.doc.name },
                                    freeze: true,
                                    callback: function (res) {
                                        if (res.message) show_stock_check_dialog(frm, res.message, null);
                                    }
                                });
                            });
                        }
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

        if (frm.doc.docstatus == 0 && !frm.doc.is_subcontracted) {
            frm.add_custom_button(__('Get Items from MR'), function () {
                load_mr_suggestions(frm);
            });
        }
    }
});

// ----------------------------------------------------------------------------------
// --- WORKFLOW DASHBOARDS & DIALOGS ---
// ----------------------------------------------------------------------------------

function show_po_full_piece_dashboard(frm) {
    frappe.call({
        method: "erp_dacsinc_custom.purchase_order.get_full_piece_dashboard_data",
        args: {
            po_name: frm.doc.name
        },
        freeze: true,
        callback: function (r) {
            if (!r.message) return;
            const { available_items, active_processes, sco_name } = r.message;
            const send_list = available_items.filter(i => i.balance_avail > 0);

            const format_stage = (stage) => {
                if (stage === "Received from Full Piece Jobber") {
                    return `<span class="badge badge-success" style="padding:4px 8px;">Received</span>`;
                }
                return `<span class="badge badge-secondary" style="background-color:#5a6268; padding:4px 8px;">Sent / Pending</span>`;
            };

            const styles = `
                <style>
                    .fp-container { font-family: -apple-system, sans-serif; background-color: #f3f5f7; padding: 15px; border-radius: 5px; }
                    .fp-card { background: white; border: 1px solid #e1e1e1; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); margin-bottom: 20px; overflow: hidden; }
                    .fp-card-header { padding: 10px 15px; border-bottom: 1px solid #efefef; background-color: #fff; font-weight: 700; color: #444; font-size: 13px; text-transform: uppercase; display: flex; align-items: center; }
                    .fp-card-header i { margin-right: 8px; color: #6c757d; }
                    .fp-card-body { padding: 15px; }
                    .fp-label { font-size: 11px; font-weight: 600;  color: #777; margin-bottom: 6px; }
                    .clean-table { width: 100%; font-size: 13px; }
                    .clean-table th { background-color: #f8f9fa; border-bottom: 1px solid #dee2e6; color: #555; font-weight: 600; padding: 10px; text-align: left; }
                    .clean-table td { padding: 10px; border-bottom: 1px solid #efefef; vertical-align: middle; }
                    .qty-field { border: 1px solid #ced4da; border-radius: 4px; padding: 4px 8px; width: 100px; text-align: right; }
                </style>
            `;

            let html = `<div class="fp-container">${styles}`;

            // --- Section 1: Dispatch New Batch ---
            if (send_list.length > 0) {
                html += `
                <div class="fp-card">
                    <div class="fp-card-header"><i class="fa fa-paper-plane"></i> 1. Dispatch New Batch to Jobber</div>
                    <div class="fp-card-body">
                        <div class="row"><div class="col-md-6" style="margin-bottom:15px;">
                            <label class="fp-label">Select Jobber (Supplier)</label>
                            <div id="fp-jobber-wrapper"></div>
                        </div></div>
                        <table class="clean-table">
                            <thead><tr>
                                <th>Item Details</th>
                                <th class="text-right">Available</th>
                                <th class="text-right">Already Sent</th>
                                <th width="110">Qty to Send</th>
                            </tr></thead>
                            <tbody>
                                ${send_list.map(i => {
                                    const balance_avail = flt(i.balance_avail, 2);
                                    return `
                                <tr data-item="${i.item_code}" data-name="${frappe.utils.escape_html(i.item_name)}">
                                    <td><b>${i.item_name}</b><br><small class="text-muted">${i.item_code}</small></td>
                                    <td class="text-right font-weight-bold">${balance_avail}</td>
                                    <td class="text-right text-muted">${flt(i.already_assigned, 2)}</td>
                                    <td><input type="number" class="qty-field fp-qty" value="${balance_avail}" data-max="${balance_avail}" min="0"></td>
                                </tr>`;
                                }).join('')}
                            </tbody>
                        </table>
                        <div class="text-right mt-3">
                            <button class="btn btn-primary btn-sm" id="btn-fp-send-pre">Create Transfer Documents <i class="fa fa-arrow-right ml-1"></i></button>
                        </div>
                    </div>
                </div>`;
            }

            // --- Section 2: History and Tracking ---
            // --- Section 2: History and Tracking ---
            html += `
<div class="fp-card">
    <div class="fp-card-header"><i class="fa fa-history"></i> 2. Tracking History</div>
    <div class="fp-card-body p-0">
        <table class="clean-table">
            <thead><tr>
                <th width="18%">Document ID</th>
                <th width="20%">Jobber</th>
                <th width="32%">Item Details</th>
                <th class="text-center">Phase</th>
                <th class="text-right">Action</th>
            </tr></thead>
            <tbody>
                ${active_processes.length ? active_processes.map(doc => {

                // --- NEW: Generate Image Preview HTML ---
                let image_html = "";
                if (doc.images && doc.images.length > 0) {
                    image_html = `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:8px; border-top:1px dashed #eee; padding-top:6px;">`;
                    doc.images.forEach(url => {
                        image_html += `
                                <a href="${url}" target="_blank" title="Click to view full image">
                                    <img src="${url}" 
                                         style="width:32px; height:32px; object-fit:cover; border:1px solid #ddd; border-radius:4px; cursor:pointer;" 
                                         onerror="this.src='/assets/frappe/images/file-icon.png'">
                                </a>`;
                    });
                    image_html += `</div>`;
                }

                return `<tr>
                        <td><a href="/app/embroidery-work-order/${doc.name}" target="_blank"><b>${doc.name}</b></a><br><small>${frappe.datetime.str_to_user(doc.date)}</small></td>
                        <td>${doc.full_piece_jobber_name}</td>
                        <td>
                            ${doc.details_html}
                            ${image_html} <!-- Show attached images here -->
                        </td>
                        <td class="text-center">${format_stage(doc.full_piece_stage)}</td>
                        <td class="text-right">
                            ${doc.full_piece_stage !== "Received from Full Piece Jobber" ?
                        `<button class="btn btn-outline-primary btn-xs btn-fp-receive" data-name="${doc.name}"><i class="fa fa-download"></i> Receive</button>` :
                        `<span class="small font-weight-bold text-success">Completed</span>`}
                        </td>
                    </tr>`;
            }).join('') : '<tr><td colspan="5" class="text-center p-4 text-muted">No active processes found.</td></tr>'}
            </tbody>
        </table>
    </div>
</div></div>`;

            const dialog = new frappe.ui.Dialog({
                title: __('Full Piece Job Dashboard'),
                fields: [{ fieldtype: 'HTML', options: html }]
            });
            dialog.$wrapper.find('.modal-dialog').css("max-width", "1000px");

            dialog.show();

            // Render Frappe control after dialog is shown
            if (send_list.length > 0) {
                frappe.ui.form.make_control({
                    parent: dialog.$wrapper.find('#fp-jobber-wrapper'),
                    df: { fieldtype: 'Link', options: 'Supplier', fieldname: 'fp_jobber', reqd: 1, label: "Jobber" },
                    render_input: true
                });
            }

            // Event handler for creating a new job transfer
            // dialog.$wrapper.on('click', '#btn-fp-send-pre', function() {
            //     const jobber = dialog.$wrapper.find('input[data-fieldname="fp_jobber"]').val();
            //     if (!jobber) {
            //         frappe.msgprint(__("Please select a Jobber."));
            //         return;
            //     }

            //     const items_to_send = [];
            //     dialog.$wrapper.find('.fp-qty').each(function() {
            //         let $input = $(this);
            //         let tr = $input.closest('tr');
            //         let qty = parseFloat($input.val()) || 0;
            //         if (qty > 0) {
            //             items_to_send.push({
            //                 item_code: tr.data('item'),
            //                 item_name: tr.data('name'),
            //                 qty: qty
            //             });
            //         }
            //     });

            //     if (items_to_send.length === 0) {
            //         frappe.msgprint(__("Select at least one item and enter a quantity > 0 to transfer."));
            //         return;
            //     }

            //     frappe.call({
            //         method: "erp_dacsinc_custom.purchase_order.create_full_piece_send",
            //         args: {
            //             sco_name: sco_name || null,
            //             po_name: frm.doc.name,
            //             items_data: JSON.stringify(items_to_send),
            //             supplier: jobber
            //         },
            //         freeze: true,
            //         callback: (res) => {
            //             if (res.message) {
            //                 dialog.hide();
            //                 frappe.show_alert({message: __("Transfer documents created."), indicator: "green"});
            //                 setTimeout(() => show_po_full_piece_dashboard(frm), 800);
            //             }
            //         }
            //     });
            // });

            dialog.$wrapper.on('click', '#btn-fp-send-pre', function () {
                const jobber = dialog.$wrapper.find('input[data-fieldname="fp_jobber"]').val();
                if (!jobber) return frappe.msgprint(__("Select Jobber."));

                const items_to_send = [];
                dialog.$wrapper.find('.fp-qty').each(function () {
                    let q = parseFloat($(this).val()) || 0;
                    if (q > 0) {
                        items_to_send.push({
                            item_code: $(this).closest('tr').data('item'),
                            item_name: $(this).closest('tr').data('name'),
                            qty: q
                        });
                    }
                });

                if (!items_to_send.length) return frappe.msgprint(__("Qty must be > 0."));

                // Multi-Attachment Secondary Dialog
                const d_upload = new frappe.ui.Dialog({
                    title: __('Attach Files for Batch'),
                    fields: [
                        { label: 'Dispatch Notes', fieldname: 'notes', fieldtype: 'Small Text' },
                        {
                            label: 'Attachments',
                            fieldname: 'attachment_table',
                            fieldtype: 'Table',
                            fields: [{ fieldname: 'file', label: 'File', fieldtype: 'Attach', in_list_view: 1 }]
                        }
                    ],
                    primary_action_label: __('Send Batch'),
                    primary_action: (v) => {
                        const files = (v.attachment_table || []).map(r => r.file).filter(f => f);

                        frappe.call({
                            method: "erp_dacsinc_custom.purchase_order.create_full_piece_send",
                            args: {
                                sco_name: sco_name || null,
                                po_name: frm.doc.name,
                                items_data: JSON.stringify(items_to_send),
                                supplier: jobber,
                                notes: v.notes,
                                attachment_urls: JSON.stringify(files)
                            },
                            freeze: true,
                            callback: () => {
                                d_upload.hide();
                                dialog.hide();
                                frappe.show_alert({ message: __("Batch dispatched."), indicator: "green" });
                                setTimeout(() => show_po_full_piece_dashboard(frm), 800);
                            }
                        });
                    }
                });
                d_upload.show();
            });

            // Event handler for receiving items back from the jobber
            dialog.$wrapper.on('click', '.btn-fp-receive', function () {
                const ewo_name = $(this).data('name');
                frappe.call({
                    method: "erp_dacsinc_custom.purchase_order.get_ewo_details",
                    args: { name: ewo_name },
                    callback: (res) => {
                        if (!res.message || !res.message.items) return;

                        let receipt_table_html = `<table class="table table-sm table-bordered"><thead><tr class="bg-light"><th>Item</th><th class="text-right">Sent</th><th class="text-right">Balance</th><th width="120">Qty to Receive</th></tr></thead><tbody>`;
                        res.message.items.forEach(i => {
                            let ordered_qty = flt(i.ordered_qty, 2);
                            let balance = flt(ordered_qty - flt(i.received_qty || 0, 2), 2);
                            receipt_table_html += `
                                <tr data-row-name="${i.name}">
                                    <td>${i.item_code}</td>
                                    <td class="text-right">${ordered_qty}</td>
                                    <td class="text-right font-weight-bold">${balance}</td>
                                    <td>
                                        <input type="number" class="form-control text-right receive-qty-input"
                                               value="${balance}" min="0" max="${balance}" data-max="${balance}"
                                               ${balance <= 0 ? 'disabled' : ''}>
                                    </td>
                                </tr>`;
                        });
                        receipt_table_html += `</tbody></table>`;

                        // --- FIX: This is the dialog where the error occurred ---
                        const d2 = new frappe.ui.Dialog({
                            title: __('Confirm Full Piece Receipt for {0}', [ewo_name]),
                            fields: [{ fieldtype: 'HTML', options: receipt_table_html }],
                            primary_action_label: __("Create Receipt"),
                            primary_action: () => {
                                // This is the CORRECTED logic
                                let items_to_receive = [];
                                let has_error = false;

                                d2.$wrapper.find('tbody tr').each(function () {
                                    let $input = $(this).find('.receive-qty-input');
                                    let qty = parseFloat($input.val()) || 0;
                                    let max = parseFloat($input.data('max'));

                                    if (qty < 0 || qty > max) {
                                        has_error = true;
                                        $input.addClass('is-invalid');
                                    } else {
                                        $input.removeClass('is-invalid');
                                    }

                                    if (qty > 0) {
                                        items_to_receive.push({ name: $(this).data('row-name'), qty: qty });
                                    }
                                });

                                if (has_error) {
                                    frappe.msgprint(__('Please fix the quantities in red.'));
                                    return;
                                }

                                if (items_to_receive.length === 0) {
                                    frappe.msgprint(__('Enter a quantity > 0 for at least one item.'));
                                    return;
                                }

                                frappe.call({
                                    method: "erp_dacsinc_custom.purchase_order.create_full_piece_receipt",
                                    args: { ewo_name: ewo_name, items_data: JSON.stringify(items_to_receive) },
                                    freeze: true,
                                    callback: () => {
                                        d2.hide();
                                        dialog.hide();
                                        frappe.show_alert({ message: __("Receipt created successfully."), indicator: "green" });
                                        setTimeout(() => show_po_full_piece_dashboard(frm), 1000);
                                    }
                                });
                            }
                        });
                        d2.show();
                    }
                });
            });
        }
    });
}

function show_panel_process_dashboard(frm) {
    // Determine the anchor (SCO or PO) for backend processing
    frappe.call({
        method: "erp_dacsinc_custom.purchase_order.get_panel_work_summary",
        args: { po_name: frm.doc.name },
        freeze: true,
        callback: function (r) {
            if (!r.message) return;
            const { all_items, active_processes, sco_name } = r.message;
            const pending_list = all_items.filter(i => i.pending_qty > 0);

            // Styling (Consolidated for easier management)
            const css_styles = `
            <style>
                .pd-container { font-family: -apple-system, sans-serif; background-color: #f4f7f6; padding: 15px; border-radius: 8px; }
                .pd-card { background: white; border-radius: 8px; border: 1px solid #e1e4e8; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); overflow: hidden; }
                .pd-header { padding: 12px 18px; font-weight: 700; color: #2c3e50; border-bottom: 1px solid #eaeaea; background: #fff; }
                .pd-table { width: 100%; border-collapse: collapse; }
                .pd-table th { background: #f8f9fa; padding: 12px; font-size: 11px;  color: #666; border-bottom: 2px solid #eee; }
                .pd-table td { padding: 12px; border-bottom: 1px solid #f1f3f4; vertical-align: top; font-size: 13px; }
                .btn-step { font-size: 12px; font-weight: 600; border: none; border-radius: 4px; padding: 6px 10px; color: white; width: 100%; transition: background 0.2s; }
                .step-2 { background-color: #007bff; } .step-3 { background-color: #17a2b8; } .step-4 { background-color: #28a745; }
                .step-2:hover { background-color: #0062cc; } .step-3:hover { background-color: #138496; } .step-4:hover { background-color: #218838; }
            </style>`;

            let html = `<div class="pd-container">${css_styles}`;

            // --- PART 1: NEW INITIALIZATION ---
            if (pending_list.length > 0) {
                html += `
                <div class="pd-card">
                    <div class="pd-header text-danger"><i class="fa fa-arrow-circle-o-down mr-2"></i> 1. Start New Panel Batch</div>
                    <div class="p-3" style="background:#fff9f9">
                        <table class="table table-bordered table-sm bg-white mb-2 shadow-sm">
                            <thead><tr class="small">
                                <th class="text-center" width="40"><input type="checkbox" id="pw-select-all" ></th>
                                <th>Item Details</th><th class="text-right">Max Pending</th><th width="100">Send Qty</th>
                            </tr></thead>
                            <tbody>
                            ${pending_list.map(i => {
                                const pending_qty = flt(i.pending_qty, 2);
                                return `
                                <tr data-item="${i.item_code}" data-name="${frappe.utils.escape_html(i.item_name)}">
                                    <td class="text-center"><input type="checkbox" class="pw-new-check"></td>
                                    <td><b>${i.item_name}</b><br><small class="text-muted">${i.item_code}</small></td>
                                    <td class="text-right">${pending_qty}</td>
                                    <td><input type="number" class="form-control form-control-sm text-right pw-qty-input" value="${pending_qty}" data-max="${pending_qty}"></td>
                                </tr>`;
                            }).join('')}
                            </tbody>
                        </table>
                        <div class="text-right"><button class="btn btn-danger btn-sm" id="btn-pw-start"><i class="fa fa-plus"></i> Initialize Batch</button></div>
                    </div>
                </div>`;
            }

            // --- PART 2: ACTIVE TRANSITIONS ---
            html += `
            <div class="pd-card">
                <div class="pd-header"><i class="fa fa-random mr-2"></i> 2. Process Transfers & Receipt</div>
                <table class="pd-table">
                    <thead><tr>
                        <th width="150">Work Order</th><th>Jobber</th><th>Batch Progress</th><th>Status / Phase</th><th width="150">Action</th>
                    </tr></thead>
                    <tbody>
                        ${active_processes.length ? active_processes.map(doc => {
                let label = '', cls = '';
                // Inside active_processes.map(doc => { ...

                let image_html = "";
                if (doc.images && doc.images.length > 0) {
                    image_html = `
        <div class="mt-2 d-flex flex-wrap" style="gap: 6px;">
            ${doc.images.map(url => {
                        // Ensure the URL is correctly prefixed if it's a relative local file
                        const full_url = (url.startsWith('http') || url.startsWith('/')) ? url : '/' + url;

                        return `
                    <a href="${full_url}" 
                       target="_blank" 
                       title="Click to view full image in new tab"
                       style="display: inline-block; border: 1px solid #d1d8dd; padding: 2px; border-radius: 4px; background: #fff; transition: transform 0.1s;"
                       onmouseover="this.style.transform='scale(1.1)'" 
                       onmouseout="this.style.transform='scale(1.0)'">
                        <img src="${full_url}" 
                             style="width: 32px; height: 32px; object-fit: cover; border-radius: 2px; display: block;" 
                             onerror="this.src='/assets/frappe/images/file-icon.png'">
                    </a>`;
                    }).join('')}
        </div>`;
                }
                if (doc.panel_stage === 'Received from Jobber (Internal)') { label = 'Send to Jobber'; cls = 'step-2'; }
                else if (doc.panel_stage === 'Sent to Panel Jobber') { label = 'Receive from Jobber'; cls = 'step-3'; }
                else if (doc.panel_stage === 'Received from Panel Jobber') { label = 'Return / Close'; cls = 'step-4'; }

                return `<tr>
                                <td><a href="/app/embroidery-work-order/${doc.name}" target="_blank"><b>${doc.name}</b></a><br><small class="text-muted">${frappe.datetime.str_to_user(doc.date)}</small></td>
                                <td>${doc.panel_jobber_name}</td>
                                <td>${doc.details_html}  ${image_html} </td>
                                <td><span class="badge badge-info">${doc.panel_stage}</span></td>
                                <td>${label ? `<button class="btn-step ${cls} btn-action" data-name="${doc.name}" data-stage="${doc.panel_stage}">${label}</button>` : '<span class="text-success font-weight-bold">DONE</span>'}</td>
                            </tr>`;
            }).join('') : '<tr><td colspan="4" class="text-center p-4 text-muted">No active batch transfers found</td></tr>'}
                    </tbody>
                </table>
            </div></div>`;

            const dialog = new frappe.ui.Dialog({ title: 'Embroidery Panel Workflow', fields: [{ fieldtype: 'HTML', options: html }] });
            dialog.$wrapper.find('.modal-dialog').css("max-width", "1100px");
            dialog.show();

            // Internal Helper Function to run the Backend update
            const run_update = (name, stage, note, supplier = null) => {
                frappe.call({
                    method: "erp_dacsinc_custom.purchase_order.update_panel_process_stage",
                    args: { name: name, next_stage: stage, notes: note, panel_jobber: supplier },
                    freeze: true,
                    callback: () => { dialog.hide(); frm.reload_doc(); setTimeout(() => show_panel_process_dashboard(frm), 800); }
                });
            };

            // Listener for Initialization (Part 1)
            dialog.$wrapper.on('click', '#btn-pw-start', function () {
                let items = [];
                dialog.$wrapper.find('.pw-new-check:checked').each(function () {
                    let tr = $(this).closest('tr');
                    let q = parseFloat(tr.find('.pw-qty-input').val()) || 0;
                    if (q > 0) {
                        items.push({
                            item_code: tr.data('item'),
                            item_name: tr.data('name'),
                            qty_to_send: q
                        });
                    }
                });






                if (!items.length) return frappe.msgprint("Select at least one item.");

                // NEW: Open a secondary dialog for Notes
                let d_init = new frappe.ui.Dialog({
                    title: 'Step 1: Initialize Batch Details',
                    fields: [
                        { label: 'Initialization Notes', fieldname: 'notes', fieldtype: 'Small Text' },
                        {
                            label: 'Reference Images / Files',
                            fieldname: 'attachment_table',
                            fieldtype: 'Table',
                            fields: [
                                {
                                    fieldname: 'file',
                                    label: __('Attach File'),
                                    fieldtype: 'Attach',
                                    in_list_view: 1,
                                    columns: 10
                                }
                            ]
                        }
                    ],
                    primary_action_label: __('Initialize & Submit'),
                    primary_action: (values) => {
                        // Collect all file URLs from the table
                        let files = (values.attachment_table || [])
                            .map(row => row.file)
                            .filter(f => f); // Remove empty rows

                        d_init.hide();
                        dialog.hide();

                        frappe.call({
                            method: "erp_dacsinc_custom.purchase_order.create_embroidery_work_order",
                            args: {
                                po_name: frm.doc.name,
                                sco_name: sco_name || null,
                                items_to_send: JSON.stringify(items),
                                supplier: frm.doc.supplier,
                                type: "Panel Job Work",
                                stage: "Received from Jobber (Internal)",
                                notes: values.notes,
                                attachment_urls: JSON.stringify(files) // Send list as stringified JSON
                            },
                            freeze: true,
                            freeze_message: __("Creating Work Order..."),
                            callback: (r) => {
                                if (r.message) {
                                    frappe.show_alert({ message: __('Batch Initialized Successfully'), indicator: 'green' });
                                    frm.reload_doc();
                                    setTimeout(() => show_panel_process_dashboard(frm), 800);
                                }
                            }
                        });
                    }
                });

                d_init.show();
            });
            // Listener for Transitions (Part 2) - This replaces handle_process_transition
            dialog.$wrapper.on('click', '.btn-action', function () {
                const name = $(this).data('name');
                const stage = $(this).data('stage');

                if (stage === 'Received from Jobber (Internal)') {
                    // 1. Assign to a variable 'd2'
                    let d2 = new frappe.ui.Dialog({
                        title: 'Step 2: Assign & Send to Panel Jobber',
                        fields: [
                            { label: 'Jobber (Supplier)', fieldname: 's', fieldtype: 'Link', options: 'Supplier', reqd: 1 },
                            { label: 'Notes', fieldname: 'n', fieldtype: 'Small Text' }
                        ],
                        primary_action: (v) => {
                            // 2. Hide immediately on click
                            d2.hide();
                            // 3. Execute logic
                            run_update(name, 'Sent to Panel Jobber', v.n, v.s);
                        },
                        primary_action_label: __('Send to Jobber')
                    });
                    d2.show();
                } else if (stage === 'Sent to Panel Jobber') {
                    frappe.call({
                        method: "erp_dacsinc_custom.purchase_order.get_ewo_details", args: { name: name },
                        callback: (res) => {
                            let tbl = `<table class="table table-bordered table-sm" style="font-size:12px;"><thead><tr class="bg-light"><th>Item</th><th class="text-right">Sent</th><th class="text-right">Bal</th><th width="100">Rx Qty</th></tr></thead><tbody>`;
                            res.message.items.forEach(i => {
                                let ordered_qty = flt(i.ordered_qty, 2);
                                let bal = flt(ordered_qty - flt(i.received_qty || 0, 2), 2);
                                tbl += `<tr data-row="${i.name}"><td>${i.item_code}</td><td class="text-right">${ordered_qty}</td><td class="text-right">${bal}</td><td><input type="number" class="form-control form-control-sm i-q text-right" value="${bal}" ${bal <= 0 ? 'disabled' : ''}></td></tr>`;
                            });
                            tbl += `</tbody></table>`;
                            const rx_dlg = new frappe.ui.Dialog({
                                title: 'Step 3: Panel Receipt confirmation',
                                fields: [{ fieldtype: 'HTML', options: tbl }, { label: 'Note', fieldname: 'n', fieldtype: 'Small Text' }],
                                primary_action: (v) => {
                                    let dt = [];
                                    rx_dlg.$wrapper.find('tbody tr').each(function () {
                                        let q = parseFloat($(this).find('.i-q').val()) || 0;
                                        if (q > 0) dt.push({ name: $(this).data('row'), qty: q });
                                    });
                                    if (!dt.length) return;
                                    frappe.call({
                                        method: "erp_dacsinc_custom.purchase_order.receive_panel_items",
                                        args: { name: name, items_data: JSON.stringify(dt), notes: v.n },
                                        freeze: true,
                                        callback: () => { rx_dlg.hide(); dialog.hide(); frm.reload_doc(); setTimeout(() => show_panel_process_dashboard(frm), 1000); }
                                    });
                                }
                            });
                            rx_dlg.show();
                        }
                    });
                }
                else if (stage === 'Received from Panel Jobber') {
                    // 1. Assign the dialog to a variable (d4)
                    let d4 = new frappe.ui.Dialog({
                        title: 'Step 4: Return Finished Panels to Jobber',
                        fields: [{ label: 'Closing Instruction/Notes', fieldname: 'n', fieldtype: 'Small Text' }],
                        primary_action: (v) => {
                            // 2. Hide the dialog first
                            d4.hide();
                            // 3. Then run the update logic
                            run_update(name, 'Returned to Jobber (Closed)', v.n);
                        },
                        primary_action_label: __('Close Job') // Optional: Label for clarity
                    });
                    d4.show();
                }
                // else if (stage === 'Received from Panel Jobber') {
                //     new frappe.ui.Dialog({
                //         title: 'Step 4: Return Finished Panels to Jobber',
                //         fields: [{ label: 'Closing Instruction/Notes', fieldname: 'n', fieldtype: 'Small Text' }],
                //         primary_action: (v) => { run_update(name, 'Returned to Jobber (Closed)', v.n); }
                //     }).show();
                // }
            });

            // Toggle All Logic
            dialog.$wrapper.find('#pw-select-all').on('change', function () {
                dialog.$wrapper.find('.pw-new-check').prop('checked', $(this).is(':checked'));
            });
        }
    });
}

function show_sales_order_dialog(frm, data, is_subcontracted) {
    console.log(data, is_subcontracted)
    const { item_summary, sales_orders } = data;

    // Helper: New Tab Link
    const get_link = (doctype, name) => {
        if (!name) return "";
        const url = frappe.utils.get_form_link(doctype, name);
        return `<a href="${url}" target="_blank" class="custom-link">${name}</a>`;
    };

    // ── STYLES ──
    const css = `
    <style>
        .custom-link { color: #1160b7; font-weight: 600; text-decoration: none; font-size: 13px; }
        .dialog-container { font-size: 13px !important; color: #333; }
        .dialog-table thead th { background: #f8f9fa; color: #555; font-size: 12px;  padding: 10px; border-bottom: 2px solid #ddd !important; }
        .dialog-table td { vertical-align: top !important; padding: 10px !important; border-bottom: 1px solid #f1f1f1 !important; }
        
        .item-code-main { font-size: 14px; font-weight: 700; display: block; margin: 2px 0; color: #000; }
        .jobber-badge { color: #8e44ad; background: #fdf2ff; border: 1px solid #ebdaff; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; display: inline-block; }
        
        .text-pick-sub { color: #28a745; font-weight: 700; }
        .text-pick-draft { color: #bf7500; font-weight: 600; }
        
        .po-box-linked { background: #f4f9ff; border: 1px solid #dce9f9; padding: 8px; border-radius: 4px; margin-bottom: 6px; }
        .po-box-other { background: #fffcf0; border: 1px solid #f9ebbe; padding: 8px; border-radius: 4px; font-size: 12px; }
        
        .other-po-list-container { 
            display: none; 
            margin-top: 8px; 
            border: 1px solid #e3cb89; 
            border-radius: 4px;
            max-height: 120px; 
            overflow-y: auto; 
            background: #ffffff; 
            padding: 5px; 
        }
        .po-detail-line { font-size: 11px; padding: 4px 0; border-bottom: 1px solid #f9f1d4; display: flex; justify-content: space-between; align-items: center; }
        .po-detail-line:last-child { border-bottom: none; }
        .sup-text { color: #777; font-size: 10px; font-weight: normal; }
        
        .toggle-details-btn { cursor: pointer; color: #1160b7; font-size: 11px; text-decoration: underline; font-weight: 700; }
        .toggle-details-btn:hover { color: #d9534f; }
        
        .qty-input-main { font-size: 15px !important; font-weight: 700 !important; color: #d9534f !important; height: 32px !important; text-align: right; width: 100% !important;}
        #dialog-search-big { width: 600px !important; background: #fff; border: 1px solid #c8d1d9; height: 40px; padding: 5px 20px; border-radius: 20px !important; font-size: 14px;}
        #dialog-search-big:focus { border-color: #1160b7; outline: none; box-shadow: 0 0 5px rgba(17,96,183,0.3); }
    </style>
    `;

    let html = css + '<div class="dialog-container">';

    // ── 1. TOP GLOBAL SUMMARY ──
    if (item_summary && item_summary.length > 0) {
        let sum_rows = item_summary.map(i => `
            <tr>
                <td><strong><a href="/app/item/${i.item_code}" target="_blank" style="color: var(--primary-color); text-decoration: none;">
            ${i.item_code}
        </a></strong></td>
                <td class="text-right">${flt(i.avail).toFixed(0)}</td>
                <td class="text-right text-pick-draft">${flt(i.draft_picks || 0).toFixed(0)}</td>
                <td class="text-right text-pick-sub">${flt(i.sub_picks || 0).toFixed(0)}</td>
                <td class="text-right" style="color:#d9534f; font-weight:700;">${flt(i.total_need).toFixed(0)}</td>
            </tr>`).join("");
        html += `
            <div style="font-weight: 600; margin-bottom: 5px; font-size: 12px; color: #777;">Inventory Status Overview</div>
            <div style="border: 1px solid #eee; border-radius: 4px; overflow-y: auto; max-height: 200px; margin-bottom: 15px;">
                <table class="table table-bordered table-sm m-0">
                    <thead><tr><th width="40%">Item</th><th class="text-right">In Stock</th><th class="text-right text-pick-draft">Draft</th><th class="text-right text-pick-sub">Sub</th><th class="text-right">Need</th></tr></thead>
                    <tbody>${sum_rows}</tbody>
                </table>
            </div>`;
    }

    // ── 2. SELECTION TABLE ──
    html += `
        <div class="d-flex justify-content-center mb-3">
            <input type="text" id="dialog-search-big" class="form-control" placeholder="🔍 Search Order, Item, Customer ID,Customer Name...">
        </div>
        <div style="max-height: 48vh; overflow-y: auto; border: 1px solid #ddd; border-radius: 6px;">
            <table class="table table-bordered table-hover m-0 dialog-table">
                <thead style="position: sticky; top: -1px; z-index: 10; background: #f8f9fa;"><tr>
                    <th width="45" class="text-center"><input type="checkbox" id="master-checkbox"></th>
                    <th width="32%">Sales Order / Item Info</th>
                    <th width="20%">Status</th>
                    <th width="33%">Purchase Orders</th>
                    <th width="12%" class="text-right">Qty</th>
                </tr></thead>
                <tbody id="so-main-tbody">
    `;

    sales_orders.forEach((so) => {
        const req = flt(so.qty) - flt(so.delivered_qty);
        const sub_picks = flt(so.pick_sub || 0);
        const draft_picks = flt(so.pick_draft || 0); // <--- ADDED DRAFT DEDUCTION
        const linked_po_qty = flt(so.linked_po_qty || 0);
        const to_buy = flt(Math.max(0, req - linked_po_qty - sub_picks - draft_picks), 2); // *** UPDATED MATH ***
        // Hard block, no override: a BOM row whose raw materials aren't
        // physically in stock yet (so.rm_in_stock, computed server-side in
        // get_pending_so_with_material_stock) can't be selected here even if
        // it otherwise still needs buying — re-checked again server-side in
        // validate_and_get_items_for_po so this can't be bypassed either.
        const rm_blocked = !!so.bom && so.rm_in_stock === false;
        const isDisabled = to_buy <= 0 || rm_blocked;
        const rm_shortage_title = rm_blocked
            ? (so.rm_shortage_items || []).map(s =>
                `${s.item_code}: needs ${flt(s.required_qty).toFixed(2)} ${s.uom}, only ${flt(s.available_qty).toFixed(2)} in stock`
              ).join('\n')
            : '';

        let linked_list = (so.linked_po_details || []).map(p => `
            <div class="po-detail-line">
                <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:75%">${get_link("Purchase Order", p.id)} <span class="sup-text">(${p.sup || 'N/A'})</span></span>
                <strong style="color: #1160b7;">${flt(p.qty).toFixed(0)}</strong>
            </div>
        `).join("");

        // "Other" collapses two very different situations that used to look
        // identical here: a PO with no Sales Order at all (unclaimed general
        // stock — could still end up covering this order) versus one already
        // earmarked for a SPECIFIC different Sales Order (spoken for, not
        // really up for grabs). Neither is netted into "Final" above either
        // way, but the reader needs to know which kind they're looking at
        // before deciding whether it's worth chasing for this order.
        let other_details_html = (so.other_po_list || []).map(p => `
            <div class="po-detail-line">
                <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:75%">
                    ${get_link("Purchase Order", p.id)} <span class="sup-text">(${p.sup || 'Stock'})</span>
                    <br><small style="color:${p.sales_order ? '#b45309' : '#059669'};">
                        ${p.sales_order
                            ? `Reserved for ${frappe.utils.escape_html(p.sales_order)}${p.so_customer_name ? ` (${frappe.utils.escape_html(p.so_customer_name)})` : ''}`
                            : 'Unclaimed general stock'}
                    </small>
                </span>
                <strong>${flt(p.qty).toFixed(0)}</strong>
            </div>
        `).join("");

        const other_sum_qty = flt(so.other_po_qty || 0);
        const other_general_qty = (so.other_po_list || [])
            .filter(p => !p.sales_order)
            .reduce((s, p) => s + flt(p.qty), 0);
        const other_reserved_qty = Math.max(0, other_sum_qty - other_general_qty);

        html += `
            <tr data-search-context="${`${so.sales_order} ${so.item_code} ${so.customer || ''} ${so.customer_name || ''} `.toLowerCase()}">
                <td class="text-center align-middle">
                    <input type="checkbox" class="row-selector" 
                    data-so="${so.sales_order}" data-item="${so.item_code}" data-max="${to_buy}" data-bom="${so.bom || ''}" 
                    ${isDisabled ? 'disabled' : ''} style="transform: scale(1.2);">
                </td>
                <td>
                    <!-- Sales Order Link -->
                    <div style="margin-bottom: 2px;">
                        <a href="/app/sales-order/${so.sales_order}" target="_blank" style="font-weight: 700; color: var(--text-color); text-decoration: none;">
                            ${so.sales_order}
                        </a>
                    </div>
                
                    <!-- Item Code Link -->
                    <div class="item-code-main">
                        <a href="/app/item/${so.item_code}" target="_blank" style="color: var(--primary-color); text-decoration: none;">
                            ${so.item_code}
                        </a>
                    </div>
                    ${rm_blocked ? `<span class="rm-req" title="${frappe.utils.escape_html(rm_shortage_title)}"><i class="fa fa-ban"></i> RM Not in Stock</span>` : ''}

                    <!-- Customer Link (Name + ID) -->
                    <div style="margin-top: 4px;">
                        <a href="/app/customer/${so.customer}" target="_blank" class="text-muted" style="font-size: 11px; text-decoration: none;">
                            <span style="color: #1a1a1a; font-weight: 500;">${so.customer_name || 'No Name'}</span> 
                            <br>
                            <small style="color: #8d99a6;">ID: ${so.customer}</small>
                        </a>
                    </div>
                </td>
                <td style="font-size:12px;">
                    <div class="d-flex justify-content-between mb-1"><span>Need:</span> <strong>${req.toFixed(0)}</strong></div>
                    <div class="d-flex justify-content-between text-pick-sub"><span>Picked (Sub):</span> <strong>${sub_picks.toFixed(0)}</strong></div>
                    <div class="d-flex justify-content-between text-pick-draft" style="font-size:11px; margin-top:-1px;"><span>Draft Pick:</span> <span>${draft_picks.toFixed(0)}</span></div>
                    <div class="d-flex justify-content-between" style="border-top:1px dashed #ccc; margin-top:5px; padding-top:4px;">
                        <span>Final:</span> <strong class="text-danger">${to_buy.toFixed(0)}</strong>
                    </div>
                </td>
                <td>
                    <div class="po-box-linked">
                        <div style="font-size: 10px; font-weight:700; color: #2980b9; margin-bottom: 2px;">PO LINKED TO THIS SO</div>
                        ${linked_list || '<small class="text-muted">None</small>'}
                    </div>
                    <div class="po-box-other">
                        <div style="font-size: 10px; font-weight:700; color: #7f8c8d; margin-bottom: 2px; display:flex; justify-content: space-between;"
                             title="Neither figure is counted toward this row's own Final need — general stock is unclaimed and could still help, reserved stock already belongs to a different Sales Order">
                            <span>OTHER PO: ${other_general_qty.toFixed(0)} Unclaimed${other_reserved_qty > 0 ? ` &middot; ${other_reserved_qty.toFixed(0)} Reserved Elsewhere` : ''}</span>
                            <span class="toggle-details-btn">View Details</span>
                        </div>
                        <div class="other-po-list-container">
                            ${other_details_html || '<div class="text-muted p-2">No other POs available</div>'}
                        </div>
                    </div>
                </td>
                <td class="text-right">
                    <input type="number" class="form-control qty-input-main" value="${to_buy}" max="${to_buy}" ${isDisabled ? 'disabled' : ''}>
                </td>
            </tr>`;
    });

    html += `</tbody></table></div></div>`;

    // ── DIALOG INVOCATION ──
    const d = new frappe.ui.Dialog({
        title: is_subcontracted ? "Subcontract Requirement Analysis" : "Procurement Requirement Analysis",
        size: "extra-large",
        fields: [{ fieldname: "html", fieldtype: "HTML", options: html }],
        primary_action_label: "Add to PO",
        primary_action: () => {
            const selected_rows = [];  // ← better name + declared at top

            d.$wrapper.find(".row-selector:checked").each(function () {
                const $row = $(this).closest("tr");
                const qty = flt($row.find(".qty-input-main").val());

                if (qty > 0) {
                    selected_rows.push({
                        salesOrder: $(this).data("so"),       // consistent casing
                        itemCode: $(this).data("item"),
                        pendingQty: qty,                      // match backend expectation
                        bom_no: $(this).data("bom") || "", // or bom
                        itemName: $row.find(".item-code-main").text().trim() // optional but helpful for rejection messages
                    });
                }
            });

            if (!selected_rows.length) {
                frappe.msgprint("No rows selected with valid quantity.");
                return;
            }

            frappe.call({
                method: "erp_dacsinc_custom.purchase_order.validate_and_get_items_for_po",
                args: {
                    selected_items: JSON.stringify(selected_rows),
                    is_subcontracted: frm.doc.is_subcontracted ? 1 : 0
                },
                freeze: true,
                freeze_message: "Validating and adding items...",
                callback: (r) => {
                    if (!r.message?.valid_items?.length) {
                        frappe.msgprint(__("No valid items could be added."));
                        return;
                    }
                    frm.clear_table("items");
                    if (r.message.rejected_items?.length) {
                        const msg = r.message.rejected_items
                            .map(i => `• ${i.item_name || i.item_code}: ${i.reason}`)
                            .join("\n");
                        frappe.msgprint({
                            title: __("Some items were rejected"),
                            message: msg,
                            indicator: "orange"
                        });
                    }

                    // Add valid rows to PO
                    r.message.valid_items.forEach(data => {
                        const row = frm.add_child("items");
                        Object.assign(row, data);           // faster than many set_value calls
                    });

                    frm.refresh_field("items");
                    frappe.show_alert({ message: __("{0} item(s) added", [r.message.valid_items.length]), indicator: "green" });
                }
            });

            d.hide();  // optional: close dialog immediately after submit
        }
    });

    d.show();
    d.$wrapper.find(".modal-dialog").css("max-width", "95vw");

    const $wrap = d.$wrapper;

    // Search Box Functionality
    $wrap.on("input", "#dialog-search-big", function () {
        const v = $(this).val().toLowerCase().trim();
        $wrap.find("#so-main-tbody tr").each(function () {
            $(this).toggle($(this).data("search-context").includes(v));
        });
    });

    // Dropdown Toggling Logic
    $wrap.on("click", ".toggle-details-btn", function () {
        const container = $(this).closest(".po-box-other").find('.other-po-list-container');
        container.slideToggle(200);
        const isOpen = $(this).text().includes("View");
        $(this).text(isOpen ? "Hide Details" : "View Details");
    });

    // Bulk selection and checkbox/qty logic
    $wrap.on("change", "#master-checkbox", function () {
        const checked = $(this).prop("checked");
        $wrap.find(".row-selector:visible:not(:disabled)").prop("checked", checked).trigger("change");
    });

    $wrap.on("change", ".row-selector", function () {
        const $chk = $(this), $in = $chk.closest("tr").find(".qty-input-main");
        if ($chk.prop("checked")) { if (flt($in.val()) === 0) $in.val($chk.data("max")); } else { $in.val(0); }
    });

    $wrap.on("input", ".qty-input-main", function () {
        const $r = $(this).closest("tr"), $c = $r.find(".row-selector"), val = flt($(this).val()), max = flt($c.data("max"));
        if (val > max) $(this).val(max);
        $c.prop("checked", val > 0).trigger("change");
    });
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
                    <span class="rm-prev-calc" style="font-family:monospace; font-size:9px; color:#888; margin-right:6px;">${required_for_1_unit.toFixed(2)}/unit</span>
                    <span class="rm-prev-stat status-text" style="color: #999;">Waiting...</span>
                </div>`;
            }).join('');
            rm_status_html = `<div style="max-height:80px; overflow-y:auto; padding-right:5px;">${preview_lines}</div>`;
        } else {
            rm_status_html = `<span class="text-muted" style="font-size:11px; font-style:italic;">No BOM Linked</span>`;
        }
        let supplier_search_text = [];

        // Check linked_po_details for supplier names/IDs
        if (so.linked_po_details) {
            so.linked_po_details.forEach(p => { if (p.sup) supplier_search_text.push(p.sup); });
        }

        // Check other_po_list for supplier names/IDs
        if (so.other_po_list) {
            so.other_po_list.forEach(p => { if (p.sup) supplier_search_text.push(p.sup); });
        }
        // Search Metadata attached to the row for filtering
        // const search_str = `${so.sales_order} ${so.item_code} ${so.item_name || ''} ${so.customer || ''} ${so.customer_name || ''}`.toLowerCase();
        const search_string = [
            so.sales_order,
            so.item_code,
            so.customer,         // ID
            so.customer_name,    // NEW: Name
            so.jobber_name,
            ...supplier_search_text // NEW: All Suppliers in this row
        ].join(" ").toLowerCase();

        return `<tr class="rm-so-row" data-idx="${idx}" data-search="${search_string}">
            <td class="text-center">
                <input type="checkbox" class="so-check" style="transform: scale(1.2); cursor: pointer;" >
            </td>
            <td>
                <div class="text-highlight">${get_link("Sales Order", so.sales_order)}</div>
                <div style="font-size:12px; color:#666;">${get_link("Item", so.item_code)}</div>
                <div style="font-size:11px; color:#999;">${get_link("Customer", so.customer)}</div>
                <div style="font-size:11px; color:#999;">${"Customer", so.customer_name}</div>
            </td>
            <td class="text-right text-muted">${flt(so.pending_qty, 2)}</td>
            <td class="text-right text-muted">${flt(so.picked_submitted, 2)} / ${flt(so.picked_draft, 2)}</td>
            <td class="text-right text-highlight" style="font-size: 14px;">${flt(so.qty_awaiting_pick, 2)} ${so.uom}</td>
            <td class="text-center">
                <input type="number" step="any" min="0" max="${flt(so.qty_awaiting_pick, 2)}"
                       class="form-control qty-input text-center fg-fulfill-input"
                       data-max="${flt(so.qty_awaiting_pick, 2)}" value="${so.qty_awaiting_pick}">
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
                        <th width="4%" class="text-center"><input type="checkbox" id="so-check-all" ></th>
                        <th width="28%">Order / Item</th>
                        <th width="10%" class="text-right">Org. Qty</th>
                        <th width="10%" class="text-right">Picked (S/D)</th>
                        <th width="12%" class="text-right">Remaining</th>
                        <th width="12%" class="text-center">Qty to Make</th>
                        <th width="24%" title="Per raw material: Need (this order's own qty-to-make × BOM ratio) versus what's already covered — this order's own stock/PO/MR share, plus anything genuinely unclaimed. Hover a status to see the full breakdown.">RM Availability Status</th>
                    </tr></thead>
                    <tbody>${fg_rows}</tbody>
                </table>
            </div>

            <!-- SECTION 2 HEADER -->
            <div class="d-flex justify-content-between align-items-center mb-2">
                <h6 style="text-transform: capitalize; letter-spacing: 0.5px; font-size: 14px; color: black; margin:0;">2. Raw Material Requirements (Consolidated)</h6>
                <div style="font-size: 14px; color: #666; font-style: italic;"
                     title="Consolidated across every Sales Order ticked in section 1 above. Untick an order there and this table recalculates immediately.">
                    Purchase = Required &minus; Effective (hover column headers for details)
                </div>
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

        dialog.$wrapper.find('.fg-fulfill-input').each(function () {
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
                            general_mr_coming: flt(rm.mr_general_qty),
                            required_qty: 0,
                            linked_po_qty_total: 0,
                            linked_mr_qty_total: 0,
                            po_refs: rm.existing_po_list || [],
                            mr_refs: rm.existing_mr_list || [],
                            breakdown: []
                        };
                    }
                    let req = fg_qty * flt(rm.bom_qty_per_unit);
                    consolidated_rms[rm.item_code].required_qty += req;
                    consolidated_rms[rm.item_code].linked_po_qty_total += flt(rm.ordered_linked_qty);
                    consolidated_rms[rm.item_code].linked_mr_qty_total += flt(rm.mr_linked_qty);
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
        if (!is_checked) {
            $row.find('.rm-prev-stat').text('Ignored')
                .attr('title', 'This Sales Order is unticked in the checkbox column, so it is not counted toward any raw material demand below.')
                .css('color', '#ccc');
            return;
        }

        $row.find('.rm-preview-line').each(function (i) {
            let $line = $(this);
            let base_bom = parseFloat($line.data('base-qty'));
            let total_rm_req = base_bom * fg_qty;
            let rm_data = so_data.raw_materials[i];
            let stock = flt(rm_data.available_qty);
            let linked_po = flt(rm_data.ordered_linked_qty);
            let general_po = flt(rm_data.incoming_general_qty);
            let linked_mr = flt(rm_data.mr_linked_qty);
            let general_mr = flt(rm_data.mr_general_qty);
            let coverage = stock + linked_po + general_po + linked_mr + general_mr;
            let shortfall = total_rm_req - coverage;

            $line.find('.rm-prev-calc').text(`${base_bom.toFixed(2)} x ${flt(fg_qty)} = ${total_rm_req.toFixed(2)}`);

            const coverage_note = `Need ${total_rm_req.toFixed(2)} ${rm_data.uom}\n`
                + `Stock: ${stock.toFixed(2)}\n`
                + `PO for this order: ${linked_po.toFixed(2)}\n`
                + `MR for this order: ${linked_mr.toFixed(2)}\n`
                + `Unclaimed PO (any order): ${general_po.toFixed(2)}\n`
                + `Unclaimed MR (any order): ${general_mr.toFixed(2)}\n`
                + `Total covered: ${coverage.toFixed(2)}`;

            if (shortfall > 0.001) {
                $line.find('.rm-prev-stat').html(`<span style="color:#d62222; font-weight:bold;" title="${coverage_note}">Short ${shortfall.toFixed(2)}</span>`);
            } else {
                $line.find('.rm-prev-stat').html(`<span style="color:#00994d;" title="${coverage_note}">Covered</span>`);
            }
        });
    }

    const render_rm_table = (rms) => {
        let html = `
            <table class="rm-dialog-table">
            <thead><tr>
                <th width="20%">Raw Material</th>
                <th width="12%" class="text-right" title="Sum of every TICKED Sales Order's own qty-to-make × BOM ratio for this raw material. See the breakdown lines under the number for exactly which orders contributed.">Required</th>
                <th width="12%" class="text-right" title="Physical stock on hand right now, across all warehouses.">Stock</th>
                <th width="12%" class="text-right" title="Only counts: (a) Purchase Orders/Material Requests raised specifically for the Sales Order(s) ticked above, and (b) genuinely unclaimed PO/MR quantity not tied to any Sales Order. A PO or MR dedicated to a DIFFERENT, unticked Sales Order is never included here.">Incoming (PO+MR)</th>
                <th width="12%" class="text-right" title="Stock + Incoming — everything this raw material's need can currently draw on.">Effective</th>
                <th width="20%">Existing Ref (PO/MR)</th>
                <th width="12%" class="text-right" style="background: #ebf8ff; border-bottom: 2px solid #5e64ff;" title="Required minus Effective — what's actually left to buy.">Purchase</th>
            </tr></thead>
            <tbody>`;

        if (Object.keys(rms).length === 0) {
            html += `<tr><td colspan="7" class="text-center p-3 text-muted">No Selection or No Requirements</td></tr>`;
        } else {
            Object.keys(rms).forEach(code => {
                let d = rms[code];
                let effective_stock = d.available_stock + d.linked_po_qty_total + d.general_po_coming
                    + d.linked_mr_qty_total + d.general_mr_coming;
                let purchase_rec = Math.max(0, d.required_qty - effective_stock);
                let safe_meta = JSON.stringify(d).replace(/'/g, "&#39;");

                let po_links = (d.po_refs || []).slice(0, 3)
                    .map(po => `<a href="/app/purchase-order/${encodeURIComponent(po)}" target="_blank" style="font-weight:bold; text-decoration:underline;">${po}</a>`)
                    .join(", ");
                let mr_links = (d.mr_refs || []).slice(0, 3)
                    .map(mr => `<a href="/app/material-request/${encodeURIComponent(mr.name)}" target="_blank"
                            style="font-weight:bold; text-decoration:underline; color:#6d28d9;">${mr.name}</a>
                            ${mr.docstatus == 1 ? '' : '<span style="font-size:8px; color:#ea580c;"> (Draft)</span>'}
                            <span style="font-size:8px; color:${mr.sales_order ? '#b45309' : '#059669'};">
                                (${mr.sales_order ? `for ${mr.sales_order}` : 'unclaimed'})
                            </span>`)
                    .join("<br>");
                let ref_links = [po_links, mr_links].filter(Boolean).join("<br>")
                    || '<span style="color:#cbd5e1;">—</span>';

                let calc_lines = (d.breakdown || []).map(b => {
                    let per_unit = flt(b.fg_qty) ? (flt(b.rm_qty) / flt(b.fg_qty)) : 0;
                    return `<div style="font-family:monospace; font-size:9px; color:#888;" title="${b.so} — ${b.fg}">
                        ${flt(b.fg_qty).toFixed(2)} &times; ${per_unit.toFixed(2)} = ${flt(b.rm_qty).toFixed(2)}</div>`;
                }).join('');

                html += `<tr data-item-code="${code}" data-meta='${safe_meta}'>
            <td><div class="text-highlight">${get_link("Item", code)}</div><small class="text-muted">${d.name}</small></td>
            <td class="text-right" style="font-weight:bold;">${d.required_qty.toFixed(2)}<div style="text-align:left;">${calc_lines}</div></td>
            <td class="text-right text-muted">${d.available_stock.toFixed(2)}</td>
            <td class="text-right text-primary">${(d.linked_po_qty_total + d.general_po_coming + d.linked_mr_qty_total + d.general_mr_coming).toFixed(2)}</td>
            <td class="text-right text-dark">${effective_stock.toFixed(2)}</td>
            <td style="font-size:10px;">${ref_links}</td>
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
        primary_action: function () {
            let to_add = [];
            let has_breakdown = frm.get_docfield("custom_rm_source_breakdown");

            dialog.$wrapper.find('.final-buy-input').each(function () {
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

            if (frm.doc.is_subcontracted) {
                frm.set_value('is_subcontracted', 0);
            }

            frappe.call({
                method: 'erp_dacsinc_custom.purchase_order.build_rm_purchase_rows',
                args: { rows: JSON.stringify(to_add) },
                freeze: true,
                freeze_message: __('Fetching item details…'),
                callback: (r) => {
                    const built_rows = r.message || [];
                    if (!built_rows.length) {
                        frappe.msgprint(__('No valid rows to add.'));
                        return;
                    }

                    frm.clear_table("items");
                    if (has_breakdown) frm.clear_table("custom_rm_source_breakdown");

                    built_rows.forEach(built => {
                        frm.add_child("items", built);

                        if (has_breakdown) {
                            const source = to_add.find(r => r.item_code === built.item_code);
                            (source && source.breakdown || []).forEach(b => {
                                frm.add_child("custom_rm_source_breakdown", {
                                    raw_material_item: built.item_code,
                                    source_sales_order: b.so,
                                    source_finished_good: b.fg,
                                    order_for_fg: b.fg_qty,
                                    order_for_rm: b.rm_qty
                                });
                            });
                        }
                    });

                    frm.refresh_field("items");
                    if (has_breakdown) frm.refresh_field("custom_rm_source_breakdown");
                    dialog.hide();
                }
            });
        }
    });

    dialog.show();
    dialog.$wrapper.find('.modal-dialog').css("min-width", "90%");

    // --- EVENTS & SEARCH LOGIC ---

    // 1. Search Functionality
    dialog.$wrapper.on('keyup', '#so-list-search', function () {
        let val = $(this).val().toLowerCase();

        dialog.$wrapper.find('.rm-so-row').each(function () {
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
    dialog.$wrapper.on('input change', '.fg-fulfill-input, .so-check', function () {
        if ($(this).hasClass('fg-fulfill-input')) {
            let val = parseFloat($(this).val());
            let max = parseFloat($(this).data('max'));
            if (val > max) $(this).val(max);
            $(this).closest('tr').find('.so-check').prop('checked', val > 0);
        }
        recalc_materials();
    });

    // 3. Select All (Filters to only Visible items if search is active)
    dialog.$wrapper.on('click', '#so-check-all', function () {
        let state = $(this).prop('checked');
        // Only target visible rows
        dialog.$wrapper.find('.rm-so-row:visible .so-check').prop('checked', state).trigger('change');
    });

    // Init
    setTimeout(recalc_materials, 500);
}

function show_stock_check_dialog(frm, materials, linked_subcontracting_docs) {
    let dialog;

    const qty_exceeds = (a, b) => flt(flt(a, 2) - flt(b, 2), 2) > 0;

    // Function to rebuild the HTML table inside the dialog
    const rebuild_table = (updated_materials) => {
        let all_stock_sufficient_for_supply = true;

        let table_rows = updated_materials.map((item, index) => {
            const required_qty = flt(item.required_qty, 2);
            const available_qty = flt(item.available_qty, 2);
            const required_qty_disp = flt(required_qty, 2);
            const available_qty_disp = flt(available_qty, 2);
            const qty_to_supply = flt(item.qty_to_supply !== undefined ? item.qty_to_supply : required_qty, 2);

            let supply_status_icon;
            let supply_input_class = '';
            if (qty_exceeds(qty_to_supply, available_qty)) {
                supply_status_icon = 'fa-times text-danger';
                supply_input_class = 'is-invalid';
                all_stock_sufficient_for_supply = false;
            } else if (qty_to_supply > 0) {
                supply_status_icon = 'fa-check text-success';
            } else {
                supply_status_icon = 'fa-minus text-muted';
            }

            return `<tr data-item-code="${item.item_code}">
                <td>${frappe.utils.get_form_link("Item", item.item_code, true)}</td>
                <td>${required_qty_disp} ${item.uom}</td>
                <td class="font-weight-bold ${qty_exceeds(required_qty, available_qty) ? 'text-danger' : ''}">${available_qty_disp} ${item.uom}</td>
                <td>
                    <div class="input-group" style="width: 140px;">
                        <div class="input-group-prepend">
                            <button class="btn btn-outline-secondary btn-sm btn-qty-change" data-action="minus" data-item-code="${item.item_code}">-</button>
                        </div>
                        <input type="number" class="form-control form-control-sm text-center qty-to-supply-input ${supply_input_class}" 
                               data-item-code="${item.item_code}" 
                               value="${qty_to_supply}" 
                               min="0" 
                               step="any">
                        <div class="input-group-append">
                            <button class="btn btn-outline-secondary btn-sm btn-qty-change" data-action="plus" data-item-code="${item.item_code}">+</button>
                        </div>
                    </div>
                </td>
                <td class="text-center status-icon"><i class="fa ${supply_status_icon}"></i></td>
            </tr>`;
        }).join('');

        let dialog_html = `<p>Review stock and specify quantities to supply. Adjust the "Qty to Supply" as needed.</p>
            <table class="table table-bordered table-sm">
                <thead class="thead-light"><tr>
                    <th>Raw Material</th>
                    <th>Required Qty</th>
                    <th>Available Qty</th>
                    <th style="width: 160px;">Qty to Supply to SCO</th>
                    <th>Supply Status</th>
                </tr></thead>
                <tbody>${table_rows}</tbody>
            </table>`;

        if (!all_stock_sufficient_for_supply) {
            dialog_html += `<div class="alert alert-warning error-msg"><b>Cannot Proceed:</b> "Qty to Supply" exceeds "Available Qty."</div>`;
        }

        dialog.fields_dict.stock_info.html(dialog_html);

        // --- IMPROVED EVENT HANDLERS ---

        const update_row_ui = (itemCode, newVal) => {
            const material = updated_materials.find(m => m.item_code === itemCode);
            const available = flt(material.available_qty, 2);
            const $row = $(dialog.body).find(`tr[data-item-code="${itemCode}"]`);
            const $input = $row.find('.qty-to-supply-input');
            const $iconBox = $row.find('.status-icon');

            // Update internal data
            material.qty_to_supply = newVal;

            // Update Icon and Classes dynamically without full refresh
            if (qty_exceeds(newVal, available)) {
                $iconBox.html('<i class="fa fa-times text-danger"></i>');
                $input.addClass('is-invalid');
            } else if (newVal > 0) {
                $iconBox.html('<i class="fa fa-check text-success"></i>');
                $input.removeClass('is-invalid');
            } else {
                $iconBox.html('<i class="fa fa-minus text-muted"></i>');
                $input.removeClass('is-invalid');
            }

            // Check if primary button should be disabled
            let any_error = updated_materials.some(m => qty_exceeds(m.qty_to_supply, m.available_qty));
            dialog.get_primary_btn().prop('disabled', any_error);
            $(dialog.body).find('.error-msg').toggle(any_error);
        };

        // Handle Manual Typing
        $(dialog.body).find('.qty-to-supply-input').on('input', function () {
            const itemCode = $(this).data('item-code');
            let val = flt($(this).val());
            update_row_ui(itemCode, val);
        });

        // Handle Plus/Minus Buttons
        $(dialog.body).find('.btn-qty-change').on('click', function () {
            const itemCode = $(this).data('item-code');
            const action = $(this).data('action');
            const $input = $(this).closest('.input-group').find('.qty-to-supply-input');
            let currentVal = flt($input.val());

            // Set the increment/frequency (e.g., 1 or 0.1)
            let step = 1;

            let newVal = (action === 'plus') ? currentVal + step : currentVal - step;
            if (newVal < 0) newVal = 0;

            // Update the input field visually
            $input.val(newVal);

            // Trigger the UI update logic
            update_row_ui(itemCode, newVal);
        });

        // Initial button state
        dialog.get_primary_btn().prop('disabled', !all_stock_sufficient_for_supply);
    };

    // Initial HTML structure while data loads
    const initial_html = `<div>Loading...</div>`;

    dialog = new frappe.ui.Dialog({
        title: __("Raw Material Stock Check & Planning"),
        size: "large",
        fields: [{
            fieldname: "stock_info",
            fieldtype: "HTML",
            options: initial_html
        }],

        primary_action_label: __("Create SCO & Material Transfer"),
        primary_action: function () {
            // Get the final material list with user-updated quantities for SUPPLY
            let final_materials_to_supply = [];
            let can_proceed_with_transfer = true; // Final check before sending to server

            $(dialog.body).find('input.qty-to-supply-input').each(function () {
                const itemCode = $(this).data('item-code');
                const suppliedQty = flt($(this).val());
                const materialData = materials.find(m => m.item_code === itemCode);
                const availableQty = materialData ? flt(materialData.available_qty, 2) : 0;

                if (qty_exceeds(suppliedQty, availableQty)) {
                    can_proceed_with_transfer = false;
                    frappe.show_alert({
                        message: __("Cannot transfer {0} of {1}. Only {2} is available.", [flt(suppliedQty, 2), itemCode, flt(availableQty, 2)]),
                        indicator: 'red'
                    }, 5);
                    return false; // Break .each loop
                }
                final_materials_to_supply.push({
                    item_code: itemCode,
                    qty_to_supply: suppliedQty
                });
            });

            if (!can_proceed_with_transfer) {
                return; // Stop the primary action if validation fails
            }

            frappe.call({
                method: "erp_dacsinc_custom.purchase_order.create_subcontracting_docs",
                args: {
                    purchase_order_name: frm.doc.name,
                    updated_materials_for_supply: JSON.stringify(final_materials_to_supply)
                },
                freeze: true,
                freeze_message: __("Creating Subcontracting Order and Stock Entry..."),
                callback: function (r) {
                    if (r.message && r.message.ste_name) {
                        dialog.hide();
                        frappe.show_alert({
                            message: __("Successfully Created Subcontracting Order and Stock Entry"),
                            indicator: 'green'
                        }, 5);
                        frm.refresh();
                    } else if (r.exc) {
                        frappe.show_alert({
                            message: __("Error creating documents: {0}", [r.exc]),
                            indicator: 'red'
                        }, 5);
                    }
                }
            });
        }
    });

    dialog.show();
    rebuild_table(JSON.parse(JSON.stringify(materials)));
}

function create_receipts_now(sco_name, items_to_receive, dialog_instance, frm) {
    frappe.call({
        method: "erp_dacsinc_custom.purchase_order.create_receipt_documents",
        args: {
            sco_name: sco_name,
            items_to_receive: JSON.stringify(items_to_receive)
        },
        freeze: true,
        freeze_message: __("Creating documents..."),
        callback: function (r) {
            if (r.message) {
                dialog_instance.hide();

                // Build a confirmation message with links to created documents
                let msg = __("<h4>Successfully Created:</h4>");
                if (r.message.scr_name) msg += `• ${r.message.scr_name} (Subcontracting Receipt)<br>`;
                if (r.message.pr_name) msg += `• ${r.message.pr_name} (Purchase Receipt - Normal)<br>`;
                if (r.message.se_name) msg += `• ${r.message.se_name} (Stock Entry - Extra FG)<br>`;
                if (r.message.extra_pr_name) msg += `• ${r.message.extra_pr_name} (Purchase Receipt - Extra Service)<br>`;

                frappe.show_alert({
                    message: msg,
                    indicator: 'green'
                }, 12);

                // Refresh the custom HTML dashboard to show new documents
                frm.refresh_field("custom_purchase_order_html");
                frm.refresh(); // Full form refresh to update statuses, etc.
            }
        }
    });
}

/**
 * Displays a dialog for receiving items against a Subcontracting Order.
 * It validates quantities against over-collection limits.
 * 
 * @param {object} frm - The current form object.
 * @param {string} sco_name - The name of the Subcontracting Order.
 * @param {object} linked_subcontracting_docs - Pass-through variable for potential refresh logic.
 */
/**
 * Displays a dialog for receiving items against a Subcontracting Order,
 * now with a clear "Max Receivable" column for user guidance.
 *
 * @param {object} frm - The current form object.
 * @param {string} sco_name - The name of the Subcontracting Order.
 */

function show_receive_items_dialog(frm, sco_name) {
    frappe.call({
        method: "erp_dacsinc_custom.purchase_order.get_pending_sco_items",
        args: { sco_name: sco_name },
        freeze: true,
        freeze_message: __("Fetching pending items..."),
        callback: function (r) {
            if (!r.message || !r.message.items || r.message.items.length === 0) {
                frappe.msgprint(__("No items are currently pending receipt for {0}", [sco_name]));
                frm.reload_doc();
                return;
            }

            const items = r.message.items;
            const allow_perc = r.message.allow_over_fg_perc || 0;

            // --- HTML Structure Updated with a new "Max Receivable" column ---
            let dialog_html = `
                <p class="text-muted small">
                    Enter the quantity of finished goods being received.<br>
                    Allowed over-collection: Up to <b>${allow_perc}%</b> above ordered qty (rounded up).
                </p>
                <table class="table table-bordered table-sm">
                    <thead class="thead-light">
                        <tr>
                            <th>Finished Good</th>
                            <th class="text-right">Ordered</th>
                            <th class="text-right">Received</th>
                            <th class="text-right" style="background-color: #e2f3ff;">Max Receivable</th>
                            <th style="width: 20%;">Qty to Receive</th>
                        </tr>
                    </thead>
                    <tbody>`;

            items.forEach(item => {
                const ordered_qty = flt(item.ordered_qty, 2);
                const received_qty = flt(item.received_qty, 2);
                const display_pending = Math.floor(item.pending_qty);

                // --- CALCULATION LOGIC ADDED ---
                // This logic mirrors the backend's ceiling (round up) rule.
                const total_allowed_exact = ordered_qty * (1 + (allow_perc / 100.0));
                const total_allowed_rounded = Math.ceil(total_allowed_exact);
                const max_receivable = flt(Math.max(0, total_allowed_rounded - received_qty), 2);

                dialog_html += `
                    <tr data-child-id="${item.name}">
                        <td>${item.item_name}</td>
                        <td class="text-right">${ordered_qty}</td>
                        <td class="text-right text-success">${received_qty}</td>
                        
                        <!-- NEW COLUMN DISPLAYING THE MAX ALLOWED QTY -->
                        <td class="text-right font-weight-bold" style="background-color: #f0f9ff;">${max_receivable}</td>
                        
                        <td>
                            <input type="number" step="1" min="0" class="form-control text-right"
                                   value="${display_pending}">
                        </td>
                    </tr>`;
            });
            dialog_html += '</tbody></table>';

            const dialog = new frappe.ui.Dialog({
                title: __("Receive Goods for SCO: {0}", [sco_name]),
                size: "large",
                fields: [{ fieldname: "items_html", fieldtype: "HTML", options: dialog_html }],
                primary_action_label: __("Validate and Proceed"),
                primary_action: function () {
                    let items_to_process = [];

                    dialog.$wrapper.find("tbody tr").each(function () {
                        let $row = $(this);
                        let qty = parseFloat($row.find("input").val().trim());
                        if (!isNaN(qty) && qty > 0) {
                            items_to_process.push({
                                name: $row.data("child-id"),
                                qty_to_receive: qty
                            });
                        }
                    });

                    if (items_to_process.length === 0) {
                        frappe.msgprint(__("Please enter a quantity greater than 0."));
                        return;
                    }

                    // Backend validation call (no changes here)
                    frappe.call({
                        method: "erp_dacsinc_custom.purchase_order.check_over_collection_limit",
                        args: {
                            sco_name: sco_name,
                            items_to_receive_json: JSON.stringify(items_to_process)
                        },
                        freeze: true,
                        freeze_message: __("Validating quantities..."),
                        callback: function (res) {
                            if (!res.message) {
                                frappe.msgprint(__("Validation check failed. Please try again."));
                                return;
                            }
                            const response = res.message;
                            if (response.block_action) {
                                frappe.msgprint({ title: __("Limit Exceeded"), indicator: 'red', message: response.error_msg });
                                return;
                            }
                            if (response.has_extra) {
                                frappe.confirm(response.confirm_msg,
                                    () => create_receipts_now(sco_name, items_to_process, dialog, frm),
                                    () => { } // Do nothing on "No"
                                );
                            } else {
                                create_receipts_now(sco_name, items_to_process, dialog, frm);
                            }
                        }
                    });
                }
            });
            dialog.show();
        }
    });
}

function call_create_receipts(sco_name, items_to_receive, dialog) {
    frappe.call({
        method: "erp_dacsinc_custom.purchase_order.create_receipt_documents",
        args: {
            sco_name: sco_name,
            items_to_receive: JSON.stringify(items_to_receive)
        },
        freeze: true,
        freeze_message: __("Creating Purchase Receipts"),
        callback: function (r) {
            if (r.message && r.message.pr_name && r.message.scr_name) {
                dialog.hide();

                frappe.show_alert({
                    message: __("Successfully Created:<br>• {0} (Subcon Receipt)<br>• {1} (Purchase Receipt)",
                        [r.message.scr_name, r.message.pr_name]),
                    indicator: 'green'
                }, 7);

                frm.refresh_field("custom_purchase_order_html");
                frm.refresh();
                render_linked_docs_html(frm, linked_subcontracting_docs)
            }
        }
    });
}

function render_linked_docs_html(frm, docs) {
    const wrapper = frm.fields_dict.custom_purchase_order_html.$wrapper;
    wrapper.empty();

    const hasData = docs && Object.keys(docs).some(key => docs[key] && docs[key].length > 0);

    if (!hasData) {
        wrapper.html(`<div class="text-muted p-4 text-center">No linked subcontracting documents found.</div>`);
        return;
    }

    const currency = frm.doc.currency || "";

    const styles = `
        <style>
            .sc-dashboard { background:#fff; border:1px solid #d1d8dd; border-radius:8px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.05); }
            .sc-nav { display: flex; background:#f7fafc; border-bottom:1px solid #e2e8f0; overflow-x: auto; white-space: nowrap; }
            .sc-nav-item { padding: 12px 18px; color: #64748b; font-size:13px; font-weight:600; cursor:pointer; border-bottom:3px solid transparent; transition:0.2s; display:inline-flex; align-items:center;}
            .sc-nav-item:hover { background:#f1f5f9; color:#334155; }
            .sc-nav-item.active { background:#fff; color:#2563eb; border-bottom-color:#2563eb; }
            .sc-badge-count { background:#e2e8f0; color:#475569; padding:2px 8px; border-radius:12px; font-size:10px; margin-left:8px; }
            .sc-nav-item.active .sc-badge-count { background:#dbeafe; color:#1e40af; }
            .sc-content { padding: 0; display:none; animation: fadeIn 0.2s; }
            .sc-content.active { display:block; }
            @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
            .sc-table { width:100%; border-collapse: collapse; font-size:13px; table-layout: fixed; }
            .sc-table th { text-align:left; background:#f8fafc; padding:10px 15px; color:#64748b; font-weight:600; font-size:11px;  border-bottom:1px solid #e2e8f0; }
            .sc-table td { padding:12px 15px; border-bottom:1px solid #f1f5f9; vertical-align:middle; overflow: hidden; text-overflow: ellipsis; }
            .sc-table tr:last-child td { border-bottom:none; }
            .sc-link { font-weight:600; color:#2563eb; }
            .badge-extra { background:#fff7ed; color:#c2410c; border:1px solid #ffedd5; font-size:9px; font-weight:700; padding:1px 5px; border-radius:4px; margin-left:6px;  }
            .status-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
            .dot-green { background:#10b981; } .dot-gray { background:#94a3b8; } .dot-orange { background:#f59e0b; }
            .item-list { max-height:100px; overflow-y:auto; border-left: 2px solid #f1f5f9; padding-left: 8px; }
            .item-row { display:flex; justify-content:space-between; font-size:11px; margin-bottom: 2px; }
            .btn-print-sc { padding: 2px 6px; font-size: 10px; color: #64748b; border: 1px solid #d1d8dd; background: #fff; border-radius: 4px; cursor: pointer; }
            .btn-print-sc:hover { background: #f8fafc; color: #2563eb; border-color: #2563eb; }
        </style>
    `;

    const config = {
        ewo: { label: "Embroidery", icon: "fa fa-cog", doctype: "Embroidery Work Order" },
        sco: { label: "Orders (SCO)", icon: "fa fa-truck", doctype: "Subcontracting Order" },
        ste: { label: "Stock Entries", icon: "fa fa-exchange-alt", doctype: "Stock Entry" },
        scr: { label: "Receipts", icon: "fa fa-boxes", doctype: "Subcontracting Receipt" },
        pr: { label: "Payments (PR)", icon: "fa fa-file-invoice", doctype: "Purchase Receipt" },
        pi: { label: "Invoices", icon: "fa fa-file-invoice-dollar", doctype: "Purchase Invoice" }
    };

    const columns = {
        ewo: ["ID", "Items", "Stage", "Status", "Print"],
        sco: ["ID", "Items", "Total", "Status"],
        ste: ["ID", "Items", "Type", "Date"],
        scr: ["ID", "Items", "Status", "Date"],
        pr: ["ID", "Items", "Total", "Status"],
        pi: ["ID", "Items", "Due Date", "Status"]
    };

    let navItems = "", tabsContent = "", activeSet = false;

    for (const [key, conf] of Object.entries(config)) {
        let rawRowsData = docs[key] || [];

        // --- FIX: Deduplicate logic starts here ---
        // We use a Map keyed by the document 'name' to ensure each doc is only listed once.
        const uniqueDocsMap = new Map();
        rawRowsData.forEach(d => {
            if (!uniqueDocsMap.has(d.name)) {
                uniqueDocsMap.set(d.name, d);
            }
        });
        const rowsData = Array.from(uniqueDocsMap.values());
        // --- End Fix ---

        if (rowsData.length > 0) {
            const isFirst = !activeSet;
            const activeClass = isFirst ? "active" : "";
            if (isFirst) activeSet = true;

            navItems += `<div class="sc-nav-item ${activeClass}" data-target="${key}">
                            <i class="${conf.icon}" style="margin-right:6px;"></i> ${conf.label}
                            <span class="sc-badge-count">${rowsData.length}</span>
                         </div>`;

            let tableRows = "";
            rowsData.forEach(doc => {
                let badge = (doc.custom_extra_fg_collect_from_jobbers || doc.is_extra) ? `<span class="badge-extra">Extra</span>` : "";
                const docTypeSlug = frappe.router.slug(conf.doctype);
                let col1 = `<a href="/app/${docTypeSlug}/${doc.name}" class="sc-link" target="_blank">${doc.name}</a>${badge}`;

                let middleCols = "";
                columns[key].slice(1).forEach(col => {
                    let cellContent = '--';
                    if (col === 'Items') {
                        cellContent = generateItemsHtml(doc.items);
                    } else if (col === 'Total') {
                        cellContent = (doc.total || doc.rounded_total) ? frappe.format(doc.total || doc.rounded_total, { type: 'Currency', currency: currency }) : '--';
                    } else if (col === 'Status') {
                        cellContent = `${getStatusDot(doc.status)} ${doc.status}`;
                    } else if (col.includes('Date')) {
                        cellContent = doc.posting_date || doc.due_date ? frappe.datetime.str_to_user(doc.posting_date || doc.due_date) : '--';
                    } else if (col === 'Type') {
                        cellContent = doc.stock_entry_type || '--';
                    } else if (col === 'Stage') {
                        cellContent = doc.panel_stage || doc.stage || 'Pending';
                    } else if (col === 'Print') {
                        cellContent = `<button class="btn-print-sc btn-print-ewo" data-name="${doc.name}">
                                            <i class="fa fa-print"></i>
                                       </button>`;
                    }
                    middleCols += `<td>${cellContent}</td>`;
                });

                tableRows += `<tr><td width="20%">${col1}</td>${middleCols}</tr>`;
            });

            tabsContent += `
                <div class="sc-content ${activeClass}" id="sc-tab-${key}">
                    <table class="sc-table">
                        <thead>
                            <tr>
                                ${columns[key].map(h => {
                let width = h === 'Items' ? '50%' : 'auto';
                if (h === 'ID') width = '20%';
                return `<th style="width:${width}">${h}</th>`;
            }).join('')}
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                </div>
            `;
        }
    }

    const html = `${styles}<div class="sc-dashboard"><div class="sc-nav">${navItems}</div><div class="sc-body">${tabsContent}</div></div>`;
    wrapper.html(html);

    wrapper.find('.sc-nav-item').on('click', function () {
        wrapper.find('.sc-nav-item').removeClass('active');
        $(this).addClass('active');
        const target = $(this).data('target');
        wrapper.find('.sc-content').removeClass('active');
        wrapper.find(`#sc-tab-${target}`).addClass('active');
    });
    // Click handler to open PDF directly
    wrapper.find('.btn-print-ewo').on('click', function (e) {
        e.preventDefault();
        e.stopPropagation();

        const docname = $(this).data('name');
        const doctype = "Embroidery Work Order";
        const format = "Embroidery Work Order Print Format";

        // Construct the direct PDF URL
        const pdfUrl = `/api/method/frappe.utils.print_format.download_pdf?` +
            `doctype=${encodeURIComponent(doctype)}` +
            `&name=${encodeURIComponent(docname)}` +
            `&format=${encodeURIComponent(format)}` +
            `&no_letterhead=1` +
            `&letterhead=${encodeURIComponent("No Letterhead")}` +
            `&_lang=${frappe.boot.lang}`;

        // Open in a new tab to trigger the PDF viewer/download
        window.open(pdfUrl, '_blank');
    });

    function generateItemsHtml(items) {
        if (!items || !items.length) return '--';
        let h = '<div class="item-list">';
        items.forEach(i => {
            // Correct quantity display based on field existence
            let qtyStr = flt(i.qty ? i.qty : (i.stock_qty || 0), 2);
            let qtyInfo = (i.received_qty != null) ? `Ord:${flt(i.ordered_qty, 2) || qtyStr}, Rec:${flt(i.received_qty, 2)}` : `Qty: ${qtyStr}`;
            h += `<div class="item-row"><span style="flex:1;">${i.item_code}</span><span style="color:#64748b;">${qtyInfo}</span></div>`;
        });
        return h + '</div>';
    }

    function getStatusDot(status) {
        let cls = 'dot-gray';
        if (['Completed', 'Paid', 'Received', 'Submitted'].includes(status)) cls = 'dot-green';
        if (['Partially Received', 'Unpaid', 'To Pay', 'To Receive'].includes(status)) cls = 'dot-orange';
        return `<span class="status-dot ${cls}"></span>`;
    }
}

function show_receive_embroidery_dialog(frm, ewo_name) {
    frappe.call({
        method: "erp_dacsinc_custom.purchase_order.get_pending_ewo_items",
        args: { ewo_name: ewo_name },
        callback: function (r) {
            if (!r.message || r.message.length === 0) {
                frappe.msgprint(__("This Embroidery Work Order is fully received. Please refresh."));
                frm.refresh();
                return;
            }

            let dialog_html = `
                <p class="text-muted">Enter quantities received back from embroiderer for <strong>${ewo_name}</strong>.</p>
                <table class="table table-bordered table-sm">
                    <thead class="thead-light">
                        <tr>
                            <th>Item</th>
                            <th class="text-right">Ordered</th>
                            <th class="text-right">Received</th>
                            <th class="text-right">Pending</th>
                            <th style="width: 20%;">Qty to Receive</th>
                        </tr>
                    </thead>
                    <tbody>`;
            r.message.forEach(item => {
                const pending_qty = flt(item.pending_qty, 2);
                dialog_html += `
                    <tr data-child-id="${item.child_id}">
                        <td>${item.item_name} <br><small class="text-muted">${item.item_code}</small></td>
                        <td class="text-right">${flt(item.ordered_qty, 2)}</td>
                        <td class="text-right text-success">${flt(item.previously_received_qty, 2)}</td>
                        <td class="text-right text-danger">${pending_qty}</td>
                        <td><input type="number" class="form-control text-right" data-max="${pending_qty}" value="${pending_qty}"></td>
                    </tr>`;
            });
            dialog_html += `</tbody></table>`;

            const dialog = new frappe.ui.Dialog({
                title: __("Receive Embroidery Items"),
                size: "extra-large",
                fields: [{ fieldname: "html", fieldtype: "HTML", options: dialog_html }],
                primary_action_label: __("Receive Items"),
                primary_action: function () {
                    // ... (primary action logic remains the same as before) ...
                    let items_to_receive = [];
                    this.$wrapper.find("tbody tr").each(function () {
                        const row = $(this);
                        const qty = parseFloat(row.find("input[type='number']").val()) || 0;
                        if (qty > 0) {
                            items_to_receive.push({
                                child_id: row.data("child-id"),
                                qty_to_receive: qty
                            });
                        }
                    });
                    if (items_to_receive.length === 0) {
                        frappe.msgprint(__("Please enter a quantity to receive."));
                        return;
                    }
                    frappe.call({
                        method: "erp_dacsinc_custom.purchase_order.receive_embroidery_items",
                        args: { ewo_name: ewo_name, items_to_receive: JSON.stringify(items_to_receive) },
                        freeze: true,
                        callback: () => { this.hide(); frm.refresh(); }
                    });
                }
            });

            // Add quantity validation
            dialog.$wrapper.on('input', 'input[type="number"]', function () {
                const $input = $(this);
                const max_val = parseFloat($input.data('max'));
                if (parseFloat($input.val()) > max_val) $input.val(max_val);
                if (parseFloat($input.val()) < 0) $input.val(0);
            });

            dialog.show();
        }
    });

}

// ----------------------------------------------------------------------------------
// --- MATERIAL REQUEST PLANNERS ---
// ----------------------------------------------------------------------------------

function apply_supplier_filter(frm) {
    frm.set_query("supplier", function () {
        return { filters: frm.doc.is_subcontracted ? { "custom_is_jobber": 1 } : {} };
    });
}

function load_mr_suggestions(frm) {
    frappe.dom.freeze(__('Fetching Procurement Demands...'));
    frappe.call({
        method: 'erp_dacsinc_custom.purchase_order.get_mr_suggestions_for_po',
        callback: function (r) {
            frappe.dom.unfreeze();
            if (r.message && r.message.length > 0) {
                render_smart_po_dialog(frm, r.message);
            } else {
                frappe.msgprint(__('No pending Material Request items found.'));
            }
        }
    });
}

function render_smart_po_dialog(frm, raw_data) {
    let grouped = {};
    raw_data.forEach(d => {
        let key = d.item_code;
        if (!grouped[key]) {
            grouped[key] = {
                item_code: d.item_code, item_name: d.item_name, uom: d.uom,
                total_mr_qty: 0, ordered_qty: 0, total_pending: 0, origins: []
            };
        }
        grouped[key].total_mr_qty += flt(d.mr_total_qty);
        grouped[key].ordered_qty += flt(d.ordered_qty);
        grouped[key].total_pending += flt(d.pending_qty);
        grouped[key].origins.push(d);
    });
    Object.values(grouped).forEach(g => {
        g.total_mr_qty = flt(g.total_mr_qty, 2);
        g.ordered_qty = flt(g.ordered_qty, 2);
        g.total_pending = flt(g.total_pending, 2);
    });

    let data = Object.values(grouped);

    let d = new frappe.ui.Dialog({
        title: `<h3><i class="fa fa-shopping-basket" style="color: #6366f1;"></i> ${__('Procurement Fulfillment Planner')}</h3>`,
        size: 'extra-large',
        fields: [
            { fieldtype: 'Data', fieldname: 'search', placeholder: __('Search by Item, MR ID, SO ID, Customer, or Supplier...') },
            { fieldtype: 'HTML', fieldname: 'table_html' }
        ],
        primary_action_label: __('Update Purchase Order'),
        primary_action: function () { submit_to_po(d, frm, data); }
    });

    d.selected_keys = new Set();

    const render_table = () => {
        let q = (d.get_value('search') || "").toLowerCase();
        let styles = `
            <style>
                .modal-body { padding: 12px 15px !important; }
                .planner-table { width: 100%; border-collapse: separate; border-spacing: 0 8px; font-size: 12.5px; table-layout: fixed; }
                .planner-row { background: #fff; border: 1px solid #ebedef; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.03); }
                .planner-row td { padding: 12px; vertical-align: middle; overflow: hidden; }
                .row-selected { border-color: #3b82f6 !important; background-color: #f5faff !important; }
                .link-item { font-weight: 700; color: #1e293b; font-size: 13.5px; text-decoration: none !important; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;}
                .badge-flex { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
                .pill { padding: 3px 8px; border-radius: 4px; font-size: 10.5px; font-weight: 700; border: 1px solid transparent; text-decoration: none !important; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; display: inline-block;}
                .mr-pill { background: #fffbeb; color: #92400e; border-color: #fef3c7; }
                .so-pill { background: #ecfdf5; color: #065f46; border-color: #d1fae5; }
                .po-pill { background: #eff6ff; color: #1e40af; border-color: #bfdbfe; }
                .track-lbl { font-size: 9.5px; font-weight: 800; color: #94a3b8; margin-bottom: 2px; }
                .sum-card { background: #f8fafc; padding: 8px 10px; border-radius: 6px; border: 1px solid #f1f5f9; width: 115px; margin-left: auto; }
                .sum-line { display: flex; justify-content: space-between; font-size: 10.5px; font-weight: 700; margin-bottom: 2px;}
                .qty-inp { width: 85px; text-align: center; border: 1px solid #d1d5db; font-weight: 800; color: #c2410c; border-radius: 6px; height: 35px; font-size: 15px; }
            </style>`;

        let html = styles + `<div style="max-height: 65vh; overflow-y: auto;"><table class="planner-table">
            <thead><tr style="color: #80848a; font-size: 11px; font-weight: 800;">
                <th style="width: 45px;" class="text-center"><input type="checkbox" id="master-chk"></th>
                <th style="width: 25%;">${__('Item Identity')}</th>
                <th style="width: 45%;">${__('Fulfillment Traceability (Links)')}</th>
                <th style="width: 18%; text-align: right; padding-right: 15px;">${__('Stock Summary')}</th>
                <th style="width: 115px; text-align: right;">${__('Order Now')}</th>
            </tr></thead><tbody>`;

        data.forEach((row) => {
            const unique_mrs = [...new Set(row.origins.map(o => o.mr_id))];

            // Generate link pills and gather text for searching
            let meta_search_pool = [];

            const so_links = row.origins.filter(o => o.sales_order).map(o => {
                meta_search_pool.push(o.sales_order, o.customer_name, o.mr_id);
                return `<a href="/app/sales-order/${o.sales_order}" target="_blank" class="pill so-pill" title="${o.sales_order} • ${o.customer_name}">${o.sales_order} • ${o.customer_name}</a>`;
            });
            const distinct_so_links = [...new Set(so_links)];

            const prev_po_links = row.origins.flatMap(o => o.previous_po_history.map(p => {
                meta_search_pool.push(p.po_id, p.supplier_name);
                return `<a href="/app/purchase-order/${p.po_id}" target="_blank" class="pill po-pill" title="${p.supplier_name} • #${p.po_id}">${p.supplier_name} • #${p.po_id}</a>`;
            }));
            const distinct_po_links = [...new Set(prev_po_links)];

            // COMPREHENSIVE SEARCH LOGIC
            let search_str = `${row.item_code} ${row.item_name} ${meta_search_pool.join(' ')}`.toLowerCase();
            if (q && !search_str.includes(q)) return;

            const is_selected = d.selected_keys.has(row.item_code);

            html += `<tr class="planner-row ${is_selected ? 'row-selected' : ''}" data-key="${row.item_code}">
                <td class="text-center"><input type="checkbox" class="row-chk" data-key="${row.item_code}" ${is_selected ? 'checked' : ''}></td>
                <td>
                    <a href="/app/item/${row.item_code}" target="_blank" class="link-item">${row.item_code}</a>
                    <div style="font-size:10.5px; color:#64748b; line-height: 1.4;">${row.item_name}</div>
                </td>
                <td>
                    <div class="track-lbl">${__('Open Material Requests')}</div>
                    <div class="badge-flex" style="margin-bottom:8px;">${unique_mrs.map(id => `<a href="/app/material-request/${id}" target="_blank" class="pill mr-pill">${id}</a>`).join('')}</div>
                    <div style="display:flex; width: 100%; gap: 15px;">
                        <div style="width:50%;"><div class="track-lbl">${__('Sales Orders / Customers')}</div><div class="badge-flex">${distinct_so_links.join('') || '<span style="font-size:10px; color:#cbd5e1;">Stock Buffer</span>'}</div></div>
                        <div style="width:50%;"><div class="track-lbl">${__('Prior Order History')}</div><div class="badge-flex">${distinct_po_links.join('') || '<span style="font-size:10px; color:#cbd5e1;">None</span>'}</div></div>
                    </div>
                </td>
                <td>
                    <div class="sum-card">
                        <div class="sum-line" style="color:#64748b;"><span>Original:</span><span>${row.total_mr_qty}</span></div>
                        <div class="sum-line" style="color:#ef4444; border-bottom: 1px solid #ebedef; padding-bottom: 3px;"><span>Previous:</span><span>-${row.ordered_qty}</span></div>
                        <div class="sum-line" style="color:#3b82f6; padding-top:3px; font-size:11px;"><span>Net Due:</span><span>${row.total_pending}</span></div>
                    </div>
                </td>
                <td class="text-right"><input type="number" min="0" class="qty-inp row-qty" data-key="${row.item_code}" value="${row.total_pending}"></td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
        d.get_field('table_html').$wrapper.html(html);

        // Bind Row Handlers
        d.$wrapper.find('.row-chk').on('change', function () {
            let k = $(this).data('key');
            if (this.checked) d.selected_keys.add(k); else d.selected_keys.delete(k);
            $(this).closest('tr').toggleClass('row-selected', this.checked);
        });

        d.$wrapper.find('#master-chk').on('change', function () {
            let active = this.checked;
            d.$wrapper.find('.row-chk:visible').each(function () {
                $(this).prop('checked', active).trigger('change');
            });
        });
    };

    d.fields_dict.search.$input.on('keyup', () => render_table());
    d.show();
    render_table();
}

function submit_to_po(d, frm, data) {
    let to_add = [];
    data.forEach(group => {
        if (d.selected_keys.has(group.item_code)) {
            let user_qty = flt(d.$wrapper.find(`.row-qty[data-key="${group.item_code}"]`).val());
            let multiplier = group.total_pending > 0 ? (user_qty / group.total_pending) : 0;
            if (multiplier > 0) {
                group.origins.forEach(l => {
                    to_add.push({
                        item_code: l.item_code, qty: flt(l.pending_qty * multiplier),
                        warehouse: l.warehouse, uom: l.uom,
                        material_request: l.mr_id, material_request_item: l.mr_item_id,
                        sales_order: l.sales_order, description: `Source Trace: MR ${l.mr_id} | ${l.sales_order || ''}`
                    });
                });
            }
        }
    });

    if (to_add.length === 0) return frappe.msgprint("Please select rows to process.");

    frm.clear_table('items');
    to_add.forEach(l => {
        let child = frm.add_child('items');
        frappe.model.set_value(child.doctype, child.name, 'item_code', l.item_code);
        frappe.model.set_value(child.doctype, child.name, 'qty', l.qty);
        frappe.model.set_value(child.doctype, child.name, 'warehouse', l.warehouse);
        frappe.model.set_value(child.doctype, child.name, 'material_request', l.material_request);
        frappe.model.set_value(child.doctype, child.name, 'material_request_item', l.material_request_item);
        frappe.model.set_value(child.doctype, child.name, 'sales_order', l.sales_order);
        frappe.model.set_value(child.doctype, child.name, 'description', l.description);
    });
    frm.refresh_field('items');
    d.hide();
}
