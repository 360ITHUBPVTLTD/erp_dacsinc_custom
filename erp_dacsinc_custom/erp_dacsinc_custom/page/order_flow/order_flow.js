// ================================================================
//  Order Flow — desk page
//  Track a Sales Order through purchasing, job work, delivery & financials.
//  Tabs: Sales Tracker | Purchase Flow | Job Work | Accounts (Financials)
// ================================================================

frappe.pages['order-flow'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: '',
        single_column: true
    });
    const dashboard = new OrderFlow(page);
    wrapper.on_page_show = function() {
        dashboard.refresh(true);
    };
};

const OF_SEEN_KEY = 'dac_order_flow_last_seen';

// The single definition of the tracker stages. The summary tiles, the filter bar
// and its counts all read from here, so a stage can never appear in one place with
// a different label or a stale count.
const OF_STAGES = [
    { key: 'all',              label: 'All Open',           mod: '',          tile: 'info',      hint: 'Total active Sales Orders' },
    { key: 'need_to_bill',     label: 'Need to Bill',       mod: 'bill',      tile: 'need-bill', hint: 'Delivered 100% — needs Sales Invoice' },
    { key: 'draft_pick_list',  label: 'Draft Pick List',    mod: 'draft',     tile: 'draft',     hint: 'Pick List in draft — needs submit' },
    { key: 'ready_to_deliver', label: 'Ready for Delivery', mod: 'dn',        tile: 'dn',        hint: 'Pick List submitted — needs Delivery Note' },
    { key: 'stock_received',   label: 'Stock Arrived',      mod: 'rcpt',      tile: 'rcpt',      hint: 'Receipt done — needs Pick List' },
    { key: 'in_jobwork',       label: 'In Job Work',        mod: 'jw',        tile: 'jw',        hint: 'Active subcontracting POs' },
    { key: 'in_embroidery',    label: 'Embroidery',         mod: 'emb',       tile: 'emb',       hint: 'Active embroidery work' },
    { key: 'awaiting_stock',   label: 'Awaiting Stock (PO)', mod: 'po',       tile: 'wait',      hint: 'PO active — waiting for supplier receipt' },
    { key: 'newly_created',    label: 'Newly Created',      mod: 'new',       tile: 'new',       hint: 'New order — nothing raised yet' },
    { key: 'overdue',          label: 'Overdue',            mod: 'due',       tile: 'bad',       hint: 'Past delivery date' },
    { key: 'completed',        label: 'Completed',          mod: 'ok',        tile: 'ok',        hint: 'Fully delivered and billed, or closed' }
];

// Summary key that holds the count for each stage.
const OF_STAGE_COUNT_KEY = {
    all: 'open_orders', need_to_bill: 'need_to_bill', draft_pick_list: 'draft_pick_list',
    ready_to_deliver: 'ready_to_deliver', stock_received: 'stock_received',
    in_jobwork: 'in_jobwork', in_embroidery: 'in_embroidery',
    awaiting_stock: 'awaiting_stock', newly_created: 'newly_created', overdue: 'overdue',
    completed: 'completed'
};
const OF_TOGGLE_KEY = 'dac_of_stream_collapsed';

class OrderFlow {
    constructor(page) {
        this.page = page;
        this.$body = $(page.body);
        this.active = 'tracker';
        this.pur_subtab = 'mr'; // 'mr' | 'po' | 'receipt' | 'bill'
        this.job_subtab = 'po'; // 'po' | 'receipt'
        this.acc_subtab = 'receivables'; // 'receivables' | 'supplier' | 'jobber'
        this.approval_subtab = 'merchandiser'; // 'merchandiser' | 'unassigned' | 'final'
        this.perms = null;   // filled from the server; gates the final-approval tab
        this.days = 120;
        this.scope = 'open';
        this.stage_filter = 'all';
        this.search = '';
        this.merchandiser_filter = '';
        this.approval_stage_filter = '';
        this.cache = {};
        this.activity_cache = null;
        this.last_seen = localStorage.getItem(OF_SEEN_KEY) || '';
        // Stream collapsed by default unless explicitly set to '0'
        const stored_toggle = localStorage.getItem(OF_TOGGLE_KEY);
        this.stream_collapsed = stored_toggle === null ? true : stored_toggle === '1';

        // Load sales_order.js dynamically to get all its functions and design styles
        frappe.require('/assets/erp_dacsinc_custom/js/sales_order.js', () => {
            this.render_shell();
            this.bind();
            frappe.call({ method: 'erp_dacsinc_custom.order_flow_api.get_approval_permissions' })
                .then(r => { this.perms = r.message || {}; })
                .catch(() => { this.perms = {}; })
                .always(() => {
                    this.update_merchandiser_visibility();
                    this.switch_tab('approval');
                });
        });

        // Real-time update: automatically refresh the dashboard when the browser tab gains focus
        let last_focus_refresh = Date.now();
        $(window).on('focus', () => {
            const now = Date.now();
            if (now - last_focus_refresh > 3000) {
                last_focus_refresh = now;
                this.refresh(true);
            }
        });
    }

    render_shell() {
        this.$body.html(`
            <div class="of-page">
                <!-- Main Tabs -->
                <div class="of-tabs">
                    <button class="of-tab is-active" data-tab="approval">
                        <i class="fa fa-check-square-o"></i> SO Approvals
                        <span class="of-tab__badge of-hidden" id="of-new-badge-approval">0</span>
                    </button>
                    <button class="of-tab" data-tab="tracker">
                        <i class="fa fa-list-ul"></i> Sales Tracker
                        <span class="of-tab__badge of-hidden" id="of-new-badge-tracker">0</span>
                    </button>
                    <button class="of-tab" data-tab="purchase">
                        <i class="fa fa-shopping-cart"></i> Purchase Flow
                        <span class="of-tab__badge of-hidden" id="of-new-badge-purchase">0</span>
                    </button>
                    <button class="of-tab" data-tab="jobwork">
                        <i class="fa fa-cogs"></i> Job Work
                        <span class="of-tab__badge of-hidden" id="of-new-badge-jobwork">0</span>
                    </button>
                    <button class="of-tab" data-tab="accounts">
                        <i class="fa fa-calculator"></i> Accounts
                        <span class="of-tab__badge of-hidden" id="of-new-badge-accounts">0</span>
                    </button>
                    <button class="of-tab" data-tab="uniform">
                        <i class="fa fa-random"></i> Embroidery Transfers
                        <span class="of-tab__badge of-hidden" id="of-new-badge-uniform">0</span>
                    </button>
                </div>

                <!-- Toolbar -->
                <div class="of-toolbar">
                    <span class="of-search">
                        <i class="fa fa-search text-muted"></i>
                        <input type="search" id="of-search" autocomplete="off"
                               placeholder="Search order #, customer, supplier, item…">
                    </span>
                    <select class="of-select" id="of-merchandiser" style="display: none;">
                        <option value="">All Merchandisers</option>
                    </select>
                    <select class="of-select" id="of-approval-stage" style="display: none;">
                        <option value="">All Approval Stages</option>
                        <option value="Draft">Draft</option>
                        <option value="Pending Merchandiser Approval">Pending Merchandiser Approval</option>
                        <option value="Pending Final Approval">Pending Final Approval</option>
                        <option value="Approved">Approved</option>
                        <option value="Rejected">Rejected</option>
                    </select>
                    <select class="of-select" id="of-scope">
                        <option value="open">Open orders</option>
                        <option value="all">All orders</option>
                        <option value="mine">Created by me</option>
                    </select>
                    <select class="of-select" id="of-days">
                        <option value="30">Last 30 days</option>
                        <option value="120" selected>Last 120 days</option>
                        <option value="365">Last year</option>
                        <option value="3650">Everything</option>
                    </select>
                    <span class="of-spacer"></span>
                    <span class="of-count" id="of-count"></span>
                    <button class="of-btn" id="of-mark-seen" title="Mark every activity notification as seen">
                        <i class="fa fa-check"></i> Mark seen
                    </button>
                    <button class="of-btn" id="of-btn-refresh" title="Force reload dashboard data" style="margin-left: 8px;">
                        <i class="fa fa-refresh"></i> Refresh
                    </button>
                </div>

                <!-- Stage Filter Sub-Bar (Sales Tracker view) -->
                <div class="of-stage-bar" id="of-stage-bar">
                    <span class="of-stage-bar__label">Filter by Stage:</span>
                    ${OF_STAGES.map(s => `
                        <button class="of-stage-btn ${s.mod ? `of-stage-btn--${s.mod}` : ''} ${s.key === 'all' ? 'is-active' : ''}"
                                data-stage="${s.key}">
                            ${s.label}
                            <span class="of-stage-count" data-count="${s.key}">·</span>
                        </button>`).join('')}
                </div>

                <div id="of-panel-tracker"></div>
                <div id="of-panel-purchase" class="of-hidden"></div>
                <div id="of-panel-jobwork" class="of-hidden"></div>
                <div id="of-panel-accounts" class="of-hidden"></div>
                <div id="of-panel-approval" class="of-hidden"></div>
                <div id="of-panel-uniform" class="of-hidden"></div>
            </div>
        `);

        frappe.call({
            method: 'erp_dacsinc_custom.order_flow_api.get_merchandisers'
        }).then(r => {
            const list = r.message || [];
            const select = this.$body.find('#of-merchandiser');
            list.forEach(m => {
                select.append(`<option value="${m.name}">${m.full_name}</option>`);
            });
        });
    }

