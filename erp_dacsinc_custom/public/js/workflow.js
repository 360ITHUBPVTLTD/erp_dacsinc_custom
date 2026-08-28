class WorkflowOverride extends frappe.ui.form.States {
    show_actions() {
        // console.log("WorkflowOverride: show_actions() executed"); // Add log
        let added = false;
        const me = this;

        if (this.frm.doc.__unsaved === 1) {
            // console.log("Document is unsaved, skipping workflow actions.");
            return;
        }

        frappe.workflow.get_transitions(this.frm.doc).then((transitions) => {
            // console.log("Available transitions:", transitions);
            this.frm.page.clear_actions_menu();
            transitions.forEach((d) => {

                // console.log("Checking transition:", d.action);
                if (frappe.user_roles.includes(d.allowed)) {
                    // console.log("User has access to transition:", d.action);
                    added = true;
                    me.frm.page.add_action_item(__(d.action), function () {
                        // console.log("Workflow action triggered:", d.action);
                        if (me.frm.doc.doctype === "Lead") {
                            frappe.confirm(
                                __(`Are you sure you want to proceed with ${d.action}?`),
                                () => {
                                    // console.log("User confirmed:", d.action);
                                    
                                 



                                    if (d.action === "Move to Order") {
                                        let p = frappe.prompt([ 
                                            {
                                                fieldtype: 'Currency',
                                                label: __('PO Value'),
                                                fieldname: 'po_value',
                                                reqd: 1
                                            },
                                           
                                        ], function (values) {
                                            let lead_id = me.frm.doc.name; // Get current Lead ID

                                            me.frm.set_value('custom_po_value', values.po_value);
                                            me.frm.set_value('custom_lead_type', 'WON');
                                            me.frm.save().then(() => {
                                                me.apply_workflow_action(d);
                                               

                                            });

                                        }, __('Enter PO Value'));
                                        if (p && p.$wrapper) {
                                            p.$wrapper.addClass('dac-wide-modal');
                                        }    // Title for the prompt
                                    }





                                    else if (d.action === "Lost Enquiry") {
                                        let p = frappe.prompt([
                                            {
                                                fieldtype: 'Link',
                                                options: 'Lost Enquiry Reasons',  // Corrected from 'Option' to 'options'
                                                label: __('Reason for Unqualified Lead'),
                                                fieldname: 'lost_reason',
                                                reqd: 1
                                            },
                                            {
                                                fieldtype: 'Text',
                                                label: __('Reason for Unqualified Lead Description'),
                                                fieldname: 'lost_reason_description',
                                                reqd: 1
                                            }
                                        ], function (values) {
                                            let lead_id = me.frm.doc.name; // Get current Lead ID

                                            me.frm.set_value('custom_lost_enquiry_reason', values.lost_reason);
                                            me.frm.set_value('custom_lost_enquiry_description', values.lost_reason_description);
                                            me.frm.set_value('custom_lead_type', 'LOST');
                                            me.frm.save().then(() => {
                                                me.apply_workflow_action(d);
                                               

                                            });

                                        }, __('Enter Lost Enquiry Reason'));
                                        if (p && p.$wrapper) {
                                            p.$wrapper.addClass('dac-wide-modal');
                                        }  // Title for the prompt
                                    }
   
                                    else if (d.action === "Lost Pipeline") {
                                        let p = frappe.prompt([
                                            {
                                                fieldtype: 'Link',
                                                options: 'Quotation Lost Reason',  // Corrected from 'Option' to 'options'
                                                label: __('Reason for Lost'),
                                                fieldname: 'lost_reason',
                                                reqd: 1
                                            },
                                            {
                                                fieldtype: 'Text',
                                                label: __('Reason for Lost Description'),
                                                fieldname: 'lost_reason_description',
                                                reqd: 1
                                            }
                                        ], function (values) {
                                            let lead_id = me.frm.doc.name; // Get current Lead ID

                                            me.frm.set_value('custom_lost_pipeline_reason', values.lost_reason);
                                            me.frm.set_value('custom_lost_pipeline_description', values.lost_reason_description);
                                            me.frm.set_value('custom_lead_type', 'LOST');
                                            me.frm.save().then(() => {
                                                me.apply_workflow_action(d);
                                                

                                            });

                                        }, __('Enter Lost Pipeline'));
                                        if (p && p.$wrapper) {
                                            p.$wrapper.addClass('dac-wide-modal');
                                        }  // Title for the prompt
                                    }
                                    

                                    else if (d.action === "Reset Lead Status") {
                                        // Clear the specific fields
                                        me.frm.set_value('custom_po_value', '');
                                        me.frm.set_value('custom_lost_pipeline_reason', '');
                                        me.frm.set_value('custom_lost_pipeline_description', '');
                                        me.frm.set_value('custom_lost_enquiry_reason', '');
                                        me.frm.set_value('custom_lost_enquiry_description', '');

                                        // Save the document first
                                        me.frm.save().then(() => {
                                            // Then apply the workflow action
                                            me.apply_workflow_action(d);
                                        });
                                    }


                                    else {
                                        me.apply_workflow_action(d);
                                    }
                                },
                                () => {
                                    // console.log("Workflow action cancelled by the user.");
                                }
                            );
                        } 
                       
                        
                        
                        else if (me.frm.doc.doctype === "Sales Order") {
                            if (d.action === "Reject" || d.action.toLowerCase().includes("reject")) {
                                frappe.prompt([
                                    {
                                        fieldtype: 'Small Text',
                                        fieldname: 'comment',
                                        label: __('Reason for Rejection'),
                                        reqd: 1
                                    }
                                ], (values) => {
                                    frappe.call({
                                        method: 'erp_dacsinc_custom.order_flow_api.reject_sales_orders',
                                        args: {
                                            sales_orders: [me.frm.doc.name],
                                            comment: values.comment
                                        }
                                    }).then(() => {
                                        frappe.show_alert({message: __('Sales Order Rejected successfully'), color: 'green'});
                                        me.frm.reload_doc();
                                    });
                                }, __('Enter Rejection Comment'));
                            } else if (d.action === "Approve" || (d.action === "Submit for Merchandiser Approval" && frappe.user_roles.includes("Merchandiser User"))) {
                                if (me.frm.doc.workflow_state === "Draft" || me.frm.doc.workflow_state === "Rejected" || me.frm.doc.workflow_state === "Pending Merchandiser Approval" || me.frm.doc.workflow_state === "Pending Final Approval") {
                                    frappe.call({
                                        method: 'erp_dacsinc_custom.order_flow_api.verify_customer_details',
                                        args: { sales_order: me.frm.doc.name }
                                    }).then(r => {
                                        const res = r.message;
                                        if (!res) {
                                            me.apply_workflow_action(d);
                                            return;
                                        }
                                        
                                        const contact_details = res.contact_details || {};
                                        const address_query = () => ({
                                            query: 'frappe.contacts.doctype.address.address.address_query',
                                            filters: { link_doctype: 'Customer', link_name: res.customer }
                                        });
                                        const customer_link_html = `<a href="${frappe.utils.get_form_link('Customer', res.customer)}" target="_blank">${wf_esc(res.customer_display_name || res.customer)} (${wf_esc(res.customer)})</a>`;
                                        const customer_label_html = contact_details.first_name
                                            ? `${customer_link_html} <span style="color:var(--text-muted);">(${wf_esc(contact_details.first_name)})</span>`
                                            : customer_link_html;

                                         const fields = [
                                            {
                                                fieldtype: 'HTML',
                                                fieldname: 'notice',
                                                options: `
                                                    <div class="alert alert-warning" style="margin-bottom: 15px;">
                                                        <i class="fa fa-warning"></i> ${__('Customer {0} details. Fill or correct them below to save to master, or enter a comment to skip.', [`<b>${customer_label_html}</b>`])}
                                                    </div>
                                                `
                                            },
                                            {
                                                fieldtype: 'Section Break',
                                                label: __('Customer Profile')
                                            },
                                            {
                                                fieldtype: 'Data',
                                                fieldname: 'gstin',
                                                label: __('GSTIN / UIN'),
                                                default: res.gstin || '',
                                                onchange: () => wf_sync_gst_category(dialog)
                                            },
                                            {
                                                fieldtype: 'Column Break'
                                            },
                                            {
                                                fieldtype: 'Select',
                                                fieldname: 'gst_category',
                                                label: __('GST Category'),
                                                options: wf_gst_category_options(),
                                                default: res.gst_category || wf_guess_gst_category(res.gstin) || '',
                                                // description: __("Guessed from the GSTIN above — override if it's wrong.")
                                            },
                                            {
                                                fieldtype: 'Column Break'
                                            },
                                            {
                                                fieldtype: 'Link',
                                                options: 'Tax Category',
                                                fieldname: 'tax_category',
                                                label: __('Tax Category'),
                                                default: res.tax_category || ''
                                            },
                                            {
                                                fieldtype: 'Section Break',
                                                label: __('Billing & Shipping Address')
                                            },
                                            {
                                                fieldtype: 'Link',
                                                options: 'Address',
                                                fieldname: 'billing_address',
                                                label: __('Billing Address'),
                                                default: res.billing_address || '',
                                                description: __('Pick one of this customer\'s existing addresses, or use "Create a New Address" — applies to this Sales Order only.'),
                                                get_query: address_query,
                                                onchange: () => wf_refresh_address_preview(dialog, 'billing_address', 'billing_address_display')
                                            },
                                            {
                                                fieldtype: 'Small Text',
                                                fieldname: 'billing_address_display',
                                                label: __('Address Preview'),
                                                read_only: 1,
                                                default: res.billing_address_display || ''
                                            },
                                            {
                                                fieldtype: 'Column Break'
                                            },
                                            {
                                                fieldtype: 'Link',
                                                options: 'Address',
                                                fieldname: 'shipping_address',
                                                label: __('Shipping Address'),
                                                default: res.shipping_address || '',
                                                description: __('Pick one of this customer\'s existing addresses, or use "Create a New Address" — applies to this Sales Order only.'),
                                                get_query: address_query,
                                                onchange: () => wf_refresh_address_preview(dialog, 'shipping_address', 'shipping_address_display')
                                            },
                                            {
                                                fieldtype: 'Small Text',
                                                fieldname: 'shipping_address_display',
                                                label: __('Address Preview'),
                                                read_only: 1,
                                                default: res.shipping_address_display || ''
                                            },
                                            {
                                                fieldtype: 'Section Break',
                                                label: __('Primary Contact Details')
                                            },
                                            {
                                                fieldtype: 'Data',
                                                fieldname: 'contact_first_name',
                                                label: __('First Name'),
                                                default: contact_details.first_name || ''
                                            },
                                            {
                                                fieldtype: 'Column Break'
                                            },
                                            {
                                                fieldtype: 'Data',
                                                fieldname: 'contact_mobile_no',
                                                label: __('Mobile Number'),
                                                default: contact_details.mobile_no || ''
                                            },
                                            {
                                                fieldtype: 'Data',
                                                fieldname: 'contact_email',
                                                label: __('Email ID'),
                                                default: contact_details.email || ''
                                            },
                                            {
                                                fieldtype: 'Section Break',
                                                label: __('Skip Verification')
                                            },
                                            {
                                                fieldtype: 'Small Text',
                                                fieldname: 'skip_comment',
                                                label: __('Or Approve with Comment (Will notify in dashboard)'),
                                                placeholder: __('Enter comment if you wish to skip validations...')
                                            }
                                        ];

                                        if (me.frm.doc.workflow_state === "Pending Final Approval") {
                                            fields.push({
                                                fieldtype: 'Section Break',
                                                label: __('Approval Settings')
                                            });
                                            fields.push({
                                                fieldtype: 'Check',
                                                fieldname: 'skip_delivery_note',
                                                label: __('Skip Delivery Note (Direct Billing)'),
                                                default: me.frm.doc.skip_delivery_note || 0
                                            });
                                        }
                                        
                                         const dialog = new frappe.ui.Dialog({
                                             title: __('Verify Customer Details'),
                                             size: 'large',
                                             fields: fields,
                                             primary_action_label: __('Update Customer & Approve SO'),
                                             primary_action: (values) => {
                                                 const btn_primary = dialog.get_primary_btn();
                                                 const btn_secondary = dialog.get_secondary_btn();
                                                 if (btn_primary) btn_primary.attr("disabled", true).addClass("disabled");
                                                 if (btn_secondary) btn_secondary.attr("disabled", true).addClass("disabled");

                                                 const enable_buttons = () => {
                                                     if (btn_primary) btn_primary.attr("disabled", false).removeClass("disabled");
                                                     if (btn_secondary) btn_secondary.attr("disabled", false).removeClass("disabled");
                                                 };

                                                 if (values.skip_comment && values.skip_comment.trim()) {
                                                     frappe.call({
                                                         method: 'erp_dacsinc_custom.order_flow_api.approve_sales_order_with_comment',
                                                         args: {
                                                             sales_order: me.frm.doc.name,
                                                             comment: values.skip_comment,
                                                             skip_delivery_note: values.skip_delivery_note
                                                         },
                                                         error: enable_buttons
                                                     }).then(() => {
                                                         dialog.hide();
                                                         frappe.show_alert({message: __('Sales Order approved with comment successfully'), color: 'green'});
                                                         me.frm.reload_doc();
                                                     });
                                                     return;
                                                 }
                                                 
                                                 let contact_data = null;
                                                 if (values.contact_first_name) {
                                                     contact_data = JSON.stringify({
                                                         first_name: values.contact_first_name,
                                                         mobile_no: values.contact_mobile_no,
                                                         email: values.contact_email
                                                     });
                                                 }

                                                 frappe.call({
                                                     method: 'erp_dacsinc_custom.order_flow_api.save_and_approve_sales_order',
                                                     args: {
                                                         sales_order: me.frm.doc.name,
                                                         gstin: values.gstin || null,
                                                         gst_category: values.gst_category || null,
                                                         tax_category: values.tax_category || null,
                                                         billing_address: values.billing_address || null,
                                                         shipping_address: values.shipping_address || null,
                                                         contact_data: contact_data,
                                                         skip_delivery_note: values.skip_delivery_note
                                                     },
                                                     error: enable_buttons
                                                 }).then(() => {
                                                     dialog.hide();
                                                     frappe.show_alert({message: __('Customer details updated and Sales Order approved'), color: 'green'});
                                                     me.frm.reload_doc();
                                                 });
                                             },
                                             secondary_action_label: __('Skip & Approve'),
                                             secondary_action: () => {
                                                 const values = dialog.get_values();
                                                 if (!values || !values.skip_comment || !values.skip_comment.trim()) {
                                                     frappe.msgprint(__('Please enter a comment in the field below first.'));
                                                     return;
                                                 }
                                                 const btn_primary = dialog.get_primary_btn();
                                                 const btn_secondary = dialog.get_secondary_btn();
                                                 if (btn_primary) btn_primary.attr("disabled", true).addClass("disabled");
                                                 if (btn_secondary) btn_secondary.attr("disabled", true).addClass("disabled");

                                                 const enable_buttons = () => {
                                                     if (btn_primary) btn_primary.attr("disabled", false).removeClass("disabled");
                                                     if (btn_secondary) btn_secondary.attr("disabled", false).removeClass("disabled");
                                                 };

                                                 frappe.call({
                                                     method: 'erp_dacsinc_custom.order_flow_api.approve_sales_order_with_comment',
                                                     args: {
                                                         sales_order: me.frm.doc.name,
                                                         comment: values.skip_comment,
                                                         skip_delivery_note: values.skip_delivery_note
                                                     },
                                                     error: enable_buttons
                                                 }).then(() => {
                                                     dialog.hide();
                                                     frappe.show_alert({message: __('Sales Order approved with comment successfully'), color: 'green'});
                                                     me.frm.reload_doc();
                                                 });
                                             }
                                         });

                                        wf_enable_new_address_customer_prefill(dialog, res.customer);
                                        dialog.show();
                                    });
                                } else {
                                    me.apply_workflow_action(d);
                                }
                            } else {
                                me.apply_workflow_action(d);
                            }
                        }
                        else {
                            me.apply_workflow_action(d);
                        }
                    });
                }
            });

            this.setup_btn(added);
        });
    }

    apply_workflow_action(transition) {
        const me = this;
        
     
        
        return new Promise((resolve, reject) => {
            frappe.dom.freeze();
            me.frm.selected_workflow_action = transition.action;

            me.frm.script_manager.trigger("before_workflow_action").then(() => {
                frappe
                    .xcall("frappe.model.workflow.apply_workflow", {
                        doc: me.frm.doc,
                        action: transition.action
                    })
                    .then((doc) => {
                        frappe.model.sync(doc);
                        me.frm.refresh();
                        me.frm.selected_workflow_action = null;
                        me.frm.script_manager.trigger("after_workflow_action");
                        resolve();
                    })
                    .catch((error) => {
                        console.error(error);
                        reject(error);
                    })
                    .finally(() => {
                        frappe.dom.unfreeze();
                    });
            });
        });
    }
}


