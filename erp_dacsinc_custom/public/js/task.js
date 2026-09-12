frappe.ui.form.on('Task', {
    refresh(frm) {
        frm.trigger('update_red_flag_ui_state');
        frm.trigger('render_red_flag_banner');
    },

    onload(frm) {
        frm.trigger('update_red_flag_ui_state');
        frm.trigger('render_red_flag_banner');
    },

    status(frm) {
        frm.trigger('update_red_flag_ui_state');
    },

    update_red_flag_ui_state(frm) {
        const isFlagged = Boolean(frm.doc.custom_red_flag);
        const isCompletedOrCancelled = ['Completed', 'Cancelled'].includes(frm.doc.status);

        // Checkbox is ONLY for raising Red Flag: visible when unflagged and not completed/cancelled, hidden when flagged or completed/cancelled
        frm.toggle_display('custom_red_flag', !isFlagged && !isCompletedOrCancelled);
        frm.set_df_property('custom_red_flag', 'label', __('Red Flag'));

        // Keep raw red flag fields hidden from the form layout at all times
        frm.toggle_display([
            'custom_dependency_on',
            'custom_red_flag_due_date',
            'custom_opening_notes',
            'custom_red_flag_raised_by',
            'custom_red_flag_closing_notes'
        ], false);
    },

    custom_red_flag(frm) {
        if (frm.doc.custom_red_flag) {
            // Checkbox checked -> Raise Red Flag flow
            frm.trigger('prompt_raise_red_flag');
        }
    },

    prompt_raise_red_flag(frm) {
        if (frm._redflag_dialog_open) {
            return;
        }
        frm._redflag_dialog_open = true;

        const dialog = new frappe.ui.Dialog({
            title: __('Raise Red Flag — {0}', [frm.doc.name || __('New Task')]),
            fields: [
                {
                    label: __('Dependency On'),
                    fieldname: 'dependency_on',
                    fieldtype: 'Link',
                    options: 'User',
                    reqd: 1,
                    description: __('Select the user on whom this task is dependent')
                },
                {
                    label: __('Due Date'),
                    fieldname: 'due_date',
                    fieldtype: 'Date',
                    reqd: 1,
                    default: frappe.datetime.nowdate()
                },
                {
                    label: __('Description'),
                    fieldname: 'opening_notes',
                    fieldtype: 'Small Text',
                    reqd: 1,
                    placeholder: __('Description....')
                }
            ],
            primary_action_label: __('Apply Red Flag'),
            primary_action: (values) => {
                if (!values.dependency_on || !values.due_date || !values.opening_notes) {
                    frappe.msgprint({
                        title: __('Mandatory Fields Missing'),
                        indicator: 'orange',
                        message: __('Please fill all mandatory fields: <b>Dependency On</b>, <b>Due Date</b>, and <b>Description</b>.')
                    });
                    return;
                }

                if (frm.doc.name && !frm.doc.__islocal) {
                    frappe.call({
                        method: 'erp_dacsinc_custom.erp_dacsinc_custom.page.task_dashboard.task_dashboard.toggle_red_flag',
                        args: {
                            task_name: frm.doc.name,
                            red_flag: 1,
                            dependency_on: values.dependency_on,
                            due_date: values.due_date,
                            opening_notes: values.opening_notes
                        },
                        freeze: true,
                        freeze_message: __('Applying Red Flag...'),
                        callback: () => {
                            dialog.submitted = true;
                            dialog.hide();
                            frm._redflag_dialog_open = false;
                            frappe.show_alert({
                                message: __('Task marked as Red Flag'),
                                indicator: 'red'
                            }, 3);
                            frm.reload_doc();
                        }
                    });
                } else {
                    if (frm.fields_dict.custom_dependency_on) {
                        frm.set_value('custom_dependency_on', values.dependency_on);
                    }
                    frm.doc.custom_dependency_on = values.dependency_on;

                    if (frm.fields_dict.custom_red_flag_due_date) {
                        frm.set_value('custom_red_flag_due_date', values.due_date);
                    }
                    frm.doc.custom_red_flag_due_date = values.due_date;

                    if (frm.fields_dict.custom_opening_notes) {
                        frm.set_value('custom_opening_notes', values.opening_notes);
                    }
                    frm.doc.custom_opening_notes = values.opening_notes;

                    if (frm.fields_dict.custom_red_flag_raised_by) {
                        frm.set_value('custom_red_flag_raised_by', frappe.session.user);
                    }
                    frm.doc.custom_red_flag_raised_by = frappe.session.user;

                    if (frm.fields_dict.custom_red_flag) {
                        frm.set_value('custom_red_flag', 1);
                    }
                    frm.doc.custom_red_flag = 1;

                    dialog.submitted = true;
                    dialog.hide();
                    frm._redflag_dialog_open = false;
                    frm.trigger('update_red_flag_ui_state');
                    frm.trigger('render_red_flag_banner');
                }
            }
        });

        dialog.fields_dict.dependency_on.get_query = function () {
            return {
                filters: {
                    enabled: 1
                }
            };
        };

        dialog.onhide = () => {
            frm._redflag_dialog_open = false;
            if (!dialog.submitted && !frm.doc.custom_dependency_on) {
                if (frm.fields_dict.custom_red_flag) {
                    frm.set_value('custom_red_flag', 0);
                }
                frm.doc.custom_red_flag = 0;
                frm.trigger('update_red_flag_ui_state');
                frm.trigger('render_red_flag_banner');
            }
        };

        dialog.show();
    },

    prompt_resolve_red_flag(frm) {
        if (frm._redflag_dialog_open) {
            return;
        }
        frm._redflag_dialog_open = true;

        const dialog = new frappe.ui.Dialog({
            title: __('Resolve Red Flag — {0}', [frm.doc.name || __('Task')]),
            fields: [
                {
                    label: __('Closing Notes'),
                    fieldname: 'closing_notes',
                    fieldtype: 'Small Text',
                    reqd: 1,
                    placeholder: __('Closing notes....')
                }
            ],
            primary_action_label: __('Resolve Red Flag'),
            primary_action: (values) => {
                if (!values.closing_notes || !values.closing_notes.trim()) {
                    frappe.msgprint({
                        title: __('Closing Notes Required'),
                        indicator: 'orange',
                        message: __('Please provide mandatory <b>Closing Notes</b> to resolve the Red Flag.')
                    });
                    return;
                }

                // If saved document, call backend to record resolution comment and sync document timestamp
                if (frm.doc.name && !frm.doc.__islocal) {
                    frappe.call({
                        method: 'erp_dacsinc_custom.erp_dacsinc_custom.page.task_dashboard.task_dashboard.toggle_red_flag',
                        args: {
                            task_name: frm.doc.name,
                            red_flag: 0,
                            closing_notes: values.closing_notes
                        },
                        freeze: true,
                        freeze_message: __('Resolving Red Flag...'),
                        callback: () => {
                            if (frm.dashboard) {
                                frm.dashboard.clear_headline();
                            }
                            dialog.submitted = true;
                            dialog.hide();
                            frm._redflag_dialog_open = false;
                            frappe.show_alert({
                                message: __('Red Flag resolved successfully'),
                                indicator: 'green'
                            }, 3);
                            // Reload document to synchronize server timestamp and prevent timestamp mismatch errors
                            frm.reload_doc();
                        }
                    });
                } else {
                    if (frm.fields_dict.custom_red_flag) {
                        frm.set_value('custom_red_flag', 0);
                    }
                    frm.doc.custom_red_flag = 0;

                    if (frm.fields_dict.custom_red_flag_closing_notes) {
                        frm.set_value('custom_red_flag_closing_notes', values.closing_notes);
                    }
                    frm.doc.custom_red_flag_closing_notes = values.closing_notes;

                    if (frm.dashboard) {
                        frm.dashboard.clear_headline();
                    }

                    dialog.submitted = true;
                    dialog.hide();
                    frm._redflag_dialog_open = false;
                    frm.trigger('update_red_flag_ui_state');
                    frm.trigger('render_red_flag_banner');
                }
            }
        });

        dialog.onhide = () => {
            frm._redflag_dialog_open = false;
            if (!dialog.submitted) {
                // User closed resolve popup without submitting -> revert checkbox back to 1 (stays flagged)
                if (frm.fields_dict.custom_red_flag) {
                    frm.set_value('custom_red_flag', 1);
                }
                frm.doc.custom_red_flag = 1;
                frm.trigger('update_red_flag_ui_state');
                frm.trigger('render_red_flag_banner');
            }
        };

        dialog.show();
    },

    fetch_user_names(frm, user_ids) {
        frm._user_full_name_cache = frm._user_full_name_cache || {};
        const missing = [];
        (user_ids || []).forEach(uid => {
            if (uid && uid !== '—' && !frm._user_full_name_cache[uid]) {
                if (frappe.boot && frappe.boot.user_info && frappe.boot.user_info[uid] && frappe.boot.user_info[uid].fullname && frappe.boot.user_info[uid].fullname !== uid) {
                    frm._user_full_name_cache[uid] = frappe.boot.user_info[uid].fullname;
                } else {
                    missing.push(uid);
                }
            }
        });

        if (missing.length > 0 && !frm._fetching_user_names) {
            frm._fetching_user_names = true;
            frappe.db.get_list('User', {
                filters: { name: ['in', missing] },
                fields: ['name', 'full_name'],
                limit: 50
            }).then(records => {
                frm._fetching_user_names = false;
                let updated = false;
                if (records && records.length) {
                    records.forEach(r => {
                        if (r.full_name) {
                            frm._user_full_name_cache[r.name] = r.full_name;
                            if (frappe.boot && frappe.boot.user_info) {
                                frappe.boot.user_info[r.name] = frappe.boot.user_info[r.name] || {};
                                frappe.boot.user_info[r.name].fullname = r.full_name;
                            }
                            updated = true;
                        }
                    });
                }
                if (updated) {
                    frm.trigger('render_red_flag_banner');
                }
            }).catch(() => {
                frm._fetching_user_names = false;
            });
        }
    },

    render_red_flag_banner(frm) {
        if (frm.dashboard) {
            frm.dashboard.clear_headline();
        }

        if (!frm.doc.custom_red_flag) {
            return;
        }

        const raisedBy = frm.doc.custom_red_flag_raised_by || frm.doc.owner || frappe.session.user;
        const depOn = frm.doc.custom_dependency_on || '—';
        const dueDate = frm.doc.custom_red_flag_due_date;
        const formattedDueDate = dueDate ? frappe.datetime.str_to_user(dueDate) : '—';
        const notes = frm.doc.custom_opening_notes || '';

        // Trigger asynchronous full name lookup for users
        frm.trigger('fetch_user_names', [raisedBy, depOn]);

        const formatUserDisplay = (uid) => {
            if (!uid || uid === '—') return '—';
            const fullName = (frm._user_full_name_cache && frm._user_full_name_cache[uid])
                || (frappe.boot && frappe.boot.user_info && frappe.boot.user_info[uid] && frappe.boot.user_info[uid].fullname !== uid ? frappe.boot.user_info[uid].fullname : null);

            if (fullName && fullName !== uid) {
                return `<span style="font-weight: 600; color: #1e293b;">${frappe.utils.escape_html(uid)}</span> <span style="font-weight: 500; color: #475569; font-size: 12px;">(${frappe.utils.escape_html(fullName)})</span>`;
            }
            return `<span style="font-weight: 600; color: #1e293b;">${frappe.utils.escape_html(uid)}</span>`;
        };

        const depOnDisplay = formatUserDisplay(depOn);
        const raisedByDisplay = formatUserDisplay(raisedBy);

        const bannerHtml = `
            <div class="task-redflag-hero-card task-redflag-banner" style="
                background: #ffffff;
                border: 1px solid #fecaca;
                border-left: 4px solid #ef4444;
                border-radius: 8px;
                padding: 14px 18px;
                margin-bottom: 16px;
                box-shadow: 0 2px 6px rgba(239, 68, 68, 0.04);
            ">
                <!-- Top Header Row -->
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 12px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="
                            background-color: #ef4444;
                            color: #ffffff;
                            font-size: 11px;
                            font-weight: 700;
                            padding: 3px 9px;
                            border-radius: 4px;
                            display: inline-flex;
                            align-items: center;
                            gap: 5px;
                            letter-spacing: 0.4px;
                            text-transform: uppercase;
                        ">
                            <i class="fa fa-flag" style="font-size: 11px;"></i> ${__('Red Flag')}
                        </span>
                        <span style="font-size: 13px; font-weight: 600; color: #1e293b;">
                            ${__('Critical Attention Required')}
                        </span>
                    </div>

                    <button class="btn btn-xs btn-danger btn-resolve-redflag" type="button" style="
                        background-color: #ef4444;
                        border: 1px solid #ef4444;
                        color: #ffffff;
                        font-weight: 600;
                        font-size: 12px;
                        border-radius: 4px;
                        padding: 4px 14px;
                        cursor: pointer;
                        display: inline-flex;
                        align-items: center;
                        gap: 6px;
                        transition: all 0.2s;
                    ">
                        <i class="fa fa-check-square-o"></i> ${__('Resolve Red Flag')}
                    </button>
                </div>

                <!-- Info Grid: Dependency On | Due Date | Raised By -->
                <div style="
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                    gap: 12px 20px;
                    padding: 2px 0 6px 0;
                ">
                    <div>
                        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: #64748b; letter-spacing: 0.3px; margin-bottom: 3px;">
                            <i class="fa fa-user" style="color: #ef4444; margin-right: 4px;"></i> ${__('Dependency On')}
                        </div>
                        <div style="font-size: 13px; line-height: 1.4; word-break: break-word;">
                            ${depOnDisplay}
                        </div>
                    </div>

                    <div>
                        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: #64748b; letter-spacing: 0.3px; margin-bottom: 3px;">
                            <i class="fa fa-calendar" style="color: #ef4444; margin-right: 4px;"></i> ${__('Due Date')}
                        </div>
                        <div style="font-size: 13px; font-weight: 700; color: #dc2626;">
                            ${formattedDueDate}
                        </div>
                    </div>

                    <div>
                        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: #64748b; letter-spacing: 0.3px; margin-bottom: 3px;">
                            <i class="fa fa-user-circle" style="color: #ef4444; margin-right: 4px;"></i> ${__('Raised By')}
                        </div>
                        <div style="font-size: 13px; line-height: 1.4; word-break: break-word;">
                            ${raisedByDisplay}
                        </div>
                    </div>
                </div>

                <!-- Description / Notes Section -->
                ${notes ? `
                    <div style="margin-top: 10px; font-size: 12px; color: #334155; line-height: 1.5; background: #fff8f8; padding: 10px 14px; border-radius: 6px; border: 1px solid #fee2e2;">
                        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: #64748b; letter-spacing: 0.3px; margin-bottom: 4px;">
                            <i class="fa fa-commenting-o" style="color: #ef4444; margin-right: 4px;"></i> ${__('Description')}
                        </div>
                        <div style="color: #334155; white-space: pre-wrap;">${frappe.utils.escape_html(notes)}</div>
                    </div>
                ` : ''}
            </div>
        `;

        if (frm.layout && typeof frm.layout.show_message === 'function') {
            frm.layout.show_message(bannerHtml, null, true);
        } else if (frm.dashboard && typeof frm.dashboard.set_headline === 'function') {
            frm.dashboard.set_headline(bannerHtml);
        }

        // Clean up any close / into mark elements rendered by Frappe
        if (frm.dashboard) {
            if (frm.dashboard.headline_area) {
                frm.dashboard.headline_area.find('.close, .close-message, a.close, button.close, [data-action="close"]').remove();
            }
            if (frm.dashboard.headline) {
                frm.dashboard.headline.find('.close, .close-message, a.close, button.close, [data-action="close"]').remove();
            }
        }

        if (frm.page && frm.page.wrapper) {
            frm.page.wrapper.find('.form-headline .close, .form-headline .close-message, .form-message .close, .form-message .close-message, .dashboard-headline .close, .dashboard-headline .close-message, a.close, .close-message').remove();
        }
        $(frm.wrapper).find('.form-headline .close, .form-headline .close-message, .form-message .close, .form-message .close-message, .dashboard-headline .close, .dashboard-headline .close-message, a.close, button.close, .close-message').remove();

        // Hide default Frappe headline close button ("into" / cross mark) via injected style
        if (!document.getElementById('task-redflag-hide-close-style')) {
            const style = document.createElement('style');
            style.id = 'task-redflag-hide-close-style';
            style.innerHTML = `
                .form-headline,
                .form-message {
                    background: transparent !important;
                    border: none !important;
                    padding: 0 !important;
                    box-shadow: none !important;
                }
                .form-headline .close,
                .form-headline .close-message,
                .form-message .close,
                .form-message .close-message,
                .dashboard-headline .close,
                .dashboard-headline .close-message,
                .task-redflag-hero-card ~ .close,
                .task-redflag-hero-card ~ .close-message,
                .form-headline a.close,
                .form-headline button.close,
                .form-headline > a,
                .form-message > .close-message,
                .form-message .icon-close,
                .close-message {
                    display: none !important;
                    visibility: hidden !important;
                    opacity: 0 !important;
                    width: 0 !important;
                    height: 0 !important;
                    overflow: hidden !important;
                    pointer-events: none !important;
                }
            `;
            document.head.appendChild(style);
        }

        // Attach delegated click listener to ensure popup triggers on any container
        if (frm.wrapper) {
            $(frm.wrapper).off('click', '.btn-resolve-redflag').on('click', '.btn-resolve-redflag', (e) => {
                e.preventDefault();
                e.stopPropagation();
                frm.trigger('prompt_resolve_red_flag');
            });
        }
    }
});
