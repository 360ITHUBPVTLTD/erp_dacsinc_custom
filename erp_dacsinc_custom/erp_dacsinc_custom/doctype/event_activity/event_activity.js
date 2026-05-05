frappe.ui.form.on("Event Activity", {
    refresh(frm) {
        render_reference(frm);

        if (frm.is_new()) return;
        frm.clear_custom_buttons();

        if (frm.doc.status === "Open") {
            frm.add_custom_button("Completed", () => {
                status_update_prompt(frm, "Completed", "Mark as Completed");
            }, __("Action"));

            frm.add_custom_button("Complete & New", () => {
                status_update_prompt(frm, "Completed", "Complete & Create New", true);
            }, __("Action"));

            frm.add_custom_button("Cancelled", () => {
                status_update_prompt(frm, "Cancelled", "Cancel Activity");
            }, __("Action"));
        }

        if (["Completed", "Cancelled"].includes(frm.doc.status)) {
            frm.add_custom_button("Reopen", () => {
                frappe.call({
                    method: "frappe.client.set_value",
                    args: {
                        doctype: "Event Activity",
                        name: frm.doc.name,
                        fieldname: { status: "Open", ends_on: null }
                    },
                    callback: () => frm.reload_doc()
                });
            }, __("Action"));
        }
    },
    reference_name: (frm) => render_reference(frm),
    reference_type: (frm) => render_reference(frm)
});

function status_update_prompt(frm, status, title, is_new = false) {
    frappe.prompt([{ label: "Note", fieldname: "notes", fieldtype: "Small Text", reqd: 1 }], (v) => {
        frappe.call({
            method: "frappe.client.set_value",
            args: {
                doctype: "Event Activity",
                name: frm.doc.name,
                fieldname: { status: status, notes: v.notes, ends_on: frappe.datetime.now_datetime() }
            },
            callback: () => {
                if (is_new) {
                    frappe.new_doc("Event Activity", {
                        reference_type: frm.doc.reference_type,
                        reference_name: frm.doc.reference_name
                    });
                } else {
                    frm.reload_doc();
                }
            }
        });
    }, __(title), __("Submit"));
}

function render_reference(frm) {
    if (!frm.fields_dict.lead_html) return;
    let section = frm.fields_dict.lead_html.$wrapper;

    if (frm.doc.reference_type && frm.doc.reference_name) {
        section.html(`<div class="text-center p-4"><i class="fa fa-spinner fa-spin fa-2x text-muted"></i></div>`);

        const method_map = {
            'Lead': 'erp_dacsinc_custom.erp_dacsinc_custom.doctype.event_activity.event_activity.get_lead_details',
            'Customer': 'erp_dacsinc_custom.erp_dacsinc_custom.doctype.event_activity.event_activity.get_customer_details',
            'Supplier': 'erp_dacsinc_custom.erp_dacsinc_custom.doctype.event_activity.event_activity.get_supplier_details',
            'Business Contacts': 'erp_dacsinc_custom.erp_dacsinc_custom.doctype.event_activity.event_activity.get_business_contact_details'
        };

        let method = method_map[frm.doc.reference_type];
        
        if (!method) {
            section.html(`<div class="alert alert-warning text-center">Reference type ${frm.doc.reference_type} not configured.</div>`);
            return;
        }

        frappe.call({
            method: method,
            args: { id: frm.doc.reference_name },
            callback: function(r) {
                if (r.message) {
                    let d = r.message;
                    
                    // FIXED: Safer way to generate the form URL
                    let link = frappe.utils.get_form_link(frm.doc.reference_type, d.name);

                    let html = `
                        <div style="overflow-x:auto; margin-top:10px;">
                            <table class="table table-bordered shadow-sm" style="background:white; border-radius: 8px;">
                                <thead class="bg-light">
                                    <tr>
                                        <th style="width: 25%">${frm.doc.reference_type} Name</th>
                                        <th>Contact Info</th>
                                        <th>Organization</th>
                                        <th>Industry/Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>
                                            <a href="${link}" target="_blank" style="font-weight:bold; color:#007bff;">${d.lead_name || d.name}</a>
                                            <div class="small text-muted">${d.name}</div>
                                        </td>
                                        <td>
                                            <div><i class="fa fa-envelope text-muted" style="margin-right:5px;"></i> ${d.email_id || '-'}</div>
                                            <div><i class="fa fa-phone text-muted" style="margin-right:5px;"></i> ${d.mobile_no || '-'}</div>
                                        </td>
                                        <td>
                                            <div class="font-weight-bold">${d.company_name || '-'}</div>
                                        </td>
                                        <td>
                                            <div class="badge badge-info mb-1" style="background-color: #d1ecf1; color: #0c5460; border:none; padding: 4px 8px;">
                                                ${d.custom_lead_category || '-'}
                                            </div>
                                            <div class="small text-muted">Status: ${d.status || '-'}</div>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    `;
                    section.html(html);
                } else {
                    section.html(`<div class="text-center p-3 text-muted">Record ${frm.doc.reference_name} not found.</div>`);
                }
            }
        });
    } else {
        section.html(`<div class="text-center p-3 text-muted border" style="border-style: dashed !important;">Select a reference to view details.</div>`);
    }
}