frappe.ui.form.States = WorkflowOverride;

// Same formatted-address preview shown beneath Sales Order's own address
// Link fields — kept in sync with the order_flow.js dashboard's equivalent
// (of_refresh_address_preview), duplicated here under a wf_ prefix since
// both files load together on the desk. Uses set_value (not raw HTML) so
// the preview renders inside the same read-only "boxed" control Sales
// Order itself uses for address_display.
function wf_refresh_address_preview(dialog, link_fieldname, preview_fieldname) {
    const address_name = dialog.get_value(link_fieldname);
    if (!address_name) {
        dialog.set_value(preview_fieldname, '');
        return;
    }
    frappe.xcall('frappe.contacts.doctype.address.address.get_address_display', { address_dict: address_name })
        .then(address_display => {
            dialog.set_value(preview_fieldname, address_display || '');
        });
}

// Same GST Category helpers as order_flow.js's of_gst_category_options /
// of_guess_gst_category / of_sync_gst_category — see that file's comments.
function wf_gst_category_options() {
    const docfield = frappe.meta.get_docfield('Customer', 'gst_category');
    return (docfield && docfield.options)
        || 'Registered Regular\nRegistered Composition\nUnregistered\nSEZ\nOverseas\nDeemed Export\nUIN Holders\nTax Deductor\nTax Collector\nInput Service Distributor';
}

