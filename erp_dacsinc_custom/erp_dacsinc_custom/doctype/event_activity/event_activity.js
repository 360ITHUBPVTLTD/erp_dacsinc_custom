// Copyright (c) 2025, Pankaj and contributors
// For license information, please see license.txt

frappe.ui.form.on("Event Activity", {
	refresh(frm) {
        render_leads(frm);
        if (frm.is_new()) return;

        // Clear old custom buttons
        frm.clear_custom_buttons();

        if (frm.doc.status === "Open") {
            // ✅ Completed
            frm.add_custom_button("Completed", () => {
                frappe.prompt([
                    {
                        label: "Completed Note",
                        fieldname: "notes",
                        fieldtype: "Small Text",
                        reqd: 1
                    }
                ], (values) => {
                    frappe.call({
                        method: "frappe.client.set_value",
                        args: {
                            doctype: "Event Activity",
                            name: frm.doc.name,
                            fieldname: {
                                status: "Completed",
                                notes: values.notes,
                                ends_on: frappe.datetime.now_datetime()
                            }
                        },
                        callback: () => frm.reload_doc()
                    });
                }, __("Mark as Completed"), __("Submit"));
            }, __("Action"));

            // ✅ Complete & New
            frm.add_custom_button("Complete & New", () => {
                frappe.prompt([
                    {
                        label: "Completed Note",
                        fieldname: "notes",
                        fieldtype: "Small Text",
                        reqd: 1
                    }
                ], (values) => {
                    frappe.call({
                        method: "frappe.client.set_value",
                        args: {
                            doctype: "Event Activity",
                            name: frm.doc.name,
                            fieldname: {
                                status: "Completed",
                                notes: values.notes,
                                ends_on: frappe.datetime.now_datetime()
                            }
                        },
                        callback: () => {
                            frm.reload_doc();

                            // Create new Event Activity with same reference
                            frappe.new_doc("Event Activity", {
                                reference_type: frm.doc.reference_type,
                                reference_name: frm.doc.reference_name
                            });
                        }
                    });
                }, __("Complete & Create New"), __("Submit"));
            }, __("Action"));

            // ✅ Cancelled
            frm.add_custom_button("Cancelled", () => {
                frappe.prompt([
                    {
                        label: "Cancellation Note",
                        fieldname: "notes",
                        fieldtype: "Small Text",
                        reqd: 1
                    }
                ], (values) => {
                    frappe.call({
                        method: "frappe.client.set_value",
                        args: {
                            doctype: "Event Activity",
                            name: frm.doc.name,
                            fieldname: {
                                status: "Cancelled",
                                notes: values.notes,
                                ends_on: frappe.datetime.now_datetime()
                            }
                        },
                        callback: () => frm.reload_doc()
                    });
                }, __("Cancel Activity"), __("Submit"));
            }, __("Action"));
        }

        if (frm.doc.status === "Completed" || frm.doc.status === "Cancelled") {
            frm.add_custom_button("Reopen", () => {
                frappe.call({
                    method: "frappe.client.set_value",
                    args: {
                        doctype: "Event Activity",
                        name: frm.doc.name,
                        fieldname: {
                            status: "Open",
                            ends_on: null
                        }
                    },
                    callback: () => frm.reload_doc()
                });
            }, __("Action"));
        }
	},
});


function render_leads(frm) {
    let lead_section = frm.fields_dict.lead_html.$wrapper;

    // Loading spinner
    lead_section.html(`
        <div style="text-align:center; padding:20px;">
            <span class="fa fa-spinner fa-spin fa-2x text-muted"></span>
            <p class="text-muted" style="margin-top: 10px;">Loading leads...</p>
        </div>
    `);

    // Check if event is linked to a Lead
    if (frm.doc.reference_type === "Lead" && frm.doc.reference_name) {
        frappe.call({
            method: "erp_dacsinc_custom.custom_lead.get_lead_details",
            args: { lead_id: frm.doc.reference_name },
            callback: function(r) {
                if (r.message) {
                    let lead = r.message;
                    let lead_category = lead.custom_lead_category || "No Category";
                    let email = lead.email_id || "-";
                    let mobile = lead.mobile_no || "-";
                    let company = lead.company_name || "-";

                    let html = `
                        <div style="overflow-x:auto; margin-top:15px;">
                            <table class="table table-bordered">
                                <thead>
                                    <tr style="background-color:#3498DB; color:white; text-align: left;">
                                        <th style="padding:12px;">Lead Name</th>
                                        <th style="padding:12px;">Email</th>
                                        <th style="padding:12px;">Mobile</th>
                                        <th style="padding:12px;">Company</th>
                                        <th style="padding:12px;">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr style="border-bottom:1px solid #eee;">
                                        <td style="padding:10px; font-weight:600;">
                                            <a href="${lead.link}" target="_blank" style="color:#007bff; text-decoration:none;">
                                                ${lead.lead_name}
                                            </a>
                                            <div style="font-size:11px; color:#888;">(${frm.doc.reference_name})</div>
                                        </td>
                                        <td style="padding:10px;">${email}</td>
                                        <td style="padding:10px;">${mobile}</td>
                                        <td style="padding:10px;">${company}</td>
                                        <td style="padding:10px; font-weight:500; color:#333;">
                                            <span style="background:#eef5ff; padding:4px 10px; border-radius:12px; font-size:12px;">
                                                🏷️ ${lead_category}
                                            </span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    `;
                    lead_section.html(html);
                } else {
                    lead_section.html(`
                        <div class="no-leads-found" style="text-align:center; padding:20px; color:#666;">
                            <p style="font-size:16px;">No leads found for this event. 😟</p>
                        </div>
                    `);
                }
            }
        });
    } else {
        lead_section.html(`
            <div class="no-leads-found" style="text-align:center; padding:20px; color:#666;">
                <p style="font-size:16px;">No leads linked with this event. 😟</p>
            </div>
        `);
    }
}
