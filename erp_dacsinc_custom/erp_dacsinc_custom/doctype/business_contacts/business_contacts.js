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
        render_lead_customer_details(frm);
        if (frm.doc.status === "Open" && !frm.doc.__islocal) {
    
    // Check 1: Is the current user assigned to this record?
    let is_assigned_user = (frm.doc.assign_to === frappe.session.user);
    
    // Check 2: Is the user a "DAC CRM Head"?
    let is_crm_head = frappe.user_roles.includes("DAC CRM Head");

    if (is_assigned_user || is_crm_head) {
        frm.add_custom_button(__('Convert to Lead'), function() {
            
    // 1. Validation for Mobile Number
    if (!frm.doc.mobile_number) {
        frappe.msgprint(__('Please enter a Mobile Number first.'));
        return;
    }

    // 2. Validation for Source
    if (!frm.doc.source) {
        frappe.msgprint(__('Please set the <b>Source</b> field before converting.'));
        return;
    }

    // 3. Prompt User for Missing Details instead of just Confirming
    frappe.prompt([
        {
            label: 'Expected Revenue',
            fieldname: 'expected_revenue',
            fieldtype: 'Currency',
            reqd: 1 // Makes it mandatory to fill
        },
        {
            label: 'Expected Closure Date',
            fieldname: 'expected_closure_date',
            fieldtype: 'Date',
            reqd: 1 // Makes it mandatory to fill
        }
    ], function(values) {
        // This code runs when the user fills the prompt and clicks "Submit"
        frappe.call({
            method: "erp_dacsinc_custom.erp_dacsinc_custom.doctype.business_contacts.business_contacts.make_lead_from_contact",
            args: {
                source_name: frm.doc.name,
                expected_revenue: values.expected_revenue,
                expected_closure_date: values.expected_closure_date
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
    }, __('Enter Lead Details'), __('Convert to Lead')); // Prompt Title and Button Label

}).addClass("btn-primary");
    }
}
        if (frm.doc.lead_id) {
            frm.add_custom_button(__('Go to Lead'), function() {
                frappe.set_route('Form', 'Lead', frm.doc.lead_id);
            });
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




// --- NEW FUNCTION: Render Lead and Customer HTML ---
function render_lead_customer_details(frm) {
    let wrapper = frm.get_field("lead_and_customer_html").$wrapper;

    if (!frm.doc.lead_id) {
        wrapper.html(""); 
        return;
    }

    wrapper.html('<div class="text-muted text-center py-4"><i class="fa fa-spinner fa-spin"></i> Fetching Details...</div>');

    frappe.db.get_value("Lead", frm.doc.lead_id, [
        "name", "lead_name", "status", "custom_lead_customer",
        "custom_lead_type", "custom_expected_revenue",
        "custom_expected_closure_date", "lead_owner", "custom_lead_category"
    ]).then(r => {
        let lead = r.message;
        if (!lead) {
            wrapper.html('<div class="text-muted p-3 border rounded">Lead record not found.</div>');
            return;
        }

        // Generate Links for New Tab
        let lead_url = frappe.utils.get_form_link("Lead", lead.name);

        // Format Data
        let formatted_date = lead.custom_expected_closure_date ? frappe.datetime.str_to_user(lead.custom_expected_closure_date) : '--';
        let formatted_revenue = lead.custom_expected_revenue ? format_currency(lead.custom_expected_revenue, frappe.boot.sysdefaults.currency) : '--';
        
        // Define color for the Category badge
        let category_color = 'badge-primary'; 
        if (lead.custom_lead_category === 'Hot') category_color = 'badge-danger';
        if (lead.custom_lead_category === 'Cold') category_color = 'badge-info';

        // --- Clean Design HTML ---
        let html = `
            <div class="form-section mt-3">
                <div class="row">
                    <!-- Lead Details Card -->
                    <div class="col-md-6 mb-3">
                        <div class="p-4 border rounded d-flex flex-column h-100" style="background-color: #ffffff; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
                            
                            <!-- Header (Category as Badge) -->
                            <div class="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom">
                                <h5 class="mb-0" style="color: #1f272e; font-weight: 600; font-size: 15px;">
                                    <i class="fa fa-bullseye text-primary mr-2"></i> Lead Summary
                                </h5>
                                <span class="badge ${category_color} px-2 py-1" style="font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase;">
                                    ${lead.custom_lead_category || 'No Category'}
                                </span>
                            </div>
                            
                            <!-- Body / Fields -->
                            <div class="d-flex flex-column flex-grow-1" style="font-size: 13px; color: #36414C;">
                                <div class="d-flex justify-content-between py-1">
                                    <span class="text-muted">Lead Name</span>
                                    <span style="font-weight: 500;">${lead.lead_name || '--'}</span>
                                </div>
                                <div class="d-flex justify-content-between py-1">
                                    <span class="text-muted">Lead Owner</span>
                                    <span style="font-weight: 500;">${lead.lead_owner || '--'}</span>
                                </div>
                                <div class="d-flex justify-content-between py-1">
                                    <span class="text-muted">Lead Type</span>
                                    <span style="font-weight: 500;">${lead.custom_lead_type || '--'}</span>
                                </div>
                                <div class="d-flex justify-content-between py-1">
                                    <span class="text-muted">Expected Closure</span>
                                    <span style="font-weight: 500;">${formatted_date}</span>
                                </div>
                                <div class="d-flex justify-content-between py-2 mt-2 border-top" style="background-color: #f8f9fa; margin: 0 -1.5rem; padding: 0 1.5rem;">
                                    <span class="text-muted font-weight-bold" style="margin-top:2px;">Expected Revenue</span>
                                    <span style="font-weight: 600; color: #2e8b57; font-size: 14px;">${formatted_revenue}</span>
                                </div>
                            </div>
                            
                            <!-- Action Button -->
                            <div class="mt-3 text-right">
                                <a href="${lead_url}" target="_blank" class="btn btn-sm btn-default border" style="font-size: 11px; font-weight: 600; text-transform: uppercase;">
                                    Open Lead <i class="fa fa-external-link ml-1 text-muted"></i>
                                </a>
                            </div>

                        </div>
                    </div>
        `;

        if (lead.custom_lead_customer) {
            frappe.db.get_value("Customer", lead.custom_lead_customer, ["name", "customer_name", "customer_group"])
                .then(cust_r => {
                    let cust = cust_r.message;
                    if (cust) {
                        let cust_url = frappe.utils.get_form_link("Customer", cust.name);
                        html += `
                            <!-- Customer Details Card -->
                            <div class="col-md-6 mb-3">
                                <div class="p-4 border rounded d-flex flex-column h-100" style="background-color: #ffffff; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
                                    
                                    <!-- Header -->
                                    <div class="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom">
                                        <h5 class="mb-0" style="color: #1f272e; font-weight: 600; font-size: 15px;">
                                            <i class="fa fa-building-o text-success mr-2"></i> Customer Overview
                                        </h5>
                                    </div>
                                    
                                    <!-- Body / Fields -->
                                    <div class="d-flex flex-column flex-grow-1" style="font-size: 13px; color: #36414C;">
                                        <div class="d-flex justify-content-between py-1">
                                            <span class="text-muted">Customer Name</span>
                                            <span style="font-weight: 500;">${cust.customer_name || '--'}</span>
                                        </div>
                                        <div class="d-flex justify-content-between py-1">
                                            <span class="text-muted">Customer Group</span>
                                            <span style="font-weight: 500;">${cust.customer_group || '--'}</span>
                                        </div>
                                    </div>
                                    
                                    <!-- Action Button -->
                                    <div class="mt-3 text-right">
                                        <a href="${cust_url}" target="_blank" class="btn btn-sm btn-default border" style="font-size: 11px; font-weight: 600; text-transform: uppercase;">
                                            Open Customer <i class="fa fa-external-link ml-1 text-muted"></i>
                                        </a>
                                    </div>

                                </div>
                            </div>
                        `;
                    }
                    html += `</div></div>`; 
                    wrapper.html(html);
                });
        } else {
            html += `</div></div>`; 
            wrapper.html(html);
        }
    });
}



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
        { fieldname: "category", label: "Category", fieldtype: "Select", reqd: 1, options: ["Initial Call","Visit","Follow Up Call","Mail/WA"].join("\n"), default: "Initial Call" },
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