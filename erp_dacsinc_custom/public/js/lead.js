// frappe.ui.form.on('Lead', {
// 	refresh(frm) {

// 	         setTimeout(() => {
//                     frm.page.remove_inner_button('Add to Prospect', 'Action');
//                     frm.page.remove_inner_button('Prospect', 'Create');
//                     frm.page.remove_inner_button('Opportunity', 'Create');
//                 }, 100); // Increase the delay time to 100 milliseconds
// 	    		if (!frm.doc.__islocal) {
// 	    		    render_lead_activities(frm);
// 			// Fetch and render tasks + button inside HTML field
// 			frappe.call({
// 				method: 'erp_dacsinc_custom.custom_lead.get_tasks_for_lead',
// 				args: {
// 					lead_name: frm.doc.name
// 				},
// 				callback: function (r) {
// 					let rows = '';
// 					if (r.message && r.message.length > 0) {
// 						rows = r.message.map(task => `
// 							<tr>
// 								<td style="border: solid 2px #bcb9b4;"><a href="/app/task/${task.name}" target="_blank">${task.name}</a></td>
// 								<td style="border: solid 2px #bcb9b4;">${task.subject}</td>
// 								<td style="border: solid 2px #bcb9b4;">${task.status}</td>
// 								<td style="border: solid 2px #bcb9b4;">${frappe.datetime.str_to_user(task.exp_end_date || '')}</td>
// 							</tr>
// 						`).join('');
// 					} else {
// 						rows = `<tr><td colspan="4" class="text-center">No tasks found.</td></tr>`;
// 					}

// 					let html = `
// 						<div style="margin-top: 10px">
// 							<button class="btn btn-primary btn-sm create-task-btn" style="margin-bottom: 15px;">
// 								+ Create Task
// 							</button>
// 							<h4>Tasks for this Lead</h4>
// 							<table class="table table-bordered">
// 								<thead>
// 									<tr style="background-color:#3498DB; color:white; text-align: left;">
// 										<th style="vertical-align: middle; border: solid 2px #bcb9b4;">Task ID</th>
// 										<th style="vertical-align: middle; border: solid 2px #bcb9b4;">Subject</th>
// 										<th style="vertical-align: middle; border: solid 2px #bcb9b4;">Status</th>
// 										<th style="vertical-align: middle; border: solid 2px #bcb9b4;">Due Date</th>
// 									</tr>
// 								</thead>
// 								<tbody>
// 									${rows}
// 								</tbody>
// 							</table>
// 						</div>
// 					`;

// 					// Inject into custom HTML field
// 					frm.fields_dict.custom_task_html.$wrapper.html(html);

// 					// Attach click handler for the button inside the HTML
// 					frm.fields_dict.custom_task_html.$wrapper
// 						.find('.create-task-btn')
// 						.on('click', function () {
// 							frappe.new_doc('Task', {
// 								custom_lead_id: frm.doc.name
// 							});
// 						});
// 				}
// 			});
// 		}

// 		calculate_lead_age(frm);
// 		quotation_html(frm)
//         // if (frm.doc.name ) { 

//             frappe.call({
//             method: 'erp_dacsinc_custom.custom_lead.get_activities_for_lead', // Replace with your app and module path
//             args: {
//                 lead_name: frm.doc.name
//             },
//             callback: function(r) {
//                 let wrapper = $(frm.fields_dict.custom_todo_and_event_html.wrapper);
//                 let activities = r.message;

//                 if (activities && (activities.todos.length > 0 || activities.events.length > 0)) {
//                     let htmlContent = '';

//                     // --- Build To-Do Table ---
//                     if (activities.todos.length > 0) {
//                         htmlContent += `
//                             <h4>To-Dos (${activities.todos.length})</h4>
//                             <table class="table table-bordered table-sm">
//                                 <thead style="background-color: #f4f6f8;">
//                                     <tr>
//                                         <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Subject</th>
//                                         <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Status</th>
//                                         <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Allocated to</th>
//                                         <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Due Date</th>
//                                     </tr>
//                                 </thead>
//                                 <tbody>`;

//                         activities.todos.forEach(todo => {
//                             let todo_link = `/app/todo/${todo.name}`;
//                             let formatted_due_date = todo.date ? frappe.datetime.str_to_user(todo.date) : 'Not set';
//                             htmlContent += `
//                                 <tr>
//                                     <td style="border: solid 2px #bcb9b4;"><a href="${todo_link}" target="_blank">${todo.description}</a></td>
//                                     <td style="border: solid 2px #bcb9b4;">${todo.status}</td>
//                                     <td style="border: solid 2px #bcb9b4;">${todo.allocated_to}</td>
//                                     <td style="border: solid 2px #bcb9b4;">${formatted_due_date}</td>
//                                 </tr>`;
//                         });
//                         htmlContent += '</tbody></table>';
//                     }

//                     // --- Build Event Table ---
//                     if (activities.events.length > 0) {
//                         htmlContent += `
//                             <h4 class="mt-4">Events (${activities.events.length})</h4>
//                             <table class="table table-bordered table-sm">
//                                 <thead style="background-color: #f4f6f8;">
//                                     <tr>
//                                         <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Subject</th>
//                                         <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Status</th>
//                                         <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Starts On</th>
//                                     </tr>
//                                 </thead>
//                                 <tbody>`;

//                         activities.events.forEach(event => {
//                             let event_link = `/app/event/${event.name}`;
//                             let formatted_starts_on = event.starts_on ? frappe.datetime.str_to_user(event.starts_on) : 'Not set';
//                             htmlContent += `
//                                 <tr>
//                                     <td style="border: solid 2px #bcb9b4;"><a href="${event_link}" target="_blank">${event.subject}</a></td>
//                                     <td style="border: solid 2px #bcb9b4;">${event.status}</td>
//                                     <td style="border: solid 2px #bcb9b4;">${formatted_starts_on}</td>
//                                 </tr>`;
//                         });
//                         htmlContent += '</tbody></table>';
//                     }

//                     wrapper.html(htmlContent);

//                 } else {
//                     // If no activities are found
//                     wrapper.html('<p class="text-muted">No To-dos or Events found for this lead.</p>');
//                 }
//             }
//         });
//         // }

// 	}
// })

// function quotation_html(frm){
//                 frappe.call({
//                 method: 'erp_dacsinc_custom.custom_lead.get_quotations_for_lead',  // Replace with your app and module path
//                 args: {
//                     lead_name: frm.doc.name
//                 },
//                 callback: function(r) {
//                     if (r.message && r.message.length) {
//                         let quotations = r.message;

//                         // Get the count of quotations
//                         let quotationCount = quotations.length;

