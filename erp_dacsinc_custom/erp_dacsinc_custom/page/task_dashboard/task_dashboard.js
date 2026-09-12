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

        this.page_number = 1;
        this.page_size = 20;
        this.total_count = 0;
        this.total_pages = 1;
        this.sort_by = 'default';
        this.sort_order = 'desc';

        this.filters = {
            task_owner: '',
            status: 'active',
            priority: '',
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
                            <div class="flow-step-node node-overdue" data-step-type="tab" data-target="overdue" data-status="Overdue" title="${__('Filter Overdue Tasks')}">
                            <i class="fa fa-clock-o"></i>
                            <span>${__('Overdue')}</span>
                            <span class="node-count" id="node-count-overdue">0</span>
                        </div>
                    </div>

                    <div class="flow-alerts-group">
                        <div class="alert-flow-node alert-node-redflag" id="node-redflag-box" data-step-type="tab" data-target="red_flag" data-status="All" title="${__('Filter Critical Red Flag Tasks')}">
                            <i class="fa fa-flag"></i>
                            <span>${__('Red Flag')}</span>
                            <span class="node-count" id="node-count-redflag">0</span>
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
                    <div id="pipe-pagination-container"></div>
                </div>

                <!-- 4. Slide-Over Detail Drawer & Backdrop -->
                <div id="pipe-drawer-overlay" class="pipe-drawer-overlay"></div>
                <div id="pipe-task-drawer" class="pipe-task-drawer"></div>
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
                    this.page_number = 1;
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
                this.page_number = 1;
                this.refresh();
            });
        }
        this.update_owner_buttons();

        // Status Filter (Defaults to Overdue, Open, and In Progress tasks)
        this.status_field = frappe.ui.form.make_control({
            parent: this.page.body.find('#pipe-ctrl-status'),
            df: {
                fieldtype: 'Select',
                fieldname: 'status',
                placeholder: __('Status'),
                options: [
                    { label: '', value: '' },
                    { label: __('Open'), value: 'Open' },
                    { label: __('Working'), value: 'Working' },
                    { label: __('Pending Review'), value: 'Pending Review' },
                    { label: __('Overdue'), value: 'Overdue' },
                    { label: __('Completed'), value: 'Completed' },
                    { label: __('Cancelled'), value: 'Cancelled' }
                ],
                default: 'active',
                change: () => {
                    this.filters.status = this.status_field.get_value() || '';
                    this.page_number = 1;
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
                    { label: '', value: '' },
                    { label: __('Urgent'), value: 'Urgent' },
                    { label: __('High'), value: 'High' },
                    { label: __('Medium'), value: 'Medium' },
                    { label: __('Low'), value: 'Low' }
                ],
                default: '',
                change: () => {
                    this.filters.priority = this.priority_field.get_value() || '';
                    this.page_number = 1;
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
                    this.page_number = 1;
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
                me.page_number = 1;
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
            me.page_number = 1;

            if (targetTab === 'overdue') {
                me.status_field.set_value('Overdue');
                me.filters.status = 'Overdue';
            } else if (targetTab === 'red_flag') {
                me.status_field.set_value('All');
                me.filters.status = 'All';
            } else if (targetStatus && targetStatus !== 'All') {
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
            me.page_number = 1;
            me.refresh();
        });

        // Reset Filters Button
        this.page.body.find('#btn-pipe-reset').on('click', () => {
            this.page.body.find('#pipe-search-input').val('');
            this.owner_field.set_value('');
            this.update_owner_buttons();
            this.status_field.set_value('');
            this.priority_field.set_value('');
            this.date_range_field.set_value('');
            this.current_tab = 'all';
            this.sort_by = 'default';
            this.sort_order = 'desc';
            this.page_number = 1;

            this.page.body.find('.flow-step-node, .alert-flow-node').removeClass('is-active');
            this.page.body.find('.scope-pill-btn').removeClass('is-active');
            this.page.body.find('.scope-pill-btn[data-scope="all"]').addClass('is-active');

            this.filters = {
                task_owner: '',
                status: '',
                priority: '',
                from_date: '',
                to_date: '',
                search_text: '',
                scope: 'all',
                tab: 'all'
            };
            this.refresh();
        });

        // Table Column Header Sorting
        this.page.body.on('click', '.sortable-col', function () {
            const col = $(this).data('col');
            if (!col) return;
            if (me.sort_by === col) {
                me.sort_order = me.sort_order === 'asc' ? 'desc' : 'asc';
            } else {
                me.sort_by = col;
                me.sort_order = 'asc';
            }
            me.page_number = 1;
            me.refresh();
        });

        // Pagination: Page Number Click
        this.page.body.on('click', '.pagination-btn[data-page]', function () {
            const p = parseInt($(this).data('page'));
            if (p && p !== me.page_number) {
                me.page_number = p;
                me.refresh();
            }
        });

        // Pagination: Prev Button Click
        this.page.body.on('click', '.pagination-prev', function () {
            if (me.page_number > 1) {
                me.page_number--;
                me.refresh();
            }
        });

        // Pagination: Next Button Click
        this.page.body.on('click', '.pagination-next', function () {
            if (me.page_number < me.total_pages) {
                me.page_number++;
                me.refresh();
            }
        });

        // Pagination: Page Size Change
        this.page.body.on('change', '#pipe-page-size', function () {
            const size = parseInt($(this).val()) || 20;
            me.page_size = size;
            me.page_number = 1;
            me.refresh();
        });

        // Toggle Actions dropdown menu with smart positioning
        this.page.body.on('click', '.btn-task-actions-dropdown', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const $btn = $(this);
            const $wrap = $btn.closest('.task-actions-dropdown-wrap');
            const isOpen = $wrap.hasClass('open') || $wrap.hasClass('show');

            // Close all open dropdowns first
            $('.task-actions-dropdown-wrap').removeClass('open show dropup');
            $('.task-actions-menu').removeClass('show').hide();

            if (!isOpen) {
                $wrap.addClass('open show');
                const $menu = $wrap.find('.task-actions-menu');
                $menu.addClass('show').show();

                // Smart positioning: flip upwards if dropdown would clip past viewport bottom
                const offset = $btn.offset();
                const menuHeight = $menu.outerHeight() || 160;
                const windowHeight = $(window).height();
                const scrollTop = $(window).scrollTop();
                if (offset.top + menuHeight + 40 > scrollTop + windowHeight) {
                    $wrap.addClass('dropup');
                } else {
                    $wrap.removeClass('dropup');
                }
            }
        });

        // Close dropdown when clicking anywhere outside
        $(document).off('click.task_actions_menu').on('click.task_actions_menu', function (e) {
            if (!$(e.target).closest('.task-actions-dropdown-wrap').length) {
                $('.task-actions-dropdown-wrap').removeClass('open show dropup');
                $('.task-actions-menu').removeClass('show').hide();
            }
        });

        // Close dropdown when clicking an action item
        this.page.body.on('click', '.task-actions-menu a', function () {
            $('.task-actions-dropdown-wrap').removeClass('open show dropup');
            $('.task-actions-menu').removeClass('show').hide();
        });

        // Quick Action: Mark Task as Completed
        this.page.body.on('click', '.btn-action-complete', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const taskName = $(this).data('task-name');
            me.handle_complete_task(taskName);
        });

        // Quick Action: Set Task to Working
        this.page.body.on('click', '.btn-action-working', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const taskName = $(this).data('task-name');
            me.handle_working_task(taskName);
        });

        // Quick Action: Cancel Task
        this.page.body.on('click', '.btn-action-cancel', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const taskName = $(this).data('task-name');
            me.handle_cancel_task(taskName);
        });

        // Quick Action: Reopen Task
        this.page.body.on('click', '.btn-action-reopen', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const taskName = $(this).data('task-name');
            me.handle_reopen_task(taskName);
        });


        // Quick Action: Raise Red Flag
        this.page.body.on('click', '.btn-action-raise-redflag', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const taskName = $(this).data('task-name');
            const redFlagDueDate = $(this).data('due-date') || '';
            me.show_red_flag_dialog(taskName, redFlagDueDate);
        });

        // Quick Action: Resolve Red Flag
        this.page.body.on('click', '.btn-action-resolve-redflag, .badge-redflag-tag', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const taskName = $(this).data('task-name');
            me.show_resolve_red_flag_dialog(taskName);
        });

        // Inline Red Flag Toggle fallback
        this.page.body.on('click', '.btn-flag-switch', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const btn = $(this);
            const taskName = btn.data('task-name');
            const currentVal = parseInt(btn.data('flagged')) || 0;
            const redFlagDueDate = btn.data('due-date') || '';

            if (currentVal === 0) {
                me.show_red_flag_dialog(taskName, redFlagDueDate);
            } else {
                me.show_resolve_red_flag_dialog(taskName);
            }
        });

        // -------------------------------------------------------------
        // Slide-Over Detail Drawer Events
        // -------------------------------------------------------------

        // Close Drawer Button & Dark Overlay
        this.page.body.on('click', '.btn-drawer-close, #pipe-drawer-overlay', function () {
            me.close_drawer();
        });

        // Keyboard Escape Key to close drawer
        $(document).off('keydown.task_drawer').on('keydown.task_drawer', function (e) {
            if (e.key === 'Escape' && me.drawer_open) {
                me.close_drawer();
            }
        });

        // Drawer Action: Raise Red Flag
        this.page.body.on('click', '.btn-drawer-raise-redflag', function (e) {
            e.preventDefault();
            const taskName = $(this).data('task-name');
            const dueDate = $(this).data('due-date') || '';
            me.show_red_flag_dialog(taskName, dueDate);
        });

        // Drawer Action: Resolve Red Flag
        this.page.body.on('click', '.btn-drawer-resolve-redflag', function (e) {
            e.preventDefault();
            const taskName = $(this).data('task-name');
            me.show_resolve_red_flag_dialog(taskName);
        });

        // Drawer Action: Complete Task
        this.page.body.on('click', '.btn-drawer-complete', function (e) {
            e.preventDefault();
            const taskName = $(this).data('task-name');
            me.handle_complete_task(taskName);
        });

        // Drawer Action: Set Task to Working
        this.page.body.on('click', '.btn-drawer-working', function (e) {
            e.preventDefault();
            const taskName = $(this).data('task-name');
            me.handle_working_task(taskName);
        });

        // Drawer Action: Cancel Task
        this.page.body.on('click', '.btn-drawer-cancel', function (e) {
            e.preventDefault();
            const taskName = $(this).data('task-name');
            me.handle_cancel_task(taskName);
        });

        // Drawer Action: Reopen Task
        this.page.body.on('click', '.btn-drawer-reopen', function (e) {
            e.preventDefault();
            const taskName = $(this).data('task-name');
            me.handle_reopen_task(taskName);
        });
    }

    open_drawer(taskName) {
        const task = (this.tasks || []).find(t => t.name === taskName);
        if (!task) return;
        this.current_drawer_task = task;
        this.drawer_open = true;
        this.render_drawer(task);
        this.page.body.find('#pipe-drawer-overlay').addClass('is-open');
        this.page.body.find('#pipe-task-drawer').addClass('is-open');
    }

    close_drawer() {
        this.drawer_open = false;
        this.current_drawer_task = null;
        this.page.body.find('#pipe-drawer-overlay').removeClass('is-open');
        this.page.body.find('#pipe-task-drawer').removeClass('is-open');
    }

    render_drawer(task) {
        const isFlagged = Boolean(task.custom_red_flag);
        const isCompleted = ['Completed', 'Cancelled'].includes(task.status);
        const statusBadge = this.get_status_badge(task.status, task.is_overdue);
        const priorityBadge = this.get_priority_badge(task.priority);
        const ownerChip = this.get_owner_chip(task.task_owner);
        const startDate = this.format_date(task.exp_start_date);
        const endDate = this.format_date(task.exp_end_date);

        const isCurrentOwner = Boolean(task.task_owner && task.task_owner === frappe.session.user);
        const canAct = Boolean(
            task.can_edit_action !== undefined
                ? task.can_edit_action
                : isCurrentOwner
        );

        // Action Bar Buttons inside Drawer
        let drawerActionButtons = '';
        if (canAct) {
            // Only current task owner or admin can resolve red flag or transition status
            if (isFlagged) {
                drawerActionButtons += `
                    <button class="btn-drawer-action btn-drawer-resolve-redflag" data-task-name="${task.name}">
                        <i class="fa fa-flag"></i> ${__('Resolve Red Flag')}
                    </button>
                `;
            } else if (!isCompleted) {
                drawerActionButtons += `
                    <button class="btn-drawer-action btn-drawer-raise-redflag" data-task-name="${task.name}" data-due-date="${task.exp_end_date || ''}">
                        <i class="fa fa-flag-o"></i> ${__('Raise Red Flag')}
                    </button>
                `;
            }

            if (['Open', 'Overdue'].includes(task.status)) {
                drawerActionButtons += `
                    <button class="btn-drawer-action btn-drawer-working" data-task-name="${task.name}">
                        <i class="fa fa-bolt"></i> ${__('Working')}
                    </button>
                    <button class="btn-drawer-action btn-drawer-complete" data-task-name="${task.name}">
                        <i class="fa fa-check"></i> ${__('Completed')}
                    </button>
                    <button class="btn-drawer-action btn-drawer-cancel" data-task-name="${task.name}">
                        <i class="fa fa-ban"></i> ${__('Cancelled')}
                    </button>
                `;
            } else if (task.status === 'Working') {
                drawerActionButtons += `
                    <button class="btn-drawer-action btn-drawer-complete" data-task-name="${task.name}">
                        <i class="fa fa-check"></i> ${__('Completed')}
                    </button>
                    <button class="btn-drawer-action btn-drawer-cancel" data-task-name="${task.name}">
                        <i class="fa fa-ban"></i> ${__('Cancelled')}
                    </button>
                `;
            } else if (task.status === 'Cancelled') {
                drawerActionButtons += `
                    <button class="btn-drawer-action btn-drawer-reopen" data-task-name="${task.name}">
                        <i class="fa fa-undo"></i> ${__('Reopen')}
                    </button>
                `;
            } else if (task.status === 'Completed') {
                drawerActionButtons += `
                    <button class="btn-drawer-action btn-drawer-working" data-task-name="${task.name}">
                        <i class="fa fa-bolt"></i> ${__('Working')}
                    </button>
                    <button class="btn-drawer-action btn-drawer-reopen" data-task-name="${task.name}">
                        <i class="fa fa-undo"></i> ${__('Reopen (Open)')}
                    </button>
                    <button class="btn-drawer-action btn-drawer-cancel" data-task-name="${task.name}">
                        <i class="fa fa-ban"></i> ${__('Cancelled')}
                    </button>
                `;
            }
        } else {
            // Non-current owner: Cannot change status or resolve, but CAN Raise Red Flag
            if (!isFlagged && !isCompleted) {
                drawerActionButtons += `
                    <button class="btn-drawer-action btn-drawer-raise-redflag" data-task-name="${task.name}" data-due-date="${task.exp_end_date || ''}">
                        <i class="fa fa-flag-o"></i> ${__('Raise Red Flag')}
                    </button>
                `;
            }
        }

        // Red Flag Details Card
        let redFlagCardHtml = '';
        if (isFlagged) {
            const depOn = task.custom_dependency_on || '—';
            const depDueDate = task.custom_red_flag_due_date ? this.format_date(task.custom_red_flag_due_date) : '—';
            const raisedBy = task.custom_red_flag_raised_by || '—';
            const notes = task.custom_opening_notes || '';

            redFlagCardHtml = `
                <div class="drawer-redflag-card">
                    <div class="drawer-redflag-header">
                        <span class="drawer-redflag-title">
                            <i class="fa fa-flag"></i> ${__('Critical Red Flag Active')}
                        </span>
                        ${canAct ? `
                            <button class="btn btn-xs btn-danger btn-drawer-resolve-redflag" data-task-name="${task.name}" style="font-size: 11px; padding: 2px 8px;">
                                ${__('Resolve')}
                            </button>
                        ` : ''}
                    </div>
                    <div class="drawer-redflag-grid">
                        <div>
                            <div class="drawer-redflag-item-label">${__('Dependency On')}</div>
                            <div class="drawer-redflag-item-val">${frappe.utils.escape_html(depOn)}</div>
                        </div>
                        <div>
                            <div class="drawer-redflag-item-label">${__('Due Date')}</div>
                            <div class="drawer-redflag-item-val text-danger font-weight-bold">${depDueDate}</div>
                        </div>
                        <div style="grid-column: span 2;">
                            <div class="drawer-redflag-item-label">${__('Raised By')}</div>
                            <div class="drawer-redflag-item-val">${frappe.utils.escape_html(raisedBy)}</div>
                        </div>
                    </div>
                    ${notes ? `
                        <div class="drawer-redflag-notes">
                            <div class="drawer-redflag-item-label" style="margin-bottom: 3px;">${__('Description / Notes')}</div>
                            <div>${frappe.utils.escape_html(notes)}</div>
                        </div>
                    ` : ''}
                </div>
            `;
        }

        const html = `
            <!-- Header -->
            <div class="drawer-header">
                <div class="drawer-header-left">
                    <a href="/app/task/${task.name}" class="drawer-task-id-badge" target="_blank" title="${__('Open Full Form')}">
                        <i class="fa fa-external-link"></i> ${task.name}
                    </a>
                    ${statusBadge}
                    ${priorityBadge}
                </div>
                <button class="btn-drawer-close" title="${__('Close')}">
                    <i class="fa fa-times"></i>
                </button>
            </div>

            <!-- Quick Action Bar -->
            ${drawerActionButtons ? `
                <div class="drawer-action-bar">
                    ${drawerActionButtons}
                </div>
            ` : ''}

            <!-- Scrollable Body Content -->
            <div class="drawer-body">
                ${redFlagCardHtml}

                <div>
                    <h2 class="drawer-subject-title">${frappe.utils.escape_html(task.subject || task.name)}</h2>
                </div>

                <!-- Meta Attributes Grid -->
                <div class="drawer-meta-grid">
                    <div>
                        <div class="drawer-meta-item-label">${__('Task Owner')}</div>
                        <div class="drawer-meta-item-value">${ownerChip}</div>
                    </div>
                    <div>
                        <div class="drawer-meta-item-label">${__('Project')}</div>
                        <div class="drawer-meta-item-value">${task.project ? `<i class="fa fa-briefcase text-muted"></i> ${frappe.utils.escape_html(task.project)}` : '<span class="text-muted">—</span>'}</div>
                    </div>
                    <div>
                        <div class="drawer-meta-item-label">${__('Start Date')}</div>
                        <div class="drawer-meta-item-value">${startDate || '<span class="text-muted">—</span>'}</div>
                    </div>
                    <div>
                        <div class="drawer-meta-item-label">${__('End Date')}</div>
                        <div class="drawer-meta-item-value">
                            ${endDate || '<span class="text-muted">—</span>'}
                            ${task.due_status_text ? `<div class="${task.is_overdue ? 'text-danger font-weight-bold' : 'text-muted'}" style="font-size: 11px; margin-top: 2px;">${task.due_status_text}</div>` : ''}
                        </div>
                    </div>
                    ${task.expected_time ? `
                        <div>
                            <div class="drawer-meta-item-label">${__('Expected Time')}</div>
                            <div class="drawer-meta-item-value">${task.expected_time} hrs</div>
                        </div>
                    ` : ''}
                    ${task.type ? `
                        <div>
                            <div class="drawer-meta-item-label">${__('Type')}</div>
                            <div class="drawer-meta-item-value">${frappe.utils.escape_html(task.type)}</div>
                        </div>
                    ` : ''}
                </div>

                <!-- Description Section -->
                <div>
                    <div class="drawer-section-title">
                        <i class="fa fa-align-left text-muted"></i> ${__('Description')}
                    </div>
                    <div class="drawer-desc-content">
                        ${task.description ? frappe.utils.strip_html(task.description) : '<span class="text-muted" style="font-style: italic;">No description provided.</span>'}
                    </div>
                </div>
            </div>

            <!-- Footer Link -->
            <div class="drawer-footer">
                <a href="/app/task/${task.name}" class="btn btn-default btn-xs" target="_blank">
                    <i class="fa fa-external-link"></i> ${__('Open Task Form')}
                </a>
            </div>
        `;

        this.page.body.find('#pipe-task-drawer').html(html);
    }

    handle_complete_task(taskName) {
        const me = this;
        const task = (this.tasks || []).find(t => t.name === taskName) || this.current_drawer_task;
        const isFlagged = Boolean(task && task.custom_red_flag);

        const fields = [];

        if (isFlagged) {
            fields.push({
                fieldtype: 'HTML',
                options: `
                    <div style="margin-bottom: 12px; font-size: 13px; line-height: 1.45; border-left: 4px solid #ef4444; background: #fef2f2; color: #991b1b; padding: 10px 14px; border-radius: 4px;">
                        <div style="font-weight: 700; margin-bottom: 3px;">
                            <i class="fa fa-flag" style="color: #ef4444; margin-right: 5px;"></i>${__('Active Red Flag Detected')}
                        </div>
                        <div>${__('This task has an active Red Flag. Please provide mandatory Closing Notes to resolve the Red Flag before completing the task.')}</div>
                    </div>
                `
            });
            fields.push({
                label: __('Red Flag Closing Notes'),
                fieldname: 'closing_notes',
                fieldtype: 'Small Text',
                reqd: 1,
                placeholder: __('Describe how the red flag / blocker was resolved...')
            });
        }

        fields.push({
            label: __('Completion Notes'),
            fieldname: 'completion_notes',
            fieldtype: 'Small Text',
            reqd: 1,
            placeholder: __('Provide completion notes...')
        });

        const dialog = new frappe.ui.Dialog({
            title: __('Complete Task — {0}', [taskName]),
            fields: fields,
            primary_action_label: isFlagged ? __('Resolve & Mark as Completed') : __('Mark as Completed'),
            primary_action: (values) => {
                if (isFlagged && (!values.closing_notes || !values.closing_notes.trim())) {
                    frappe.msgprint({
                        title: __('Closing Notes Required'),
                        indicator: 'orange',
                        message: __('Please provide mandatory <b>Red Flag Closing Notes</b>.')
                    });
                    return;
                }
                if (!values.completion_notes || !values.completion_notes.trim()) {
                    frappe.msgprint({
                        title: __('Completion Notes Required'),
                        indicator: 'orange',
                        message: __('Please provide mandatory <b>Completion Notes</b> to complete this task.')
                    });
                    return;
                }

                frappe.call({
                    method: 'erp_dacsinc_custom.erp_dacsinc_custom.page.task_dashboard.task_dashboard.update_task_status',
                    args: {
                        task_name: taskName,
                        status: 'Completed',
                        closing_notes: values.closing_notes || '',
                        completion_notes: values.completion_notes
                    },
                    freeze: true,
                    freeze_message: __('Completing Task...'),
                    callback: (r) => {
                        dialog.hide();
                        if (r.message) {
                            frappe.show_alert({
                                message: isFlagged
                                    ? __('✅ Red Flag resolved and Task {0} marked as Completed', [taskName])
                                    : __('✅ Task {0} marked as Completed', [taskName]),
                                indicator: 'green'
                            }, 3);
                            if (me.drawer_open) me.close_drawer();
                            me.refresh();
                        }
                    }
                });
            }
        });

        dialog.show();
    }

    handle_working_task(taskName) {
        const me = this;
        frappe.confirm(
            __('Are you sure you want to mark this task <b>{0}</b> as Working?', [taskName]),
            () => {
                frappe.call({
                    method: 'erp_dacsinc_custom.erp_dacsinc_custom.page.task_dashboard.task_dashboard.update_task_status',
                    args: {
                        task_name: taskName,
                        status: 'Working'
                    },
                    freeze: true,
                    freeze_message: __('Marking Task as Working...'),
                    callback: (r) => {
                        if (r.message) {
                            frappe.show_alert({
                                message: __('Task {0} marked as Working', [taskName]),
                                indicator: 'green'
                            }, 3);
                            if (me.drawer_open) me.close_drawer();
                            me.refresh();
                        }
                    }
                });
            }
        );
    }

    handle_cancel_task(taskName) {
        const me = this;
        frappe.confirm(
            __('Are you sure you want to Cancel this task <b>{0}</b>?', [taskName]),
            () => {
                frappe.call({
                    method: 'erp_dacsinc_custom.erp_dacsinc_custom.page.task_dashboard.task_dashboard.update_task_status',
                    args: {
                        task_name: taskName,
                        status: 'Cancelled'
                    },
                    freeze: true,
                    freeze_message: __('Cancelling Task...'),
                    callback: (r) => {
                        if (r.message) {
                            frappe.show_alert({
                                message: __('Task {0} Cancelled', [taskName]),
                                indicator: 'orange'
                            }, 3);
                            if (me.drawer_open) me.close_drawer();
                            me.refresh();
                        }
                    }
                });
            }
        );
    }

    handle_reopen_task(taskName) {
        const me = this;
        frappe.confirm(
            __('Do you want to reopen this task <b>{0}</b>?', [taskName]),
            () => {
                frappe.call({
                    method: 'erp_dacsinc_custom.erp_dacsinc_custom.page.task_dashboard.task_dashboard.update_task_status',
                    args: {
                        task_name: taskName,
                        status: 'Open'
                    },
                    freeze: true,
                    freeze_message: __('Reopening Task...'),
                    callback: (r) => {
                        if (r.message) {
                            frappe.show_alert({
                                message: __('Task {0} reopened', [taskName]),
                                indicator: 'blue'
                            }, 3);
                            if (me.drawer_open) me.close_drawer();
                            me.refresh();
                        }
                    }
                });
            }
        );
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
                            if (me.drawer_open) me.close_drawer();
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
                            if (me.drawer_open) me.close_drawer();
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
            args: {
                filters: this.filters,
                page: this.page_number,
                page_length: this.page_size,
                sort_by: this.sort_by,
                sort_order: this.sort_order
            },
            freeze: false,
            callback: (r) => {
                if (r.message) {
                    this.tasks = r.message.tasks || [];
                    this.total_count = r.message.total_count || 0;
                    this.page_number = r.message.page || 1;
                    this.page_size = r.message.page_length || 20;
                    this.total_pages = r.message.total_pages || 1;
                    this.summary = r.message.summary || {};
                    this.update_pipeline_counts(this.summary);
                    this.render_table(this.tasks);
                    this.render_pagination();
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

    format_date(val) {
        if (!val) return '<span class="text-muted">-</span>';
        if (typeof moment !== 'undefined') {
            const d = moment(val);
            if (d.isValid()) {
                return `
                    <div class="task-date-val">${d.format('DD-MMM-YYYY')}</div>
                    <div class="task-day-val text-muted">(${d.format('dddd')})</div>
                `;
            }
        }
        return `<div>${frappe.datetime.str_to_user(val) || '-'}</div>`;
    }

    get_sort_icon(col) {
        if (this.sort_by !== col) {
            return 'fa-sort sort-neutral';
        }
        return this.sort_order === 'asc' ? 'fa-sort-asc sort-active' : 'fa-sort-desc sort-active';
    }

    render_table(tasks) {
        const container = this.page.body.find('#pipe-table-container');
        const countDisplay = this.page.body.find('#pipe-results-count');

        const startIdx = this.total_count === 0 ? 0 : (this.page_number - 1) * this.page_size + 1;
        const endIdx = Math.min(this.total_count, this.page_number * this.page_size);
        if (this.total_count === 0) {
            countDisplay.text(__('0 tasks found'));
        } else {
            countDisplay.text(__('Showing {0} - {1} of {2} tasks', [startIdx, endIdx, this.total_count]));
        }

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
            const isCompleted = ['Completed', 'Cancelled'].includes(task.status);
            const cleanDesc = this.get_clean_description(task.description);
            const priorityBadge = this.get_priority_badge(task.priority);
            const statusBadge = this.get_status_badge(task.status, task.is_overdue);
            const ownerChip = this.get_owner_chip(task.task_owner);

            const startDate = this.format_date(task.exp_start_date);
            const endDate = this.format_date(task.exp_end_date);

            const isCurrentOwner = Boolean(task.task_owner && task.task_owner === frappe.session.user);
            const canAct = Boolean(
                task.can_edit_action !== undefined
                    ? task.can_edit_action
                    : isCurrentOwner
            );

            // User-friendly Actions Dropdown (Only current task owner or admin can act)
            let actionBtnsHtml = '';

            if (canAct) {
                let menuItems = '';

                if (['Open', 'Overdue'].includes(task.status)) {
                    menuItems += `
                        <li><a href="#" class="btn-action-working" data-task-name="${task.name}"><i class="fa fa-bolt text-primary"></i> ${__('Working')}</a></li>
                        <li><a href="#" class="btn-action-complete" data-task-name="${task.name}"><i class="fa fa-check text-success"></i> ${__('Completed')}</a></li>
                        <li class="divider"></li>
                        <li><a href="#" class="btn-action-cancel" data-task-name="${task.name}"><i class="fa fa-ban text-danger"></i> ${__('Cancelled')}</a></li>
                    `;
                } else if (task.status === 'Working') {
                    menuItems += `
                        <li><a href="#" class="btn-action-complete" data-task-name="${task.name}"><i class="fa fa-check text-success"></i> ${__('Completed')}</a></li>
                        <li class="divider"></li>
                        <li><a href="#" class="btn-action-cancel" data-task-name="${task.name}"><i class="fa fa-ban text-danger"></i> ${__('Cancelled')}</a></li>
                    `;
                } else if (task.status === 'Cancelled') {
                    menuItems += `
                        <li><a href="#" class="btn-action-reopen" data-task-name="${task.name}"><i class="fa fa-undo text-primary"></i> ${__('Reopen')}</a></li>
                    `;
                } else if (task.status === 'Completed') {
                    menuItems += `
                        <li><a href="#" class="btn-action-working" data-task-name="${task.name}"><i class="fa fa-bolt text-primary"></i> ${__('Working')}</a></li>
                        <li><a href="#" class="btn-action-reopen" data-task-name="${task.name}"><i class="fa fa-undo text-info"></i> ${__('Reopen (Open)')}</a></li>
                        <li class="divider"></li>
                        <li><a href="#" class="btn-action-cancel" data-task-name="${task.name}"><i class="fa fa-ban text-danger"></i> ${__('Cancelled')}</a></li>
                    `;
                } else {
                    menuItems += `
                        <li><a href="#" class="btn-action-working" data-task-name="${task.name}"><i class="fa fa-bolt text-primary"></i> ${__('Working')}</a></li>
                        <li><a href="#" class="btn-action-complete" data-task-name="${task.name}"><i class="fa fa-check text-success"></i> ${__('Completed')}</a></li>
                        <li class="divider"></li>
                        <li><a href="#" class="btn-action-cancel" data-task-name="${task.name}"><i class="fa fa-ban text-danger"></i> ${__('Cancelled')}</a></li>
                    `;
                }

                // Dynamic Red Flag Action inside the dropdown based on task state
                if (isFlagged) {
                    menuItems += `
                        <li class="divider"></li>
                        <li><a href="#" class="btn-action-resolve-redflag" data-task-name="${task.name}"><i class="fa fa-flag text-muted"></i> ${__('Resolve Red Flag')}</a></li>
                    `;
                } else if (!isCompleted) {
                    menuItems += `
                        <li class="divider"></li>
                        <li><a href="#" class="btn-action-raise-redflag" data-task-name="${task.name}" data-due-date="${task.exp_end_date || ''}"><i class="fa fa-flag-o"></i> ${__('Raise Red Flag')}</a></li>
                    `;
                }

                actionBtnsHtml = `
                    <div class="dropdown task-actions-dropdown-wrap">
                        <button class="btn btn-default btn-xs btn-task-actions-dropdown ${isFlagged ? 'btn-actions-has-flag' : ''}" type="button" aria-haspopup="true" aria-expanded="false">
                            ${isFlagged ? '<i class="fa fa-flag text-danger mr-1"></i>' : ''}<span>${__('Actions')}</span> <i class="fa fa-caret-down ml-1"></i>
                        </button>
                        <ul class="dropdown-menu dropdown-menu-right task-actions-menu">
                            ${menuItems}
                        </ul>
                    </div>
                `;
            } else {
                // Non-current owner (viewers, former owners): Actions button is NOT visible.
                // Allow them to Raise Red Flag if not flagged and not completed.
                if (!isFlagged && !isCompleted) {
                    actionBtnsHtml = `
                        <button type="button" class="btn-action-raise-redflag" data-task-name="${task.name}" data-due-date="${task.exp_end_date || ''}" title="${__('Raise Red Flag')}">
                            <i class="fa fa-flag-o"></i> <span>${__('Raise Red Flag')}</span>
                        </button>
                    `;
                } else if (isFlagged) {
                    actionBtnsHtml = `
                        <span class="badge-redflag-tag" title="${__('Critical Red Flag Active')}">
                            <i class="fa fa-flag"></i> ${__('Flagged')}
                        </span>
                    `;
                }
            }

            if (!actionBtnsHtml.trim()) {
                actionBtnsHtml = `<span class="text-muted" style="font-size: 13px; font-weight: 500;">—</span>`;
            }

            return `
                <tr class="${isFlagged ? 'row-redflag-alert' : ''}" data-task-name="${task.name}">
                    <td>
                        <div class="task-subject-cell">
                            <div class="task-subject-row">
                                <a href="/app/task/${task.name}" target="_blank" rel="noopener noreferrer" class="task-title-link" title="${__('Open {0} in new tab', [task.name])}">
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
                        ${endDate}
                        ${task.due_status_text ? `<div class="timeline-urgent-badge ${task.is_overdue ? 'text-danger font-weight-bold' : 'text-muted'}">${task.due_status_text}</div>` : ''}
                    </td>
                    <td class="text-center task-actions-cell">
                        <div class="task-action-btn-group">
                            ${actionBtnsHtml}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        container.html(`
            <table class="table pipeline-table">
                <thead>
                    <tr>
                        <th>${__('Subject')}</th>
                        <th class="sortable-col ${this.sort_by === 'task_owner' ? 'is-sorted' : ''}" data-col="task_owner">
                            <div class="th-sort-wrapper">
                                <span>${__('Task Owner')}</span>
                                <i class="fa ${this.get_sort_icon('task_owner')}"></i>
                            </div>
                        </th>
                        <th class="sortable-col ${this.sort_by === 'status' ? 'is-sorted' : ''}" data-col="status">
                            <div class="th-sort-wrapper">
                                <span>${__('Status')}</span>
                                <i class="fa ${this.get_sort_icon('status')}"></i>
                            </div>
                        </th>
                        <th class="sortable-col ${this.sort_by === 'priority' ? 'is-sorted' : ''}" data-col="priority">
                            <div class="th-sort-wrapper">
                                <span>${__('Priority')}</span>
                                <i class="fa ${this.get_sort_icon('priority')}"></i>
                            </div>
                        </th>
                        <th class="sortable-col ${this.sort_by === 'exp_start_date' ? 'is-sorted' : ''}" data-col="exp_start_date">
                            <div class="th-sort-wrapper">
                                <span>${__('Start Date')}</span>
                                <i class="fa ${this.get_sort_icon('exp_start_date')}"></i>
                            </div>
                        </th>
                        <th class="sortable-col ${this.sort_by === 'exp_end_date' ? 'is-sorted' : ''}" data-col="exp_end_date">
                            <div class="th-sort-wrapper">
                                <span>${__('End Date')}</span>
                                <i class="fa ${this.get_sort_icon('exp_end_date')}"></i>
                            </div>
                        </th>
                        <th class="text-center" style="min-width: 135px;">${__('Actions')}</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        `);
    }

    render_pagination() {
        const $container = this.page.body.find('#pipe-pagination-container');
        if (!this.total_count || this.total_count <= 0) {
            $container.empty();
            return;
        }

        const totalPages = this.total_pages || 1;
        const currentPage = this.page_number || 1;

        // Generate pagination buttons
        let pageButtons = [];
        const maxVisible = 5;
        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, startPage + maxVisible - 1);

        if (endPage - startPage < maxVisible - 1) {
            startPage = Math.max(1, endPage - maxVisible + 1);
        }

        if (startPage > 1) {
            pageButtons.push(`<button class="pagination-btn" data-page="1">1</button>`);
            if (startPage > 2) {
                pageButtons.push(`<span class="pagination-ellipsis">...</span>`);
            }
        }

        for (let p = startPage; p <= endPage; p++) {
            pageButtons.push(`
                <button class="pagination-btn ${p === currentPage ? 'is-active' : ''}" data-page="${p}">${p}</button>
            `);
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                pageButtons.push(`<span class="pagination-ellipsis">...</span>`);
            }
            pageButtons.push(`<button class="pagination-btn" data-page="${totalPages}">${totalPages}</button>`);
        }

        $container.html(`
            <div class="table-bottom-pagination">
                <div class="pagination-size-selector">
                    <span>${__('Rows per page:')}</span>
                    <select class="pagination-size-select" id="pipe-page-size">
                        <option value="10" ${this.page_size === 10 ? 'selected' : ''}>10</option>
                        <option value="20" ${this.page_size === 20 ? 'selected' : ''}>20</option>
                        <option value="50" ${this.page_size === 50 ? 'selected' : ''}>50</option>
                        <option value="100" ${this.page_size === 100 ? 'selected' : ''}>100</option>
                    </select>
                </div>

                <div class="pagination-nav">
                    <button class="pagination-btn pagination-prev" ${currentPage <= 1 ? 'disabled' : ''} title="${__('Previous Page')}">
                        <i class="fa fa-chevron-left"></i>
                    </button>
                    ${pageButtons.join('')}
                    <button class="pagination-btn pagination-next" ${currentPage >= totalPages ? 'disabled' : ''} title="${__('Next Page')}">
                        <i class="fa fa-chevron-right"></i>
                    </button>
                </div>
            </div>
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