    bind() {
        this.$body.on('click', '.of-tab', (e) => {
            const tab = $(e.currentTarget).data('tab');
            this.switch_tab(tab);
        });

        // Purchase Flow, Job Work and Approvals Sub-Tab Switcher
        this.$body.on('click', '.of-subtab[data-subtab]', (e) => {
            const $btn = $(e.currentTarget);
            const sub = $btn.data('subtab');
            const parent_tab = this.active;
            
            if (parent_tab === 'purchase') {
                this.pur_subtab = sub;
                this.$body.find('#of-panel-purchase .of-subtab').removeClass('is-active')
                    .filter(`[data-subtab="${sub}"]`).addClass('is-active');
                ['mr', 'po', 'receipt'].forEach(s => {
                    this.$body.find(`#of-pur-sec-${s}`).toggleClass('of-hidden', s !== sub);
                });
            } else if (parent_tab === 'jobwork') {
                this.job_subtab = sub;
                this.$body.find('#of-panel-jobwork .of-subtab').removeClass('is-active')
                    .filter(`[data-subtab="${sub}"]`).addClass('is-active');
                ['po', 'receipt', 'fp', 'pn'].forEach(s => {
                    this.$body.find(`#of-job-sec-${s}`).toggleClass('of-hidden', s !== sub);
                });
            } else if (parent_tab === 'approval') {
                if (sub === 'final' && !(this.perms && this.perms.is_final_approver)) {
                    frappe.msgprint(__('Final approval is limited to the users configured in Admin Settings.'));
                    return;
                }
                this.approval_subtab = sub;
                this.$body.find('#of-panel-approval .of-subtab').removeClass('is-active')
                    .filter(`[data-subtab="${sub}"]`).addClass('is-active');
                this.refresh(true);
            }
        });

        // Accounts Sub-Tab Switcher
        this.$body.on('click', '.of-acc-subtab', (e) => {
            const sub = $(e.currentTarget).data('subtab');
            this.acc_subtab = sub;
            this.$body.find('.of-acc-subtab').removeClass('is-active')
                .filter(`[data-subtab="${sub}"]`).addClass('is-active');
            ['receivables', 'supplier', 'jobber'].forEach(s => {
                this.$body.find(`#of-acc-sec-${s}`).toggleClass('of-hidden', s !== sub);
                this.$body.find(`#of-acc-kpi-${s}`).toggleClass('of-hidden', s !== sub);
            });
        });

        // Click handler for Number Cards to filter stage
        this.$body.on('click', '.of-tile', (e) => {
            const stage = $(e.currentTarget).data('stage');
            if (stage) {
                this.switch_tab('tracker');
                this.set_stage_filter(stage);
            }
        });

        // Click handler for Stage Filter sub-buttons
        this.$body.on('click', '.of-stage-btn', (e) => {
            const stage = $(e.currentTarget).data('stage');
            this.set_stage_filter(stage);
        });

        let timer = null;
        this.$body.on('input', '#of-search', (e) => {
            this.search = e.target.value.trim();
            clearTimeout(timer);
            timer = setTimeout(() => this.refresh(true), 300);
        });

        this.$body.on('change', '#of-merchandiser', (e) => { this.merchandiser_filter = e.target.value; this.refresh(true); });
        this.$body.on('change', '#of-approval-stage', (e) => { this.approval_stage_filter = e.target.value; this.refresh(true); });
        this.$body.on('change', '#of-scope', (e) => { this.scope = e.target.value; this.refresh(true); });
        this.$body.on('change', '#of-days',  (e) => { this.days  = e.target.value; this.refresh(true); });

        this.$body.on('click', '#of-mark-seen', () => {
            this.last_seen = frappe.datetime.now_datetime();
            localStorage.setItem(OF_SEEN_KEY, this.last_seen);
            this.refresh(true);
        });

        this.$body.on('click', '#of-btn-refresh', () => {
            this.refresh(true);
        });

        // Activity Notification Full Row Clickable Toggle (Sync all tabs)
        this.$body.on('click', '.of-toggle-stream-header', () => {
            this.stream_collapsed = !this.stream_collapsed;
            localStorage.setItem(OF_TOGGLE_KEY, this.stream_collapsed ? '1' : '0');
            
            const $headers = this.$body.find('.of-toggle-stream-header');
            const $bodies = this.$body.find('.of-feed');
            
            $bodies.toggleClass('of-hidden', this.stream_collapsed);
            
            $headers.each((i, el) => {
                const $icon = $(el).find('.fa-chevron-down, .fa-chevron-up');
                const $label = $(el).find('.of-toggle-stream-label');
                $icon.toggleClass('fa-chevron-down', this.stream_collapsed).toggleClass('fa-chevron-up', !this.stream_collapsed);
                $label.text(this.stream_collapsed ? 'Show Stream' : 'Hide Stream');
            });
        });

        // Expandable Sales Order row toggle
        this.$body.on('click', 'tr.of-row-main', (e) => {
            if ($(e.target).closest('a, button').length) return;
            const $row = $(e.currentTarget);
            const so_name = $row.data('so');
            const $btn = $row.find('.of-so-toggle');
            this.toggle_so_details(so_name, $btn);
        });

        // Intercept user interactions on the stock widget container to automatically set window.cur_frm
        this.$body.on('mousedown click focusin', '.of-so-items-container', (e) => {
            const $container = $(e.currentTarget).closest('.of-so-items-container');
            const mock_frm = $container.data('mock_frm');
            if (mock_frm) {
                window.cur_frm = mock_frm;
            }
        });

        // Click notification entry to highlight matching Sales Order in table
        this.$body.on('click', '.of-feed__item', (e) => {
            const item = $(e.currentTarget);
            const so = item.data('so');
            $('.of-feed__item').removeClass('is-selected');
            item.addClass('is-selected');

            if (so) {
                const $row = this.$body.find(`tr[data-so="${so}"]`);
                if ($row.length) {
                    $('.of-table tr').removeClass('is-highlighted');
                    $row.addClass('is-highlighted');
                    $('html, body').animate({
                        scrollTop: $row.offset().top - 150
                    }, 400);
                }
            }
        });

        // Direct action buttons in table rows
        this.$body.on('click', '.of-action-btn', (e) => {
            const btn = $(e.currentTarget);
            const action = btn.data('action');
            const target = btn.data('target');
            const doctype = btn.data('doctype');
            const so = btn.data('so');
            const po = btn.data('po');

            if (action === 'open_doc' && target && doctype) {
                frappe.set_route('Form', doctype, target);
            } else if (action === 'make_invoice' && so) {
                frappe.model.open_mapped_doc({
                    method: 'erpnext.selling.doctype.sales_order.sales_order.make_sales_invoice',
                    source_name: so,
                    freeze_message: __('Creating Sales Invoice…')
                });
            } else if (action === 'make_purchase_invoice' && po) {
                frappe.model.open_mapped_doc({
                    method: 'erpnext.buying.doctype.purchase_order.purchase_order.make_purchase_invoice',
                    source_name: po,
                    freeze_message: __('Creating Purchase Invoice…')
                });
            } else if (action === 'make_dn' && target) {
                frappe.model.open_mapped_doc({
                    method: 'erpnext.stock.doctype.pick_list.pick_list.create_delivery_note',
                    source_name: target,
                    freeze_message: __('Creating Delivery Note from Pick List…')
                });
            } else if (action === 'make_picklist' && so) {
                frappe.set_route('Form', 'Sales Order', so);
            } else if (action === 'make_po_from_mr' && target) {
                frappe.model.open_mapped_doc({
                    method: 'erpnext.stock.doctype.material_request.material_request.make_purchase_order',
                    source_name: target,
                    freeze_message: __('Creating Purchase Order from Material Request…')
                });
            } else if (action === 'make_picklist_or_po' && so) {
                frappe.set_route('Form', 'Sales Order', so);
            }
        });

        // Approvals tab event bindings
        this.$body.on('click', '.of-approve-btn', (e) => {
            const btn = $(e.currentTarget);
            const so = btn.data('so');
            const state = btn.data('state');
            if (state === 'Pending Final Approval') {
                this.handle_final_approval(so);
            } else {
                this.handle_merchandiser_approval(so);
            }
        });

        this.$body.on('click', '.of-reject-btn', (e) => {
            const btn = $(e.currentTarget);
            const so = btn.data('so');
            frappe.prompt([
                {
                    fieldtype: 'Small Text',
                    fieldname: 'comment',
                    label: __('Reason for Rejection'),
                    reqd: 1
                }
            ], (values) => {
                frappe.call({
                    method: 'erp_dacsinc_custom.order_flow_api.reject_sales_orders',
                    args: {
                        sales_orders: [so],
                        comment: values.comment
                    }
                }).then(() => {
                    frappe.show_alert({message: __('Sales Order Rejected successfully'), color: 'green'});
                    this.refresh(true);
                });
            }, __('Enter Rejection Comment'));
        });

        this.$body.on('change', '#of-approval-select-all', (e) => {
            const chk = $(e.currentTarget);
            const checked = chk.is(':checked');
            this.$body.find('.of-approval-select').prop('checked', checked);
        });

        this.$body.on('click', '#of-bulk-approve-btn', () => {
            const selected = [];
            this.$body.find('.of-approval-select:checked').each((i, el) => {
                selected.push($(el).data('so'));
            });
            if (!selected.length) {
                frappe.msgprint(__('Please select at least one Sales Order to approve.'));
                return;
            }
            const sub = this.approval_subtab || 'merchandiser';
            if (sub === 'final') {
                frappe.confirm(__('Are you sure you want to bulk final approve the selected {0} Sales Orders?', [selected.length]), () => {
                    frappe.call({
                        method: 'erp_dacsinc_custom.order_flow_api.approve_sales_orders',
                        args: { sales_orders: selected }
                    }).then(() => {
                        frappe.show_alert({message: __('Sales Orders approved successfully'), color: 'green'});
                        this.refresh(true);
                    });
                });
            } else {
                frappe.call({
                    method: 'erp_dacsinc_custom.order_flow_api.verify_bulk_sales_orders',
                    args: { sales_orders: selected }
                }).then(r => {
                    const results = r.message || {};
                    const missing_details_sos = [];
                    const valid_sos = [];
                    selected.forEach(so => {
                        const res = results[so];
                        if (res && Object.values(res.missing).some(v => v === true)) {
                            missing_details_sos.push(so);
                        } else {
                            valid_sos.push(so);
                        }
                    });
                    if (missing_details_sos.length > 0) {
                        frappe.msgprint({
                            title: __('Missing Customer Details'),
                            message: __('The following Sales Orders cannot be approved in bulk because their Customer profiles are missing GSTIN, Tax Category, Primary Address, or Primary Contact. Please approve them individually to add or bypass details:<br><br><b>{0}</b>', [missing_details_sos.join(', ')])
                        });
                        return;
                    }
                    frappe.confirm(__('Are you sure you want to bulk approve the selected {0} Sales Orders?', [valid_sos.length]), () => {
                        frappe.call({
                            method: 'erp_dacsinc_custom.order_flow_api.approve_sales_orders',
                            args: { sales_orders: valid_sos }
                        }).then(() => {
                            frappe.show_alert({message: __('Sales Orders approved successfully'), color: 'green'});
                            this.refresh(true);
                        });
                    });
                });
            }
        });

        this.$body.on('click', '#of-bulk-reject-btn', () => {
            const selected = [];
            this.$body.find('.of-approval-select:checked').each((i, el) => {
                selected.push($(el).data('so'));
            });
            if (!selected.length) {
                frappe.msgprint(__('Please select at least one Sales Order to reject.'));
                return;
            }
            frappe.prompt([
                {
                    fieldtype: 'Small Text',
                    fieldname: 'comment',
                    label: __('Reason for Rejection'),
                    reqd: 1
                }
            ], (values) => {
                frappe.call({
                    method: 'erp_dacsinc_custom.order_flow_api.reject_sales_orders',
                    args: {
                        sales_orders: selected,
                        comment: values.comment
                    }
                }).then(() => {
                    frappe.show_alert({message: __('Sales Orders Rejected successfully'), color: 'green'});
                    this.refresh(true);
                });
            }, __('Enter Rejection Comment'));
        });

        // Uniform Embroidery Receive Click Handler
        this.$body.on('click', '.of-receive-btn', (e) => {
            const transfer_id = $(e.currentTarget).data('id');
            const dialog = new frappe.ui.Dialog({
                title: __('Receive from Embroidery'),
                fields: [
                    {
                        fieldtype: 'Link',
                        fieldname: 'to_warehouse',
                        options: 'Warehouse',
                        label: __('Destination Warehouse'),
                        reqd: 1
                    }
                ],
                primary_action_label: __('Receive'),
                primary_action: (values) => {
                    dialog.get_primary_btn().attr('disabled', true);
                    frappe.call({
                        method: 'erp_dacsinc_custom.uniform_transfer_api.receive_embroidery_transfer',
                        args: {
                            transfer_id: transfer_id,
                            to_warehouse: values.to_warehouse
                        }
                    }).then(r => {
                        dialog.hide();
                        frappe.show_alert({message: __('Embroidered items received successfully'), color: 'green'});
                        this.refresh(true);
                    }).always(() => {
                        dialog.get_primary_btn().attr('disabled', false);
                    });
                }
            });
            dialog.show();
        });

        // Embroidery Transfer Create Click Handler
        this.$body.on('click', '#of-create-transfer-btn', () => {
            this.prompt_create_transfer();
        });
    }

    set_stage_filter(stage) {
        this.stage_filter = stage || 'all';
        this.$body.find('.of-stage-btn').removeClass('is-active')
            .filter(`[data-stage="${this.stage_filter}"]`).addClass('is-active');
        this.$body.find('.of-tile').removeClass('is-active')
            .filter(`[data-stage="${this.stage_filter}"]`).addClass('is-active');
        this.refresh(true);
    }

    // The "All Merchandisers" filter belongs to the SO Approvals tab only — the other
    // tabs deliberately show the full downstream picture, unscoped by merchandiser.
    update_merchandiser_visibility() {
        const can_final = !!(this.perms && this.perms.is_final_approver);
        const is_admin = frappe.user_roles.includes("System Manager") || frappe.session.user === "Administrator";
        const show = this.active === 'approval' && (can_final || is_admin);
        this.$body.find('#of-merchandiser').toggle(show);
    }

    switch_tab(tab) {
        if (!tab || tab === this.active) return;
        this.active = tab;
        this.$body.find('.of-tab').removeClass('is-active')
            .filter(`[data-tab="${tab}"]`).addClass('is-active');
        ['tracker', 'purchase', 'jobwork', 'accounts', 'approval', 'uniform'].forEach(t => {
            this.$body.find(`#of-panel-${t}`).toggleClass('of-hidden', t !== tab);
        });
        this.$body.find('#of-stage-bar').toggleClass('of-hidden', tab !== 'tracker');
        this.$body.find('#of-approval-stage').toggle(tab === 'approval');
        this.update_merchandiser_visibility();

        // Dynamic context-aware search placeholder
        const placeholders = {
            tracker: __('Search Sales Order #, Customer, Item…'),
            purchase: __('Search Purchase Order #, Supplier, Sales Order, Item…'),
            jobwork: __('Search Job Work #, Supplier, Purchase Order, Sales Order…'),
            accounts: __('Search Invoice #, Customer, Supplier, Sales Order…'),
            approval: __('Search Sales Order #, Customer…'),
            uniform: __('Search transfers…')
        };
        this.$body.find('#of-search').attr('placeholder', placeholders[tab] || __('Search…'));

        this.refresh();
    }

    // ── Data ─────────────────────────────────────────────────────
    refresh(force) {
        this.load_summary();
        if (force) this.cache = {};

        const key = `${this.active}:${this.days}:${this.scope}:${this.stage_filter}:${this.search}:${this.merchandiser_filter}:${this.approval_stage_filter}`;
        if (this.cache[key]) {
            this.paint(this.cache[key]);
            this.load_activity();
            this.load_summary();
            return;
        }

        const panel = this.$body.find(`#of-panel-${this.active}`);
        if (!panel.children().length) {
            panel.html(`<div class="of-card"><div class="of-empty">
                <i class="fa fa-spinner fa-spin"></i> Loading data…</div></div>`);
        }

        const method = {
            tracker:  'erp_dacsinc_custom.order_flow_api.get_sales_tracker',
            purchase: 'erp_dacsinc_custom.order_flow_api.get_purchase_flow',
            jobwork:  'erp_dacsinc_custom.order_flow_api.get_jobwork_flow',
            accounts: 'erp_dacsinc_custom.order_flow_api.get_accounts_flow',
            approval: 'erp_dacsinc_custom.order_flow_api.get_pending_approvals',
            uniform:  'erp_dacsinc_custom.uniform_transfer_api.get_embroidery_transfers'
        }[this.active];

        // merchandiser is an approvals-only filter — never narrow the other tabs with it
        const merch = this.active === 'approval' ? (this.merchandiser_filter || null) : null;
        const args = { days: this.days, search: this.search || null, scope: this.scope, merchandiser: merch, approval_stage: this.approval_stage_filter || null };
        if (this.active === 'tracker') {
            args.stage_filter = this.stage_filter;
        }

        frappe.call({ method, args }).then(r => {
            const data = r.message;
            this.cache[key] = data;
            this.load_activity();
            this.paint(data);
            this.load_summary();
        });
    }