//                         // Start building the HTML content
//                         let htmlContent = `
//                             <div class="quotation-summary">
//                                 <p><strong>Total Quotations: ${quotationCount}</strong></p>
//                             </div>
//                             <div class="quotation-list-wrapper">
//                                 <table class="table table-bordered">
//                                     <thead style="padding: 8px; border: 1px solid #ddd; background-color: #3498DB; color: #ffffff;">
//                                         <tr style="background-color:#3498DB; color:white; text-align: left;">
//                                             <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Quotation ID</th>
//                                             <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Status</th>
//                                             <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Customer Name</th>
//                                             <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Date</th>
//                                             <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Items</th>
//                                             <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Total</th>
//                                         </tr>
//                                     </thead>
//                                     <tbody>`;

//                         // Iterate over the quotations to build each row
//                         quotations.forEach(quotation => {
//                             let items = quotation.items.length > 0 ? quotation.items.join(', ') : 'No items';
//                             let quotation_link = `/app/quotation/${quotation.quotation_id}`;
//                             let formatted_date = frappe.datetime.str_to_user(quotation.transaction_date);
//                             let formatted_total = format_currency(quotation.grand_total, 'INR');

//                             htmlContent += `
//                                 <tr>
//                                     <td style="border: solid 2px #bcb9b4;"><a href="${quotation_link}" target="_blank">${quotation.quotation_id}</a></td>
//                                     <td style="border: solid 2px #bcb9b4;">${quotation.status}</td>
//                                     <td style="border: solid 2px #bcb9b4;">${quotation.customer_name}</td>
//                                     <td style="border: solid 2px #bcb9b4;">${formatted_date}</td>
//                                     <td style="border: solid 2px #bcb9b4;">${items}</td>
//                                     <td style="border: solid 2px #bcb9b4;">${formatted_total}</td>
//                                 </tr>`;
//                         });

//                         htmlContent += `</tbody></table></div>`;

//                         // Insert the HTML content into the custom_quotation_html field
//                         $(frm.fields_dict.custom_quotation_html.wrapper).html(htmlContent);
//                     } else {
//                         // If no quotations are found
//                         $(frm.fields_dict.custom_quotation_html.wrapper).html('<p>No quotations found for this lead.</p>');
//                     }
//                 }
//             });

// }


// function render_lead_activities(frm) {
//     frappe.call({
//         method: "frappe.client.get_list",
//         args: {
//             doctype: "Event Activity",
//             filters: {
//                 reference_type: "Lead",
//                 reference_name: frm.doc.name
//             },
//             fields: ["name", "subject", "category", "status", "starts_on", "assigned_to", "description", "notes"],
//             order_by: "creation desc"
//         },
//         callback: function(r) {
//             let wrapper = $(frm.fields_dict.custom_lead_activity_html.wrapper);
//             let activities = r.message || [];

//             // --- Build category summary counts ---
//             let categoryCounts = {};
//             let statusCounts = {};

//             activities.forEach(activity => {
//                 let cat = activity.category || "Uncategorized";
//                 categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;

//                 let stat = activity.status || "Unknown";
//                 statusCounts[stat] = (statusCounts[stat] || 0) + 1;
//             });

//             let categorySummaryHtml = `
//                 <div  style="margin-bottom: 10px; padding: 8px; background: #f8f9fa; border: 1px solid #ddd; border-radius: 4px;">
//                     <strong>Category Summary:</strong> 
//                     ${Object.keys(categoryCounts).map(cat => 
//                         `<span style="margin-right:15px;">
//                             ${cat}: <span style="color:#3498DB; font-weight:bold;">${categoryCounts[cat]}</span>
//                         </span>`
//                     ).join("")}
//                 </div>
//             `;

//             let statusSummaryHtml = `
//                 <div style="margin-bottom: 10px; padding: 8px; background: #f8f9fa; border: 1px solid #ddd; border-radius: 4px;">
//                     <strong>Status Summary:</strong> 
//                     ${Object.keys(statusCounts).map(stat => {
//                         let color = (stat === "Open") ? "green" : (stat === "Completed") ? "blue" : "red";
//                         return `<span style="margin-right:15px;">
//                             ${stat}: <span style="color:${color}; font-weight:bold;">${statusCounts[stat]}</span>
//                         </span>`;
//                     }).join("")}
//                 </div>
//             `;
//             let rows = (r.message || []).map(activity => {
//                 return `
//                     <tr>
//                         <td><a href="/app/event-activity/${activity.name}" target="_blank">${activity.subject}</a></td>
//                         <td>${activity.category}</td>
//                         <td>${activity.status}</td>
//                         <td>${frappe.datetime.str_to_user(activity.starts_on || "")}</td>
//                         <td>${activity.assigned_to || "-"}</td>
//                         <td>${activity.description || "-"}</td>
//                         <td>${activity.notes || "-"}</td>
//                         <td>
//                             ${activity.status === "Open" ? `
//                                 <div class="dropdown">
//                                     <button class="btn btn-sm btn-secondary dropdown-toggle" style="background-color:#3498DB;color:white;" type="button" data-toggle="dropdown">
//                                         Actions
//                                     </button>
//                                     <div class="dropdown-menu">
//                                         <a class="dropdown-item complete-action" data-id="${activity.name}" href="#">✅ Complete</a>
//                                         <a class="dropdown-item complete-new-action" data-id="${activity.name}" href="#">🔄 Complete & New</a>
//                                         <a class="dropdown-item cancel-action" data-id="${activity.name}" href="#">❌ Cancel</a>
//                                     </div>
//                                 </div>
//                             ` : "-"}
//                         </td>
//                     </tr>
//                 `;
//             });

//             let html = `
//                 <div style="display:flex; justify-content: flex-end; margin-bottom:10px;">
//                     <button class="btn btn-sm btn-primary" id="create-lead-activity-btn">➕ Create Activity</button>
//                 </div>
//                 ${categorySummaryHtml}
//                 ${statusSummaryHtml}
//                 <div style="overflow-x:auto; margin-top:10px;">
//                     <table class="table table-bordered table-sm">
//                         <thead style="background-color:#3498DB;color:white;text-align: left;">
//                             <tr>
//                                 <th>Subject</th>
//                                 <th>Category</th>
//                                 <th>Status</th>
//                                 <th>Starts On</th>
//                                 <th>Assigned To</th>
//                                 <th>Description</th>
//                                 <th>Notes</th>
//                                 <th>Actions</th>
//                             </tr>
//                         </thead>
//                         <tbody>${rows.join("")}</tbody>
//                     </table>
//                 </div>
//             `;
//             wrapper.html(html);

//             // Bind create new
//             wrapper.find("#create-lead-activity-btn").on("click", function() {
//                 open_lead_activity_prompt(frm);
//             });

//             // Bind dropdown actions
//             wrapper.find(".complete-action").on("click", function(e) {
//                 e.preventDefault();
//                 handle_update_activity($(this).data("id"), "Completed", frm, false);
//             });

//             wrapper.find(".complete-new-action").on("click", function(e) {
//                 e.preventDefault();
//                 handle_update_activity($(this).data("id"), "Completed", frm, true);
//             });

