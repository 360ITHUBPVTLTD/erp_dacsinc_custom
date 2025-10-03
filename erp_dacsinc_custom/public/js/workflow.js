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
                                        frappe.prompt([ 
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

                                        }, __('Enter PO Value'));    // Title for the prompt
                                    }





                                    else if (d.action === "Lost Enquiry") {
                                        frappe.prompt([
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

                                        }, __('Enter Lost Enquiry Reason'));  // Title for the prompt
                                    }
   
                                    else if (d.action === "Lost Pipeline") {
                                        frappe.prompt([
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

                                        }, __('Enter Lost Pipeline'));  // Title for the prompt
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