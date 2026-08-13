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
    if (frm.doc.reference_type === 'Lead' && (status === 'Completed' || status === 'Cancelled')) {
        frappe.db.get_value("Lead", frm.doc.reference_name, "custom_lead_category").then((r) => {
            let cat = r.message ? r.message.custom_lead_category : 'Enquiry';
            show_combined_prompt(frm, status, title, is_new, 'Lead', frm.doc.reference_name, cat);
        });
    } else {
        show_combined_prompt(frm, status, title, is_new, frm.doc.reference_type, frm.doc.reference_name, null);
    }
}

function show_combined_prompt(frm, status, title, is_new, refType, refName, leadCategory) {
    let fields = [
        {
            fieldname: "notes",
            label: (status === "Completed" ? "Completed Note" : "Cancelled Note"),
            fieldtype: "Small Text",
            reqd: 1
        }
    ];

    if ((status === "Completed" || status === "Cancelled") && refType === "Lead") {
        fields.push(
            {
                fieldname: "mark_lost",
                label: "Mark Lead as Lost",
                fieldtype: "Check",
                default: 0
            },
            {
                fieldname: "lost_reason",
                label: (leadCategory === "Enquiry" ? "Reason for Unqualified Lead" : "Reason for Lost"),
                fieldtype: "Link",
                options: (leadCategory === "Enquiry" ? "Lost Enquiry Reasons" : "Quotation Lost Reason"),
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

    if (is_new) {
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

    frappe.prompt(fields, (v) => {
        if (v.mark_lost) {
            if (!v.lost_reason || !v.lost_reason_description) {
                frappe.msgprint("Please fill Lost Reason and Description");
                return;
            }
            frappe.call({
                method: "erp_dacsinc_custom.custom_lead.mark_lead_lost_backend",
                args: {
                    lead_name: refName,
                    category: leadCategory,
                    lost_reason: v.lost_reason,
                    lost_reason_description: v.lost_reason_description,
                    current_activity_id: frm.doc.name,
                    completion_note: v.notes
                },
                callback: function(r) {
                    if (!r.exc) {
                        frappe.show_alert({message: "Lead marked as LOST", indicator: "red"});
                        frm.reload_doc();
                    }
                }
            });
        } else {
            if (is_new) {
                if (!v.new_subject || !v.new_category || !v.new_starts_on || !v.new_assigned_to) {
                    frappe.msgprint("Please fill all next activity details");
                    return;
                }
            }
            frappe.call({
                method: "frappe.client.set_value",
                args: {
                    doctype: "Event Activity",
                    name: frm.doc.name,
                    fieldname: { status: status, notes: v.notes, ends_on: status === "Completed" ? frappe.datetime.now_datetime() : null }
                },
                callback: () => {
                    if (is_new) {
                        frappe.call({
                            method: "frappe.client.insert",
                            args: {
                                doc: {
                                    doctype: "Event Activity",
                                    reference_type: refType || '',
                                    reference_name: refName || '',
                                    subject: v.new_subject,
                                    category: v.new_category,
                                    starts_on: v.new_starts_on,
                                    assigned_to: v.new_assigned_to,
                                    status: "Open"
                                }
                            },
                            callback: function(res) {
                                if (res.message) {
                                    frappe.show_alert({message: "Next Activity Created Successfully", indicator: "green"});
                                    frm.reload_doc();
                                }
                            }
                        });
                    } else {
                        frm.reload_doc();
                    }
                }
            });
        }
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