//             wrapper.find(".cancel-action").on("click", function(e) {
//                 e.preventDefault();
//                 handle_update_activity($(this).data("id"), "Cancelled", frm, false);
//             });
//         }
//     });
// }

// // Update handler
// function handle_update_activity(activity_id, status, frm, create_new) {
//     frappe.prompt([
//         {
//             fieldname: "notes",
//             label: (status === "Completed" ? "Completed Note" : "Cancelled Note"),
//             fieldtype: "Small Text",
//             reqd: 1
//         }
//     ],
//     function(values) {
//         frappe.call({
//             method: "frappe.client.set_value",
//             args: {
//                 doctype: "Event Activity",
//                 name: activity_id,
//                 fieldname: {
//                     status: status,
//                     notes: values.notes,
//                     ends_on: status === "Completed" ? frappe.datetime.now_datetime() : null
//                 }
//             },
//             callback: function(r) {
//                 if (!r.exc) {
//                     frappe.show_alert({message: `Activity marked as ${status}`, indicator: (status === "Completed" ? "green" : "red")});
//                     render_lead_activities(frm);

//                     if (create_new) {
//                         open_lead_activity_prompt(frm);
//                     }
//                 }
//             }
//         });
//     },
//     `Mark as ${status}`,
//     "Submit"
//     );
// }

// function open_lead_activity_prompt(frm) {
//     frappe.prompt([

//         {
//             fieldname: "category",
//             label: "Category",
//             fieldtype: "Select",
//             options: [
//                 "Initial Call",
//                 "Follow up Call",
//                 "Initial Meeting",
//                 "Follow up meetings",
//                 "Meeting (Sample)",
//                 "Proposal/Quotation",
//                 "Order Closure"
//             ].join("\n"),
//             default: "Initial Call",
//             reqd: 1
//         },
//          {
//             fieldname: "subject",
//             label: "Subject",
//             fieldtype: "Data",
//             reqd: 1
//         },
//         {
//             fieldname: "starts_on",
//             label: "Starts On",
//             fieldtype: "Datetime",
//             default: frappe.datetime.now_datetime(),
//             reqd: 1
//         },
//         // { fieldtype: "Column Break" },
//         {
//             fieldname: "assigned_to",
//             label: "Assigned To",
//             fieldtype: "Link",
//             options: "User",
//             default: frappe.session.user,
//             reqd: 1
//         },

//         // {
//         //     fieldname: "description",
//         //     label: "Description",
//         //     fieldtype: "Small Text"
//         // }
//     ],
//     function(values) {
//         frappe.call({
//             method: "frappe.client.insert",
//             args: {
//                 doc: {
//                     doctype: "Event Activity",
//                     reference_type: "Lead",
//                     reference_name: frm.doc.name,
//                     subject: values.subject,
//                     category: values.category,
//                     starts_on: values.starts_on,
//                     assigned_to: values.assigned_to,
//                     description: values.description,

//                     status: "Open"
//                 }
//             },
//             callback: function(r) {
//                 if (r.message) {
//                     frappe.msgprint("Activity Created Successfully");
//                     render_lead_activities(frm); // refresh table
//                 }
//             }
//         });
//     },
//     "New Activity",
//     "Create"
//     );
// }

// function calculate_lead_age(frm) {
//     // Get the lead creation date
//     let createdAt = frm.doc.custom_created_at;
//     let leadId = frm.doc.name; // Assuming Lead ID is in frm.doc.name

//     let ageInDays = "N/A";
//     if (createdAt) {
//         let createdDate = new Date(createdAt);
//         let now = new Date();
//         let ageInMilliseconds = now - createdDate;
//         ageInDays = Math.floor(ageInMilliseconds / (1000 * 60 * 60 * 24));
//     }

//     // Fetch Event activity status counts
//     frappe.call({
//         method: "erp_dacsinc_custom.custom_lead.get_lead_activity_status",  // Replace with your actual method
//         args: {
//             lead_id: leadId
//         },
//         callback: function(response) {
//             let openCount = response.message.open || 0;
//             let closedCount = response.message.closed || 0;
//             let totalCount = response.message.total || 0;

//             // Build the card layout
//             let htmlContent = `
//                 <div style="display: flex; gap: 10px; flex-wrap: wrap;">
//                     <div style="flex: 1; padding: 15px; background: #f8f9fa; border-radius: 8px; text-align: center; box-shadow: 2px 2px 10px rgba(0,0,0,0.1);">
//                         <h4>Lead Age</h4>
//                         <p style="font-weight: bold; font-size: 18px;">${ageInDays} days</p>
//                     </div>
//                     <div style="flex: 1; padding: 15px; background: #f8f9fa; border-radius: 8px; text-align: center; box-shadow: 2px 2px 10px rgba(0,0,0,0.1);">
//                         <h4>Total Activities</h4>
//                         <p style="font-weight: bold; font-size: 18px; color: #004085;">${totalCount}</p>
//                     </div>
//                     <div style="flex: 1; padding: 15px; background: #f8f9fa; border-radius: 8px; text-align: center; box-shadow: 2px 2px 10px rgba(0,0,0,0.1);">
//                         <h4>Open Activities</h4>
//                         <p style="font-weight: bold; font-size: 18px; color: #155724;">${openCount}</p>
//                     </div>
//                     <div style="flex: 1; padding: 15px; background: #f8f9fa; border-radius: 8px; text-align: center; box-shadow: 2px 2px 10px rgba(0,0,0,0.1);">
//                         <h4>Completed Activities</h4>
//                         <p style="font-weight: bold; font-size: 18px; color: #721c24;">${closedCount}</p>
//                     </div>

//                 </div>
//             `;

//             // Update the HTML wrapper
//             $(frm.fields_dict.custom_lead_age_html.wrapper).html(htmlContent);
//         }
//     });
// }








