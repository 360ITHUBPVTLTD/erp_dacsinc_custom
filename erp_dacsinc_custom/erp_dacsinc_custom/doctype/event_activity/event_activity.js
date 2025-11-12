// Copyright (c) 2025, Pankaj and contributors
// For license information, please see license.txt

frappe.ui.form.on("Event Activity", {
	refresh(frm) {
        render_reference(frm);
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

function render_reference(frm) {
    let section = frm.fields_dict.lead_html.$wrapper;

    // Loading spinner
    section.html(`
        <div style="text-align:center; padding:20px;">
            <span class="fa fa-spinner fa-spin fa-2x text-muted"></span>
            <p class="text-muted" style="margin-top: 10px;">Loading data...</p>
        </div>
    `);

    if (frm.doc.reference_type && frm.doc.reference_name) {
        let method_map = {
            'Lead': 'erp_dacsinc_custom.custom_lead.get_lead_details',
            'Customer': 'erp_dacsinc_custom.custom_lead.get_customer_details',
            'Supplier': 'erp_dacsinc_custom.custom_lead.get_supplier_details'
        };

        let method = method_map[frm.doc.reference_type];
        if (!method) {
            section.html(`<div style="text-align:center; padding:20px; color:#666;">
                <p>Unsupported reference type: ${frm.doc.reference_type}</p>
            </div>`);
            return;
        }

        frappe.call({
            method: method,
            args: { id: frm.doc.reference_name },
            callback: function(r) {
                if (r.message) {
                    let doc = r.message;

                    // Handle display name based on type
                    let display_name = "-";
                    let category = "-";
                    let company = "-";

                    if (frm.doc.reference_type === "Lead") {
                        display_name = frm.doc.reference_doc_name || "-";
                        category = doc.custom_lead_category || "-";
                        company = doc.company_name || "-";
                    } else if (frm.doc.reference_type === "Customer") {
                        display_name = frm.doc.reference_doc_name || "-";
                        company =  "-";
                    } else if (frm.doc.reference_type === "Supplier") {
                        display_name = frm.doc.reference_doc_name || "-";
                        company = "-";
                    }

                    let email = doc.email_id || "-";
                    let mobile = doc.mobile_no || "-";

                    let html = `
                        <div style="overflow-x:auto; margin-top:15px;">
                            <table class="table table-bordered">
                                <thead>
                                    <tr style="background-color:#3498DB; color:white; text-align: left;">
                                        <th style="padding:12px;">${frm.doc.reference_type} Name</th>
                                        <th style="padding:12px;">Email</th>
                                        <th style="padding:12px;">Mobile</th>
                                        <th style="padding:12px;">Company</th>
                                        <th style="padding:12px;">Category</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr style="border-bottom:1px solid #eee;">
                                        <td style="padding:10px; font-weight:600;">
                                            <a href="${doc.link || '#'}" target="_blank" style="color:#007bff; text-decoration:none;">
                                                ${display_name}
                                            </a>
                                            <div style="font-size:11px; color:#888;">(${frm.doc.reference_name})</div>
                                        </td>
                                        <td style="padding:10px;">${email}</td>
                                        <td style="padding:10px;">${mobile}</td>
                                        <td style="padding:10px;">${company}</td>
                                        <td style="padding:10px; font-weight:500; color:#333;">
                                            <span style="background:#eef5ff; padding:4px 10px; border-radius:12px; font-size:12px;">
                                                🏷️ ${category}
                                            </span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    `;
                    section.html(html);
                } else {
                    section.html(`<div style="text-align:center; padding:20px; color:#666;">
                        <p>No ${frm.doc.reference_type} found for this record. 😟</p>
                    </div>`);
                }
            }
        });
    } else {
        section.html(`<div style="text-align:center; padding:20px; color:#666;">
            <p>No reference linked with this record. 😟</p>
        </div>`);
    }
}
