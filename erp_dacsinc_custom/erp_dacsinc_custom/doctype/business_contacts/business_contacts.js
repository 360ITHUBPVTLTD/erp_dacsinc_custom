frappe.ui.form.on("Business Contacts", {
    refresh(frm) {

        if (!frm.location_data) {
            frappe.db.get_single_value('Location Master', 'data_json').then(val => {
                if (val) {
                    frm.location_data = JSON.parse(val);
                    // Update options for existing records
                    if (frm.doc.country) {
                        set_state_options(frm);
                        if (frm.doc.state) {
                            set_city_options(frm);
                        }
                    }
                }
            });
        }
        render_lead_activities(frm);

        if (frm.doc.status === "Open" && !frm.doc.__islocal) {
    
    // Check 1: Is the current user assigned to this record?
    let is_assigned_user = (frm.doc.assigned_to === frappe.session.user);
    
    // Check 2: Is the user a "DAC CRM Head"?
    let is_crm_head = frappe.user_roles.includes("DAC CRM Head");

    if (is_assigned_user ) {
        frm.add_custom_button(__('Convert to Lead'), function() {
            
            // 1. Validation for Mobile Number
            if (!frm.doc.mobile_number) {
                frappe.msgprint(__('Please enter a Mobile Number first.'));
                return;
            }

            // 2. Validation for Source (based on your snippet using frm.doc.source)
            if (!frm.doc.source) {
                frappe.msgprint(__('Please set the <b>Source</b> field before converting.'));
                return;
            }

            // 3. Confirmation Dialog
            frappe.confirm(
                __('Are you sure you want to convert this Business Contact into a Lead?'),
                function() {
                    // This code runs if the user clicks "Yes"
                    frappe.call({
                        method: "erp_dacsinc_custom.erp_dacsinc_custom.doctype.business_contacts.business_contacts.make_lead_from_contact",
                        args: {
                            source_name: frm.doc.name
                        },
                        freeze: true,
                        freeze_message: __("Converting to Lead..."),
                        callback: function(r) {
                            if (r.message) {
                                frappe.show_alert({
                                    message: __('Lead Created Successfully'), 
                                    indicator: 'green'
                                });
                                frm.reload_doc();
                            }
                        }
                    });
                }
                // Optional: you can add a callback for "No" here
            );

        }).addClass("btn-primary");
    }
}
    },
    country: function(frm) {
        frm.set_value('state', '');
        frm.set_value('city', '');
        set_state_options(frm);
    },

    state: function(frm) {
        frm.set_value('city', '');
        set_city_options(frm);
    }
});




function set_state_options(frm) {
    if (frm.location_data && frm.doc.country) {
        let country_data = frm.location_data[frm.doc.country];
        if (country_data) {
            let states = Object.keys(country_data).sort();
            frm.set_df_property('state', 'options', states);
        } else {
            frm.set_df_property('state', 'options', []);
        }
    }
    frm.refresh_field('state');
}

function set_city_options(frm) {
    if (frm.location_data && frm.doc.country && frm.doc.state) {
        let country_data = frm.location_data[frm.doc.country];
        if (country_data && country_data[frm.doc.state]) {
            let cities = country_data[frm.doc.state].sort();
            frm.set_df_property('city', 'options', cities);
        } else {
            frm.set_df_property('city', 'options', []);
        }
    }
    frm.refresh_field('city');
}

function render_lead_activities(frm) {
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Event Activity",
            filters: {
                reference_type: "Business Contacts", // Corrected for your Doctype
                reference_name: frm.doc.name
            },
            fields: ["name", "subject", "category", "status", "starts_on", "assigned_to", "description", "notes"],
            order_by: "creation desc"
        },
        callback: function(r) {
            let activities = r.message || [];
            // Calling the build function directly without fetching Employee names
            build_activity_table(frm, activities);
        }
    });
}