frappe.ui.form.on('Lead', {
    refresh(frm) {
        setTimeout(() => {
            frm.page.remove_inner_button('Add to Prospect', 'Action');
            frm.page.remove_inner_button('Prospect', 'Create');
            frm.page.remove_inner_button('Opportunity', 'Create');
            frm.page.remove_inner_button('Customer', 'Create');
            frm.page.remove_inner_button('Quotation', 'Create');
        }, 500);

        // If the User is editing an existing Lead and Country is set,
        // we need to reload the State options in the background so they are valid.
        if (!frm.location_data) {
            frappe.db.get_single_value('Location Master', 'data_json').then(val => {
                if (val) {
                    frm.location_data = JSON.parse(val);

                    // If opening an existing lead, populate options immediately
                    if (frm.doc.country) {
                        set_state_options(frm);
                        if (frm.doc.custom_custom_state) {
                            set_city_options(frm);
                        }
                    }
                }
            });
        }
        if (frm.doc.custom_lead_category !== 'Order') {
            frm.add_custom_button(__('Create Quotation'), function () {
                frappe.call({
                    method: 'erp_dacsinc_custom.custom_lead.get_quotations_for_lead',
                    args: {
                        lead_name: frm.doc.name
                    },
                    callback: function (r) {
                        let quotations = r.message || [];
                        if (quotations.length > 0) {
                            let tableRows = quotations.map(q => {
                                let q_link = `/app/quotation/${q.quotation_id}`;
                                let formatted_date = frappe.datetime.str_to_user(q.transaction_date);
                                let formatted_total = format_currency(q.grand_total, 'INR');
                                return `
                                     <tr>
                                         <td style="border: 1px solid #d1d8dd; padding: 6px 8px;"><a href="${q_link}" target="_blank">${q.quotation_id}</a></td>
                                         <td style="border: 1px solid #d1d8dd; padding: 6px 8px;">${q.status}</td>
                                         <td style="border: 1px solid #d1d8dd; padding: 6px 8px;">${formatted_date}</td>
                                         <td style="border: 1px solid #d1d8dd; padding: 6px 8px;">${formatted_total}</td>
                                     </tr>
                                 `;
                            }).join('');

                            let htmlContent = `
                                 <div style="margin-bottom: 15px;">
                                     <p style="color: #d9534f; font-weight: bold;">
                                         ⚠️ Quotation(s) already exist for this Lead:
                                     </p>
                                     <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                                         <thead>
                                             <tr style="background-color: #f5f7fa; text-align: left;">
                                                 <th style="border: 1px solid #d1d8dd; padding: 6px 8px;">Quotation ID</th>
                                                 <th style="border: 1px solid #d1d8dd; padding: 6px 8px;">Status</th>
                                                 <th style="border: 1px solid #d1d8dd; padding: 6px 8px;">Date</th>
                                                 <th style="border: 1px solid #d1d8dd; padding: 6px 8px;">Total</th>
                                             </tr>
                                         </thead>
                                         <tbody>
                                             ${tableRows}
                                         </tbody>
                                     </table>
                                     <p style="margin-top: 15px; font-weight: 500;">
                                         Do you want to create one more quotation?
                                     </p>
                                 </div>
                             `;

                            let d = new frappe.ui.Dialog({
                                title: __('Existing Quotation(s) Found'),
                                fields: [
                                    {
                                        fieldtype: 'HTML',
                                        options: htmlContent
                                    }
                                ],
                                primary_action_label: __('Create New Quotation'),
                                primary_action: function () {
                                    d.hide();
                                    create_quotation();
                                },
                                secondary_action_label: __('Cancel'),
                                secondary_action: function () {
                                    d.hide();
                                }
                            });
                            d.$wrapper.addClass('dac-wide-modal');
                            d.show();

                        } else {
                            create_quotation();
                        }
                    }
                });

                function create_quotation() {
                    frappe.model.open_mapped_doc({
                        method: "erp_dacsinc_custom.custom_lead.make_quotation_custom",
                        frm: frm,
                        freeze_message: __("Creating Quotation...")
                    });
                }
            });
        }

        if (frm.doc.custom_lead_category === 'Order') {
            frm.add_custom_button(__('Duplicate Lead'), function () {
                frappe.confirm(
                    'Are you sure you want to duplicate this Lead?',
                    function () {
                        // Yes: Trigger the server function
                        frappe.call({
                            method: "erp_dacsinc_custom.custom_lead.create_duplicate_lead", // UPDATE THIS PATH
                            args: {
                                lead_name: frm.doc.name
                            },
                            freeze: true,
                            freeze_message: __("Duplicating Lead..."),
                            callback: function (r) {
                                if (r.message) {
                                    frappe.msgprint(__("Lead Duplicated Successfully"));
                                    // Route to the new Lead
                                    frappe.set_route("Form", "Lead", r.message);
                                }
                            }
                        });
                    }
                );
            });
        }

        if (!frm.doc.__islocal && !frm.doc.custom_business_contacts) {
            frm.add_custom_button(__('Convert to Business Contact'), function () {
                frappe.call({
                    method: "erp_dacsinc_custom.custom_lead.check_linked_quotation",
                    args: {
                        lead_name: frm.doc.name
                    },
                    freeze: true,
                    freeze_message: __("Checking Quotation..."),
                    callback: function (r) {
                        let has_quotation = r.message && r.message.has_quotation;
                        let msg = "";
                        if (has_quotation) {
                            msg = __('Quotation(s) exist for this Lead. Converting this Lead to a Business Contact will link them together, keeping this Lead alive. Do you want to proceed?');
                        } else {
                            msg = __('No quotation exists for this Lead. Converting this Lead to a Business Contact will migrate all activities to the contact and DELETE this Lead document. Do you want to proceed?');
                        }

                        frappe.confirm(msg, function () {
                            frappe.call({
                                method: "erp_dacsinc_custom.custom_lead.convert_lead_to_business_contact",
                                args: {
                                    lead_name: frm.doc.name
                                },
                                freeze: true,
                                freeze_message: __("Converting to Business Contact..."),
                                callback: function (r) {
                                    if (r.message) {
                                        frappe.msgprint(__("Converted to Business Contact successfully"));
                                        if (r.message.action === "deleted") {
                                            frappe.set_route("Form", "Business Contacts", r.message.business_contact_name);
                                        } else {
                                            frm.reload_doc();
                                        }
                                    }
                                }
                            });
                        });
                    }
                });
            });
        }
        if (!frm.doc.__islocal) {
            render_lead_activities(frm);





            const wrapper = frm.fields_dict.custom_attachment_html.$wrapper;
            wrapper.empty(); // Clear previous HTML

            // Fetch all attachments linked to this Lead
            frappe.call({
                method: "frappe.client.get_list",
                args: {
                    doctype: "File",
                    filters: {
                        attached_to_doctype: "Lead",
                        attached_to_name: frm.doc.name
                    },
                    fields: ["name", "file_name", "file_url", "creation", "attached_to_field"]
                },
                callback: function (r) {
                    let html = `
					<style>
						.custom-attachment-table {
							width: 100%;
							border-collapse: collapse;
							margin-top: 10px;
						}
						.custom-attachment-table th, .custom-attachment-table td {
							border: 1px solid #d1d8dd;
							padding: 6px 8px;
							text-align: left;
							font-size: 13px;
						}
						.custom-attachment-table th {
							background-color: #f5f7fa;
							font-weight: 600;
						}
						.custom-attachment-table a {
							color: #007bff;
							text-decoration: none;
						}
						.custom-attachment-table a:hover {
							text-decoration: underline;
						}
					</style>
					<h4>📎 Attachments</h4>
				`;

                    if (r.message && r.message.length) {
                        html += `
						<table class="custom-attachment-table">
							<thead>
								<tr>
									<th>#</th>
									<th>File Name</th>
									<th>Uploaded On</th>
									<th>Action</th>
								</tr>
							</thead>
							<tbody>
					`;

                        r.message.forEach((file, i) => {
                            html += `
							<tr>
								<td>${i + 1}</td>
								<td>${file.file_name}</td>
								<td>${frappe.datetime.str_to_user(file.creation)}</td>
								<td><a href="${file.file_url}" target="_blank">View</a></td>
							</tr>
						`;
                        });

                        html += `
							</tbody>
						</table>
					`;
                    } else {
                        html += `<p>No attachments found.</p>`;
                    }

                    // Append HTML inside the wrapper
                    wrapper.append(html);
                }
            });


            // Fetch and render tasks + button inside HTML field
            frappe.call({
                method: 'erp_dacsinc_custom.custom_lead.get_tasks_for_lead',
                args: {
                    lead_name: frm.doc.name
                },
                callback: function (r) {
                    let rows = '';
                    if (r.message && r.message.length > 0) {
                        rows = r.message.map(task => `
							<tr>
								<td style="border: solid 2px #bcb9b4;"><a href="/app/task/${task.name}" target="_blank">${task.name}</a></td>
								<td style="border: solid 2px #bcb9b4;">${task.subject}</td>
								<td style="border: solid 2px #bcb9b4;">${task.status}</td>
								<td style="border: solid 2px #bcb9b4;">${frappe.datetime.str_to_user(task.exp_end_date || '')}</td>
							</tr>
						`).join('');
                    } else {
                        rows = `<tr><td colspan="4" class="text-center">No tasks found.</td></tr>`;
                    }

                    let html = `
						<div style="margin-top: 10px">
							<button class="btn btn-primary btn-sm create-task-btn" style="margin-bottom: 15px;">
								+ Create Task
							</button>
							<h4>Tasks for this Lead</h4>
							<table class="table table-bordered">
								<thead>
									<tr style="background-color:#3498DB; color:white; text-align: left;">
										<th style="vertical-align: middle; border: solid 2px #bcb9b4;">Task ID</th>
										<th style="vertical-align: middle; border: solid 2px #bcb9b4;">Subject</th>
										<th style="vertical-align: middle; border: solid 2px #bcb9b4;">Status</th>
										<th style="vertical-align: middle; border: solid 2px #bcb9b4;">Due Date</th>
									</tr>
								</thead>
								<tbody>
									${rows}
								</tbody>
							</table>
						</div>
					`;

                    // Inject into custom HTML field
                    frm.fields_dict.custom_task_html.$wrapper.html(html);

                    // Attach click handler for the button inside the HTML
                    frm.fields_dict.custom_task_html.$wrapper
                        .find('.create-task-btn')
                        .on('click', function () {
                            frappe.new_doc('Task', {
                                custom_lead_id: frm.doc.name
                            });
                        });
                }
            });
        }

        calculate_lead_age(frm);
        quotation_html(frm)
        // if (frm.doc.name ) { 

        frappe.call({
            method: 'erp_dacsinc_custom.custom_lead.get_activities_for_lead', // Replace with your app and module path
            args: {
                lead_name: frm.doc.name
            },
            callback: function (r) {
                let wrapper = $(frm.fields_dict.custom_todo_and_event_html.wrapper);
                let activities = r.message;

                if (activities && (activities.todos.length > 0 || activities.events.length > 0)) {
                    let htmlContent = '';

                    // --- Build To-Do Table ---
                    if (activities.todos.length > 0) {
                        htmlContent += `
                            <h4>To-Dos (${activities.todos.length})</h4>
                            <table class="table table-bordered table-sm">
                                <thead style="background-color: #f4f6f8;">
                                    <tr>
                                        <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Subject</th>
                                        <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Status</th>
                                        <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Allocated to</th>
                                        <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Due Date</th>
                                    </tr>
                                </thead>
                                <tbody>`;

                        activities.todos.forEach(todo => {
                            let todo_link = `/app/todo/${todo.name}`;
                            let formatted_due_date = todo.date ? frappe.datetime.str_to_user(todo.date) : 'Not set';
                            htmlContent += `
                                <tr>
                                    <td style="border: solid 2px #bcb9b4;"><a href="${todo_link}" target="_blank">${todo.description}</a></td>
                                    <td style="border: solid 2px #bcb9b4;">${todo.status}</td>
                                    <td style="border: solid 2px #bcb9b4;">${todo.allocated_to}</td>
                                    <td style="border: solid 2px #bcb9b4;">${formatted_due_date}</td>
                                </tr>`;
                        });
                        htmlContent += '</tbody></table>';
                    }

                    // --- Build Event Table ---
                    if (activities.events.length > 0) {
                        htmlContent += `
                            <h4 class="mt-4">Events (${activities.events.length})</h4>
                            <table class="table table-bordered table-sm">
                                <thead style="background-color: #f4f6f8;">
                                    <tr>
                                        <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Subject</th>
                                        <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Status</th>
                                        <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Starts On</th>
                                    </tr>
                                </thead>
                                <tbody>`;

                        activities.events.forEach(event => {
                            let event_link = `/app/event/${event.name}`;
                            let formatted_starts_on = event.starts_on ? frappe.datetime.str_to_user(event.starts_on) : 'Not set';
                            htmlContent += `
                                <tr>
                                    <td style="border: solid 2px #bcb9b4;"><a href="${event_link}" target="_blank">${event.subject}</a></td>
                                    <td style="border: solid 2px #bcb9b4;">${event.status}</td>
                                    <td style="border: solid 2px #bcb9b4;">${formatted_starts_on}</td>
                                </tr>`;
                        });
                        htmlContent += '</tbody></table>';
                    }

                    wrapper.html(htmlContent);

                } else {
                    // If no activities are found
                    wrapper.html('<p class="text-muted">No To-dos or Events found for this lead.</p>');
                }
            }
        });
        // }

    },

    country: function (frm) {
        // Reset dependent fields
        frm.set_value('custom_custom_state', '');
        frm.set_value('custom_custom_city', '');
        set_state_options(frm);
    },

    custom_custom_state: function (frm) {
        // Reset dependent fields
        frm.set_value('custom_custom_city', '');
        set_city_options(frm);
    }
})

