// ================================================================
//  Lead — List View
//  Hosts the manual "Trigger CRM Report" action. It used to sit on the
//  Lead form, where it was tied to whichever record happened to be open
//  even though the report has nothing to do with a single lead. The list
//  view is the right home for an action that spans the whole pipeline.
//
//  Restricted to System Manager.
// ================================================================

frappe.listview_settings['Lead'] = frappe.listview_settings['Lead'] || {};

(function () {
    const existing_onload = frappe.listview_settings['Lead'].onload;
    frappe.listview_settings['Lead'].onload = function (listview) {
        if (existing_onload) {
            try { existing_onload(listview); } catch (e) { /* keep ours working */ }
        }

        // System Manager only.
        if (!frappe.user_roles.includes('System Manager')) return;

        listview.page.add_action_item(__("Convert to Business Contact"), function () {
            const checked_items = listview.get_checked_items();
            if (!checked_items || checked_items.length === 0) return;

            const lead_names = checked_items.map(item => item.name);

            frappe.call({
                method: 'erp_dacsinc_custom.custom_lead.check_leads_for_conversion',
                args: {
                    lead_names: lead_names
                },
                freeze: true,
                freeze_message: __('Checking Leads...'),
                callback: function (r) {
                    if (r.message) {
                        const { already_converted, has_quotations, no_quotations } = r.message;
                        
                        let msg = `<h4>${__('Convert Leads to Business Contacts')}</h4>`;
                        msg += `<p>${__('You have selected {0} Lead(s) for conversion:', [lead_names.length])}</p>`;
                        
                        if (already_converted.length > 0) {
                            msg += `<p style="color: var(--orange-500, #ff8c00);">⚠️ <strong>${already_converted.length}</strong> ${__('Lead(s) are already converted/linked and will be skipped.')}</p>`;
                        }
                        if (has_quotations.length > 0) {
                            msg += `<p style="color: var(--blue-500, #007bff);">ℹ️ <strong>${has_quotations.length}</strong> ${__('Lead(s) have quotation(s). They will be linked to new Business Contacts, keeping the Leads alive.')}</p>`;
                        }
                        if (no_quotations.length > 0) {
                            msg += `<p style="color: var(--red-500, #d9534f);">⚠️ <strong>${no_quotations.length}</strong> ${__('Lead(s) have no quotation(s). They will be migrated and their Lead documents will be DELETED.')}</p>`;
                        }
                        
                        if (has_quotations.length === 0 && no_quotations.length === 0) {
                            frappe.msgprint(__('All selected Leads are already converted.'));
                            return;
                        }

                        msg += `<br><p><strong>${__('Do you want to proceed?')}</strong></p>`;

                        frappe.confirm(msg, function () {
                            frappe.call({
                                method: 'erp_dacsinc_custom.custom_lead.bulk_convert_leads',
                                args: {
                                    lead_names: lead_names
                                },
                                freeze: true,
                                freeze_message: __('Converting Leads...'),
                                callback: function (res) {
                                    if (res.message) {
                                        const { converted_linked, converted_deleted, skipped_already_converted, errors } = res.message;
                                        let summary = `<p>${__('Conversion Summary:')}</p><ul>`;
                                        if (converted_linked.length > 0) {
                                            summary += `<li>${__('Linked & Converted (kept alive): {0}', [converted_linked.length])}</li>`;
                                        }
                                        if (converted_deleted.length > 0) {
                                            summary += `<li>${__('Migrated & Deleted: {0}', [converted_deleted.length])}</li>`;
                                        }
                                        if (skipped_already_converted.length > 0) {
                                            summary += `<li>${__('Skipped (already converted): {0}', [skipped_already_converted.length])}</li>`;
                                        }
                                        if (errors.length > 0) {
                                            summary += `<li style="color: red;">${__('Errors: {0}', [errors.length])}</li>`;
                                        }
                                        summary += `</ul>`;

                                        frappe.msgprint({
                                            title: __('Bulk Conversion Completed'),
                                            message: summary,
                                            indicator: errors.length > 0 ? 'orange' : 'green'
                                        });

                                        listview.refresh();
                                    }
                                }
                            });
                        });
                    }
                }
            });
        });

        listview.page.add_inner_button(__('Trigger CRM Report'), function () {
            show_crm_report_dialog();
        }, __('Actions'));
    };
})();

