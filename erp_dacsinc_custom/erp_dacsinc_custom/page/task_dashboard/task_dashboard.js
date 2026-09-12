// ================================================================
//  Task Dashboard — Connected Pipeline Lifecycle Workspace
//  Card-free, highly intuitive flow-driven task management.
// ================================================================

frappe.pages['task-dashboard'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __('Task Dashboard'),
        single_column: true
    });

    const dashboard = new TaskPipelineDashboard(page);
    wrapper.on_page_show = function () {
        dashboard.refresh();
    };
};

class TaskPipelineDashboard {
    constructor(page) {
        this.page = page;
        this.current_tab = 'all';
        this.tasks = [];
        this.summary = {};
        this.search_timeout = null;

        this.filters = {
            task_owner: '',
            status: 'All',
            priority: 'All',
            from_date: '',
            to_date: '',
            search_text: '',
            scope: 'all',
            tab: 'all'
        };

        this.init();
    }

    init() {
        this.setup_actions();
        this.render_layout();
        this.setup_filters();
        this.setup_events();
        this.refresh();
    }

    setup_actions() {
        // Clear three dots dropdown menu
        if (this.page.clear_menu) this.page.clear_menu();
        if (this.page.wrapper) {
            this.page.wrapper.find('.menu-btn-group').hide();
            this.page.wrapper.find('.page-icon-group').hide();
        }

        // Setup primary New Task action button in page header
        this.page.set_primary_action(__('New Task'), () => {
            frappe.new_doc('Task');
        }, 'add');
    }

    render_layout() {
        $(this.page.body).html(`
            <div class="task-pipeline-workspace">
                <!-- 1. Connected Lifecycle Pipeline Ribbon (Zero Cards, Vibrant Pills) -->
                <div class="pipeline-ribbon-container">
                    <div class="lifecycle-flow-track">
                        <div class="flow-step-node node-open" data-step-type="status" data-target="all" data-status="Open">
                            <i class="fa fa-folder-open-o"></i>
                            <span>${__('Open')}</span>
                            <span class="node-count" id="node-count-open">0</span>
                        </div>

                        <div class="flow-step-node node-progress" data-step-type="status" data-target="all" data-status="Working">
                            <i class="fa fa-bolt"></i>
                            <span>${__('In Progress')}</span>
                            <span class="node-count" id="node-count-progress">0</span>
                        </div>

                        <div class="flow-step-node node-completed" data-step-type="status" data-target="all" data-status="Completed">
                            <i class="fa fa-check-circle"></i>
                            <span>${__('Completed')}</span>
                            <span class="node-count" id="node-count-completed">0</span>
                        </div>
                    </div>

                    <div class="flow-alerts-group">
                        <div class="alert-flow-node alert-node-redflag" id="node-redflag-box" data-step-type="tab" data-target="red_flag" data-status="All" title="${__('Filter Critical Red Flag Tasks')}">
                            <i class="fa fa-flag"></i>
                            <span>${__('Red Flag')}</span>
                            <span class="node-count" id="node-count-redflag">0</span>
                        </div>

                        <div class="alert-flow-node alert-node-overdue" data-step-type="tab" data-target="overdue" data-status="All" title="${__('Filter Overdue Tasks')}">
                            <i class="fa fa-clock-o"></i>
                            <span>${__('Overdue')}</span>
                            <span class="node-count" id="node-count-overdue">0</span>
                        </div>
                    </div>
                </div>

                <!-- 2. Clean Filter Toolbar (With Scope Tabs) -->
                <div class="workspace-filter-ribbon">
                    <div class="filter-left-group">
                        <div class="filter-search-pill">
                            <input type="text" id="pipe-search-input" placeholder="${__('Search tasks.......')}">
                        </div>
                        <div class="filter-pill-item" id="pipe-ctrl-owner"></div>
                        <div class="filter-pill-item" id="pipe-ctrl-status"></div>
                        <div class="filter-pill-item" id="pipe-ctrl-priority"></div>
                        <div class="filter-pill-item filter-pill-date" id="pipe-ctrl-date"></div>
                        <button class="btn-reset-pill" id="btn-pipe-reset" title="${__('Reset all filters')}">
                            <i class="fa fa-undo"></i> ${__('Reset')}
                        </button>
                    </div>

                    <div class="filter-right-group">
                        <!-- Scope Tabs: All Tasks vs My Tasks -->
                        <div class="filter-scope-segmented">
                            <button type="button" class="scope-pill-btn is-active" data-scope="all">
                                <i class="fa fa-th-list"></i> ${__('All Tasks')}
                            </button>
                            <button type="button" class="scope-pill-btn" data-scope="my_tasks">
                                <i class="fa fa-user"></i> ${__('My Tasks')}
                            </button>
                        </div>
                    </div>
                </div>

                <!-- 3. Workspace Data Table -->
                <div class="workspace-table-card">
                    <div class="table-top-meta">
                        <span id="pipe-results-count">0 tasks</span>
                        </div>
                    <div id="pipe-table-container">
                        <div class="text-center text-muted" style="padding: 40px;">
                            <i class="fa fa-spinner fa-spin fa-2x"></i>
                            <p style="margin-top: 10px;">${__('Loading tasks...')}</p>
                        </div>
                    </div>
                </div>
            </div>
        `);
    }