function quotation_html(frm) {
    frappe.call({
        method: 'erp_dacsinc_custom.custom_lead.get_quotations_for_lead',  // Replace with your app and module path
        args: {
            lead_name: frm.doc.name
        },
        callback: function (r) {
            if (r.message && r.message.length) {
                let quotations = r.message;

                // Get the count of quotations
                let quotationCount = quotations.length;

                // Start building the HTML content
                let htmlContent = `
                            <div class="quotation-summary">
                                <p><strong>Total Quotations: ${quotationCount}</strong></p>
                            </div>
                            <div class="quotation-list-wrapper">
                                <table class="table table-bordered">
                                    <thead style="padding: 8px; border: 1px solid #ddd; background-color: #3498DB; color: #ffffff;">
                                        <tr style="background-color:#3498DB; color:white; text-align: left;">
                                            <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Quotation ID</th>
                                            <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Status</th>
                                            <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Customer Name</th>
                                            <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Date</th>
                                            <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Items</th>
                                            <th style="vertical-align: middle; border: solid 2px #bcb9b4;">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>`;

                // Iterate over the quotations to build each row
                quotations.forEach(quotation => {
                    let items = quotation.items.length > 0 ? quotation.items.join(', ') : 'No items';
                    let quotation_link = `/app/quotation/${quotation.quotation_id}`;
                    let formatted_date = frappe.datetime.str_to_user(quotation.transaction_date);
                    let formatted_total = format_currency(quotation.grand_total, 'INR');

                    htmlContent += `
                                <tr>
                                    <td style="border: solid 2px #bcb9b4;"><a href="${quotation_link}" target="_blank">${quotation.quotation_id}</a></td>
                                    <td style="border: solid 2px #bcb9b4;">${quotation.status}</td>
                                    <td style="border: solid 2px #bcb9b4;">${quotation.customer_name}</td>
                                    <td style="border: solid 2px #bcb9b4;">${formatted_date}</td>
                                    <td style="border: solid 2px #bcb9b4;">${items}</td>
                                    <td style="border: solid 2px #bcb9b4;">${formatted_total}</td>
                                </tr>`;
                });

                htmlContent += `</tbody></table></div>`;

                // Insert the HTML content into the custom_quotation_html field
                $(frm.fields_dict.custom_quotation_html.wrapper).html(htmlContent);
            } else {
                // If no quotations are found
                $(frm.fields_dict.custom_quotation_html.wrapper).html('<p>No quotations found for this lead.</p>');
            }
        }
    });

}