function wf_guess_gst_category(gstin) {
    if (typeof india_compliance === 'undefined' || !india_compliance.guess_gst_category) return '';
    return india_compliance.guess_gst_category((gstin || '').trim(), undefined) || '';
}

function wf_sync_gst_category(dialog) {
    const guessed = wf_guess_gst_category(dialog.get_value('gstin'));
    if (guessed) dialog.set_value('gst_category', guessed);
}

function wf_esc(v) {
    if (v === undefined || v === null) return '';
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Same scoped make_quick_entry patch as order_flow.js's
// of_enable_new_address_customer_prefill — see that function's comment for
// why cur_frm-based guessing can't be relied on here either (the Sales
// Order form IS the cur_frm at this point, but without this override its
// own doctype/name would be guessed instead of the Customer).
function wf_enable_new_address_customer_prefill(dialog, customer_name) {
    const original_make_quick_entry = frappe.ui.form.make_quick_entry;
    frappe.ui.form.make_quick_entry = function (doctype, after_insert, init_callback, doc, force) {
        if (doctype !== 'Address') {
            return original_make_quick_entry(doctype, after_insert, init_callback, doc, force);
        }
        const wrapped_init_callback = (qe_dialog) => {
            if (init_callback) init_callback(qe_dialog);
            qe_dialog.set_value('link_doctype', 'Customer').then(() => {
                return qe_dialog.set_value('link_name', customer_name);
            }).then(() => {
                qe_dialog.set_df_property('link_doctype', 'read_only', 1);
                qe_dialog.set_df_property('link_name', 'read_only', 1);
            });
        };
        return original_make_quick_entry(doctype, after_insert, wrapped_init_callback, doc, force);
    };
    const existing_onhide = dialog.onhide;
    dialog.onhide = () => {
        frappe.ui.form.make_quick_entry = original_make_quick_entry;
        existing_onhide && existing_onhide();
    };
}