    setup_filters() {
        // Owner Filter
        this.owner_field = frappe.ui.form.make_control({
            parent: this.page.body.find('#pipe-ctrl-owner'),
            df: {
                fieldtype: 'Link',
                options: 'User',
                fieldname: 'task_owner',
                placeholder: __('Task Owner'),
                change: () => {
                    this.filters.task_owner = this.owner_field.get_value() || '';
                    this.update_owner_buttons();
                    this.refresh();
                }
            },
            render_input: true
        });

        if (this.owner_field && this.owner_field.$input) {
            this.owner_field.$input.on('input change blur keyup', () => {
                setTimeout(() => this.update_owner_buttons(), 30);
            });
        }
        if (this.owner_field && this.owner_field.$wrapper) {
            this.owner_field.$wrapper.on('click', '.btn-clear', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.owner_field.set_value('');
                this.filters.task_owner = '';
                this.update_owner_buttons();
                this.refresh();
            });
        }
        this.update_owner_buttons();

        // Status Filter
        this.status_field = frappe.ui.form.make_control({
            parent: this.page.body.find('#pipe-ctrl-status'),
            df: {
                fieldtype: 'Select',
                fieldname: 'status',
                placeholder: __('Status'),
                options: [
                    { label: __('All'), value: 'All' },
                    { label: __('Open'), value: 'Open' },
                    { label: __('Working'), value: 'Working' },
                    { label: __('Pending Review'), value: 'Pending Review' },
                    { label: __('Overdue'), value: 'Overdue' },
                    { label: __('Completed'), value: 'Completed' },
                    { label: __('Cancelled'), value: 'Cancelled' }
                ],
                default: 'All',
                change: () => {
                    this.filters.status = this.status_field.get_value() || 'All';
                    this.refresh();
                }
            },
            render_input: true
        });

        // Priority Filter
        this.priority_field = frappe.ui.form.make_control({
            parent: this.page.body.find('#pipe-ctrl-priority'),
            df: {
                fieldtype: 'Select',
                fieldname: 'priority',
                placeholder: __('Priority'),
                options: [
                    { label: __('All'), value: 'All' },
                    { label: __('Urgent'), value: 'Urgent' },
                    { label: __('High'), value: 'High' },
                    { label: __('Medium'), value: 'Medium' },
                    { label: __('Low'), value: 'Low' }
                ],
                default: 'All',
                change: () => {
                    this.filters.priority = this.priority_field.get_value() || 'All';
                    this.refresh();
                }
            },
            render_input: true
        });