function render_lead_activities(frm) {
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Event Activity",
            filters: {
                reference_type: "Lead",
                reference_name: frm.doc.name
            },
            fields: ["name", "subject", "category", "status", "starts_on", "assigned_to", "description", "notes"],
            order_by: "creation desc"
        },
        callback: function (r) {
            if (!frm.fields_dict.custom_lead_activity_html) return;
            let wrapper = $(frm.fields_dict.custom_lead_activity_html.wrapper);
            let activities = r.message || [];

            // --- Build category summary counts ---
            let categoryCounts = {};
            let statusCounts = {};

            activities.forEach(activity => {
                let cat = activity.category || "Uncategorized";
                categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;

                let stat = activity.status || "Unknown";
                statusCounts[stat] = (statusCounts[stat] || 0) + 1;
            });

            let categorySummaryHtml = `
                <div  style="margin-bottom: 10px; padding: 8px; background: #f8f9fa; border: 1px solid #ddd; border-radius: 4px;">
                    <strong>Category Summary:</strong> 
                    ${Object.keys(categoryCounts).map(cat =>
                `<span style="margin-right:15px;">
                            ${cat}: <span style="color:#3498DB; font-weight:bold;">${categoryCounts[cat]}</span>
                        </span>`
            ).join("")}
                </div>
            `;

            let statusSummaryHtml = `
                <div style="margin-bottom: 10px; padding: 8px; background: #f8f9fa; border: 1px solid #ddd; border-radius: 4px;">
                    <strong>Status Summary:</strong> 
                    ${Object.keys(statusCounts).map(stat => {
                let color = (stat === "Open") ? "green" : (stat === "Completed") ? "blue" : "red";
                return `<span style="margin-right:15px;">
                            ${stat}: <span style="color:${color}; font-weight:bold;">${statusCounts[stat]}</span>
                        </span>`;
            }).join("")}
                </div>
            `;
            let rows = (r.message || []).map(activity => {
                return `
                    <tr>
                        <td><a href="/app/event-activity/${activity.name}" target="_blank">${activity.subject}</a></td>
                        <td>${activity.category}</td>
                        <td>${activity.status}</td>
                        <td>${frappe.datetime.str_to_user(activity.starts_on || "")}</td>
                        <td>${activity.assigned_to || "-"}</td>
                        <td>${activity.description || "-"}</td>
                        <td>${activity.notes || "-"}</td>
                        <td>
                            ${activity.status === "Open" ? `
                                <div class="dropdown">
                                    <button class="btn btn-sm btn-secondary dropdown-toggle" style="background-color:#3498DB;color:white;" type="button" data-toggle="dropdown">
                                        Actions
                                    </button>
                                    <div class="dropdown-menu">
                                        <a class="dropdown-item complete-action" data-id="${activity.name}" href="#">✅ Complete</a>
                                        <a class="dropdown-item complete-new-action" data-id="${activity.name}" href="#">🔄 Complete and Create new</a>
                                        <a class="dropdown-item cancel-action" data-id="${activity.name}" href="#">❌ Cancel</a>
                                    </div>
                                </div>
                            ` : "-"}
                        </td>
                    </tr>
                `;
            });

            let isLost = ['Lost Enquiry', 'Lost Pipeline'].includes(frm.doc.custom_lead_category);

            let html = `
                <div style="display:flex; justify-content: flex-end; margin-bottom:10px;">
                    ${!isLost ? `<button class="btn btn-sm btn-primary" id="create-lead-activity-btn">➕ Create Activity</button>` : ''}
                </div>
                ${categorySummaryHtml}
                ${statusSummaryHtml}
                <div style="overflow-x:auto; margin-top:10px;">
                    <table class="table table-bordered table-sm">
                        <thead style="background-color:#3498DB;color:white;text-align: left;">
                            <tr>
                                <th>Subject</th>
                                <th>Category</th>
                                <th>Status</th>
                                <th>Starts On</th>
                                <th>Assigned To</th>
                                <th>Description</th>
                                <th>Notes</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>${rows.join("")}</tbody>
                    </table>
                </div>
            `;
            wrapper.html(html);

            // Bind create new (only for active leads)
            if (!isLost) {
                wrapper.find("#create-lead-activity-btn").on("click", function () {
                    open_lead_activity_prompt(frm);
                });
            }

            // Bind dropdown actions
            wrapper.find(".complete-action").on("click", function (e) {
                e.preventDefault();
                handle_update_activity($(this).data("id"), "Completed", frm, false);
            });

            wrapper.find(".complete-new-action").on("click", function (e) {
                e.preventDefault();
                handle_update_activity($(this).data("id"), "Completed", frm, true);
            });

            wrapper.find(".cancel-action").on("click", function (e) {
                e.preventDefault();
                handle_update_activity($(this).data("id"), "Cancelled", frm, false);
            });
        }
    });
}