function show_crm_report_dialog() {
    const d = new frappe.ui.Dialog({
        title: __('Manual Trigger CRM Report'),
        fields: [
            {
                label: __('Report Type'),
                fieldname: 'report_type',
                fieldtype: 'Select',
                options: [
                    { value: 'daily', label: __('Daily Report') },
                    { value: 'weekly', label: __('Weekly Report  (Sunday to Friday)') },
                    { value: 'monthly', label: __('Monthly Report  (full month)') }
                ],
                default: 'daily'
            },
            {
                fieldtype: 'HTML',
                fieldname: 'period_hint'
            },
            {
                label: __('Send to Admin Overall'),
                fieldname: 'send_to_admin',
                fieldtype: 'Check',
                default: 1
            },
            {
                label: __('Send to Team Member'),
                fieldname: 'send_to_team',
                fieldtype: 'Check',
                default: 0
            },
            {
                label: __('Select Team Member'),
                fieldname: 'team_member',
                fieldtype: 'Link',
                options: 'User',
                depends_on: 'eval:doc.send_to_team == 1',
                get_query: function () {
                    return { filters: { user_type: 'System User', enabled: 1 } };
                }
            }
        ],
        primary_action_label: __('Send Mail'),
        primary_action: function (values) {
            if (!values.send_to_admin && !values.send_to_team) {
                frappe.msgprint(__('Please select at least one recipient (Admin or Team Member).'));
                return;
            }
            if (values.send_to_team && !values.team_member) {
                frappe.msgprint(__('Please select a Team Member.'));
                return;
            }
            d.hide();
            frappe.call({
                method: 'erp_dacsinc_custom.custom_lead.trigger_crm_report',
                args: {
                    report_type: values.report_type,
                    send_to_admin: values.send_to_admin ? 1 : 0,
                    send_to_team: values.send_to_team ? 1 : 0,
                    team_member: values.team_member || ''
                },
                freeze: true,
                freeze_message: __('Sending reports...'),
                callback: function (r) {
                    if (r.message && r.message.status === 'success') {
                        frappe.show_alert({ message: r.message.message, indicator: 'green' }, 7);
                    } else {
                        frappe.msgprint({
                            title: __('Skipped or Failed'),
                            message: r.message ? r.message.message : __('Unknown error'),
                            indicator: 'orange'
                        });
                    }
                }
            });
        }
    });

    // Show the exact window the chosen report will cover, so nobody has to
    // guess what "weekly" means before sending it.
    const render_hint = () => {
        const type = d.get_value('report_type') || 'daily';
        const [from, to] = crm_report_period(type);
        const text = (from === to)
            ? from
            : `${from} &nbsp;to&nbsp; ${to}`;
        d.fields_dict.period_hint.$wrapper.html(`
            <div style="margin:-6px 0 10px; padding:8px 10px; background:var(--subtle-fg, #f4f5f6);
                        border-radius:4px; font-size:12px; color:var(--text-muted, #666);">
                Covers: <b style="color:var(--text-color, #333);">${text}</b>
            </div>`);
    };
    d.fields_dict.report_type.$input.on('change', render_hint);
    d.show();
    render_hint();
}

/**
 * Same period rules as the server: daily = today, weekly = Sunday to Friday of
 * this week, monthly = first to last day of this month. Formatted dd-mmm-yyyy
 * with the weekday, matching the e-mail subject.
 */
function crm_report_period(type) {
    const fmt = (dt) => {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const dd = String(dt.getDate()).padStart(2, '0');
        return `${days[dt.getDay()]}, ${dd}-${months[dt.getMonth()]}-${dt.getFullYear()}`;
    };

    const now = new Date();

    if (type === 'weekly') {
        const start = new Date(now);
        start.setDate(now.getDate() - now.getDay());      // back to Sunday
        const end = new Date(start);
        end.setDate(start.getDate() + 5);                 // Friday
        return [fmt(start), fmt(end)];
    }

    if (type === 'monthly') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return [fmt(start), fmt(end)];
    }

    return [fmt(now), fmt(now)];
}