    load_summary() {
        if (this.active === 'tracker') {
            frappe.call({
                method: 'erp_dacsinc_custom.order_flow_api.get_summary',
                args: { days: this.days, scope: this.scope, search: this.search || null, approval_stage: this.approval_stage_filter || null }
            }).then(r => {
                const s = r.message || {};
                this.render_tracker_summary(s);
            });
        } else {
            const key = `${this.active}:${this.days}:${this.scope}:${this.stage_filter}:${this.search}`;
            const data = this.cache[key];
            if (data) {
                if (this.active === 'purchase') this.render_purchase_summary(data);
                if (this.active === 'jobwork') this.render_jobwork_summary(data);
                if (this.active === 'accounts') this.render_accounts_summary(data);
            } else {
                this.$body.find('#of-summary').html(`
                    <div style="padding: 10px; font-size:12px; color:var(--text-muted); text-align:center; width:100%;">
                        <i class="fa fa-spinner fa-spin"></i> Loading summary cards…
                    </div>
                `);
            }
        }
    }

    render_tracker_summary(s) {
        s = s || {};

        const tiles = OF_STAGES.map(st => {
            const value = of_num(s[OF_STAGE_COUNT_KEY[st.key]]);
            // "Overdue" is only alarming when there is something in it.
            const mod = (st.key === 'overdue' && !value) ? 'ok' : st.tile;
            return `
            <div class="of-tile of-tile--${mod} ${this.stage_filter === st.key ? 'is-active' : ''}"
                 data-stage="${st.key}" title="${of_esc(st.hint)}">
                <span class="of-tile__label">${__(st.label === 'All Open' ? 'Open Orders' : st.label)}</span>
                <div class="of-tile__value">${value}</div>
                <span class="of-tile__hint">Click to filter</span>
            </div>`;
        }).join('');

        this.$body.find('#of-summary').html(tiles);
        this.render_stage_counts(s);
    }

    /** Put the live count on every "Filter by Stage" button. */
    render_stage_counts(s) {
        s = s || {};
        OF_STAGES.forEach(st => {
            const value = of_num(s[OF_STAGE_COUNT_KEY[st.key]]);
            const $btn = this.$body.find(`.of-stage-btn[data-stage="${st.key}"]`);
            $btn.find('.of-stage-count').text(value);
            // A stage with nothing in it stays clickable but recedes.
            $btn.toggleClass('is-empty', !value && st.key !== 'all');
        });
    }

    render_purchase_summary(data) {
        const mrs = data.material_requests || [];
        const pos = data.purchase_orders || [];
        const rcs = data.receipts || [];

        const pending_mrs = mrs.filter(m => flt_of(m.qty) - flt_of(m.ordered_qty) > 0).length;
        const open_pos = pos.filter(p => p.status === 'To Receive and Bill' || p.status === 'To Receive').length;
        const total_ordered = pos.reduce((sum, p) => sum + flt_of(p.grand_total), 0);

        const tile = (label, value, mod, hint) => `
            <div class="of-tile of-tile--${mod} no-click" title="${hint || ''}">
                <span class="of-tile__label">${label}</span>
                <div class="of-tile__value">${value}</div>
            </div>`;

        this.$body.find('#of-summary-purchase').html(
            tile(__('Pending MRs'), pending_mrs, 'wait', 'Material Requests waiting to be ordered')
            + tile(__('Total MRs'), mrs.length, 'info', 'Total active Material Requests')
            + tile(__('Active POs'), open_pos, 'need-bill', 'Purchase Orders waiting for receipt')
            + tile(__('Total POs'), pos.length, 'dn', 'Total active Purchase Orders')
            + tile(__('Total Receipts'), rcs.length, 'rcpt', 'Total Purchase/Subcontracting Receipts')
            + tile(__('Ordered Amount'), of_money(total_ordered), 'ok', 'Grand total of active Purchase Orders')
        );
    }

    render_jobwork_summary(data) {
        const pos = data.purchase_orders || [];
        const ewos = data.embroidery_orders || [];

        const active_pos = pos.filter(p => p.status !== 'Completed' && p.status !== 'Closed').length;
        const active_ewos = ewos.filter(e => e.status !== 'Completed' && e.status !== 'Closed').length;
        const pending_po_qty = pos.reduce((sum, p) => sum + Math.max(0, flt_of(p.qty) - flt_of(p.received_qty)), 0);

        const tile = (label, value, mod, hint) => `
            <div class="of-tile of-tile--${mod} no-click" title="${hint || ''}">
                <span class="of-tile__label">${label}</span>
                <div class="of-tile__value">${value}</div>
            </div>`;

        this.$body.find('#of-summary-jobwork').html(
            tile(__('Active Subcontract POs'), active_pos, 'info', 'Active Subcontracting Purchase Orders')
            + tile(__('Total Subcontract POs'), pos.length, 'draft', 'Total Subcontracting Purchase Orders')
            + tile(__('Active Embroidery'), active_ewos, 'wait', 'Active Embroidery Work Orders')
            + tile(__('Total Embroidery'), ewos.length, 'new', 'Total Embroidery Work Orders')
            + tile(__('Pending Subcontract Qty'), Math.floor(pending_po_qty), 'bad', 'Quantity remaining to receive from subcontracting')
        );
    }

    render_accounts_summary(data) {
        const m = data.metrics || {};

        const tile = (label, value, mod, is_money, hint) => `
            <div class="of-tile of-tile--${mod} no-click" title="${hint || ''}">
                <span class="of-tile__label">${label}</span>
                <div class="of-tile__value" style="font-size: 12px; font-weight:700;">${is_money ? of_money(value) : value}</div>
            </div>`;

        this.$body.find('#of-summary-accounts').html(
            tile(__('Customer Receivables'), m.sales_outstanding || 0, 'bad', true, 'Pending customer payments to collect')
            + tile(__('Total Sales Billed'), m.sales_total || 0, 'info', true, 'Total sales invoice amount')
            + tile(__('Supplier Payables'), m.supplier_outstanding || 0, 'need-bill', true, 'Pending supplier payments to make')
            + tile(__('Total Supplier Billed'), m.supplier_total || 0, 'dn', true, 'Total supplier bill amount')
            + tile(__('Jobber Payables'), m.jobber_outstanding || 0, 'wait', true, 'Pending jobber payments to make')
            + tile(__('Total Jobber Billed'), m.jobber_total || 0, 'new', true, 'Total jobber bill amount')
        );
    }

    load_activity() {
        if (this.activity_cache) {
            this.render_activity(this.activity_cache);
        }

        frappe.call({
            method: 'erp_dacsinc_custom.order_flow_api.get_activity',
            args: { days: this.days, limit: 60 }
        }).then(r => {
            const rows = r.message || [];
            this.activity_cache = rows;
            this.render_activity(rows);
        });
    }

    render_activity(rows) {
        rows = rows || [];

        const tab_doctypes = {
            tracker: null,
            purchase: ['Material Request', 'Purchase Order', 'Purchase Receipt'],
            jobwork: ['Job Work (Subcontract)', 'Embroidery Work Order', 'Subcontracting Receipt'],
            accounts: ['Sales Invoice', 'Purchase Invoice'],
            approval: ['Sales Order', 'Comment']
        };

        // Update badges for all main tabs
        ['tracker', 'purchase', 'jobwork', 'accounts', 'approval'].forEach(tab => {
            const doctypes = tab_doctypes[tab];
            const tab_rows = doctypes ? rows.filter(x => doctypes.includes(x.doctype)) : rows;
            const fresh = tab_rows.filter(x => this.last_seen && x.ts > this.last_seen).length;
            const $badge = this.$body.find(`#of-new-badge-${tab}`);
            if ($badge.length) {
                $badge.text(fresh).toggleClass('of-hidden', !fresh);
            }
        });

        // Populate stream for the currently active tab
        const active_doctypes = tab_doctypes[this.active];
        const active_rows = active_doctypes ? rows.filter(x => active_doctypes.includes(x.doctype)) : rows;

        const $active_feed = this.$body.find(`#of-activity-${this.active}`);
        if ($active_feed.length) {
            $active_feed.html(this.activity_html(active_rows));
        }
    }

    activity_stream_html(tab_name) {
        return `
            <div class="of-card">
                <div class="of-card__head of-card__head--toggle of-toggle-stream-header" style="justify-content:space-between;cursor:pointer;">
                    <div>
                        <i class="fa fa-bell" style="color:var(--of-orange);"></i> Live Order Activity Notifications
                        <small style="margin-left:8px;">Click entire row to collapse/expand stream</small>
                    </div>
                    <span class="of-btn of-btn--sm" style="pointer-events:none;">
                        <i class="fa ${this.stream_collapsed ? 'fa-chevron-down' : 'fa-chevron-up'}"></i>
                        <span class="of-toggle-stream-label">${this.stream_collapsed ? 'Show Stream' : 'Hide Stream'}</span>
                    </span>
                </div>
                <div class="of-feed ${this.stream_collapsed ? 'of-hidden' : ''}" id="of-activity-container-${tab_name}">
                    <div id="of-activity-${tab_name}">
                        <div class="of-empty"><i class="fa fa-spinner fa-spin"></i> Loading notifications…</div>
                    </div>
                </div>
            </div>`;
    }

    toggle_so_details(so_name, $btn) {
        const $row = this.$body.find(`tr[data-so="${so_name}"]`);
        let $details_row = this.$body.find(`#of-so-details-${so_name}`);

        if (!$details_row.length) {
            $details_row = $(`
                <tr id="of-so-details-${so_name}" class="of-so-details-row of-hidden" style="display:none;">
                    <td colspan="8" style="padding:15px; background:var(--subtle-fg); text-align:left;">
                        <div class="of-so-items-container" data-so="${so_name}" style="background:var(--card-bg); padding:10px; border-radius:8px; border:1px solid var(--border-color);">
                            <div class="of-empty"><i class="fa fa-spinner fa-spin"></i> Loading stock details…</div>
                        </div>
                    </td>
                </tr>
            `);
            $row.after($details_row);
        }

        const is_collapsed = $details_row.hasClass('of-hidden') || !$details_row.is(':visible');

        if (is_collapsed) {
            $details_row.removeClass('of-hidden').show();
            $btn.removeClass('fa-caret-right').addClass('fa-caret-down');
            
            const $container = $details_row.find('.of-so-items-container');
            if ($container.find('.of-empty').length || $container.find('.so-card').length === 0) {
                this.load_so_details(so_name, $container);
            } else {
                const mock_frm = $container.data('mock_frm');
                if (mock_frm) {
                    window.cur_frm = mock_frm;
                }
            }
        } else {
            $details_row.addClass('of-hidden').hide();
            $btn.removeClass('fa-caret-down').addClass('fa-caret-right');
        }
    }

    load_so_details(so_name, $container) {
        frappe.model.with_doc('Sales Order', so_name, () => {
            const doc = frappe.model.get_doc('Sales Order', so_name);
            if (!doc) {
                $container.html('<div class="alert alert-danger">Could not load Sales Order document details.</div>');
                return;
            }

            const mock_frm = {
                doc: doc,
                custom_stock_data: {},
                is_new: () => false,
                fields_dict: {
                    custom_available_quantity_html: {
                        $wrapper: $container
                    }
                }
            };

            $container.data('mock_frm', mock_frm);
            window.cur_frm = mock_frm;

            if (typeof generate_stock_overview_table === 'function') {
                generate_stock_overview_table(mock_frm);
            } else {
                $container.html('<div class="alert alert-warning">generate_stock_overview_table function not found.</div>');
            }
        });
    }

    paint(data) {
        try {
            const panel = this.$body.find(`#of-panel-${this.active}`);
            let html = '';
            if (this.active === 'tracker')  html = this.tracker_html(data);
            if (this.active === 'purchase') html = this.purchase_html(data);
            if (this.active === 'jobwork')  html = this.jobwork_html(data);
            if (this.active === 'accounts') html = this.accounts_html(data);
            if (this.active === 'approval') html = this.approval_html(data);
            if (this.active === 'uniform')  html = this.uniform_html(data);
            panel.html(html);
        } catch (e) {
            console.error("Error painting panel:", this.active, e);
            const panel = this.$body.find(`#of-panel-${this.active}`);
            panel.html(`
                <div class="of-card" style="border-color:var(--of-red); padding:20px; border-left: 4px solid var(--of-red);">
                    <h4 style="color:var(--of-red); margin-top:0; font-size:14px;"><i class="fa fa-exclamation-triangle"></i> Rendering Error</h4>
                    <p style="font-size:12px; color:var(--text-color); margin: 8px 0;">An error occurred while rendering the <b>${this.active}</b> tab:</p>
                    <pre style="font-size:11px; background:var(--subtle-fg); padding:10px; border-radius:4px; overflow-x:auto; border:1px solid var(--border-color); color:var(--text-color);">${of_esc(e.stack || e.message || e)}</pre>
                    <button class="of-btn of-btn--primary" style="margin-top:10px;" onclick="location.reload();"><i class="fa fa-refresh"></i> Reload Page</button>
                </div>
            `);
        }
    }