// Update handler
function handle_update_activity(activity_id, status, frm, create_new) {
    let fields = [
        {
            fieldname: "notes",
            label: (status === "Completed" ? "Completed Note" : "Cancelled Note"),
            fieldtype: "Small Text",
            reqd: 1
        }
    ];

    if (status === "Completed" || status === "Cancelled") {
        fields.push(
            {
                fieldname: "mark_lost",
                label: "Mark Lead as Lost",
                fieldtype: "Check",
                default: 0
            },
            {
                fieldname: "lost_reason",
                label: (frm.doc.custom_lead_category === "Enquiry" ? "Reason for Unqualified Lead" : "Reason for Lost"),
                fieldtype: "Link",
                options: (frm.doc.custom_lead_category === "Enquiry" ? "Lost Enquiry Reasons" : "Quotation Lost Reason"),
                reqd: 0,
                depends_on: "eval:doc.mark_lost"
            },
            {
                fieldname: "lost_reason_description",
                label: "Lost Reason Description",
                fieldtype: "Small Text",
                reqd: 0,
                depends_on: "eval:doc.mark_lost"
            }
        );
    }

    if (create_new) {
        fields.push(
            {
                fieldname: "new_sec",
                fieldtype: "Section Break",
                label: "Next Activity Details",
                depends_on: "eval:!doc.mark_lost"
            },
            {
                fieldname: "new_category",
                label: "Next Category",
                fieldtype: "Select",
                options: [
                    "Initial Call",
                    "Follow Up Call",
                    "Offline Initial Meeting",
                    "Offline Follow up Meeting",
                    "Offline Sample Meeting",
                    "Online Meeting",
                    "Proposal/Quotation",
                    "Order Closure",
                    "Others"
                ].join("\n"),
                default: "Follow Up Call",
                reqd: 0,
                depends_on: "eval:!doc.mark_lost"
            },
            {
                fieldname: "new_subject",
                label: "Next Subject",
                fieldtype: "Data",
                reqd: 0,
                depends_on: "eval:!doc.mark_lost"
            },
            {
                fieldname: "new_starts_on",
                label: "Next Followup Date",
                fieldtype: "Datetime",
                default: frappe.datetime.add_days(frappe.datetime.now_datetime(), 1),
                reqd: 0,
                depends_on: "eval:!doc.mark_lost"
            },
            {
                fieldname: "new_assigned_to",
                label: "Next Assigned To",
                fieldtype: "Link",
                options: "User",
                default: frappe.session.user,
                reqd: 0,
                depends_on: "eval:!doc.mark_lost"
            }
        );
    }

    let d = frappe.prompt(fields,
        function (values) {
            if (values.mark_lost) {
                if (!values.lost_reason || !values.lost_reason_description) {
                    frappe.msgprint("Please fill Lost Reason and Description");
                    return;
                }
                frappe.call({
                    method: "erp_dacsinc_custom.custom_lead.mark_lead_lost_backend",
                    args: {
                        lead_name: frm.doc.name,
                        category: frm.doc.custom_lead_category,
                        lost_reason: values.lost_reason,
                        lost_reason_description: values.lost_reason_description,
                        current_activity_id: activity_id,
                        completion_note: values.notes
                    },
                    callback: function (r) {
                        if (!r.exc) {
                            frappe.show_alert({ message: "Lead marked as LOST", indicator: "red" });
                            frm.reload_doc();
                        }
                    }
                });
            } else {
                if (create_new) {
                    if (!values.new_subject || !values.new_category || !values.new_starts_on || !values.new_assigned_to) {
                        frappe.msgprint("Please fill all next activity details");
                        return;
                    }
                }
                frappe.call({
                    method: "frappe.client.set_value",
                    args: {
                        doctype: "Event Activity",
                        name: activity_id,
                        fieldname: {
                            status: status,
                            notes: values.notes,
                            ends_on: status === "Completed" ? frappe.datetime.now_datetime() : null
                        }
                    },
                    callback: function (r) {
                        if (!r.exc) {
                            frappe.show_alert({ message: `Activity marked as ${status}`, indicator: (status === "Completed" ? "green" : "red") });
                            render_lead_activities(frm);

                            if (create_new) {
                                frappe.call({
                                    method: "frappe.client.insert",
                                    args: {
                                        doc: {
                                            doctype: "Event Activity",
                                            reference_type: "Lead",
                                            reference_name: frm.doc.name,
                                            subject: values.new_subject,
                                            category: values.new_category,
                                            starts_on: values.new_starts_on,
                                            assigned_to: values.new_assigned_to,
                                            status: "Open"
                                        }
                                    },
                                    callback: function (res) {
                                        if (res.message) {
                                            frappe.show_alert({ message: "Next Activity Created Successfully", indicator: "green" });
                                            render_lead_activities(frm);
                                        }
                                    }
                                });
                            }
                        }
                    }
                });
            }
        },
        `Mark as ${status}`,
        "Submit"
    );
    if (d && d.$wrapper) {
        d.$wrapper.addClass('dac-wide-modal');
    }
}

