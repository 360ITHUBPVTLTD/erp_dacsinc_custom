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
const OF_FOR_ME_KEY = 'dac_of_activity_for_me';
const OF_LAST_TAB_KEY = 'dac_of_last_tab';

// Per-tab notification filter config.
// doctypes: whitelist of doctypes shown in this tab's stream (null = all).
// tracker and approval tabs are handled with explicit docstatus rules in filter_tab_rows().
// Which notifications belong to which tab.
//
// The rule is one thing: a tab notifies about the records that tab puts on
// screen. The server has already held the whole feed to the Sales Orders the
// tables are filtered to (same days / scope / search — see get_activity), so
// all that is left here is to match each tab's doctypes to the documents it
// actually lists. `doctypes: null` means "every doctype".
const OF_TAB_FILTERS = {
    // Lists Sales Orders awaiting a decision, and the comments carrying them.
    approval: { doctypes: ['Sales Order', 'Comment'] },
    // Lists Sales Orders, with a Document Flow column covering every document
    // raised against them — so the whole journey belongs on this tab.
    tracker:  { doctypes: null },
    // Lists Material Requests, Purchase Orders, receipts and draft supplier bills.
    purchase: { doctypes: ['Material Request', 'Purchase Order', 'Purchase Receipt', 'Purchase Invoice'] },
    // Lists subcontract POs, embroidery work orders and their receipts.
    jobwork:  { doctypes: ['Purchase Order', 'Job Work (Subcontract)', 'Embroidery Work Order', 'Subcontracting Receipt'] },
    // Lists customer invoices, supplier bills and jobber bills.
    accounts: { doctypes: ['Sales Invoice', 'Purchase Invoice'] },
    // Lists embroidery stock transfers, which carry no Sales Order.
    uniform:  { doctypes: ['Uniform Embroidery Transfer'] }
};

// Legacy alias — keeps any remaining callers using the old name working.
const OF_TAB_DOCTYPES = Object.fromEntries(
    Object.entries(OF_TAB_FILTERS).map(([k, v]) => [k, v.doctypes])
);

// The tab strip itself — key, label and icon, in left-to-right render order.
// This is the one place that used to be duplicated across render_shell's
// button markup, the switch_tab panel loop, and OF_TAB_LABELS below; all
// three now derive from this array so they cannot drift apart. Which roles
// may see which tab is server-side config (Admin Settings > Order Flow) —
// this array only ever describes what a tab IS, never who may see it.
const OF_TABS = [
    { key: 'approval', label: 'SO Approvals',         icon: 'fa-check-square-o' },
    { key: 'tracker',  label: 'Sales Tracker',        icon: 'fa-list-ul' },
    { key: 'purchase', label: 'Purchase Flow',        icon: 'fa-shopping-cart' },
    { key: 'jobwork',  label: 'Job Work',             icon: 'fa-cogs' },
    { key: 'accounts', label: 'Accounts',             icon: 'fa-calculator' },
    { key: 'uniform',  label: 'Embroidery Transfers', icon: 'fa-random' }
];

// Tab display names, for messages that name the tab being acted on.
const OF_TAB_LABELS = Object.fromEntries(OF_TABS.map(t => [t.key, t.label]));

// "Seen" is recorded per tab and per user, so it always has to be asked about a
// specific tab: the same Purchase Order event can be cleared on Purchase while
// still waiting for attention on the Tracker.
function of_is_seen(ev, tab) {
    return !!(ev && ev.seen_tabs && ev.seen_tabs[tab]);
}