function build_activity_table(frm, activities) {
    let wrapper = $(frm.fields_dict.activity_html.wrapper);

    // --- Build summaries ---
    let categoryCounts = {};
    let statusCounts = {};

    activities.forEach(activity => {
        let cat = activity.category || "Uncategorized";
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;

        let stat = activity.status || "Unknown";
        statusCounts[stat] = (statusCounts[stat] || 0) + 1;
    });

    let categorySummaryHtml = `
        <div style="margin-bottom: 10px; padding: 8px; background: #f8f9fa; border: 1px solid #ddd; border-radius: 4px;">
            <strong>Category Summary:</strong> 
            ${Object.keys(categoryCounts).map(cat => 
                `<span style="margin-right:15px;">${cat}: <span style="color:#3498DB; font-weight:bold;">${categoryCounts[cat]}</span></span>`
            ).join("")}
        </div>
    `;

    let statusSummaryHtml = `
        <div style="margin-bottom: 10px; padding: 8px; background: #f8f9fa; border: 1px solid #ddd; border-radius: 4px;">
            <strong>Status Summary:</strong> 
            ${Object.keys(statusCounts).map(stat => {
                let color = (stat === "Open") ? "green" : (stat === "Completed") ? "blue" : "red";
                return `<span style="margin-right:15px;">${stat}: <span style="color:${color}; font-weight:bold;">${statusCounts[stat]}</span></span>`;
            }).join("")}
        </div>
    `;

    let rows = activities.map(activity => {
        return `
            <tr>
                <td><a href="/app/event-activity/${activity.name}" target="_blank">${activity.subject}</a></td>
                <td>${activity.category || ""}</td>
                <td><span class="badge ${activity.status === 'Open' ? 'badge-success' : 'badge-default'}">${activity.status}</span></td>
                <td>${frappe.datetime.str_to_user(activity.starts_on || "")}</td>
                <td>${activity.assigned_to || "-"}</td>
                <td>${activity.description || "-"}</td>
                <td>${activity.notes || "-"}</td>
                <td>
                    ${activity.status === "Open" ? `
                        <div class="dropdown">
                            <button class="btn btn-xs btn-secondary dropdown-toggle" style="background-color:#3498DB;color:white;" type="button" data-toggle="dropdown">
                                Actions
                            </button>
                            <div class="dropdown-menu">
                                <a class="dropdown-item complete-action" data-id="${activity.name}" href="#">✅ Complete</a>
                                <a class="dropdown-item complete-new-action" data-id="${activity.name}" href="#">🔄 Complete & New</a>
                                <a class="dropdown-item cancel-action" data-id="${activity.name}" href="#">❌ Cancel</a>
                            </div>
                        </div>
                    ` : "-"}
                </td>
            </tr>
        `;
    });

    let html = `
        <div style="display:flex; justify-content: flex-end; margin-bottom:10px;">
            <button class="btn btn-xs btn-primary" id="create-lead-activity-btn">➕ Create Activity</button>
        </div>
        ${categorySummaryHtml}
        ${statusSummaryHtml}
        <div style="overflow-x:auto; margin-top:10px;">
            <table class="table table-bordered table-sm" style="font-size:12px;">
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
                <tbody>${rows.length ? rows.join("") : '<tr><td colspan="8" class="text-center">No Activities Found</td></tr>'}</tbody>
            </table>
        </div>
    `;

    wrapper.html(html);

    // Bind event listeners
    wrapper.find("#create-lead-activity-btn").on("click", () => open_lead_activity_prompt(frm));
    wrapper.find(".complete-action").on("click", function(e) {
        e.preventDefault();
        handle_update_activity($(this).data("id"), "Completed", frm, false);
    });
    wrapper.find(".complete-new-action").on("click", function(e) {
        e.preventDefault();
        handle_update_activity($(this).data("id"), "Completed", frm, true);
    });
    wrapper.find(".cancel-action").on("click", function(e) {
        e.preventDefault();
        handle_update_activity($(this).data("id"), "Cancelled", frm, false);
    });
}

// Handler for status updates
function handle_update_activity(activity_id, status, frm, create_new) {
    frappe.prompt([{ fieldname: "notes", label: "Note", fieldtype: "Small Text", reqd: 1 }],
    (values) => {
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
            callback: (r) => {
                if (!r.exc) {
                    frappe.show_alert({message: `Activity marked as ${status}`, indicator: (status === "Completed" ? "green" : "red")});
                    render_lead_activities(frm);
                    if (create_new) open_lead_activity_prompt(frm);
                }
            }
        });
    }, `Mark as ${status}`, "Submit");
}

// Prompt to create a new activity
function open_lead_activity_prompt(frm) {
    frappe.prompt([
        { fieldname: "mark_completed", label: "Mark as Completed", fieldtype: "Check", default: 0 },
        { fieldname: "category", label: "Category", fieldtype: "Select", reqd: 1, options: ["Initial Call","Visit","Follow Up Call","Mail"].join("\n"), default: "Initial Call" },
        { fieldname: "subject", label: "Subject", fieldtype: "Data", reqd: 1 },
        { fieldname: "starts_on", label: "Starts On", fieldtype: "Datetime", default: frappe.datetime.now_datetime(), reqd: 1 },
        { fieldname: "assigned_to", label: "Assigned To", fieldtype: "Link", options: "User", default: frappe.session.user, reqd: 1 },
        { fieldname: "description", label: "Description", fieldtype: "Small Text" }
    ],
    (values) => {
        frappe.call({
            method: "frappe.client.insert",
            args: {
                doc: {
                    doctype: "Event Activity",
                    reference_type: "Business Contacts",
                    reference_name: frm.doc.name,
                    subject: values.subject,
                    category: values.category,
                    starts_on: values.starts_on,
                    assigned_to: values.assigned_to,
                    description: values.description,
                    status: values.mark_completed ? "Completed" : "Open"
                }
            },
            callback: (r) => {
                if (r.message) {
                    frappe.msgprint("Activity Created Successfully");
                    render_lead_activities(frm);
                }
            }
        });
    }, "New Activity", "Create");
}