function open_lead_activity_prompt(frm) {
    let leadCategory = frm.doc.custom_lead_category || 'Enquiry';
    let d = frappe.prompt([
        {
            fieldname: "mark_completed",
            label: "Mark as Completed",
            fieldtype: "Check",
            default: 0
        },
        {
            fieldname: "completion_note",
            label: "Completion Note",
            fieldtype: "Small Text",
            reqd: 0,
            depends_on: "eval:doc.mark_completed"
        },
        {
            fieldname: "mark_lost",
            label: "Mark Lead as Lost",
            fieldtype: "Check",
            default: 0,
            depends_on: "eval:doc.mark_completed"
        },
        {
            fieldname: "lost_reason",
            label: (leadCategory === "Enquiry" ? "Reason for Unqualified Lead" : "Reason for Lost"),
            fieldtype: "Link",
            options: (leadCategory === "Enquiry" ? "Lost Enquiry Reasons" : "Quotation Lost Reason"),
            reqd: 0,
            depends_on: "eval:doc.mark_completed && doc.mark_lost"
        },
        {
            fieldname: "lost_reason_description",
            label: "Lost Reason Description",
            fieldtype: "Small Text",
            reqd: 0,
            depends_on: "eval:doc.mark_completed && doc.mark_lost"
        },
        {
            fieldname: "activity_sec",
            fieldtype: "Section Break",
            label: "Activity Details",
            depends_on: "eval:!doc.mark_lost"
        },
        {
            fieldname: "category",
            label: "Category",
            fieldtype: "Select",
            options: [
                "Initial Call",
                "Follow Up Call",
                "Offline Initial Meeting",
                "Offline Follow up Meeting",
                "Offline Sample Meeting",
                "Online Meeting",
                "Proposal/Quotation",
                "Order Closure",
                "Others"
            ].join("\n"),
            default: "Initial Call",
            reqd: 0,
            depends_on: "eval:!doc.mark_lost"
        },
        {
            fieldname: "subject",
            label: "Subject",
            fieldtype: "Data",
            reqd: 0,
            depends_on: "eval:!doc.mark_lost"
        },
        {
            fieldname: "starts_on",
            label: "Starts On",
            fieldtype: "Datetime",
            default: frappe.datetime.now_datetime(),
            reqd: 0,
            depends_on: "eval:!doc.mark_lost"
        },
        {
            fieldname: "assigned_to",
            label: "Assigned To",
            fieldtype: "Link",
            options: "User",
            default: frappe.session.user,
            reqd: 0,
            depends_on: "eval:!doc.mark_lost"
        }
    ],
        function (values) {
            // Case 1: Mark as Lost
            if (values.mark_completed && values.mark_lost) {
                if (!values.lost_reason || !values.lost_reason_description) {
                    frappe.msgprint("Please fill Lost Reason and Description before marking as Lost.");
                    return;
                }
                frappe.call({
                    method: "frappe.client.insert",
                    args: {
                        doc: {
                            doctype: "Event Activity",
                            reference_type: "Lead",
                            reference_name: frm.doc.name,
                            subject: values.subject || "Lead Marked as Lost",
                            category: values.category || "Others",
                            starts_on: values.starts_on || frappe.datetime.now_datetime(),
                            assigned_to: values.assigned_to || frappe.session.user,
                            status: "Completed",
                            notes: values.completion_note || "Lead marked as Lost"
                        }
                    },
                    callback: function (r) {
                        if (!r.exc && r.message) {
                            frappe.call({
                                method: "erp_dacsinc_custom.custom_lead.mark_lead_lost_backend",
                                args: {
                                    lead_name: frm.doc.name,
                                    category: leadCategory,
                                    lost_reason: values.lost_reason,
                                    lost_reason_description: values.lost_reason_description,
                                    current_activity_id: r.message.name,
                                    completion_note: values.completion_note || "Lead marked as Lost"
                                },
                                callback: function () {
                                    frappe.show_alert({ message: "Lead marked as LOST", indicator: "red" });
                                    frm.reload_doc();
                                }
                            });
                        }
                    }
                });
            } else {
                // Case 2: Normal activity creation
                if (!values.subject || !values.category || !values.starts_on || !values.assigned_to) {
                    frappe.msgprint("Please fill Subject, Category, Starts On and Assigned To.");
                    return;
                }
                frappe.call({
                    method: "frappe.client.insert",
                    args: {
                        doc: {
                            doctype: "Event Activity",
                            reference_type: "Lead",
                            reference_name: frm.doc.name,
                            subject: values.subject,
                            category: values.category,
                            starts_on: values.starts_on,
                            assigned_to: values.assigned_to,
                            status: values.mark_completed ? "Completed" : "Open",
                            notes: values.completion_note || ""
                        }
                    },
                    callback: function (r) {
                        if (r.message) {
                            frappe.show_alert({ message: "Activity Created Successfully", indicator: "green" });
                            frm.reload_doc();
                            frm.refresh_field('custom_is_activity_created');
                            render_lead_activities(frm);
                        }
                    }
                });
            }
        },
        "New Activity",
        "Create"
    );
    if (d && d.$wrapper) {
        d.$wrapper.addClass('dac-wide-modal');
    }
}

function calculate_lead_age(frm) {
    // Get the lead creation date
    let createdAt = frm.doc.custom_created_at;
    let leadId = frm.doc.name; // Assuming Lead ID is in frm.doc.name

    let ageInDays = "N/A";
    if (createdAt) {
        let createdDate = new Date(createdAt);
        let now = new Date();
        let ageInMilliseconds = now - createdDate;
        ageInDays = Math.floor(ageInMilliseconds / (1000 * 60 * 60 * 24));
    }

    // Fetch Event activity status counts
    frappe.call({
        method: "erp_dacsinc_custom.custom_lead.get_lead_activity_status",  // Replace with your actual method
        args: {
            lead_id: leadId
        },
        callback: function (response) {
            let openCount = response.message.open || 0;
            let closedCount = response.message.closed || 0;
            let totalCount = response.message.total || 0;

            // Build the card layout
            let htmlContent = `
                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <div style="flex: 1; padding: 15px; background: #f8f9fa; border-radius: 8px; text-align: center; box-shadow: 2px 2px 10px rgba(0,0,0,0.1);">
                        <h4>Lead Age</h4>
                        <p style="font-weight: bold; font-size: 18px;">${ageInDays} days</p>
                    </div>
                    <div style="flex: 1; padding: 15px; background: #f8f9fa; border-radius: 8px; text-align: center; box-shadow: 2px 2px 10px rgba(0,0,0,0.1);">
                        <h4>Total Activities</h4>
                        <p style="font-weight: bold; font-size: 18px; color: #004085;">${totalCount}</p>
                    </div>
                    <div style="flex: 1; padding: 15px; background: #f8f9fa; border-radius: 8px; text-align: center; box-shadow: 2px 2px 10px rgba(0,0,0,0.1);">
                        <h4>Open Activities</h4>
                        <p style="font-weight: bold; font-size: 18px; color: #155724;">${openCount}</p>
                    </div>
                    <div style="flex: 1; padding: 15px; background: #f8f9fa; border-radius: 8px; text-align: center; box-shadow: 2px 2px 10px rgba(0,0,0,0.1);">
                        <h4>Completed Activities</h4>
                        <p style="font-weight: bold; font-size: 18px; color: #721c24;">${closedCount}</p>
                    </div>
                    
                </div>
            `;

            // Update the HTML wrapper
            $(frm.fields_dict.custom_lead_age_html.wrapper).html(htmlContent);
        }
    });
}

// --- HELPER FUNCTIONS ---

function set_state_options(frm) {
    if (frm.location_data && frm.doc.country) {
        let country_data = frm.location_data[frm.doc.country];
        if (country_data) {
            // Get keys of the states (e.g., ["Maharashtra", "Karnataka"])
            let states = Object.keys(country_data).sort();
            frm.set_df_property('custom_custom_state', 'options', states);
        } else {
            frm.set_df_property('custom_custom_state', 'options', []);
        }
    } else {
        frm.set_df_property('custom_custom_state', 'options', []);
    }
    frm.refresh_field('custom_custom_state');
}

function set_city_options(frm) {
    if (frm.location_data && frm.doc.country && frm.doc.custom_custom_state) {
        let country_data = frm.location_data[frm.doc.country];
        if (country_data && country_data[frm.doc.custom_custom_state]) {
            // Get array of cities
            let cities = country_data[frm.doc.custom_custom_state].sort();
            frm.set_df_property('custom_custom_city', 'options', cities);
        } else {
            frm.set_df_property('custom_custom_city', 'options', []);
        }
    } else {
        frm.set_df_property('custom_custom_city', 'options', []);
    }
    frm.refresh_field('custom_custom_city');
}

/**
 * Removes special accents/marks from names.
 * Example: "Alnāvar" becomes "Alnavar"
 */
function clean_name(name) {
    if (!name) return "";
    return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}