class OrderFlow {
    constructor(page) {
        this.page = page;
        this.$body = $(page.body);
        // Set once the server's allowed-tab list resolves (see boot chain
        // below). Left null rather than a real tab key — switch_tab bails
        // out early when `tab === this.active`, so seeding this with e.g.
        // 'tracker' would make the very first switch_tab('tracker') a no-op
        // for any user whose landing tab happens to be Tracker.
        this.active = null;
        this.allowed_tabs = [];
        this.pur_subtab = 'mr'; // 'mr' | 'po' | 'receipt' | 'bill'
        this.job_subtab = 'po'; // 'po' | 'receipt'
        this.acc_subtab = 'receivables'; // 'receivables' | 'supplier' | 'jobber'
        this.approval_subtab = 'merchandiser'; // 'merchandiser' | 'unassigned' | 'final'
        this.perms = null;   // filled from the server; gates the final-approval tab + tab visibility
        this.days = 120;
        this.scope = 'open';
        this.stage_filter = 'all';
        this.search = '';
        this.merchandiser_filter = '';
        this.approval_stage_filter = '';
        this.uniform_status_filter = ''; // Embroidery Transfers tab only — see #of-uniform-status
        this.cache = {};
        this.activity_cache = null;
        this.last_seen = '';
        this.show_unseen_only = true;
        // The stream shows every real milestone on this tab by default (the
        // server already limits it to real milestones — see
        // get_activity/_event_importance — so there is no separate "important"
        // toggle to manage here). "For me" is an opt-in narrowing filter, not
        // the default — most viewers (purchase, jobwork, accounts staff) are
        // not the Sales Order's merchandiser/owner and would otherwise see an
        // empty stream despite real activity happening on their tab.
        this.show_for_me_only = localStorage.getItem(OF_FOR_ME_KEY) === '1';
        // Stream collapsed by default unless explicitly set to '0'
        const stored_toggle = localStorage.getItem(OF_TOGGLE_KEY);
        this.stream_collapsed = stored_toggle === null ? true : stored_toggle === '1';

        // Load sales_order.js dynamically to get all its functions and design styles
        frappe.require('/assets/erp_dacsinc_custom/js/sales_order.js', () => {
            // Nothing downstream of get_last_seen needs to block the shell —
            // it is only consumed once an activity fetch returns, which
            // itself waits on render_shell()/bind() below. Fire it in
            // parallel rather than chaining it ahead of the permission call.
            frappe.call({
                method: 'erp_dacsinc_custom.order_flow_api.get_last_seen'
            }).then(r => {
                this.last_seen = r.message || localStorage.getItem(OF_SEEN_KEY) || '';
            });

            // Which tabs this user may see has to be known BEFORE the shell
            // is drawn — rendering all six buttons and hiding some after the
            // fact would flash the forbidden ones on screen first.
            frappe.call({ method: 'erp_dacsinc_custom.order_flow_api.get_order_flow_permissions' })
                .then(r => { this.perms = r.message || null; })
                .catch(() => { this.perms = null; })
                .always(() => {
                    if (!this.perms) {
                        // A real failure (network/500), not "no access" —
                        // tell the user to retry rather than claiming they
                        // have no permission.
                        this.render_perm_error();
                        return;
                    }

                    this.allowed_tabs = this.perms.allowed_tabs || [];
                    if (!this.allowed_tabs.length) {
                        this.render_no_access();
                        return;
                    }

                    this.render_shell();
                    this.bind();

                    // Remember the last tab across reloads, but only if this
                    // user can still see it — a demoted user must land on a
                    // tab they actually have, not bounce off a stale one.
                    const remembered = localStorage.getItem(OF_LAST_TAB_KEY);
                    const landing = (remembered && this.allowed_tabs.includes(remembered))
                        ? remembered
                        : this.allowed_tabs[0];
                    this.switch_tab(landing);
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

    // Whether the session user may see `tab`, per the permissions fetched
    // at boot. Used both to decide what render_shell() draws and as a
    // backstop inside switch_tab() for every caller, not just the tab
    // strip's own click handler.
    can_see(tab) {
        return !!(this.perms && this.perms.tabs && this.perms.tabs[tab]);
    }

    // The permission call itself failed (network error, 500) — distinct from
    // "you have no tabs", which is a real, valid answer from the server.
    // Conflating the two would tell a user with a flaky connection that they
    // have no permission, when a reload might simply work.
    render_perm_error() {
        this.$body.html(`
            <div class="of-page">
                <div class="of-card" style="border-color:var(--of-red); padding:24px; border-left: 4px solid var(--of-red);">
                    <h4 style="color:var(--of-red); margin-top:0; font-size:14px;">
                        <i class="fa fa-exclamation-triangle"></i> Could not load Order Flow
                    </h4>
                    <p style="font-size:12px; color:var(--text-color); margin: 8px 0;">
                        Something went wrong while checking your access to this page.
                    </p>
                    <button class="of-btn of-btn--primary" onclick="location.reload();"><i class="fa fa-refresh"></i> Reload Page</button>
                </div>
            </div>
        `);
    }

    // A real, resolved answer from the server: this user is allowed no tab
    // at all. Distinct from render_perm_error() above.
    render_no_access() {
        this.$body.html(`
            <div class="of-page">
                <div class="of-card" style="padding:24px;">
                    <h4 style="margin-top:0; font-size:14px;"><i class="fa fa-lock"></i> No access to Order Flow</h4>
                    <p style="font-size:12px; color:var(--text-muted); margin: 8px 0;">
                        Your role does not have access to any tab on this page. Ask an administrator
                        to grant your role access under Admin Settings &gt; Order Flow.
                    </p>
                </div>
            </div>
        `);
    }

    render_shell() {
        this.$body.html(`
            <div class="of-page">
                <!-- Main Tabs -->
                <div class="of-tabs">
                    ${OF_TABS.filter(t => this.can_see(t.key)).map(t => `
                        <button class="of-tab" data-tab="${t.key}">
                            <i class="fa ${t.icon}"></i> ${of_esc(t.label)}
                            <span class="of-tab__badge of-hidden" id="of-new-badge-${t.key}">0</span>
                        </button>`).join('')}
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
                    <select class="of-select" id="of-uniform-status" style="display: none;" title="Filter by transfer status">
                        <option value="">All Statuses</option>
                        <option value="Sent">Sent</option>
                        <option value="Partially Received">Partially Received</option>
                        <option value="Received">Received</option>
                        <option value="Cancelled">Cancelled</option>
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
            // render_shell() only draws buttons for tabs this user can see,
            // so this only fires if access was revoked after the page loaded
            // (someone edited Admin Settings while this tab was open). Say
            // so rather than let the click go silently nowhere.
            if (!this.can_see(tab)) {
                frappe.msgprint(__('You no longer have access to the {0} tab. Reloading the page will update what you can see.', [OF_TAB_LABELS[tab] || tab]));
                return;
            }
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
        this.$body.on('change', '#of-uniform-status', (e) => { this.uniform_status_filter = e.target.value; this.refresh(true); });
        this.$body.on('change', '#of-scope', (e) => { this.scope = e.target.value; this.refresh(true); });
        this.$body.on('change', '#of-days',  (e) => { this.days  = e.target.value; this.refresh(true); });

        // Row-wise seen / unseen toggle: a plain checkbox per notification, either
        // direction, so a user can park an event back on their own list until
        // they act on it. Unseen is the default state for anything new.
        this.$body.on('change', '.of-feed-seen-checkbox', (e) => {
            e.stopPropagation();
            const cb = $(e.currentTarget);
            // attr(), not data(): jQuery would cast an all-digit document name
            // to a Number and lose its leading zeros.
            const doctype = cb.attr('data-doctype');
            const docname = cb.attr('data-name');
            const now_seen = cb.is(':checked');
            // Pin the tab now: seen is per tab, and the undo below runs later,
            // by which time the user may have switched tabs.
            const on_tab = this.active;

            this.set_notification_seen(doctype, docname, now_seen ? 1 : 0, on_tab);

            if (now_seen && this.show_unseen_only) {
                // The row is about to disappear from an "unseen only" list —
                // keep a way back for a mis-click.
                cb.closest('.of-feed__item').slideUp(200);
                const $alert = frappe.show_alert({
                    message: `${__('Marked as seen')} · <a class="of-undo-seen" href="#" style="text-decoration:underline;">${__('Undo')}</a>`,
                    indicator: 'green'
                }, 6);
                if ($alert && $alert.find) {
                    $alert.find('.of-undo-seen').on('click', (ev) => {
                        ev.preventDefault();
                        this.set_notification_seen(doctype, docname, 0, on_tab);
                        this.render_activity(this.activity_cache);
                        $alert.remove();
                    });
                }
            }

            if (this.activity_cache) {
                setTimeout(() => {
                    this.render_activity(this.activity_cache);
                }, this.show_unseen_only && now_seen ? 200 : 0);
            }
        });

        // Mark all seen — scoped to whichever tab's stream card the button lives in.
        // The button carries data-tab so we know exactly which filter config to apply.
        this.$body.on('click', '.of-btn-mark-stream-seen', (e) => {
            e.stopPropagation();

            if (!this.activity_cache || this.activity_cache.length === 0) return;

            // Which tab owns this stream card?
            const tab = $(e.currentTarget).data('tab') || this.active;

            // Only the rows visible in that specific tab's feed, and only the
            // ones still unseen ON THAT TAB.
            const unseen = this.filter_tab_rows(this.activity_cache, tab)
                .filter(x => !of_is_seen(x, tab));
            if (unseen.length === 0) {
                frappe.show_alert({ message: __('No unseen notifications in this tab.'), indicator: 'blue' });
                return;
            }

            const tab_label = OF_TAB_LABELS[tab] || tab;
            frappe.confirm(
                __('Mark all {0} unseen notifications as seen on the {1} tab? Other tabs are not affected.',
                   [unseen.length, tab_label]),
                () => {
                    // docstatus/status travel with each event: the server keys
                    // "seen" per milestone, so the same document notifies again
                    // when it is submitted or cancelled later.
                    const unseen_events = unseen.map(x => ({
                        doctype: x.doctype,
                        name: x.name,
                        docstatus: x.docstatus,
                        status: x.status
                    }));

                    unseen.forEach(x => {
                        x.seen_tabs = x.seen_tabs || {};
                        x.seen_tabs[tab] = 1;
                    });

                    frappe.call({
                        method: 'erp_dacsinc_custom.order_flow_api.mark_all_notifications_as_seen',
                        args: { events: JSON.stringify(unseen_events), tab: tab }
                    }).then(() => {
                        this.render_activity(this.activity_cache);
                        frappe.show_alert({
                            message: __('{0} notifications marked as seen on the {1} tab.',
                                        [unseen_events.length, tab_label]),
                            indicator: 'green'
                        });
                    });
                }
            );
        });

        // Stream filter checkboxes — there's now a single global stream, so this
        // just re-renders it
        const bind_stream_filter = (selector, field, storage_key) => {
            this.$body.on('change', selector, (e) => {
                this[field] = e.target.checked;
                if (storage_key) {
                    localStorage.setItem(storage_key, this[field] ? '1' : '0');
                }
                this.$body.find(selector).prop('checked', this[field]);
                if (this.activity_cache) {
                    this.render_activity(this.activity_cache);
                }
            });
        };
        bind_stream_filter('.of-toggle-unseen-only', 'show_unseen_only', null);
        bind_stream_filter('.of-toggle-for-me', 'show_for_me_only', OF_FOR_ME_KEY);

        // Escape hatch from an empty, over-filtered stream
        this.$body.on('click', '.of-show-all-activity', (e) => {
            e.stopPropagation();
            this.show_for_me_only = false;
            this.show_unseen_only = false;
            localStorage.setItem(OF_FOR_ME_KEY, '0');
            if (this.activity_cache) {
                this.render_activity(this.activity_cache);
            }
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
                // Opens an EXISTING document (the Next Action button for most
                // tracker stages) — a document link like any other on this
                // dashboard, so it opens in a new tab rather than navigating
                // away from the dashboard itself.
                window.open(frappe.utils.get_form_link(doctype, target), '_blank');
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
                // Opens the existing Sales Order (a Pick List is created
                // from there) — a document link, same new-tab treatment.
                window.open(frappe.utils.get_form_link('Sales Order', so), '_blank');
            } else if (action === 'make_po_from_mr' && target) {
                frappe.model.open_mapped_doc({
                    method: 'erpnext.stock.doctype.material_request.material_request.make_purchase_order',
                    source_name: target,
                    freeze_message: __('Creating Purchase Order from Material Request…')
                });
            } else if (action === 'make_mr' && so) {
                // Opens the existing Sales Order (a Material Request is
                // raised from there) — same new-tab treatment.
                window.open(frappe.utils.get_form_link('Sales Order', so), '_blank');
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

        // New Sales Order, opened in a new tab like every other document
        // reference on this dashboard. The Customer field there is already
        // scoped correctly with no extra work here: Customer's
        // permission_query_conditions hook (hooks.py) restricts a
        // Merchandiser User's search results to only the customers already
        // assigned to them (custom_merchandiser_user = them), the same rule
        // that already governs the Customer list and every other Link field
        // pointing at Customer — an admin's search is unrestricted.
        this.$body.on('click', '#of-new-so-btn', () => {
            window.open('/app/sales-order/new', '_blank');
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
            const outstanding = flt_of($(e.currentTarget).data('outstanding'));
            const dialog = new frappe.ui.Dialog({
                title: __('Receive from Embroidery'),
                fields: [
                    {
                        fieldtype: 'HTML',
                        fieldname: 'outstanding_note',
                        options: `<div style="margin-bottom:6px; font-size:12px; color:var(--text-muted);">
                            ${__('{0} is still outstanding on this transfer. Receive all of it, or only part if the jobber has sent back a partial batch — the rest stays open to receive later.', [`<b>${outstanding}</b>`])}
                        </div>`
                    },
                    {
                        fieldtype: 'Link',
                        fieldname: 'to_warehouse',
                        options: 'Warehouse',
                        label: __('Destination Warehouse'),
                        reqd: 1,
                        default: 'VV Puram - IND'
                    },
                    {
                        fieldtype: 'Column Break'
                    },
                    {
                        fieldtype: 'Float',
                        fieldname: 'qty',
                        label: __('Quantity Received Now'),
                        reqd: 1,
                        default: outstanding,
                        description: __('Defaults to the full outstanding quantity — lower it for a partial receipt.')
                    }
                ],
                primary_action_label: __('Receive'),
                primary_action: (values) => {
                    if (flt_of(values.qty) > outstanding) {
                        frappe.msgprint(__('Cannot receive more than the {0} still outstanding.', [outstanding]));
                        return;
                    }
                    dialog.get_primary_btn().attr('disabled', true);
                    frappe.call({
                        method: 'erp_dacsinc_custom.uniform_transfer_api.receive_embroidery_transfer',
                        args: {
                            transfer_id: transfer_id,
                            to_warehouse: values.to_warehouse,
                            qty: values.qty
                        }
                    }).then(r => {
                        dialog.hide();
                        const result = r.message || {};
                        const message = result.status === 'Partially Received'
                            ? __('Partial receipt recorded — {0} still outstanding.', [flt_of(result.outstanding)])
                            : __('Embroidered items received successfully — transfer complete.');
                        frappe.show_alert({message, color: 'green'});
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

        // Click to redirect logic for Sales Tracker flow links and status chips
        this.$body.on('click', '.of-link-flow', (e) => {
            e.stopPropagation();
            const element = $(e.currentTarget);
            const doctype = element.attr('data-doctype');
            const docs_data = element.attr('data-docs') || '';
            
            let docs = [];
            if (doctype === 'Receipt' || doctype === 'Job') {
                try {
                    docs = JSON.parse(decodeURIComponent(docs_data));
                } catch(err) {
                    docs = [];
                }
            } else {
                docs = docs_data.split(',').filter(Boolean).map(d => ({ name: d, doctype: doctype }));
            }
            
            if (!docs.length) return;

            // Every document reference on this dashboard opens in a new tab
            // rather than navigating away from it — same as every plain <a>
            // link here, just reached through a click handler instead of an
            // anchor, so frappe.set_route (same-tab SPA navigation) is wrong
            // for this one.
            if (docs.length === 1) {
                window.open(frappe.utils.get_form_link(docs[0].doctype, docs[0].name), '_blank');
            } else {
                // Multiple documents: prompt user to select one
                const doc_options = docs.map(d => `${d.doctype}: ${d.name}`);
                frappe.prompt([
                    {
                        label: `Select ${doctype}`,
                        fieldname: 'doc_info',
                        fieldtype: 'Select',
                        options: doc_options,
                        reqd: 1
                    }
                ], (values) => {
                    const selected_idx = doc_options.indexOf(values.doc_info);
                    if (selected_idx !== -1) {
                        const selected = docs[selected_idx];
                        window.open(frappe.utils.get_form_link(selected.doctype, selected.name), '_blank');
                    }
                }, `Choose document to open`, 'Open');
            }
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
        // A backstop for every caller, not just the click delegate in bind()
        // — the Number Card tile handler jumps straight to switch_tab('tracker')
        // without going through that delegate at all.
        if (!this.can_see(tab)) return;
        this.active = tab;
        localStorage.setItem(OF_LAST_TAB_KEY, tab);
        this.$body.find('.of-tab').removeClass('is-active')
            .filter(`[data-tab="${tab}"]`).addClass('is-active');
        OF_TABS.forEach(t => {
            this.$body.find(`#of-panel-${t.key}`).toggleClass('of-hidden', t.key !== tab);
        });
        this.$body.find('#of-stage-bar').toggleClass('of-hidden', tab !== 'tracker');
        this.$body.find('#of-approval-stage').toggle(tab === 'approval');
        this.$body.find('#of-uniform-status').toggle(tab === 'uniform');
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
        // wrapper.on_page_show fires refresh(true) on every page show —
        // including the very first one, as part of the same navigation that
        // constructs this object, well before the async permission fetch in
        // the constructor resolves and calls switch_tab() for the first
        // time. Before that, this.active is null (no tab has been chosen
        // yet, and none may ever be chosen if this user has no accessible
        // tab), so there is nothing to refresh — the boot chain's own
        // switch_tab() call triggers the first real refresh() once perms
        // are known.
        if (!this.active) return;

        this.load_summary();
        if (force) this.cache = {};

        const key = `${this.active}:${this.days}:${this.scope}:${this.stage_filter}:${this.search}:${this.merchandiser_filter}:${this.approval_stage_filter}:${this.uniform_status_filter}`;
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
        if (this.active === 'uniform') {
            args.status = this.uniform_status_filter || null;
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
            // scope/search mirror the tab tables, so the stream only ever talks
            // about orders the operator can actually see. `limit` is a
            // per-doctype allowance server-side, not a global cut.
            args: {
                days: this.days,
                limit: 40,
                merchandiser: this.merchandiser_filter,
                scope: this.scope,
                search: this.search || null
            }
        }).then(r => {
            const rows = r.message || [];
            this.activity_cache = rows;

            // A user with no orders of their own (a plain admin, say) would
            // otherwise land on an empty stream. Relax the default filter once,
            // but never override a choice the user made themselves.
            if (rows.length && this.show_for_me_only && localStorage.getItem(OF_FOR_ME_KEY) === null
                    && !rows.some(x => x.for_me)) {
                this.show_for_me_only = false;
            }

            this.render_activity(rows);
        });
    }

    // Flip one notification's seen state on ONE tab, locally first so the row
    // reacts at once.
    set_notification_seen(doctype, docname, seen, tab) {
        const on_tab = tab || this.active;
        let ev = null;
        (this.activity_cache || []).forEach(x => {
            if (x.doctype === doctype && x.name === docname) {
                x.seen_tabs = x.seen_tabs || {};
                if (seen) {
                    x.seen_tabs[on_tab] = 1;
                } else {
                    delete x.seen_tabs[on_tab];
                }
                ev = x;
            }
        });

        frappe.call({
            method: seen
                ? 'erp_dacsinc_custom.order_flow_api.mark_notification_as_seen'
                : 'erp_dacsinc_custom.order_flow_api.mark_notification_as_unseen',
            // The server keys "seen" per tab and per milestone rather than per
            // document, so both the tab and the document's current state have to
            // travel with the request — otherwise clearing it here would clear
            // every other tab too, and submitting or cancelling the document
            // later would inherit this mark and never notify.
            args: {
                event_doctype: doctype,
                event_name: docname,
                event_docstatus: ev ? ev.docstatus : null,
                event_status: ev ? ev.status : null,
                tab: on_tab
            }
        });
    }

    // Apply a tab's full filter config (doctype list + optional docstatus gate).
    // Also honours the "For me" toggle unless opts.ignore_for_me is set.
    filter_tab_rows(rows, tab_name, opts) {
        const o = opts || {};
        const cfg = OF_TAB_FILTERS[tab_name] || {};
        let result = rows || [];

        // 1. Doctype whitelist (null = all doctypes pass)
        if (cfg.doctypes && cfg.doctypes.length) {
            result = result.filter(x => cfg.doctypes.includes(x.doctype));
        }

        // 2. The Tracker and Approvals tabs list the same doctype from opposite
        //    sides of approval — the Tracker table is submitted orders, the
        //    Approvals table is drafts awaiting a decision. Split the stream the
        //    same way, or each tab reports on orders the other one is showing.
        //    The Tracker lists Sales Orders, so an event with no order behind it
        //    (an embroidery stock transfer) has no row here to belong to.
        if (tab_name === 'tracker') {
            result = result.filter(x => x.sales_order && Number(x.so_docstatus) === 1);
        }

        if (tab_name === 'approval') {
            result = result.filter(x => Number(x.so_docstatus) === 0);
        }

        // 3. Purchase and Job Work both deal in Purchase Orders, split by whether
        //    the order is subcontracted — exactly how their tables are split.
        //    Purchase also lists only DRAFT supplier bills (its "bill" sub-tab is
        //    about getting them submitted); once submitted they are the Accounts
        //    tab's business.
        if (tab_name === 'purchase') {
            result = result.filter(x => {
                if (x.doctype === 'Purchase Order') return !Number(x.is_subcontracted);
                if (x.doctype === 'Purchase Invoice') return Number(x.docstatus) === 0;
                return true;
            });
        }

        if (tab_name === 'jobwork') {
            result = result.filter(x =>
                x.doctype !== 'Purchase Order' || Number(x.is_subcontracted));
        }

        // 4. "For me" personal filter
        if (this.show_for_me_only && !o.ignore_for_me) {
            result = result.filter(x => x.for_me);
        }

        return result;
    }

    // Legacy wrapper kept so existing call-sites that pass opts.ignore_for_me still work.
    global_rows(rows, opts) {
        const o = opts || {};
        if (this.show_for_me_only && !o.ignore_for_me) return (rows || []).filter(x => x.for_me);
        return rows || [];
    }

    render_activity(rows) {
        rows = rows || [];

        // Per-tab nav dot badges and stream header badges — each tab counts only
        // what is still unseen ON THAT TAB, since seen is recorded per tab.
        // Iterate allowed_tabs, not every tab that exists: counting unseen
        // items on a tab this user can't open would make the page-title
        // total advertise notifications they can never actually reach.
        let total_fresh = 0;
        this.allowed_tabs.forEach(tab => {
            const tab_rows = this.filter_tab_rows(rows, tab);
            const fresh = tab_rows.filter(x => !of_is_seen(x, tab)).length;
            total_fresh += fresh;

            const $badge = this.$body.find(`#of-new-badge-${tab}`);
            if ($badge.length) $badge.text(fresh).toggleClass('of-hidden', !fresh);

            const $stream_badge = this.$body.find(`#of-unseen-${tab}`);
            if ($stream_badge.length) $stream_badge.text(fresh).toggleClass('of-hidden', !fresh);
        });

        // Page title carries the sum of the tab badges, so it always agrees with
        // what the tabs are showing.
        this.page.set_title(total_fresh > 0 ? `Order Flow (${total_fresh})` : `Order Flow`);

        // Keep filter checkboxes in step
        this.$body.find('.of-toggle-unseen-only').prop('checked', this.show_unseen_only);
        this.$body.find('.of-toggle-for-me').prop('checked', this.show_for_me_only);

        // Populate the active tab's notification stream with its own filtered rows
        const active_rows = this.filter_tab_rows(rows, this.active);
        const all_active = this.filter_tab_rows(rows, this.active, { ignore_for_me: true });

        const $feed = this.$body.find(`#of-activity-${this.active}`);
        if ($feed.length) {
            $feed.html(this.activity_html(active_rows, all_active));
        }
    }

    // A tab-specific notification stream card carrying only milestones that
    // belong to this tab's doctypes.
    activity_stream_html(tab_name) {
        return `
            <div class="of-card of-stream-card" style="margin-bottom: 14px;">
                <div class="of-card__head of-card__head--toggle of-toggle-stream-header" style="justify-content:space-between;cursor:pointer;padding: 6px 12px;font-size:11px;">
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <i class="fa fa-bell" style="color:var(--of-orange);"></i> Live Order Activity Notifications
                        <span class="of-unseen-badge of-pill of-pill--bad of-hidden" style="margin-left: 5px; padding: 2px 6px; border-radius: 10px; font-weight: 700; font-size: 10px; background:#e74c3c; color:#fff;" id="of-unseen-${tab_name}">0</span>
                        <label class="of-checkbox-label" title="Hide notifications you have already marked as seen" style="display:flex; align-items:center; gap:4px; font-weight:normal; margin-left:15px; cursor:pointer;" onclick="event.stopPropagation();">
                            <input type="checkbox" class="of-toggle-unseen-only" ${this.show_unseen_only ? 'checked' : ''} style="margin:0; vertical-align:middle; cursor:pointer;" />
                            <span>Unseen only</span>
                        </label>
                        <label class="of-checkbox-label" title="Only orders you are responsible for — your customers, your orders, and approvals waiting on you" style="display:flex; align-items:center; gap:4px; font-weight:normal; margin-left:10px; cursor:pointer;" onclick="event.stopPropagation();">
                            <input type="checkbox" class="of-toggle-for-me" ${this.show_for_me_only ? 'checked' : ''} style="margin:0; vertical-align:middle; cursor:pointer;" />
                            <span>For me</span>
                        </label>
                        <button class="of-btn of-btn-mark-stream-seen" data-tab="${tab_name}" style="margin-left: 15px; height: 18px; padding: 0 6px; font-size: 9px; background: none; border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-muted); cursor: pointer; transition: all 0.15s ease; display: inline-flex; align-items: center; gap: 4px;">
                            <i class="fa fa-check"></i> Mark all seen
                        </button>
                    </div>
                    <span class="of-btn of-btn--sm" style="pointer-events:none;height:20px;padding:0 6px;font-size:10px;">
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
            $btn.removeClass('fa-caret-right').addClass('fa-caret-down').css('color', 'var(--of-blue)');
            
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
            $btn.removeClass('fa-caret-down').addClass('fa-caret-right').css('color', 'var(--text-light)');
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
                this.strip_actions_if_view_only($container);
            } else {
                $container.html('<div class="alert alert-warning">generate_stock_overview_table function not found.</div>');
            }
        });
    }

    // generate_stock_overview_table (sales_order.js) is shared with the real
    // Sales Order form, so it can't be told "render without action buttons" —
    // it always renders Purchase Order / Material Request / Pick / Subcontract
    // PO / Delivery Note buttons for whoever has permission. Strip them here,
    // in the dashboard's own mount point only, for a view-only Merchandiser
    // User (see tracker_html's `view_only` for the matching top-level-row
    // treatment). so-btn--view and the refresh button stay — those just look,
    // they don't act.
    strip_actions_if_view_only($container) {
        if (!(this.perms && this.perms.tracker_scoped_to_own_customers)) return;
        $container.find('.so-btn, .so-qty-in')
            .not('.so-btn--view')
            .not('#btn-refresh-stock-table')
            .each(function () {
                const $el = $(this);
                if ($el.is('input')) {
                    $el.prop('disabled', true);
                } else {
                    $el.remove();
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

        // True only for a user whose SOLE reason for seeing this tab is the
        // Merchandiser User role (see is_scoped_to_own_customers on the
        // server) — someone who ALSO holds a broader role such as Production
        // Manager keeps the full view and its action buttons, since that
        // role's own reason for being here is company-wide visibility. The
        // server already scopes the row list itself (get_sales_tracker); here
        // the "Action Required" column drops its buttons to match: view only,
        // no way to act on someone else's workflow step from this tab.
        const view_only = !!(this.perms && this.perms.tracker_scoped_to_own_customers);

        const rows = orders.map(o => {
            const c = o.counts || {};
            const st = o.stage || {};
            const is_new = this.last_seen && o.last_event_on && o.last_event_on > this.last_seen;

            const chain = [
                ['MR', c['Material Request'], o.mrs, 'Material Request'],
                ['PO', c['Purchase Order'], o.pos, 'Purchase Order'],
                ['Recv', (c['Purchase Receipt'] || 0) + (c['Subcontracting Receipt'] || 0), o.receipts, 'Receipt'],
                ['Job', (c['Job Work (Subcontract)'] || 0) + (c['Embroidery Work Order'] || 0), o.jobworks, 'Job'],
                ['Pick', c['Pick List'], o.pick_lists, 'Pick List'],
                ['DN', c['Delivery Note'], o.delivery_notes, 'Delivery Note'],
                ['Inv', c['Sales Invoice'], o.invoices, 'Sales Invoice']
            ].map(([label, n, docs, doctype]) => {
                if (!n) {
                    return `<span class="of-micro" style="display:inline-block;white-space:nowrap;margin:1px 3px 1px 0;opacity:.4;">${label}</span>`;
                }
                let docs_data = '';
                if (doctype === 'Receipt' || doctype === 'Job') {
                    docs_data = encodeURIComponent(JSON.stringify(docs || []));
                } else {
                    docs_data = (docs || []).join(',');
                }
                return `<span class="of-micro of-link-flow" data-doctype="${doctype}" data-docs="${docs_data}" style="display:inline-block;white-space:nowrap;margin:1px 3px 1px 0;color:var(--of-info);font-weight:600;cursor:pointer;text-decoration:underline;" title="Click to view linked ${label}"><b>${n}</b> ${label}</span>`;
            }).join('');

            // Action Button HTML
            let action_btn_html = '';
            if (view_only) {
                action_btn_html = st.action_type && st.action_type !== 'none'
                    ? `<span class="of-micro" title="${of_esc(st.action_label || '')}">${of_esc(st.stage_label || 'In progress')}</span>`
                    : `<span class="of-micro" style="color:var(--of-green);font-weight:600;"><i class="fa fa-check-circle"></i> Completed</span>`;
            } else if (st.action_type && st.action_type !== 'none') {
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
                            ${o.is_overdue ? '<span class="of-chip of-chip--bad" style="margin-left:4px;">Overdue</span>' : ''}
                            ${o.skip_delivery_note ? '<span class="of-chip" style="margin-left:4px; background:#e83e8c; color:#fff; font-size:9px; padding:2px 5px; border-radius:3px; font-weight:700;">Direct Bill</span>' : ''}
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
                        <i class="fa fa-${st.icon || 'circle'}"></i> ${of_esc(of_to_title_case(st.stage_label || 'Open'))}
                    </span>
                </td>
                <td>
                    ${action_btn_html}
                </td>
                <td style="text-align:left;">${chain}</td>
                <td>
                    ${of_status_chip(o.per_delivered, st.stage_key, 'delivered', o.delivery_notes, null, o.stock_invoices)}
                </td>
                <td>
                    ${of_status_chip(o.per_billed, st.stage_key, 'billed', o.invoices, o.draft_invoices)}
                </td>
                <td>
                    ${o.last_event ? this.last_activity_html(o) : '<span class="of-val of-val--zero">—</span>'}
                </td>
            </tr>`;
        }).join('');

        return `
            <!-- Live Activity Notifications -->
            ${this.activity_stream_html('tracker')}

            <!-- Top Summary Cards (Interactive Stage Number Cards) -->
            <div class="of-summary" id="of-summary-tracker"></div>

            <!-- Sales Order Action Tracker Table -->
            <div class="of-card">
                <div class="of-card__head">
                    <i class="fa fa-tasks"></i> Sales Order Stage &amp; Required Action Plan
                    <small>Clear next action button for every order</small>
                </div>
                <div class="of-scroll">
                    <table class="of-table of-table--tracker">
                        <thead><tr>
                            <th style="width:18%;">Sales Order &amp; Customer</th>
                            <th style="width:9%;">Dates</th>
                            <th style="width:14%;">Current Stage</th>
                            <th style="width:15%;">Action Required</th>
                            <th style="width:14%;">Document Flow</th>
                            <th style="width:9%;">Delivery</th>
                            <th style="width:9%;">Billing</th>
                            <th style="width:12%;">Last Activity</th>
                        </tr></thead>
                        <tbody>${rows || `<tr><td colspan="8" class="of-empty">
                             <i class="fa fa-inbox"></i>No orders match the selected stage filter.</td></tr>`}</tbody>
                    </table>
                </div>
            </div>`;
    }

    // Last Activity = the last thing that actually moved the order (submission,
    // approval, rejection, or a comment carrying one). The server already picked
    // it; a plain draft save only appears when the order has no milestone yet.
    last_activity_html(o) {
        const label = o.last_event_label || o.last_event;
        const is_comment = o.last_event === 'Comment';
        const doc_link = (!is_comment && o.last_event_doc)
            ? `<a href="/app/${of_route(o.last_event)}/${encodeURIComponent(o.last_event_doc)}" target="_blank">${of_esc(o.last_event_doc)}</a>`
            : '';

        return `
            <div class="of-last-activity ${o.last_event_important ? '' : 'is-minor'}" title="${of_esc(label)}">
                ${is_comment ? '<i class="fa fa-comment-o" style="margin-right:3px;"></i>' : ''}${of_esc(label)}
            </div>
            ${doc_link}
            <div class="of-micro">${of_ago(o.last_event_on)}${o.last_event_important ? '' : ' · no milestone yet'}</div>`;
    }

    activity_html(rows, all_rows) {
        const filtered_out = (all_rows || []).length && !(rows || []).length;
        // This feed always belongs to the active tab, and seen is per tab.
        const tab = this.active;

        if (this.show_unseen_only) {
            rows = (rows || []).filter(ev => !of_is_seen(ev, tab));
        }

        if (!rows || !rows.length) {
            // Never leave the user staring at an empty stream without telling
            // them a filter — not the absence of work — emptied it.
            const hint = (filtered_out || this.show_for_me_only)
                ? `<div style="margin-top:6px;">
                       <button class="of-btn of-btn--sm of-show-all-activity" style="font-size:10px;">
                           <i class="fa fa-eye"></i> Show everything
                       </button>
                   </div>`
                : '';
            const what = this.show_unseen_only ? __('unseen') : '';
            const whose = this.show_for_me_only ? __('assigned to you') : '';
            return `<div class="of-empty"><i class="fa fa-inbox"></i>${__('No {0} activity {1} here.', [what, whose]).replace(/\s+/g, ' ')}${hint}</div>`;
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
            // Embroidery stock transfers have no Sales Order behind them.
            const so_link = ev.sales_order
                ? `<a href="/app/sales-order/${encodeURIComponent(ev.sales_order)}" target="_blank" style="font-weight:700;">${of_esc(ev.sales_order)}</a>`
                : '';
            const customer_str = ev.customer_name ? ` · ${of_esc(ev.customer_name)}` : '';

            // Generate message text & border class based on doctype, docstatus and status
            let msg = '';
            let border_class = 'of-feed__item--wait';
            
            const ds = ev.docstatus;
            const st = String(ev.status || '').toLowerCase();
            // Match the whole status, never a substring. ERPNext statuses overlap
            // as text in ways that quietly invert meaning: "Unpaid" contains
            // "paid", "Partially Ordered" contains "ordered", and
            // "To Receive and Bill" — a Purchase Order that has just been placed
            // and has received nothing — contains both "receive" and "bill".
            const is_st = (...names) => names.includes(st);
            const party_lbl = ev.party_name || ev.party || '';
            const supplier_link = party_lbl ? `<a href="/app/supplier/${encodeURIComponent(ev.party)}" target="_blank" style="font-weight:600;">${of_esc(party_lbl)}</a>` : '';
            const customer_link = party_lbl ? `<a href="/app/customer/${encodeURIComponent(ev.party)}" target="_blank" style="font-weight:600;">${of_esc(party_lbl)}</a>` : '';

            // A cancellation is the same clear signal regardless of doctype, and it
            // must be decided before the doctype branches below — several of those
            // never defined a docstatus-2 message, which left the notification
            // blank for a cancelled Purchase Receipt, Pick List, Delivery Note,
            // Sales/Purchase Invoice, Subcontracting Receipt, Job Work or
            // Embroidery Work Order.
            if (ds === 2) {
                msg = `${ev.doctype} ${doc_link} was cancelled`;
                border_class = 'of-feed__item--blocked';
            } else if (ev.doctype === 'Material Request') {
                if (ds === 0) {
                    msg = `Material Request ${doc_link} raised (Draft) — items needed for SO`;
                    border_class = 'of-feed__item--draft';
                } else if (ds === 1) {
                    if (is_st('partially ordered')) {
                        msg = `Material Request ${doc_link} partly ordered — some items still to buy`;
                        border_class = 'of-feed__item--wait';
                    } else if (is_st('ordered')) {
                        msg = `Material Request ${doc_link} fully ordered — PO has been raised`;
                        border_class = 'of-feed__item--ready';
                    } else if (is_st('received')) {
                        msg = `Material Request ${doc_link} fully received`;
                        border_class = 'of-feed__item--ready';
                    } else if (is_st('partially received')) {
                        msg = `Material Request ${doc_link} partly received`;
                        border_class = 'of-feed__item--wait';
                    } else if (is_st('transferred')) {
                        msg = `Subcontract items transferred via Material Request ${doc_link}`;
                        border_class = 'of-feed__item--ready';
                    } else if (is_st('issued')) {
                        msg = `Material Request ${doc_link} issued`;
                        border_class = 'of-feed__item--ready';
                    } else if (is_st('stopped')) {
                        msg = `Material Request ${doc_link} stopped`;
                        border_class = 'of-feed__item--blocked';
                    } else {
                        msg = `Material Request ${doc_link} submitted — ready to order`;
                        border_class = 'of-feed__item--dn';
                    }
                } else if (ds === 2) {
                    msg = `Material Request ${doc_link} was cancelled`;
                    border_class = 'of-feed__item--blocked';
                }
            } else if (ev.doctype === 'Purchase Order') {
                if (ds === 0) {
                    msg = `Purchase Order ${doc_link} created (Draft)`;
                    border_class = 'of-feed__item--draft';
                } else if (ds === 1) {
                    // "To Receive and Bill" is where a Purchase Order STARTS life
                    // once submitted — nothing received, nothing billed. Only the
                    // received percentage can tell a freshly placed order apart
                    // from a part-delivered one.
                    const got = flt_of(ev.po_per_received);
                    if (is_st('to receive and bill')) {
                        if (got > 0) {
                            msg = `Purchase Order ${doc_link} partly received from ${supplier_link} (${got.toFixed(0)}%) — rest still due`;
                            border_class = 'of-feed__item--wait';
                        } else {
                            msg = `Purchase Order ${doc_link} placed with ${supplier_link} — awaiting delivery`;
                            border_class = 'of-feed__item--dn';
                        }
                    } else if (is_st('to receive')) {
                        msg = got > 0
                            ? `Purchase Order ${doc_link} partly received from ${supplier_link} (${got.toFixed(0)}%) — billed in full`
                            : `Purchase Order ${doc_link} billed by ${supplier_link} — awaiting delivery`;
                        border_class = 'of-feed__item--wait';
                    } else if (is_st('to bill')) {
                        msg = `Purchase Order ${doc_link} fully received from ${supplier_link} — waiting for supplier invoice`;
                        border_class = 'of-feed__item--wait';
                    } else if (is_st('completed')) {
                        msg = `Purchase Order ${doc_link} fully received and billed with ${supplier_link}`;
                        border_class = 'of-feed__item--ready';
                    } else if (is_st('closed')) {
                        msg = `Purchase Order ${doc_link} was closed`;
                        border_class = 'of-feed__item--blocked';
                    } else if (is_st('on hold')) {
                        msg = `Purchase Order ${doc_link} put on hold`;
                        border_class = 'of-feed__item--blocked';
                    } else if (is_st('delivered')) {
                        msg = `Purchase Order ${doc_link} delivered by ${supplier_link}`;
                        border_class = 'of-feed__item--ready';
                    } else {
                        msg = `Purchase Order ${doc_link} submitted to ${supplier_link}`;
                        border_class = 'of-feed__item--dn';
                    }
                } else if (ds === 2) {
                    msg = `Purchase Order ${doc_link} was cancelled`;
                    border_class = 'of-feed__item--blocked';
                }
            } else if (ev.doctype === 'Purchase Receipt') {
                if (ds === 0) {
                    msg = `Purchase Receipt ${doc_link} (Draft)`;
                    border_class = 'of-feed__item--draft';
                } else if (ds === 1) {
                    msg = `Stock received via Purchase Receipt ${doc_link} from ${supplier_link} — ready to pick`;
                    border_class = 'of-feed__item--ready';
                }
            } else if (ev.doctype === 'Subcontracting Receipt') {
                if (ds === 0) {
                    msg = `Subcontracting Receipt ${doc_link} created (Draft)`;
                    border_class = 'of-feed__item--draft';
                } else if (ds === 1) {
                    msg = `Subcontract goods received via Subcontracting Receipt ${doc_link} from ${supplier_link}`;
                    border_class = 'of-feed__item--ready';
                }
            } else if (ev.doctype === 'Job Work (Subcontract)') {
                if (ds === 0) {
                    msg = `Job Work order ${doc_link} created (Draft) with vendor ${supplier_link}`;
                    border_class = 'of-feed__item--draft';
                } else if (ds === 1) {
                    msg = `Job Work started — PO ${doc_link} sent to subcontract vendor ${supplier_link}`;
                    border_class = 'of-feed__item--planned';
                }
            } else if (ev.doctype === 'Embroidery Work Order') {
                if (ds === 0) {
                    msg = `Embroidery Work Order ${doc_link} created (Draft) with jobber ${supplier_link}`;
                    border_class = 'of-feed__item--draft';
                } else if (ds === 1) {
                    msg = `Embroidery work started — ${doc_link} sent to jobber ${supplier_link}`;
                    border_class = 'of-feed__item--planned';
                }
            } else if (ev.doctype === 'Pick List') {
                if (ds === 0) {
                    msg = `Pick List ${doc_link} created (Draft) — needs submission`;
                    border_class = 'of-feed__item--draft';
                } else if (ds === 1) {
                    msg = `Pick List ${doc_link} submitted — items reserved & ready to deliver`;
                    border_class = 'of-feed__item--dn';
                }
            } else if (ev.doctype === 'Delivery Note') {
                if (ds === 0) {
                    msg = `Delivery Note ${doc_link} created (Draft) — needs submission`;
                    border_class = 'of-feed__item--draft';
                } else if (ds === 1) {
                    msg = `Delivered to customer via Delivery Note ${doc_link}`;
                    border_class = 'of-feed__item--ready';
                }
            } else if (ev.doctype === 'Sales Invoice') {
                if (ds === 0) {
                    msg = `Sales Invoice ${doc_link} raised (Draft) — waiting for submission`;
                    border_class = 'of-feed__item--draft';
                } else if (ds === 1) {
                    // "Unpaid" contains "paid" — exact matching only here.
                    if (is_st('paid')) {
                        msg = `Sales Invoice ${doc_link} fully paid by customer`;
                        border_class = 'of-feed__item--ready';
                    } else if (is_st('partly paid', 'partly paid and discounted')) {
                        msg = `Sales Invoice ${doc_link} part-paid by customer — balance still due`;
                        border_class = 'of-feed__item--wait';
                    } else if (is_st('overdue', 'overdue and discounted')) {
                        msg = `Sales Invoice ${doc_link} is OVERDUE — customer payment late`;
                        border_class = 'of-feed__item--blocked';
                    } else if (is_st('credit note issued')) {
                        msg = `Credit note issued against Sales Invoice ${doc_link}`;
                        border_class = 'of-feed__item--blocked';
                    } else if (is_st('return')) {
                        msg = `Sales Invoice ${doc_link} is a customer return`;
                        border_class = 'of-feed__item--blocked';
                    } else {
                        msg = `Sales Invoice ${doc_link} submitted — customer payment due`;
                        border_class = 'of-feed__item--dn';
                    }
                }
            } else if (ev.doctype === 'Sales Order') {
                if (ds === 0) {
                    const ws = ev.status || 'Draft';
                    msg = `Sales Order ${doc_link} is in stage: <b>${of_esc(ws)}</b>`;
                    border_class = 'of-feed__item--draft';
                } else if (ds === 1) {
                    // For a submitted order the event's own status is the
                    // workflow state, which stays "Approved" for the rest of the
                    // order's life. The fulfilment status is the one that keeps
                    // moving, and it is what the table's stage column shows — read
                    // that instead so the two never disagree.
                    const sos = String(ev.so_status || '').toLowerCase();
                    if (sos === 'completed') {
                        msg = `Sales Order ${doc_link} completed — fully delivered and billed`;
                        border_class = 'of-feed__item--ready';
                    } else if (sos === 'closed') {
                        msg = `Sales Order ${doc_link} was closed`;
                        border_class = 'of-feed__item--blocked';
                    } else if (sos === 'on hold') {
                        msg = `Sales Order ${doc_link} put on hold`;
                        border_class = 'of-feed__item--blocked';
                    } else if (sos === 'to bill') {
                        msg = `Sales Order ${doc_link} fully delivered — waiting to be invoiced`;
                        border_class = 'of-feed__item--dn';
                    } else if (sos === 'to deliver') {
                        msg = `Sales Order ${doc_link} fully invoiced — still to deliver`;
                        border_class = 'of-feed__item--dn';
                    } else {
                        msg = `Sales Order ${doc_link} approved — ready to fulfil`;
                        border_class = 'of-feed__item--ready';
                    }
                } else if (ds === 2) {
                    msg = `Sales Order ${doc_link} was cancelled`;
                    border_class = 'of-feed__item--blocked';
                }
            } else if (ev.doctype === 'Purchase Invoice') {
                if (ds === 0) {
                    msg = `Purchase Invoice ${doc_link} raised (Draft)`;
                    border_class = 'of-feed__item--draft';
                } else if (ds === 1) {
                    if (is_st('paid')) {
                        msg = `Supplier bill ${doc_link} fully paid to ${supplier_link}`;
                        border_class = 'of-feed__item--ready';
                    } else if (is_st('partly paid', 'partly paid and discounted')) {
                        msg = `Supplier bill ${doc_link} part-paid to ${supplier_link} — balance still due`;
                        border_class = 'of-feed__item--wait';
                    } else if (is_st('overdue', 'overdue and discounted')) {
                        msg = `Supplier bill ${doc_link} to ${supplier_link} is OVERDUE`;
                        border_class = 'of-feed__item--blocked';
                    } else {
                        msg = `Supplier bill ${doc_link} submitted — payment pending to ${supplier_link}`;
                        border_class = 'of-feed__item--wait';
                    }
                }
            } else if (ev.doctype === 'Uniform Embroidery Transfer') {
                if (st.includes('receiv')) {
                    msg = `Embroidery transfer ${doc_link} received back into stock`;
                    border_class = 'of-feed__item--ready';
                } else {
                    msg = `Plain stock sent to embroidery on transfer ${doc_link}`;
                    border_class = 'of-feed__item--planned';
                }
            } else if (ev.doctype === 'Comment') {
                const author = ev.owner_fullname || ev.owner || 'User';
                const tempDiv = document.createElement("div");
                tempDiv.innerHTML = ev.status; // ev.status holds the comment text
                const text = (tempDiv.textContent || tempDiv.innerText || '').substring(0, 120);
                msg = `Comment added by <b>${of_esc(author)}</b>: <span style="font-style: italic; color: var(--text-muted); font-size:11px;">"${of_esc(text)}"</span>`;
                border_class = 'of-feed__item--dn';
            } else {
                msg = `${ev.doctype} ${doc_link} updated`;
                border_class = 'of-feed__item--wait';
            }

            // Why this row is in *your* stream, and whether it is parked on you.
            const action_chip = ev.action_needed
                ? `<span class="of-chip of-chip--action" title="${of_esc(ev.relevance_reason || '')}"><i class="fa fa-hand-o-right"></i> Your action</span>`
                : '';
            const mine_chip = ev.is_own_action
                ? `<span class="of-chip of-chip--mine" title="You performed this action">You</span>`
                : '';
            const reason = (ev.relevance_reason && !ev.action_needed)
                ? `<span class="of-feed__reason" title="${of_esc(ev.relevance_reason)}">· ${of_esc(ev.relevance_reason)}</span>`
                : '';

            const seen_here = of_is_seen(ev, tab);
            const seen_title = seen_here
                ? __('Seen on the {0} tab — uncheck to bring it back as pending', [OF_TAB_LABELS[tab] || tab])
                : __('Unseen — check once you have dealt with it (this tab only)');

            return `
            <div class="of-feed__item ${border_class} ${is_new ? 'is-new' : ''} ${seen_here ? 'is-seen' : 'is-unseen'} ${ev.action_needed ? 'needs-action' : ''}" data-so="${of_esc(ev.sales_order)}">
                <div class="of-feed__icon" style="background:${ic.c};"><i class="fa fa-${ic.i}"></i></div>
                <div class="of-feed__body">
                    <div style="font-size:12px; color:var(--text-color); line-height:1.4;">
                        ${action_chip}${mine_chip} ${msg}
                    </div>
                    <div class="of-feed__sub" style="margin-top:3px; font-size:11px; color:var(--text-muted);">
                        ${so_link ? `📦 SO: ${so_link}${customer_str} ` : ''}${reason}
                    </div>
                </div>
                <div class="of-feed__time" style="display:flex; align-items:center; gap:8px;">
                    <span>${of_ago(ev.ts)}</span>
                    <label class="of-feed-seen-toggle" title="${of_esc(seen_title)}" onclick="event.stopPropagation();">
                        <input type="checkbox" class="of-feed-seen-checkbox"
                               data-doctype="${of_esc(ev.doctype)}" data-name="${of_esc(ev.name)}"
                               ${seen_here ? 'checked' : ''} />
                        <span>${seen_here ? __('Seen') : __('Unseen')}</span>
                    </label>
                    ${is_new ? '<span class="of-new-dot"></span>' : ''}
                </div>
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
                    ${of_status_chip(p.per_received)}</td>
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
                    ${of_status_chip(p.per_received)}</td>
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
            <!-- Live Activity Notifications -->
            ${this.activity_stream_html('purchase')}

            <!-- Top Summary Cards -->
            <div class="of-summary" id="of-summary-purchase"></div>

            <!-- Purchase Flow Sub-Tab Navigation Bar -->
            <div class="of-subtabs">
                <button class="of-subtab ${subtab === 'mr' ? 'is-active' : ''}" data-subtab="mr">
                    <i class="fa fa-file-text-o" style="color:var(--of-purple);"></i> MR
                </button>
                <button class="of-subtab ${subtab === 'po' ? 'is-active' : ''}" data-subtab="po">
                    <i class="fa fa-shopping-cart" style="color:var(--of-blue);"></i> POs
                </button>
                <button class="of-subtab ${subtab === 'receipt' ? 'is-active' : ''}" data-subtab="receipt">
                    <i class="fa fa-inbox" style="color:var(--of-green);"></i> Receipts
                </button>
                <button class="of-subtab ${subtab === 'bill' ? 'is-active' : ''}" data-subtab="bill">
                    <i class="fa fa-calculator" style="color:var(--of-orange);"></i> To Bill
                </button>
            </div>

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
                    ${of_status_chip(p.per_received)}</td>
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
                <td><span class="of-pill of-pill--planned">${of_esc(of_to_title_case(stage || e.status || ''))}</span></td>
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
            <!-- Live Activity Notifications -->
            ${this.activity_stream_html('jobwork')}

            <!-- Top Summary Cards -->
            <div class="of-summary" id="of-summary-jobwork"></div>

            <!-- Job Work Sub-Tab Navigation Bar -->
            <div class="of-subtabs">
                <button class="of-subtab ${subtab === 'po' ? 'is-active' : ''}" data-subtab="po">
                    <i class="fa fa-shopping-cart" style="color:var(--of-blue);"></i> Sub POs
                </button>
                <button class="of-subtab ${subtab === 'receipt' ? 'is-active' : ''}" data-subtab="receipt">
                    <i class="fa fa-inbox" style="color:var(--of-green);"></i> Sub Receipts
                </button>
                <button class="of-subtab ${subtab === 'fp' ? 'is-active' : ''}" data-subtab="fp">
                    <i class="fa fa-magic" style="color:var(--of-orange);"></i> Embroidery - FP
                </button>
                <button class="of-subtab ${subtab === 'pn' ? 'is-active' : ''}" data-subtab="pn">
                    <i class="fa fa-scissors" style="color:var(--of-red);"></i> Embroidery - Panel
                </button>
            </div>

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
            <!-- Live Activity Notifications -->
            ${this.activity_stream_html('accounts')}

            <!-- Top Summary Cards -->
            <div class="of-summary" id="of-summary-accounts"></div>

            <!-- Accounts Sub-Tab Navigation Bar -->
            <div class="of-acc-subtabs">
                <button class="of-acc-subtab ${subtab === 'receivables' ? 'is-active' : ''}" data-subtab="receivables">
                    <i class="fa fa-arrow-circle-down" style="color:var(--of-green);"></i> Receivables
                </button>
                <button class="of-acc-subtab ${subtab === 'supplier' ? 'is-active' : ''}" data-subtab="supplier">
                    <i class="fa fa-arrow-circle-up" style="color:var(--of-red);"></i> Supplier Payables
                </button>
                <button class="of-acc-subtab ${subtab === 'jobber' ? 'is-active' : ''}" data-subtab="jobber">
                    <i class="fa fa-cogs" style="color:var(--of-purple);"></i> Jobber Payables
                </button>
            </div>

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
                        ${of_esc(of_to_title_case(o.workflow_state || 'Draft'))}
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
            <!-- Live Activity Notifications -->
            ${this.activity_stream_html('approval')}

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
                        <button class="of-btn of-btn--primary" id="of-new-so-btn" title="${__('A merchandiser sees only their own customers here; this is the same restriction Frappe already applies to the Customer field everywhere else.')}">
                            <i class="fa fa-plus"></i> ${__('New Sales Order')}
                        </button>
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
                    <table class="of-table of-table--approval">
                        <thead><tr>
                            ${sub === 'final' ? `
                            <th style="width:5%; text-align: center;">
                                <input type="checkbox" id="of-approval-select-all">
                            </th>
                            <th style="width:28%;">Sales Order &amp; Customer</th>
                            <th style="width:12%;">Dates</th>
                            <th style="width:17%;">Approval Stage</th>
                            <th style="width:13%;">Amount</th>
                            <th style="width:25%; text-align: center;">Actions</th>
                            ` : `
                            <th style="width:32%;">Sales Order &amp; Customer</th>
                            <th style="width:13%;">Dates</th>
                            <th style="width:19%;">Approval Stage</th>
                            <th style="width:14%;">Amount</th>
                            <th style="width:22%; text-align: center;">Actions</th>
                            `}
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
            const total = flt_of(t.qty);
            const received = flt_of(t.received_qty);
            const outstanding = Math.max(0, total - received);
            const pct = total > 0 ? Math.round((received / total) * 100) : 0;

            // Four real states, not two — a transfer received in two batches
            // is genuinely different from one just sent or one fully done,
            // and "Cancelled" (a valid status on the doctype) must never fall
            // into the same green "Completed" bucket as a real full receipt.
            const STATUS_STYLE = {
                'Sent':               { bg: '#fff3cd', fg: '#856404', bd: '#ffeeba', label: 'Sent (Pending Receipt)' },
                'Partially Received': { bg: '#cce5ff', fg: '#004085', bd: '#b8daff', label: `Partially Received (${pct}%)` },
                'Received':           { bg: '#d4edda', fg: '#155724', bd: '#c3e6cb', label: 'Received' },
                'Cancelled':          { bg: '#f8d7da', fg: '#721c24', bd: '#f5c6cb', label: 'Cancelled' },
            };
            const s = STATUS_STYLE[t.status] || STATUS_STYLE['Sent'];
            const status_badge = `<span class="of-pill" style="background:${s.bg}; color:${s.fg}; border:1px solid ${s.bd};">${s.label}</span>`;

            // A transfer can be received more than once — the button stays
            // available through "Partially Received", not just "Sent".
            const can_receive = t.status === 'Sent' || t.status === 'Partially Received';
            const action_html = can_receive ? `
                <button class="of-btn of-btn--success of-receive-btn" data-id="${t.name}" data-outstanding="${outstanding}">
                    <i class="fa fa-arrow-down"></i> ${received > 0 ? 'Receive Rest' : 'Receive'}
                </button>
            ` : (t.status === 'Cancelled'
                    ? `<span class="text-muted" style="font-size: 11px;"><i class="fa fa-ban"></i> Cancelled</span>`
                    : `<span class="text-muted" style="font-size: 11px;"><i class="fa fa-check"></i> Completed</span>`);

            return `
                <tr>
                    <td><a href="/app/uniform-embroidery-transfer/${encodeURIComponent(t.name)}" target="_blank"><b>${of_esc(t.name)}</b></a></td>
                    <td><a href="/app/item/${encodeURIComponent(t.source_item)}" target="_blank">${of_esc(t.source_item)}</a></td>
                    <td><a href="/app/item/${encodeURIComponent(t.target_item)}" target="_blank">${of_esc(t.target_item)}</a></td>
                    <td><b>${total}</b></td>
                    <td>
                        <b style="color:${received > 0 ? 'var(--of-green)' : 'inherit'};">${received}</b>
                        ${received > 0 && outstanding > 0 ? `<div style="font-size:11px; color:var(--of-orange);">${outstanding} outstanding</div>` : ''}
                    </td>
                    <td><div style="font-size:11px; color:#555;">${of_esc(t.from_warehouse)} <i class="fa fa-long-arrow-right"></i> ${of_esc(t.wip_warehouse)}</div></td>
                    <td>${of_date(t.date_sent)}</td>
                    <td>${t.date_received ? of_date(t.date_received) : '-'}</td>
                    <td>${status_badge}</td>
                    <td style="text-align: center;">${action_html}</td>
                </tr>
            `;
        }).join('');

        return `
            <!-- Live Activity Notifications -->
            ${this.activity_stream_html('uniform')}

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
                                <th>Sent Qty</th>
                                <th>Received Qty</th>
                                <th>Route</th>
                                <th>Date Sent</th>
                                <th>Date Received (Last)</th>
                                <th>Status</th>
                                <th style="text-align:center;">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows_html || `<tr><td colspan="10" class="of-empty"><i class="fa fa-inbox"></i>No transfers found.</td></tr>`}
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
                    fieldtype: 'HTML',
                    fieldname: 'intro_html',
                    options: `<div style="margin-bottom:6px; font-size:12px; color:var(--text-muted);">
                        ${__('Moves plain stock into embroidery WIP: a Stock Entry transfers the quantity below from your warehouse into the jobber\'s, ready for the embroidered item to come back from it.')}
                    </div>`
                },
                { fieldtype: 'Section Break', label: __('Source (Plain Stock)') },
                {
                    fieldtype: 'Link',
                    fieldname: 'source_item',
                    options: 'Item',
                    label: __('Source Item (Plain)'),
                    reqd: 1,
                    // This dialog only ever moves physical stock (a Stock Entry
                    // under the hood), so non-stock items — 55 of them on this
                    // site — have no business in either Item dropdown here.
                    get_query: () => ({ filters: { is_stock_item: 1 } }),
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
                { fieldtype: 'Column Break' },
                {
                    fieldtype: 'Link',
                    fieldname: 'from_warehouse',
                    options: 'Warehouse',
                    label: __('From Warehouse'),
                    reqd: 1,
                    default: 'VV Puram - IND',
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
                { fieldtype: 'Section Break' },
                {
                    fieldtype: 'HTML',
                    fieldname: 'stock_details_html'
                },
                { fieldtype: 'Section Break', label: __('Destination (Embroidery WIP)') },
                {
                    fieldtype: 'Link',
                    fieldname: 'target_item',
                    options: 'Item',
                    label: __('Target Item (Embroidered)'),
                    reqd: 1,
                    get_query: () => ({ filters: { is_stock_item: 1 } }),
                },
                { fieldtype: 'Column Break' },
                {
                    fieldtype: 'Link',
                    fieldname: 'wip_warehouse',
                    options: 'Warehouse',
                    label: __('WIP Warehouse (Embroiderer)'),
                    reqd: 1,
                    default: 'Jobers Warehouse - IND'
                },
                { fieldtype: 'Section Break', label: __('Quantity to Transfer') },
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
    'Sales Order':            { i: 'check-square-o', c: '#28a745' },
    'Uniform Embroidery Transfer': { i: 'random', c: '#e83e8c' }
};

function flt_of(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

function of_to_title_case(str) {
    if (str === undefined || str === null) return '';
    return str.toString()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

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

function of_status_chip(pct, stage_label, context, docs, draft_docs, stock_invoices) {
    const p = flt_of(pct);
    // On a Direct Bill order the stock leaves on a Sales Invoice with "Update
    // Stock", so there is no Delivery Note to open — point at the invoice that
    // actually moved the goods instead.
    const via_invoice = context === 'delivered'
        && !(docs && docs.length)
        && !!(stock_invoices && stock_invoices.length);
    if (via_invoice) docs = stock_invoices;

    const pill = (cls, label) => {
        let attrs = `class="of-pill ${cls}" style="font-size:10px;padding:2px 6px;display:block;text-align:center;"`;
        if (docs && docs.length > 0) {
            const docs_str = docs.join(',');
            const doctype = (context === 'delivered' && !via_invoice) ? 'Delivery Note' : 'Sales Invoice';
            attrs = `class="of-pill ${cls} of-link-flow" data-doctype="${doctype}" data-docs="${docs_str}" style="font-size:10px;padding:2px 6px;display:block;text-align:center;cursor:pointer;text-decoration:underline;" title="Click to view linked ${doctype}"`;
        }
        return `<span ${attrs}>${of_to_title_case(label)}</span>`;
    };

    if (context === 'delivered') {
        if (p === 0) {
            if (!stage_label) return '<span class="of-val of-val--zero">—</span>';
            const stages_map = {
                'newly_created':   '—',
                'awaiting_stock':  'PO placed',
                'in_jobwork':      'Job Work',
                'in_embroidery':   'Embroidery',
                'stock_received':  'Stock in',
                'draft_pick_list': 'Pick draft',
                'ready_to_deliver':'Ready'
            };
            const label = stages_map[stage_label] || '—';
            if (label === '—') return '<span class="of-val of-val--zero">—</span>';
            return pill('of-pill--wait', label);
        } else if (p < 100) {
            return pill('of-pill--dn', `${p.toFixed(0)}% Del.`);
        } else {
            return pill('of-pill--ready', '✓ Delivered');
        }
    }
    
    if (context === 'billed') {
        if (p === 0) {
            if (stage_label === 'need_to_bill') {
                if (draft_docs && draft_docs.length > 0) {
                    return pill('of-pill--need-bill', 'Inv. Draft');
                }
                return pill('of-pill--need-bill', 'To Bill');
            }
            return '<span class="of-val of-val--zero">—</span>';
        } else if (p < 100) {
            return pill('of-pill--dn', `${p.toFixed(0)}% Billed`);
        } else {
            return pill('of-pill--ready', '✓ Billed');
        }
    }
    
    // Default context (PO received, etc.)
    if (p === 0) {
        return pill('of-pill--wait', 'Not Rcvd');
    } else if (p < 100) {
        return pill('of-pill--dn', `${p.toFixed(0)}% Rcvd`);
    } else {
        return pill('of-pill--ready', 'Fully Rcvd');
    }
}

function of_doc_status(status) {
    if (!status) return '<span class="of-val--zero">—</span>';
    const s = String(status).toLowerCase();
    let kind = 'draft';
    if (/(completed|closed|paid|received|delivered)/.test(s)) kind = 'ready';
    else if (/(overdue|cancelled|return|stopped)/.test(s))    kind = 'blocked';
    else if (/(to deliver|to receive|to bill|partly|pending)/.test(s)) kind = 'wait';
    else if (/(submitted|open|in progress|ordered|transferred)/.test(s)) kind = 'dn';
    return `<span class="of-pill of-pill--${kind}">${of_esc(of_to_title_case(status))}</span>`;
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
