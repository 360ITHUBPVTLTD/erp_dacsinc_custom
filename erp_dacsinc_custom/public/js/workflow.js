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
                                    
                                 if (d.action === "Lost Pipeline") {
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

                                            me.frm.save().then(() => {

                                                // ✅ Step 1: Check if any open activities exist
                                                // frappe.call({
                                                //     method: "frappe.client.get_list",
                                                //     args: {
                                                //         doctype: "Activity 360CRM",
                                                //         filters: {
                                                //             lead_id: lead_id,
                                                //             status: "Open"
                                                //         },
                                                //         fields: ["name"]
                                                //     },
                                                //     callback: function (res) {
                                                //         if (res.message.length > 0) {
                                                //             let open_activities = res.message.map(a => a.name);
                                                //             let closeActivityPromises = [];

                                                //             // ✅ Step 2: Close all open activities
                                                //             open_activities.forEach(activity_id => {
                                                //                 let promise = frappe.db.set_value("Activity 360CRM", activity_id, {
                                                //                     status: "Closed",
                                                //                     activity_closed_notes: `Lead marked as Lost`,
                                                //                     closed_date: frappe.datetime.nowdate()
                                                //                 }).then(() => {
                                                //                     console.log(`Closed Activity: ${activity_id}`);
                                                //                 });

                                                //                 closeActivityPromises.push(promise);
                                                //             });

                                                //             // ✅ Step 3: Wait for all activities to close before applying the workflow action
                                                //             Promise.all(closeActivityPromises).then(() => {
                                                //                 // console.log("All open activities closed.");
                                                //                 me.apply_workflow_action(d); // Apply workflow after closing activities
                                                //             });

                                                //         } else {
                                                //             // console.log("No open activities found. Proceeding with workflow action.");
                                                //             me.apply_workflow_action(d); // Apply workflow if no open activities exist
                                                //         }
                                                //     }
                                                // });

                                            });

                                        }, __('Enter Lost Reason'));  // Title for the prompt
                                    }



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

                                            me.frm.save().then(() => {

                                                // ✅ Step 1: Check if any open activities exist
                                                // frappe.call({
                                                //     method: "frappe.client.get_list",
                                                //     args: {
                                                //         doctype: "Activity 360CRM",
                                                //         filters: {
                                                //             lead_id: lead_id,
                                                //             status: "Open"
                                                //         },
                                                //         fields: ["name"]
                                                //     },
                                                //     callback: function (res) {
                                                //         if (res.message.length > 0) {
                                                //             let open_activities = res.message.map(a => a.name);
                                                //             let closeActivityPromises = [];

                                                //             // ✅ Step 2: Close all open activities
                                                //             open_activities.forEach(activity_id => {
                                                //                 let promise = frappe.db.set_value("Activity 360CRM", activity_id, {
                                                //                     status: "Closed",
                                                //                     activity_closed_notes: `Lead marked as Lost`,
                                                //                     closed_date: frappe.datetime.nowdate()
                                                //                 }).then(() => {
                                                //                     console.log(`Closed Activity: ${activity_id}`);
                                                //                 });

                                                //                 closeActivityPromises.push(promise);
                                                //             });

                                                //             // ✅ Step 3: Wait for all activities to close before applying the workflow action
                                                //             Promise.all(closeActivityPromises).then(() => {
                                                //                 // console.log("All open activities closed.");
                                                //                 me.apply_workflow_action(d); // Apply workflow after closing activities
                                                //             });

                                                //         } else {
                                                //             // console.log("No open activities found. Proceeding with workflow action.");
                                                //             me.apply_workflow_action(d); // Apply workflow if no open activities exist
                                                //         }
                                                //     }
                                                // });

                                            });

                                        }, __('Enter Lost Reason'));  // Title for the prompt
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

                                            me.frm.save().then(() => {

                                                // ✅ Step 1: Check if any open activities exist
                                                // frappe.call({
                                                //     method: "frappe.client.get_list",
                                                //     args: {
                                                //         doctype: "Activity 360CRM",
                                                //         filters: {
                                                //             lead_id: lead_id,
                                                //             status: "Open"
                                                //         },
                                                //         fields: ["name"]
                                                //     },
                                                //     callback: function (res) {
                                                //         if (res.message.length > 0) {
                                                //             let open_activities = res.message.map(a => a.name);
                                                //             let closeActivityPromises = [];

                                                //             // ✅ Step 2: Close all open activities
                                                //             open_activities.forEach(activity_id => {
                                                //                 let promise = frappe.db.set_value("Activity 360CRM", activity_id, {
                                                //                     status: "Closed",
                                                //                     activity_closed_notes: `Lead marked as Lost`,
                                                //                     closed_date: frappe.datetime.nowdate()
                                                //                 }).then(() => {
                                                //                     console.log(`Closed Activity: ${activity_id}`);
                                                //                 });

                                                //                 closeActivityPromises.push(promise);
                                                //             });

                                                //             // ✅ Step 3: Wait for all activities to close before applying the workflow action
                                                //             Promise.all(closeActivityPromises).then(() => {
                                                //                 // console.log("All open activities closed.");
                                                //                 me.apply_workflow_action(d); // Apply workflow after closing activities
                                                //             });

                                                //         } else {
                                                //             // console.log("No open activities found. Proceeding with workflow action.");
                                                //             me.apply_workflow_action(d); // Apply workflow if no open activities exist
                                                //         }
                                                //     }
                                                // });

                                            });

                                        }, __('Enter Unqualified Lead Reason'));  // Title for the prompt
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
                        // else if (me.frm.doc.doctype === "Task") {
                        //     if (d.action === "Completed") {
                        //         // Show prompt for completion date
                        //         frappe.prompt([
                        //             {
                        //                 fieldtype: 'Date',
                        //                 label: __('Completion Date'),
                        //                 fieldname: 'completion_date',
                        //                 reqd: 1
                        //             }
                        //         ], function (values) {
                        //             let completion_date = values.completion_date;
                        //             let completed_by = frappe.session.user;
                        //             let task_id = me.frm.doc.name; // Get Task ID
                        
                        //             // console.log("Setting Completion Date:", completion_date);
                        
                        //             frappe.db.set_value('Task', task_id, {
                        //                 'completion_date': completion_date,
                        //                 'completed_by': completed_by
                        //             }).then(() => {
                        //                     // console.log("Completion Date Updated:", completion_date);
                        
                        //                     // ✅ Step 2: Apply Workflow Action After Updating Date
                        //                     me.apply_workflow_action(d);
                        //                 });
                        
                        //         }, __('Enter Task Completion Date')); // Prompt Title
                        
                        //     } 
                        //     else if (d.action === "Template" && me.frm.doc.status === "Open") {
                                
                        //                 me.apply_workflow_action(d);
                                    
                        //     } 
                            
                            
                        //     else {
                        //         // Show confirmation for other statuses
                        //         frappe.confirm(
                        //             __(`Are you sure you want to proceed with ${d.action}?`),
                        //             () => {
                        //                 // console.log(`Confirmed: Applying workflow action - ${d.action}`);
                        //                 me.apply_workflow_action(d);
                        //             },
                        //             () => {
                        //                 console.log("Workflow action cancelled by the user.");
                        //             }
                        //         );
                        //     }
                        // }
                        
                        
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
        
        // if (["Converted"].includes(transition.action)) {
        //     frappe.msgprint(__("This action is not allowed. You need to create either a Quotation or a Sales Invoice."));
        //     return Promise.reject("Action not allowed");
        // }
        
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