    // ── Tab 1: tracker ───────────────────────────────────────────
    tracker_html(orders) {
        orders = orders || [];
        this.$body.find('#of-count').text(
            orders.length ? __('{0} order(s) shown', [orders.length]) : ''
        );

        const rows = orders.map(o => {
            const c = o.counts || {};
            const st = o.stage || {};
            const is_new = this.last_seen && o.last_event_on && o.last_event_on > this.last_seen;

            const chain = [
                ['MR', c['Material Request']],
                ['PO', c['Purchase Order']],
                ['Recv', (c['Purchase Receipt'] || 0) + (c['Subcontracting Receipt'] || 0)],
                ['Job', (c['Job Work (Subcontract)'] || 0) + (c['Embroidery Work Order'] || 0)],
                ['Pick', c['Pick List']],
                ['DN', c['Delivery Note']],
                ['Inv', c['Sales Invoice']]
            ].map(([label, n]) => `<span class="of-micro" style="margin-right:7px;${n ? 'color:var(--of-info);font-weight:600;' : 'opacity:.45;'}">${label}${n ? ` ${n}` : ''}</span>`).join('');

            // Action Button HTML
            let action_btn_html = '';
            if (st.action_type && st.action_type !== 'none') {
                action_btn_html = `
                    <button class="of-btn ${st.action_btn_class || 'of-btn--primary'} of-action-btn"
                            data-action="${st.action_type}"
                            data-target="${st.target_doc || ''}"
                            data-doctype="${st.target_doctype || ''}"
                            data-so="${o.name}">
                        <i class="fa fa-${st.icon || 'arrow-right'}"></i> ${of_esc(st.action_label || 'Act')}
                    </button>`;
            } else {
                action_btn_html = `<span class="of-micro" style="color:var(--of-green);font-weight:600;"><i class="fa fa-check-circle"></i> Completed</span>`;
            }

            return `
            <tr data-so="${o.name}" class="${o.is_overdue ? 'of-row--overdue' : ''} of-row-main">
                <td>
                    <div style="display:flex; align-items:center; gap:6px;">
                        <i class="fa fa-caret-right of-so-toggle" style="cursor:pointer; width:12px; font-size:14px; color:var(--text-light);" data-so="${o.name}"></i>
                        <div>
                            <a href="/app/sales-order/${encodeURIComponent(o.name)}" target="_blank" style="font-weight:700;">${of_esc(o.name)}</a>
                            ${is_new ? '<span class="of-new-dot" title="New activity notification"></span>' : ''}
                            ${o.is_overdue ? '<span class="of-chip of-chip--bad" style="margin-left:4px;">OVERDUE</span>' : ''}
                            <div class="of-meta" style="font-weight:500;">
                                <a href="/app/customer/${encodeURIComponent(o.customer)}" target="_blank" style="color:inherit;">${of_esc(o.customer_name || o.customer || '')}</a>
                            </div>
                        </div>
                    </div>
                </td>
                <td class="of-meta">
                    ${of_date(o.transaction_date)}
                    <div class="of-micro" style="${o.is_overdue ? 'color:var(--of-red);font-weight:700;' : ''}">Due ${of_date(o.delivery_date)}</div>
                </td>
                <td>
                    <span class="of-pill ${st.badge_class || 'of-pill--draft'}">
                        <i class="fa fa-${st.icon || 'circle'}"></i> ${of_esc(st.stage_label || 'Open')}
                    </span>
                </td>
                <td>
                    ${action_btn_html}
                </td>
                <td style="text-align:left;">${chain}</td>
                <td>
                    ${of_pct_bar(o.per_delivered)}
                </td>
                <td>
                    ${of_pct_bar(o.per_billed)}
                </td>
                <td>
                    ${o.last_event
                        ? `<div class="of-micro">${of_esc(o.last_event)}</div>
                           <a href="/app/${of_route(o.last_event)}/${encodeURIComponent(o.last_event_doc)}" target="_blank">${of_esc(o.last_event_doc)}</a>
                           <div class="of-micro">${of_ago(o.last_event_on)}</div>`
                        : '<span class="of-val of-val--zero">—</span>'}
                </td>
            </tr>`;
        }).join('');

        return `
            <!-- Top Summary Cards (Interactive Stage Number Cards) -->
            <div class="of-summary" id="of-summary-tracker"></div>

            <!-- Live Activity Notification Stream -->
            ${this.activity_stream_html('tracker')}

            <!-- Sales Order Action Tracker Table -->
            <div class="of-card">
                <div class="of-card__head">
                    <i class="fa fa-tasks"></i> Sales Order Stage &amp; Required Action Plan
                    <small>Clear next action button for every order</small>
                </div>
                <div class="of-scroll">
                    <table class="of-table">
                        <thead><tr>
                            <th style="min-width:180px;">Sales Order &amp; Customer</th>
                            <th style="width:110px;">Dates</th>
                            <th style="width:160px;">Current Stage</th>
                            <th style="min-width:190px;">Action Required</th>
                            <th style="min-width:180px;">Document Flow</th>
                            <th style="width:90px;">Delivered</th>
                            <th style="width:90px;">Billed</th>
                            <th style="width:140px;">Last Activity</th>
                        </tr></thead>
                        <tbody>${rows || `<tr><td colspan="8" class="of-empty">
                             <i class="fa fa-inbox"></i>No orders match the selected stage filter.</td></tr>`}</tbody>
                    </table>
                </div>
            </div>`;
    }

    activity_html(rows) {
        if (!rows || !rows.length) {
            return `<div class="of-empty"><i class="fa fa-inbox"></i>No recent activity.</div>`;
        }
        return rows.map(ev => {
            const is_new = this.last_seen && ev.ts > this.last_seen;
            const ic = OF_ICON[ev.doctype] || { i: 'file-o', c: 'var(--of-gray)' };

            let link_doctype = ev.doctype;
            let link_name = ev.name;
            if (link_doctype === 'Embroidery Work Order') {
                link_doctype = 'Purchase Order';
            }
            let doc_link = `<a href="/app/${of_route(link_doctype)}/${encodeURIComponent(link_name)}" target="_blank" style="font-weight:700;">${of_esc(link_name)}</a>`;
            if (ev.doctype === 'Comment') {
                doc_link = '';
            }
            const so_link = `<a href="/app/sales-order/${encodeURIComponent(ev.sales_order)}" target="_blank" style="font-weight:700;">${of_esc(ev.sales_order)}</a>`;
            
            let action = 'updated';
            let status_str = '';
            if (ev.doctype === 'Comment') {
                action = 'added';
                const tempDiv = document.createElement("div");
                tempDiv.innerHTML = ev.status;
                const text = (tempDiv.textContent || tempDiv.innerText || '').substring(0, 120);
                status_str = `<span style="font-style: italic; color: var(--text-muted); margin-left: 5px;">"${of_esc(text)}"</span>`;
            } else {
                if (ev.docstatus === 0) action = 'created as Draft';
                else if (ev.docstatus === 1) {
                    if (['Purchase Receipt', 'Subcontracting Receipt', 'Sales Invoice', 'Purchase Invoice', 'Delivery Note'].includes(ev.doctype)) {
                        action = 'submitted';
                    } else {
                        action = 'active';
                    }
                } else if (ev.docstatus === 2) {
                    action = 'cancelled';
                }

                if (ev.status) {
                    let pill_class = 'draft';
                    const s = String(ev.status).toLowerCase();
                    if (/(completed|closed|paid|received|delivered)/.test(s)) pill_class = 'ready';
                    else if (/(overdue|cancelled|return|stopped)/.test(s))    pill_class = 'blocked';
                    else if (/(to deliver|to receive|to bill|partly|pending)/.test(s)) pill_class = 'wait';
                    else if (/(submitted|open|in progress|ordered|transferred)/.test(s)) pill_class = 'dn';
                    
                    status_str = `<span class="of-pill of-pill--${pill_class}" style="font-size:9px; padding:1px 6px; margin-left:5px; font-weight:600; vertical-align:middle; display:inline-block; border-radius:10px;">${of_esc(ev.status)}</span>`;
                }
            }

            let party_str = '';
            if (ev.party) {
                const is_cust = ['Pick List', 'Delivery Note', 'Sales Invoice'].includes(ev.doctype);
                const party_label = is_cust ? 'Customer' : 'Supplier';
                const party_route = is_cust ? 'customer' : 'supplier';
                const link_text = ev.party_name || ev.party;
                party_str = ` (${party_label}: <a href="/app/${party_route}/${encodeURIComponent(ev.party)}" target="_blank" style="font-weight:600;">${of_esc(link_text)}</a>)`;
            }
            const customer_str = ev.customer_name ? ` · ${of_esc(ev.customer_name)}` : '';

            return `
            <div class="of-feed__item ${is_new ? 'is-new' : ''}" data-so="${of_esc(ev.sales_order)}">
                <div class="of-feed__icon" style="background:${ic.c};"><i class="fa fa-${ic.i}"></i></div>
                <div class="of-feed__body">
                    <div style="font-size:12px; color:var(--text-color); line-height:1.4;">
                        <strong>${of_esc(ev.doctype)}</strong> ${doc_link} was ${action}${status_str}${party_str}
                    </div>
                    <div class="of-feed__sub" style="margin-top:3px; font-size:11px; color:var(--text-muted);">
                        against Sales Order ${so_link}${customer_str}
                    </div>
                </div>
                <div class="of-feed__time">${of_ago(ev.ts)}${is_new ? '<span class="of-new-dot"></span>' : ''}</div>
            </div>`;
        }).join('');
    }

