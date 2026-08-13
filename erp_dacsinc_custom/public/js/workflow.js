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
                                        
                                        const address_details = res.address_details || {};
                                        const contact_details = res.contact_details || {};
                                        
                                         const fields = [
                                            {
                                                fieldtype: 'HTML',
                                                fieldname: 'notice',
                                                options: `
                                                    <div class="alert alert-warning" style="margin-bottom: 15px;">
                                                        <i class="fa fa-warning"></i> ${__('Customer {0} details. Fill or correct them below to save to master, or enter a comment to bypass.', [`<b>${res.customer}</b>`])}
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
                                                default: res.gstin || ''
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
                                                label: __('Primary Address Details')
                                            },
                                            {
                                                fieldtype: 'Data',
                                                fieldname: 'address_line1',
                                                label: __('Address Line 1'),
                                                default: address_details.address_line1 || ''
                                            },
                                            {
                                                fieldtype: 'Data',
                                                fieldname: 'address_line2',
                                                label: __('Address Line 2'),
                                                default: address_details.address_line2 || ''
                                            },
                                            {
                                                fieldtype: 'Data',
                                                fieldname: 'city',
                                                label: __('City'),
                                                default: address_details.city || ''
                                            },
                                            {
                                                fieldtype: 'Column Break'
                                            },
                                            {
                                                fieldtype: 'Data',
                                                fieldname: 'state',
                                                label: __('State'),
                                                default: address_details.state || ''
                                            },
                                            {
                                                fieldtype: 'Link',
                                                options: 'Country',
                                                fieldname: 'country',
                                                label: __('Country'),
                                                default: address_details.country || 'India'
                                            },
                                            {
                                                fieldtype: 'Data',
                                                fieldname: 'pincode',
                                                label: __('Pincode'),
                                                default: address_details.pincode || ''
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
                                                label: __('Bypass Option')
                                            },
                                            {
                                                fieldtype: 'Small Text',
                                                fieldname: 'bypass_comment',
                                                label: __('Or Approve with Comment (Will notify in dashboard)'),
                                                placeholder: __('Enter comment if you wish to bypass validations...')
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
                                             fields: fields,
                                             primary_action_label: __('Save Details & Approve'),
                                             primary_action: (values) => {
                                                 const btn_primary = dialog.get_primary_btn();
                                                 const btn_secondary = dialog.get_secondary_btn();
                                                 if (btn_primary) btn_primary.attr("disabled", true).addClass("disabled");
                                                 if (btn_secondary) btn_secondary.attr("disabled", true).addClass("disabled");

                                                 const enable_buttons = () => {
                                                     if (btn_primary) btn_primary.attr("disabled", false).removeClass("disabled");
                                                     if (btn_secondary) btn_secondary.attr("disabled", false).removeClass("disabled");
                                                 };

                                                 if (values.bypass_comment && values.bypass_comment.trim()) {
                                                     frappe.call({
                                                         method: 'erp_dacsinc_custom.order_flow_api.approve_sales_order_with_comment',
                                                         args: {
                                                             sales_order: me.frm.doc.name,
                                                             comment: values.bypass_comment,
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
                                                 
                                                 let address_data = null;
                                                 if (values.address_line1) {
                                                     address_data = JSON.stringify({
                                                         address_line1: values.address_line1,
                                                         address_line2: values.address_line2,
                                                         city: values.city,
                                                         state: values.state,
                                                         country: values.country,
                                                         pincode: values.pincode
                                                     });
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
                                                         tax_category: values.tax_category || null,
                                                         address_data: address_data,
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
                                             secondary_action_label: __('Bypass & Approve'),
                                             secondary_action: () => {
                                                 const values = dialog.get_values();
                                                 if (!values || !values.bypass_comment || !values.bypass_comment.trim()) {
                                                     frappe.msgprint(__('Please enter a bypass comment in the field below first.'));
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
                                                         comment: values.bypass_comment,
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