        // Date Range Filter
        this.date_range_field = frappe.ui.form.make_control({
            parent: this.page.body.find('#pipe-ctrl-date'),
            df: {
                fieldtype: 'DateRange',
                fieldname: 'date_range',
                placeholder: __('Date Range'),
                change: () => {
                    const range = this.date_range_field.get_value();
                    if (range && Array.isArray(range) && range.length === 2 && range[0] && range[1]) {
                        this.filters.from_date = range[0];
                        this.filters.to_date = range[1];
                    } else {
                        this.filters.from_date = '';
                        this.filters.to_date = '';
                    }
                    this.refresh();
                }
            },
            render_input: true
        });
    }

    update_owner_buttons() {
        if (!this.owner_field) return;
        const val = this.owner_field.get_value() || (this.owner_field.$input ? this.owner_field.$input.val() : '');
        const $owner_container = this.page.body.find('#pipe-ctrl-owner');
        if (val && String(val).trim()) {
            $owner_container.addClass('has-owner-selected');
            const $link_open = $owner_container.find('.btn-open');
            if ($link_open.length) {
                $link_open.attr('href', frappe.utils.get_form_link('User', String(val).trim()));
            }
        } else {
            $owner_container.removeClass('has-owner-selected');
        }
    }

    setup_events() {
        const me = this;

        // Search text with debounce
        this.page.body.find('#pipe-search-input').on('input', function () {
            clearTimeout(me.search_timeout);
            const val = $(this).val();
            me.search_timeout = setTimeout(() => {
                me.filters.search_text = val;
                me.refresh();
            }, 250);
        });

        // Pipeline Step Node & Alert Node Click
        this.page.body.find('.flow-step-node, .alert-flow-node').on('click', function () {
            me.page.body.find('.flow-step-node, .alert-flow-node').removeClass('is-active');
            $(this).addClass('is-active');

            const targetTab = $(this).data('target');
            const targetStatus = $(this).data('status');

            me.current_tab = targetTab;
            me.filters.tab = targetTab;

            if (targetStatus && targetStatus !== 'All') {
                me.status_field.set_value(targetStatus);
                me.filters.status = targetStatus;
            } else {
                me.status_field.set_value('All');
                me.filters.status = 'All';
            }

            me.refresh();
        });

        // Scope Switcher (All Tasks vs My Tasks)
        this.page.body.find('.scope-pill-btn').on('click', function () {
            me.page.body.find('.scope-pill-btn').removeClass('is-active');
            $(this).addClass('is-active');

            const scope = $(this).data('scope') || 'all';
            me.filters.scope = scope;
            me.refresh();
        });

        // Reset Filters Button
        this.page.body.find('#btn-pipe-reset').on('click', () => {
            this.page.body.find('#pipe-search-input').val('');
            this.owner_field.set_value('');
            this.update_owner_buttons();
            this.status_field.set_value('All');
            this.priority_field.set_value('All');
            this.date_range_field.set_value('');
            this.current_tab = 'all';

            this.page.body.find('.flow-step-node, .alert-flow-node').removeClass('is-active');
            this.page.body.find('.scope-pill-btn').removeClass('is-active');
            this.page.body.find('.scope-pill-btn[data-scope="all"]').addClass('is-active');

            this.filters = {
                task_owner: '',
                status: 'All',
                priority: 'All',
                from_date: '',
                to_date: '',
                search_text: '',
                scope: 'all',
                tab: 'all'
            };
            this.refresh();
        });


        // Inline Red Flag Toggle
        this.page.body.on('click', '.btn-flag-switch', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const btn = $(this);
            const taskName = btn.data('task-name');
            const currentVal = parseInt(btn.data('flagged')) || 0;
            const redFlagDueDate = btn.data('due-date') || '';

            if (currentVal === 0) {
                // Open modal dialog to capture mandatory Red Flag details
                me.show_red_flag_dialog(taskName, redFlagDueDate);
            } else {
                // Open modal dialog to capture mandatory Closing Notes
                me.show_resolve_red_flag_dialog(taskName);
            }
        });
    }

    show_resolve_red_flag_dialog(taskName) {
        const me = this;
        const dialog = new frappe.ui.Dialog({
            title: __('Resolve Red Flag — {0}', [taskName]),
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

                frappe.call({
                    method: 'erp_dacsinc_custom.erp_dacsinc_custom.page.task_dashboard.task_dashboard.toggle_red_flag',
                    args: {
                        task_name: taskName,
                        red_flag: 0,
                        closing_notes: values.closing_notes
                    },
                    freeze: true,
                    freeze_message: __('Resolving Red Flag...'),
                    callback: (r) => {
                        dialog.hide();
                        if (r.message) {
                            frappe.show_alert({
                                message: __('Red Flag resolved for task {0}', [taskName]),
                                indicator: 'green'
                            }, 3);
                            me.refresh();
                        }
                    }
                });
            }
        });

        dialog.show();
    }

    show_red_flag_dialog(taskName, defaultDueDate) {
        const me = this;
        const dialog = new frappe.ui.Dialog({
            title: __('Raise Red Flag'),
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
                    default: defaultDueDate || frappe.datetime.nowdate()
                },
                {
                    label: __('Description'),
                    fieldname: 'opening_notes',
                    fieldtype: 'Small Text',
                    reqd: 1,
                    placeholder: __('Description...')
                }
            ],
            primary_action_label: __('Mark as Red Flag'),
            primary_action: (values) => {
                if (!values.dependency_on || !values.due_date || !values.opening_notes) {
                    frappe.msgprint({
                        title: __('Mandatory Fields Missing'),
                        indicator: 'orange',
                        message: __('Please fill all mandatory fields: <b>Dependency On</b>, <b>Due Date</b>, and <b>Description</b>.')
                    });
                    return;
                }

                frappe.call({
                    method: 'erp_dacsinc_custom.erp_dacsinc_custom.page.task_dashboard.task_dashboard.toggle_red_flag',
                    args: {
                        task_name: taskName,
                        red_flag: 1,
                        dependency_on: values.dependency_on,
                        due_date: values.due_date,
                        opening_notes: values.opening_notes
                    },
                    freeze: true,
                    freeze_message: __('Marking Task as Red Flag...'),
                    callback: (r) => {
                        dialog.hide();
                        if (r.message) {
                            frappe.show_alert({
                                message: __('Task {0} marked as Red Flag', [taskName]),
                                indicator: 'red'
                            }, 3);
                            me.refresh();
                        }
                    }
                });
            }
        });

        // Filter enabled users for Dependency On Link field
        dialog.fields_dict.dependency_on.get_query = function () {
            return {
                filters: {
                    enabled: 1
                }
            };
        };

        dialog.show();
    }

    refresh() {
        frappe.call({
            method: 'erp_dacsinc_custom.erp_dacsinc_custom.page.task_dashboard.task_dashboard.get_task_dashboard_data',
            args: { filters: this.filters },
            freeze: false,
            callback: (r) => {
                if (r.message) {
                    this.tasks = r.message.tasks || [];
                    this.summary = r.message.summary || {};
                    this.update_pipeline_counts(this.summary);
                    this.render_table(this.tasks);
                }
            }
        });
    }

    update_pipeline_counts(summary) {
        const total = summary.total_tasks || 0;
        const open = summary.open_tasks || 0;
        const progress = summary.in_progress_tasks || 0;
        const completed = summary.completed_tasks || 0;
        const redflag = summary.red_flag_tasks || 0;
        const overdue = summary.overdue_tasks || 0;

        this.page.body.find('#node-count-all').text(total);
        this.page.body.find('#node-count-open').text(open);
        this.page.body.find('#node-count-progress').text(progress);
        this.page.body.find('#node-count-completed').text(completed);
        this.page.body.find('#node-count-redflag').text(redflag);
        this.page.body.find('#node-count-overdue').text(overdue);

        const redNode = this.page.body.find('#node-redflag-box');
        if (redflag > 0) {
            redNode.addClass('has-items');
        } else {
            redNode.removeClass('has-items');
        }
    }

    render_table(tasks) {
        const container = this.page.body.find('#pipe-table-container');
        const countDisplay = this.page.body.find('#pipe-results-count');

        countDisplay.text(`${tasks ? tasks.length : 0} tasks found`);

        if (!tasks || tasks.length === 0) {
            container.html(`
                <div class="pipeline-empty-state">
                    <i class="fa fa-folder-open-o"></i>
                    <h4>${__('No Tasks Found')}</h4>
                    <p>${__('There are no tasks matching the selected filter.')}</p>
                </div>
            `);
            return;
        }

        const rows = tasks.map(task => {
            const isFlagged = Boolean(task.custom_red_flag);
            const isCompletedOrCancelled = ['Completed', 'Cancelled'].includes(task.status);
            const flagBtn = (!isFlagged && isCompletedOrCancelled) ? '' : `
                <button class="btn-flag-switch ${isFlagged ? 'is-flagged' : ''}" 
                        data-task-name="${task.name}" 
                        data-flagged="${isFlagged ? 1 : 0}" 
                        data-due-date="${task.custom_red_flag_due_date || ''}"
                        title="${isFlagged ? __('Remove Red Flag') : __('Mark as Red Flag')}">
                    <i class="fa ${isFlagged ? 'fa-flag' : 'fa-flag-o'}"></i>
                </button>
            `;

            const cleanDesc = this.get_clean_description(task.description);
            const priorityBadge = this.get_priority_badge(task.priority);
            const statusBadge = this.get_status_badge(task.status, task.is_overdue);
            const ownerChip = this.get_owner_chip(task.task_owner);

            const progress = Math.min(100, Math.max(0, parseInt(task.progress) || 0));
            const progressCompleteClass = progress === 100 ? 'is-done' : '';

            const startDate = task.exp_start_date ? frappe.datetime.str_to_user(task.exp_start_date) : '-';
            const endDate = task.exp_end_date ? frappe.datetime.str_to_user(task.exp_end_date) : '-';

            return `
                <tr class="${isFlagged ? 'row-redflag-alert' : ''}">
                    <td class="text-center" style="width: 38px;">${flagBtn}</td>
                    <td>
                        <div class="task-subject-cell">
                            <div class="task-subject-row">
                                <a href="/app/task/${task.name}" class="task-title-link">
                                    ${frappe.utils.escape_html(task.subject || task.name)}
                                </a>
                                ${task.project ? `<span class="task-project-tag"><i class="fa fa-briefcase"></i> ${frappe.utils.escape_html(task.project)}</span>` : ''}
                            </div>
                            ${cleanDesc ? `
                                <div class="task-description-preview" title="${frappe.utils.escape_html(cleanDesc)}">
                                    ${frappe.utils.escape_html(cleanDesc)}
                                </div>
                            ` : ''}
                        </div>
                    </td>
                    <td>${ownerChip}</td>
                    <td>${statusBadge}</td>
                    <td>${priorityBadge}</td>
                    <td class="text-nowrap">${startDate}</td>
                    <td class="text-nowrap">
                        <div>${endDate}</div>
                        ${task.due_status_text ? `<div class="timeline-urgent-badge ${task.is_overdue ? 'text-danger font-weight-bold' : 'text-muted'}">${task.due_status_text}</div>` : ''}
                    </td>
                    <td>
                        <div class="progress-clean-box">
                            <div class="progress-clean-track">
                                <div class="progress-clean-bar ${progressCompleteClass}" style="width: ${progress}%;"></div>
                            </div>
                            <span class="progress-clean-pct">${progress}%</span>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        container.html(`
            <table class="table pipeline-table">
                <thead>
                    <tr>
                        <th class="text-center" style="width: 38px;"><i class="fa fa-flag-o" title="${__('Red Flag')}"></i></th>
                        <th>${__('Subject')}</th>
                        <th>${__('Task Owner')}</th>
                        <th>${__('Status')}</th>
                        <th>${__('Priority')}</th>
                        <th>${__('Start Date')}</th>
                        <th>${__('End Date')}</th>
                        <th>${__('Progress')}</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        `);
    }

    get_clean_description(description) {
        if (!description) return '';
        let text = '';
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(description, 'text/html');
            text = doc.body.textContent || '';
        } catch (e) {
            text = typeof strip_html === 'function' ? strip_html(description) : String(description).replace(/<[^>]*>/g, '');
        }
        text = text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        return text;
    }

    get_owner_chip(owner) {
        if (!owner) return '<span class="text-muted">-</span>';
        const name = owner.split('@')[0];
        const initial = name.charAt(0).toUpperCase();
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];
        const color = colors[Math.abs(this.hash_string(owner)) % colors.length];

        return `
            <div class="owner-chip-cell">
                <span class="owner-avatar-dot" style="background: ${color};">${initial}</span>
                <span title="${frappe.utils.escape_html(owner)}">${frappe.utils.escape_html(name)}</span>
            </div>
        `;
    }

    get_priority_badge(priority) {
        const val = priority || 'Medium';
        let cls = 'priority-medium';
        let icon = 'fa-minus';

        if (val === 'Urgent') {
            cls = 'priority-urgent';
            icon = 'fa-bolt';
        } else if (val === 'High') {
            cls = 'priority-high';
            icon = 'fa-arrow-up';
        } else if (val === 'Low') {
            cls = 'priority-low';
            icon = 'fa-arrow-down';
        }

        return `<span class="priority-clean ${cls}"><i class="fa ${icon}"></i> ${val}</span>`;
    }

    get_status_badge(status, is_overdue) {
        if (is_overdue) {
            return `<span class="status-pill-clean status-overdue"><span class="dot"></span> ${__('Overdue')}</span>`;
        }

        const val = status || 'Open';
        let cls = 'status-open';

        if (val === 'Working') cls = 'status-working';
        else if (val === 'Pending Review') cls = 'status-pending';
        else if (val === 'Completed') cls = 'status-completed';
        else if (val === 'Cancelled') cls = 'status-cancelled';

        return `<span class="status-pill-clean ${cls}">${val}</span>`;
    }

    hash_string(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        return hash;
    }
}