    // ── Tab 2: purchase ──────────────────────────────────────────
    purchase_html(data) {
        data = data || {};
        const mrs = data.material_requests || [];
        const pos = data.purchase_orders || [];
        const rcs = data.receipts || [];
        const pos_need_bill = pos.filter(p => flt_of(p.per_received) >= 100 && flt_of(p.per_billed) < 100);
        this.$body.find('#of-count').text(__('{0} MR · {1} PO · {2} receipts · {3} need bill', [mrs.length, pos.length, rcs.length, pos_need_bill.length]));

        const mr_rows = mrs.map(m => {
            const pending = flt_of(m.qty) - flt_of(m.ordered_qty);
            return `<tr>
                <td><a href="/app/material-request/${encodeURIComponent(m.name)}" target="_blank" style="font-weight:700;">${of_esc(m.name)}</a>
                    <div class="of-micro">${of_esc(m.material_request_type || '')}</div></td>
                <td>${of_so_links(m.sales_orders)}</td>
                <td class="of-meta">${of_date(m.transaction_date)}
                    <div class="of-micro">by ${of_date(m.schedule_date)}</div></td>
                <td>${of_qty(m.qty)}<div class="of-micro">${of_num(m.item_count)} item(s)</div></td>
                <td>${of_qty(m.ordered_qty, 'info')}</td>
                <td>${of_qty(pending, pending > 0 ? 'warn' : null)}</td>
                <td>${of_doc_status(m.status)}</td>
                <td>
                    ${pending > 0
                        ? `<button class="of-btn of-btn--primary of-action-btn" data-action="make_po_from_mr" data-target="${m.name}">
                            <i class="fa fa-shopping-cart"></i> Order PO</button>`
                        : '<span class="of-micro" style="color:var(--of-green);font-weight:600;">Ordered</span>'}
                </td>
            </tr>`;
        }).join('');

        const po_rows = pos.map(p => `
            <tr>
                <td><a href="/app/purchase-order/${encodeURIComponent(p.name)}" target="_blank" style="font-weight:700;">${of_esc(p.name)}</a>
                    ${flt_of(p.is_subcontracted) === 1 ? '<div><span class="of-chip">Subcontract</span></div>' : ''}</td>
                <td style="text-align:left;">
                    <a href="/app/supplier/${encodeURIComponent(p.supplier)}" target="_blank" style="font-weight:600;">${of_esc(p.supplier_name || p.supplier || '')}</a>
                    <div class="of-micro text-muted">${of_esc(p.supplier || '')}</div>
                </td>
                <td>${of_so_links(p.sales_orders)}</td>
                <td class="of-meta">${of_date(p.transaction_date)}
                    <div class="of-micro">exp ${of_date(p.schedule_date)}</div></td>
                <td>${of_qty(p.qty)}</td>
                <td>${of_qty(p.received_qty, flt_of(p.received_qty) > 0 ? 'pos' : null)}
                    ${of_pct_bar(p.per_received)}</td>
                <td>${of_money(p.grand_total, p.currency)}</td>
                <td>${of_doc_status(p.status)}</td>
                <td>
                    <a class="of-btn" href="/app/purchase-order/${encodeURIComponent(p.name)}" target="_blank">
                        <i class="fa fa-external-link"></i> Open PO
                    </a>
                </td>
            </tr>`).join('');

        const bill_rows = pos_need_bill.map(p => `
            <tr>
                <td><a href="/app/purchase-order/${encodeURIComponent(p.name)}" target="_blank" style="font-weight:700;">${of_esc(p.name)}</a></td>
                <td style="text-align:left;">
                    <a href="/app/supplier/${encodeURIComponent(p.supplier)}" target="_blank" style="font-weight:600;">${of_esc(p.supplier_name || p.supplier || '')}</a>
                    <div class="of-micro text-muted">${of_esc(p.supplier || '')}</div>
                </td>
                <td>${of_so_links(p.sales_orders)}</td>
                <td class="of-meta">${of_date(p.transaction_date)}
                    <div class="of-micro">exp ${of_date(p.schedule_date)}</div></td>
                <td>${of_qty(p.qty)}</td>
                <td>${of_qty(p.received_qty, flt_of(p.received_qty) > 0 ? 'pos' : null)}
                    ${of_pct_bar(p.per_received)}</td>
                <td>${of_money(p.grand_total, p.currency)}</td>
                <td>${of_doc_status(p.status)}</td>
                <td>
                    ${p.draft_invoice ? `
                        <a class="of-btn of-btn--warning" href="/app/purchase-invoice/${encodeURIComponent(p.draft_invoice)}" target="_blank" style="font-weight:700;">
                            <i class="fa fa-external-link"></i> Open Draft (${p.draft_invoice})
                        </a>
                    ` : `
                        <button class="of-btn of-btn--primary of-action-btn" data-action="make_purchase_invoice" data-po="${p.name}">
                            <i class="fa fa-file-text-o"></i> Create Invoice
                        </button>
                    `}
                </td>
            </tr>`).join('');

        const rc_rows = rcs.map(r => `
            <tr>
                <td><a href="/app/${of_route(r.doctype)}/${encodeURIComponent(r.name)}" target="_blank" style="font-weight:700;">${of_esc(r.name)}</a>
                    <div class="of-micro">${of_esc(r.doctype)}</div></td>
                <td style="text-align:left;">
                    <a href="/app/supplier/${encodeURIComponent(r.supplier)}" target="_blank" style="font-weight:600;">${of_esc(r.supplier_name || r.supplier || '')}</a>
                </td>
                <td>${of_so_links(r.sales_orders)}</td>
                <td>${of_po_links(r.purchase_orders)}</td>
                <td class="of-meta">${of_date(r.posting_date)}</td>
                <td>${of_qty(r.qty, 'pos')}</td>
                <td>${of_money(r.grand_total, r.currency)}</td>
                <td>${of_doc_status(r.status)}</td>
            </tr>`).join('');

        const subtab = this.pur_subtab || 'mr';

        return `
            <!-- Top Summary Cards -->
            <div class="of-summary" id="of-summary-purchase"></div>

            <!-- Purchase Flow Sub-Tab Navigation Bar -->
            <div class="of-subtabs">
                <button class="of-subtab ${subtab === 'mr' ? 'is-active' : ''}" data-subtab="mr">
                    <i class="fa fa-file-text-o" style="color:var(--of-purple);"></i> 1. Material Requests
                </button>
                <button class="of-subtab ${subtab === 'po' ? 'is-active' : ''}" data-subtab="po">
                    <i class="fa fa-shopping-cart" style="color:var(--of-blue);"></i> 2. Purchase Orders
                </button>
                <button class="of-subtab ${subtab === 'receipt' ? 'is-active' : ''}" data-subtab="receipt">
                    <i class="fa fa-inbox" style="color:var(--of-green);"></i> 3. Receipts
                </button>
                <button class="of-subtab ${subtab === 'bill' ? 'is-active' : ''}" data-subtab="bill">
                    <i class="fa fa-calculator" style="color:var(--of-orange);"></i> 4. Need to Bill POs
                </button>
            </div>

            <!-- Purchase-specific live activity stream -->
            ${this.activity_stream_html('purchase')}

            <!-- Subtab Sections -->
            <div id="of-pur-sec-mr" class="${subtab !== 'mr' ? 'of-hidden' : ''}">
                ${of_card('Material Requests', 'file-text-o', `
                    <table class="of-table">
                        <thead><tr><th style="min-width:170px;">Material Request</th><th>Sales Order</th><th>Dates</th>
                            <th>Requested</th><th>Ordered</th><th>Not ordered</th><th>Status</th><th>Action</th></tr></thead>
                        <tbody>${mr_rows || of_empty_row(8)}</tbody>
                    </table>`)}
            </div>

            <div id="of-pur-sec-po" class="${subtab !== 'po' ? 'of-hidden' : ''}">
                ${of_card('Purchase Orders', 'shopping-cart', `
                    <table class="of-table">
                        <thead><tr><th style="min-width:170px;">Purchase Order</th><th style="min-width:150px;">Supplier</th>
                            <th>Sales Order</th><th>Dates</th><th>Ordered</th><th>Received</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead>
                        <tbody>${po_rows || of_empty_row(9)}</tbody>
                    </table>`)}
            </div>

            <div id="of-pur-sec-receipt" class="${subtab !== 'receipt' ? 'of-hidden' : ''}">
                ${of_card('Receipts', 'inbox', `
                    <table class="of-table">
                        <thead><tr><th style="min-width:170px;">Receipt</th><th style="min-width:150px;">Supplier</th>
                            <th>Sales Order</th><th>Against PO</th><th>Date</th><th>Received</th><th>Amount</th><th>Status</th></tr></thead>
                        <tbody>${rc_rows || of_empty_row(8)}</tbody>
                    </table>`)}
            </div>

            <div id="of-pur-sec-bill" class="${subtab !== 'bill' ? 'of-hidden' : ''}">
                ${of_card('Purchase Orders (Fully Received, Pending Invoice)', 'calculator', `
                    <table class="of-table">
                        <thead><tr><th style="min-width:170px;">Purchase Order</th><th style="min-width:150px;">Supplier</th>
                            <th>Sales Order</th><th>Dates</th><th>Ordered</th><th>Received</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead>
                        <tbody>${bill_rows || of_empty_row(9)}</tbody>
                    </table>`)}
            </div>`;
    }

    // ── Tab 3: job work ──────────────────────────────────────────
    jobwork_html(data) {
        data = data || {};
        const pos = data.purchase_orders || [];
        const rcs = data.receipts || [];
        const ewos = data.embroidery_orders || [];
        const ewo_fp = ewos.filter(e => e.work_type === 'Full Piece Job Work');
        const ewo_pn = ewos.filter(e => e.work_type === 'Panel Job Work');
        this.$body.find('#of-count').text(__('{0} job work POs · {1} receipts · {2} full piece · {3} panel', 
            [pos.length, rcs.length, ewo_fp.length, ewo_pn.length]));

        const po_rows = pos.map(p => `
            <tr>
                <td><a href="/app/purchase-order/${encodeURIComponent(p.name)}" target="_blank" style="font-weight:700;">${of_esc(p.name)}</a>
                    <div><span class="of-chip" style="background:var(--of-purple);color:#fff;">Job Work</span></div></td>
                <td style="text-align:left;">
                    <a href="/app/supplier/${encodeURIComponent(p.supplier)}" target="_blank" style="font-weight:600;">${of_esc(p.supplier_name || p.supplier || '')}</a>
                    <div class="of-micro text-muted">${of_esc(p.supplier || '')}</div>
                </td>
                <td>${of_so_links(p.sales_orders)}</td>
                <td class="of-meta">${of_date(p.transaction_date)}
                    <div class="of-micro">exp ${of_date(p.schedule_date)}</div></td>
                <td>${of_qty(p.qty)}</td>
                <td>${of_qty(p.received_qty, flt_of(p.received_qty) > 0 ? 'pos' : null)}
                    ${of_pct_bar(p.per_received)}</td>
                <td>${of_money(p.grand_total, p.currency)}</td>
                <td>${of_doc_status(p.status)}</td>
                <td>
                    <a class="of-btn" href="/app/purchase-order/${encodeURIComponent(p.name)}" target="_blank">
                        <i class="fa fa-external-link"></i> Open PO
                    </a>
                </td>
            </tr>`).join('');

        const rc_rows = rcs.map(r => `
            <tr>
                <td><a href="/app/${of_route(r.doctype)}/${encodeURIComponent(r.name)}" target="_blank" style="font-weight:700;">${of_esc(r.name)}</a>
                    <div class="of-micro">${of_esc(r.doctype)}</div></td>
                <td style="text-align:left;">
                    <a href="/app/supplier/${encodeURIComponent(r.supplier)}" target="_blank" style="font-weight:600;">${of_esc(r.supplier_name || r.supplier || '')}</a>
                </td>
                <td>${of_so_links(r.sales_orders)}</td>
                <td>${of_po_links(r.purchase_orders)}</td>
                <td class="of-meta">${of_date(r.posting_date)}</td>
                <td>${of_qty(r.qty, 'pos')}</td>
                <td>${of_money(r.grand_total, r.currency)}</td>
                <td>${of_doc_status(r.status)}</td>
            </tr>`).join('');

        const build_ewo = (list) => list.map(e => {
            const stage = e.work_type === 'Full Piece Job Work' ? e.full_piece_stage : e.panel_stage;
            const pending = flt_of(e.ordered_qty) - flt_of(e.received_qty);
            const jobber_id = e.panel_jobber || e.full_piece_jobber;
            return `<tr>
                <td><a href="/app/embroidery-work-order/${encodeURIComponent(e.name)}" target="_blank" style="font-weight:700;">${of_esc(e.name)}</a>
                    <div class="of-micro">${of_esc(e.work_type || '')}</div></td>
                <td style="text-align:left;">
                    ${jobber_id ? `
                        <a href="/app/supplier/${encodeURIComponent(jobber_id)}" target="_blank" style="font-weight:600;">${of_esc(e.jobber_name || jobber_id)}</a>
                    ` : of_esc(e.jobber_name || '')}
                </td>
                <td>${of_po_links(e.purchase_order)}
                    ${e.subcontracting_order ? `<div class="of-micro"><span class="of-chip">Subcontract</span></div>` : ''}</td>
                <td>${of_so_links(e.sales_orders)}</td>
                <td class="of-meta">${of_date(e.date)}</td>
                <td>${of_qty(e.ordered_qty)}</td>
                <td>${of_qty(e.received_qty, flt_of(e.received_qty) > 0 ? 'pos' : null)}</td>
                <td>${of_qty(pending, pending > 0 ? 'warn' : null)}</td>
                <td><span class="of-pill of-pill--planned">${of_esc(stage || e.status || '')}</span></td>
                <td>
                    <a class="of-btn" href="/app/embroidery-work-order/${encodeURIComponent(e.name)}" target="_blank">
                        <i class="fa fa-external-link"></i> Track
                    </a>
                </td>
            </tr>`;
        }).join('');
        const ewo_fp_rows = build_ewo(ewo_fp);
        const ewo_pn_rows = build_ewo(ewo_pn);

        const subtab = this.job_subtab || 'po';

        return `
            <!-- Top Summary Cards -->
            <div class="of-summary" id="of-summary-jobwork"></div>

            <!-- Job Work Sub-Tab Navigation Bar -->
            <div class="of-subtabs">
                <button class="of-subtab ${subtab === 'po' ? 'is-active' : ''}" data-subtab="po">
                    <i class="fa fa-shopping-cart" style="color:var(--of-blue);"></i> 1. Subcontracting POs
                </button>
                <button class="of-subtab ${subtab === 'receipt' ? 'is-active' : ''}" data-subtab="receipt">
                    <i class="fa fa-inbox" style="color:var(--of-green);"></i> 2. Subcontract Receipts
                </button>
                <button class="of-subtab ${subtab === 'fp' ? 'is-active' : ''}" data-subtab="fp">
                    <i class="fa fa-magic" style="color:var(--of-orange);"></i> 3. Embroidery - Full Piece
                </button>
                <button class="of-subtab ${subtab === 'pn' ? 'is-active' : ''}" data-subtab="pn">
                    <i class="fa fa-scissors" style="color:var(--of-red);"></i> 4. Embroidery - Panel
                </button>
            </div>

            <!-- Job Work-specific live activity stream -->
            ${this.activity_stream_html('jobwork')}

            <!-- Subtab Sections -->
            <div id="of-job-sec-po" class="${subtab !== 'po' ? 'of-hidden' : ''}">
                ${of_card('Subcontracting Purchase Orders', 'shopping-cart', `
                    <table class="of-table">
                        <thead><tr><th style="min-width:170px;">Purchase Order</th><th style="min-width:150px;">Supplier</th>
                            <th>Sales Order</th><th>Dates</th><th>Ordered</th><th>Received</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead>
                        <tbody>${po_rows || of_empty_row(9)}</tbody>
                    </table>`)}
            </div>

            <div id="of-job-sec-receipt" class="${subtab !== 'receipt' ? 'of-hidden' : ''}">
                ${of_card('Subcontract Receipts', 'inbox', `
                    <table class="of-table">
                        <thead><tr><th style="min-width:170px;">Receipt</th><th style="min-width:150px;">Supplier</th>
                            <th>Sales Order</th><th>Against PO</th><th>Date</th><th>Received</th><th>Amount</th><th>Status</th></tr></thead>
                        <tbody>${rc_rows || of_empty_row(8)}</tbody>
                    </table>`)}
            </div>
            
            <div id="of-job-sec-fp" class="${subtab !== 'fp' ? 'of-hidden' : ''}">
                ${of_card('Embroidery Work Orders (Full Piece Work)', 'magic', `
                    <table class="of-table">
                        <thead><tr><th style="min-width:160px;">Work Order</th><th style="min-width:140px;">Jobber</th>
                            <th>Purchase Order</th><th>Sales Order</th><th>Date</th>
                            <th>Sent</th><th>Received</th><th>Pending</th><th>Stage</th><th>Action</th></tr></thead>
                        <tbody>${ewo_fp_rows || of_empty_row(10)}</tbody>
                    </table>`)}
            </div>
            
            <div id="of-job-sec-pn" class="${subtab !== 'pn' ? 'of-hidden' : ''}">
                ${of_card('Embroidery Work Orders (Panel Work)', 'scissors', `
                    <table class="of-table">
                        <thead><tr><th style="min-width:160px;">Work Order</th><th style="min-width:140px;">Jobber</th>
                            <th>Purchase Order</th><th>Sales Order</th><th>Date</th>
                            <th>Sent</th><th>Received</th><th>Pending</th><th>Stage</th><th>Action</th></tr></thead>
                        <tbody>${ewo_pn_rows || of_empty_row(10)}</tbody>
                    </table>`)}
            </div>`;
    }

    // ── Tab 4: Accounts (Receivables, Supplier Payables & Jobber Payables) ──
    accounts_html(data) {
        data = data || {};
        const sis = data.sales_invoices || [];
        const sups = data.supplier_invoices || [];
        const jobs = data.jobber_invoices || [];
        const m = data.metrics || {};

        this.$body.find('#of-count').text(
            __('{0} Customer Invoices · {1} Supplier Invoices · {2} Jobber Invoices', [sis.length, sups.length, jobs.length])
        );

        // Render Sales Invoices Rows
        const si_rows = sis.map(s => {
            const out = flt_of(s.outstanding_amount);
            const status_pill = out <= 0
                ? '<span class="of-pill of-pill--ready">Paid</span>'
                : '<span class="of-pill of-pill--need-bill">Unpaid / Due</span>';

            return `<tr>
                <td><a href="/app/sales-invoice/${encodeURIComponent(s.name)}" target="_blank" style="font-weight:700;">${of_esc(s.name)}</a></td>
                <td style="text-align:left;">
                    <a href="/app/customer/${encodeURIComponent(s.customer)}" target="_blank" style="font-weight:600;">${of_esc(s.customer_name || s.customer || '')}</a>
                    <div class="of-micro text-muted">${of_esc(s.customer || '')}</div>
                </td>
                <td>${of_so_links(s.sales_orders)}</td>
                <td class="of-meta">${of_date(s.posting_date)}
                    <div class="of-micro">Due ${of_date(s.due_date)}</div></td>
                <td style="font-weight:700;">${of_money(s.grand_total, s.currency)}</td>
                <td style="color:var(--of-green);">${of_money(s.paid_amount, s.currency)}</td>
                <td style="color:${out > 0 ? 'var(--of-red)' : 'var(--text-muted)'};font-weight:700;">${of_money(out, s.currency)}</td>
                <td>${status_pill}</td>
                <td>
                    <a class="of-btn" href="/app/sales-invoice/${encodeURIComponent(s.name)}" target="_blank">
                        <i class="fa fa-external-link"></i> Open
                    </a>
                </td>
            </tr>`;
        }).join('');

        // Render Supplier Invoices Rows
        const sup_rows = sups.map(p => {
            const out = flt_of(p.outstanding_amount);
            const status_pill = out <= 0
                ? '<span class="of-pill of-pill--ready">Paid</span>'
                : '<span class="of-pill of-pill--blocked">Unpaid / Payable</span>';

            return `<tr>
                <td><a href="/app/purchase-invoice/${encodeURIComponent(p.name)}" target="_blank" style="font-weight:700;">${of_esc(p.name)}</a></td>
                <td style="text-align:left;">
                    <a href="/app/supplier/${encodeURIComponent(p.supplier)}" target="_blank" style="font-weight:600;">${of_esc(p.supplier_name || p.supplier || '')}</a>
                    <div class="of-micro text-muted">${of_esc(p.supplier || '')}</div>
                </td>
                <td>${of_so_links(p.sales_orders)}</td>
                <td class="of-meta">${of_date(p.posting_date)}
                    <div class="of-micro">Due ${of_date(p.due_date)}</div></td>
                <td style="font-weight:700;">${of_money(p.grand_total, p.currency)}</td>
                <td style="color:var(--of-info);">${of_money(p.paid_amount, p.currency)}</td>
                <td style="color:${out > 0 ? 'var(--of-red)' : 'var(--text-muted)'};font-weight:700;">${of_money(out, p.currency)}</td>
                <td>${status_pill}</td>
                <td>
                    <a class="of-btn" href="/app/purchase-invoice/${encodeURIComponent(p.name)}" target="_blank">
                        <i class="fa fa-external-link"></i> Open
                    </a>
                </td>
            </tr>`;
        }).join('');

        // Render Jobber Invoices Rows
        const job_rows = jobs.map(p => {
            const out = flt_of(p.outstanding_amount);
            const status_pill = out <= 0
                ? '<span class="of-pill of-pill--ready">Paid</span>'
                : '<span class="of-pill of-pill--planned">Unpaid Jobber</span>';

            return `<tr>
                <td><a href="/app/purchase-invoice/${encodeURIComponent(p.name)}" target="_blank" style="font-weight:700;">${of_esc(p.name)}</a></td>
                <td style="text-align:left;">
                    <a href="/app/supplier/${encodeURIComponent(p.supplier)}" target="_blank" style="font-weight:600;">${of_esc(p.supplier_name || p.supplier || '')}</a>
                    <div class="of-micro text-muted">${of_esc(p.supplier || '')} <span class="of-chip">Jobber</span></div>
                </td>
                <td>${of_so_links(p.sales_orders)}</td>
                <td class="of-meta">${of_date(p.posting_date)}
                    <div class="of-micro">Due ${of_date(p.due_date)}</div></td>
                <td style="font-weight:700;">${of_money(p.grand_total, p.currency)}</td>
                <td style="color:var(--of-purple);">${of_money(p.paid_amount, p.currency)}</td>
                <td style="color:${out > 0 ? 'var(--of-red)' : 'var(--text-muted)'};font-weight:700;">${of_money(out, p.currency)}</td>
                <td>${status_pill}</td>
                <td>
                    <a class="of-btn" href="/app/purchase-invoice/${encodeURIComponent(p.name)}" target="_blank">
                        <i class="fa fa-external-link"></i> Open
                    </a>
                </td>
            </tr>`;
        }).join('');

        const subtab = this.acc_subtab || 'receivables';

        return `
            <!-- Top Summary Cards -->
            <div class="of-summary" id="of-summary-accounts"></div>

            <!-- Accounts Sub-Tab Navigation Bar -->
            <div class="of-acc-subtabs">
                <button class="of-acc-subtab ${subtab === 'receivables' ? 'is-active' : ''}" data-subtab="receivables">
                    <i class="fa fa-arrow-circle-down" style="color:var(--of-green);"></i> 1. Customer Receivables
                </button>
                <button class="of-acc-subtab ${subtab === 'supplier' ? 'is-active' : ''}" data-subtab="supplier">
                    <i class="fa fa-arrow-circle-up" style="color:var(--of-red);"></i> 2. Supplier Payables
                </button>
                <button class="of-acc-subtab ${subtab === 'jobber' ? 'is-active' : ''}" data-subtab="jobber">
                    <i class="fa fa-cogs" style="color:var(--of-purple);"></i> 3. Jobber Payables (Job Work)
                </button>
            </div>

            <!-- Accounts-specific live activity stream -->
            ${this.activity_stream_html('accounts')}

            <!-- Settlement progress.
                 The billed and outstanding figures already sit in the six tiles at the
                 top of the tab, so repeating them as cards here said the same thing
                 twice. This states the one number those tiles do not carry — how much
                 has actually been settled — and shows it as a share of the total. -->
            ${of_settlement_bar({
                hidden: subtab !== 'receivables', id: 'of-acc-kpi-receivables', tone: 'receivable',
                title: __('Customer collection'), icon: 'arrow-circle-down',
                settled_label: __('Received'), settled: m.sales_received,
                open_label: __('still to collect'), open: m.sales_outstanding,
                total: m.sales_total, docs: sis.length, doc_label: __('customer invoice')
            })}
            ${of_settlement_bar({
                hidden: subtab !== 'supplier', id: 'of-acc-kpi-supplier', tone: 'payable',
                title: __('Supplier settlement'), icon: 'arrow-circle-up',
                settled_label: __('Paid'), settled: m.supplier_paid,
                open_label: __('still to pay'), open: m.supplier_outstanding,
                total: m.supplier_total, docs: sups.length, doc_label: __('supplier invoice')
            })}
            ${of_settlement_bar({
                hidden: subtab !== 'jobber', id: 'of-acc-kpi-jobber', tone: 'jobber',
                title: __('Jobber settlement'), icon: 'cogs',
                settled_label: __('Paid'), settled: m.jobber_paid,
                open_label: __('still to pay'), open: m.jobber_outstanding,
                total: m.jobber_total, docs: jobs.length, doc_label: __('jobber invoice')
            })}

            <!-- Tables -->
            <div id="of-acc-sec-receivables" class="${subtab !== 'receivables' ? 'of-hidden' : ''}">
                ${of_card('Sales Invoices — Customer Receivables', 'money', `
                    <table class="of-table">
                        <thead><tr><th style="min-width:160px;">Sales Invoice</th><th style="min-width:160px;">Customer</th>
                            <th>Sales Order</th><th>Dates</th><th>Total Amount</th><th>Received</th>
                            <th>Outstanding (Receivable)</th><th>Status</th><th>Action</th></tr></thead>
                        <tbody>${si_rows || of_empty_row(9)}</tbody>
                    </table>`)}
            </div>

            <div id="of-acc-sec-supplier" class="${subtab !== 'supplier' ? 'of-hidden' : ''}">
                ${of_card('Purchase Invoices — Supplier Payables', 'credit-card', `
                    <table class="of-table">
                        <thead><tr><th style="min-width:160px;">Purchase Invoice</th><th style="min-width:160px;">Supplier</th>
                            <th>Sales Order</th><th>Dates</th><th>Total Amount</th><th>Paid</th>
                            <th>Outstanding (Payable)</th><th>Status</th><th>Action</th></tr></thead>
                        <tbody>${sup_rows || of_empty_row(9)}</tbody>
                    </table>`)}
            </div>

            <div id="of-acc-sec-jobber" class="${subtab !== 'jobber' ? 'of-hidden' : ''}">
                ${of_card('Purchase Invoices — Jobber Payables (Job Work)', 'magic', `
                    <table class="of-table">
                        <thead><tr><th style="min-width:160px;">Purchase Invoice</th><th style="min-width:160px;">Jobber Supplier</th>
                            <th>Sales Order</th><th>Dates</th><th>Total Amount</th><th>Paid</th>
                            <th>Outstanding (Payable)</th><th>Status</th><th>Action</th></tr></thead>
                        <tbody>${job_rows || of_empty_row(9)}</tbody>
                    </table>`)}
            </div>`;
    }

    approval_html(orders) {
        orders = orders || [];

        const current_user = frappe.session.user;
        const my_approvals = [];
        const unassigned_approvals = [];
        const final_approvals = [];

        const is_merchandiser = frappe.user_roles.includes("Merchandiser User") && !frappe.user_roles.includes("System Manager") && current_user !== "Administrator";
        const can_final = !!(this.perms && this.perms.is_final_approver);

        // An order sits in exactly one bucket, by the step it is actually waiting on.
        //   Pending My Approval — waiting on ME as the customer's merchandiser
        //   Unassigned          — no merchandiser on the customer yet
        //   Pending Final       — merchandiser is done; waiting on a final approver
        // An order already at "Pending Final Approval" is NOT waiting on the
        // merchandiser, so it must not appear under "Pending My Approval".
        orders.forEach(o => {
            if (o.workflow_state === 'Pending Final Approval') {
                final_approvals.push(o);
            }
            
            if (!o.custom_merchandiser_user) {
                if (o.workflow_state !== 'Pending Final Approval') {
                    unassigned_approvals.push(o);
                }
            } else if (can_final || o.custom_merchandiser_user === current_user) {
                my_approvals.push(o);
            }
        });

        // Only the users named in Admin Settings (plus admins) may work the
        // final-approval queue. Permissions come from the server; until they
        // arrive the tab stays hidden rather than flashing into view.
        let sub = this.approval_subtab || 'merchandiser';
        if (sub === 'final' && !can_final) {
            sub = 'merchandiser';
            this.approval_subtab = 'merchandiser';
        }

        let active_orders = [];
        if (sub === 'merchandiser') {
            active_orders = my_approvals;
        } else if (sub === 'unassigned') {
            active_orders = unassigned_approvals;
        } else {
            active_orders = can_final ? final_approvals : [];
        }

        this.$body.find('#of-count').text(
            active_orders.length ? __('{0} pending order(s) shown', [active_orders.length]) : ''
        );

        const rows = active_orders.map(o => {
            let pill_class = 'of-pill--wait';
            if (o.workflow_state === 'Pending Final Approval') {
                pill_class = 'of-pill--planned'; // Purple badge
            } else if (o.workflow_state === 'Rejected') {
                pill_class = 'of-pill--blocked'; // Red badge
            } else if (o.workflow_state === 'Draft') {
                pill_class = 'of-pill--draft'; // Orange / Gray badge
            }

            const is_admin = frappe.user_roles.includes("System Manager") || current_user === "Administrator";
            const is_owner = current_user === o.owner;
            const is_assigned_merchandiser = current_user === o.custom_merchandiser_user;
            const show_rejection_reason = is_admin || is_owner || is_assigned_merchandiser;

            return `
            <tr data-so="${o.name}">
                ${sub === 'final' ? `
                <td style="text-align: center;">
                    <input type="checkbox" class="of-approval-select" data-so="${o.name}">
                </td>
                ` : ''}
                <td>
                    <a href="/app/sales-order/${encodeURIComponent(o.name)}" target="_blank" style="font-weight:700;">${of_esc(o.name)}</a>
                    <div class="of-meta" style="font-weight:500;">
                        <a href="/app/customer/${encodeURIComponent(o.customer)}" target="_blank" style="color:inherit;">${of_esc(o.customer_name || o.customer || '')}</a>
                    </div>
                    ${o.custom_merchandiser_user ? `
                    <div class="of-micro text-muted" style="margin-top: 3px; font-weight: 500;">
                        <i class="fa fa-user" style="color:#007bff;"></i> Merchandiser: <b>${of_esc(o.custom_merchandiser_name || o.custom_merchandiser_user)}</b>
                    </div>
                    ` : ''}
                    ${o.items_list ? `
                    <div style="margin-top: 6px; display: inline-flex; align-items: center; background-color: #f4f6f8; border: 1px solid #d1d8dd; border-radius: 4px; padding: 2px 8px; font-size: 11px; color: #555; max-width: 100%; box-sizing: border-box;">
                        <i class="fa fa-cube" style="margin-right: 5px; color: #888;"></i>
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 280px;" title="${of_esc(o.items_list)}">${of_esc(o.items_list)}</span>
                    </div>
                    ` : ''}
                </td>
                <td class="of-meta">
                    ${of_date(o.transaction_date)}
                    <div class="of-micro">Due ${of_date(o.delivery_date)}</div>
                </td>
                <td>
                    <span class="of-pill ${pill_class}">
                        ${of_esc(o.workflow_state || 'Draft')}
                    </span>
                    ${o.workflow_state === 'Rejected' && o.rejection_comment && show_rejection_reason ? `
                    <div style="font-size: 11px; color: #dc3545; margin-top: 5px; font-weight: 500; line-height: 1.3;">
                        <i class="fa fa-info-circle"></i> Reason: ${of_esc(o.rejection_comment.replace(/<[^>]*>/g, ''))}
                    </div>
                    ` : ''}
                </td>
                <td>
                    <span class="of-val" style="font-weight: 700;">${of_money(o.grand_total, o.currency)}</span>
                </td>
                <td style="text-align: center;">
                    ${o.workflow_state === 'Pending Final Approval' && sub === 'merchandiser' ? `
                    <span class="text-muted" style="font-size:12px; font-weight:500;">
                        <i class="fa fa-clock-o"></i> ${__('Waiting for Final Approval')}
                    </span>
                    ` : `
                    <div style="display: inline-flex; gap: 8px;">
                        <button class="of-btn of-btn--success of-approve-btn" data-so="${o.name}" data-state="${o.workflow_state}">
                            <i class="fa fa-check"></i> ${__('Approve')}
                        </button>
                        <button class="of-btn of-btn--danger of-reject-btn" data-so="${o.name}">
                            <i class="fa fa-times"></i> ${__('Reject')}
                        </button>
                    </div>
                    `}
                </td>
            </tr>`;
        }).join('');

        return `
            <!-- Sub-Tab Navigation Bar -->
            <div class="of-subtabs">
                <button class="of-subtab ${sub === 'merchandiser' ? 'is-active' : ''}" data-subtab="merchandiser">
                    <i class="fa fa-user" style="color:var(--of-blue);"></i> ${can_final ? '1. Merchandiser Queue (Track)' : '1. Pending My Approval'} (${my_approvals.length})
                </button>
                <button class="of-subtab ${sub === 'unassigned' ? 'is-active' : ''}" data-subtab="unassigned">
                    <i class="fa fa-users" style="color:var(--of-yellow);"></i> 2. Unassigned Orders (${unassigned_approvals.length})
                </button>
                ${can_final ? `
                <button class="of-subtab ${sub === 'final' ? 'is-active' : ''}" data-subtab="final">
                    <i class="fa fa-check-circle" style="color:var(--of-green);"></i> 3. Pending Final Approval (${final_approvals.length})
                </button>` : ''}
            </div>

            <!-- Approval-specific live activity stream -->
            ${this.activity_stream_html('approval')}

            <!-- Table Card -->
            <div class="of-card">
                <div class="of-card__head" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px;">
                    <div>
                        <i class="fa fa-check-square-o"></i> ${
                            sub === 'merchandiser' ? (can_final ? __('Merchandiser Queue (Track)') : __('Pending My Approval')) :
                            sub === 'unassigned' ? __('Unassigned Orders (Approve & Claim)') :
                            __('Pending Final Approval')
                        }
                    </div>
                    <div style="display: flex; gap: 10px;">
                        ${sub === 'final' ? `
                        <button class="of-btn of-btn--success" id="of-bulk-approve-btn">
                            <i class="fa fa-check-circle"></i> Bulk Approve
                        </button>
                        <button class="of-btn of-btn--danger" id="of-bulk-reject-btn">
                            <i class="fa fa-times-circle"></i> Bulk Reject
                        </button>
                        ` : ''}
                    </div>
                </div>
                <div class="of-scroll">
                    <table class="of-table">
                        <thead><tr>
                            ${sub === 'final' ? `
                            <th style="width: 40px; text-align: center;">
                                <input type="checkbox" id="of-approval-select-all">
                            </th>
                            ` : ''}
                            <th style="min-width:180px;">Sales Order &amp; Customer</th>
                            <th style="width:110px;">Dates</th>
                            <th style="width:180px;">Approval Stage</th>
                            <th style="width:120px;">Amount</th>
                            <th style="width:160px; text-align: center;">Actions</th>
                        </tr></thead>
                        <tbody>
                            ${rows || `<tr><td colspan="${sub === 'final' ? '6' : '5'}" class="of-empty">
                                 <i class="fa fa-inbox"></i> ${__('No orders pending approval in this stage.')}
                            </td></tr>`}
                        </tbody>
                    </table>
                </div>
            </div>`;
    }

    handle_merchandiser_approval(so) {
        this.handle_approval_with_checks(so, __('Are you sure you want to approve Sales Order {0}?', [so]));
    }

    handle_final_approval(so) {
        this.handle_approval_with_checks(so, __('Are you sure you want to final approve Sales Order {0}?', [so]));
    }

    handle_approval_with_checks(so, confirm_msg) {
        frappe.call({
            method: 'erp_dacsinc_custom.order_flow_api.verify_customer_details',
            args: { sales_order: so }
        }).then(r => {
            const res = r.message;
            if (!res) return;
            this.show_verification_dialog(so, res);
        });
    }

    show_verification_dialog(so, res) {
        const address_details = res.address_details || {};
        const contact_details = res.contact_details || {};
        
        const fields = [
            {
                fieldtype: 'HTML',
                fieldname: 'notice',
                options: `
                    <div class="alert alert-warning" style="margin-bottom: 15px;">
                        <i class="fa fa-warning"></i> ${__('Customer {0} details. Fill or correct them below to save to master, or enter a comment to bypass.', [`<b>${res.customer}</b>`])}
                    </div>
                `
            },
            {
                fieldtype: 'Section Break',
                label: __('Customer Profile')
            },
            {
                fieldtype: 'Data',
                fieldname: 'gstin',
                label: __('GSTIN / UIN'),
                default: res.gstin || ''
            },
            {
                fieldtype: 'Column Break'
            },
            {
                fieldtype: 'Link',
                options: 'Tax Category',
                fieldname: 'tax_category',
                label: __('Tax Category'),
                default: res.tax_category || ''
            },
            {
                fieldtype: 'Section Break',
                label: __('Primary Address Details')
            },
            {
                fieldtype: 'Data',
                fieldname: 'address_line1',
                label: __('Address Line 1'),
                default: address_details.address_line1 || ''
            },
            {
                fieldtype: 'Data',
                fieldname: 'address_line2',
                label: __('Address Line 2'),
                default: address_details.address_line2 || ''
            },
            {
                fieldtype: 'Data',
                fieldname: 'city',
                label: __('City'),
                default: address_details.city || ''
            },
            {
                fieldtype: 'Column Break'
            },
            {
                fieldtype: 'Data',
                fieldname: 'state',
                label: __('State'),
                default: address_details.state || ''
            },
            {
                fieldtype: 'Link',
                options: 'Country',
                fieldname: 'country',
                label: __('Country'),
                default: address_details.country || 'India'
            },
            {
                fieldtype: 'Data',
                fieldname: 'pincode',
                label: __('Pincode'),
                default: address_details.pincode || ''
            },
            {
                fieldtype: 'Section Break',
                label: __('Primary Contact Details')
            },
            {
                fieldtype: 'Data',
                fieldname: 'contact_first_name',
                label: __('First Name'),
                default: contact_details.first_name || ''
            },
            {
                fieldtype: 'Column Break'
            },
            {
                fieldtype: 'Data',
                fieldname: 'contact_mobile_no',
                label: __('Mobile Number'),
                default: contact_details.mobile_no || ''
            },
            {
                fieldtype: 'Data',
                fieldname: 'contact_email',
                label: __('Email ID'),
                default: contact_details.email || ''
            },
            {
                fieldtype: 'Section Break',
                label: __('Bypass Option')
            },
            {
                fieldtype: 'Small Text',
                fieldname: 'bypass_comment',
                label: __('Or Approve with Comment (Will notify in dashboard)'),
                placeholder: __('Enter comment if you wish to bypass validations...')
            }
        ];

        if (res.workflow_state === "Pending Final Approval") {
            fields.push({
                fieldtype: 'Section Break',
                label: __('Approval Settings')
            });
            fields.push({
                fieldtype: 'Check',
                fieldname: 'skip_delivery_note',
                label: __('Skip Delivery Note (Direct Billing)'),
                default: res.skip_delivery_note || 0
            });
        }

        const dialog = new frappe.ui.Dialog({
            title: __('Verify Customer Details - {0}', [so]),
            fields: fields,
            primary_action_label: __('Save Details & Approve'),
            primary_action: (values) => {
                const btn_primary = dialog.get_primary_btn();
                const btn_secondary = dialog.get_secondary_btn();
                if (btn_primary) btn_primary.attr("disabled", true).addClass("disabled");
                if (btn_secondary) btn_secondary.attr("disabled", true).addClass("disabled");

                const enable_buttons = () => {
                    if (btn_primary) btn_primary.attr("disabled", false).removeClass("disabled");
                    if (btn_secondary) btn_secondary.attr("disabled", false).removeClass("disabled");
                };

                if (values.bypass_comment && values.bypass_comment.trim()) {
                    frappe.call({
                        method: 'erp_dacsinc_custom.order_flow_api.approve_sales_order_with_comment',
                        args: {
                            sales_order: so,
                            comment: values.bypass_comment,
                            skip_delivery_note: values.skip_delivery_note
                        },
                        error: enable_buttons
                    }).then(() => {
                        dialog.hide();
                        frappe.show_alert({message: __('Sales Order approved with comment successfully'), color: 'green'});
                        this.refresh(true);
                    });
                    return;
                }
                
                let address_data = null;
                if (values.address_line1) {
                    address_data = JSON.stringify({
                        address_line1: values.address_line1,
                        address_line2: values.address_line2,
                        city: values.city,
                        state: values.state,
                        country: values.country,
                        pincode: values.pincode
                    });
                }
                
                let contact_data = null;
                if (values.contact_first_name) {
                    contact_data = JSON.stringify({
                        first_name: values.contact_first_name,
                        mobile_no: values.contact_mobile_no,
                        email: values.contact_email
                    });
                }
                
                frappe.call({
                    method: 'erp_dacsinc_custom.order_flow_api.save_and_approve_sales_order',
                    args: {
                        sales_order: so,
                        gstin: values.gstin || null,
                        tax_category: values.tax_category || null,
                        address_data: address_data,
                        contact_data: contact_data,
                        skip_delivery_note: values.skip_delivery_note
                    },
                    error: enable_buttons
                }).then(() => {
                    dialog.hide();
                    frappe.show_alert({message: __('Customer details updated and Sales Order approved'), color: 'green'});
                    this.refresh(true);
                });
            },
            secondary_action_label: __('Bypass & Approve'),
            secondary_action: () => {
                const values = dialog.get_values();
                if (!values || !values.bypass_comment || !values.bypass_comment.trim()) {
                    frappe.msgprint(__('Please enter a bypass comment in the field below first.'));
                    return;
                }
                const btn_primary = dialog.get_primary_btn();
                const btn_secondary = dialog.get_secondary_btn();
                if (btn_primary) btn_primary.attr("disabled", true).addClass("disabled");
                if (btn_secondary) btn_secondary.attr("disabled", true).addClass("disabled");

                const enable_buttons = () => {
                    if (btn_primary) btn_primary.attr("disabled", false).removeClass("disabled");
                    if (btn_secondary) btn_secondary.attr("disabled", false).removeClass("disabled");
                };

                frappe.call({
                    method: 'erp_dacsinc_custom.order_flow_api.approve_sales_order_with_comment',
                    args: {
                        sales_order: so,
                        comment: values.bypass_comment,
                        skip_delivery_note: values.skip_delivery_note
                    },
                    error: enable_buttons
                }).then(() => {
                    dialog.hide();
                    frappe.show_alert({message: __('Sales Order approved with comment successfully'), color: 'green'});
                    this.refresh(true);
                });
            }
        });

        dialog.show();
    }

    uniform_html(transfers) {
        transfers = transfers || [];
        
        const rows_html = transfers.map(t => {
            const status_badge = t.status === 'Sent' ? 
                '<span class="of-pill" style="background:#fff3cd; color:#856404; border:1px solid #ffeeba;">Sent (Pending Receipt)</span>' :
                '<span class="of-pill" style="background:#d4edda; color:#155724; border:1px solid #c3e6cb;">Completed</span>';
                
            const action_html = t.status === 'Sent' ? `
                <button class="of-btn of-btn--success of-receive-btn" data-id="${t.name}">
                    <i class="fa fa-arrow-down"></i> Receive
                </button>
            ` : `<span class="text-muted" style="font-size: 11px;"><i class="fa fa-check"></i> Completed</span>`;

            return `
                <tr>
                    <td><a href="/app/uniform-embroidery-transfer/${encodeURIComponent(t.name)}" target="_blank"><b>${of_esc(t.name)}</b></a></td>
                    <td><a href="/app/item/${encodeURIComponent(t.source_item)}" target="_blank">${of_esc(t.source_item)}</a></td>
                    <td><a href="/app/item/${encodeURIComponent(t.target_item)}" target="_blank">${of_esc(t.target_item)}</a></td>
                    <td><b>${t.qty}</b></td>
                    <td><div style="font-size:11px; color:#555;">${of_esc(t.from_warehouse)} <i class="fa fa-long-arrow-right"></i> ${of_esc(t.wip_warehouse)}</div></td>
                    <td>${of_date(t.date_sent)}</td>
                    <td>${t.date_received ? of_date(t.date_received) : '-'}</td>
                    <td>${status_badge}</td>
                    <td style="text-align: center;">${action_html}</td>
                </tr>
            `;
        }).join('');

        return `
            <div class="of-card">
                <div class="of-card__head" style="padding:12px 16px; border-bottom:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-size:14px; font-weight:600;"><i class="fa fa-random"></i> Embroidery Stock Transfers</div>
                    <button class="of-btn of-btn--primary" id="of-create-transfer-btn">
                        <i class="fa fa-plus"></i> Create Transfer
                    </button>
                </div>
                <div class="of-scroll">
                    <table class="of-table">
                        <thead>
                            <tr>
                                <th>Transfer ID</th>
                                <th>Source Item (Plain)</th>
                                <th>Target Item (Embroidered)</th>
                                <th>Qty</th>
                                <th>Route</th>
                                <th>Date Sent</th>
                                <th>Date Received</th>
                                <th>Status</th>
                                <th style="text-align:center;">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows_html || `<tr><td colspan="9" class="of-empty"><i class="fa fa-inbox"></i>No transfers found.</td></tr>`}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    prompt_create_transfer() {
        const dialog = new frappe.ui.Dialog({
            title: __('Create Embroidery Transfer'),
            fields: [
                {
                    fieldtype: 'Link',
                    fieldname: 'source_item',
                    options: 'Item',
                    label: __('Source Item (Plain)'),
                    reqd: 1,
                    onchange: function() {
                        const source = this.get_value();
                        const warehouse = dialog.get_value('from_warehouse');
                        if (source && warehouse) {
                            fetch_stock_details(source, warehouse);
                        } else {
                            dialog.fields_dict.stock_details_html.$wrapper.html('');
                        }
                    }
                },
                {
                    fieldtype: 'Link',
                    fieldname: 'from_warehouse',
                    options: 'Warehouse',
                    label: __('From Warehouse'),
                    reqd: 1,
                    onchange: function() {
                        const warehouse = this.get_value();
                        const source = dialog.get_value('source_item');
                        if (source && warehouse) {
                            fetch_stock_details(source, warehouse);
                        } else {
                            dialog.fields_dict.stock_details_html.$wrapper.html('');
                        }
                    }
                },
                {
                    fieldtype: 'HTML',
                    fieldname: 'stock_details_html'
                },
                {
                    fieldtype: 'Link',
                    fieldname: 'target_item',
                    options: 'Item',
                    label: __('Target Item (Embroidered)'),
                    reqd: 1
                },
                {
                    fieldtype: 'Link',
                    fieldname: 'wip_warehouse',
                    options: 'Warehouse',
                    label: __('WIP Warehouse (Embroiderer)'),
                    reqd: 1
                },
                {
                    fieldtype: 'Float',
                    fieldname: 'qty',
                    label: __('Quantity'),
                    reqd: 1
                }
            ],
            primary_action_label: __('Send to Embroidery'),
            primary_action: (values) => {
                dialog.get_primary_btn().attr('disabled', true);
                frappe.call({
                    method: 'erp_dacsinc_custom.uniform_transfer_api.create_embroidery_transfer',
                    args: {
                        source_item: values.source_item,
                        target_item: values.target_item,
                        qty: values.qty,
                        from_warehouse: values.from_warehouse,
                        wip_warehouse: values.wip_warehouse
                    }
                }).then(r => {
                    dialog.hide();
                    frappe.show_alert({message: __('Plain items transferred to embroidery WIP successfully'), color: 'green'});
                    this.refresh(true);
                }).always(() => {
                    dialog.get_primary_btn().attr('disabled', false);
                });
            }
        });

        const fetch_stock_details = (source, warehouse) => {
            frappe.call({
                method: 'erp_dacsinc_custom.uniform_transfer_api.get_item_stock_details',
                args: {
                    item_code: source,
                    warehouse: warehouse
                }
            }).then(r => {
                const d = r.message || {};
                const html = `
                    <div style="margin-top: 10px; padding: 12px; font-size: 12px; line-height: 1.6; border: 1px solid #d1ecf1; border-radius: 4px; background-color: #f8f9fa; color: #0c5460;">
                        <strong style="font-size: 13px;">Stock Details for ${frappe.utils.escape_html(source)}:</strong><br>
                        • Actual Physical Qty: <b>${d.actual_qty}</b><br>
                        • Reserved for Sales: <b>${d.reserved_qty}</b><br>
                        • Reserved for Production: <b>${d.reserved_qty_for_production}</b><br>
                        • Reserved for Subcontract: <b>${d.reserved_qty_for_sub_contract}</b><br>
                        <div style="border-top: 1px dashed #bee5eb; margin: 8px 0; padding-top: 8px;">
                            <span style="color: #28a745; font-weight: 700; font-size: 13px;">✔ Fully Available (Unreserved): ${d.net_available}</span>
                        </div>
                    </div>
                `;
                dialog.fields_dict.stock_details_html.$wrapper.html(html);
            });
        };

        dialog.show();
    }
}

const OF_ICON = {
    'Material Request':       { i: 'file-text-o', c: '#6f42c1' },
    'Purchase Order':         { i: 'shopping-cart', c: '#007bff' },
    'Purchase Receipt':       { i: 'inbox', c: '#28a745' },
    'Job Work (Subcontract)': { i: 'cogs', c: '#6f42c1' },
    'Subcontracting Receipt': { i: 'inbox', c: '#17a2b8' },
    'Embroidery Work Order':  { i: 'magic', c: '#e83e8c' },
    'Pick List':              { i: 'hand-paper-o', c: '#fd7e14' },
    'Delivery Note':          { i: 'truck', c: '#3498DB' },
    'Sales Invoice':          { i: 'file-text', c: '#17a2b8' },
    'Purchase Invoice':       { i: 'file-text-o', c: '#e83e8c' },
    'Comment':                { i: 'comment-o', c: '#17a2b8' },
    'Sales Order':            { i: 'check-square-o', c: '#28a745' }
};

function flt_of(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

function of_esc(v) {
    if (v === undefined || v === null) return '';
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function of_num(v) { return flt_of(v) || 0; }

function of_qty(v, tone) {
    const n = flt_of(v);
    const cls = n ? (tone ? `of-val of-val--${tone}` : 'of-val') : 'of-val of-val--zero';
    return `<div class="${cls}">${n}</div>`;
}

function of_route(doctype) {
    return String(doctype || '').toLowerCase().trim().replace(/\s+/g, '-');
}

function of_date(v) {
    if (!v) return '<span class="of-val--zero">—</span>';
    try {
        let date_str = String(v).split(' ')[0];
        if (typeof moment !== 'undefined') {
            let d = moment(date_str);
            if (d.isValid()) {
                return d.format("DD-MMM-YYYY (dddd)");
            }
        }
        return frappe.datetime.str_to_user(date_str) || '—';
    }
    catch (e) { return of_esc(v); }
}

function of_ago(ts) {
    if (!ts) return '';
    try { return frappe.datetime.comment_when(ts, true); }
    catch (e) { return of_date(ts); }
}

/**
 * Plain formatted money.
 *
 * frappe.format(..., {fieldtype:'Currency'}) wraps its result in
 * <div style="text-align: right"> — a BLOCK element. Dropped into a flex row it
 * forces every amount onto its own line, which is what broke the settlement
 * strip. format_currency returns a bare string, so it composes anywhere.
 */
function of_money(v, currency) {
    if (v === undefined || v === null) return '<span class="of-val--zero">—</span>';
    try {
        return format_currency(flt_of(v), currency || undefined);
    } catch (e) {
        return frappe.format(flt_of(v), { fieldtype: 'Currency' }, { inline: 1 });
    }
}

function of_pct_bar(pct) {
    const p = Math.max(0, Math.min(100, flt_of(pct)));
    const mod = p >= 100 ? '' : (p > 0 ? ' of-bar__fill--part' : ' of-bar__fill--none');
    return `<div class="of-micro">${p.toFixed(0)}%</div>
            <div class="of-bar"><div class="of-bar__fill${mod}" style="width:${p}%;"></div></div>`;
}

function of_doc_status(status) {
    if (!status) return '<span class="of-val--zero">—</span>';
    const s = String(status).toLowerCase();
    let kind = 'draft';
    if (/(completed|closed|paid|received|delivered)/.test(s)) kind = 'ready';
    else if (/(overdue|cancelled|return|stopped)/.test(s))    kind = 'blocked';
    else if (/(to deliver|to receive|to bill|partly|pending)/.test(s)) kind = 'wait';
    else if (/(submitted|open|in progress|ordered|transferred)/.test(s)) kind = 'dn';
    return `<span class="of-pill of-pill--${kind}">${of_esc(status)}</span>`;
}

function of_links(list, doctype) {
    if (!list) return '<span class="of-val--zero">—</span>';
    return String(list).split(',').map(s => s.trim()).filter(Boolean).map(n =>
        `<div><a href="/app/${of_route(doctype)}/${encodeURIComponent(n)}" target="_blank">${of_esc(n)}</a></div>`
    ).join('') || '<span class="of-val--zero">—</span>';
}
function of_so_links(list) { return of_links(list, 'Sales Order'); }
function of_po_links(list) { return of_links(list, 'Purchase Order'); }

function of_card(title, icon, inner) {
    return `<div class="of-card">
        <div class="of-card__head"><i class="fa fa-${icon}"></i> ${of_esc(title)}</div>
        <div class="of-scroll">${inner}</div>
    </div>`;
}

/**
 * One slim "how much of this ledger is settled" strip.
 *
 * Replaces three KPI cards per sub-tab, two of which restated tiles already shown
 * at the top of the Accounts tab. The settled amount and the percentage are the
 * only figures not available above, so they lead.
 */
function of_settlement_bar(o) {
    const total   = flt_of(o.total);
    const settled = flt_of(o.settled);
    const open    = flt_of(o.open);
    const pct     = total > 0 ? Math.max(0, Math.min(100, (settled / total) * 100)) : 0;
    const fill    = pct >= 100 ? '' : (pct > 0 ? ' of-bar__fill--part' : ' of-bar__fill--none');

    return `
    <div class="of-settle of-settle--${o.tone} ${o.hidden ? 'of-hidden' : ''}" id="${o.id}">
        <span class="of-settle__title"><i class="fa fa-${o.icon}"></i> ${of_esc(o.title)}</span>
        <span class="of-settle__stat">
            <b>${of_money(settled)}</b> ${of_esc(o.settled_label.toLowerCase())} of ${of_money(total)}
        </span>
        <span class="of-settle__bar">
            <span class="of-bar"><span class="of-bar__fill${fill}" style="width:${pct}%;"></span></span>
        </span>
        <span class="of-settle__pct">${pct.toFixed(0)}%</span>
        <span class="of-settle__open ${open > 0 ? 'is-open' : ''}">
            ${open > 0 ? `${of_money(open)} ${of_esc(o.open_label)}` : __('Fully settled')}
        </span>
        <span class="of-settle__docs">${o.docs} ${of_esc(o.doc_label)}${o.docs === 1 ? '' : 's'}</span>
    </div>`;
}



function of_empty_row(cols) {
    return `<tr><td colspan="${cols}" class="of-empty"><i class="fa fa-inbox"></i>Nothing here for these filters.</td></tr>`;
}
