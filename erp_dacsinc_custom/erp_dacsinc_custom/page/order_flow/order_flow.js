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
// The page's filters, remembered per user in this browser across reloads (save_view_prefs).
const OF_PREFS_KEY = 'dac_order_flow_filters';

// The single definition of the tracker stages. The summary tiles, the filter bar
// and its counts all read from here, so a stage can never appear in one place with
// a different label or a stale count.
const OF_STAGES = [
    { key: 'all',              label: 'All Open',           mod: '',          tile: 'info',      hint: 'Total active Sales Orders' },
    { key: 'need_to_bill',     label: 'Dispatched — Invoice Pending', mod: 'bill', tile: 'need-bill', hint: 'Delivery Note submitted (dispatched) — create the Sales Invoice to mark it Delivered' },
    { key: 'draft_pick_list',  label: 'Draft Pick List',    mod: 'draft',     tile: 'draft',     hint: 'Pick List in draft — needs submit' },
    { key: 'ready_to_deliver', label: 'Ready to Dispatch',  mod: 'dn',        tile: 'dn',        hint: 'Pick List submitted — create/submit the Delivery Note (a draft DN = To Be Dispatched)' },
    { key: 'stock_received',   label: 'Stock Arrived',      mod: 'rcpt',      tile: 'rcpt',      hint: 'Receipt done — needs Pick List' },
    { key: 'receipt_draft',    label: 'Receiving (Draft PR)', mod: 'draft',   tile: 'draft',     hint: 'Draft Receipt exists — not posted to stock yet, needs submit' },
    { key: 'in_jobwork',       label: 'In Job Work',        mod: 'jw',        tile: 'jw',        hint: 'Active subcontracting POs' },
    { key: 'in_embroidery',    label: 'Embroidery',         mod: 'emb',       tile: 'emb',       hint: 'Active embroidery work' },
    { key: 'awaiting_stock',   label: 'Awaiting Stock (PO)', mod: 'po',       tile: 'wait',      hint: 'PO active — waiting for supplier receipt' },
    // Not a stage: an order can sit at ANY stage while its raw material is
    // ready to be subcontracted, so this filters on its own row flag
    // (rm_ready_for_sco) rather than on stage_key. See OF_FLAG_STAGES.
    { key: 'rm_ready_for_sco', label: 'RM Ready — Make Subcontract PO', mod: 'jw',      tile: 'jw',        hint: 'This order\'s own raw material is in stock — a Subcontract PO can be raised now' },
    { key: 'newly_created',    label: 'Nothing Raised Yet', mod: 'new',       tile: 'new',       hint: 'Nothing raised yet — waiting for raw material, RM ready for a Subcontract PO, or trade items to buy' },
    { key: 'overdue',          label: 'Overdue',            mod: 'due',       tile: 'bad',       hint: 'Past delivery date' },
    { key: 'completed',        label: 'Completed',          mod: 'ok',        tile: 'ok',        hint: 'Fully delivered and billed, or closed' }
];

// Summary key that holds the count for each stage.
const OF_STAGE_COUNT_KEY = {
    all: 'open_orders', need_to_bill: 'need_to_bill', draft_pick_list: 'draft_pick_list',
    ready_to_deliver: 'ready_to_deliver', stock_received: 'stock_received',
    receipt_draft: 'receipt_draft',
    in_jobwork: 'in_jobwork', in_embroidery: 'in_embroidery',
    awaiting_stock: 'awaiting_stock', newly_created: 'newly_created', overdue: 'overdue',
    rm_ready_for_sco: 'rm_ready_for_sco',
    completed: 'completed'
};

// Filter chips backed by a per-row boolean rather than by stage_key. A stage
// is exclusive (a row has exactly one); these are parallel signals that can be
// true alongside any stage, so they must be matched on the flag itself.
const OF_FLAG_STAGES = { rm_ready_for_sco: 'rm_ready_for_sco' };
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
    // Lists Purchase Orders, receipts and draft supplier bills.
    purchase: { doctypes: ['Purchase Order', 'Purchase Receipt', 'Purchase Invoice'] },
    // Lists subcontract POs, embroidery work orders and their receipts.
    jobwork:  { doctypes: ['Purchase Order', 'Job Work (Subcontract)', 'Embroidery Work Order', 'Subcontracting Receipt'] },
    // Lists customer invoices, supplier bills and jobber bills.
    accounts: { doctypes: ['Sales Invoice', 'Purchase Invoice'] },
    // Lists Sales Orders with a submitted Pick List still waiting on a
    // Delivery Note or Sales Invoice — Pick List submission is what puts an
    // order in this queue, DN/SI creation is what takes it out.
    billing:  { doctypes: ['Pick List', 'Delivery Note', 'Sales Invoice'] },
    // A live inventory report, not a document feed — no notification stream,
    // so this never matches a real event doctype.
    stock:    { doctypes: ['__no_notifications__'] },
    // The Pick Lists themselves are the rows here, so any Pick List event
    // (created, submitted, delivered against) is a real change to this tab.
    picklist: { doctypes: ['Pick List'] },
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
    { key: 'picklist', label: 'Pick Lists',           icon: 'fa-hand-paper-o' },
    { key: 'purchase', label: 'Purchase Flow',        icon: 'fa-shopping-cart' },
    { key: 'jobwork',  label: 'Job Work',             icon: 'fa-cogs' },
    { key: 'stock',    label: 'Stock Tracker',        icon: 'fa-cubes' },
    { key: 'billing',  label: 'Pending DN/SI',         icon: 'fa-truck' },
    { key: 'accounts', label: 'Finance',              icon: 'fa-calculator' },
    { key: 'uniform',  label: 'Embroidery Transfers', icon: 'fa-random' },
    { key: 'logistics', label: 'Logistics',           icon: 'fa-flag-checkered' }
];

// Tab display names, for messages that name the tab being acted on.
const OF_TAB_LABELS = Object.fromEntries(OF_TABS.map(t => [t.key, t.label]));


// Which document types each visible table lists — a change to one of them by another user
// is worth an "update waiting" note (is_relevant_change). '*' = the tab's only table.
const OF_TABLE_DOCTYPES = {
    tracker:  { so: ['Sales Order'], mr: ['Material Request'], fp: ['Embroidery Work Order'], pn: ['Embroidery Work Order'] },
    purchase: { po: ['Purchase Order'], receipt: ['Purchase Receipt', 'Subcontracting Receipt'], bill: ['Purchase Order', 'Purchase Invoice', 'Purchase Receipt'] },
    jobwork:  { po: ['Purchase Order', 'Subcontracting Order'], receipt: ['Purchase Receipt', 'Subcontracting Receipt'],
                fp: ['Embroidery Work Order'], pn: ['Embroidery Work Order'] },
    accounts: { receivables: ['Sales Invoice', 'Payment Entry', 'Journal Entry'], supplier: ['Purchase Invoice', 'Payment Entry', 'Journal Entry'],
                jobber: ['Purchase Invoice', 'Payment Entry', 'Journal Entry'] },
    approval: { '*': ['Sales Order'] },
    picklist: { '*': ['Pick List'] },
    billing:  { '*': ['Delivery Note', 'Sales Invoice', 'Pick List'] },
    uniform:  { '*': ['Uniform Embroidery Transfer'] },
    logistics: { '*': ['Sales Invoice'] },
};

// Toolbar Status filter, per list (order_flow_api._STATUS_SQL has the conditions).
// `closed`: the option finds documents "Open orders" hides, so choosing it switches to "All orders".
const OF_STATUS_OPTIONS = {
    po: [['not_received', 'Not received'], ['partly_received', 'Partly received'], ['fully_received', 'Fully received'],
         ['not_billed', 'Not billed'], ['partly_billed', 'Partly billed'], ['fully_billed', 'Fully billed', 1],
         ['overdue', 'Overdue (past expected date)']],
    receipt: [['to_bill', 'To bill'], ['completed', 'Billed (completed)', 1], ['returns', '↩ Returns (goods sent back)']],
    mr: [['pending', 'Pending (not ordered)'], ['partly_ordered', 'Partly ordered'], ['ordered', 'Fully ordered'],
         ['partly_received', 'Partly received'], ['received', 'Fully received', 1]],
    ewo: [['not_received', 'Nothing received yet'], ['partly_received', 'Partly received'], ['fully_received', 'Fully received', 1]],
    // Credit / Debit Notes are not in the invoice lists any more — they have their own sub-tab (Returns / Notes)
    inv: [['unpaid', 'Unpaid'], ['partly_paid', 'Partly paid'], ['overdue', 'Overdue'], ['paid', 'Paid', 1]],
    pl: [['draft', 'Draft'], ['open', 'Open'], ['partly_delivered', 'Partly delivered'], ['completed', 'Completed', 1]],
    logi: [['lr_missing', 'LR No. missing'], ['signed_missing', 'Signed copy missing', 1], ['lr_done_signed_missing', 'LR done, signed copy missing', 1]],
};

// Each table's own filters, shown beside its All / Draft / Submitted pills (table_filters_html).
// [field, type, arg, label]: 'status' → OF_STATUS_OPTIONS[arg]; 'select' → arg = [[value, label, closed?]];
// 'link' → arg = doctype; 'mirror' → arg = a toolbar control kept as the state holder (hidden);
// 'pos' → the "Show POS documents" switch. Sent as of_tf (order_flow_api._tf) except mirror / pos.
const OF_EWO_STAGE = {
    ewo_fp: [['Sent to Full Piece Jobber', 'Sent to jobber'], ['Received from Full Piece Jobber', 'Received from jobber']],
    ewo_pn: [['Pending Process Start', 'Pending start'], ['Received from Jobber (Internal)', 'Received (internal)'],
             ['Sent to Panel Jobber', 'Sent to panel jobber'], ['Received from Panel Jobber', 'Received from panel jobber'],
             ['Returned to Jobber (Closed)', 'Returned (closed)']],
};
const OF_GOODS = (word) => [['fully', `Fully ${word}`], ['partly', `Partly ${word}`], ['not', `Not ${word}`]];
// Not / Partly / Fully <word>; `closed_fully` when "fully" is something "Open orders" hides.
const OF_TRI = (word, closed_fully) => [['not', `Not ${word}`], ['partly', `Partly ${word}`], ['fully', `Fully ${word}`, closed_fully ? 1 : 0]];
const OF_PO_FILTERS = [['received', 'select', OF_TRI('received'), 'Received'], ['billed', 'select', OF_TRI('billed', true), 'Billed'],
    ['overdue', 'select', [['yes', 'Overdue (past expected date)']], 'Overdue']];
const OF_EWO_FILTERS = (key, jobber_label) => [['received', 'select', OF_TRI('received', true), 'Received'],
    ['stage', 'select', OF_EWO_STAGE[key], 'Stage'], ['supplier', 'link', 'Supplier', jobber_label]];
// Stock Tracker counts for this warehouse by default (the store everything is picked from).
const OF_MAIN_WAREHOUSE = 'VV Puram - IND';

const OF_TABLE_FILTERS = {
    'approval': [['approval_stage', 'mirror', '#of-approval-stage', 'Approval stage'], ['merchandiser', 'mirror', '#of-merchandiser', 'Merchandiser'], ['customer', 'link', 'Customer']],
    'tracker.so': [['merchandiser', 'mirror', '#of-merchandiser', 'Merchandiser'], ['industry', 'mirror', '#of-tracker-industry', 'Industry'],
        ['delivery', 'select', [['not', 'Not dispatched'], ['partly', 'Partly dispatched'], ['fully', 'Fully dispatched', 1]], 'Dispatch'],
        ['customer', 'link', 'Customer']],
    'tracker.mr': [['ordered', 'select', OF_TRI('ordered'), 'Ordered'], ['received', 'select', OF_TRI('received', true), 'Received'],
        ['type', 'select', [['purchase', 'Purchase'], ['transfer', 'Material Transfer']], 'Type'],
        ['customer', 'link', 'Customer'], ['pos', 'pos']],
    'tracker.ewo_fp': OF_EWO_FILTERS('ewo_fp', 'Jobber').concat([['customer', 'link', 'Customer']]),
    'tracker.ewo_pn': OF_EWO_FILTERS('ewo_pn', 'Jobber').concat([['customer', 'link', 'Customer']]),
    'picklist': [['status', 'status', 'pl', 'Status'], ['customer', 'link', 'Customer'], ['item', 'link', 'Item']],
    'purchase.po': OF_PO_FILTERS.concat([['supplier', 'link', 'Supplier'], ['customer', 'link', 'Customer']]),
    'purchase.receipt': [['status', 'status', 'receipt', 'Billing'], ['supplier', 'link', 'Supplier']],
    'purchase.bill': [['supplier', 'link', 'Supplier']],
    'jobwork.po': OF_PO_FILTERS.concat([['sco', 'select', [['has', 'Made'], ['missing', 'Not made']], 'Subcontracting order'],
        ['supplier', 'link', 'Supplier', 'Jobber']]),
    'jobwork.receipt': [['status', 'status', 'receipt', 'Billing'], ['supplier', 'link', 'Supplier', 'Jobber']],
    'jobwork.ewo_fp': OF_EWO_FILTERS('ewo_fp', 'Jobber'),
    'jobwork.ewo_pn': OF_EWO_FILTERS('ewo_pn', 'Jobber'),
    'stock': [['warehouse', 'mirror', '#of-stock-warehouse', 'Warehouse'], ['stock', 'select', [['in', 'In stock'], ['out', 'No stock']], 'Stock']],
    // "Waiting for invoice" is on by default (the empty value): only orders with delivered qty not
    // yet invoiced, fully or partly; "All orders" shows the whole queue (order_flow_api.get_billing_flow).
    'billing': [['invoice', 'select', [['all', 'All orders']], 'Waiting for invoice', 'Yes (incl. partly invoiced)'],
        ['stage', 'select', [['deliver', 'Ready for Delivery Note'], ['bill', 'Needs invoice']], 'Stage'], ['customer', 'link', 'Customer']],
    'accounts.receivables': [['status', 'status', 'inv', 'Payment'], ['goods', 'select', OF_GOODS('delivered'), 'Delivery'],
        ['customer', 'link', 'Customer'], ['pos', 'pos']],
    'accounts.supplier': [['status', 'status', 'inv', 'Payment'], ['goods', 'select', OF_GOODS('received'), 'Receipt'], ['supplier', 'link', 'Supplier']],
    'accounts.jobber': [['status', 'status', 'inv', 'Payment'], ['goods', 'select', OF_GOODS('received'), 'Receipt'], ['supplier', 'link', 'Supplier', 'Jobber']],
    // Finance › Returns / Notes (order_flow_api._accounts_notes)
    // Type (kind) is chosen with the Credit / Debit Notes buttons above the table (of_notes_kind_bar)
    'accounts.notes': [['next', 'select', [['refund', 'Credit / refund pending'], ['draft', 'Draft — to submit'], ['settled', 'Settled', 1]], 'Status'],
        ['party', 'link', 'Customer', 'Customer / Supplier']],
    'uniform': [['status', 'mirror', '#of-uniform-status', 'Status']],
    'logistics': [['lr', 'select', [['missing', 'LR No. missing'], ['filled', 'LR No. filled', 1]], 'LR No.'],
        ['signed', 'select', [['missing', 'Signed copy missing'], ['uploaded', 'Signed copy uploaded', 1]], 'Signed copy'],
        ['customer', 'link', 'Customer'], ['supplier', 'link', 'Supplier', 'Transporter'], ['pos', 'pos']],
};

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
        this.tracker_subtab = 'so'; // 'so' | 'mr' | 'fp' | 'pn'
        this.pur_subtab = 'po'; // 'po' | 'receipt' | 'bill'
        this.job_subtab = 'po'; // 'po' | 'receipt'
        this.acc_subtab = 'receivables'; // 'receivables' | 'supplier' | 'jobber'
        this.approval_subtab = 'merchandiser'; // 'merchandiser' | 'unassigned' | 'final'
        this.perms = null;   // filled from the server; gates the final-approval tab + tab visibility
        this.days = 120;
        this.table_filters = {}; // each table's own filters: {"<tab>.<table>": {field: value}} — OF_TABLE_FILTERS
        this.tf_options = {};    // each table's dropdown values from the server (filter_options)
        this.scope = 'open';
        this.stage_filter = 'all';
        this.search = '';
        this.merchandiser_filter = '';
        this.approval_stage_filter = '';
        this.uniform_status_filter = ''; // Embroidery Transfers tab only — see #of-uniform-status
        this.stock_warehouse_filter = OF_MAIN_WAREHOUSE; // Stock Tracker: counts for the main warehouse unless another is chosen
        this.tracker_industry_filter = ''; // Sales Tracker's SO subtab only — see #of-tracker-industry
        this.approval_rejected_stage_filter = ''; // SO Approvals' Rejected Orders sub-tab only — 'merchandiser' | 'final'

        // Draft/Submitted filter-pill state, per tab + sub-list — '' means
        // "All" (both mixed together, same as before this filter existed).
        // Keyed exactly like the server's own <sublist>_docstatus args (see
        // build_docstatus_args) so there is only one name per concept.
        this.docstatus_filter = {
            purchase: { po: '', receipt: '' },
            jobwork: { po: '', receipt: '', ewo_fp: '', ewo_pn: '' },
            tracker: { mr: '', ewo_fp: '', ewo_pn: '' },
            accounts: { sales: '', supplier: '', jobber: '', notes: '' },
        };

        // Per-tab pagination state. A tab whose data is one list (stock,
        // billing, approval, uniform) tracks a single {page, page_size};
        // a tab whose response carries several independently-paginated sub-lists
        // (tracker: so/mr; purchase: po/receipt/bill; jobwork: po/receipt/ewo;
        // accounts: sales/supplier/jobber) tracks one such object per sub-list,
        // keyed the same way the server's response is — see build_pagination_args/reset_all_pagination below.
        this.pagination = {
            tracker: {
                so: { page: 1, page_size: 100 },
                mr: { page: 1, page_size: 100 },
                ewo_fp: { page: 1, page_size: 100 },
                ewo_pn: { page: 1, page_size: 100 },
            },
            purchase: {
                po: { page: 1, page_size: 100 },
                receipt: { page: 1, page_size: 100 },
                bill: { page: 1, page_size: 100 },
            },
            jobwork: {
                po: { page: 1, page_size: 100 },
                receipt: { page: 1, page_size: 100 },
                ewo_fp: { page: 1, page_size: 100 },
                ewo_pn: { page: 1, page_size: 100 },
            },
            stock: { page: 1, page_size: 100 },
            picklist: { page: 1, page_size: 100 },
            billing: { page: 1, page_size: 100 },
            accounts: {
                sales: { page: 1, page_size: 100 },
                supplier: { page: 1, page_size: 100 },
                jobber: { page: 1, page_size: 100 },
                notes: { page: 1, page_size: 100 },
            },
            approval: { page: 1, page_size: 100 },
            uniform: { page: 1, page_size: 100 },
            logistics: { page: 1, page_size: 100 },
        };

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
                    setTimeout(() => this.update_my_customers_toggle(), 0);
                    if (!this.allowed_tabs.length) {
                        this.render_no_access();
                        return;
                    }

                    // Sub-tabs the user may see ({tab: [keys]}, from Admin Settings ›
                    // Sub-tab Visibility). Start each tab on an allowed sub-tab so a
                    // forbidden one is never loaded, then keep hiding forbidden buttons
                    // whenever a panel redraws.
                    this.allowed_subtabs = this.perms.allowed_subtabs || {};
                    const first_ok = (tab, cur) => {
                        const ok = this.allowed_subtabs[tab];
                        return (!ok || !ok.length || of_subtab_ok(tab, cur, ok)) ? cur : ok[0];
                    };
                    this.load_view_prefs();
                    this.tracker_subtab = first_ok('tracker', this.tracker_subtab);
                    this.pur_subtab = first_ok('purchase', this.pur_subtab);
                    this.job_subtab = first_ok('jobwork', this.job_subtab);
                    this.acc_subtab = first_ok('accounts', this.acc_subtab);
                    this.approval_subtab = first_ok('approval', this.approval_subtab);

                    this.render_shell();
                    this.bind();
                    this.apply_view_prefs_to_controls();
                    this.watch_subtab_perms();

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
                // Coming back to the page is not "another user changed something": refresh
                // quietly when nothing is open, otherwise leave the screen as it is.
                if (this.active && !this.is_busy()) this.refresh(true);
            }
        });

        // True real-time: every doctype that feeds this dashboard (Sales
        // Order, Material Request, Purchase Order, Purchase Receipt, Pick
        // List, Delivery Note, Sales Invoice, Purchase Invoice,
        // Subcontracting Order/Receipt, Embroidery Work Order, Uniform
        // Embroidery Transfer — see hooks.py's doc_events) calls
        // order_flow_api.broadcast_order_flow_change on save/submit/cancel,
        // which publishes this event to every connected Desk user. So
        // ANYONE's change — not just this session's own actions, and not
        // just ones that happened to open a new tab or navigate away —
        // reaches every open dashboard without a manual reload. Debounced
        // rather than throttled: a single user action can cascade into
        // several of these documents changing in quick succession (e.g.
        // creating a DN from a Pick List touches both), and those should
        // coalesce into one refresh, not one per document.
        //
        // Several people use this page at once, so another user's change must not
        // redraw the screen under someone who is working: queue_background_refresh
        // holds it while a row or prompt is open, the user is typing, or used the page
        // in the last few seconds, and shows "Updates waiting — Refresh" instead.
        let realtime_refresh_timer = null;
        let realtime_payloads = [];
        frappe.realtime.on('order_flow_changed', (payload) => {
            realtime_payloads.push(payload || null);
            clearTimeout(realtime_refresh_timer);
            realtime_refresh_timer = setTimeout(() => {
                const batch = realtime_payloads; realtime_payloads = [];
                const relevant = batch.filter(p => this.is_relevant_change(p));
                if (relevant.length) this.queue_background_refresh(relevant);
            }, 1200);
        });

        // Any use of the page counts as "working" for a few seconds (see is_busy).
        this.last_interaction = 0;
        this.$body.on('mousedown keydown input wheel touchstart', () => { this.last_interaction = Date.now(); });
        this.$body.on('click', '#of-update-apply', () => this.refresh(true));
        // Apply waiting updates by themselves once the user is no longer working.
        setInterval(() => {
            if (this.pending_updates && !this.is_busy() && !document.hidden) this.refresh(true);
        }, 5000);
    }

    // Whether the session user may see `tab`, per the permissions fetched
    // at boot. Used both to decide what render_shell() draws and as a
    // backstop inside switch_tab() for every caller, not just the tab
    // strip's own click handler.
    can_see(tab) {
        return !!(this.perms && this.perms.tabs && this.perms.tabs[tab]);
    }

    // May the user ACT from this tab / sub-tab (create, submit, approve…), not just
    // view it? The access sheet's "A" vs "✓" — Admin Settings › Tab / Sub-tab Actions
    // (order_flow_permissions.can_act_tab; guard_act checks the same on the server).
    // Draft rows get a "Submit" button (dashboard_submit.py): the row's toggle / row carries
    // data-docstatus, and the document is the receipt / embroidery row's own (data-submit-*)
    // or the toggle's. Only doctypes the user may submit; view-only users lose it in
    // strip_view_only_tab_actions like every other action.
    add_submit_buttons() {
        const can = (dt) => (frappe.model.can_submit ? frappe.model.can_submit(dt)
            : ((frappe.boot.user && frappe.boot.user.can_submit) || []).includes(dt));
        this.$body.find('[data-docstatus="0"]').each((i, el) => {
            const $el = $(el);
            const doctype = $el.attr('data-submit-doctype') || $el.attr('data-doctype');
            const name = $el.attr('data-submit-name') || $el.attr('data-docname');
            if (!doctype || !name || !OF_DASHBOARD_SUBMITTABLE.includes(doctype) || !can(doctype)) return;
            // Same act rule as strip_view_only_tab_actions (else the two would undo each other).
            const $panel = $el.closest('[id^="of-panel-"]');
            const tab = $panel.length ? $panel.attr('id').slice('of-panel-'.length) : null;
            const prefix = { tracker: 'of-tracker-sec', purchase: 'of-pur-sec', jobwork: 'of-job-sec', accounts: 'of-acc-sec' }[tab];
            const $sec = prefix ? $el.closest(`[id^="${prefix}-"]`) : $();
            if (!tab || !this.can_act(tab, $sec.length ? $sec.attr('id').slice(prefix.length + 1) : undefined)) return;
            const $tr = $el.is('tr') ? $el : $el.closest('tr');
            const $cell = $tr.children('td').last();
            if (!$cell.length || $cell.find('.of-submit-draft-btn').length) return;
            const $btn = $(`<button class="of-btn of-btn--warning of-submit-draft-btn" title="${__('Submit this draft')}">
                <i class="fa fa-check-square-o"></i> ${__('Submit')}</button>`)
                .attr('data-doctype', doctype).attr('data-name', name);
            const $wrap = $cell.find('.of-po-actions, .of-ewo-actions').first();
            ($wrap.length ? $wrap : $cell).prepend($btn);
        });
    }

    // ── Several users at once ─────────────────────────────────────
    // Is the user in the middle of something the redraw would disturb?
    is_busy() {
        if (Date.now() - (this.last_interaction || 0) < 15000) return true;
        if ($('.modal.show:visible, .modal.in:visible').length) return true;
        const a = document.activeElement;
        if (a && this.$body[0].contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
        const $p = this.$body.find(`#of-panel-${this.active}`);
        return $p.find('tr.of-so-details-row:visible, tr.of-doc-items-row:visible, tr.of-ewo-items-row:visible').length > 0;
    }

    // Does another user's change touch the table on screen? Own changes never count (the
    // action that made them refreshes the screen). A change counts when its document type is what
    // the visible table lists (OF_TABLE_DOCTYPES), or it belongs to a Sales Order shown on it.
    is_relevant_change(p) {
        if (!p || !p.doctype) return true;
        if (p.user && p.user === frappe.session.user) return false;
        const sub = { tracker: this.tracker_subtab, purchase: this.pur_subtab, jobwork: this.job_subtab, accounts: this.acc_subtab }[this.active];
        const map = OF_TABLE_DOCTYPES[this.active];
        const doctypes = map ? (map[sub || ''] || map['*']) : (OF_TAB_FILTERS[this.active] || {}).doctypes;
        if (doctypes && doctypes.includes(p.doctype)) return true;
        const $p = this.$body.find(`#of-panel-${this.active}`);
        const shown = new Set($p.find('[data-so]:visible').map((i, el) => String($(el).data('so'))).get());
        if ((p.sales_orders || []).some(so => shown.has(so))) return true;
        return !!(p.name && $p.find(':visible').filter((i, el) => el.textContent === p.name).length);
    }

    // Another user's change (or the browser tab regaining focus): refresh now when
    // the user isn't working, otherwise hold it and show the bar.
    queue_background_refresh(payloads) {
        if (!this.active) return;
        if (!this.is_busy()) { this.refresh(true); return; }
        this.pending_updates = (this.pending_updates || 0) + ((payloads && payloads.length) || 1);
        const n = this.pending_updates;
        this.$body.find('#of-update-text').text(n === 1
            ? __('1 update waiting (another user changed something).')
            : __('{0} updates waiting (other users changed things).', [n]));
        this.$body.find('#of-update-bar').removeClass('of-hidden');
    }

    clear_pending_updates() {
        this.pending_updates = 0;
        this.$body.find('#of-update-bar').addClass('of-hidden');
    }

    // paint() replaces the whole panel. Record what is open (and the scroll) right
    // now, repaint, then reopen the same rows with fresh data — the old content is
    // shown in the reopened row until the new arrives, so nothing collapses or jumps.
    paint_keeping_view(data) {
        const state = this.capture_view_state();
        this.paint(data);
        this.restore_view_state(state);
    }

    capture_view_state() {
        const $p = this.$body.find(`#of-panel-${this.active}`);
        const open = [];
        const take = (main_sel, detail_sel, kind, key_of) => {
            $p.find(main_sel).each((i, el) => {
                const $row = $(el), $d = $row.next(detail_sel);
                if ($d.length && $d.is(':visible')) open.push({ kind, key: key_of($row), html: $d.children('td').html() });
            });
        };
        take('tr.of-row-main', '.of-so-details-row', 'so', $r => String($r.data('so')));
        take('tr.of-doc-row', '.of-doc-items-row', 'doc', $r => { const b = $r.find('.of-doc-items-toggle'); return `${b.data('doctype')}::${b.data('docname')}`; });
        take('tr.of-ewo-row', '.of-ewo-items-row', 'ewo', $r => String($r.find('.of-ewo-items-toggle').data('ewo')));
        take('tr.of-transfer-row', '.of-doc-items-row', 'transfer', $r => String($r.find('.of-transfer-receipts-toggle').data('id')));
        take('tr.of-stock-row', '.of-doc-items-row', 'stock', $r => String($r.find('.of-stock-wh-toggle').data('item')));
        return { open, scroll: window.scrollY };
    }

    restore_view_state(state) {
        if (!state) return;
        const $p = this.$body.find(`#of-panel-${this.active}`);
        const find = (main_sel, key_of, key) => $p.find(main_sel).filter((i, el) => key_of($(el)) === key).first();
        state.open.forEach(o => {
            let $row, detail_sel;
            if (o.kind === 'so') {
                $row = find('tr.of-row-main', $r => String($r.data('so')), o.key);
                if (!$row.length) return;
                this.toggle_so_details(o.key, $row.find('.of-so-toggle'));
                detail_sel = '.of-so-details-row';
            } else if (o.kind === 'doc') {
                $row = find('tr.of-doc-row', $r => { const b = $r.find('.of-doc-items-toggle'); return `${b.data('doctype')}::${b.data('docname')}`; }, o.key);
                if (!$row.length) return;
                const $b = $row.find('.of-doc-items-toggle');
                this.toggle_doc_items_row($row, $b.data('doctype'), $b.data('docname'), $b);
                detail_sel = '.of-doc-items-row';
            } else if (o.kind === 'ewo') {
                $row = find('tr.of-ewo-row', $r => String($r.find('.of-ewo-items-toggle').data('ewo')), o.key);
                if (!$row.length) return;
                this.toggle_ewo_items_row($row, o.key, $row.find('.of-ewo-items-toggle'));
                detail_sel = '.of-ewo-items-row';
            } else if (o.kind === 'transfer') {
                $row = find('tr.of-transfer-row', $r => String($r.find('.of-transfer-receipts-toggle').data('id')), o.key);
                if (!$row.length) return;
                this.toggle_transfer_receipts_row($row, o.key, $row.find('.of-transfer-receipts-toggle'));
                detail_sel = '.of-doc-items-row';
            } else if (o.kind === 'stock') {
                $row = find('tr.of-stock-row', $r => String($r.find('.of-stock-wh-toggle').data('item')), o.key);
                if (!$row.length) return;
                this.toggle_stock_wh_row($row, o.key, $row.find('.of-stock-wh-toggle'));
                return; // built from the fresh row data straight away
            }
            // Old content until the fresh fetch (already started by the toggle) replaces it.
            const $d = $row.next(detail_sel);
            const $holder = $d.find(o.kind === 'so' ? '.of-so-items-container' : '.of-doc-items-panel, .of-ewo-items-panel').first();
            const $old = $('<div>').html(o.html).find(o.kind === 'so' ? '.of-so-items-container' : '.of-doc-items-panel, .of-ewo-items-panel').first();
            if ($holder.length && $old.length && $holder.find('.of-empty .fa-spinner').length) $holder.html($old.html());
        });
        window.scrollTo(0, state.scroll);
    }

    // The "Custom range…" picker: one Frappe DateRange control (pick first day, then last) that
    // writes the two hidden dates and fires their change → apply_date_range, as the two date
    // boxes did.
    mount_date_range() {
        const $wrap = this.$body.find('#of-daterange .of-daterange__pick');
        const $from = this.$body.find('#of-date-from'), $to = this.$body.find('#of-date-to');
        if (!$wrap.length) return;
        if (!this._date_range_ctrl) {
            const ctrl = frappe.ui.form.make_control({
                parent: $wrap,
                df: {
                    fieldtype: 'DateRange', fieldname: 'of_between', placeholder: __('From – To'),
                    onchange: () => {
                        const v = ctrl.get_value();
                        if (!Array.isArray(v) || !v[0] || !v[1]) return;
                        if (v[0] === $from.val() && v[1] === $to.val()) return;
                        $from.val(v[0]); $to.val(v[1]).trigger('change');
                    },
                },
                render_input: true, only_input: true,
            });
            this._date_range_ctrl = ctrl;
        }
        if ($from.val() && $to.val()) this._date_range_ctrl.set_value([$from.val(), $to.val()]);
    }

    // Custom range: both dates set → every tab gets days="from~to" (order_flow_api._date_range).
    apply_date_range() {
        const from = this.$body.find('#of-date-from').val(), to = this.$body.find('#of-date-to').val();
        if (!from || !to) return;
        this.days = `${from}~${to}`;
        this.reset_all_pagination();
        this.refresh(true);
    }

    // Every table's dropdown values arrive on its data as filter_options {"list": key, field: [[value, label]]}.
    collect_filter_options(data) {
        const walk = (x, depth) => {
            if (!x || typeof x !== 'object' || depth > 4) return;
            if (Array.isArray(x)) return;
            if (x.filter_options && x.filter_options.list) this.tf_options[x.filter_options.list] = x.filter_options;
            Object.keys(x).forEach(k => { if (k !== 'rows' && k !== 'filter_options') walk(x[k], depth + 1); });
        };
        walk(data, 0);
    }

    set_table_filter(key, field, value) {
        const f = (this.table_filters[key] = this.table_filters[key] || {});
        if ((f[field] || '') === (value || '')) return;
        if (value) f[field] = value; else delete f[field];
        this.reset_all_pagination();
        this.refresh(true);
    }

    tf_def(key, field) {
        return (OF_TABLE_FILTERS[key] || []).find(d => d[0] === field);
    }

    // The filter controls for one table: a full-width strip under the table's title (moved out
    // of the title row by mount_table_filters). Each control is captioned — "Received │ All ▾" —
    // so the filter's name is never mistaken for a chosen value.
    table_filters_html(key) {
        const defs = OF_TABLE_FILTERS[key] || [];
        if (!defs.length) return '';
        const vals = this.table_filters[key] || {};
        let any = Object.keys(vals).length > 0;
        const field_html = (cap, inner, set, extra) =>
            `<label class="of-tf-field${set ? ' is-set' : ''}${extra ? ' ' + extra : ''}"><span class="of-tf-cap">${cap}</span>${inner}</label>`;
        const parts = defs.map(([field, type, arg, label, default_label]) => {
            if (type === 'status' || type === 'select') {
                const opts = type === 'status' ? (OF_STATUS_OPTIONS[arg] || []) : arg;
                const cur = vals[field] || '';
                // default_label: what the empty value means when it is not "All" (a filter on by default)
                return field_html(__(label || 'Status'), `<select class="of-tf-select" data-list="${key}" data-f="${field}">
                    <option value="">${__(default_label || 'All')}</option>
                    ${opts.map(o => `<option value="${of_esc(o[0])}"${o[0] === cur ? ' selected' : ''}>${__(o[1])}</option>`).join('')}</select>`, !!cur);
            }
            if (type === 'link') {
                const raw = (this.tf_options[key] || {})[field];
                if (Array.isArray(raw)) {   // search box over the parties actually in this table
                    const opts = of_tf_merged(raw);
                    const cur = vals[field] || '';
                    const shown = cur ? of_tf_label(raw, cur) : '';
                    return field_html(__(label || arg), `<span class="of-tf-combo" data-list="${key}" data-f="${field}">
                        <input type="text" class="of-tf-combo-input" autocomplete="off" value="${of_esc(shown)}"
                               placeholder="${of_esc(__('All ({0}) — type to search', [opts.length]))}">
                        ${cur ? `<i class="fa fa-times of-tf-combo-x" title="${__('Clear')}"></i>` : '<i class="fa fa-search of-tf-combo-ic"></i>'}
                    </span>`, !!cur, 'of-tf-field--link');
                }
                return field_html(__(label || arg), `<span class="of-tf-link" data-list="${key}" data-f="${field}" data-doctype="${arg}" data-label="${of_esc(__('Any'))}"></span>`, !!vals[field], 'of-tf-field--link');
            }
            if (type === 'mirror') {
                const $t = this.$body.find(arg);
                if (!$t.length) return '';
                if (arg === '#of-merchandiser' && !this.merch_filter_allowed()) return '';
                const cur = $t.val() || '';
                const is_default = arg === '#of-stock-warehouse' && cur === OF_MAIN_WAREHOUSE;   // the default is not a filter
                if (cur && !is_default) any = true;
                return field_html(__(label || ''), `<select class="of-tf-mirror" data-target="${arg}">${of_mirror_options($t)}</select>`, !!cur && !is_default);
            }
            if (type === 'pos') {
                const on = !!(this.perms && this.perms.show_pos_docs);
                return field_html(__('POS documents'), `<span class="of-tf-checkwrap"><input type="checkbox" class="of-tf-pos"${on ? ' checked' : ''}> ${__('Show')}</span>`, on);
            }
            return '';
        }).join('');
        return `<div class="of-tf-row" data-list="${key}">${parts}${any
            ? `<a href="#" class="of-tf-clear" data-list="${key}" title="${__('Clear the filters of this table')}"><i class="fa fa-times"></i> ${__('Clear filters')}</a>` : ''}</div>`;
    }

    merch_filter_allowed() {
        const can_final = !!(this.perms && this.perms.is_final_approver);
        return can_final || frappe.user_roles.includes('System Manager') || frappe.session.user === 'Administrator';
    }

    // Mount the Link boxes (Customer / Supplier / Warehouse…) of the table filters, and keep
    // mirrored selects in step with their toolbar control (its options load asynchronously).
    mount_table_filters() {
        // A strip rendered inside a title row goes right under it, full width.
        this.$body.find('.of-card__head .of-tf-row').each((i, el) => {
            const $row = $(el);
            $row.closest('.of-card__head').after($row);
        });
        // Title row + filter strip in one wrapper, so (on Finance) they stay in view while scrolling.
        this.$body.find('.of-tf-row').each((i, el) => {
            const $row = $(el), $head = $row.prev('.of-card__head');
            if ($head.length && !$head.parent().hasClass('of-card__sticky')) {
                $head.add($row).wrapAll('<div class="of-card__sticky"></div>');
            }
        });
        this.$body.find('.of-tf-link:not(.is-mounted)').each((i, el) => {
            const $w = $(el).addClass('is-mounted');
            const key = $w.data('list'), field = $w.data('f');
            const ctrl = frappe.ui.form.make_control({
                parent: $w,
                df: {
                    fieldtype: 'Link', options: $w.data('doctype'), fieldname: `tf_${field}`, placeholder: $w.data('label'),
                    onchange: () => {
                        if (!$w[0].isConnected) return;   // replaced by a redraw, not a user change
                        const v = ctrl.get_value() || '';
                        const f = (this.table_filters[key] = this.table_filters[key] || {});
                        if (v === (f[field] || '')) return;
                        if (v) f[field] = v; else delete f[field];
                        this.reset_all_pagination();
                        this.refresh(true);
                    },
                },
                render_input: true, only_input: true,
            });
            const cur = (this.table_filters[key] || {})[field];
            if (cur) { ctrl.value = cur; ctrl.$input && ctrl.$input.val(cur); }
            ctrl.$input && ctrl.$input.attr('title', $w.data('label'));
        });
        this.$body.find('.of-tf-mirror').each((i, el) => {
            const $m = $(el), $t = this.$body.find($m.data('target'));
            if ($t.length && $m.children().length !== $t.children().length) {
                const v = $t.val(); $m.html(of_mirror_options($t)).val(v);
            }
        });
    }

    // ── Filters remembered across reloads (per user, this browser) ──
    // Every filter change runs refresh(), which saves; sub-tab clicks save too (fit_tables'
    // click hook). Restored before the first paint; stale values simply match nothing.
    view_prefs_key() {
        return `${OF_PREFS_KEY}:${frappe.session.user}`;
    }

    save_view_prefs() {
        try {
            localStorage.setItem(this.view_prefs_key(), JSON.stringify({
                days: this.days, scope: this.scope, search: this.search, stage_filter: this.stage_filter,
                date_from: this.$body.find('#of-date-from').val() || '', date_to: this.$body.find('#of-date-to').val() || '',
                table_filters: this.table_filters, docstatus_filter: this.docstatus_filter,
                merchandiser_filter: this.merchandiser_filter, approval_stage_filter: this.approval_stage_filter,
                uniform_status_filter: this.uniform_status_filter, stock_warehouse_filter: this.stock_warehouse_filter,
                tracker_industry_filter: this.tracker_industry_filter,
                tracker_subtab: this.tracker_subtab, pur_subtab: this.pur_subtab, job_subtab: this.job_subtab,
                acc_subtab: this.acc_subtab, approval_subtab: this.approval_subtab,
            }));
        } catch (e) { /* storage full / blocked: the page just won't remember */ }
    }

    load_view_prefs() {
        let p = null;
        try { p = JSON.parse(localStorage.getItem(this.view_prefs_key()) || 'null'); } catch (e) { p = null; }
        if (!p || typeof p !== 'object') return;
        const str = (v) => (typeof v === 'string' ? v : '');
        if (p.days !== undefined && p.days !== null && p.days !== '') this.days = p.days;
        if (['open', 'all', 'mine'].includes(p.scope)) this.scope = p.scope;
        this.search = str(p.search);
        if (str(p.stage_filter)) this.stage_filter = p.stage_filter;
        if (p.table_filters && typeof p.table_filters === 'object') this.table_filters = p.table_filters;
        if (p.docstatus_filter && typeof p.docstatus_filter === 'object') {
            Object.keys(this.docstatus_filter).forEach(t => Object.assign(this.docstatus_filter[t], p.docstatus_filter[t] || {}));
        }
        ['merchandiser_filter', 'approval_stage_filter', 'uniform_status_filter', 'tracker_industry_filter'].forEach(k => { this[k] = str(p[k]); });
        if (p.stock_warehouse_filter !== undefined) this.stock_warehouse_filter = str(p.stock_warehouse_filter);
        ['tracker_subtab', 'pur_subtab', 'job_subtab', 'acc_subtab', 'approval_subtab'].forEach(k => { if (str(p[k])) this[k] = p[k]; });
        this._prefs_dates = { from: str(p.date_from), to: str(p.date_to) };
    }

    // Put the restored values back into the controls (render_shell draws them at their defaults).
    apply_view_prefs_to_controls() {
        const $b = this.$body;
        $b.find('#of-search').val(this.search || '');
        $b.find('#of-scope').val(this.scope);
        const custom = String(this.days).includes('~');
        $b.find('#of-days').val(custom ? 'custom' : String(this.days));
        if (custom) {
            const [from, to] = String(this.days).split('~');
            $b.find('#of-date-from').val(from); $b.find('#of-date-to').val(to);
            $b.find('#of-daterange').show();
            this.mount_date_range();
        } else if (this._prefs_dates) {
            $b.find('#of-date-from').val(this._prefs_dates.from); $b.find('#of-date-to').val(this._prefs_dates.to);
        }
        if (!$b.find('#of-days').val()) { $b.find('#of-days').val('120'); this.days = 120; }   // an old option
        $b.find('#of-approval-stage').val(this.approval_stage_filter || '');
        $b.find('#of-uniform-status').val(this.uniform_status_filter || '');
        $b.find('.of-stage-btn').removeClass('is-active').filter(`[data-stage="${this.stage_filter}"]`).addClass('is-active');
        if (!$b.find('.of-stage-btn.is-active').length) {
            this.stage_filter = 'all';
            $b.find('.of-stage-btn[data-stage="all"]').addClass('is-active');
        }
    }

    // UI only: the controls that narrow the whole tab — search, Open / All, Last N days (custom
    // range), "Show my customers' orders" and, on Sales Tracker › Sales Orders, the stage chips —
    // sit in the visible table's filter bar, right above it and sticky with it, instead of the top
    // toolbar. The same elements are moved (ids and delegated handlers unchanged), so what they
    // do is unchanged. Moved back to the toolbar dock before every redraw (panel.html would
    // destroy them) and placed again after it. A tab with no filter bar keeps them in the toolbar.
    shared_control_els() {
        return ['.of-toolbar .of-search, .of-tf-row .of-search', '#of-scope', '#of-days', '#of-daterange', '#of-my-customers']
            .map(sel => this.$body.find(sel)[0]).filter(Boolean);
    }

    park_shared_controls() {
        const active = document.activeElement;
        const focus = active && active.id === 'of-search'
            ? { start: active.selectionStart, end: active.selectionEnd } : null;
        const $dock = this.$body.find('#of-shared-dock');
        if (!$dock.length) return focus;
        let at = $dock[0];
        this.shared_control_els().forEach(el => {
            if (el.parentNode !== at.parentNode || el.previousSibling !== at) at.after(el);
            at = el;
        });
        const $bar = this.$body.find('#of-stage-bar');
        const $panel = this.$body.find('#of-panel-tracker');
        if ($bar.length && $panel.length && !$bar.next().is($panel)) $bar.insertBefore($panel);
        return focus;
    }

    place_shared_controls(focus) {
        const active = document.activeElement;
        if (!focus && active && active.id === 'of-search') focus = { start: active.selectionStart, end: active.selectionEnd };
        const $panel = this.$body.find(`#of-panel-${this.active}`);
        const sticky = $panel.find('.of-card__sticky').toArray().find(el => el.offsetParent && $(el).children('.of-tf-row').length);
        const $toolbar = this.$body.find('.of-toolbar');
        if (!sticky) {
            this.park_shared_controls();
            // Shown in the toolbar only for a drawn tab that has no filter bar — not while a tab
            // is still loading (they would flash there, then jump into the table's bar).
            const drawn = $panel.find('.of-card').length && !$panel.find('.of-empty .fa-spinner').length;
            $toolbar.toggleClass('of-shared-in-toolbar', !!drawn);
            return;
        }
        $toolbar.removeClass('of-shared-in-toolbar');
        const row = $(sticky).children('.of-tf-row')[0];
        let at = null;
        this.shared_control_els().forEach(el => {
            if (at ? el.previousSibling !== at : row.firstChild !== el) {
                if (at) at.after(el); else row.prepend(el);
            }
            at = el;
        });
        // Stage chips: under the Sales Orders title, above its filter bar; they wrap (nothing
        // to scroll), and stages with no orders fold behind "+N more".
        const $bar = this.$body.find('#of-stage-bar');
        if ($bar.length) {
            const so_sticky = this.active === 'tracker'
                ? $panel.find('.of-tf-row[data-list="tracker.so"]').parent('.of-card__sticky')[0] : null;
            if (so_sticky) {
                if ($bar.parent()[0] !== so_sticky || !$bar.next().hasClass('of-tf-row')) {
                    $(so_sticky).children('.of-tf-row').before($bar);
                }
            } else if (!$bar.next().is($('#of-panel-tracker'))) {
                $bar.insertBefore(this.$body.find('#of-panel-tracker'));
            }
        }
        if (focus) {
            const inp = this.$body.find('#of-search')[0];
            if (inp && document.activeElement !== inp) {
                inp.focus();
                try { inp.setSelectionRange(focus.start, focus.end); } catch (e) { /* type=search */ }
            }
        }
    }

    // Phone: a table's filter strip folds behind a "Filters (n)" button in its title row, so the
    // table is in view without scrolling past a column of filters. Open / closed is kept per
    // table across redraws (this.tf_open). Hidden above 768px (CSS), where the strip always shows.
    add_filter_toggles() {
        this.tf_open = this.tf_open || {};
        this.$body.find('.of-card__sticky').each((i, el) => {
            const $st = $(el), $row = $st.children('.of-tf-row'), $head = $st.children('.of-card__head');
            if (!$row.length || !$head.length) return;
            const key = $row.data('list');
            const n = $row.find('.of-tf-field.is-set').length;
            const label = `<i class="fa fa-filter"></i> ${__('Filters')}${n ? ` <span class="of-tf-toggle__n">${n}</span>` : ''}`;
            let $btn = $head.find('.of-tf-toggle');
            if (!$btn.length) {
                $btn = $(`<button type="button" class="of-btn of-tf-toggle"></button>`).appendTo($head);
            }
            if ($btn.html() !== label) $btn.html(label);
            $st.toggleClass('of-tf-is-open', !!this.tf_open[key]);
        });
        if (!this._tf_toggle_bound) {
            this._tf_toggle_bound = true;
            this.$body.on('click', '.of-tf-toggle', (e) => {
                e.preventDefault();
                const $st = $(e.currentTarget).closest('.of-card__sticky');
                const key = $st.children('.of-tf-row').data('list');
                this.tf_open[key] = !this.tf_open[key];
                $st.toggleClass('of-tf-is-open', this.tf_open[key]);
                this.fit_tables();
            });
        }
    }

    // Column headings stay in view on every screen: each main table scrolls inside a box exactly
    // as tall as the screen below the navbar and the table's sticky title / filter strip (and
    // above its pagination bar), with its <thead> pinned (CSS --of-box-h). Re-measured after
    // every redraw, tab / sub-tab switch and resize.
    fit_tables() {
        const run = () => {
            const nav = (document.querySelector('.navbar') || {}).offsetHeight || 48;
            const phone = window.matchMedia('(max-width: 768px)').matches;
            this.$body.find('[id^="of-panel-"] .of-card > .of-scroll').each((i, el) => {
                if (!el.offsetParent) return;
                const st = el.closest('.of-card').querySelector(':scope > .of-card__sticky');
                const head = st && !phone ? st.offsetHeight : 0;
                let foot = 0;
                for (let n = el.nextElementSibling; n; n = n.nextElementSibling) foot += n.offsetHeight;
                // Whatever the page still has below this card (padding, footer) lets the page scroll
                // that much further, pushing the box's top (its heading) up under the sticky strip.
                const card = el.closest('.of-card');
                const doc_h = document.documentElement.scrollHeight;
                const below = Math.max(0, doc_h - (card.getBoundingClientRect().bottom + window.scrollY));
                const h = Math.max(phone ? 300 : 240, window.innerHeight - nav - head - foot - below - 4);
                if (el.style.getPropertyValue('--of-box-h') !== h + 'px') el.style.setProperty('--of-box-h', h + 'px');
            });
        };
        run();
        // The strip can grow after this ran (stage counts arrive, a filter box mounts, "+N more"
        // opens): re-measure whenever any sticky strip changes height.
        if (window.ResizeObserver) {
            this._fit_ro = this._fit_ro || new ResizeObserver(() => {
                clearTimeout(this._fit_ro_t); this._fit_ro_t = setTimeout(run, 30);
            });
            this._fit_seen = this._fit_seen || new WeakSet();
            this.$body.find('.of-card__sticky').each((i, el) => {
                if (!this._fit_seen.has(el)) { this._fit_seen.add(el); this._fit_ro.observe(el); }
            });
        }
        if (!this._fit_bound) {
            this._fit_bound = true;
            let t = null;
            const later = () => { clearTimeout(t); t = setTimeout(() => { this.place_shared_controls(); run(); this.save_view_prefs(); }, 80); };
            window.addEventListener('resize', later);
            this.$body.on('click', '[data-tab], .of-subtab, .of-acc-subtab, .of-pl-more > summary', later);
        }
    }

    party_args(tab) {
        const a = {};
        // each table's own filters on this tab (order_flow_api._tf)
        const tf = Object.fromEntries(Object.entries(this.table_filters || {})
            .filter(([k, v]) => k.split('.')[0] === tab && v && Object.keys(v).length));
        if (Object.keys(tf).length) a.of_tf = JSON.stringify(tf);
        return a;
    }

    can_act(tab, sub) {
        const a = this.perms && this.perms.act;
        if (!a) return true;                      // older server: no action rule
        if (sub && a.subtabs && Array.isArray(a.subtabs[tab])) return a.subtabs[tab].includes(sub);
        return !!(a.tabs && a.tabs[tab]);
    }

    // Remove every action control where the user may only view: row actions,
    // approve / reject, "Create …" buttons, receive / send / close, the SO stock
    // widget's buttons. Opening, printing and filters stay. Runs after every redraw.
    strip_view_only_tab_actions() {
        const SEL = [
            '.of-action-btn:not([data-action="open_doc"])', '.of-approve-btn', '.of-reject-btn', '#of-new-so-btn',
            '#of-bulk-approve-btn', '#of-bulk-reject-btn', '.of-approval-select', '.of-sco-btn', '.of-pl-submit',
            '.of-pl-revert', '.of-ewo-send-btn', '.of-ewo-receive-panel-btn', '.of-ewo-close-btn', '.of-ewo-receive-fp-btn',
            '.of-ewo-receive-btn', '.of-receive-btn', '#of-create-transfer-btn', '.of-logi-update-btn', '.of-pay-btn', '.of-submit-draft-btn',
            '.of-refund-btn', '.of-adjust-btn', '.of-fin-new',
            'a.of-btn[href$="/new"]', 'a.of-btn[href*="/new?"]',
            '.so-btn:not(.so-btn--view):not(#btn-refresh-stock-table)',
        ].join(', ');
        const SECTIONS = { tracker: 'of-tracker-sec', purchase: 'of-pur-sec', jobwork: 'of-job-sec', accounts: 'of-acc-sec' };
        const strip = ($c) => {
            $c.find(SEL).remove();
            $c.find('.so-qty-in').prop('disabled', true);
        };
        (this.perms && this.perms.allowed_tabs || []).forEach((tab) => {
            const $panel = this.$body.find(`#of-panel-${tab}`);
            if (!$panel.length || !$panel.children().length) return;
            if (tab === 'approval') {
                if (!this.can_act('approval', this.approval_subtab || 'merchandiser')) strip($panel);
                return;
            }
            const prefix = SECTIONS[tab];
            const $secs = prefix ? $panel.find(`[id^="${prefix}-"]`) : $();
            if ($secs.length) {
                $secs.each((_, el) => { if (!this.can_act(tab, el.id.slice(prefix.length + 1))) strip($(el)); });
                // anything outside the sub-tab sections follows the tab itself
                if (!this.can_act(tab)) strip($panel.children().not($secs).not($secs.parents()));
            } else if (!this.can_act(tab)) {
                strip($panel);
            }
        });
    }

    // The permission call itself failed (network error, 500) — distinct from
    // "you have no tabs", which is a real, valid answer from the server.
    // Conflating the two would tell a user with a flaky connection that they
    // have no permission, when a reload might simply work.
    // Hide sub-tab buttons the user may not open; if the active one is hidden,
    // switch to the first allowed one. Runs after every panel redraw.
    watch_subtab_perms() {
        const apply = () => {
            this.mount_table_filters();
            this.place_shared_controls();
            this.add_filter_toggles();
            this.add_submit_buttons();
            this.strip_view_only_tab_actions();
            this.fit_tables();
            Object.entries(this.allowed_subtabs || {}).forEach(([tab, ok]) => {
                const $btns = this.$body.find(`#of-panel-${tab}`).find('.of-subtab[data-subtab], .of-acc-subtab[data-subtab]');
                if (!$btns.length) return;
                $btns.each((_, b) => { b.style.display = of_subtab_ok(tab, String($(b).data('subtab')), ok) ? '' : 'none'; });
                const $active = $btns.filter('.is-active');
                if ($active.length && $active[0].style.display === 'none') {
                    const $first = $btns.filter((_, b) => b.style.display !== 'none').first();
                    if ($first.length) $first.trigger('click');
                }
            });
        };
        let queued = false;
        const schedule = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; apply(); }); };
        if (this._subtab_observer) this._subtab_observer.disconnect();
        this._subtab_observer = new MutationObserver(schedule);
        this._subtab_observer.observe(this.$body[0], { childList: true, subtree: true });
        apply();
    }

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
                    <!-- First in the toolbar so it is always in view (at the end, the filters
                         pushed it off the line). Latest data; open rows stay open. -->
                    <button class="of-btn of-btn--primary" id="of-btn-refresh" title="${__('Load the latest data (open rows stay open)')}">
                        <i class="fa fa-refresh"></i> ${__('Refresh')}
                    </button>
                    <!-- Search / Open-All / dates / stage chips live here only until the visible table
                         is drawn: place_shared_controls moves them into its filter bar. -->
                    <span id="of-shared-dock" class="of-shared-dock"></span>
                    <span class="of-search">
                        <i class="fa fa-search text-muted"></i>
                        <input type="search" id="of-search" autocomplete="off"
                               placeholder="Search order #, customer, supplier, item…">
                    </span>
                    <select class="of-select of-moved" id="of-merchandiser" style="display: none;">
                        <option value="">All Merchandisers</option>
                    </select>
                    <!-- Merchandiser: own orders by default; this adds their customers' orders (every tab) -->
                    <label class="of-my-customers" id="of-my-customers" style="display: none;"
                           title="${__('Off: only the orders you created. On: also the orders of customers assigned to you.')}">
                        <input type="checkbox"> <span>${__("Show my customers' orders")}</span>
                    </label>
                    <!-- POS Sales Invoices / stores' stock requests: hidden unless switched on -->
                    <label class="of-my-customers of-moved" id="of-show-pos" style="display: none;"
                           title="${__('Off: POS Sales Invoices and stores\' stock requests are hidden. On: they are shown too.')}">
                        <input type="checkbox"> <span>${__('Show POS documents')}</span>
                    </label>
                    <select class="of-select of-moved" id="of-approval-stage" style="display: none;">
                        <option value="">All Approval Stages</option>
                        <option value="Draft">Draft</option>
                        <option value="Pending Merchandiser Approval">Pending Merchandiser Approval</option>
                        <option value="Pending Final Approval">Pending Final SO Approval</option>
                        <option value="Approved">Approved</option>
                        <option value="Rejected">Rejected</option>
                    </select>
                    <select class="of-select of-moved" id="of-uniform-status" style="display: none;" title="Filter by transfer status">
                        <option value="">All Statuses</option>
                        <option value="Sent">Sent</option>
                        <option value="Partially Received">Partially Received</option>
                        <option value="Received">Received</option>
                        <option value="Cancelled">Cancelled</option>
                    </select>
                    <select class="of-select of-moved" id="of-stock-warehouse" style="display: none;" title="Filter by warehouse">
                        <option value="">All Warehouses</option>
                    </select>
                    <select class="of-select of-moved" id="of-tracker-industry" style="display: none;" title="Filter by customer industry">
                        <option value="">All Industries</option>
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
                        <option value="custom">Custom range…</option>
                    </select>
                    <!-- "Custom range…": From / To dates, sent to every tab as days="from~to" -->
                    <!-- One "between" picker (Frappe DateRange, mount_date_range) fills the two hidden
                         dates; apply_date_range reads them as before. -->
                    <span class="of-daterange" id="of-daterange" style="display: none;">
                        <span class="of-daterange__pick" title="${__('Between dates — pick the first day, then the last')}"></span>
                        <input type="hidden" id="of-date-from">
                        <input type="hidden" id="of-date-to">
                    </span>
                    <span class="of-spacer"></span>
                    <span class="of-count" id="of-count"></span>
                    <!-- Live Order Activity: a bell with the unseen count; the stream opens as a side panel -->
                    <button class="of-btn of-bell-btn" id="of-bell-btn" title="${__('Live Order Activity Notifications')}">
                        <i class="fa fa-bell"></i> <span class="of-bell-count of-hidden" id="of-bell-count">0</span>
                    </button>

                    <!-- One place to start any of the documents this dashboard
                         tracks, from any tab — instead of hunting down the
                         right list view first just to click its own "New". -->
                    <div class="of-create-dropdown" id="of-create-dropdown">
                        <button class="of-btn of-btn--primary" id="of-btn-create" title="Create a new document" style="margin-left: 8px;">
                            <i class="fa fa-plus"></i> Create <i class="fa fa-caret-down" style="margin-left:3px;"></i>
                        </button>
                        <div class="of-create-menu of-hidden" id="of-create-menu">
                            <a href="/app/material-request/new" target="_blank"><i class="fa fa-file-text-o"></i> Material Request</a>
                            <a href="/app/purchase-order/new" target="_blank"><i class="fa fa-shopping-cart"></i> Purchase Order</a>
                            <a href="/app/purchase-receipt/new" target="_blank"><i class="fa fa-inbox"></i> Purchase Receipt</a>
                            <a href="/app/sales-invoice/new" target="_blank"><i class="fa fa-money"></i> Sales Invoice</a>
                            <a href="/app/purchase-invoice/new" target="_blank"><i class="fa fa-credit-card"></i> Purchase Invoice</a>
                        </div>
                    </div>
                </div>

                <!-- Stage Filter Sub-Bar (Sales Tracker view) -->
                <div class="of-stage-bar" id="of-stage-bar">
                    <span class="of-stage-bar__label">${__('Stage')}:</span>
                    ${OF_STAGES.map(s => `
                        <button class="of-stage-btn ${s.mod ? `of-stage-btn--${s.mod}` : ''} ${s.key === 'all' ? 'is-active' : ''}"
                                data-stage="${s.key}">
                            ${s.label}
                            <span class="of-stage-count" data-count="${s.key}">·</span>
                        </button>`).join('')}
                    <button type="button" class="of-stage-more" id="of-stage-more" title="${__('Show the stages with no orders')}"></button>
                </div>

                <div id="of-panel-tracker"></div>
                <div id="of-panel-purchase" class="of-hidden"></div>
                <div id="of-panel-jobwork" class="of-hidden"></div>
                <div id="of-panel-stock" class="of-hidden"></div>
                <div id="of-panel-picklist" class="of-hidden"></div>
                <div id="of-panel-billing" class="of-hidden"></div>
                <div id="of-panel-accounts" class="of-hidden"></div>
                <!-- Other users' changes waiting while this user works (queue_background_refresh) -->
                <div class="of-update-bar of-hidden" id="of-update-bar">
                    <i class="fa fa-refresh"></i> <span id="of-update-text"></span>
                    <button class="of-btn of-btn--primary" id="of-update-apply">${__('Refresh')}</button>
                </div>
                <div id="of-panel-approval" class="of-hidden"></div>
                <div id="of-panel-uniform" class="of-hidden"></div>
                <div id="of-panel-logistics" class="of-hidden"></div>
            </div>
        `);

        // Tabs and Refresh / bell / Create share one line (no separate toolbar row).
        this.$body.find('.of-page > .of-tabs, .of-page > .of-toolbar').wrapAll('<div class="of-topbar"></div>');

        frappe.call({
            method: 'erp_dacsinc_custom.order_flow_api.get_merchandisers'
        }).then(r => {
            const list = r.message || [];
            const select = this.$body.find('#of-merchandiser');
            list.forEach(m => {
                select.append(`<option value="${m.name}">${m.full_name}</option>`);
            });
            select.val(this.merchandiser_filter || '');   // a remembered choice (load_view_prefs)
        });

        frappe.call({
            method: 'erp_dacsinc_custom.order_flow_api.get_warehouses'
        }).then(r => {
            const list = r.message || [];
            const select = this.$body.find('#of-stock-warehouse');
            list.forEach(w => {
                select.append(`<option value="${of_esc(w.name)}">${of_esc(w.name)}</option>`);
            });
            select.val(this.stock_warehouse_filter || '');   // VV Puram by default
        });

        frappe.call({
            method: 'erp_dacsinc_custom.order_flow_api.get_customer_industries'
        }).then(r => {
            const list = r.message || [];
            const select = this.$body.find('#of-tracker-industry');
            list.forEach(i => {
                select.append(`<option value="${of_esc(i.name)}">${of_esc(i.name)}</option>`);
            });
            select.val(this.tracker_industry_filter || '');   // a remembered choice (load_view_prefs)
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

        // Sales Tracker, Purchase Flow, Job Work and Approvals Sub-Tab Switcher
        this.$body.on('click', '.of-subtab[data-subtab]', (e) => {
            const $btn = $(e.currentTarget);
            const sub = $btn.data('subtab');
            const parent_tab = this.active;
            
            if (parent_tab === 'tracker') {
                this.tracker_subtab = sub;
                this.$body.find('#of-panel-tracker .of-subtab').removeClass('is-active')
                    .filter(`[data-subtab="${sub}"]`).addClass('is-active');
                this.$body.find('#of-stage-bar').toggleClass('of-hidden', sub !== 'so');
                this.$body.find('#of-tracker-industry').toggle(sub === 'so');
                this.update_show_pos_visibility();
                ['so', 'mr', 'fp', 'pn'].forEach(s => {
                    this.$body.find(`#of-tracker-sec-${s}`).toggleClass('of-hidden', s !== sub);
                });
                this.set_tracker_count(this._tracker_data);
            } else if (parent_tab === 'purchase') {
                this.pur_subtab = sub;
                this.$body.find('#of-panel-purchase .of-subtab').removeClass('is-active')
                    .filter(`[data-subtab="${sub}"]`).addClass('is-active');
                ['po', 'receipt', 'bill'].forEach(s => {
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
            ['receivables', 'supplier', 'jobber', 'notes'].forEach(s => {
                this.$body.find(`#of-acc-sec-${s}`).toggleClass('of-hidden', s !== sub);
                this.$body.find(`#of-acc-kpi-${s}`).toggleClass('of-hidden', s !== sub);
            });
            this.update_show_pos_visibility();
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

        this.$body.on('click', '#of-stage-more', (e) => {
            e.preventDefault();
            this.$body.find('#of-stage-bar').toggleClass('of-stage-bar--all');
            this.update_stage_more();
            this.fit_tables();
        });

        let timer = null;
        this.$body.on('input', '#of-search', (e) => {
            this.search = e.target.value.trim();
            clearTimeout(timer);
            timer = setTimeout(() => { this.reset_all_pagination(); this.refresh(true); }, 300);
        });

        this.$body.on('change', '#of-merchandiser', (e) => { this.merchandiser_filter = e.target.value; this.reset_all_pagination(); this.refresh(true); });
        this.$body.on('change', '#of-show-pos input', (e) => {
            frappe.call({ method: 'erp_dacsinc_custom.order_flow_permissions.set_show_pos_docs', args: { value: e.target.checked ? 1 : 0 } })
                .then((r) => {
                    if (this.perms) this.perms.show_pos_docs = !!(r.message && r.message.show_pos_docs);
                    this.reset_all_pagination(); this.refresh(true);
                });
        });
        this.$body.on('change', '#of-my-customers input', (e) => {
            const on = e.target.checked ? 1 : 0;
            frappe.call({ method: 'erp_dacsinc_custom.order_flow_permissions.set_show_my_customers', args: { value: on } })
                .then((r) => {
                    if (this.perms) this.perms.show_my_customers = !!(r.message && r.message.show_my_customers);
                    this.reset_all_pagination(); this.refresh(true);
                });
        });
        this.$body.on('change', '#of-approval-stage', (e) => { this.approval_stage_filter = e.target.value; this.reset_all_pagination(); this.refresh(true); });
        this.$body.on('change', '#of-uniform-status', (e) => { this.uniform_status_filter = e.target.value; this.reset_all_pagination(); this.refresh(true); });
        this.$body.on('change', '#of-stock-warehouse', (e) => { this.stock_warehouse_filter = e.target.value; this.reset_all_pagination(); this.refresh(true); });
        this.$body.on('change', '#of-tracker-industry', (e) => { this.tracker_industry_filter = e.target.value; this.reset_all_pagination(); this.refresh(true); });

        // Draft/Submitted filter pills — Purchase Flow's PO/Receipt, Job
        // Work's PO/Receipt/EWO, Sales Tracker's MR sub-tab (see
        // this.docstatus_filter / build_docstatus_args / of_docstatus_pills).
        this.$body.on('click', '.of-ds-pill', (e) => {
            const $btn = $(e.currentTarget);
            const tab = $btn.data('tab');
            const sublist = $btn.data('sublist');
            const value = $btn.data('docstatus') || '';
            if (!this.docstatus_filter[tab] || !(sublist in this.docstatus_filter[tab])) return;
            this.docstatus_filter[tab][sublist] = value;
            this.reset_all_pagination();
            this.refresh(true);
        });

        // SO Approvals' Rejected Orders sub-tab: All / By Merchandiser / At
        // Final Approval — see of_rejection_stage_pills.
        this.$body.on('click', '.of-rej-stage-pill', (e) => {
            this.approval_rejected_stage_filter = $(e.currentTarget).data('stage') || '';
            this.refresh(true);
        });
        this.$body.on('click', '.of-submit-draft-btn', (e) => {
            e.preventDefault(); e.stopPropagation();
            const $b = $(e.currentTarget);
            of_submit_draft_prompt($b.data('doctype'), String($b.data('name')), () => this.refresh(true));
        });
        // Returns / Notes: refund a customer credit / receive a supplier's refund (payment_prompt.js),
        // or set the credit off against their unpaid invoices in Payment Reconciliation.
        // Print with a choice of copy (print_prompt.js — same as the form's "Print Sales Invoice")
        this.$body.on('click', '.of-print-copies-btn', (e) => {
            const $b = $(e.currentTarget);
            window.dacs_print_copies($b.data('doctype'), String($b.data('name')),
                { is_return: cint($b.data('isReturn')), docstatus: cint($b.data('docstatus')) });
        });
        // The other half of a return (return_goods.py): open the note / return in a new tab and let
        // its form make the missing document straight away (dacs_goods_status reads this note).
        // Receive / Pay (Finance › New): the one payment prompt — one or many invoices, one or many
        // parties, or an advance (public/js/bulk_payment.js).
        this.$body.on('click', '.of-je-new-btn', () => {
            frappe.require('/assets/erp_dacsinc_custom/js/journal_prompt.js',
                () => dacs_journal_prompt({ on_done: () => this.refresh(true) }));
        });
        this.$body.on('click', '.of-pay-new-btn', (e) => {
            const type = String($(e.currentTarget).data('type'));
            frappe.require('/assets/erp_dacsinc_custom/js/bulk_payment.js',
                () => dacs_payment_dialog({ payment_type: type, on_done: () => this.refresh(true) }));
        });
        this.$body.on('click', '.of-notes-kind', (e) => {
            this.set_table_filter('accounts.notes', 'kind', String($(e.currentTarget).data('kind') || ''));
        });
        this.$body.on('click', '.of-make-goods-btn', (e) => {
            const $b = $(e.currentTarget);
            const dt = $b.data('doctype'), name = String($b.data('name'));
            try { localStorage.setItem(`dacs_make:${dt}:${name}`, String(Date.now())); } catch (err) { /* no storage */ }
            window.open(`/app/${frappe.router.slug(dt)}/${encodeURIComponent(name)}`, '_blank');
        });
        this.$body.on('click', '.of-pay-link', (e) => {
            const $b = $(e.currentTarget);
            of_payments_dialog(String($b.data('invoice')), $b.data('payments') || [], $b.data('currency'));
        });
        this.$body.on('click', '.of-refund-btn', (e) => {
            const $b = $(e.currentTarget);
            frappe.require('/assets/erp_dacsinc_custom/js/payment_prompt.js',
                () => of_refund_prompt($b.data('doctype'), String($b.data('name')), () => this.refresh(true)));
        });
        this.$body.on('click', '.of-adjust-btn', (e) => {
            const $b = $(e.currentTarget);
            const q = new URLSearchParams({ company: frappe.defaults.get_user_default('Company') || '',
                party_type: $b.data('partyType'), party: String($b.data('party')) });
            window.open(`/app/payment-reconciliation?${q.toString()}`, '_blank');
        });
        // Receive / Pay on an invoice row: the same prompt, starting with that invoice (more of the
        // party's invoices, or other parties, can be added there).
        this.$body.on('click', '.of-pay-btn', (e) => {
            const $b = $(e.currentTarget);
            frappe.require('/assets/erp_dacsinc_custom/js/bulk_payment.js',
                () => dacs_pay_invoice($b.data('doctype'), String($b.data('name')), () => this.refresh(true)));
        });
        this.$body.on('change', '#of-scope', (e) => { this.scope = e.target.value; this.reset_all_pagination(); this.refresh(true); });
        this.$body.on('change', '#of-days',  (e) => {
            const custom = e.target.value === 'custom';
            this.$body.find('#of-daterange').toggle(custom);
            if (custom) {
                const $from = this.$body.find('#of-date-from'), $to = this.$body.find('#of-date-to');
                if (!$from.val()) $from.val(frappe.datetime.add_days(frappe.datetime.get_today(), -30));
                if (!$to.val()) $to.val(frappe.datetime.get_today());
                this.mount_date_range();
                this.apply_date_range();
                return;
            }
            this.days = e.target.value; this.reset_all_pagination(); this.refresh(true);
        });
        this.$body.on('change', '#of-date-from, #of-date-to', () => this.apply_date_range());
        // Table filters (OF_TABLE_FILTERS): selects, the mirrored toolbar controls, POS switch, clear.
        this.$body.on('change', '.of-tf-select', (e) => {
            const $s = $(e.currentTarget);
            const key = $s.data('list'), field = $s.data('f'), value = e.target.value || '';
            const f = (this.table_filters[key] = this.table_filters[key] || {});
            if (value) f[field] = value; else delete f[field];
            const def = this.tf_def(key, field) || [];
            const opts = def[1] === 'status' ? (OF_STATUS_OPTIONS[def[2]] || []) : (Array.isArray(def[2]) ? def[2] : []);
            const opt = opts.find(o => o[0] === value);
            if (opt && opt[2] && this.scope === 'open') {   // finds what "Open orders" hides
                this.scope = 'all';
                this.$body.find('#of-scope').val('all');
            }
            this.reset_all_pagination();
            this.refresh(true);
        });
        this.$body.on('change', '.of-tf-mirror', (e) => {
            this.$body.find($(e.currentTarget).data('target')).val(e.target.value).trigger('change');
        });
        this.$body.on('change', '.of-tf-pos', (e) => {
            this.$body.find('#of-show-pos input').prop('checked', e.target.checked).trigger('change');
        });
        // Search boxes for Customer / Supplier / Jobber / Transporter / Warehouse (of_tf_combo_*).
        this.$body.on('focus input', '.of-tf-combo-input', (e) => of_tf_combo_open(this, $(e.currentTarget), e.type === 'focusin'));
        this.$body.on('keydown', '.of-tf-combo-input', (e) => of_tf_combo_key(this, $(e.currentTarget), e));
        this.$body.on('blur', '.of-tf-combo-input', (e) => setTimeout(() => of_tf_combo_close(this, $(e.currentTarget)), 150));
        this.$body.on('mousedown', '.of-tf-combo-x', (e) => {
            e.preventDefault();
            const $c = $(e.currentTarget).closest('.of-tf-combo');
            this.set_table_filter($c.data('list'), $c.data('f'), '');
        });
        this.$body.on('click', '.of-tf-clear', (e) => {
            e.preventDefault();
            const key = $(e.currentTarget).data('list');
            delete this.table_filters[key];
            (OF_TABLE_FILTERS[key] || []).filter(d => d[1] === 'mirror').forEach(d => {
                const $t = this.$body.find(d[2]);
                const back = d[2] === '#of-stock-warehouse' ? OF_MAIN_WAREHOUSE : '';   // Stock Tracker returns to the main warehouse
                if (($t.val() || '') !== back) $t.val(back).trigger('change');
            });
            this.reset_all_pagination();
            this.refresh(true);
        });

        // Pagination bar — one reusable control, shared by every tab's
        // (sub-)list. See render_pagination_bar/build_pagination_args.
        this.$body.on('click', '.of-page-btn:not([disabled]):not(.is-active)', (e) => {
            const $btn = $(e.currentTarget);
            this.set_page($btn.data('tab'), $btn.data('sublist') || null, parseInt($btn.data('page'), 10));
        });
        this.$body.on('change', '.of-page-size-select', (e) => {
            const $sel = $(e.currentTarget);
            this.set_page_size($sel.data('tab'), $sel.data('sublist') || null, parseInt($sel.val(), 10));
        });

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

        // "Create Subcontract PO" offered alongside the stage's own action
        // whenever raw material is ready. Same prompt the Sales Order widget
        // uses, so both surfaces offer exactly the same items.
        this.$body.on('click', '.of-sco-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const so = $(e.currentTarget).data('so');
            frappe.call({
                method: 'erp_dacsinc_custom.order_flow_api.get_so_bom_items_for_spo',
                args: { sales_order: so },
                freeze: true,
                freeze_message: __('Checking raw material…')
            }).then(r => {
                const ready = (r && r.message) || [];
                frappe.require('/assets/erp_dacsinc_custom/js/sales_order.js', () => {
                    if (typeof window.so_show_spo_multi_prompt !== 'function') {
                        window.open(frappe.utils.get_form_link('Sales Order', so), '_blank');
                        return;
                    }
                    window.so_show_spo_multi_prompt(so, ready, () => this.refresh(true));
                });
            });
        });

        // "+N more" toggle for a collapsed Sales Order / Purchase Order link
        // list (see of_links) — a plain visibility flip, not a re-render, so
        // it can't disturb whatever row it lives in.
        this.$body.on('click', '.of-links-toggle', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $toggle = $(e.currentTarget);
            const $extra = $toggle.closest('td').find('.of-links-extra');
            const expanded = $extra.is(':visible');
            $extra.toggle(!expanded);
            $toggle.text(expanded ? $toggle.data('more-label') : $toggle.data('less-label'));
        });

        // Submit a draft Pick List straight from the Pick Lists tab — the
        // whole point of that tab is not having to open each one. Reuses the
        // same server method the Sales Order widget submits through
        // (update_and_submit_pick_list with no row edits), so all of its own
        // validation applies identically here.
        // "Order Status" under a Sales Order number — where every item is now.
        this.$body.on('click', '.of-order-status', (e) => {
            e.preventDefault(); e.stopPropagation();
            const so = $(e.currentTarget).data('so');
            frappe.require('/assets/erp_dacsinc_custom/js/sales_order.js', () => window.so_show_order_status(so));
        });

        this.$body.on('click', '.of-pl-revert', (e) => {
            e.preventDefault(); e.stopPropagation();
            of_revert_pick_list($(e.currentTarget).data('pl'), () => this.refresh(true));
        });

        this.$body.on('click', '.of-pl-submit', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            const pl = $btn.data('pl');
            if (!pl) return;
            // Ask WHAT is being picked, not just whether to submit. Submitting
            // sets each line's picked_qty and reserves that stock, so a bare
            // "Submit?" confirm silently committed the full allocated qty even
            // when less was physically picked. Quantities can only be reduced
            // (update_and_submit_pick_list enforces the same ceiling
            // server-side, and explains it by item if exceeded).
            this.prompt_submit_pick_list(pl, $btn);
        });

        // "Create" dropdown — toggle on its own button, close on an outside
        // click or a menu item's own click (the link still opens in a new
        // tab either way; this just keeps the menu from staying open on the
        // dashboard behind it).
        this.$body.on('click', '#of-btn-create', (e) => {
            e.stopPropagation();
            this.$body.find('#of-create-menu').toggleClass('of-hidden');
        });
        this.$body.on('click', '#of-create-menu a', () => {
            this.$body.find('#of-create-menu').addClass('of-hidden');
        });
        $(document).on('click.of-create-dropdown', (e) => {
            if (!$(e.target).closest('#of-create-dropdown').length) {
                this.$body.find('#of-create-menu').addClass('of-hidden');
            }
        });

        // Activity Notification Full Row Clickable Toggle (Sync all tabs)
        // The stream is a side panel opened from the toolbar bell (no collapse toggle any more).
        this.$body.on('click', '#of-bell-btn', (e) => {
            e.stopPropagation();
            this.$body.toggleClass('of-stream-open');
        });
        this.$body.on('click', '.of-stream-close', (e) => {
            e.stopPropagation();
            this.$body.removeClass('of-stream-open');
        });
        $(document).on('click.of_stream', (e) => {
            if (!this.$body.hasClass('of-stream-open')) return;
            if ($(e.target).closest('.of-stream-card, #of-bell-btn, .modal, .awesomplete').length) return;
            this.$body.removeClass('of-stream-open');
        });
        this.$body.on('click', '.of-toggle-stream-header-legacy', () => {
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
            if ($(e.target).closest('a, button, input, select, textarea, [onclick]').length) return;
            const $row = $(e.currentTarget);
            const so_name = $row.data('so');
            const $btn = $row.find('.of-so-toggle');
            this.toggle_so_details(so_name, $btn);
        });

        // Row-level "see items" toggle for Purchase Flow / Job Work / Finance —
        // these rows are Purchase Orders, Material Requests, Receipts and
        // Invoices, not Sales Orders, so they show that document's OWN item
        // rows rather than the Sales Order stock widget above. Clicking
        // anywhere on the row toggles it, same as the Sales Order rows above
        // — the caret is just the visual affordance, not the only hit target.
        this.$body.on('click', 'tr.of-doc-row', (e) => {
            if ($(e.target).closest('a, button, input, select, textarea, [onclick]').length) return;
            const $row = $(e.currentTarget);
            const $btn = $row.find('.of-doc-items-toggle');
            this.toggle_doc_items_row($row, $btn.data('doctype'), $btn.data('docname'), $btn);
        });

        // Embroidery Work Order rows — item-wise Sent/Received/Pending,
        // straight from the same items child table the receive dialogs
        // already read via get_ewo_details, instead of only the row's
        // aggregate totals across every item on the order.
        this.$body.on('click', 'tr.of-ewo-row', (e) => {
            if ($(e.target).closest('a, button, input, select, textarea, [onclick]').length) return;
            const $row = $(e.currentTarget);
            const $btn = $row.find('.of-ewo-items-toggle');
            this.toggle_ewo_items_row($row, $btn.data('ewo'), $btn);
        });

        // Same idea for Embroidery Transfers, which carry no Sales Order at
        // all — the only further detail that exists is the partial-receipt
        // history of that one transfer.
        this.$body.on('click', 'tr.of-transfer-row', (e) => {
            if ($(e.target).closest('a, button, input, select, textarea, [onclick]').length) return;
            const $row = $(e.currentTarget);
            const $btn = $row.find('.of-transfer-receipts-toggle');
            this.toggle_transfer_receipts_row($row, $btn.data('id'), $btn);
        });

        // Stock Tracker: per-item warehouse breakdown.
        this.$body.on('click', 'tr.of-stock-row', (e) => {
            if ($(e.target).closest('a, button, input, select, textarea, [onclick]').length) return;
            const $row = $(e.currentTarget);
            const $btn = $row.find('.of-stock-wh-toggle');
            this.toggle_stock_wh_row($row, $btn.data('item'), $btn);
        });

        // Stock Tracker: click a non-zero reservation count to see which
        // documents are actually behind it.
        this.$body.on('click', '.of-reserve-link', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $link = $(e.currentTarget);
            this.show_reservation_details_modal(
                $link.data('item'), $link.data('warehouse'), $link.data('kind'), $link.data('label'));
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
                const $row = this.$body.find(`#of-panel-${this.active} tr[data-so="${so}"]`);
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

            // Every "Create X" action opens an unsaved mapped draft — a bare
            // "Create a Sales Invoice for SO-123?" text confirm gave no way
            // to see which items or how much of each were actually about to
            // be created before it happened. This maps the doc FIRST (still
            // nothing saved), then shows exactly what it contains — item,
            // qty, warehouse — and only opens it once the user reviews and
            // confirms; cancelling discards it having changed nothing.
            const preview_and_open_mapped_doc = (opts) => {
                return frappe.call({
                    type: "POST",
                    method: "frappe.model.mapper.make_mapped_doc",
                    args: {
                        method: opts.method,
                        source_name: opts.source_name,
                        selected_children: opts.selected_children || null,
                        args: opts.args || null
                    },
                    freeze: true,
                    freeze_message: opts.freeze_message || __("Mapping Document..."),
                    callback: function(r) {
                        if (r.exc || !r.message) return;
                        // frappe.model.sync returns an ARRAY of every doc it synced into
                        // the client-side cache (the mapped doc plus any of its children)
                        // — the mapped doc itself is always the first one. It mutates
                        // r.message in place too, but indexing the return value is the
                        // documented/safe way to get it.
                        const doc = frappe.model.sync(r.message)[0];
                        const items = doc.items || [];
                        if (!items.length) {
                            frappe.msgprint(__('Nothing to create — every line is already fully processed.'));
                            return;
                        }
                        // One preview for the whole app. sales_order.js is
                        // already frappe.require()d on this page, and its
                        // renderer names the SOURCE document each line came
                        // from (with its date/status), the customer, and what
                        // the document is doing relative to what was already
                        // raised — none of which a local item/qty/warehouse
                        // table could say. Kept behind a guard so a load
                        // failure degrades to the plain table rather than
                        // leaving the button dead.
                        frappe.require('/assets/erp_dacsinc_custom/js/sales_order.js', () => {
                            if (typeof window.so_show_mapped_doc_preview === 'function') {
                                window.so_show_mapped_doc_preview(doc, {
                                    preview_title: opts.preview_title,
                                    confirm_label: opts.confirm_label,
                                    focus_so: opts.focus_so
                                });
                                return;
                            }
                            const rows = items.map(it => `
                                <tr>
                                    <td>${of_esc(it.item_code)}${it.item_name && it.item_name !== it.item_code
                                        ? `<div class="of-micro text-muted">${of_esc(it.item_name)}</div>` : ''}</td>
                                    <td class="text-right">${of_round2(it.qty)} ${of_esc(it.uom || it.stock_uom || '')}</td>
                                </tr>`).join('');
                            const dialog = new frappe.ui.Dialog({
                                title: opts.preview_title || __('Review before creating'),
                                fields: [{ fieldtype: 'HTML', fieldname: 'preview' }],
                                primary_action_label: opts.confirm_label || __('Create'),
                                primary_action: () => {
                                    dialog.hide();
                                    frappe.set_route('Form', doc.doctype, doc.name);
                                },
                                secondary_action_label: __('Cancel'),
                                secondary_action: () => dialog.hide()
                            });
                            dialog.fields_dict.preview.$wrapper.html(`
                                <div class="doc-preview-wrap"><table class="doc-preview-table">
                                    <thead><tr>
                                        <th>${__('Item')}</th><th class="text-right">${__('Qty')}</th>
                                    </tr></thead>
                                    <tbody>${rows}</tbody>
                                </table></div>
                                <p class="doc-preview-hint">${
                                    __('This opens as a draft, not yet saved — you can still review or edit it before submitting.')
                                }</p>`);
                            dialog.show();
                        });
                    }
                });
            };

            if (action === 'submit_pick_list' && so) {
                // The same review-and-submit table the Sales Order widget's
                // "Pick Lists" button opens: every draft pick on the order,
                // each qty editable before it commits stock. A mock frm is
                // built off-screen first (load_so_details) because that modal
                // — and the refresh it runs after a successful submit — read
                // cur_frm, exactly as the widget's own buttons do here.
                const $hidden = $('<div>').appendTo(document.body).hide();
                frappe.dom.freeze(__('Loading Pick Lists…'));
                frappe.require('/assets/erp_dacsinc_custom/js/sales_order.js', () => {
                    this.load_so_details(so, $hidden, (mock_frm) => {
                        frappe.call({
                            method: 'erp_dacsinc_custom.order_flow_api.get_pick_lists_for_so',
                            args: { sales_order: so }
                        }).then(r => {
                            frappe.dom.unfreeze();
                            $hidden.remove();
                            const pls = r.message || [];
                            if (!pls.length) {
                                frappe.msgprint(__('No Pick List found for this order.'));
                                return;
                            }
                            if (mock_frm) window.cur_frm = mock_frm;
                            window.show_so_picklists_modal(mock_frm || { doc: { name: so } }, pls);
                        }).catch(() => {
                            frappe.dom.unfreeze();
                            $hidden.remove();
                        });
                    });
                });
            } else if (action === 'open_doc' && doctype === 'Embroidery Work Order' && so) {
                // Internal document — show the order's embroidery instead of its form.
                frappe.require('/assets/erp_dacsinc_custom/js/sales_order.js', () => window.so_show_so_embroidery(so));
            } else if (action === 'open_doc' && target && doctype) {
                // Opens an EXISTING document (the Next Action button for most
                // tracker stages) — a document link like any other on this
                // dashboard, so it opens in a new tab rather than navigating
                // away from the dashboard itself.
                window.open(frappe.utils.get_form_link(doctype, target), '_blank');
            } else if (action === 'make_invoice' && so) {
                const mock_frm = { doc: { name: so, customer: btn.data('customer') || '', customer_name: btn.data('customerName') || '' } };
                frappe.call({
                    method: 'erp_dacsinc_custom.order_flow_api.get_pick_lists_for_so',
                    args: { sales_order: so }
                }).then(pl_res => {
                    const pls = (pl_res.message || []).filter(x =>
                        flt_of(x.docstatus) === 1 && ['Open', 'Partly Delivered'].includes(x.status || 'Open'));
                    if (pls.length) {
                        // A Pick List is what actually reserved this stock — the
                        // Sales Invoice must be built from ITS picked qty (see
                        // create_dn_or_si_from_pick_lists), never the Sales Order
                        // line's own full qty, or a line only partly picked (5 of
                        // 10, say) would bill — and try to deduct stock — for all
                        // 10. show_bulk_dn_si_modal already previews exactly what
                        // will be created, so it doubles as the confirmation here.
                        frappe.call({
                            method: 'erp_dacsinc_custom.order_flow_api.get_draft_dn_si_for_so',
                            args: { sales_order: so }
                        }).then(draft_res => {
                            const drafts = draft_res.message || {};
                            frappe.require('/assets/erp_dacsinc_custom/js/sales_order.js', () => {
                                // ORIGINAL (commented out as per requirement — SI with Update Stock is not used):
                                // show_bulk_dn_si_modal(mock_frm, pls, 'Sales Invoice', 0, drafts.draft_sis || [], [], drafts.draft_details || []);
                                // Picked stock ships on a Delivery Note first; the invoice is made from that DN.
                                frappe.show_alert({ message: __('Picked qty goes on a Delivery Note first — invoice the Delivery Note after it is submitted.'), indicator: 'blue' }, 6);
                                show_bulk_dn_si_modal(mock_frm, pls, 'Delivery Note', 0, drafts.draft_dns || [], [], drafts.draft_details || []);
                            });
                        });
                    } else {
                        // No Pick List reservation involved for this order right
                        // now — stock already moved via a direct Delivery Note/
                        // Sales Invoice earlier, so the plain mapper's own
                        // billed-qty accounting is correct as-is.
                        preview_and_open_mapped_doc({
                            method: 'erpnext.selling.doctype.sales_order.sales_order.make_sales_invoice',
                            source_name: so,
                            freeze_message: __('Creating Sales Invoice…'),
                            preview_title: __('Review Sales Invoice'),
                            confirm_label: __('Create Sales Invoice')
                        });
                    }
                });
            } else if (action === 'make_invoice_from_dn' && target) {
                // `target` is a comma-joined list of Delivery Notes. Where
                // there is more than one, which of them this invoice covers is
                // the user's call — the same select-your-sources step every
                // other create-from action uses, rather than silently
                // invoicing all of them.
                const dn_names = String(target).split(',').map(x => x.trim()).filter(Boolean);
                const build = (names) => preview_and_open_mapped_doc({
                    method: 'erp_dacsinc_custom.custom_script.make_sales_invoice_from_multiple_delivery_notes',
                    source_name: names.join(','),
                    freeze_message: __('Creating Sales Invoice from Delivery Notes…'),
                    preview_title: __('Review Sales Invoice — from Delivery Note(s)'),
                    confirm_label: __('Create Sales Invoice')
                });

                if (dn_names.length <= 1) {
                    build(dn_names);
                } else {
                    frappe.require('/assets/erp_dacsinc_custom/js/sales_order.js', () => {
                        if (typeof window.so_pick_source_docs !== 'function') {
                            build(dn_names);
                            return;
                        }
                        window.so_pick_source_docs({
                            doctype: 'Delivery Note',
                            names: dn_names,
                            multi: true,
                            title: __('Create Sales Invoice — select Delivery Notes'),
                            hint: __('{0} Delivery Notes are ready to invoice, all selected. Untick any that should not be on this invoice — those stay unbilled.', [dn_names.length]),
                            confirm_label: __('Create Sales Invoice'),
                            on_confirm: (selected) => build(selected),
                        });
                    });
                }
            } else if (action === 'make_purchase_invoice_from_pr' && btn.data('pr')) {
                // the bill from the receipt: ERPNext's make_purchase_invoice (returned qty left out),
                // plus the supplier's bill no / date the receipt recorded
                preview_and_open_mapped_doc({
                    method: 'erp_dacsinc_custom.purchase_order.make_purchase_invoice_custom',
                    source_name: String(btn.data('pr')),
                    freeze_message: __('Creating Purchase Invoice…'),
                    preview_title: __('Review Purchase Invoice'),
                    confirm_label: __('Create Purchase Invoice')
                });
            } else if (action === 'make_purchase_invoice' && po) {
                preview_and_open_mapped_doc({
                    method: 'erpnext.buying.doctype.purchase_order.purchase_order.make_purchase_invoice',
                    source_name: po,
                    freeze_message: __('Creating Purchase Invoice…'),
                    preview_title: __('Review Purchase Invoice'),
                    confirm_label: __('Create Purchase Invoice')
                });
            } else if (action === 'make_dn_or_si' && so) {
                // Same either-route choice the Sales Order's own "Item Stock
                // & Action Plan" widget offers per item — reused here as-is
                // (show_bulk_dn_si_modal only ever reads frm.doc.name/
                // customer/customer_name, so a lightweight mock frm from
                // this row's own data attributes is enough; no real Sales
                // Order form needed on this dashboard).
                const route_lock = btn.data('routeLock') || '';
                const mock_frm = { doc: { name: so, customer: btn.data('customer') || '', customer_name: btn.data('customerName') || '' } };

                frappe.confirm(
                    __('Fulfill Sales Order <b>{0}</b>?', [esc(so)]),
                    () => {
                        Promise.all([
                            frappe.call({
                                method: 'erp_dacsinc_custom.order_flow_api.get_pick_lists_for_so',
                                args: { sales_order: so }
                            }),
                            frappe.call({
                                method: 'erp_dacsinc_custom.order_flow_api.get_draft_dn_si_for_so',
                                args: { sales_order: so }
                            })
                        ]).then(([pl_res, draft_res]) => {
                            // "Open" is Pick List's own core status for "nothing
                            // delivered yet" — there is no "Submitted" option on
                            // this doctype (confirmed against the live status
                            // field options: Draft/Open/Partly Delivered/
                            // Completed/Cancelled).
                            const pls = (pl_res.message || []).filter(x =>
                                flt_of(x.docstatus) === 1 && ['Open', 'Partly Delivered'].includes(x.status || 'Open'));
                            if (!pls.length) {
                                frappe.msgprint(__('No submitted Pick List found to create a Delivery Note or Sales Invoice from.'));
                                return;
                            }
                            const drafts = draft_res.message || {};

                            frappe.require('/assets/erp_dacsinc_custom/js/sales_order.js', () => {
                                /*
                                // ORIGINAL CODE (commented out as per requirement - always create DN instead of choice/SI):
                                if (route_lock === 'dn') {
                                    show_bulk_dn_si_modal(mock_frm, pls, 'Delivery Note', 0, drafts.draft_dns || [], [], drafts.draft_details || []);
                                } else if (route_lock === 'si') {
                                    show_bulk_dn_si_modal(mock_frm, pls, 'Sales Invoice', 0, drafts.draft_sis || [], [], drafts.draft_details || []);
                                } else {
                                    const choice = new frappe.ui.Dialog({
                                        title: __('Choose Fulfillment Route'),
                                        fields: [{
                                            fieldtype: 'HTML',
                                            options: `<div class="of-hint"><i class="fa fa-info-circle"></i> ${
                                                __('This order has not committed to a route yet. A Delivery Note ships the stock and bills separately later; a Sales Invoice with Update Stock ships and bills in one document. Once you pick one, every remaining line on this order must follow the same route.')
                                            }</div>`
                                        }],
                                        primary_action_label: __('Create Delivery Note'),
                                        primary_action: () => { choice.hide(); show_bulk_dn_si_modal(mock_frm, pls, 'Delivery Note', 0, drafts.draft_dns || []); },
                                        secondary_action_label: __('Create Sales Invoice (Update Stock)'),
                                        secondary_action: () => { choice.hide(); show_bulk_dn_si_modal(mock_frm, pls, 'Sales Invoice', 0, drafts.draft_sis || [], [], drafts.draft_details || []); }
                                    });
                                    choice.show();
                                }
                                */

                                // Always create Delivery Note directly:
                                show_bulk_dn_si_modal(mock_frm, pls, 'Delivery Note', 0, drafts.draft_dns || [], [], drafts.draft_details || []);
                            });
                        });
                    }
                );
            } else if (action === 'make_picklist' && so) {
                // Opens the existing Sales Order (a Pick List is created
                // from there) — a document link, same new-tab treatment.
                window.open(frappe.utils.get_form_link('Sales Order', so), '_blank');
            } else if (action === 'make_po_from_mr' && target) {
                preview_and_open_mapped_doc({
                    method: 'erpnext.stock.doctype.material_request.material_request.make_purchase_order',
                    source_name: target,
                    freeze_message: __('Creating Purchase Order from Material Request…'),
                    preview_title: __('Review Purchase Order — from Material Request'),
                    confirm_label: __('Create Purchase Order'),
                    focus_so: so
                });
            } else if ((action === 'request' || action === 'make_mr') && so) {
                // One prompt: choose Raw Material (for BOM items) or Trade
                // Items (bought as-is), see exactly what is short, request it.
                // (It used to open the Subcontract PO picker instead.)
                of_show_request_prompt(so, () => this.refresh(true));
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
                // every selected order's BOM / normal rows, confirmed once for all (workflow.js)
                dacs_confirm_bom_split(selected).then((ok) => {
                    if (!ok) return;
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
                            message: __('The following Sales Orders cannot be approved in bulk because their Customer profiles are missing GSTIN, Tax Category, Primary Address, or Primary Contact. Please approve them individually to add or skip details:<br><br><b>{0}</b>', [missing_details_sos.join(', ')])
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

        // Embroidery Work Order — "Receive Finished Goods" against the PO's
        // Subcontracting Order. Reuses the exact dialog the Purchase Order
        // form itself uses (show_receive_items_dialog) — that function only
        // ever calls frm.refresh_field/frm.refresh, never reads frm.doc.*,
        // so a lightweight mock frm is enough; no real PO form needed here.
        this.$body.on('click', '.of-ewo-receive-btn', (e) => {
            e.stopPropagation();
            const sco_name = $(e.currentTarget).data('sco');
            if (!sco_name) {
                frappe.msgprint(__('No Subcontracting Order found for this Purchase Order.'));
                return;
            }
            frappe.require('/assets/erp_dacsinc_custom/js/purchase_order.js', () => {
                const mock_frm = { refresh_field: () => {}, refresh: () => this.refresh(true) };
                show_receive_items_dialog(mock_frm, sco_name);
            });
        });

        // Embroidery Work Order — per-stage actions, the same 3 steps the
        // Purchase Order's own Panel dashboard offers (Send -> Receive ->
        // Close), plus Full Piece's single Receive step, done here so the
        // user never has to leave the dashboard to advance a job.
        this.$body.on('click', '.of-ewo-send-btn', (e) => {
            e.stopPropagation();
            this.show_ewo_send_dialog($(e.currentTarget).data('name'));
        });
        this.$body.on('click', '.of-ewo-receive-panel-btn', (e) => {
            e.stopPropagation();
            this.show_ewo_receive_panel_dialog($(e.currentTarget).data('name'));
        });
        this.$body.on('click', '.of-ewo-close-btn', (e) => {
            e.stopPropagation();
            this.show_ewo_close_dialog($(e.currentTarget).data('name'));
        });
        this.$body.on('click', '.of-ewo-receive-fp-btn', (e) => {
            e.stopPropagation();
            this.show_ewo_receive_fp_dialog($(e.currentTarget).data('name'));
        });
        // Same print as the Purchase Order's own linked-documents table, so a
        // work order prints identically from either place. stopPropagation
        // because the row itself is a toggle — see the click guard in
        // toggle_ewo_items_row's binding.
        this.$body.on('click', '.of-ewo-print-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            of_print_ewo($(e.currentTarget).data('name'));
        });
        this.$body.on('click', '.of-uet-print-btn', (e) => {
            e.stopPropagation();
            const name = $(e.currentTarget).data('name');
            if (name && window.dacs_print_url) window.open(dacs_print_url('Uniform Embroidery Transfer', name), '_blank');
        });

        // Purchase Flow tab's own Print — every row there is a plain
        // (non-subcontracted) PO, so it always prints itself.
        this.$body.on('click', '.of-po-print-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            of_print_po($(e.currentTarget).data('name'));
        });
        // Job Work tab's Print — every row there IS subcontracted, so this
        // prints its Subcontracting Order instead (see of_print_sco); the
        // button itself only renders once one exists (sco_name), same gate
        // the Purchase Order form's own "Print SCO"/"Print PO" toolbar
        // buttons use.
        this.$body.on('click', '.of-sco-print-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            of_print_sco($(e.currentTarget).data('name'));
        });

        // Uniform Embroidery Receive: every pending line with the qty received now and the
        // warehouse it goes to (per line). One Repack Stock Entry per received line.
        this.$body.on('click', '.of-receive-btn', (e) => {
            const transfer_id = $(e.currentTarget).data('id');
            frappe.call({ method: 'erp_dacsinc_custom.uniform_transfer_api.get_transfer_receipts', args: { transfer_id } }).then(r => {
                const pending = ((r.message || {}).items || []).filter(l => flt_of(l.pending_qty) > 0);
                if (!pending.length) return frappe.msgprint(__('Nothing is pending on this transfer.'));
                const dialog = new frappe.ui.Dialog({
                    title: __('Receive from Embroidery — {0}', [transfer_id]),
                    size: 'extra-large',
                    fields: [
                        { fieldtype: 'HTML', fieldname: 'note', options: `<div style="margin-bottom:6px;font-size:12px;color:var(--text-muted);">
                            ${__('Enter what came back for each line and where it goes. Leave a line at 0 if nothing of it came back yet — it stays pending.')}</div>` },
                        { fieldtype: 'Link', fieldname: 'all_wh', options: 'Warehouse', label: __('Set the same warehouse on every line'),
                          default: 'VV Puram - IND',
                          onchange: () => {
                              const wh = dialog.get_value('all_wh');
                              if (!wh) return;
                              (dialog.fields_dict.lines.grid.get_data() || []).forEach(l => { l.to_warehouse = wh; });
                              dialog.fields_dict.lines.grid.refresh();
                          } },
                        { fieldtype: 'Table', fieldname: 'lines', label: __('Lines'), cannot_add_rows: 1, cannot_delete_rows: 1, in_place_edit: true,
                          data: pending.map(l => ({ row: l.name, source_item: l.source_item, target_item: l.target_item,
                                                    pending_qty: flt_of(l.pending_qty), qty: flt_of(l.pending_qty), to_warehouse: 'VV Puram - IND' })),
                          fields: [
                              { fieldtype: 'Data', fieldname: 'row', hidden: 1 },
                              { fieldtype: 'Data', fieldname: 'source_item', label: __('Plain item'), read_only: 1, in_list_view: 1, columns: 2 },
                              { fieldtype: 'Data', fieldname: 'target_item', label: __('Comes back as'), read_only: 1, in_list_view: 1, columns: 3 },
                              { fieldtype: 'Float', fieldname: 'pending_qty', label: __('Pending'), read_only: 1, in_list_view: 1, columns: 1 },
                              { fieldtype: 'Float', fieldname: 'qty', label: __('Received now'), in_list_view: 1, columns: 1 },
                              { fieldtype: 'Link', fieldname: 'to_warehouse', options: 'Warehouse', label: __('Into warehouse'), in_list_view: 1, columns: 3 },
                          ] },
                    ],
                    primary_action_label: __('Receive'),
                    primary_action: () => {
                        const lines = (dialog.fields_dict.lines.grid.get_data() || []).filter(l => flt_of(l.qty) > 0);
                        if (!lines.length) return frappe.msgprint(__('Enter the quantity received for at least one line.'));
                        for (const l of lines) {
                            if (flt_of(l.qty) - flt_of(l.pending_qty) > 0.0005)
                                return frappe.msgprint(__('{0}: cannot receive {1} — only {2} pending.', [frappe.utils.escape_html(l.target_item), l.qty, l.pending_qty]));
                            if (!l.to_warehouse) return frappe.msgprint(__('{0}: choose the warehouse it goes to.', [frappe.utils.escape_html(l.target_item)]));
                        }
                        dialog.get_primary_btn().attr('disabled', true);
                        frappe.call({
                            method: 'erp_dacsinc_custom.uniform_transfer_api.receive_embroidery_transfer',
                            args: { transfer_id, lines: lines.map(l => ({ row: l.row, qty: flt_of(l.qty), to_warehouse: l.to_warehouse })) },
                            freeze: true, freeze_message: __('Receiving…'),
                        }).then(res => {
                            dialog.hide();
                            const m = res.message || {};
                            frappe.show_alert({ indicator: 'green', message: m.status === 'Received'
                                ? __('All items received back — transfer complete.')
                                : __('Received. {0} still pending on this transfer.', [flt_of(m.outstanding)]) });
                            this.refresh(true);
                        }).always(() => dialog.get_primary_btn().attr('disabled', false));
                    },
                });
                dialog.$wrapper.addClass('of-receive-lines-dialog');   // fixed lines: no add / upload
                dialog.show();
            });
        });

        // Embroidery Transfer Create Click Handler
        this.$body.on('click', '#of-create-transfer-btn', () => {
            this.prompt_create_transfer();
        });

        // ── Logistics tab: one Update prompt (Transporter, LR No, Signed Copy) ──
        // All three are allow_on_submit on Sales Invoice; saved together by
        // order_flow_api.update_logistics_fields.
        this.$body.on('click', '.of-logi-update-btn', (e) => {
            const $b = $(e.currentTarget);
            const name = $b.data('name');
            const d = new frappe.ui.Dialog({
                title: __('Delivery Paperwork — {0}', [name]),
                fields: [
                    // Only suppliers marked "Is Transporter" — same filter India
                    // Compliance puts on the Sales Invoice form's own field.
                    { fieldtype: 'Link', fieldname: 'transporter', label: __('Transporter'), options: 'Supplier',
                      default: $b.attr('data-transporter') || '',
                      get_query: () => ({ filters: { is_transporter: 1, disabled: 0 } }) },
                    { fieldtype: 'Data', fieldname: 'lr_no', label: __('LR No'), default: $b.attr('data-lr') || '' },
                    { fieldtype: 'Attach', fieldname: 'signed_copy', label: __('Signed Copy'), default: $b.attr('data-signed') || '' },
                    { fieldtype: 'HTML', options: `<div class="of-micro text-muted">${__('The invoice leaves this list once it has an LR No or a Signed Copy.')}</div>` }
                ],
                primary_action_label: __('Update'),
                primary_action: (v) => {
                    frappe.call({
                        method: 'erp_dacsinc_custom.order_flow_api.update_logistics_fields',
                        args: { sales_invoice: name, transporter: v.transporter || '', lr_no: v.lr_no || '', signed_copy: v.signed_copy || '' },
                        freeze: true, freeze_message: __('Saving…')
                    }).then(r => {
                        if (!r.message) return;
                        d.hide();
                        frappe.show_alert({ message: __('{0} updated.', [name]), indicator: 'green' });
                        this.refresh(true);
                    });
                }
            });
            d.show();
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

            // Embroidery Work Orders are internal: the order's Embroidery popup
            // stands in for them; every other document opens as before.
            const so_of_row = element.closest('tr[data-so]').attr('data-so');
            if (docs.some(d => d.doctype === 'Embroidery Work Order') && so_of_row) {
                docs = docs.filter(d => d.doctype !== 'Embroidery Work Order');
                if (!docs.length) {
                    frappe.require('/assets/erp_dacsinc_custom/js/sales_order.js', () => window.so_show_so_embroidery(so_of_row));
                    return;
                }
            }

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
        this.reset_all_pagination();
        this.refresh(true);
    }

    // ── Pagination ───────────────────────────────────────────────
    // "Page 1" means something different the moment any shared filter
    // (search/scope/days/merchandiser/stage/etc.) changes the underlying
    // matching set — every such filter change must land back on page 1 for
    // every tab, not leave some tabs stranded on a page number that may no
    // longer exist once they're switched to.
    reset_all_pagination() {
        Object.keys(this.pagination).forEach(tab => {
            const p = this.pagination[tab];
            if ('page' in p) {
                p.page = 1;
            } else {
                Object.keys(p).forEach(k => { p[k].page = 1; });
            }
        });
    }

    // {page, page_size} args for the active tab's frappe.call — a flat
    // {page, page_size} for a single-list tab, or `${key}_page`/
    // `${key}_page_size` per sub-list for a multi-list tab (matching each
    // backend method's own parameter names exactly).
    build_pagination_args(tab) {
        const p = this.pagination[tab];
        if (!p) return {};
        if ('page' in p) return { page: p.page, page_size: p.page_size };
        const out = {};
        Object.keys(p).forEach(k => {
            out[`${k}_page`] = p[k].page;
            out[`${k}_page_size`] = p[k].page_size;
        });
        return out;
    }

    // {po_docstatus: 'draft', ...} from this.docstatus_filter[tab] — skips
    // empty ('All') entries so a tab with no filter selected sends nothing
    // extra, same default-mixing behaviour the server already had before
    // this filter existed.
    build_docstatus_args(tab) {
        const d = this.docstatus_filter[tab];
        if (!d) return {};
        const out = {};
        Object.keys(d).forEach(k => {
            if (d[k]) out[`${k}_docstatus`] = d[k];
        });
        return out;
    }

    // Same shape as build_pagination_args, but joined into the cache key so
    // paging forward/back (or changing page size) is treated as a distinct
    // fetch — without this, page 2 would silently reuse page 1's cached rows.
    pagination_cache_part(tab) {
        const p = this.pagination[tab];
        if (!p) return '';
        if ('page' in p) return `${p.page}:${p.page_size}`;
        return Object.keys(p).sort().map(k => `${k}=${p[k].page}:${p[k].page_size}`).join(',');
    }

    set_page(tab, sublist, page) {
        const p = this.pagination[tab];
        if (!p || page < 1) return;
        if (sublist) { p[sublist].page = page; } else { p.page = page; }
        this.refresh();
    }

    set_page_size(tab, sublist, size) {
        const p = this.pagination[tab];
        if (!p) return;
        if (sublist) { p[sublist].page = 1; p[sublist].page_size = size; }
        else { p.page = 1; p.page_size = size; }
        this.refresh();
    }

    // The "All Merchandisers" filter belongs to the SO Approvals and Sales
    // Tracker tabs — every other tab deliberately shows the full downstream
    // picture, unscoped by merchandiser. Gated the same way as Approvals
    // (admin / final-approver only): a plain Merchandiser User is already
    // scoped to their own customers automatically (is_scoped_to_own_customers
    // on the server), so a "pick a merchandiser" dropdown would be redundant
    // for them and could only ever show their own name anyway.
    // Scoped merchandiser only: "Show my customers' orders" (kept per user on the server,
    // order_flow_permissions.set_show_my_customers) — every tab follows it.
    update_my_customers_toggle() {
        const $t = this.$body && this.$body.find('#of-my-customers');
        if (!$t || !$t.length) return;
        const show = !!(this.perms && this.perms.scoped_merchandiser);
        $t.toggle(show);
        $t.find('input').prop('checked', !!(this.perms && this.perms.show_my_customers));
        this.$body.find('#of-show-pos input').prop('checked', !!(this.perms && this.perms.show_pos_docs));
        this.update_show_pos_visibility();
    }

    // "Show POS documents" only where it filters something: Finance › Receivables,
    // Logistics and Sales Tracker › Material Requests (stores' stock requests).
    update_show_pos_visibility() {
        const t = this.active;
        const show = !!this.perms && ((t === 'accounts' && (this.acc_subtab || 'receivables') === 'receivables') || t === 'logistics' || (t === 'tracker' && this.tracker_subtab === 'mr'));
        this.$body.find('#of-show-pos').toggle(show);
    }

    update_merchandiser_visibility() {
        const can_final = !!(this.perms && this.perms.is_final_approver);
        const is_admin = frappe.user_roles.includes("System Manager") || frappe.session.user === "Administrator";
        const show = (this.active === 'approval' || this.active === 'tracker') && (can_final || is_admin);
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
        this.$body.find('#of-stage-bar').toggleClass('of-hidden', tab !== 'tracker' || this.tracker_subtab !== 'so');
        this.$body.find('#of-approval-stage').toggle(tab === 'approval');
        this.$body.find('#of-uniform-status').toggle(tab === 'uniform');
        this.$body.find('#of-stock-warehouse').toggle(tab === 'stock');
        this.$body.find('#of-tracker-industry').toggle(tab === 'tracker' && this.tracker_subtab === 'so');
        // Scope/days scope Sales-Order-linked activity, which the Stock
        // Tracker's global item report has none of.
        // Stock Tracker is a live report (neither applies); SO Approvals lists
        // what is pending approval, so "Open / All" has no meaning there —
        // its "Last N days" still applies.
        this.$body.find('#of-days').toggle(tab !== 'stock');
        this.$body.find('#of-count').toggle(!['accounts', 'purchase', 'jobwork', 'tracker'].includes(tab));   // the summary cards carry the counts
        this.$body.find('#of-daterange').toggle(tab !== 'stock' && this.$body.find('#of-days').val() === 'custom');
        this.$body.find('#of-scope').toggle(tab !== 'stock' && tab !== 'approval');
        this.update_merchandiser_visibility();
        this.update_show_pos_visibility();

        // Dynamic context-aware search placeholder
        const placeholders = {
            tracker: __('Search Sales Order #, Customer PO #, Customer, Item…'),
            purchase: __('Search Purchase Order #, Supplier, Sales Order, Item, LR Number…'),
            jobwork: __('Search Job Work #, Supplier, Purchase Order, Sales Order…'),
            stock: __('Search item code, item name…'),
            picklist: __('Search Pick List #, Customer, Sales Order, Item…'),
            billing: __('Search Sales Order #, Customer…'),
            accounts: __('Search Invoice #, Customer, Supplier, Sales Order…'),
            approval: __('Search Sales Order #, Customer…'),
            uniform: __('Search transfers…'),
            logistics: __('Search Sales Invoice #, Customer…')
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
        this.save_view_prefs();

        // Open rows (Item Stock & Action Plan widgets, item lists, embroidery /
        // transfer / stock breakdowns) stay open across this refresh: paint_keeping_view
        // records them at the moment of repainting — not when the refresh started, so
        // a row opened while the data was loading is kept too — and reopens them with
        // fresh data, showing the old content until the new arrives.
        if (force) this.clear_pending_updates();

        // Sales Tracker's stage counts are a server call as heavy as the rows: asked for only
        // after the rows arrive (below), so the two don't compete and the table shows first.
        // Other tabs build their cards from the rows' own data (a "loading" note until then).
        if (this.active !== 'tracker') this.load_summary();
        if (force) this.cache = {};

        const key = `${this.active}:${this.days}:${this.scope}:${this.stage_filter}:${this.search}:${this.merchandiser_filter}:${this.approval_stage_filter}:${this.uniform_status_filter}:${this.stock_warehouse_filter}:${this.tracker_industry_filter}:${JSON.stringify(this.docstatus_filter[this.active] || {})}:${this.pagination_cache_part(this.active)}:${JSON.stringify(this.party_args(this.active))}`;
        if (this.cache[key]) {
            this._req_seq = (this._req_seq || 0) + 1;   // any answer still on its way is now stale
            this.$body.find(`#of-panel-${this.active}`).removeClass('of-is-loading');
            this.collect_filter_options(this.cache[key]);
            this.paint_keeping_view(this.cache[key]);
            this.load_summary();
            this.load_activity();
            return;
        }

        const panel = this.$body.find(`#of-panel-${this.active}`);
        if (!panel.children().length) {
            panel.html(`<div class="of-card"><div class="of-empty">
                <i class="fa fa-spinner fa-spin"></i> Loading data…</div></div>`);
        }
        // A filter changed again before this answer came back: only the latest request paints
        // (an older, slower answer must not repaint over it). The table dims meanwhile, so the
        // change is visibly taken at once.
        const req = this._req_seq = (this._req_seq || 0) + 1;
        const tab = this.active;
        panel.addClass('of-is-loading');

        const method = {
            tracker:  'erp_dacsinc_custom.order_flow_api.get_sales_tracker',
            purchase: 'erp_dacsinc_custom.order_flow_api.get_purchase_flow',
            jobwork:  'erp_dacsinc_custom.order_flow_api.get_jobwork_flow',
            stock:    'erp_dacsinc_custom.order_flow_api.get_stock_tracker',
            picklist: 'erp_dacsinc_custom.order_flow_api.get_pick_list_flow',
            billing:  'erp_dacsinc_custom.order_flow_api.get_billing_flow',
            accounts: 'erp_dacsinc_custom.order_flow_api.get_accounts_flow',
            approval: 'erp_dacsinc_custom.order_flow_api.get_pending_approvals',
            uniform:  'erp_dacsinc_custom.uniform_transfer_api.get_embroidery_transfers',
            logistics: 'erp_dacsinc_custom.order_flow_api.get_logistics_flow'
        }[this.active];

        // merchandiser only narrows Approvals and Tracker — every other tab
        // stays unscoped by it (see update_merchandiser_visibility)
        const merch = (this.active === 'approval' || this.active === 'tracker') ? (this.merchandiser_filter || null) : null;
        const args = { days: this.days, search: this.search || null, scope: this.scope, merchandiser: merch, approval_stage: this.approval_stage_filter || null };
        if (this.active === 'tracker') {
            args.stage_filter = this.stage_filter;
            args.industry = this.tracker_industry_filter || null;
        }
        if (this.active === 'uniform') {
            args.status = this.uniform_status_filter || null;
        }
        if (this.active === 'stock') {
            args.warehouse = this.stock_warehouse_filter || null;
        }
        Object.assign(args, this.build_pagination_args(this.active));
        Object.assign(args, this.build_docstatus_args(this.active));
        Object.assign(args, this.party_args(this.active));

        frappe.call({ method, args }).then(r => {
            const data = r.message;
            this.cache[key] = data;
            if (tab !== this.active) { panel.removeClass('of-is-loading'); return; }   // left this tab
            if (req !== this._req_seq) return;   // superseded by a newer filter change
            panel.removeClass('of-is-loading');
            this.collect_filter_options(data);
            this.paint_keeping_view(data);
            this.load_summary();
            this.load_activity();
        }, () => { if (req === this._req_seq) panel.removeClass('of-is-loading'); });
    }

    load_summary() {
        if (this.active === 'stock') return; // live report, no summary tiles
        if (this.active === 'picklist') return; // counts render inline in the card header
        if (this.active === 'tracker') {
            const req = this._summary_seq = (this._summary_seq || 0) + 1;
            frappe.call({
                method: 'erp_dacsinc_custom.order_flow_api.get_summary',
                // Same filters as the rows below it — merchandiser included — so a
                // stage card's count always equals what clicking it lists.
                args: Object.assign({ days: this.days, scope: this.scope, search: this.search || null, merchandiser: this.merchandiser_filter || null, approval_stage: this.approval_stage_filter || null, industry: this.tracker_industry_filter || null }, this.party_args('tracker'))
            }).then(r => {
                if (req !== this._summary_seq || this.active !== 'tracker') return;   // superseded
                const s = r.message || {};
                this.render_tracker_summary(s);
            });
        } else {
            const key = `${this.active}:${this.days}:${this.scope}:${this.stage_filter}:${this.search}:${this.merchandiser_filter}:${this.approval_stage_filter}:${this.uniform_status_filter}:${this.stock_warehouse_filter}:${this.tracker_industry_filter}:${JSON.stringify(this.docstatus_filter[this.active] || {})}:${this.pagination_cache_part(this.active)}:${JSON.stringify(this.party_args(this.active))}`;
            const data = this.cache[key];
            if (data) {
                if (this.active === 'purchase') this.render_purchase_summary(data);
                if (this.active === 'jobwork') this.render_jobwork_summary(data);
                if (this.active === 'billing') this.render_billing_summary(data);
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

    // Stages hidden from this tab whenever the viewer lacks of_tab_billing_roles
    // access — see get_summary/get_sales_tracker in order_flow_api.py. Their count
    // comes back as null (not 0) specifically so this can tell "nothing pending"
    // apart from "hidden from you".
    of_stage_restricted(s, key) {
        return s && s.billing_visible === false && (key === 'need_to_bill' || key === 'ready_to_deliver');
    }

    render_tracker_summary(s) {
        s = s || {};

        const tiles = OF_STAGES.map(st => {
            const restricted = this.of_stage_restricted(s, st.key);
            const value = of_num(s[OF_STAGE_COUNT_KEY[st.key]]);
            // "Overdue" is only alarming when there is something in it.
            const mod = (st.key === 'overdue' && !value) ? 'ok' : st.tile;
            return `
            <div class="of-tile of-tile--${mod} ${this.stage_filter === st.key ? 'is-active' : ''} ${restricted ? 'is-restricted' : ''}"
                 data-stage="${st.key}" title="${restricted ? __('Restricted — you do not have access to the Pending DN/SI tab') : of_esc(st.hint)}">
                <span class="of-tile__label">${__(st.label === 'All Open' ? 'Open Orders' : st.label)}</span>
                <div class="of-tile__value">${restricted ? '&#128274;' : value}</div>
                <span class="of-tile__hint">${restricted ? __('Restricted') : __('Click to filter')}</span>
            </div>`;
        }).join('');

        this.$body.find('#of-summary').html(tiles);
        this.render_stage_counts(s);
    }

    /**
     * "How much are you actually picking?" before a draft Pick List is
     * submitted. Submitting sets each line's picked_qty and reserves that
     * stock, so committing the full allocated qty on a bare confirm was wrong
     * whenever less was physically picked.
     *
     * Quantities may only be REDUCED — update_and_submit_pick_list enforces
     * the same ceiling server-side and names the offending item if exceeded,
     * so this input is capped rather than being the only guard.
     */
    prompt_submit_pick_list(pl, $btn) {
        const restore = () => $btn.prop('disabled', false)
            .html(`<i class="fa fa-check"></i> ${__('Submit')}`);

        frappe.call({
            method: 'erp_dacsinc_custom.order_flow_api.get_pick_list_rows',
            args: { pick_list: pl },
            freeze: true,
            freeze_message: __('Loading Pick List…'),
        }).then(r => {
            const rows = (r && r.message) || [];
            if (!rows.length) {
                frappe.msgprint(__('Pick List {0} has no item lines.', [pl]));
                return;
            }

            const body = `
                <p class="of-micro" style="margin:0 2px 10px; color:var(--text-muted);">
                    ${__('Enter what was actually picked. Submitting reserves this stock and cannot be undone without cancelling. A qty can only be reduced, never raised above what was allocated.')}
                </p>
                <div class="of-scroll"><table class="of-table">
                    <thead><tr>
                        <th>${__('Item')}</th>
                        <th>${__('Warehouse')}</th>
                        <th class="text-right">${__('Allocated')}</th>
                        <th class="text-right">${__('Picking now')}</th>
                    </tr></thead>
                    <tbody>${rows.map((x, i) => `
                        <tr>
                            <td>${of_esc(x.item_code)}${x.item_name && x.item_name !== x.item_code
                                ? `<div class="of-micro text-muted">${of_esc(x.item_name)}</div>` : ''}</td>
                            <td class="of-meta">${of_esc(x.warehouse || '—')}</td>
                            <td class="text-right">${of_round2(x.qty)} ${of_esc(x.uom || x.stock_uom || '')}</td>
                            <td class="text-right">
                                <input type="number" class="form-control input-sm of-pick-qty"
                                       data-idx="${i}" data-max="${flt_of(x.qty)}"
                                       value="${of_round2(x.qty)}" min="0" max="${flt_of(x.qty)}" step="any"
                                       style="width:96px; display:inline-block; text-align:right; font-weight:700;">
                            </td>
                        </tr>`).join('')}</tbody>
                </table></div>`;

            const dialog = new frappe.ui.Dialog({
                title: __('Submit Pick List {0}', [pl]),
                size: 'large',
                fields: [{ fieldtype: 'HTML', fieldname: 'picking' }],
                primary_action_label: __('Submit Pick List'),
                primary_action: () => {
                    const payload = [];
                    let over = null;
                    dialog.$wrapper.find('.of-pick-qty').each(function () {
                        const $inp = $(this);
                        const row = rows[parseInt($inp.data('idx'), 10)];
                        const max = flt_of($inp.data('max'));
                        const val = flt_of($inp.val());
                        if (!row) return;
                        if (val - max > 0.001) {
                            over = { item: row.item_code, val: val, max: max };
                            return false;
                        }
                        if (val > 0.001) {
                            payload.push({ pick_list_item: row.pick_list_item, qty: val });
                        }
                    });

                    if (over) {
                        frappe.msgprint({
                            title: __('Quantity too high'), indicator: 'red',
                            message: __('{0}: only {1} was allocated to this line, but {2} was entered. A Pick List qty can only be reduced.',
                                [over.item, over.max, over.val])
                        });
                        return;
                    }
                    if (!payload.length) {
                        frappe.msgprint(__('Enter a picked qty on at least one line — a Pick List cannot be submitted with nothing picked.'));
                        return;
                    }

                    dialog.hide();
                    $btn.prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i>');
                    frappe.call({
                        method: 'erp_dacsinc_custom.custom_script.update_and_submit_pick_list',
                        // qty_means:'picked' — the line keeps its allocated
                        // qty and picked_qty records what was actually picked.
                        args: { pick_list: pl, rows: payload, submit: 1, qty_means: 'picked' },
                    }).then(() => {
                        const total = payload.reduce((t, x) => t + flt_of(x.qty), 0);
                        frappe.show_alert({
                            message: __('Pick List {0} submitted — {1} picked.', [pl, of_round2(total)]),
                            indicator: 'green'
                        }, 6);
                        this.refresh(true);
                    }).catch(() => {
                        // The server's own message already explains why.
                        restore();
                    });
                },
                secondary_action_label: __('Cancel'),
                secondary_action: () => dialog.hide()
            });
            dialog.fields_dict.picking.$wrapper.html(body);
            dialog.show();
        }).catch(() => restore());
    }

    /** Stages with no orders fold behind "+N more" (UI only — they stay clickable once shown). */
    update_stage_more() {
        const $bar = this.$body.find('#of-stage-bar');
        const n = $bar.find('.of-stage-btn.is-empty:not(.is-active)').length;
        const open = $bar.hasClass('of-stage-bar--all');
        $bar.find('#of-stage-more').toggle(n > 0)
            .text(open ? __('Show less') : __('+{0} more', [n]));
    }

    /** Put the live count on every "Filter by Stage" button. */
    render_stage_counts(s) {
        s = s || {};
        OF_STAGES.forEach(st => {
            const restricted = this.of_stage_restricted(s, st.key);
            const value = of_num(s[OF_STAGE_COUNT_KEY[st.key]]);
            const $btn = this.$body.find(`.of-stage-btn[data-stage="${st.key}"]`);
            $btn.find('.of-stage-count').text(restricted ? '\u{1F512}' : value);
            // A stage with nothing in it stays clickable but recedes.
            $btn.toggleClass('is-empty', !restricted && !value && st.key !== 'all');
        });
        this.update_stage_more();
    }

    render_purchase_summary(data) {
        // Totals come from the server now (each sub-list's own `.total`,
        // plus the dedicated `metrics` aggregate).
        const m = data.metrics || {};
        const po_total = (data.purchase_orders || {}).total || 0;
        const rc_total = (data.receipts || {}).total || 0;

        this.$body.find('#of-summary-purchase').html(of_stat_strip([
            { label: __('Active POs'), value: m.open_pos || 0, tone: 'gold', hint: 'Purchase Orders waiting for receipt' },
            { label: __('Total POs'), value: po_total, tone: 'info', hint: 'Total active Purchase Orders' },
            { label: __('Total Receipts'), value: rc_total, tone: 'green', hint: 'Total Purchase/Subcontracting Receipts' },
            { label: __('Ordered Amount'), value: of_money(m.total_ordered || 0), tone: 'green', hint: 'Grand total of active Purchase Orders' },
        ]));
    }

    render_jobwork_summary(data) {
        const m = data.metrics || {};
        const po_total = (data.purchase_orders || {}).total || 0;
        const ewo_total = ((data.ewo_fp || {}).total || 0) + ((data.ewo_pn || {}).total || 0);

        this.$body.find('#of-summary-jobwork').html(of_stat_strip([
            { label: __('Active Subcontract POs'), value: m.active_pos || 0, tone: 'info', hint: 'Active Subcontracting Purchase Orders' },
            { label: __('Total Subcontract POs'), value: po_total, tone: 'orange', hint: 'Total Subcontracting Purchase Orders' },
            { label: __('Active Embroidery'), value: m.active_ewos || 0, tone: 'amber', hint: 'Active Embroidery Work Orders' },
            { label: __('Total Embroidery'), value: ewo_total, tone: 'purple', hint: 'Total Embroidery Work Orders' },
            { label: __('Pending Subcontract Qty'), value: Math.floor(m.pending_po_qty || 0), tone: 'red', hint: 'Quantity remaining to receive from subcontracting' },
        ]));
    }

    render_accounts_summary(data) {
        const m = data.metrics || {};

        this.$body.find('#of-summary-accounts').html(of_stat_strip([
            { label: __('Customer Receivables'), value: of_money(m.sales_outstanding || 0), tone: 'red', hint: 'Pending customer payments to collect' },
            { label: __('Total Sales Billed'), value: of_money(m.sales_total || 0), tone: 'info', hint: 'Total sales invoice amount' },
            { label: __('Supplier Payables'), value: of_money(m.supplier_outstanding || 0), tone: 'gold', hint: 'Pending supplier payments to make' },
            { label: __('Total Supplier Billed'), value: of_money(m.supplier_total || 0), tone: 'info', hint: 'Total supplier bill amount' },
            { label: __('Jobber Payables'), value: of_money(m.jobber_outstanding || 0), tone: 'amber', hint: 'Pending jobber payments to make' },
            { label: __('Total Jobber Billed'), value: of_money(m.jobber_total || 0), tone: 'purple', hint: 'Total jobber bill amount' },
        ]));
    }

    render_billing_summary(data) {
        const m = (data && data.metrics) || {};

        this.$body.find('#of-summary-billing').html(of_stat_strip([
            { label: __('Orders Pending DN/SI'), value: m.count || 0, tone: 'gold', hint: 'Sales Orders with a submitted Pick List, waiting on a Delivery Note or Sales Invoice' },
            { label: __('Order Value Pending'), value: of_money(m.pending_value || 0), tone: 'red', hint: 'Grand total still to be delivered/billed across these orders' },
        ]));
    }

    load_activity() {
        // The stream is Sales Order milestones: nothing to load for a user who can't read them.
        if (this.perms && this.perms.reads_sales_orders === false) {
            this.render_activity([]);
            return;
        }
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
                search: this.search || null,
                ...this.party_args(this.active)
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

        const bell_fresh = this.filter_tab_rows(rows, this.active).filter(x => !of_is_seen(x, this.active)).length;
        this.$body.find('#of-bell-count').text(bell_fresh).toggleClass('of-hidden', !bell_fresh);

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
                    <button class="of-btn of-btn--sm of-stream-close" title="${__('Close')}"><i class="fa fa-times"></i></button>
                </div>
                <div class="of-feed" id="of-activity-container-${tab_name}">
                    <div id="of-activity-${tab_name}">
                        <div class="of-empty"><i class="fa fa-spinner fa-spin"></i> Loading notifications…</div>
                    </div>
                </div>
            </div>`;
    }

    toggle_so_details(so_name, $btn) {
        const $row = $btn.closest('tr.of-row-main');
        let $details_row = $row.next('.of-so-details-row');

        if (!$details_row.length) {
            // Reused across several tables (Tracker, Approval, Accounts) with
            // different column counts, so span whatever the actual row has
            // rather than a fixed number.
            const colspan = $row.find('td').length || 8;
            $details_row = $(`
                <tr class="of-so-details-row of-hidden" style="display:none;">
                    <td colspan="${colspan}" style="padding:15px; background:var(--subtle-fg); text-align:left;">
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

            // Always re-fetch on expand, never reuse whatever was already
            // sitting in this container. This widget's own subtitle promises
            // "Real-Time Availability" — but a Purchase Order, Material
            // Request or Pick List raised from one of its own Next Action
            // buttons opens (or navigates to) a SEPARATE document outside
            // this dashboard's own refresh cycle, so collapsing and
            // re-expanding the SAME row without an intervening full-table
            // repaint used to just re-show the exact stock snapshot from
            // before that action — stale until the whole page was reloaded.
            // load_so_details fetches via frappe.model.with_doc, which only
            // serves a doc from the client-side cache when one already
            // exists there — dropping it first forces a real getdoc call.
            const $container = $details_row.find('.of-so-items-container');
            frappe.model.remove_from_locals('Sales Order', so_name);
            this.load_so_details(so_name, $container);
        } else {
            $details_row.addClass('of-hidden').hide();
            $btn.removeClass('fa-caret-down').addClass('fa-caret-right').css('color', 'var(--text-light)');
        }
    }

    load_so_details(so_name, $container, callback) {
        frappe.model.with_doc('Sales Order', so_name, () => {
            const doc = frappe.model.get_doc('Sales Order', so_name);
            if (!doc) {
                $container.html('<div class="alert alert-danger">Could not load Sales Order document details.</div>');
                return;
            }

            const store = (this.so_open_rows = this.so_open_rows || {});
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

            // The widget remembers which item rows have their raw materials open in
            // frm._so_open_rows; keep that per order here, so a reload reopens them.
            Object.defineProperty(mock_frm, '_so_open_rows', {
                get: () => store[so_name] || [], set: (v) => { store[so_name] = v; }, configurable: true,
            });
            $container.data('mock_frm', mock_frm);
            window.cur_frm = mock_frm;

            if (typeof generate_stock_overview_table === 'function') {
                // `callback` fires once custom_stock_data is fully populated
                // (generate_stock_overview_table's own contract) — used by
                // callers that need the computed data (so_collect_pending_fg
                // etc.) rather than the rendered table itself, e.g. driving
                // the "Finished Item MR" dialog straight from the tracker
                // without the widget ever being visible.
                generate_stock_overview_table(mock_frm, () => { if (callback) callback(mock_frm); });
                this.strip_actions_if_view_only($container);
            } else {
                $container.html('<div class="alert alert-warning">generate_stock_overview_table function not found.</div>');
                if (callback) callback(null);
            }
        });
    }

    // "Raise MR from SO" from the Action Required column, for an order whose
    // pending lines are plain trade items (no BOM at all) — opens the same
    // "Finished Item MR" dialog the Sales Order's own widget offers, instead
    // of bouncing the user there to find it themselves. Builds the same
    // mock_frm + off-screen container load_so_details already uses for the
    // tracker's inline stock widget, so the numbers are computed exactly the
    // same way — this never re-derives them independently.
    open_fg_mr_prompt_from_tracker(so_name) {
        const fallback_to_so = () => window.open(frappe.utils.get_form_link('Sales Order', so_name), '_blank');
        let settled = false;
        const settle = (fn) => { if (!settled) { settled = true; fn(); } };

        // Guards against generate_stock_overview_table's own early-return
        // paths (e.g. its stock-details call failing) never invoking the
        // callback — falls back rather than leaving the freeze indicator
        // (or the user) waiting on nothing.
        const timeout = setTimeout(() => settle(fallback_to_so), 10000);

        frappe.dom.freeze(__('Checking pending items…'));
        const $hidden = $('<div>').appendTo(document.body).hide();

        frappe.require('/assets/erp_dacsinc_custom/js/sales_order.js', () => {
            this.load_so_details(so_name, $hidden, (mock_frm) => {
                clearTimeout(timeout);
                frappe.dom.unfreeze();
                $hidden.remove();

                if (!mock_frm || typeof so_collect_pending_fg !== 'function'
                        || typeof so_make_fg_material_request_all !== 'function') {
                    settle(fallback_to_so);
                    return;
                }
                const pending_fg = so_collect_pending_fg(mock_frm);
                if (!pending_fg.length) {
                    // Nothing actually short (already fully requested/ordered
                    // on paper) — the tracker's own "X Still Short" figure can
                    // lag a step behind a request just raised elsewhere.
                    settle(() => frappe.show_alert({
                        message: __('Nothing left to request — already covered.'), indicator: 'green'
                    }));
                    return;
                }
                settle(() => {
                    window.cur_frm = mock_frm;
                    so_make_fg_material_request_all(mock_frm);
                });
            });
        });
    }

    // Row-level "see items" toggle for Purchase Flow / Job Work / Finance —
    // shows that specific document's OWN item child table, not the Sales
    // Order stock widget (these rows are Purchase Orders/Material Requests/
    // Receipts/Invoices, not Sales Orders). Walks the DOM from the clicked
    // row rather than building a lookup id out of the docname, since
    // document names can contain characters ('/', spaces) unsafe in a raw
    // CSS id selector.
    toggle_doc_items_row($row, doctype, docname, $btn) {
        let $details = $row.next('.of-doc-items-row');
        if (!$details.length) {
            const colspan = $row.find('td').length || 8;
            $details = $(`
                <tr class="of-doc-items-row of-hidden" style="display:none;">
                    <td colspan="${colspan}" style="padding:12px 15px; background:var(--subtle-fg); text-align:left;">
                        <div class="of-doc-items-panel"><div class="of-empty"><i class="fa fa-spinner fa-spin"></i> ${__('Loading items…')}</div></div>
                    </td>
                </tr>`);
            $row.after($details);
        }

        const collapsed = $details.hasClass('of-hidden') || !$details.is(':visible');
        if (collapsed) {
            $details.removeClass('of-hidden').show();
            $btn.removeClass('fa-caret-right').addClass('fa-caret-down').css('color', 'var(--of-blue)');

            const $panel = $details.find('.of-doc-items-panel');
            if ($panel.find('.of-empty').length) {
                frappe.call({
                    method: 'erp_dacsinc_custom.order_flow_api.get_document_items',
                    args: { doctype, docname }
                }).then(r => {
                    $panel.html(this.doc_items_table_html(r.message || [], doctype));
                });
            }
        } else {
            $details.addClass('of-hidden').hide();
            $btn.removeClass('fa-caret-down').addClass('fa-caret-right').css('color', 'var(--text-light)');
        }
    }

    doc_items_table_html(rows, doctype) {
        if (!rows.length) {
            return `<div class="of-empty">${__('No items found.')}</div>`;
        }
        const is_mr = doctype === 'Material Request';
        // "How much was ordered and how much has actually come back" is the
        // question this toggle exists to answer — a bare Qty column can't.
        // What that means differs per doctype (see _doc_item_progress), so
        // the column is labelled from the row's own progress_label and a
        // Receipt — where the row IS the arrival — shows no Pending at all
        // rather than a made-up zero.
        const progress_label = rows.find(r => r.progress_label)?.progress_label || __('Received');
        const has_ordered = rows.some(r => r.ordered_qty != null);
        const has_pending = rows.some(r => r.pending_qty != null);
        const show_po_ordered = rows.some(r => r.po_ordered_qty != null);

        const qty_cell = (v, tone) => {
            if (v == null) return '<span class="of-val--zero">—</span>';
            const n = of_round2(v);
            if (!n) return '<span class="of-val--zero">0</span>';
            return tone ? `<span style="color:${tone};font-weight:700;">${n}</span>` : `${n}`;
        };

        const line = it => `<tr>
            <td>${of_esc(it.item_code)}${it.item_name && it.item_name !== it.item_code ? `<div class="of-micro text-muted">${of_esc(it.item_name)}</div>` : ''}</td>
            ${has_ordered ? `<td>${qty_cell(it.ordered_qty)}</td>` : ''}
            ${show_po_ordered ? `<td>${qty_cell(it.po_ordered_qty)}</td>` : ''}
            <td>${qty_cell(it.received_qty, of_num(it.received_qty) > 0 ? 'var(--of-green)' : null)}</td>
            ${has_pending ? `<td>${qty_cell(it.pending_qty, of_num(it.pending_qty) > 0 ? 'var(--of-orange)' : null)}</td>` : ''}
            <td>${of_esc(it.uom || '')}</td>
            ${is_mr ? '' : `<td>${it.rate != null ? of_money(it.rate) : '—'}</td>`}
            <td>${it.role ? `<span class="of-chip">${of_esc(it.role)}</span>` : ''}</td>
        </tr>`;

        return `<div class="of-scroll"><table class="of-table">
            <thead><tr><th>Item</th>
                ${has_ordered ? `<th>${is_mr ? __('Requested') : __('Ordered')}</th>` : ''}
                ${show_po_ordered ? `<th>${__('On PO')}</th>` : ''}
                <th>${of_esc(progress_label)}</th>
                ${has_pending ? `<th>${__('Pending')}</th>` : ''}
                <th>UOM</th>${is_mr ? '' : '<th>Rate</th>'}<th></th></tr></thead>
            <tbody>${rows.map(line).join('')}</tbody>
        </table></div>`;
    }

    // Item-wise Sent/Received/Pending for one Embroidery Work Order — same
    // get_ewo_details call the receive dialogs already use, just displayed
    // read-only instead of feeding an input.
    toggle_ewo_items_row($row, ewo_name, $btn) {
        let $details = $row.next('.of-ewo-items-row');
        if (!$details.length) {
            const colspan = $row.find('td').length || 10;
            $details = $(`
                <tr class="of-ewo-items-row of-hidden" style="display:none;">
                    <td colspan="${colspan}" style="padding:12px 15px; background:var(--subtle-fg); text-align:left;">
                        <div class="of-ewo-items-panel"><div class="of-empty"><i class="fa fa-spinner fa-spin"></i> ${__('Loading items…')}</div></div>
                    </td>
                </tr>`);
            $row.after($details);
        }

        const collapsed = $details.hasClass('of-hidden') || !$details.is(':visible');
        if (collapsed) {
            $details.removeClass('of-hidden').show();
            $btn.removeClass('fa-caret-right').addClass('fa-caret-down').css('color', 'var(--of-blue)');

            const $panel = $details.find('.of-ewo-items-panel');
            if ($panel.find('.of-empty').length) {
                frappe.call({
                    method: 'erp_dacsinc_custom.purchase_order.get_ewo_details',
                    args: { name: ewo_name }
                }).then(r => {
                    const items = (r.message && r.message.items) || [];
                    $panel.html(this.ewo_items_table_html(items));
                });
            }
        } else {
            $details.addClass('of-hidden').hide();
            $btn.removeClass('fa-caret-down').addClass('fa-caret-right').css('color', 'var(--text-light)');
        }
    }

    ewo_items_table_html(rows) {
        if (!rows.length) {
            return `<div class="of-empty">${__('No items found.')}</div>`;
        }
        const line = it => {
            const sent = of_round2(it.ordered_qty);
            const received = of_round2(it.received_qty);
            const pending = of_round2(sent - received);
            return `<tr>
                <td>${of_esc(it.item_code)}</td>
                <td>${sent}</td>
                <td class="${received > 0 ? 'of-val--pos' : ''}">${received}</td>
                <td class="${pending > 0 ? 'of-val--warn' : ''}">${pending}</td>
            </tr>`;
        };
        return `<div class="of-scroll"><table class="of-table">
            <thead><tr><th>Item</th><th>Sent</th><th>Received</th><th>Pending</th></tr></thead>
            <tbody>${rows.map(line).join('')}</tbody>
        </table></div>`;
    }

    // Embroidery Transfers carry no Sales Order and are already one item per
    // row — the only further detail that exists is the partial-receipt
    // history of that one transfer.
    toggle_transfer_receipts_row($row, transfer_id, $btn) {
        let $details = $row.next('.of-doc-items-row');
        if (!$details.length) {
            const colspan = $row.find('td').length || 8;
            $details = $(`
                <tr class="of-doc-items-row of-hidden" style="display:none;">
                    <td colspan="${colspan}" style="padding:12px 15px; background:var(--subtle-fg); text-align:left;">
                        <div class="of-doc-items-panel"><div class="of-empty"><i class="fa fa-spinner fa-spin"></i> ${__('Loading receipt history…')}</div></div>
                    </td>
                </tr>`);
            $row.after($details);
        }

        const collapsed = $details.hasClass('of-hidden') || !$details.is(':visible');
        if (collapsed) {
            $details.removeClass('of-hidden').show();
            $btn.removeClass('fa-caret-right').addClass('fa-caret-down').css('color', 'var(--of-blue)');

            const $panel = $details.find('.of-doc-items-panel');
            if ($panel.find('.of-empty').length) {
                frappe.call({
                    method: 'erp_dacsinc_custom.uniform_transfer_api.get_transfer_receipts',
                    args: { transfer_id }
                }).then(r => {
                    const d = r.message || {};
                    const items = d.items || [], rcpts = d.receipts || [];
                    const item_tbl = `<div class="of-micro" style="font-weight:600;margin-bottom:4px;">${__('Items')}</div>
                        <div class="of-scroll"><table class="of-table">
                        <thead><tr><th>#</th><th>${__('Plain item (sent)')}</th><th>${__('Embroidered item (comes back)')}</th><th>${__('Sent')}</th><th>${__('Received')}</th><th>${__('Pending')}</th></tr></thead>
                        <tbody>${items.map(l => `<tr>
                            <td>${l.idx}</td><td style="text-align:left;">${of_esc(l.source_item)}</td>
                            <td style="text-align:left;">${l.same_item ? `<span class="of-chip">${__('same item')}</span>` : of_esc(l.target_item)}</td>
                            <td>${of_round2(l.qty)} ${of_esc(l.uom || '')}</td>
                            <td style="color:var(--of-green);">${of_round2(l.received_qty)}</td>
                            <td style="color:${flt_of(l.pending_qty) > 0 ? 'var(--of-orange)' : 'var(--text-muted)'};font-weight:600;">${of_round2(l.pending_qty)}</td>
                        </tr>`).join('')}</tbody></table></div>`;
                    const rc_tbl = rcpts.length ? `<div class="of-micro" style="font-weight:600;margin:10px 0 4px;">${__('Received back')}</div>
                        <div class="of-scroll"><table class="of-table">
                        <thead><tr><th>${__('Date')}</th><th>${__('Item')}</th><th>${__('Qty')}</th><th>${__('Into warehouse')}</th><th>${__('Stock Entry')}</th></tr></thead>
                        <tbody>${rcpts.map(rc => `<tr>
                            <td>${of_date(rc.date)}</td><td style="text-align:left;">${of_esc(rc.target_item || '')}</td>
                            <td>${of_round2(rc.qty)}</td><td>${of_esc(rc.to_warehouse || '')}</td>
                            <td>${rc.stock_entry ? `<a href="/app/stock-entry/${encodeURIComponent(rc.stock_entry)}" target="_blank">${of_esc(rc.stock_entry)}</a>` : '—'}</td>
                        </tr>`).join('')}</tbody></table></div>` : `<div class="of-micro text-muted" style="margin-top:8px;">${__('Nothing received back yet.')}</div>`;
                    $panel.html(item_tbl + rc_tbl);
                });
            }
        } else {
            $details.addClass('of-hidden').hide();
            $btn.removeClass('fa-caret-down').addClass('fa-caret-right').css('color', 'var(--text-light)');
        }
    }

    // generate_stock_overview_table (sales_order.js) is shared with the real
    // Sales Order form, so it can't be told "render without action buttons" —
    // it always renders Purchase Order / Material Request / Pick / Subcontract
    // PO / Delivery Note buttons for whoever has permission. Strip them here,
    // in the dashboard's own mount point only, for a view-only Merchandiser
    // User (see tracker_html's `view_only` for the matching top-level-row
    // treatment). so-btn--view and the refresh button stay — those just look,
    // they don't act.
    // A Merchandiser User only ever sees their own orders here; whether they may ACT on
    // them follows the access sheet's tab cells (A = can act, ✓ = view) like everyone
    // else's — not a blanket "merchandisers only look".
    merch_view_only(tab, sub) {
        return !!(this.perms && this.perms.tracker_scoped_to_own_customers) && !this.can_act(tab, sub);
    }

    strip_actions_if_view_only($container) {
        if (!this.merch_view_only(this.active, this.active === 'tracker' ? (this.tracker_subtab || 'so') : null)) return;
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
            if (this.active === 'tracker') {
                html = this.tracker_html(data);
                this.load_ewo_receive_actions(data);
            }
            if (this.active === 'purchase') html = this.purchase_html(data);
            if (this.active === 'jobwork') {
                html = this.jobwork_html(data);
                this.load_ewo_receive_actions(data);
            }
            if (this.active === 'stock') {
                this._stock_items = (data && data.rows) || []; // for toggle_stock_wh_row's warehouse drill-down
                html = this.stock_html(data);
            }
            if (this.active === 'picklist') html = this.picklist_html(data);
            if (this.active === 'billing')  html = this.billing_html(data);
            if (this.active === 'accounts') html = this.accounts_html(data);
            if (this.active === 'approval') html = this.approval_html(data);
            if (this.active === 'uniform')  html = this.uniform_html(data);
            if (this.active === 'logistics') html = this.logistics_html(data);
            const focus = this.park_shared_controls();
            panel.html(html);
            this.mount_table_filters();
            this.place_shared_controls(focus);
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

    // The toolbar count follows the visible subtab. Subtab switches only
    // toggle sections (no repaint), so the click handler calls this too.
    set_tracker_count(data) {
        data = data || {};
        const n = {
            so: data.total ? __('{0} order(s) match', [data.total]) : '',
            mr: __('{0} Material Requests', [(data.material_requests || {}).total || 0]),
            fp: __('{0} Full Piece work orders', [(data.ewo_fp || {}).total || 0]),
            pn: __('{0} Panel work orders', [(data.ewo_pn || {}).total || 0]),
        }[this.tracker_subtab || 'so'];
        this.$body.find('#of-count').text(n || '');
    }

    // ── Tab 1: tracker ───────────────────────────────────────────
    tracker_html(data) {
        data = data || {};
        const orders = data.rows || [];
        const mrs_env = data.material_requests || {};
        const mrs = mrs_env.rows || [];
        const subtab = this.tracker_subtab || 'so';
        const ewo_fp_env = data.ewo_fp || {};
        const ewo_pn_env = data.ewo_pn || {};

        this._tracker_data = data;
        this.set_tracker_count(data);

        const truncated_note = (subtab === 'so' && data.truncated) ? `
            <div class="of-truncated-note"><i class="fa fa-exclamation-triangle"></i>
                ${__('Too many matching orders to compute stages for all of them — showing the most recent 5,000. Narrow the search or date range to see the rest.')}
            </div>` : '';

        const view_only = this.merch_view_only('tracker', 'so');

        const mr_rows = mrs.map(m => {
            const pending = flt_of(m.qty) - flt_of(m.ordered_qty);
            // ERPNext's own per_ordered/per_received on a Material Request
            // can get stuck just under 100% by a floating-point remainder —
            // every line ordered AND received to at least its requested qty,
            // nothing genuinely outstanding, yet neither figure ever quite
            // reaches the exact 100 the core status check wants, so status
            // reads "Partially Ordered" forever even past full receipt.
            // Confirmed live: MAT-MR-2026-00043, per_ordered AND per_received
            // both 99.999953, every one of its 20 lines individually ordered
            // AND received >= requested. This dashboard's own "Not ordered"
            // column (pending, below) and Action column already
            // independently agree ordering is done; received_pending is that
            // same math applied to receiving, so a MR that has gone all the
            // way to received is labelled "Received", not left one step
            // behind at "Ordered". Only ever moves a status FORWARD along
            // Pending -> Partially Ordered -> Ordered -> Received, and only
            // when this dashboard's own qty math says the next stage is
            // genuinely done — anything outside that progression (Stopped,
            // Cancelled, Transferred, or already Received) is left exactly
            // as ERPNext itself reports it.
            const received_pending = flt_of(m.qty) - flt_of(m.received_qty);
            // Two separate upgrade paths, checked in this order — receiving
            // first. A status of "Partially Received" already means ordering
            // is done and receiving has genuinely started; if only some of
            // it is in yet (received_pending still material), that status is
            // ALREADY correct and must not be overwritten by the ordering
            // check below just because pending (the ordering gap) reads 0 —
            // an earlier version of this fix did exactly that and silently
            // downgraded a real 50%-received MR back to "Ordered".
            let mr_status = m.status;
            if (['Pending', 'Partially Ordered', 'Ordered', 'Partially Received'].includes(m.status)
                    && received_pending <= 0.01) {
                mr_status = 'Received';
            } else if (['Pending', 'Partially Ordered'].includes(m.status) && pending <= 0.01) {
                mr_status = 'Ordered';
            }
            return `<tr class="of-doc-row">
                <td><i class="fa fa-caret-right of-doc-items-toggle" data-doctype="Material Request" data-docname="${of_esc(m.name)}" data-docstatus="${m.docstatus}" style="cursor:pointer;margin-right:4px;color:var(--text-light);"></i>
                    <a href="/app/material-request/${encodeURIComponent(m.name)}" target="_blank" style="font-weight:700;">${of_esc(m.name)}</a>
                    <div class="of-micro">${of_esc(m.material_request_type || '')}</div>
                    ${of_creator_html(m)}</td>
                <td>${of_so_links(m.sales_orders)}
                    ${m.so_customer_names ? `<div class="of-micro text-muted">${of_esc(m.so_customer_names)}</div>` : ''}</td>
                <td class="of-meta">${of_date(m.transaction_date)}
                    <div class="of-micro">by ${of_date(m.schedule_date)}</div></td>
                <td>${of_qty(m.qty)}<div class="of-micro">${of_num(m.item_count)} item(s)</div></td>
                <td>${of_qty(m.ordered_qty, 'info')}</td>
                <td>${of_qty(pending, pending > 0 ? 'warn' : null)}</td>
                <td>${of_doc_status(mr_status)}</td>
                <td>
                    ${flt_of(m.docstatus) === 0
                        ? `<span class="of-micro" style="color:var(--of-orange);font-weight:600;" title="A Purchase Order can only be made from a submitted Material Request">
                            <i class="fa fa-exclamation-triangle"></i> Submit MR first</span>`
                        : pending > 0
                            ? `<button class="of-btn of-btn--primary of-action-btn" data-action="make_po_from_mr" data-target="${m.name}">
                                <i class="fa fa-shopping-cart"></i> Order PO</button>`
                            : '<span class="of-micro" style="color:var(--of-green);font-weight:600;">Ordered</span>'}
                </td>
            </tr>`;
        }).join('');

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

            // Returns against this order (Sales Return, Credit Note, Purchase / Subcontract Return, Debit
            // Note): not progress, so not in the chain above — one chip each, opening the document.
            const returns_html = (o.returns || []).length ? `<div class="of-ret-chips" style="align-items:flex-start;">${(o.returns || []).map(r =>
                `<a class="of-ret-chip${flt_of(r.docstatus) === 0 ? ' is-draft' : ''}" href="/app/${of_route(r.doctype)}/${encodeURIComponent(r.name)}" target="_blank"
                    title="${of_esc(r.label)} ${of_esc(r.name)}${flt_of(r.docstatus) === 0 ? ' (draft)' : ''}"><i class="fa fa-undo"></i> ${of_esc(r.label)} ${of_esc(r.name)}${flt_of(r.docstatus) === 0 ? ` · ${__('draft')}` : ''}</a>`).join('')}</div>` : '';

            const rm_c = o.rm_counts || {};
            const rm_chain_items = [
                ['MR', rm_c['Material Request'], o.rm_mrs, 'Material Request'],
                ['PO', rm_c['Purchase Order'], o.rm_pos, 'Purchase Order'],
                ['Recv', (rm_c['Purchase Receipt'] || 0) + (rm_c['Subcontracting Receipt'] || 0), o.rm_receipts, 'Receipt']
            ].filter(([, n]) => n);

            const rm_chain_html = rm_chain_items.length ? `
                <div class="of-rm-chain" title="${of_esc('Requests and purchase orders raised for the raw materials needed to make this item. Shown here separately from the order’s own delivery progress.')}">
                    
                    <span style="font-weight:700;color:var(--of-purple);">RM:</span>
                    ${rm_chain_items.map(([label, n, docs, doctype]) => {
                        const docs_data = doctype === 'Receipt'
                            ? encodeURIComponent(JSON.stringify(docs || []))
                            : (docs || []).join(',');
                        return `<span class="of-micro of-link-flow" data-doctype="${doctype}" data-docs="${docs_data}" style="display:inline-block;white-space:nowrap;margin:1px 3px 1px 0;color:var(--of-purple);font-weight:600;cursor:pointer;text-decoration:underline;" title="Click to view linked ${label}"><b>${n}</b> ${label}</span>`;
                    }).join('')}
                </div>` : '';

            let rm_stage_note_html = '';
            if (rm_chain_items.length) {
                const has_recv = rm_chain_items.some(([label]) => label === 'Recv');
                const has_po = rm_chain_items.some(([label]) => label === 'PO');
                const rm_note_text = has_recv ? 'RM Received' : has_po ? 'RM Ordered (PO)' : 'RM Requested (MR)';
                rm_stage_note_html = `
                    <div class="of-micro of-rm-note" style="margin-top:4px;color:var(--of-purple);font-weight:600;"
                         title="Raw materials for this item are being requested or purchased. This order's stage above updates once the item itself is ready to pick or deliver.">
                         ${rm_note_text}
                    </div>`;
            }

            // No main action: "Completed" only when the order really is; an order whose raw
            // material is ready shows nothing here (its Create Subcontract PO button sits below);
            // anything else names its stage, so a waiting order never reads as done.
            const no_action_html = st.stage_key === 'completed'
                ? `<span class="of-micro" style="color:var(--of-green);font-weight:600;"><i class="fa fa-check-circle"></i> Completed</span>`
                : (st.rm_ready_stage || o.rm_ready_for_sco)
                    ? ''
                    : `<span class="of-micro text-muted">${of_esc(st.stage_label || '')}</span>`;
            let action_btn_html = '';
            if (view_only) {
                action_btn_html = st.action_type && st.action_type !== 'none'
                    ? `<span class="of-micro" title="${of_esc(st.action_label || '')}">${of_esc(st.stage_label || 'In progress')}</span>`
                    : no_action_html;
            } else if (st.action_type && st.action_type !== 'none') {
                action_btn_html = `
                    <button class="of-btn ${st.action_btn_class || 'of-btn--primary'} of-action-btn"
                            title="${of_esc(st.action_hint || st.action_label || '')}"
                            data-action="${st.action_type}"
                            data-target="${st.target_doc || ''}"
                            data-doctype="${st.target_doctype || ''}"
                            data-so="${o.name}"
                            data-customer="${of_esc(o.customer || '')}"
                            data-customer-name="${of_esc(o.customer_name || '')}"
                            data-route-lock="${of_esc(st.route_lock || '')}">
                        <i class="fa fa-${st.icon || 'arrow-right'}"></i> ${of_esc(st.action_label || 'Act')}
                    </button>`;
            } else {
                action_btn_html = no_action_html;
            }

            if (st.secondary_action && st.secondary_action.action_type && !view_only) {
                const sec = st.secondary_action;
                action_btn_html += `
                    <div class="of-secondary-action">
                        <span class="of-secondary-action__tag">Also Pending</span>
                        <button class="of-btn ${sec.action_btn_class || 'of-btn--warning'} of-action-btn"
                                title="${of_esc(sec.action_hint || sec.action_label || '')}"
                                data-action="${sec.action_type}"
                                data-target="${sec.target_doc || ''}"
                                data-doctype="${sec.target_doctype || ''}"
                                data-so="${o.name}"
                                data-customer="${of_esc(o.customer || '')}"
                                data-customer-name="${of_esc(o.customer_name || '')}">
                            <i class="fa fa-${sec.icon || 'arrow-right'}"></i> ${of_esc(sec.action_label || 'Act')}
                        </button>
                    </div>`;
            }

            // "Raw material has arrived" is a fact that runs ALONGSIDE whatever
            // stage the order is in, not a stage of its own — an order can be
            // waiting on a Pick List for what is already made AND have material
            // sitting ready to subcontract the rest. _compute_stage_info only
            // ever returns one primary action, so on every order that has moved
            // past "Newly Created" the Subcontract PO had no button at all and
            // the RM Ready badge just sent the user to the Sales Order to find
            // it themselves (confirmed: SAL-ORD-2026-00132, rm_ready_for_sco
            // true, action_type make_picklist). Offered here as its own action
            // so the primary one keeps meaning what it says.
            if (o.rm_ready_for_sco && !view_only) {
                action_btn_html += `
                    <div class="of-secondary-action">
                        <span class="of-secondary-action__tag">${__('RM Ready')}</span>
                        <button class="of-btn of-btn--primary of-sco-btn" data-so="${o.name}"
                                title="${of_esc('Raw material is in stock for ' + flt_of(o.rm_ready_fg_qty) + ' unit(s) — pick which items to put on a Subcontract PO.')}">
                            <i class="fa fa-cogs"></i> ${__('Create Subcontract PO')} (${flt_of(o.rm_ready_fg_qty)})
                        </button>
                    </div>`;
            }

            if (flt_of(o.shortfall_qty) > 0.01 && !view_only) {
                action_btn_html += `
                    <div class="of-micro" style="margin-top:6px;color:var(--of-red);font-weight:600;" title="${of_esc('Ordered qty not yet picked or dispatched, across every line of this order — see the Item Stock & Action Plan below for which item and why.')}">
                        <i class="fa fa-hourglass-half"></i> ${of_round2(o.shortfall_qty)} ${__('Pending — Not Picked Yet')}
                    </div>`;
            }

            action_btn_html += of_insights_html(o);

            return `
            <tr data-so="${o.name}" class="${o.is_overdue ? 'of-row--overdue' : ''} of-row-main">
                <td>
                    <div style="display:flex; align-items:center; gap:6px;">
                        <i class="fa fa-caret-right of-so-toggle" style="cursor:pointer; width:12px; font-size:14px; color:var(--text-light);" data-so="${o.name}"></i>
                        <div>
                            ${of_so_link(o.name, {bold: true})}<a href="#" class="of-order-status" data-so="${o.name}" title="${of_esc(__('Order Status — where every item of this order is right now'))}" style="display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; margin-left:4px; border-radius:4px; background:var(--of-blue-tint, rgba(52,152,219,.12)); color:var(--of-blue, #2980b9); font-size:11px; vertical-align:middle; text-decoration:none;"><i class="fa fa-map-signs"></i></a>
                            ${is_new ? '<span class="of-new-dot" title="New activity notification"></span>' : ''}
                            ${o.is_overdue ? '<span class="of-chip of-chip--bad" style="margin-left:4px;">Overdue</span>' : ''}
                            ${o.skip_delivery_note ? '<span class="of-chip" style="margin-left:4px; background:#e83e8c; color:#fff; font-size:9px; padding:2px 5px; border-radius:3px; font-weight:700;">Direct Bill</span>' : ''}
                            <div class="of-meta" style="font-weight:500;">
                                <a href="/app/customer/${encodeURIComponent(o.customer)}" target="_blank" style="color:inherit;">${of_customer_display(o.customer_name || o.customer, o.contact_person_name)}</a>
                            </div>
                            ${o.industry ? `
                                <div class="of-micro text-muted" title="Customer's industry">
                                    <i class="fa fa-industry"></i> ${of_esc(o.industry)}
                                </div>` : ''}
                            ${o.po_no ? `
                                <div class="of-micro" style="margin-top:2px;" title="${of_esc('Customer PO ' + o.po_no + (o.po_date ? ' dated ' + of_date(o.po_date) : '') + ' — the reference this customer uses for the order. Searchable from the box above.')}">
                                    <i class="fa fa-file-text-o"></i> ${__('Cust PO')}: <strong>${of_esc(o.po_no)}</strong>${o.po_date ? `<span style="color:var(--text-light);"> &middot; ${of_date(o.po_date)}</span>` : ''}
                                </div>` : ''}
                            ${o.custom_merchandiser_user ? `
                                <div class="of-micro" style="margin-top:2px;color:var(--of-info);" title="Merchandiser assigned to this customer">
                                    <i class="fa fa-user"></i> ${of_esc(o.custom_merchandiser_name || o.custom_merchandiser_user)}
                                </div>` : ''}
                            ${of_creator_html(o, o.custom_merchandiser_user)}
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
                    ${st.secondary_action ? `
                        <div class="of-micro" style="margin-top:4px;color:var(--of-orange);font-weight:600;">
                            <i class="fa fa-file-text-o"></i> + Needs Invoice
                        </div>` : ''}
                    ${o.rm_ready_for_sco && !st.rm_ready_stage ? `
                        <div class="of-micro" style="margin-top:4px;color:var(--of-purple);font-weight:700;"
                             title="${of_esc('Raw material for ' + flt_of(o.rm_ready_fg_qty) + ' unit(s) is in stock at VV Puram now — a Subcontracting PO can be raised for it. Counted against stock actually on hand, so two orders are never told the same material is theirs.')}">
                            ${__('RM Ready — Make Subcontract PO')} (${flt_of(o.rm_ready_fg_qty)})
                        </div>` : ''}
                    ${rm_stage_note_html}
                </td>
                <td>
                    ${action_btn_html}
                </td>
                <td style="text-align:left;">${chain}${rm_chain_html}${returns_html}</td>
                <td>
                    ${of_status_chip(o.per_delivered, st.stage_key, 'delivered', o.delivery_notes, o.draft_delivery_notes, o.stock_invoices, o.per_billed, o.needs_invoice_qty, o.draft_invoices)}
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

            <!-- Sales Tracker Sub-Tab Navigation Bar -->
            <div class="of-kcards of-kcards--4">
                ${of_tabcard({ sub: 'so', active: subtab === 'so', icon: 'list-ul', tone: 'blue', title: __('Sales Orders'),
                    value: flt_of(data.total), value_label: __('orders'), meta: __('filter by stage below') })}
                ${of_tabcard({ sub: 'mr', active: subtab === 'mr', icon: 'file-text-o', tone: 'purple', title: __('Material Requests'),
                    value: flt_of(mrs_env.total), value_label: __('requests'), ds: mrs_env.docstatus_counts })}
                ${of_tabcard({ sub: 'fp', active: subtab === 'fp', icon: 'magic', tone: 'orange', title: __('Embroidery - FP'),
                    value: flt_of(ewo_fp_env.total), value_label: __('work orders'), ds: ewo_fp_env.docstatus_counts })}
                ${of_tabcard({ sub: 'pn', active: subtab === 'pn', icon: 'scissors', tone: 'red', title: __('Embroidery - Panel'),
                    value: flt_of(ewo_pn_env.total), value_label: __('work orders'), ds: ewo_pn_env.docstatus_counts })}
            </div>

            <!-- Subtab Sections -->
            <div id="of-tracker-sec-so" class="${subtab !== 'so' ? 'of-hidden' : ''}">
                <!-- Top Summary Cards (Interactive Stage Number Cards) -->
                <div class="of-summary" id="of-summary-tracker"></div>
                ${truncated_note}

                <!-- Sales Order Action Tracker Table -->
                <div class="of-card">
                    <div class="of-card__head" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                        <span><i class="fa fa-tasks"></i> Sales Order Stage &amp; Required Action Plan
                        <small>Clear next action button for every order</small></span>
                        ${this.table_filters_html('tracker.so')}
                    </div>
                    <div class="of-scroll-hint"><i class="fa fa-arrows-h"></i> ${__('Scroll sideways to see every column')}</div>
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
                    ${of_pagination_html('tracker', 'so', data)}
                </div>
            </div>

            <div id="of-tracker-sec-mr" class="${subtab !== 'mr' ? 'of-hidden' : ''}">
                ${of_card('Material Requests', 'file-text-o', `
                    <table class="of-table">
                        <thead><tr><th style="min-width:170px;">Material Request</th><th>Sales Order</th><th>Dates</th>
                            <th>Requested</th><th>Ordered</th><th>Not ordered</th><th>Status</th><th>Action</th></tr></thead>
                        <tbody>${mr_rows || of_empty_row(8)}</tbody>
                    </table>`,
                    `<a class="of-btn of-btn--primary" href="/app/material-request/new" target="_blank">
                        <i class="fa fa-plus"></i> ${__('Create Material Request')}
                    </a>`, of_pagination_html('tracker', 'mr', mrs_env),
                    of_docstatus_pills('tracker', 'mr', mrs_env.docstatus_counts, this.docstatus_filter.tracker.mr) + this.table_filters_html('tracker.mr'))}
            </div>

            <!-- Same work orders as the Job Work tab's Embroidery subtabs, so
                 an order's embroidery can be followed (and received back)
                 from where the order itself is tracked. -->
            <div id="of-tracker-sec-fp" class="${subtab !== 'fp' ? 'of-hidden' : ''}">
                ${this.ewo_card_html('tracker', 'ewo_fp', ewo_fp_env)}
            </div>
            <div id="of-tracker-sec-pn" class="${subtab !== 'pn' ? 'of-hidden' : ''}">
                ${this.ewo_card_html('tracker', 'ewo_pn', ewo_pn_env)}
            </div>`;
    }

    // Last Activity = the last thing that actually moved the order (submission,
    // approval, rejection, or a comment carrying one). The server already picked
    // it; a plain draft save only appears when the order has no milestone yet.
    last_activity_html(o) {
        const label = o.last_event_label || o.last_event;
        const is_comment = o.last_event === 'Comment';
        // Route by the doctype the document NAME belongs to, not by the
        // event's display doctype: an embroidery / job-work event is keyed by
        // the Purchase Order that raised it, so linking it as an Embroidery
        // Work Order produced /app/embroidery-work-order/PUR-ORD-… — a dead
        // link to a doctype that never had that name. See _EVENT_LINK_DOCTYPE.
        const link_doctype = o.last_event_doc_doctype || o.last_event;
        const doc_link = (!is_comment && o.last_event_doc)
            ? `<a href="/app/${of_route(link_doctype)}/${encodeURIComponent(o.last_event_doc)}" target="_blank">${of_esc(o.last_event_doc)}</a>`
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
            const so_link = ev.sales_order ? of_so_link(ev.sales_order, {bold: true}) : '';
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
        const pos_env = data.purchase_orders || {};
        const rcs_env = data.receipts || {};
        const bill_env = data.bill_orders || {};
        const pos = pos_env.rows || [];
        const rcs = rcs_env.rows || [];
        const pos_need_bill = bill_env.rows || [];
        this.$body.find('#of-count').text(__('{0} PO · {1} receipts · {2} need bill',
            [pos_env.total || 0, rcs_env.total || 0, bill_env.total || 0]));

        const po_rows = pos.map(p => `
            <tr class="of-doc-row">
                <td><i class="fa fa-caret-right of-doc-items-toggle" data-doctype="Purchase Order" data-docname="${of_esc(p.name)}" data-docstatus="${p.docstatus}" style="cursor:pointer;margin-right:4px;color:var(--text-light);"></i>
                    <a href="/app/purchase-order/${encodeURIComponent(p.name)}" target="_blank" style="font-weight:700;">${of_esc(p.name)}</a>
                    ${flt_of(p.is_subcontracted) === 1 ? '<div><span class="of-chip">Subcontract</span></div>' : ''}
                    ${of_order_confirmation_html(p)}
                    ${of_creator_html(p)}</td>
                <td style="text-align:left;">
                    <a href="/app/supplier/${encodeURIComponent(p.supplier)}" target="_blank" style="font-weight:600;">${of_esc(p.supplier_name || p.supplier || '')}</a>
                </td>
                <td>${of_so_links(p.sales_orders)}
                    ${p.so_customer_names ? `<div class="of-micro text-muted">${of_esc(p.so_customer_names)}</div>` : ''}</td>
                <td class="of-meta">${of_date(p.transaction_date)}
                    <div class="of-micro">exp ${of_date(p.schedule_date)}</div></td>
                <td>${of_po_lr_html(p)}</td>
                <td>${of_qty(p.qty)}</td>
                <td>${of_qty(p.received_qty, flt_of(p.received_qty) > 0 ? 'pos' : null)}
                    ${of_status_chip(p.per_received)}</td>
                <td>${of_money(p.grand_total, p.currency)}</td>
                <td>${of_doc_status(p.status)}</td>
                <td>
                    <div class="of-po-actions">
                        <a class="of-btn" href="/app/purchase-order/${encodeURIComponent(p.name)}" target="_blank">
                            <i class="fa fa-external-link"></i> Open PO
                        </a>
                        <button class="of-btn of-po-print-btn" data-name="${of_esc(p.name)}" title="${__('Print Purchase Order')}">
                            <i class="fa fa-print"></i>
                        </button>
                    </div>
                </td>
            </tr>`).join('');

        // To Bill: Purchase Receipts not (fully) billed — the supplier's bill is made from the receipt
        const bill_rows = pos_need_bill.map(p => {
            const ret = flt_of(p.returned_qty);
            const part = flt_of(p.per_billed) > 0.01;
            return `
            <tr class="of-doc-row">
                <td><i class="fa fa-caret-right of-doc-items-toggle" data-doctype="Purchase Receipt" data-docname="${of_esc(p.name)}" data-docstatus="${p.docstatus}" style="cursor:pointer;margin-right:4px;color:var(--text-light);"></i>
                    <a href="/app/purchase-receipt/${encodeURIComponent(p.name)}" target="_blank" style="font-weight:700;">${of_esc(p.name)}</a>
                    <div class="of-micro">${of_date(p.posting_date)}</div>
                    ${of_creator_html(p)}</td>
                <td style="text-align:left;">
                    <a href="/app/supplier/${encodeURIComponent(p.supplier)}" target="_blank" style="font-weight:600;">${of_esc(p.supplier_name || p.supplier || '')}</a>
                    ${p.custom_supplier_invoice_no ? `<div class="of-micro">${__('Supplier bill')} <b>${of_esc(p.custom_supplier_invoice_no)}</b>${p.custom_supplier_invoice_date ? ' · ' + of_date(p.custom_supplier_invoice_date) : ''}</div>` : ''}
                    ${p.supplier_delivery_note ? `<div class="of-micro text-muted">${__('Challan')} ${of_esc(p.supplier_delivery_note)}</div>` : ''}</td>
                <td>${of_po_links(p.purchase_orders)}</td>
                <td>${of_so_links(p.sales_orders)}
                    ${p.so_customer_names ? `<div class="of-micro text-muted">${of_esc(p.so_customer_names)}</div>` : ''}</td>
                <td>${p.lr_no ? `${of_esc(p.lr_no)}${p.lr_date ? `<div class="of-micro">${of_date(p.lr_date)}</div>` : ''}` : '—'}</td>
                <td>${of_qty(p.qty, 'pos')}
                    ${ret > 0 ? `<div class="of-micro" style="color:#b03a2e;">↩ ${of_qty(ret)} ${__('returned')}</div>` : ''}</td>
                <td>${of_money(p.to_bill_value, p.currency)}
                    <div class="of-micro text-muted">${__('before tax')}${part ? ' · ' + __('{0}% billed', [Math.round(flt_of(p.per_billed))]) : ''}</div></td>
                <td>${of_doc_status(p.status)}</td>
                <td>
                    <div class="of-po-actions">
                        ${p.draft_invoice ? `
                            <a class="of-btn of-btn--warning" href="/app/purchase-invoice/${encodeURIComponent(p.draft_invoice)}" target="_blank" style="font-weight:700;">
                                <i class="fa fa-external-link"></i> ${__('Open Draft')} (${of_esc(p.draft_invoice)})
                            </a>
                        ` : `
                            <button class="of-btn of-btn--primary of-action-btn" data-action="make_purchase_invoice_from_pr" data-pr="${of_esc(p.name)}">
                                <i class="fa fa-file-text-o"></i> ${__('Create Invoice')}
                            </button>
                        `}
                    </div>
                </td>
            </tr>`;
        }).join('');

        const rc_rows = rcs.map(r => {
            const open_doctype = (r.doctype === 'Subcontracting Receipt' && r.linked_pr) ? 'Purchase Receipt' : r.doctype;
            const open_name = (r.doctype === 'Subcontracting Receipt' && r.linked_pr) ? r.linked_pr : r.name;
            return `
            <tr class="of-doc-row">
                <td><i class="fa fa-caret-right of-doc-items-toggle" data-doctype="${of_esc(open_doctype)}" data-docname="${of_esc(open_name)}" data-docstatus="${r.docstatus}" data-submit-doctype="${of_esc(r.doctype)}" data-submit-name="${of_esc(r.name)}" style="cursor:pointer;margin-right:4px;color:var(--text-light);"></i>
                    <a href="/app/${of_route(open_doctype)}/${encodeURIComponent(open_name)}" target="_blank" style="font-weight:700;">${of_esc(r.name)}</a>
                    <div class="of-micro">${of_esc(open_doctype)}${open_doctype !== r.doctype ? ` (via ${of_esc(r.doctype)})` : ''}</div>
                    ${flt_of(r.is_return) ? `<span class="of-note-type is-debit" title="${__('A return to the supplier / jobber — goods went back out')}">↩ ${__('Return')}</span>` : ''}
                    ${of_creator_html(r)}</td>
                <td style="text-align:left;">
                    <a href="/app/supplier/${encodeURIComponent(r.supplier)}" target="_blank" style="font-weight:600;">${of_esc(r.supplier_name || r.supplier || '')}</a>
                </td>
                <td>${of_so_links(r.sales_orders)}
                    ${r.so_customer_names ? `<div class="of-micro text-muted">${of_esc(r.so_customer_names)}</div>` : ''}</td>
                <td>${of_po_links(r.purchase_orders)}
                    ${r.supplier_name ? `<div class="of-micro text-muted">${of_esc(r.supplier_name)}</div>` : ''}</td>
                <td class="of-meta">${of_date(r.posting_date)}</td>
                <td>${flt_of(r.is_return) ? `${of_qty(Math.abs(flt_of(r.qty)), 'neg')}<div class="of-micro text-muted">${__('returned')}</div>` : of_qty(r.qty, 'pos')}</td>
                <td>${of_money(r.grand_total, r.currency)}</td>
                <td>${of_doc_status(r.status)}</td>
            </tr>`;
        }).join('');

        const subtab = this.pur_subtab || 'po';

        return `
            <!-- Live Activity Notifications -->
            ${this.activity_stream_html('purchase')}

            <!-- Top Summary Cards -->

            <!-- Purchase Flow Sub-Tab Navigation Bar -->
            <div class="of-kcards">
                ${of_tabcard({ sub: 'po', active: subtab === 'po', icon: 'shopping-cart', tone: 'blue', title: __('Purchase Orders'),
                    value: flt_of(pos_env.total), value_label: __('POs'),
                    meta: `${flt_of((data.metrics || {}).open_pos)} ${__('waiting for receipt')} · ${of_money((data.metrics || {}).total_ordered || 0)} ${__('ordered')}`,
                    ds: pos_env.docstatus_counts })}
                ${of_tabcard({ sub: 'receipt', active: subtab === 'receipt', icon: 'inbox', tone: 'green', title: __('Receipts'),
                    value: flt_of(rcs_env.total), value_label: __('receipts'), ds: rcs_env.docstatus_counts,
                    meta: flt_of(rcs_env.return_count) ? `↩ ${flt_of(rcs_env.return_count)} ${flt_of(rcs_env.return_count) === 1 ? __('return') : __('returns')} — ${__('Billing › Returns')}` : '' })}
                ${of_tabcard({ sub: 'bill', active: subtab === 'bill', icon: 'calculator', tone: 'orange', title: __('To Bill'),
                    value: flt_of(bill_env.total), value_label: __('receipts'), meta: __('goods received, supplier bill not entered') })}
            </div>

            <!-- Subtab Sections -->
            <div id="of-pur-sec-po" class="${subtab !== 'po' ? 'of-hidden' : ''}">
                ${of_card('Purchase Orders', 'shopping-cart', `
                    <table class="of-table">
                        <thead><tr><th style="min-width:170px;">Purchase Order</th><th style="min-width:150px;">Supplier</th>
                            <th>Sales Order</th><th>Dates</th><th>LR Number</th><th>Ordered</th><th>Received</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead>
                        <tbody>${po_rows || of_empty_row(10)}</tbody>
                    </table>`,
                    `<a class="of-btn of-btn--primary" href="/app/purchase-order/new" target="_blank">
                        <i class="fa fa-plus"></i> ${__('Create Purchase Order')}
                    </a>`, of_pagination_html('purchase', 'po', pos_env),
                    of_docstatus_pills('purchase', 'po', pos_env.docstatus_counts, this.docstatus_filter.purchase.po) + this.table_filters_html('purchase.po'))}
            </div>

            <div id="of-pur-sec-receipt" class="${subtab !== 'receipt' ? 'of-hidden' : ''}">
                ${of_card('Receipts', 'inbox', `
                    <table class="of-table">
                        <thead><tr><th style="min-width:170px;">Receipt</th><th style="min-width:150px;">Supplier</th>
                            <th>Sales Order</th><th>Against PO</th><th>Date</th><th>Received</th><th>Amount</th><th>Status</th></tr></thead>
                        <tbody>${rc_rows || of_empty_row(8)}</tbody>
                    </table>`,
                    `<a class="of-btn of-btn--primary" href="/app/purchase-receipt/new" target="_blank">
                        <i class="fa fa-plus"></i> ${__('Create Purchase Receipt')}
                    </a>`, of_pagination_html('purchase', 'receipt', rcs_env),
                    of_docstatus_pills('purchase', 'receipt', rcs_env.docstatus_counts, this.docstatus_filter.purchase.receipt) + this.table_filters_html('purchase.receipt'))}
            </div>

            <div id="of-pur-sec-bill" class="${subtab !== 'bill' ? 'of-hidden' : ''}">
                ${of_card(__('Purchase Receipts to bill — enter the supplier\'s bill from the receipt'), 'calculator', `
                    <table class="of-table">
                        <thead><tr><th style="min-width:170px;">Purchase Receipt</th><th style="min-width:170px;">Supplier / their bill</th>
                            <th>Against PO</th><th>Sales Order</th><th>LR</th><th>Received</th><th>To bill</th><th>Status</th><th>Action</th></tr></thead>
                        <tbody>${bill_rows || of_empty_row(9)}</tbody>
                    </table>`, null, of_pagination_html('purchase', 'bill', bill_env), this.table_filters_html('purchase.bill'))}
            </div>`;
    }

    // Once an Embroidery Work Order's rows paint with just a "Track" link,
    // check — per unique Purchase Order, not per row — whether that PO's
    // Subcontracting Order is actually ready to receive Finished Goods
    // (erp_dacsinc_custom.purchase_order.get_sco_status_for_po, the same
    // gate the PO form itself uses for its own "Receive Finished Goods"
    // button), and if so add that real action here instead of leaving the
    // user to go find it on the PO.
    load_ewo_receive_actions(data) {
        data = data || {};
        const ewos = [...((data.ewo_fp || {}).rows || []), ...((data.ewo_pn || {}).rows || [])];
        // Only POs that still exist — a deleted one has nothing to receive.
        const unique_pos = Array.from(new Set(ewos.filter(e => of_num(e.po_exists) !== 0).map(e => e.purchase_order).filter(Boolean)));
        unique_pos.forEach(po_name => {
            frappe.call({
                method: 'erp_dacsinc_custom.purchase_order.get_sco_status_for_po',
                args: { purchase_order_name: po_name }
            }).then(r => {
                const status = r.message || {};
                const ready = status.sco_exists && status.items_pending && !status.is_panel_job_open;
                if (!ready) return;

                const $cells = this.$body.find(`.of-ewo-action[data-po="${po_name}"]`);
                $cells.each((i, el) => {
                    const $cell = $(el);
                    if ($cell.find('.of-ewo-receive-btn').length) return;
                    $cell.prepend(`
                        <button class="of-btn of-btn--primary of-ewo-receive-btn"
                                data-sco="${of_esc(status.sco_name || '')}" style="margin-right:4px;">
                            <i class="fa fa-inbox"></i> Receive Finished Goods
                        </button>
                    `);
                });
            });
        });
    }

    // Panel step 2: assign a jobber and send. Standalone here (not reused
    // from purchase_order.js) since that file's version closes over a real
    // `frm`/`dialog` this dashboard doesn't have — same server call though.
    show_ewo_send_dialog(name) {
        const d = new frappe.ui.Dialog({
            title: __('Send to Panel Jobber'),
            fields: [
                { label: __('Jobber (Supplier)'), fieldname: 's', fieldtype: 'Link', options: 'Supplier', reqd: 1 },
                { label: __('Notes'), fieldname: 'n', fieldtype: 'Small Text' }
            ],
            primary_action_label: __('Send to Jobber'),
            primary_action: (v) => {
                d.hide();
                frappe.call({
                    method: 'erp_dacsinc_custom.purchase_order.update_panel_process_stage',
                    args: { name: name, next_stage: 'Sent to Panel Jobber', notes: v.n, panel_jobber: v.s },
                    freeze: true
                }).then(() => {
                    frappe.show_alert({message: __('Sent to Jobber'), color: 'green'});
                    this.refresh(true);
                    // the Embroidery Work Order goes with the panels (same as the PO's panel dialog)
                    if (window.dacs_print_prompt) window.dacs_print_prompt('Embroidery Work Order', name, __('Embroidery Work Order'));
                });
            }
        });
        d.show();
    }

    // Panel step 3: receive back (partial receipts allowed — the server
    // only advances panel_stage once every row's received_qty catches up
    // to ordered_qty, so re-opening this after a partial receipt is normal).
    show_ewo_receive_panel_dialog(name) {
        frappe.call({
            method: 'erp_dacsinc_custom.purchase_order.get_ewo_details',
            args: { name: name }
        }).then(res => {
            const items = (res.message && res.message.items) || [];
            let tbl = `<div class="of-scroll"><table class="table table-bordered table-sm" style="font-size:12px;">
                <thead><tr class="bg-light"><th>${__('Item')}</th><th class="text-right">${__('Sent')}</th><th class="text-right">${__('Balance')}</th><th width="120">${__('Receive Qty')}</th></tr></thead><tbody>`;
            items.forEach(i => {
                const bal = of_round2(flt_of(i.ordered_qty) - flt_of(i.received_qty));
                tbl += `<tr data-row="${i.name}">
                    <td>${of_esc(i.item_code)}</td>
                    <td class="text-right">${of_round2(i.ordered_qty)}</td>
                    <td class="text-right font-weight-bold">${bal}</td>
                    <td><input type="number" class="form-control form-control-sm of-ewo-qty-in text-right" value="${bal}" min="0" max="${bal}" ${bal <= 0 ? 'disabled' : ''}></td>
                </tr>`;
            });
            tbl += `</tbody></table></div>`;

            const d = new frappe.ui.Dialog({
                title: __('Receive from Panel Jobber'),
                fields: [
                    { fieldtype: 'HTML', options: tbl },
                    { label: __('Note'), fieldname: 'n', fieldtype: 'Small Text' }
                ],
                primary_action_label: __('Receive'),
                primary_action: (v) => {
                    const items_data = [];
                    d.$wrapper.find('tbody tr').each(function () {
                        const qty = parseFloat($(this).find('.of-ewo-qty-in').val()) || 0;
                        if (qty > 0) items_data.push({ name: $(this).data('row'), qty: qty });
                    });
                    if (!items_data.length) {
                        frappe.msgprint(__('Enter a quantity greater than 0 for at least one item.'));
                        return;
                    }
                    frappe.call({
                        method: 'erp_dacsinc_custom.purchase_order.receive_panel_items',
                        args: { name: name, items_data: JSON.stringify(items_data), notes: v.n },
                        freeze: true
                    }).then(() => {
                        d.hide();
                        frappe.show_alert({message: __('Receipt recorded'), color: 'green'});
                        this.refresh(true);
                    });
                }
            });
            d.show();
        });
    }

    // Panel step 4 (terminal): close the job once panel_stage has already
    // advanced to "Received from Panel Jobber" — no qty entry, just notes.
    show_ewo_close_dialog(name) {
        const d = new frappe.ui.Dialog({
            title: __('Close Panel Job'),
            fields: [{ label: __('Closing Instruction / Notes'), fieldname: 'n', fieldtype: 'Small Text' }],
            primary_action_label: __('Close Job'),
            primary_action: (v) => {
                d.hide();
                frappe.call({
                    method: 'erp_dacsinc_custom.purchase_order.update_panel_process_stage',
                    args: { name: name, next_stage: 'Returned to Jobber (Closed)', notes: v.n },
                    freeze: true
                }).then(() => {
                    frappe.show_alert({message: __('Job closed'), color: 'green'});
                    this.refresh(true);
                    // finished panels go back to the subcontract jobber with the Embroidery Work Order
                    if (window.dacs_print_prompt) window.dacs_print_prompt('Embroidery Work Order', name, __('Embroidery Work Order'));
                });
            }
        });
        d.show();
    }

    // Full Piece's only open step — receive back what was sent. The server
    // auto-closes full_piece_stage once every row is fully received, same
    // "partial receipts keep it open" behaviour as the Panel receive step.
    show_ewo_receive_fp_dialog(ewo_name) {
        frappe.call({
            method: 'erp_dacsinc_custom.purchase_order.get_ewo_details',
            args: { name: ewo_name }
        }).then(res => {
            const items = (res.message && res.message.items) || [];
            let tbl = `<div class="of-scroll"><table class="table table-sm table-bordered">
                <thead><tr class="bg-light"><th>${__('Item')}</th><th class="text-right">${__('Sent')}</th><th class="text-right">${__('At Jobber')}</th><th width="120">${__('Receiving Now')}</th></tr></thead><tbody>`;
            items.forEach(i => {
                const bal = of_round2(flt_of(i.ordered_qty) - flt_of(i.received_qty));
                tbl += `<tr data-row-name="${i.name}">
                    <td>${of_esc(i.item_code)}</td>
                    <td class="text-right">${of_round2(i.ordered_qty)}</td>
                    <td class="text-right font-weight-bold">${bal}</td>
                    <td><input type="number" class="form-control text-right of-ewo-fp-qty-in" value="${bal}" min="0" max="${bal}" data-max="${bal}" ${bal <= 0 ? 'disabled' : ''}></td>
                </tr>`;
            });
            tbl += `</tbody></table></div>`;

            const d = new frappe.ui.Dialog({
                title: __('Receive Back from Embroidery Jobber — {0}', [ewo_name]),
                fields: [{ fieldtype: 'HTML', options: tbl }],
                primary_action_label: __('Receive Back'),
                primary_action: () => {
                    const items_to_receive = [];
                    let has_error = false;
                    d.$wrapper.find('tbody tr').each(function () {
                        const $input = $(this).find('.of-ewo-fp-qty-in');
                        const qty = parseFloat($input.val()) || 0;
                        const max = parseFloat($input.data('max'));
                        if (qty < 0 || qty > max) {
                            has_error = true;
                            $input.addClass('is-invalid');
                        } else {
                            $input.removeClass('is-invalid');
                        }
                        if (qty > 0) items_to_receive.push({ name: $(this).data('row-name'), qty: qty });
                    });
                    if (has_error) {
                        frappe.msgprint(__('Please fix the quantities in red.'));
                        return;
                    }
                    if (!items_to_receive.length) {
                        frappe.msgprint(__('Enter a quantity greater than 0 for at least one item.'));
                        return;
                    }
                    frappe.call({
                        method: 'erp_dacsinc_custom.purchase_order.create_full_piece_receipt',
                        args: { ewo_name: ewo_name, items_data: JSON.stringify(items_to_receive) },
                        freeze: true
                    }).then(() => {
                        d.hide();
                        frappe.show_alert({message: __('Receipt created successfully'), color: 'green'});
                        this.refresh(true);
                    });
                }
            });
            d.show();
        });
    }

    // ── Tab 3: job work ──────────────────────────────────────────
    jobwork_html(data) {
        data = data || {};
        const pos_env = data.purchase_orders || {};
        const rcs_env = data.receipts || {};
        const ewo_fp_env = data.ewo_fp || {};
        const ewo_pn_env = data.ewo_pn || {};
        const pos = pos_env.rows || [];
        const rcs = rcs_env.rows || [];
        const ewo_fp = ewo_fp_env.rows || [];
        const ewo_pn = ewo_pn_env.rows || [];
        this.$body.find('#of-count').text(__('{0} job work POs · {1} receipts · {2} full piece · {3} panel',
            [pos_env.total || 0, rcs_env.total || 0, ewo_fp_env.total || 0, ewo_pn_env.total || 0]));

        const po_rows = pos.map(p => `
            <tr class="of-doc-row">
                <td><i class="fa fa-caret-right of-doc-items-toggle" data-doctype="Purchase Order" data-docname="${of_esc(p.name)}" data-docstatus="${p.docstatus}" style="cursor:pointer;margin-right:4px;color:var(--text-light);"></i>
                    <a href="/app/purchase-order/${encodeURIComponent(p.name)}" target="_blank" style="font-weight:700;">${of_esc(p.name)}</a>
                    <div><span class="of-chip" style="background:var(--of-purple);color:#fff;">Job Work</span></div>
                    ${of_order_confirmation_html(p)}
                    ${of_creator_html(p)}</td>
                <td style="text-align:left;">
                    <a href="/app/supplier/${encodeURIComponent(p.supplier)}" target="_blank" style="font-weight:600;">${of_esc(p.supplier_name || p.supplier || '')}</a>
                </td>
                <td>${of_so_links(p.sales_orders)}
                    ${p.so_customer_names ? `<div class="of-micro text-muted">${of_esc(p.so_customer_names)}</div>` : ''}</td>
                <td class="of-meta">${of_date(p.transaction_date)}
                    <div class="of-micro">exp ${of_date(p.schedule_date)}</div></td>
                <td>${of_qty(p.qty)}</td>
                <td>${of_qty(p.received_qty, flt_of(p.received_qty) > 0 ? 'pos' : null)}
                    ${of_status_chip(p.per_received)}</td>
                <td>${of_money(p.grand_total, p.currency)}</td>
                <td>${of_doc_status(p.status)}</td>
                <td>
                    <div class="of-po-actions">
                        <a class="of-btn" href="/app/purchase-order/${encodeURIComponent(p.name)}" target="_blank">
                            <i class="fa fa-external-link"></i> Open PO
                        </a>
                        ${p.sco_name ? `
                            <button class="of-btn of-sco-print-btn" data-name="${of_esc(p.sco_name)}" title="${__('Print Subcontracting Order')}">
                                <i class="fa fa-print"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>`).join('');

        const rc_rows = rcs.map(r => {
            // Every Subcontracting Receipt this app creates immediately gets a
            // mapped Purchase Receipt (create_receipt_documents in
            // purchase_order.py) — that's the document actually worked from
            // day to day, so link straight to it instead of the SCR when one
            // exists.
            const open_doctype = (r.doctype === 'Subcontracting Receipt' && r.linked_pr) ? 'Purchase Receipt' : r.doctype;
            const open_name = (r.doctype === 'Subcontracting Receipt' && r.linked_pr) ? r.linked_pr : r.name;
            return `
            <tr class="of-doc-row">
                <td><i class="fa fa-caret-right of-doc-items-toggle" data-doctype="${of_esc(open_doctype)}" data-docname="${of_esc(open_name)}" data-docstatus="${r.docstatus}" data-submit-doctype="${of_esc(r.doctype)}" data-submit-name="${of_esc(r.name)}" style="cursor:pointer;margin-right:4px;color:var(--text-light);"></i>
                    <a href="/app/${of_route(open_doctype)}/${encodeURIComponent(open_name)}" target="_blank" style="font-weight:700;">${of_esc(r.name)}</a>
                    <div class="of-micro">${of_esc(open_doctype)}${open_doctype !== r.doctype ? ` (via ${of_esc(r.doctype)})` : ''}</div>
                    ${flt_of(r.is_return) ? `<span class="of-note-type is-debit" title="${__('A return to the supplier / jobber — goods went back out')}">↩ ${__('Return')}</span>` : ''}
                    ${of_creator_html(r)}</td>
                <td style="text-align:left;">
                    <a href="/app/supplier/${encodeURIComponent(r.supplier)}" target="_blank" style="font-weight:600;">${of_esc(r.supplier_name || r.supplier || '')}</a>
                </td>
                <td>${of_so_links(r.sales_orders)}
                    ${r.so_customer_names ? `<div class="of-micro text-muted">${of_esc(r.so_customer_names)}</div>` : ''}</td>
                <td>${of_po_links(r.purchase_orders)}
                    ${r.supplier_name ? `<div class="of-micro text-muted">${of_esc(r.supplier_name)}</div>` : ''}</td>
                <td class="of-meta">${of_date(r.posting_date)}</td>
                <td>${flt_of(r.is_return) ? `${of_qty(Math.abs(flt_of(r.qty)), 'neg')}<div class="of-micro text-muted">${__('returned')}</div>` : of_qty(r.qty, 'pos')}</td>
                <td>${of_money(r.grand_total, r.currency)}</td>
                <td>${of_doc_status(r.status)}</td>
            </tr>`;
        }).join('');

        const subtab = this.job_subtab || 'po';

        return `
            <!-- Live Activity Notifications -->
            ${this.activity_stream_html('jobwork')}

            <!-- Top Summary Cards -->

            <!-- Job Work Sub-Tab Navigation Bar -->
            <div class="of-kcards of-kcards--4">
                ${of_tabcard({ sub: 'po', active: subtab === 'po', icon: 'shopping-cart', tone: 'blue', title: __('Sub POs'),
                    value: flt_of(pos_env.total), value_label: __('POs'),
                    meta: `${flt_of((data.metrics || {}).active_pos)} ${__('active')} · ${Math.floor(flt_of((data.metrics || {}).pending_po_qty))} ${__('qty to receive')}`,
                    ds: pos_env.docstatus_counts })}
                ${of_tabcard({ sub: 'receipt', active: subtab === 'receipt', icon: 'inbox', tone: 'green', title: __('Sub Receipts'),
                    value: flt_of(rcs_env.total), value_label: __('receipts'), ds: rcs_env.docstatus_counts })}
                ${of_tabcard({ sub: 'fp', active: subtab === 'fp', icon: 'magic', tone: 'orange', title: __('Embroidery - FP'),
                    value: flt_of(ewo_fp_env.total), value_label: __('work orders'), ds: ewo_fp_env.docstatus_counts })}
                ${of_tabcard({ sub: 'pn', active: subtab === 'pn', icon: 'scissors', tone: 'red', title: __('Embroidery - Panel'),
                    value: flt_of(ewo_pn_env.total), value_label: __('work orders'), ds: ewo_pn_env.docstatus_counts })}
            </div>

            <!-- Subtab Sections -->
            <div id="of-job-sec-po" class="${subtab !== 'po' ? 'of-hidden' : ''}">
                ${of_card('Subcontracting Purchase Orders', 'shopping-cart', `
                    <table class="of-table">
                        <thead><tr><th style="min-width:170px;">Purchase Order</th><th style="min-width:150px;">Supplier</th>
                            <th>Sales Order</th><th>Dates</th><th>Ordered</th><th>Received</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead>
                        <tbody>${po_rows || of_empty_row(9)}</tbody>
                    </table>`,
                    `<a class="of-btn of-btn--primary" href="/app/purchase-order/new?is_subcontracted=1" target="_blank">
                        <i class="fa fa-plus"></i> ${__('Create Subcontracting PO')}
                    </a>`, of_pagination_html('jobwork', 'po', pos_env),
                    of_docstatus_pills('jobwork', 'po', pos_env.docstatus_counts, this.docstatus_filter.jobwork.po) + this.table_filters_html('jobwork.po'))}
            </div>

            <div id="of-job-sec-receipt" class="${subtab !== 'receipt' ? 'of-hidden' : ''}">
                ${of_card('Subcontract Receipts', 'inbox', `
                    <table class="of-table">
                        <thead><tr><th style="min-width:170px;">Receipt</th><th style="min-width:150px;">Supplier</th>
                            <th>Sales Order</th><th>Against PO</th><th>Date</th><th>Received</th><th>Amount</th><th>Status</th></tr></thead>
                        <tbody>${rc_rows || of_empty_row(8)}</tbody>
                    </table>`,
                    // Job work is received from the Sub PO itself ("Receive Finished Goods" on the
                    // PO / its row here), which makes the receipt documents — no standard
                    // "Create Subcontracting Receipt" here, so there is one way to receive.
                    `<span class="of-micro text-muted" title="${__('Receipts are made from the Sub PO')}"><i class="fa fa-info-circle"></i>
                        ${__('Receive from the Sub PO: Receive Finished Goods')}</span>`, of_pagination_html('jobwork', 'receipt', rcs_env),
                    of_docstatus_pills('jobwork', 'receipt', rcs_env.docstatus_counts, this.docstatus_filter.jobwork.receipt) + this.table_filters_html('jobwork.receipt'))}
            </div>

            <div id="of-job-sec-fp" class="${subtab !== 'fp' ? 'of-hidden' : ''}">
                ${this.ewo_card_html('jobwork', 'ewo_fp', ewo_fp_env)}
            </div>

            <div id="of-job-sec-pn" class="${subtab !== 'pn' ? 'of-hidden' : ''}">
                ${this.ewo_card_html('jobwork', 'ewo_pn', ewo_pn_env)}
            </div>`;
    }

    // One Embroidery Work Order row, with the real next action for THIS
    // stage rather than just a link to go look — the same 3-step Panel
    // lifecycle (Send to Jobber -> Receive from Jobber -> Close) and 1-step
    // Full Piece lifecycle (Receive from Jobber, the only step still open
    // once a row exists — it is created already "Sent") the Purchase Order
    // form offers, reachable here without leaving the dashboard. A Full
    // Piece job sent straight from a Sales Order's stock has no Purchase
    // Order; its receive step is the same. `view_only` (a scoped
    // Merchandiser User on the Sales Tracker) gets the link, not the actions.
    ewo_rows_html(list, view_only) {
        // Embroidery Work Orders are internal — no link to the form; the
        // row's order opens the order-level Embroidery popup instead.
        const ewo_track_link = (name) => '';

        return (list || []).map(e => {
            const stage = e.work_type === 'Full Piece Job Work' ? e.full_piece_stage : e.panel_stage;
            const pending = flt_of(e.ordered_qty) - flt_of(e.received_qty);
            const jobber_id = e.panel_jobber || e.full_piece_jobber;

            let action_html;
            if (view_only) {
                action_html = ewo_track_link(e.name);
            } else if (e.work_type === 'Panel Job Work' && stage === 'Received from Jobber (Internal)') {
                action_html = `<button class="of-btn of-btn--primary of-ewo-send-btn" data-name="${of_esc(e.name)}">
                    <i class="fa fa-paper-plane"></i> Send to Jobber</button>`;
            } else if (e.work_type === 'Panel Job Work' && stage === 'Sent to Panel Jobber') {
                action_html = `<button class="of-btn of-btn--primary of-ewo-receive-panel-btn" data-name="${of_esc(e.name)}">
                    <i class="fa fa-inbox"></i> Receive from Jobber</button>`;
            } else if (e.work_type === 'Panel Job Work' && stage === 'Received from Panel Jobber') {
                action_html = `<button class="of-btn of-btn--success of-ewo-close-btn" data-name="${of_esc(e.name)}">
                    <i class="fa fa-check"></i> Close Job</button>`;
            } else if (e.work_type === 'Full Piece Job Work' && stage === 'Sent to Full Piece Jobber') {
                action_html = `<button class="of-btn of-btn--primary of-ewo-receive-fp-btn" data-name="${of_esc(e.name)}">
                    <i class="fa fa-inbox"></i> Receive from Jobber</button>`;
            } else {
                action_html = ewo_track_link(e.name);
            }

            return `<tr class="of-ewo-row" data-ewo="${of_esc(e.name)}" data-docstatus="${e.docstatus}" data-submit-doctype="Embroidery Work Order" data-submit-name="${of_esc(e.name)}">
                <td><i class="fa fa-caret-right of-ewo-items-toggle" data-ewo="${of_esc(e.name)}" style="cursor:pointer;margin-right:4px;color:var(--text-light);"></i>
                    <b>${of_esc(e.name)}</b>
                    <div class="of-micro">${of_esc(e.work_type || '')}</div>
                    ${of_ewo_thumbs(e.attachments, e.name)}
                    ${of_creator_html(e)}</td>
                <td style="text-align:left;">
                    ${jobber_id ? `
                        <a href="/app/supplier/${encodeURIComponent(jobber_id)}" target="_blank" style="font-weight:600;">${of_esc(e.jobber_name || jobber_id)}</a>
                    ` : of_esc(e.jobber_name || '')}
                </td>
                <td>${e.purchase_order
                        ? (of_num(e.po_exists) === 0
                            ? `<span style="text-decoration:line-through; color:var(--text-muted);" title="${of_esc(__('This Purchase Order no longer exists (deleted) — the Embroidery Work Order still points at it.'))}">${of_esc(e.purchase_order)}</span>
                               <div class="of-micro" style="color:var(--of-red); font-weight:600;"><i class="fa fa-unlink"></i> ${__('PO deleted')}</div>`
                            : of_po_links(e.purchase_order))
                        : (e.direct_sales_order
                            ? `<span class="of-chip" title="${of_esc(__('Sent straight from the Sales Order\'s stock — no Purchase Order'))}">${__('From SO stock')}</span>`
                            : '')}
                    ${e.po_supplier_name ? `<div class="of-micro text-muted">${of_esc(e.po_supplier_name)}</div>` : ''}
                    ${e.subcontracting_order ? `<div class="of-micro"><span class="of-chip">Subcontract</span></div>` : ''}</td>
                <td>${of_so_links(e.sales_orders)}
                    ${e.so_customer_names ? `<div class="of-micro text-muted">${of_esc(e.so_customer_names)}</div>` : ''}</td>
                <td class="of-ewo-notes-cell">${e.notes ? of_ewo_notes_html(e.notes) : '<span class="text-muted">—</span>'}</td>
                <td class="of-meta">${of_date(e.date)}</td>
                <td>${of_qty(e.ordered_qty)}</td>
                <td>${of_qty(e.received_qty, flt_of(e.received_qty) > 0 ? 'pos' : null)}</td>
                <td>${of_qty(pending, pending > 0 ? 'warn' : null)}</td>
                <td><span class="of-pill of-pill--planned">${of_esc(of_to_title_case(stage || e.status || ''))}</span></td>
                <td class="of-ewo-action" data-po="${of_esc(view_only || of_num(e.po_exists) === 0 ? '' : (e.purchase_order || ''))}">
                    <div class="of-ewo-actions">
                        ${action_html}
                        <button class="of-btn of-ewo-print-btn" data-name="${of_esc(e.name)}"
                                title="${__('Print work order')}">
                            <i class="fa fa-print"></i>
                        </button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    // The Full Piece / Panel work-order card — `tab` is whichever tab owns
    // the pagination and Draft/Submitted state (jobwork or tracker), `key`
    // the sub-list (ewo_fp / ewo_pn) as the server names it.
    ewo_card_html(tab, key, env) {
        env = env || {};
        const is_fp = key === 'ewo_fp';
        const view_only = tab === 'tracker' && this.merch_view_only('tracker', key === 'ewo_fp' ? 'fp' : 'pn');
        return of_card(
            is_fp ? 'Embroidery Work Orders (Full Piece Work)' : 'Embroidery Work Orders (Panel Work)',
            is_fp ? 'magic' : 'scissors', `
            <table class="of-table">
                <thead><tr><th style="min-width:160px;">Work Order</th><th style="min-width:140px;">Jobber</th>
                    <th>Purchase Order</th><th>Sales Order</th><th style="width:230px;">Notes</th><th>Date</th>
                    <th>Sent</th><th>Received</th><th>Pending</th><th>Stage</th><th>Action</th></tr></thead>
                <tbody>${this.ewo_rows_html(env.rows, view_only) || of_empty_row(11)}</tbody>
            </table>`, null, of_pagination_html(tab, key, env),
            of_docstatus_pills(tab, key, env.docstatus_counts, (this.docstatus_filter[tab] || {})[key])
                + this.table_filters_html(`${tab}.${key}`));
    }

    // ── Tab 4: Accounts (Receivables, Supplier Payables & Jobber Payables) ──
    // ── Billing (Accounts tab): Sales Orders that shipped but still need
    //    invoicing — the reverse of the "receivables/payables" Finance tab.
    // ── Stock Tracker: global item availability & Pick List reservations ──
    // Stock that looks free in Bin may already be claimed by another order's
    // Pick List — this reads net_available (already computed server-side)
    // rather than the raw available figure, so "what can I actually promise
    // right now" is answered directly instead of left for the reader to work
    // out by hand.
    stock_html(data) {
        data = data || {};
        const items = data.rows || [];
        this._stock_items = items;
        this.$body.find('#of-count').text(data.total ? __('{0} item(s) match', [data.total]) : '');
        const wh = this.stock_warehouse_filter || '';
        const where = wh ? ` — ${wh}` : '';
        const link = (it, qty, kind, label) => {
            qty = of_round2(qty);
            if (!qty) return '<span class="text-muted">0</span>';
            return `<a href="#" class="of-reserve-link" data-item="${of_esc(it.item_code)}" data-warehouse="${of_esc(wh)}"
                        data-kind="${kind}" data-label="${of_esc(label)}">${qty}</a>`;
        };
        // what the held number is made of, in one short line
        const held_parts = (it) => [
            [it.picked_draft_qty, __('draft pick')], [it.picked_submitted_qty, __('picked')],
            [it.embroidery_qty, __('at embroidery')], [it.earmark_qty, __('bought for order')],
        ].filter(x => flt_of(x[0])).map(x => `${of_round2(x[0])} ${x[1]}`).join(' · ');
        const rows = items.map(it => {
            const after = of_round2(it.after_orders);
            return `<tr data-item="${of_esc(it.item_code)}" class="of-stock-row">
                <td style="text-align:left;"><i class="fa fa-caret-right of-stock-wh-toggle" data-item="${of_esc(it.item_code)}" style="cursor:pointer;margin-right:4px;color:var(--text-light);"></i>
                    <a href="/app/item/${encodeURIComponent(it.item_code)}" target="_blank" style="font-weight:700;">${of_esc(it.item_code)}</a>
                    ${it.item_name && it.item_name !== it.item_code ? `<div class="of-micro text-muted">${of_esc(it.item_name)}</div>` : ''}</td>
                <td><b>${of_round2(it.actual_qty)}</b> <span class="of-micro text-muted">${of_esc(it.stock_uom || '')}</span></td>
                <td class="of-st-held">${flt_of(it.held_qty) ? `<b>${of_round2(it.held_qty)}</b><div class="of-micro text-muted">${held_parts(it)}</div>` : '<span class="text-muted">0</span>'}</td>
                <td class="of-st-free"><b>${of_round2(it.free_qty)}</b></td>
                <td>${link(it, it.booked_not_picked, 'reserved', `Submitted Sales Orders still to deliver — ${it.item_code}${where}`)}</td>
                <td style="font-weight:700;color:${after < 0 ? 'var(--of-red)' : 'var(--of-green)'};">${after < 0 ? `${__('short')} ${-after}` : after}</td>
                ${wh ? `<td class="text-muted">${flt_of(it.other_qty) ? of_round2(it.other_qty) : '0'}</td>` : ''}
            </tr>`;
        }).join('');

        return `
            ${of_card(wh ? __('Item Availability — {0}', [wh]) : __('Item Availability — all warehouses'), 'cubes', `
                <div class="of-st-legend">
                    <span><b>${__('Held for orders')}</b>: ${__('draft / submitted Pick Lists, goods at the embroidery jobber, raw material bought for an order')}.</span>
                    <span><b>${__('Free now')}</b> = ${__('On hand − Held')}.</span>
                    <span><b>${__('Ordered, not picked')}</b>: ${__('submitted Sales Orders not picked yet (draft orders not counted)')}.</span>
                    <span class="text-muted">${__('Open an item for the details and other warehouses.')}</span>
                </div>
                <table class="of-table of-stock-table">
                    <thead><tr><th style="min-width:200px;">${__('Item')}</th><th>${__('On hand')}</th>
                        <th class="of-st-held-head">${__('Held for orders')}</th><th class="of-st-free">${__('Free now')}</th>
                        <th title="${__('Submitted Sales Orders still to deliver, minus what Pick Lists already cover. Draft Sales Orders are not counted.')}">${__('Ordered, not picked')}</th>
                        <th>${__('Free after open orders')}</th>
                        ${wh ? `<th title="${__('Stock in every other warehouse (not counted here)')}">${__('Other warehouses')}</th>` : ''}</tr></thead>
                    <tbody>${rows || of_empty_row(wh ? 7 : 6)}</tbody>
                </table>`, null, of_pagination_html('stock', null, data), this.table_filters_html('stock'))}
        `;
    }

    // Warehouse breakdown for one item — rendered straight from the already-
    // fetched row data, no extra server call needed.
    toggle_stock_wh_row($row, item_code, $btn) {
        let $details = $row.next('.of-doc-items-row');
        if (!$details.length) {
            const it = (this._stock_items || []).find(i => i.item_code === item_code) || {};
            const colspan = $row.find('td').length || 7;
            const wh = this.stock_warehouse_filter || '';
            const link = (warehouse, qty, kind, label) => {
                qty = of_round2(qty);
                if (!qty) return '<span class="text-muted">0</span>';
                return `<a href="#" class="of-reserve-link" data-item="${of_esc(item_code)}" data-warehouse="${of_esc(warehouse)}"
                            data-kind="${kind}" data-label="${of_esc(label)}">${qty}</a>`;
            };
            // 1. what is held, by kind (click a number for the documents)
            const held = `<div class="of-st-detail">
                <div class="of-micro" style="font-weight:700;margin-bottom:4px;">${__('Held for orders')}${wh ? ` — ${of_esc(wh)}` : ''}</div>
                <div class="of-st-chips">
                    <span>${__('Draft Pick Lists')}: ${link(wh, it.picked_draft_qty, 'pick_draft', `Draft Pick Lists — ${item_code}${wh ? ' at ' + wh : ''}`)}</span>
                    <span>${__('Picked (submitted, not delivered)')}: ${link(wh, it.picked_submitted_qty, 'pick_submitted', `Submitted Pick Lists — ${item_code}${wh ? ' at ' + wh : ''}`)}</span>
                    <span>${__('At embroidery jobber')}: ${link(wh, it.embroidery_qty, 'embroidery', `At the embroidery jobber — ${item_code}`)}</span>
                    <span>${__('Bought for an order')}: ${link(wh, it.earmark_qty, 'earmark', `Raw material bought for an order — ${item_code}`)}</span>
                </div>
                ${flt_of(it.over_held) > 0 ? `<div class="of-micro" style="color:var(--of-red);margin-top:4px;">${__('Held {0} more than is on hand.', [of_round2(it.over_held)])}</div>` : ''}
            </div>`;
            // 2. stock elsewhere: other warehouses when one is chosen, else every warehouse
            const others = wh ? (it.other_warehouses || []) : (it.warehouse_stock || []);
            const other_tbl = others.length ? `<div class="of-micro" style="font-weight:700;margin:10px 0 4px;">${wh ? __('Other warehouses (not counted above)') : __('By warehouse')}</div>
                <div class="of-scroll"><table class="of-table"><thead><tr><th>${__('Warehouse')}</th><th>${__('On hand')}</th>${wh ? '' : `<th>${__('Held')}</th><th>${__('Free now')}</th>`}</tr></thead>
                <tbody>${others.map(o => `<tr><td style="text-align:left;">${of_esc(o.warehouse)}</td><td><b>${of_round2(o.actual_qty)}</b></td>
                    ${wh ? '' : `<td>${of_round2(o.held_qty)}</td><td style="color:var(--of-green);font-weight:700;">${of_round2(o.free_qty)}</td>`}</tr>`).join('')}</tbody></table></div>`
                : `<div class="of-micro text-muted" style="margin-top:8px;">${wh ? __('No stock in other warehouses.') : ''}</div>`;
            const body = held + other_tbl;

            $details = $(`
                <tr class="of-doc-items-row of-hidden" style="display:none;">
                    <td colspan="${colspan}" style="padding:12px 15px; background:var(--subtle-fg); text-align:left;">${body}</td>
                </tr>`);
            $row.after($details);
        }

        const collapsed = $details.hasClass('of-hidden') || !$details.is(':visible');
        $details.toggleClass('of-hidden', !collapsed).toggle(collapsed);
        $btn.toggleClass('fa-caret-right', !collapsed).toggleClass('fa-caret-down', collapsed)
            .css('color', collapsed ? 'var(--of-blue)' : 'var(--text-light)');
    }

    // Which documents are actually behind one of the three reservation
    // counters — see order_flow_api.get_stock_reservation_details for how
    // each is re-derived to match Bin's own calculation.
    show_reservation_details_modal(item_code, warehouse, kind, label) {
        frappe.call({
            method: 'erp_dacsinc_custom.order_flow_api.get_stock_reservation_details',
            args: { item_code, warehouse, kind },
            freeze: true,
            freeze_message: __('Loading…')
        }).then(r => {
            const rows = r.message || [];
            let body;

            if (!rows.length) {
                body = `<div class="of-empty" style="text-align:center; padding: 20px;">
                    <p style="margin-bottom:15px; font-size:13px; color:var(--text-muted);">
                        ${__('No open document currently reserves this — the stock figure may be stale.')}
                    </p>
                    <button class="of-btn of-btn--primary of-repost-btn" data-item="${of_esc(item_code)}" data-warehouse="${of_esc(warehouse)}" style="padding: 6px 12px; font-size: 12px; border-radius: 4px;">
                        <i class="fa fa-refresh" style="margin-right:5px;"></i> ${__('Recalculate Bin Qty')}
                    </button>
                </div>`;
            } else if (kind === 'reserved') {
                body = `<table class="of-table">
                    <thead><tr><th>Sales Order</th><th>Customer</th><th>Qty</th><th>Delivered</th><th>Outstanding</th></tr></thead>
                    <tbody>${rows.map(x => `<tr>
                        <td>${of_so_link(x.name)}</td>
                        <td>${of_esc(x.customer_name || '')}</td>
                        <td>${of_round2(x.qty)}</td>
                        <td>${of_round2(x.delivered_qty)}</td>
                        <td style="font-weight:700;">${of_round2(x.outstanding_qty)}</td>
                    </tr>`).join('')}</tbody>
                </table>`;
            } else if (kind === 'embroidery' || kind === 'earmark') {
                body = `<table class="of-table">
                    <thead><tr><th>${kind === 'embroidery' ? __('Embroidery Work Order') : __('Held for')}</th><th>${__('Sales Order')}</th><th>${__('Qty')}</th></tr></thead>
                    <tbody>${rows.map(x => `<tr>
                        <td>${kind === 'embroidery' ? `<a href="/app/embroidery-work-order/${encodeURIComponent(x.name)}" target="_blank">${of_esc(x.name)}</a>` : __('raw material for the order')}</td>
                        <td>${x.sales_order ? `${of_so_link(x.sales_order)}${x.customer_name ? `<div class="of-micro text-muted">${of_esc(x.customer_name)}</div>` : ''}` : '—'}</td>
                        <td style="font-weight:700;">${of_round2(x.qty)}</td>
                    </tr>`).join('')}</tbody>
                </table>`;
            } else if (kind === 'production') {
                body = `<table class="of-table">
                    <thead><tr><th>Work Order</th><th>Status</th><th>Required</th><th>Transferred</th><th>Outstanding</th></tr></thead>
                    <tbody>${rows.map(x => `<tr>
                        <td><a href="/app/work-order/${encodeURIComponent(x.name)}" target="_blank">${of_esc(x.name)}</a></td>
                        <td>${of_esc(x.status)}</td>
                        <td>${of_round2(x.required_qty)}</td>
                        <td>${of_round2(x.transferred_qty)}</td>
                        <td style="font-weight:700;">${of_round2(x.outstanding_qty)}</td>
                    </tr>`).join('')}</tbody>
                </table>`;
            } else if (kind === 'pick_draft' || kind === 'pick_submitted') {
                body = `<table class="of-table">
                    <thead><tr><th>Pick List</th><th>Warehouse</th><th>Sales Order</th><th>Qty</th></tr></thead>
                    <tbody>${rows.map(x => `<tr>
                        <td><a href="/app/pick-list/${encodeURIComponent(x.name)}" target="_blank">${of_esc(x.name)}</a></td>
                        <td>${of_esc(x.warehouse || '')}</td>
                        <td>${x.sales_order ? `${of_so_link(x.sales_order)}
                            ${x.customer_name ? `<div class="of-micro text-muted">${of_esc(x.customer_name)}</div>` : ''}` : ''}</td>
                        <td style="font-weight:700;">${of_round2(x.qty)}</td>
                    </tr>`).join('')}</tbody>
                </table>`;
            } else {
                body = `<table class="of-table">
                    <thead><tr><th>Document</th><th>Supplier</th><th>Qty Required</th></tr></thead>
                    <tbody>${rows.map(x => `<tr>
                        <td><a href="/app/${of_route(x.doctype)}/${encodeURIComponent(x.name)}" target="_blank">${of_esc(x.name)}</a>
                            <div class="of-micro text-muted">${of_esc(x.doctype)}</div></td>
                        <td>${of_esc(x.supplier_name || x.supplier || '')}</td>
                        <td>${of_round2(x.qty)}</td>
                    </tr>`).join('')}</tbody>
                </table>`;
            }

            const dialog = new frappe.ui.Dialog({
                title: label,
                size: 'large',
                fields: [{ fieldtype: 'HTML', fieldname: 'content' }]
            });
            dialog.fields_dict.content.$wrapper.html(`<div class="of-scroll">${body}</div>`);
            if (!this.can_act('stock')) dialog.$wrapper.find('.of-repost-btn').remove();
            dialog.$wrapper.on('click', '.of-repost-btn', (e) => {
                const btn = $(e.currentTarget);
                const item = btn.data('item');
                const wh = btn.data('warehouse');
                frappe.call({
                    method: 'erp_dacsinc_custom.order_flow_api.repost_bin_qty',
                    args: { item_code: item, warehouse: wh },
                    freeze: true,
                    freeze_message: __('Recalculating…')
                }).then(() => {
                    frappe.show_alert({ message: __('Bin quantity recalculated successfully.'), indicator: 'green' });
                    dialog.hide();
                    this.refresh(true);
                });
            });
            dialog.show();
        });
    }

    // ── Tab: Pick Lists ──────────────────────────────────────────
    // A draft Pick List holds no stock and delivers nothing until it is
    // submitted — and until then the order behind it silently reads as
    // unfulfilled everywhere else in this dashboard. This tab exists so a
    // draft never sits forgotten: it lists the Pick Lists themselves (not
    // the Sales Orders around them) and offers Submit right on the row.
    picklist_html(data) {
        data = data || {};
        const rows_data = data.rows || [];
        const m = data.metrics || {};
        this.$body.find('#of-count').text(
            data.total ? __('{0} pick list(s) match', [data.total]) : ''
        );

        const status_pill = (r) => {
            const cls = of_num(r.docstatus) === 0 ? 'of-pill--draft'
                : r.status === 'Completed' ? 'of-pill--ready'
                : r.status === 'Cancelled' ? 'of-pill--blocked'
                : r.status === 'Partly Delivered' ? 'of-pill--wait'
                : 'of-pill--planned';
            return `<span class="of-pill ${cls}">${of_esc(r.status || '')}</span>${of_embroidery_history_html(r.embroidery_history)}`;
        };

        // Picked stock that is no longer on the shelf in VV Puram (stock_hold.missing_by_pick_list):
        // its Delivery Note would be refused, so say so before anyone tries.
        const missing_html = (r) => flt(r.stock_missing_qty) > 0.001
            ? `<div class="of-micro" style="color:var(--of-red);font-weight:700;margin-top:4px;"
                   title="${__('This much of what the Pick List holds is not in VV Puram - IND any more (e.g. a receipt was cancelled after picking). Revert it to draft and pick again when stock arrives, or release it.')}">
                   <i class="fa fa-exclamation-triangle"></i> ${__('Stock missing')}: ${of_round2(r.stock_missing_qty)}</div>` : '';
        const action_cell = (r) => missing_html(r) + action_cell_main(r);
        const action_cell_main = (r) => {
            if (r.next_action === 'held') {
                return of_embroidery_hold_html(r);
            }
            if (r.next_action === 'submit') {
                return `<button class="of-btn of-btn--primary of-pl-submit" data-pl="${of_esc(r.name)}"
                            title="${__('Submit this Pick List')}"><i class="fa fa-check"></i> ${__('Submit')}</button>`;
            }
            // Submitted by mistake and needed for embroidery: bring it back to
            // draft — only while no Delivery Note has been made from it.
            const undo = of_pl_revert_html(r);
            if (r.next_action === 'deliver') {
                return `<span class="of-micro" style="color:var(--of-orange);font-weight:600;">
                    ${of_round2(r.pending_delivery_qty)} ${__('awaiting Delivery Note')}</span>${undo}`;
            }
            return undo || '<span class="of-val--zero">—</span>';
        };

        const rows = rows_data.map(r => {
            const so_links = (r.sales_orders || []).map(so =>
                `<a href="/app/sales-order/${encodeURIComponent(so)}" target="_blank">${of_esc(so)}</a>`
            ).join(', ');
            // A draft row's own picked_qty is still 0 until submit, so "Qty"
            // shows what the list is FOR (qty) and "Picked" only becomes
            // meaningful once submitted — showing 0 picked on a draft as if
            // something had gone wrong is exactly the confusion to avoid.
            const picked_cell = of_num(r.docstatus) === 0
                ? `<span class="of-val--zero">${__('not yet')}</span>`
                : of_round2(r.picked_qty);
            return `<tr>
                <td><a href="/app/pick-list/${encodeURIComponent(r.name)}" target="_blank"
                       style="font-weight:700;">${of_esc(r.name)}</a>
                    <div class="of-micro text-muted">${of_esc(r.purpose || '')}</div>
                    ${of_creator_html(r)}</td>
                <td class="of-pl-status">${status_pill(r)}</td>
                <td>${of_esc(r.customer_name || r.customer || '')}
                    ${r.customer && r.customer_name && r.customer !== r.customer_name
                        ? `<div class="of-micro text-muted">${of_esc(r.customer)}</div>` : ''}</td>
                <td>${so_links || '<span class="of-val--zero">—</span>'}</td>
                <td style="min-width:200px;text-align:left;">${of_pl_items_html(r.items, of_num(r.docstatus) === 0)}</td>
                <td>${of_round2(r.total_qty)}</td>
                <td>${picked_cell}</td>
                <td>${of_round2(r.delivered_qty)}</td>
                <td>${of_date(r.modified)}</td>
                <td>${action_cell(r)}</td>
            </tr>`;
        }).join('');

        const counts = `<span class="of-micro" style="font-weight:600;">
            <span style="color:var(--of-orange);">${of_num(m.draft)} ${__('draft')}</span> ·
            <span>${of_num(m.open)} ${__('open')}</span> ·
            <span>${of_num(m.partly)} ${__('partly delivered')}</span>
        </span>`;

        return `
            ${of_card('Pick Lists', 'hand-paper-o', `
                <table class="of-table">
                    <thead><tr>
                        <th style="min-width:150px;">Pick List</th><th style="width:150px;">Status</th>
                        <th style="min-width:140px;">Customer</th><th>Sales Order</th>
                        <th>Items</th><th>Qty</th><th>Picked</th>
                        <th>Delivered</th><th>Last Activity</th><th>Action</th>
                    </tr></thead>
                    <tbody>${rows || of_empty_row(10)}</tbody>
                </table>`, counts, of_pagination_html('picklist', null, data),
                this.table_filters_html('picklist'))}
        `;
    }

    billing_html(data) {
        data = data || {};
        const orders_env = data.orders || {};
        const orders = orders_env.rows || [];

        this.$body.find('#of-count').text(
            orders_env.total ? __('{0} order(s) pending DN/SI', [orders_env.total]) : ''
        );

        // Same stage object the Sales Tracker itself renders its action button
        // from (o.stage — see tracker_html), so an action shown here can never
        // disagree with what the Tracker would show for the same order.
        //
        // But this tab exists for BILLING, and an order's billing need is not
        // always its primary stage: a partly-delivered order's primary action
        // is about the rest of the order (raise an MR, await stock) while the
        // unbilled delivered qty rides along as secondary_action. Rendering the
        // primary action alone put "Raise MR from SO" in the Action column of
        // the Pending DN/SI tab while the invoice this tab is actually about
        // had no button at all. So where a billing action exists, it leads
        // here — the other action still shows underneath, since it is real work
        // too, just not what this queue is for.
        const btn_html = (act, o, extra_class) => `
            <button class="of-btn ${act.action_btn_class || 'of-btn--primary'} of-action-btn ${extra_class || ''}"
                    title="${of_esc(act.action_hint || act.action_label || '')}"
                    data-action="${act.action_type}"
                    data-target="${act.target_doc || ''}"
                    data-doctype="${act.target_doctype || ''}"
                    data-so="${of_esc(o.name)}"
                    data-customer="${of_esc(o.customer || '')}"
                    data-customer-name="${of_esc(o.customer_name || '')}"
                    data-route-lock="${of_esc(act.route_lock || '')}">
                <i class="fa fa-${act.icon || 'arrow-right'}"></i> ${of_esc(act.action_label || 'Act')}
            </button>`;

        const rows = orders.map(o => {
            const st = o.stage || {};
            const sec = st.secondary_action;
            const lead = (sec && sec.action_type) ? sec : st;
            const trailing = (sec && sec.action_type) ? st : null;

            const has_lead = lead.action_type && lead.action_type !== 'none';
            const has_trailing = trailing && trailing.action_type && trailing.action_type !== 'none';

            const action_html = has_lead
                ? btn_html(lead, o) + (has_trailing
                    ? `<div class="of-micro" style="margin-top:6px;color:var(--text-muted);">
                           ${__('Also pending')}: ${of_esc(trailing.action_label || '')}
                       </div>`
                    : '')
                : `<span class="of-micro" style="color:var(--of-green);font-weight:600;"><i class="fa fa-check-circle"></i> ${__('Done')}</span>`;

            return `<tr data-so="${of_esc(o.name)}" class="of-row-main">
                <td><i class="fa fa-caret-right of-so-toggle" data-so="${of_esc(o.name)}" style="cursor:pointer; width:12px; font-size:14px; color:var(--text-light);"></i>
                    ${of_so_link(o.name, {bold: true})}<a href="#" class="of-order-status" data-so="${o.name}" title="${of_esc(__('Order Status — where every item of this order is right now'))}" style="display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; margin-left:4px; border-radius:4px; background:var(--of-blue-tint, rgba(52,152,219,.12)); color:var(--of-blue, #2980b9); font-size:11px; vertical-align:middle; text-decoration:none;"><i class="fa fa-map-signs"></i></a>
                    ${of_creator_html(o)}</td>
                <td style="text-align:left;">
                    <a href="/app/customer/${encodeURIComponent(o.customer)}" target="_blank" style="font-weight:600;">${of_customer_display(o.customer_name || o.customer, o.contact_person_name)}</a>
                </td>
                <td class="of-meta">${of_date(o.transaction_date)}</td>
                <td style="font-weight:700;">${of_money(o.grand_total, o.currency)}</td>
                <td>${flt_of(o.per_delivered).toFixed(0)}%</td>
                <td>${flt_of(o.per_billed).toFixed(0)}%</td>
                <td><span class="of-pill ${st.badge_class || 'of-pill--wait'}">${of_esc(st.stage_label || '')}</span>
                    ${(sec && sec.action_type) ? `<div class="of-micro" style="margin-top:4px;color:var(--of-orange);font-weight:600;">
                        <i class="fa fa-file-text-o"></i> ${__('Needs Invoice')}</div>` : ''}</td>
                <td>${action_html}</td>
            </tr>`;
        }).join('');

        return `
            <!-- Live Activity Notifications -->
            ${this.activity_stream_html('billing')}

            <!-- Top Summary Cards -->
            <div class="of-summary" id="of-summary-billing"></div>

            ${of_card('Sales Orders Pending DN / SI', 'truck', `
                <table class="of-table">
                    <thead><tr><th style="min-width:160px;">Sales Order</th><th style="min-width:160px;">Customer</th>
                        <th>Order Date</th><th>Grand Total</th><th>Delivered %</th><th>Billed %</th><th>Stage</th><th>Action</th></tr></thead>
                    <tbody>${rows || of_empty_row(8)}</tbody>
                </table>`, null, of_pagination_html('billing', null, orders_env), this.table_filters_html('billing'))}
        `;
    }

    accounts_html(data) {   
        data = data || {};
        const sis_env = data.sales_invoices || {};
        const sups_env = data.supplier_invoices || {};
        const jobs_env = data.jobber_invoices || {};
        const sis = sis_env.rows || [];
        const sups = sups_env.rows || [];
        const jobs = jobs_env.rows || [];
        const notes_env = data.notes || {};
        const notes = notes_env.rows || [];
        const m = data.metrics || {};

        this.$body.find('#of-count').text(
            __('{0} Customer Invoices · {1} Supplier Invoices · {2} Jobber Invoices · {3} Returns / Notes',
                [sis_env.total || 0, sups_env.total || 0, jobs_env.total || 0, notes_env.total || 0])
        );

        // Render Sales Invoices Rows
        const si_rows = sis.map(s => {
            const out = flt_of(s.outstanding_amount);
            const status_pill = of_invoice_status_html(s);

            return `<tr class="of-doc-row">
                <td><i class="fa fa-caret-right of-doc-items-toggle" data-doctype="Sales Invoice" data-docname="${of_esc(s.name)}" data-docstatus="${s.docstatus}" style="cursor:pointer;margin-right:4px;color:var(--text-light);"></i>
                    <a href="/app/sales-invoice/${encodeURIComponent(s.name)}" target="_blank" style="font-weight:700;">${of_esc(s.name)}</a>
                    ${of_creator_html(s)}</td>
                <td style="text-align:left;">
                    <a href="/app/customer/${encodeURIComponent(s.customer)}" target="_blank" style="font-weight:600;">${of_customer_display(s.customer_name || s.customer, s.contact_person_name)}</a>
                    <div class="of-micro text-muted">${of_esc(s.customer || '')}</div>${of_remark_html(s.remarks)}
                </td>
                <td>${of_so_links(s.sales_orders)}
                    ${s.so_customer_names ? `<div class="of-micro text-muted">${of_esc(s.so_customer_names)}</div>` : ''}</td>
                <td class="of-meta">${of_date(s.posting_date)}
                    <div class="of-micro">Due ${of_date(s.due_date)}</div></td>
                <td style="font-weight:700;">${of_money(s.grand_total, s.currency)}</td>
                <td style="color:var(--of-green);">${of_money(s.paid_amount, s.currency)}${of_payment_lines(s.payments, s.currency, s.name)}</td>
                <td style="color:${out > 0 ? 'var(--of-red)' : 'var(--text-muted)'};font-weight:700;">${of_money(out, s.currency)}</td>
                <td>${status_pill}${of_return_chips(s.returns, 'Sales Invoice')}</td>
                <td><div class="of-po-actions">
                    ${out > 0 && data.can_pay && flt_of(s.docstatus) === 1 ? `<button class="of-btn of-btn--success of-pay-btn" data-doctype="Sales Invoice" data-name="${of_esc(s.name)}">
                        <i class="fa fa-inr"></i> ${__('Receive')}</button>` : ''}
<button class="of-btn of-print-copies-btn" data-doctype="Sales Invoice" data-name="${of_esc(s.name)}" data-is-return="${flt_of(s.is_return) ? 1 : 0}" data-docstatus="${s.docstatus}" title="${__('Print — choose Original / Duplicate / Triplicate / Quadruplicate')}"><i class="fa fa-print"></i></button>
                    <a class="of-btn" href="/app/sales-invoice/${encodeURIComponent(s.name)}" target="_blank">
                        <i class="fa fa-external-link"></i> Open
                    </a>
                </div></td>
            </tr>`;
        }).join('');

        // Render Supplier Invoices Rows
        const sup_rows = sups.map(p => {
            const out = flt_of(p.outstanding_amount);
            const status_pill = of_invoice_status_html(p);

            return `<tr class="of-doc-row">
                <td><i class="fa fa-caret-right of-doc-items-toggle" data-doctype="Purchase Invoice" data-docname="${of_esc(p.name)}" data-docstatus="${p.docstatus}" style="cursor:pointer;margin-right:4px;color:var(--text-light);"></i>
                    <a href="/app/purchase-invoice/${encodeURIComponent(p.name)}" target="_blank" style="font-weight:700;">${of_esc(p.name)}</a>
                    ${of_creator_html(p)}</td>
                <td style="text-align:left;">
                    <a href="/app/supplier/${encodeURIComponent(p.supplier)}" target="_blank" style="font-weight:600;">${of_esc(p.supplier_name || p.supplier || '')}</a>${of_remark_html(p.remarks)}
                </td>
                <td>${of_so_links(p.sales_orders)}
                    ${p.so_customer_names ? `<div class="of-micro text-muted">${of_esc(p.so_customer_names)}</div>` : ''}</td>
                <td class="of-meta">${of_date(p.posting_date)}
                    <div class="of-micro">Due ${of_date(p.due_date)}</div></td>
                <td style="font-weight:700;">${of_money(p.grand_total, p.currency)}</td>
                <td style="color:var(--of-info);">${of_money(p.paid_amount, p.currency)}${of_payment_lines(p.payments, p.currency, p.name)}</td>
                <td style="color:${out > 0 ? 'var(--of-red)' : 'var(--text-muted)'};font-weight:700;">${of_money(out, p.currency)}</td>
                <td>${status_pill}${of_return_chips(p.returns, 'Purchase Invoice')}</td>
                <td><div class="of-po-actions">
                    ${out > 0 && data.can_pay && flt_of(p.docstatus) === 1 ? `<button class="of-btn of-btn--primary of-pay-btn" data-doctype="Purchase Invoice" data-name="${of_esc(p.name)}">
                        <i class="fa fa-inr"></i> ${__('Pay')}</button>` : ''}
<button class="of-btn of-print-copies-btn" data-doctype="Purchase Invoice" data-name="${of_esc(p.name)}" data-is-return="${flt_of(p.is_return) ? 1 : 0}" data-docstatus="${p.docstatus}" title="${__('Print — choose Original / Duplicate / Triplicate / Quadruplicate')}"><i class="fa fa-print"></i></button>
                    <a class="of-btn" href="/app/purchase-invoice/${encodeURIComponent(p.name)}" target="_blank">
                        <i class="fa fa-external-link"></i> Open
                    </a>
                </div></td>
            </tr>`;
        }).join('');

        // Render Jobber Invoices Rows
        const job_rows = jobs.map(p => {
            const out = flt_of(p.outstanding_amount);
            const status_pill = of_invoice_status_html(p);

            return `<tr class="of-doc-row">
                <td><i class="fa fa-caret-right of-doc-items-toggle" data-doctype="Purchase Invoice" data-docname="${of_esc(p.name)}" data-docstatus="${p.docstatus}" style="cursor:pointer;margin-right:4px;color:var(--text-light);"></i>
                    <a href="/app/purchase-invoice/${encodeURIComponent(p.name)}" target="_blank" style="font-weight:700;">${of_esc(p.name)}</a>
                    ${of_creator_html(p)}</td>
                <td style="text-align:left;">
                    <a href="/app/supplier/${encodeURIComponent(p.supplier)}" target="_blank" style="font-weight:600;">${of_esc(p.supplier_name || p.supplier || '')}</a>
                    <div class="of-micro text-muted"><span class="of-chip">Jobber</span></div>${of_remark_html(p.remarks)}
                </td>
                <td>${of_so_links(p.sales_orders)}
                    ${p.so_customer_names ? `<div class="of-micro text-muted">${of_esc(p.so_customer_names)}</div>` : ''}</td>
                <td class="of-meta">${of_date(p.posting_date)}
                    <div class="of-micro">Due ${of_date(p.due_date)}</div></td>
                <td style="font-weight:700;">${of_money(p.grand_total, p.currency)}</td>
                <td style="color:var(--of-purple);">${of_money(p.paid_amount, p.currency)}${of_payment_lines(p.payments, p.currency, p.name)}</td>
                <td style="color:${out > 0 ? 'var(--of-red)' : 'var(--text-muted)'};font-weight:700;">${of_money(out, p.currency)}</td>
                <td>${status_pill}${of_return_chips(p.returns, 'Purchase Invoice')}</td>
                <td><div class="of-po-actions">
                    ${out > 0 && data.can_pay && flt_of(p.docstatus) === 1 ? `<button class="of-btn of-btn--primary of-pay-btn" data-doctype="Purchase Invoice" data-name="${of_esc(p.name)}">
                        <i class="fa fa-inr"></i> ${__('Pay')}</button>` : ''}
<button class="of-btn of-print-copies-btn" data-doctype="Purchase Invoice" data-name="${of_esc(p.name)}" data-is-return="${flt_of(p.is_return) ? 1 : 0}" data-docstatus="${p.docstatus}" title="${__('Print — choose Original / Duplicate / Triplicate / Quadruplicate')}"><i class="fa fa-print"></i></button>
                    <a class="of-btn" href="/app/purchase-invoice/${encodeURIComponent(p.name)}" target="_blank">
                        <i class="fa fa-external-link"></i> Open
                    </a>
                </div></td>
            </tr>`;
        }).join('');

        // Returns / Notes rows: Credit Notes (sales returns) and Debit Notes (purchase returns) with
        // what each did in the accounts and what is left to do (order_flow_api._describe_notes).
        const note_rows = notes.map(n => of_note_row_html(n, data.can_pay)).join('');

        const subtab = this.acc_subtab || 'receivables';

        return `
            <!-- Live Activity Notifications -->
            ${this.activity_stream_html('accounts')}

            <!-- Finance only: start the entries the accounts team makes by hand (open in a new tab) -->
            ${of_fin_new_bar()}

            <!-- Sub-tabs as summary cards: what is open, how much is settled, how many invoices
                 (replaces the six tiles, the plain sub-tab bar and the settlement bar). -->
            <div class="of-kcards">
                ${of_kcard({ sub: 'receivables', active: subtab === 'receivables', icon: 'arrow-circle-down', tone: 'green',
                    title: __('Receivables'), open: m.sales_outstanding, open_label: __('to collect'),
                    settled: m.sales_received, total: m.sales_total, settled_label: __('received'),
                    docs: sis_env.total || 0, doc_label: __('customer invoice') })}
                ${of_kcard({ sub: 'supplier', active: subtab === 'supplier', icon: 'arrow-circle-up', tone: 'red',
                    title: __('Supplier Payables'), open: m.supplier_outstanding, open_label: __('to pay'),
                    settled: m.supplier_paid, total: m.supplier_total, settled_label: __('paid'),
                    docs: sups_env.total || 0, doc_label: __('supplier invoice') })}
                ${of_kcard({ sub: 'jobber', active: subtab === 'jobber', icon: 'cogs', tone: 'purple',
                    title: __('Jobber Payables'), open: m.jobber_outstanding, open_label: __('to pay'),
                    settled: m.jobber_paid, total: m.jobber_total, settled_label: __('paid'),
                    docs: jobs_env.total || 0, doc_label: __('jobber invoice') })}
                ${of_notes_kcard(m, subtab === 'notes', notes_env.total || 0)}
                <!-- The Accounts Guide (/accounts-guide): entries, debit / credit, Journal Entry, fixes. -->
                <a class="of-guide-tile" href="/accounts-guide" target="_blank" title="${__('How the accounts team works: types of entries, debit and credit, Journal Entry, examples, quick fixes')}">
                    <i class="fa fa-book"></i>
                    <span><b>${__('Accounts Guide')}</b><small>${__('Entries, debit / credit, Journal Entry, fixes')}</small></span>
                </a>
            </div>

            <!-- Tables -->
            <div id="of-acc-sec-receivables" class="${subtab !== 'receivables' ? 'of-hidden' : ''}">
                ${of_card('Sales Invoices — Customer Receivables', 'money', `
                    <table class="of-table">
                        <thead><tr><th style="min-width:160px;">Sales Invoice</th><th style="min-width:160px;">Customer</th>
                            <th>Sales Order</th><th>Dates</th><th>Total Amount</th><th>Received</th>
                            <th>Outstanding (Receivable)</th><th>Status</th><th>Action</th></tr></thead>
                        <tbody>${si_rows || of_empty_row(9)}</tbody>
                    </table>`,
                    `<a class="of-btn of-btn--primary" href="/app/sales-invoice/new" target="_blank">
                        <i class="fa fa-plus"></i> ${__('Create Sales Invoice')}
                    </a>`, of_pagination_html('accounts', 'sales', sis_env),
                    of_docstatus_pills('accounts', 'sales', sis_env.docstatus_counts, this.docstatus_filter.accounts.sales) + this.table_filters_html('accounts.receivables'))}
            </div>

            <div id="of-acc-sec-supplier" class="${subtab !== 'supplier' ? 'of-hidden' : ''}">
                ${of_card('Purchase Invoices — Supplier Payables', 'credit-card', `
                    <table class="of-table">
                        <thead><tr><th style="min-width:160px;">Purchase Invoice</th><th style="min-width:160px;">Supplier</th>
                            <th>Sales Order</th><th>Dates</th><th>Total Amount</th><th>Paid</th>
                            <th>Outstanding (Payable)</th><th>Status</th><th>Action</th></tr></thead>
                        <tbody>${sup_rows || of_empty_row(9)}</tbody>
                    </table>`,
                    `<a class="of-btn of-btn--primary" href="/app/purchase-invoice/new" target="_blank">
                        <i class="fa fa-plus"></i> ${__('Create Purchase Invoice')}
                    </a>`, of_pagination_html('accounts', 'supplier', sups_env),
                    of_docstatus_pills('accounts', 'supplier', sups_env.docstatus_counts, this.docstatus_filter.accounts.supplier) + this.table_filters_html('accounts.supplier'))}
            </div>

            <div id="of-acc-sec-jobber" class="${subtab !== 'jobber' ? 'of-hidden' : ''}">
                ${of_card('Purchase Invoices — Jobber Payables (Job Work)', 'magic', `
                    <table class="of-table">
                        <thead><tr><th style="min-width:160px;">Purchase Invoice</th><th style="min-width:160px;">Jobber Supplier</th>
                            <th>Sales Order</th><th>Dates</th><th>Total Amount</th><th>Paid</th>
                            <th>Outstanding (Payable)</th><th>Status</th><th>Action</th></tr></thead>
                        <tbody>${job_rows || of_empty_row(9)}</tbody>
                    </table>`, null, of_pagination_html('accounts', 'jobber', jobs_env),
                    of_docstatus_pills('accounts', 'jobber', jobs_env.docstatus_counts, this.docstatus_filter.accounts.jobber) + this.table_filters_html('accounts.jobber'))}
            </div>
            <div id="of-acc-sec-notes" class="${subtab !== 'notes' ? 'of-hidden' : ''}">
                ${of_card('Returns / Notes — Credit Notes & Debit Notes', 'undo', `${of_notes_kind_bar((this.table_filters['accounts.notes'] || {}).kind || '', m)}${of_goods_waiting_html(notes_env.goods_waiting)}
                    <table class="of-table">
                        <thead><tr><th style="min-width:170px;">Note</th><th style="min-width:150px;">Customer / Supplier</th>
                            <th style="min-width:150px;">Against invoice</th><th style="min-width:200px;">Items returned</th><th>Date</th>
                            <th>Amount</th><th style="min-width:150px;">Effect</th><th style="min-width:230px;">What next</th></tr></thead>
                        <tbody>${note_rows || of_empty_row(8)}</tbody>
                    </table>`, null, of_pagination_html('accounts', 'notes', notes_env),
                    of_docstatus_pills('accounts', 'notes', notes_env.docstatus_counts, this.docstatus_filter.accounts.notes) + this.table_filters_html('accounts.notes'))}
            </div>`;
    }

    approval_html(data) {
        data = data || {};
        const orders = data.rows || [];
        // The merchandiser/unassigned/final buckets below are a client-side
        // partition of whatever page of the overall approval queue is
        // loaded — not three independently-paginated lists. Draft Sales
        // Orders awaiting approval are a small, actively-cleared queue by
        // nature (unlike the tracker/purchase/job-work backlogs), so this
        // is a deliberate simplification: paginate the queue as a whole
        // (see of_pagination_html below) rather than adding three more
        // independently-paginated backend lists for a tab that rarely
        // grows past one page in practice.

        const current_user = frappe.session.user;
        const my_approvals = [];
        const unassigned_approvals = [];
        const final_approvals = [];
        const other_merchandiser_approvals = [];
        const rejected_approvals = [];

        const can_final = !!(this.perms && this.perms.is_final_approver);
        // Mirrors get_pending_approvals()'s own is_scoped_to_own_customers
        // check server-side — NOT a bare "do I hold Merchandiser User" role
        // check, since that role can be combined with a broader operational
        // one (Operation Team, Sales Manager, ...) for someone who does
        // both jobs; that combination must NOT be scoped down, same as
        // every other tab already handles it.
        const is_scoped_merchandiser = !!(this.perms && this.perms.approval_scoped_to_own_customers);
        // Neither scoped to their own customers nor a final approver (who
        // already tracks every merchandiser via "Merchandiser Queue") — an
        // operational role that can see this tab (of_tab_approval_roles)
        // but has no merchandiser scoping of their own. The server returns
        // them every order unscoped; without a bucket of their own, every
        // order that already has a merchandiser assigned (i.e. isn't
        // waiting to be claimed) matched neither "Pending Approval" (not
        // theirs) nor "Unassigned" and simply disappeared from the tab.
        const is_other_viewer = !is_scoped_merchandiser && !can_final;
        const show_other_tab = !can_final;

        // An order sits in exactly one bucket, by the step it is actually waiting on.
        //   Rejected                  — needs correction and resubmission, checked first
        //                                so a rejected order never also shows as if it
        //                                were still a fresh/unassigned/other approval
        //   Pending Approval          — waiting on ME as the customer's merchandiser
        //   Unassigned                — no merchandiser on the customer yet
        //   Pending Final             — merchandiser is done; waiting on a final approver
        //   Other Merchandisers'      — has a merchandiser, but not me, and I can't final-approve either
        // An order already at "Pending Final Approval" is NOT waiting on the
        // merchandiser, so it must not appear under "Pending Approval".
        orders.forEach(o => {
            const is_my_assigned = !!(o.custom_merchandiser_user && current_user && o.custom_merchandiser_user.toLowerCase() === current_user.toLowerCase());
            const is_created_by_me = !!(o.owner && current_user && o.owner.toLowerCase() === current_user.toLowerCase());

            if (o.workflow_state === 'Rejected') {
                rejected_approvals.push(o);
            } else if (o.workflow_state === 'Pending Final Approval') {
                final_approvals.push(o);
            } else if (!o.custom_merchandiser_user) {
                unassigned_approvals.push(o);
            } else if (is_my_assigned) {
                my_approvals.push(o);
            } else if (is_created_by_me) {
                other_merchandiser_approvals.push(o);
            }
        });

        // Rejected Orders is split further by WHICH stage rejected it —
        // rejected_stage comes from the server (get_pending_approvals),
        // derived from the rejection comment reject_sales_orders writes.
        // "merchandiser" also covers the rare Draft-state Reject transition
        // — anything rejected before ever reaching final approval.
        const rejected_by_merchandiser = rejected_approvals.filter(o => o.rejected_stage !== 'final');
        const rejected_at_final = rejected_approvals.filter(o => o.rejected_stage === 'final');

        // Only the users named in Admin Settings (plus admins) may work the
        // final-approval queue. Permissions come from the server; until they
        // arrive the tab stays hidden rather than flashing into view.
        let sub = this.approval_subtab || 'merchandiser';
        if (sub === 'final' && !can_final) {
            sub = 'merchandiser';
            this.approval_subtab = 'merchandiser';
        }

        // Rejected only gets a tab of its own once there's a reason to click
        // it — a rejected order actually exists right now, or the viewer
        // already has it selected (so "back to Pending Approval" stays one
        // click away even if the last rejection was just fixed while the
        // tab was open). Same defensive pattern as the Draft/Submitted
        // filter pills elsewhere on this dashboard.
        const show_rejected_tab = rejected_approvals.length > 0 || sub === 'rejected';
        // Numbered to fill the gap left when final approval isn't shown —
        // a plain viewer sees 1/2/3/4(Rejected); a final approver sees an
        // unbroken 1/2/3/4/5(Rejected) instead of jumping straight to 5.
        // A viewer who can't final-approve gets "4. Waiting for Final Approval" (view only)
        // instead of "4. Pending Final SO Approval", so Rejected is 5 for everyone.
        const rejected_tab_number = 5;

        let active_orders = [];
        if (sub === 'merchandiser') {
            active_orders = my_approvals;
        } else if (sub === 'unassigned') {
            active_orders = unassigned_approvals;
        } else if (sub === 'other') {
            active_orders = other_merchandiser_approvals;
        } else if (sub === 'waiting') {
            // approved by the merchandiser, now with the final approver: followed here, view only
            active_orders = final_approvals;
        } else if (sub === 'rejected') {
            const stage_filter = this.approval_rejected_stage_filter;
            active_orders = stage_filter === 'merchandiser' ? rejected_by_merchandiser :
                             stage_filter === 'final' ? rejected_at_final :
                             rejected_approvals;
        } else {
            active_orders = can_final ? final_approvals : [];
        }

        this.$body.find('#of-count').text(
            data.total ? __('{0} pending order(s) on this page (of {1} total)', [active_orders.length, data.total]) : ''
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
            const is_owner = !!(current_user && o.owner && current_user.toLowerCase() === o.owner.toLowerCase());
            const is_assigned_merchandiser = !!(current_user && o.custom_merchandiser_user && current_user.toLowerCase() === o.custom_merchandiser_user.toLowerCase());
            const show_rejection_reason = is_admin || is_owner || is_assigned_merchandiser;

            return `
            <tr data-so="${o.name}" class="of-row-main">
                ${sub === 'final' ? `
                <td style="text-align: center;">
                    <input type="checkbox" class="of-approval-select" data-so="${o.name}">
                </td>
                ` : ''}
                <td>
                    <i class="fa fa-caret-right of-so-toggle" data-so="${o.name}" style="cursor:pointer; width:12px; font-size:14px; color:var(--text-light);"></i>
                    ${of_so_link(o.name, {bold: true})}
                    <div class="of-meta" style="font-weight:500;">
                        <a href="/app/customer/${encodeURIComponent(o.customer)}" target="_blank" style="color:inherit;">${of_customer_display(o.customer_name || o.customer, o.contact_person_name)}</a>
                    </div>
                    ${o.custom_merchandiser_user ? `
                    <div class="of-micro text-muted" style="margin-top: 3px; font-weight: 500;">
                        <i class="fa fa-user" style="color:#007bff;"></i> Merchandiser: <b>${of_esc(o.custom_merchandiser_name || o.custom_merchandiser_user)}</b>
                    </div>
                    ` : ''}
                    ${of_creator_html(o, o.custom_merchandiser_user)}
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
                    ${o.workflow_state === 'Rejected' ? `
                    <div class="of-micro" style="margin-top:4px;">
                        <span class="of-chip" style="background:${o.rejected_stage === 'final' ? 'var(--of-purple)' : 'var(--of-orange)'}; color:#fff;">
                            ${o.rejected_stage === 'final' ? __('Rejected at Final Approval') : __('Rejected by Merchandiser')}
                        </span>
                    </div>
                    ` : ''}
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
                    ${sub === 'waiting' ? `
                    <span class="text-muted" style="font-size:12px; font-weight:500;">
                        <i class="fa fa-clock-o"></i> ${__('Waiting for Final Approval')}
                    </span>
                    ` : sub === 'other' && !(is_owner && o.workflow_state !== 'Pending Final Approval') ? `
                    <span class="text-muted" style="font-size:12px; font-weight:500;">
                        <i class="fa fa-eye"></i> ${__('View only — not your queue')}
                    </span>
                    ` : o.workflow_state === 'Pending Final Approval' && sub === 'merchandiser' ? `
                    <span class="text-muted" style="font-size:12px; font-weight:500;">
                        <i class="fa fa-clock-o"></i> ${__('Waiting for Final Approval')}
                    </span>
                    ` : `
                    <div style="display: inline-flex; gap: 8px;">
                        <button class="of-btn of-btn--success of-approve-btn" data-so="${o.name}" data-state="${o.workflow_state}"
                                ${o.workflow_state === 'Rejected' ? `title="${of_esc(__('Resubmits this order for merchandiser approval'))}"` : ''}>
                            <i class="fa fa-check"></i> ${__('Approve')}
                        </button>
                        ${o.workflow_state === 'Rejected' ? '' : `
                        <button class="of-btn of-btn--danger of-reject-btn" data-so="${o.name}">
                            <i class="fa fa-times"></i> ${__('Reject')}
                        </button>
                        `}
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
                    <i class="fa fa-user" style="color:var(--of-blue);"></i> 1. Pending Approval (${my_approvals.length})
                </button>
                <button class="of-subtab ${sub === 'unassigned' ? 'is-active' : ''}" data-subtab="unassigned">
                    <i class="fa fa-users" style="color:var(--of-yellow);"></i> 2. Merchandiser Unassigned Orders (${unassigned_approvals.length})
                </button>
                <button class="of-subtab ${sub === 'other' ? 'is-active' : ''}" data-subtab="other">
                    <i class="fa fa-eye" style="color:var(--of-blue);"></i> 3. Other Merchandisers' Orders (${other_merchandiser_approvals.length})
                </button>
                ${can_final ? `
                <button class="of-subtab ${sub === 'final' ? 'is-active' : ''}" data-subtab="final">
                    <i class="fa fa-check-circle" style="color:var(--of-green);"></i> 4. Pending Final SO Approval (${final_approvals.length})
                </button>` : `
                <button class="of-subtab ${sub === 'waiting' ? 'is-active' : ''}" data-subtab="waiting"
                        title="${__('Orders already approved by the merchandiser, now waiting for the final approver (view only)')}">
                    <i class="fa fa-clock-o" style="color:var(--of-purple);"></i> 4. Waiting for Final Approval (${final_approvals.length})
                </button>`}
                ${show_rejected_tab ? `
                <button class="of-subtab ${sub === 'rejected' ? 'is-active' : ''}" data-subtab="rejected">
                    <i class="fa fa-ban" style="color:var(--of-red);"></i> ${rejected_tab_number}. Rejected Orders (${rejected_approvals.length})
                </button>` : ''}
            </div>

            <!-- Table Card -->
            <div class="of-card">
                <div class="of-card__head" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; flex-wrap: wrap; gap: 10px;">
                    <div style="display:inline-flex; align-items:center; gap:10px; flex-wrap:wrap;">
                        <span><i class="fa fa-check-square-o"></i> ${
                            sub === 'merchandiser' ? (can_final ? __('Merchandiser Queue (Track)') : __('Pending Approval')) :
                            sub === 'unassigned' ? __('Merchandiser Unassigned Orders (Approve & Claim)') :
                            sub === 'other' ? __("Other Merchandisers' Orders") :
                            sub === 'rejected' ? __('Rejected Orders — Needs Correction & Resubmission') :
                            sub === 'waiting' ? __('Waiting for Final Approval (view only)') :
                            __('Pending Final SO Approval')
                        }</span>
                        ${sub === 'rejected' ? of_rejection_stage_pills(
                            rejected_by_merchandiser.length, rejected_at_final.length, this.approval_rejected_stage_filter
                        ) : ''}
                        ${this.table_filters_html('approval')}
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
                <div class="of-scroll-hint"><i class="fa fa-arrows-h"></i> ${__('Scroll sideways to see every column')}</div>
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
                ${of_pagination_html('approval', null, data)}
            </div>`;
    }

    handle_merchandiser_approval(so) {
        this.handle_approval_with_checks(so, __('Are you sure you want to approve Sales Order {0}?', [so]));
    }

    handle_final_approval(so) {
        // First: which rows have a BOM (→ Subcontract PO) and which are normal items (workflow.js).
        dacs_confirm_bom_split([so]).then((ok) => {
            if (ok) this.handle_approval_with_checks(so, __('Are you sure you want to final approve Sales Order {0}?', [so]));
        });
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
        const contact_details = res.contact_details || {};
        const address_query = () => ({
            query: 'frappe.contacts.doctype.address.address.address_query',
            filters: { link_doctype: 'Customer', link_name: res.customer }
        });
        const customer_link_html = `<a href="${frappe.utils.get_form_link('Customer', res.customer)}" target="_blank">${of_esc(res.customer_display_name || res.customer)} (${of_esc(res.customer)})</a>`;
        const customer_label_html = contact_details.first_name
            ? `${customer_link_html} <span style="color:var(--text-muted);">(${of_esc(contact_details.first_name)})</span>`
            : customer_link_html;

        const fields = [
            {
                fieldtype: 'HTML',
                fieldname: 'notice',
                options: `
                    <div class="alert alert-warning" style="margin-bottom: 15px;">
                        <i class="fa fa-warning"></i> ${__('Customer {0} details. Fill or correct them below to save to master, or enter a comment to skip.', [`<b>${customer_label_html}</b>`])}
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
                default: res.gstin || '',
                onchange: () => of_sync_gst_category(dialog)
            },
            {
                fieldtype: 'Column Break'
            },
            {
                fieldtype: 'Select',
                fieldname: 'gst_category',
                label: __('GST Category'),
                options: of_gst_category_options(),
                default: res.gst_category || of_guess_gst_category(res.gstin) || '',
                // description: __("Guessed from the GSTIN above — override if it's wrong.")
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
                label: __('Billing & Shipping Address')
            },
            {
                fieldtype: 'Link',
                options: 'Address',
                fieldname: 'billing_address',
                label: __('Billing Address'),
                default: res.billing_address || '',
                description: __('Pick one of this customer\'s existing addresses, or use "Create a New Address" — applies to this Sales Order only.'),
                get_query: address_query,
                onchange: () => of_refresh_address_preview(dialog, 'billing_address', 'billing_address_display')
            },
            {
                fieldtype: 'Small Text',
                fieldname: 'billing_address_display',
                label: __('Address Preview'),
                read_only: 1,
                default: res.billing_address_display || ''
            },
            {
                fieldtype: 'Column Break'
            },
            {
                fieldtype: 'Link',
                options: 'Address',
                fieldname: 'shipping_address',
                label: __('Shipping Address'),
                default: res.shipping_address || '',
                description: __('Pick one of this customer\'s existing addresses, or use "Create a New Address" — applies to this Sales Order only.'),
                get_query: address_query,
                onchange: () => of_refresh_address_preview(dialog, 'shipping_address', 'shipping_address_display')
            },
            {
                fieldtype: 'Small Text',
                fieldname: 'shipping_address_display',
                label: __('Address Preview'),
                read_only: 1,
                default: res.shipping_address_display || ''
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
                label: __('Skip Verification')
            },
            {
                fieldtype: 'Small Text',
                fieldname: 'skip_comment',
                label: __('Or Approve with Comment (Will notify in dashboard)'),
                placeholder: __('Enter comment if you wish to skip validations...')
            }
        ];

        // No "Skip Delivery Note (Direct Billing)" control here. Approving a
        // Sales Order is a verification step, not the place to decide how the
        // order will eventually be shipped or billed. The field itself still
        // exists on the Sales Order and everything downstream still honours it
        // (the Direct Bill chip on this tab, the Sales Invoice's own
        // delivery-note check in custom_script.py) — this dialog simply no
        // longer sets it, and deliberately does not SEND it either, so an
        // order that already has the flag keeps it through approval instead of
        // being silently reset by an absent checkbox.

        const dialog = new frappe.ui.Dialog({
            title: __('Verify Customer Details - {0}', [so]),
            size: 'large',
            fields: fields,
            primary_action_label: __('Update Customer & Approve SO'),
            primary_action: (values) => {
                const btn_primary = dialog.get_primary_btn();
                const btn_secondary = dialog.get_secondary_btn();
                if (btn_primary) btn_primary.attr("disabled", true).addClass("disabled");
                if (btn_secondary) btn_secondary.attr("disabled", true).addClass("disabled");

                const enable_buttons = () => {
                    if (btn_primary) btn_primary.attr("disabled", false).removeClass("disabled");
                    if (btn_secondary) btn_secondary.attr("disabled", false).removeClass("disabled");
                };

                if (values.skip_comment && values.skip_comment.trim()) {
                    frappe.call({
                        method: 'erp_dacsinc_custom.order_flow_api.approve_sales_order_with_comment',
                        args: {
                            sales_order: so,
                            comment: values.skip_comment
                        },
                        error: enable_buttons
                    }).then(() => {
                        dialog.hide();
                        frappe.show_alert({message: __('Sales Order approved with comment successfully'), color: 'green'});
                        this.refresh(true);
                    });
                    return;
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
                        gst_category: values.gst_category || null,
                        tax_category: values.tax_category || null,
                        billing_address: values.billing_address || null,
                        shipping_address: values.shipping_address || null,
                        contact_data: contact_data
                    },
                    error: enable_buttons
                }).then(() => {
                    dialog.hide();
                    frappe.show_alert({message: __('Customer details updated and Sales Order approved'), color: 'green'});
                    this.refresh(true);
                });
            },
            secondary_action_label: __('Skip & Approve'),
            secondary_action: () => {
                const values = dialog.get_values();
                if (!values || !values.skip_comment || !values.skip_comment.trim()) {
                    frappe.msgprint(__('Please enter a comment in the field below first.'));
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
                        comment: values.skip_comment
                    },
                    error: enable_buttons
                }).then(() => {
                    dialog.hide();
                    frappe.show_alert({message: __('Sales Order approved with comment successfully'), color: 'green'});
                    this.refresh(true);
                });
            }
        });

        of_enable_new_address_customer_prefill(dialog, res.customer);
        dialog.show();
    }

    uniform_html(data) {
        data = data || {};
        const transfers = data.rows || [];
        this.$body.find('#of-count').text(
            data.total ? __('{0} transfer(s) match', [data.total]) : ''
        );

        const rows_html = transfers.map(t => {
            const total = of_round2(t.qty);
            const received = of_round2(t.received_qty);
            const outstanding = of_round2(Math.max(0, total - received));
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
            const action_html = (can_receive ? `
                <button class="of-btn of-btn--success of-receive-btn" data-id="${t.name}" data-outstanding="${outstanding}">
                    <i class="fa fa-arrow-down"></i> ${received > 0 ? 'Receive Rest' : 'Receive'}
                </button>
            ` : (t.status === 'Cancelled'
                    ? `<span class="text-muted" style="font-size: 11px;"><i class="fa fa-ban"></i> Cancelled</span>`
                    : `<span class="text-muted" style="font-size: 11px;"><i class="fa fa-check"></i> Completed</span>`))
                + ` <button class="of-btn of-uet-print-btn" data-name="${of_esc(t.name)}" title="${__('Print transfer')}"><i class="fa fa-print"></i></button>`;

            const lines = t.items || [];
            const items_html = lines.slice(0, 3).map(l => `<div class="of-uet-line">
                    <span>${of_esc(l.source_item)}</span>
                    ${l.same_item || l.source_item === l.target_item ? `<span class="of-chip">${__('same')}</span>` : `<i class="fa fa-long-arrow-right"></i> <span>${of_esc(l.target_item)}</span>`}
                    <b>× ${of_round2(l.qty)}</b>${flt_of(l.received_qty) > 0 ? ` <span style="color:var(--of-green);">(${of_round2(l.received_qty)} ${__('back')})</span>` : ''}
                </div>`).join('') + (lines.length > 3 ? `<div class="of-micro text-muted">+ ${lines.length - 3} ${__('more — expand the row')}</div>` : '');
            return `
                <tr class="of-transfer-row">
                    <td><i class="fa fa-caret-right of-transfer-receipts-toggle" data-id="${of_esc(t.name)}" style="cursor:pointer;margin-right:4px;color:var(--text-light);"></i><a href="/app/uniform-embroidery-transfer/${encodeURIComponent(t.name)}" target="_blank"><b>${of_esc(t.name)}</b></a>
                        <div class="of-micro text-muted">${lines.length} ${lines.length === 1 ? __('item') : __('items')}</div>
                        ${of_creator_html(t)}</td>
                    <td style="text-align:left;">${items_html || '—'}</td>
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
                    <div style="font-size:14px; font-weight:600; display:inline-flex; align-items:center; gap:10px; flex-wrap:wrap;"><span><i class="fa fa-random"></i> Embroidery Stock Transfers</span>${this.table_filters_html('uniform')}</div>
                    <button class="of-btn of-btn--primary" id="of-create-transfer-btn">
                        <i class="fa fa-plus"></i> Create Transfer
                    </button>
                </div>
                <div class="of-scroll-hint"><i class="fa fa-arrows-h"></i> ${__('Scroll sideways to see every column')}</div>
                <div class="of-scroll">
                    <table class="of-table">
                        <thead>
                            <tr>
                                <th>Transfer ID</th>
                                <th>${__('Items (Plain → Embroidered × Qty)')}</th>
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
                            ${rows_html || `<tr><td colspan="9" class="of-empty"><i class="fa fa-inbox"></i>No transfers found.</td></tr>`}
                        </tbody>
                    </table>
                </div>
                ${of_pagination_html('uniform', null, data)}
            </div>
        `;
    }

    // ── Tab: logistics ──────────────────────────────────────────
    // Submitted Sales Invoices still missing an LR Number or a Signed Copy —
    // see get_logistics_flow/logistics_tab.py. A row drops off this list the
    // moment EITHER of those two fields is filled in; Proof of Delivery is a
    // separate, independent checkbox that does not clear the row on its own.
    logistics_html(data) {
        data = data || {};
        const rows = data.rows || [];
        this.$body.find('#of-count').text(
            data.total
                ? (this.scope === 'all'
                    ? __('{0} invoice(s) match', [data.total])
                    : __('{0} invoice(s) missing delivery paperwork', [data.total]))
                : ''
        );

        const rows_html = rows.map(r => {
            // Only meaningful once "All" scope is pulling in invoices that
            // already have their paperwork — the default "Open" scope only
            // ever returns pending ones, so every row would say the same
            // thing. See get_logistics_flow's scope handling.
            const is_updated = !!(r.lr_no || r.custom_signed_copy);
            const status_pill = is_updated
                ? `<span class="of-pill of-pill--ready">${__('Updated')}</span>`
                : `<span class="of-pill of-pill--wait">${__('Pending')}</span>`;
            const dash = '<span class="of-val--zero">—</span>';
            return `<tr data-name="${of_esc(r.name)}">
                <td><a href="/app/sales-invoice/${encodeURIComponent(r.name)}" target="_blank"><b>${of_esc(r.name)}</b></a>
                    ${of_creator_html(r)}</td>
                <td style="text-align:left;">
                    <a href="/app/customer/${encodeURIComponent(r.customer)}" target="_blank" style="font-weight:600;">${of_esc(r.customer_name || r.customer)}</a>
                </td>
                <td>${of_so_links(r.sales_orders)}</td>
                <td class="of-meta">${of_date(r.posting_date)}</td>
                <td style="font-weight:700;">${of_money(r.grand_total, r.currency)}</td>
                <td>${status_pill}</td>
                <td>${r.transporter ? `<a href="/app/supplier/${encodeURIComponent(r.transporter)}" target="_blank">${of_esc(r.transporter_name || r.transporter)}</a>` : dash}</td>
                <td>${r.lr_no ? `<b>${of_esc(r.lr_no)}</b>` : dash}</td>
                <td style="text-align:center;">${r.custom_signed_copy
                    ? `<a href="${of_esc(r.custom_signed_copy)}" target="_blank" class="of-btn of-btn--success" title="${__('View signed copy')}"><i class="fa fa-file-o"></i> ${__('View')}</a>`
                    : dash}</td>
                <td style="text-align:center;">
                    <button class="of-btn of-btn--primary of-logi-update-btn" data-name="${of_esc(r.name)}"
                            data-transporter="${of_esc(r.transporter || '')}" data-lr="${of_esc(r.lr_no || '')}"
                            data-signed="${of_esc(r.custom_signed_copy || '')}">
                        <i class="fa fa-pencil"></i> ${__('Update')}
                    </button>
                </td>
            </tr>`;
        }).join('');

        return `
            <!-- Live Activity Notifications -->
            ${this.activity_stream_html('logistics')}

            ${of_card(this.scope === 'all' ? 'Sales Invoices — Delivery Paperwork' : 'Sales Invoices Missing Delivery Paperwork', 'flag-checkered', `
                <table class="of-table">
                    <thead>
                        <tr>
                            <th>Sales Invoice</th>
                            <th>Customer</th>
                            <th>Sales Order(s)</th>
                            <th>Posting Date</th>
                            <th>Grand Total</th>
                            <th>Status</th>
                            <th>Transporter</th>
                            <th>LR No</th>
                            <th>Signed Copy</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>${rows_html || of_empty_row(10)}</tbody>
                </table>`, null, of_pagination_html('logistics', null, data),
                this.table_filters_html('logistics'))}
        `;
    }

    // Create Embroidery Transfer: several lines at once — a plain item and the embroidered item
    // it comes back as (or the same item), with a qty. Only free stock can go (stock held for
    // Sales Orders is not free); one Stock Entry moves all lines (uniform_transfer_api).
    prompt_create_transfer() {
        const free_cache = {};   // "item|warehouse" -> stock details
        const item_query = () => ({ filters: { is_stock_item: 1, disabled: 0 } });
        const dialog = new frappe.ui.Dialog({
            title: __('Create Embroidery Transfer'),
            size: 'extra-large',
            fields: [
                // The two warehouses are fixed for this flow: shown as one read-only line, not as
                // editable boxes (the values still go to the server).
                { fieldtype: 'HTML', fieldname: 'intro_html',
                  options: `<div style="margin-bottom:8px; font-size:12px; color:var(--text-muted);">
                    ${__('Add one line per item: the plain item and the embroidered item it comes back as — tick "Same item" when it comes back as the same item. Only free stock (not held for Sales Orders) can go.')}</div>
                    <div class="of-uet-route"><i class="fa fa-truck"></i> ${__('From')} <b>VV Puram - IND</b>
                        <i class="fa fa-long-arrow-right"></i> ${__('to the embroidery jobber')} <b>Jobers Warehouse - IND</b></div>` },
                { fieldtype: 'Data', fieldname: 'from_warehouse', label: __('From Warehouse'), hidden: 1, default: 'VV Puram - IND' },
                { fieldtype: 'Data', fieldname: 'wip_warehouse', label: __('WIP Warehouse (Embroiderer)'), hidden: 1, default: 'Jobers Warehouse - IND' },
                { fieldtype: 'Section Break', label: __('Items to send') },
                { fieldtype: 'Table', fieldname: 'lines', label: __('Lines'), cannot_add_rows: 0, in_place_edit: true,
                  data: [{}],
                  fields: [
                      { fieldtype: 'Link', fieldname: 'source_item', options: 'Item', label: __('Plain item (send)'), in_list_view: 1, columns: 3,
                        get_query: item_query, onchange: () => setTimeout(() => refresh_free(false), 50) },
                      { fieldtype: 'Check', fieldname: 'same_item', label: __('Same item'), in_list_view: 1, columns: 1,
                        onchange: () => setTimeout(() => refresh_free(false), 50) },
                      { fieldtype: 'Link', fieldname: 'target_item', options: 'Item', label: __('Embroidered item (comes back)'), in_list_view: 1, columns: 3,
                        get_query: item_query },
                      { fieldtype: 'Float', fieldname: 'qty', label: __('Qty'), in_list_view: 1, columns: 1,
                        onchange: () => setTimeout(() => refresh_free(false), 50) },
                      { fieldtype: 'Data', fieldname: 'free_info', label: __('Free to send'), in_list_view: 1, columns: 2, read_only: 1 },
                  ] },
                { fieldtype: 'HTML', fieldname: 'free_html' },
            ],
            primary_action_label: __('Send to Embroidery'),
            primary_action: (values) => {
                const lines = (dialog.get_value('lines') || []).filter(l => l.source_item || flt(l.qty));
                if (!lines.length) return frappe.msgprint(__('Add at least one line.'));
                for (const [n, l] of lines.entries()) {
                    if (!l.source_item) return frappe.msgprint(__('Line {0}: choose the plain item.', [n + 1]));
                    if (!l.same_item && !l.target_item) return frappe.msgprint(__('Line {0}: choose the embroidered item, or tick Same item.', [n + 1]));
                    if (!l.same_item && l.target_item === l.source_item) return frappe.msgprint(__('Line {0}: the embroidered item is the same as the plain item — tick Same item instead.', [n + 1]));
                    if (flt(l.qty) <= 0) return frappe.msgprint(__('Line {0}: enter the quantity.', [n + 1]));
                }
                const over = over_free(lines);
                if (over.length) return frappe.msgprint({ title: __('Not enough free stock'), indicator: 'red', message: over.join('<br>') });
                dialog.get_primary_btn().attr('disabled', true);
                frappe.call({
                    method: 'erp_dacsinc_custom.uniform_transfer_api.create_embroidery_transfers',
                    args: {
                        lines: lines.map(l => ({ source_item: l.source_item, target_item: l.same_item ? l.source_item : l.target_item,
                                                 same_item: l.same_item ? 1 : 0, qty: flt(l.qty) })),
                        from_warehouse: values.from_warehouse, wip_warehouse: values.wip_warehouse,
                    },
                    freeze: true, freeze_message: __('Sending to embroidery…'),
                }).then(r => {
                    const m = r.message || {};
                    dialog.hide();
                    frappe.show_alert({ message: __('Transfer {0} sent to embroidery with {1} line(s) ({2})', [m.transfer, lines.length, m.stock_entry || '']), indicator: 'green' });
                    this.refresh(true);
                    if (m.transfer && window.dacs_print_prompt) dacs_print_prompt('Uniform Embroidery Transfer', m.transfer, __('Embroidery transfer'));
                }).always(() => dialog.get_primary_btn().attr('disabled', false));
            },
        });

        // Free stock per plain item (cached per warehouse), shown on each line and summed up below.
        const refresh_free = (reset) => {
            if (reset) Object.keys(free_cache).forEach(k => delete free_cache[k]);
            const wh = dialog.get_value('from_warehouse');
            const lines = dialog.fields_dict.lines.grid.get_data() || [];
            const need = [...new Set(lines.map(l => l.source_item).filter(Boolean))].filter(i => !free_cache[`${i}|${wh}`]);
            Promise.all(need.map(item => frappe.call({
                method: 'erp_dacsinc_custom.uniform_transfer_api.get_item_stock_details', args: { item_code: item, warehouse: wh },
            }).then(r => { free_cache[`${item}|${wh}`] = r.message || {}; }))).then(() => paint_free());
        };

        const over_free = (lines) => {
            const wh = dialog.get_value('from_warehouse'), want = {};
            lines.forEach(l => { if (l.source_item) want[l.source_item] = (want[l.source_item] || 0) + flt(l.qty); });
            return Object.entries(want).filter(([item, q]) => free_cache[`${item}|${wh}`] && q - flt(free_cache[`${item}|${wh}`].net_available) > 0.0005)
                .map(([item, q]) => __('{0}: {1} asked, only {2} free', [frappe.utils.escape_html(item), q, flt(free_cache[`${item}|${wh}`].net_available)]));
        };

        const paint_free = () => {
            const wh = dialog.get_value('from_warehouse');
            const grid = dialog.fields_dict.lines.grid;
            const lines = grid.get_data() || [];
            const used = {};
            lines.forEach(l => {
                const d = free_cache[`${l.source_item}|${wh}`];
                if (l.same_item && l.source_item && l.target_item !== l.source_item) l.target_item = l.source_item;
                l.free_info = d ? `${flt(d.net_available)} ${d.stock_uom || ''}` : '';
                if (l.source_item) used[l.source_item] = (used[l.source_item] || 0) + flt(l.qty);
            });
            grid.refresh();
            const rows = Object.entries(used).map(([item, q]) => {
                const d = free_cache[`${item}|${wh}`] || {};
                const free = flt(d.net_available), bad = q - free > 0.0005;
                const holds = (d.holds || []).map(h => `${flt(h.qty)} ${__('held for')} ${frappe.utils.escape_html(h.sales_order || h.doc)}`).join(', ');
                return `<tr${bad ? ' class="is-over"' : ''}>
                    <td>${frappe.utils.escape_html(item)}</td><td style="text-align:right;">${flt(d.actual_qty)}</td>
                    <td style="text-align:right;">${flt(d.held_qty)}</td><td style="text-align:right;">${free}</td>
                    <td style="text-align:right;">${q}</td><td class="text-muted" style="font-size:11px;">${holds}</td></tr>`;
            }).join('');
            dialog.fields_dict.free_html.$wrapper.html(rows ? `
                <table class="of-confirm-table" style="margin-top:6px;border:1px solid var(--border-color);border-radius:6px;">
                    <thead><tr><th>${__('Plain item')}</th><th style="text-align:right;">${__('On hand')}</th><th style="text-align:right;">${__('Held for Sales Orders')}</th>
                        <th style="text-align:right;">${__('Free')}</th><th style="text-align:right;">${__('Sending')}</th><th>${__('Held by')}</th></tr></thead>
                    <tbody>${rows}</tbody></table>` : '');
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

// Print an Embroidery Work Order. Same doctype/format/letterhead arguments as
// the Purchase Order form's own linked-documents table uses, so the document
// prints identically wherever it is printed from — if the print format is ever
// renamed, both call sites have to change together.
// Same is_subcontracted split the Purchase Order form itself uses for its
// own toolbar button (public/js/purchase_order.js's refresh handler): a
// plain PO prints itself; a subcontracted one has no Purchase Order print
// of its own — its Subcontracting Order is what carries the real
// quantities/rates, so THAT is what prints (of_print_sco below), once one
// exists. Both tabs that list Purchase Orders in this dashboard only ever
// show one kind (Purchase Flow: is_subcontracted = 0; Job Work: = 1), so
// each row only ever needs the matching one of these two, never both.
function of_print_po(po_name) {
    if (!po_name) return;
    window.open(
        `/api/method/frappe.utils.print_format.download_pdf`
        + `?doctype=${encodeURIComponent('Purchase Order')}`
        + `&name=${encodeURIComponent(po_name)}`
        + `&format=${encodeURIComponent('Purchase Order Print Format')}`
        + `&no_letterhead=1`
        + `&letterhead=${encodeURIComponent('No Letterhead')}`
        + `&settings=%7B%7D`
        + `&_lang=en`
    );
}

function of_print_sco(sco_name) {
    if (!sco_name) return;
    window.open(
        `/api/method/frappe.utils.print_format.download_pdf`
        + `?doctype=${encodeURIComponent('Subcontracting Order')}`
        + `&name=${encodeURIComponent(sco_name)}`
        + `&format=${encodeURIComponent('Subcontracting Order Print Format 3')}`
        + `&no_letterhead=1`
        + `&letterhead=${encodeURIComponent('DAC Letter Header')}`
        + `&settings=%7B%7D`
        + `&_lang=en`
    );
}

function of_print_ewo(docname) {
    if (!docname) return;
    const url = `/api/method/frappe.utils.print_format.download_pdf?`
        + `doctype=${encodeURIComponent('Embroidery Work Order')}`
        + `&name=${encodeURIComponent(docname)}`
        + `&format=${encodeURIComponent('Embroidery Work Order Print Format')}`
        + `&no_letterhead=1`
        + `&letterhead=${encodeURIComponent('No Letterhead')}`
        + `&_lang=${frappe.boot.lang}`;
    window.open(url, '_blank');
}

function of_esc(v) {
    if (v === undefined || v === null) return '';
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// A role can be configured to SEE a Sales Order on this dashboard (the tab
// queries read via raw SQL, bypassing doctype permissions — see
// docs/order-flow-dashboard.md) without actually holding Sales Order READ
// permission (e.g. DAC CRM: Create only, by deliberate business design —
// they raise the order and hand it off, they were never meant to keep
// browsing it). Linking straight to /app/sales-order/<name> for such a user
// works right up until they click it, then Frappe's real permission check
// throws "You do not have access to this document" — confusing, since nothing
// about the dashboard suggested the link was dead. frappe.model.can_read is
// a cheap, already-in-bootinfo doctype-level check (no round-trip), so every
// Sales Order reference on this page goes through this one place rather than
// rendering a real <a> unconditionally.
function of_so_link(name, opts) {
    opts = opts || {};
    const label = of_esc(name);
    if (!name) return '';
    if (!frappe.model.can_read('Sales Order')) {
        const style = opts.bold ? ' style="font-weight:700;"' : '';
        return `<span class="text-muted" title="${__('You do not have access to open Sales Orders')}"${style}>${label}</span>`;
    }
    const style = opts.bold ? ' style="font-weight:700;"' : '';
    return `<a href="/app/sales-order/${encodeURIComponent(name)}" target="_blank"${style}>${label}</a>`;
}

// Every dashboard table shows a customer name; this appends that customer's
// primary contact person in small text so whoever's looking doesn't have to
// open the Customer record just to know who to call. Silently renders just
// the customer name when no contact is on file yet, rather than an empty
// "()".
function of_customer_display(customer_name, contact_person_name) {
    const name_html = of_esc(customer_name || '');
    if (!contact_person_name) return name_html;
    return `${name_html} <span class="of-micro" style="color:var(--text-muted);">(${of_esc(contact_person_name)})</span>`;
}

// Keeps the address preview in sync whenever the Billing/Shipping Address
// Link field changes — including right after "Create a New Address" resolves,
// since that also fires the Link control's onchange with the new address name.
// Uses set_value (not raw HTML) so the preview renders inside the same
// read-only "boxed" control Sales Order itself uses for address_display.
function of_refresh_address_preview(dialog, link_fieldname, preview_fieldname) {
    const address_name = dialog.get_value(link_fieldname);
    if (!address_name) {
        dialog.set_value(preview_fieldname, '');
        return;
    }
    frappe.xcall('frappe.contacts.doctype.address.address.get_address_display', { address_dict: address_name })
        .then(address_display => {
            dialog.set_value(preview_fieldname, address_display || '');
        });
}

// GST Category's real options — read off the Customer doctype's own field
// (india_compliance installs it as a custom field, so this is only known
// once that doctype's meta has loaded) rather than a second hardcoded copy
// of the same list that could quietly drift out of sync with it.
function of_gst_category_options() {
    const docfield = frappe.meta.get_docfield('Customer', 'gst_category');
    return (docfield && docfield.options)
        || 'Registered Regular\nRegistered Composition\nUnregistered\nSEZ\nOverseas\nDeemed Export\nUIN Holders\nTax Deductor\nTax Collector\nInput Service Distributor';
}

// india_compliance.guess_gst_category reads the GSTIN's own structure
// (a TDS/TCS/UIN/regular-taxpayer prefix pattern) — no API call, so this is
// safe to run on every keystroke. Returns undefined for a GSTIN that
// doesn't match any known pattern (e.g. still mid-typing) — callers must
// not blindly overwrite an existing value with that.
function of_guess_gst_category(gstin) {
    if (typeof india_compliance === 'undefined' || !india_compliance.guess_gst_category) return '';
    return india_compliance.guess_gst_category((gstin || '').trim(), undefined) || '';
}

function of_sync_gst_category(dialog) {
    const guessed = of_guess_gst_category(dialog.get_value('gstin'));
    if (guessed) dialog.set_value('gst_category', guessed);
}

// "Create a New Address" from the Billing/Shipping Address Link field opens
// india_compliance's generic Address quick-entry, which only self-fills its
// own Link Document Type / Link Name fields by guessing off `cur_frm` — and
// there is no cur_frm here, this dialog lives on the Order Flow page, not a
// document form. So for as long as this dialog is open, intercept the next
// Address quick-entry(ies) and prefill+lock them to this SO's customer
// ourselves; restore the real make_quick_entry the moment the dialog closes
// so nothing about unrelated Address creation elsewhere is ever touched.
function of_enable_new_address_customer_prefill(dialog, customer_name) {
    const original_make_quick_entry = frappe.ui.form.make_quick_entry;
    frappe.ui.form.make_quick_entry = function (doctype, after_insert, init_callback, doc, force) {
        if (doctype !== 'Address') {
            return original_make_quick_entry(doctype, after_insert, init_callback, doc, force);
        }
        const wrapped_init_callback = (qe_dialog) => {
            if (init_callback) init_callback(qe_dialog);
            qe_dialog.set_value('link_doctype', 'Customer').then(() => {
                return qe_dialog.set_value('link_name', customer_name);
            }).then(() => {
                qe_dialog.set_df_property('link_doctype', 'read_only', 1);
                qe_dialog.set_df_property('link_name', 'read_only', 1);
            });
        };
        return original_make_quick_entry(doctype, after_insert, wrapped_init_callback, doc, force);
    };
    const existing_onhide = dialog.onhide;
    dialog.onhide = () => {
        frappe.ui.form.make_quick_entry = original_make_quick_entry;
        existing_onhide && existing_onhide();
    };
}

function of_num(v) { return flt_of(v) || 0; }

// A quantity built from a SQL SUM/subtraction chain routinely carries float
// residue (e.g. 79.999999998, 0.001999998000002279) that has no business
// being shown to a user — every on-screen quantity is capped at 2 decimals,
// not padded with trailing zeros (Math.round keeps "20" as 20, not
// "20.00"). This only touches DISPLAY; nothing computed from flt_of/of_num
// gets rounded early, so it can never compound into a calculation error.
function of_round2(v) {
    return Math.round((flt_of(v) + Number.EPSILON) * 100) / 100;
}

/**
 * One reusable pagination bar for every tab's (sub-)list — Prev/Next, a
 * collapsing page-number strip, a page-size selector, and a "Showing X–Y
 * of Z" label. `state` is the {rows, total, page, page_size} envelope every
 * paginated backend method now returns. `tab` and `sublist` are stamped
 * onto every control as data-attributes so the single delegated click/change
 * handlers in bind() (.of-page-btn / .of-page-size-select) know which
 * pagination state to update — `sublist` is omitted (empty string) for a
 * tab with only one list.
 *
 * Returns '' when there is nothing to page through, so a tab with no rows
 * doesn't show an empty, confusing "Showing 0–0 of 0" bar.
 */
// All / Draft / Submitted filter pills for a sub-list that mixes Draft
// (docstatus 0) and Submitted (docstatus 1) documents together — Purchase
// Flow's PO/Receipt, Job Work's PO/Receipt/EWO, Sales Tracker's MR sub-tab.
// `counts` is the {draft, submitted} the server computed from the SAME
// filters the list itself uses (see _docstatus_pill_counts in
// order_flow_api.py), so these numbers can never disagree with what
// clicking a pill actually returns. `current` is this.docstatus_filter's
// current value for this sub-list ('', 'draft' or 'submitted').
//
// The Draft pill only renders when there's a reason to click it — either a
// draft actually exists right now, or the viewer is already filtered to
// Draft (so "All" stays one click away even if the last draft was just
// submitted while this tab was open).
// A mirrored toolbar select's options for a table filter: the caption names the filter, so
// its first "All Merchandisers" / "All Warehouses" option just reads "All".
function of_mirror_options($select) {
    const cur = $select.val() || '';
    return $select.find('option').map((i, o) => {
        const v = o.value || '';
        const label = i === 0 && !v ? __('All') : o.textContent;
        return `<option value="${of_esc(v)}"${v === cur ? ' selected' : ''}>${of_esc(label)}</option>`;
    }).get().join('');
}

function of_docstatus_pills(tab, sublist, counts, current) {
    counts = counts || {};
    const draft = flt_of(counts.draft);
    const submitted = flt_of(counts.submitted);
    current = current || '';
    // Compact — this sits inline in the card header next to the title, not
    // as its own row, so it shares the header's font size rather than
    // looking like a full-size button.
    const pill = (value, label, count) => `
        <button type="button" class="of-btn ${current === value ? 'of-btn--primary' : ''} of-ds-pill"
                style="padding:2px 8px; font-size:11px; font-weight:500;"
                data-tab="${tab}" data-sublist="${sublist}" data-docstatus="${value}">
            ${of_esc(label)} (${count})
        </button>`;
    const show_draft = draft > 0 || current === 'draft';
    return `<span style="display:inline-flex; gap:4px;">
        ${pill('', __('All'), draft + submitted)}
        ${show_draft ? pill('draft', __('Draft'), draft) : ''}
        ${pill('submitted', __('Submitted'), submitted)}
    </span>`;
}

// All / By Merchandiser / At Final Approval pills for the SO Approvals
// Rejected Orders sub-tab — same compact inline-in-header style as
// of_docstatus_pills, but keyed on rejected_stage rather than docstatus, so
// it's kept separate rather than shoehorned into that one.
// A sub-tab the tab sheet allows. Approvals › "Waiting for Final Approval" (the view-only
// follow-up for a viewer who can't final-approve) goes with "Pending Approval".
function of_subtab_ok(tab, sub, ok) {
    if (ok.includes(sub)) return true;
    return tab === 'approval' && sub === 'waiting' && ok.includes('merchandiser');
}

function of_rejection_stage_pills(merchandiser_count, final_count, current) {
    current = current || '';
    const pill = (value, label, count) => `
        <button type="button" class="of-btn ${current === value ? 'of-btn--primary' : ''} of-rej-stage-pill"
                style="padding:2px 8px; font-size:11px; font-weight:500;"
                data-stage="${value}">
            ${of_esc(label)} (${count})
        </button>`;
    return `<span style="display:inline-flex; gap:4px;">
        ${pill('', __('All'), merchandiser_count + final_count)}
        ${pill('merchandiser', __('By Merchandiser'), merchandiser_count)}
        ${pill('final', __('At Final Approval'), final_count)}
    </span>`;
}

function of_pagination_html(tab, sublist, state) {
    state = state || {};
    const total = of_num(state.total);
    if (!total) return '';

    const page = Math.max(1, parseInt(state.page, 10) || 1);
    const page_size = parseInt(state.page_size, 10) || 100;
    const total_pages = Math.max(1, Math.ceil(total / page_size));
    const start = (page - 1) * page_size + 1;
    const end = Math.min(total, page * page_size);
    const attrs = `data-tab="${tab}" data-sublist="${sublist || ''}"`;

    let page_nums = [];
    if (total_pages <= 7) {
        for (let i = 1; i <= total_pages; i++) page_nums.push(i);
    } else {
        page_nums.push(1);
        if (page > 4) page_nums.push('…');
        for (let i = Math.max(2, page - 2); i <= Math.min(total_pages - 1, page + 2); i++) page_nums.push(i);
        if (page < total_pages - 3) page_nums.push('…');
        page_nums.push(total_pages);
    }
    const num_btns = page_nums.map(n => n === '…'
        ? `<span class="of-page-ellipsis">…</span>`
        : `<button type="button" class="of-page-btn ${n === page ? 'is-active' : ''}" ${attrs} data-page="${n}">${n}</button>`
    ).join('');

    return `
        <div class="of-pagination">
            <div class="of-pagination__info">${__('Showing {0}–{1} of {2}', [start, end, total])}</div>
            <div class="of-pagination__pages">
                <button type="button" class="of-page-btn of-page-btn--nav" ${attrs} data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} title="${__('Previous page')}"><i class="fa fa-angle-left"></i></button>
                ${num_btns}
                <button type="button" class="of-page-btn of-page-btn--nav" ${attrs} data-page="${page + 1}" ${page >= total_pages ? 'disabled' : ''} title="${__('Next page')}"><i class="fa fa-angle-right"></i></button>
            </div>
            <select class="of-select of-page-size-select" ${attrs} title="${__('Rows per page')}">
                ${[50, 100, 200].map(n => `<option value="${n}" ${n === page_size ? 'selected' : ''}>${n} / ${__('page')}</option>`).join('')}
            </select>
        </div>`;
}

// A Pick List holding qty out at a Full Piece embroidery jobber (see
// so_embroidery.py / Pick List's custom_embroidery_hold_qty) — shown
// wherever a Pick List's status or its Submit action would otherwise
// render, so "why can't I submit this" is answered right where the
// Submit button used to be, not left to the before_submit hook's error.
function of_embroidery_hold_html(r) {
    return `<div style="display:inline-block;background:#6b21a8;color:#fff;border-radius:6px;padding:6px 10px;font-weight:700;font-size:12px;line-height:1.35;"
                 title="${of_esc(__('Cannot submit until this comes back from the jobber.'))}">
        <i class="fa fa-magic"></i> ${__('AT JOBBER')} — ${of_round2(r.embroidery_hold_qty)} ${__('sent for embroidery')}
        <div style="font-weight:500;font-size:11px;">${__('Cannot submit until received back')}</div>
    </div>`;
}

// "Revert to Draft" for a submitted Pick List (no Delivery Note yet), or the
// reason it can't be.
function of_pl_revert_html(r) {
    if (of_num(r.docstatus) !== 1) return '';
    if (r.revertable) {
        return `<div style="margin-top:4px;"><button class="of-btn of-btn--warning of-pl-revert" data-pl="${of_esc(r.name)}"
                    title="${of_esc(__('Submitted by mistake? Bring it back to draft (e.g. to send it for embroidery). Not possible once a Delivery Note is made.'))}">
                    <i class="fa fa-undo"></i> ${__('Revert to Draft')}</button></div>`;
    }
    if ((r.delivery_notes || []).length) {
        return `<div class="of-micro" style="margin-top:4px;color:var(--text-muted);" title="${of_esc(__('A Delivery Note is made from this Pick List — it can no longer go back to draft.'))}">
            <i class="fa fa-lock"></i> ${__('On {0} — can\'t revert', [of_esc(r.delivery_notes.join(', '))])}</div>`;
    }
    return '';
}

function of_revert_pick_list(pl, on_done) {
    frappe.confirm(__('Bring Pick List {0} back to draft? It is cancelled and amended as a new draft with the same qty.', [pl]), () => {
        frappe.call({
            method: 'erp_dacsinc_custom.so_embroidery.revert_pick_list_to_draft',
            args: { pick_list: pl }, freeze: true, freeze_message: __('Reverting Pick List…')
        }).then(r => {
            if (!r.message) return;
            frappe.show_alert({ message: __('{0} is back in draft as {1}', [pl, r.message]), indicator: 'green' }, 6);
            if (on_done) on_done(r.message);
        });
    });
}
window.of_revert_pick_list = of_revert_pick_list;

function of_qty(v, tone) {
    const n = of_round2(v);
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

function of_status_chip(pct, stage_label, context, docs, draft_docs, stock_invoices, billed_pct, needs_invoice_qty, draft_invoices) {
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
        // One flow, one status per document (Sales Order → Delivery Note →
        // Sales Invoice made from it):
        //   DN saved, not submitted   → To Be Dispatched (Draft)
        //   DN submitted              → Dispatched
        //   SI for it saved (draft)   → Delivered (Draft)
        //   SI submitted              → Delivered
        // Before any DN: Not Dispatched / Picking / Ready to Dispatch.
        // "Invoiced" is judged on the QTY still to invoice (needs_invoice_qty),
        // never per_delivered vs per_billed (qty vs amount).
        const b = flt_of(billed_pct);
        const pc = p > 0 && p < 100 ? ` ${p.toFixed(0)}%` : '';
        if (p < 100 && draft_docs && draft_docs.length) {
            docs = draft_docs;
            return pill('of-pill--wait', `To Be Dispatched (Draft)${p > 0 ? ` · ${p.toFixed(0)}% sent` : ''}`);
        }
        if (p === 0) {
            if (stage_label === 'ready_to_deliver') return pill('of-pill--dn', 'Ready to Dispatch');
            if (stage_label === 'draft_pick_list') return pill('of-pill--wait', 'Picking');
            return '<span class="of-val of-val--zero" title="Nothing dispatched yet">Not Dispatched</span>';
        }
        const to_invoice = needs_invoice_qty == null ? null : flt_of(needs_invoice_qty);
        const invoiced = via_invoice || (to_invoice != null ? to_invoice <= 0.001 : b + 0.01 >= p);
        if (invoiced) return pill('of-pill--ready', p >= 100 ? '✓ Delivered' : `Delivered${pc}`);
        if (draft_invoices && draft_invoices.length) {
            // Link the draft invoice — the thing to submit next.
            docs = draft_invoices; context = 'billed';
            return pill('of-pill--need-bill', `Delivered (Draft)${pc}`);
        }
        return pill('of-pill--dn', p >= 100 ? '✓ Dispatched' : `Dispatched${pc}`);
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

// Past a handful of linked documents (a Material Request pulling from a
// dozen Sales Orders is common), listing every one of them one-per-line
// blows out the row height. Show the first OF_LINKS_VISIBLE and collapse
// the rest behind a "+N more" toggle instead.
const OF_LINKS_VISIBLE = 3;
function of_links(list, doctype) {
    if (!list) return '<span class="of-val--zero">—</span>';
    const names = String(list).split(',').map(s => s.trim()).filter(Boolean);
    if (!names.length) return '<span class="of-val--zero">—</span>';

    const link = n => `<div><a href="/app/${of_route(doctype)}/${encodeURIComponent(n)}" target="_blank">${of_esc(n)}</a></div>`;
    if (names.length <= OF_LINKS_VISIBLE) return names.map(link).join('');

    const extra_count = names.length - OF_LINKS_VISIBLE;
    return `${names.slice(0, OF_LINKS_VISIBLE).map(link).join('')}
        <div class="of-links-extra" style="display:none;">${names.slice(OF_LINKS_VISIBLE).map(link).join('')}</div>
        <div><a href="#" class="of-links-toggle" data-more-label="+${extra_count} more" data-less-label="Show less">+${extra_count} more</a></div>`;
}
function of_so_links(list) { return of_links(list, 'Sales Order'); }
function of_po_links(list) { return of_links(list, 'Purchase Order'); }

// The supplier's own order confirmation reference for a PO, shown right
// under the PO id — most POs never get one, so this renders nothing rather
// than an empty "Order Conf: —" line cluttering every row.
function of_order_confirmation_html(p) {
    if (!p.order_confirmation_no) return '';
    return `<div class="of-micro text-muted">${__('Order Conf')}: ${of_esc(p.order_confirmation_no)}${p.order_confirmation_date ? ` (${of_date(p.order_confirmation_date)})` : ''}</div>`;
}

// LR (Lorry Receipt) Number/Date on a Purchase Order — a separate,
// receiving-side pair of fields from the Logistics tab's own LR Number on
// Sales Invoice (dispatch side); see docs/order-flow-dashboard.md.
function of_po_lr_html(p) {
    if (!p.custom_lr_number) return '<span class="of-val--zero">—</span>';
    return `<div>${of_esc(p.custom_lr_number)}</div>${p.custom_lr_date ? `<div class="of-micro text-muted">${of_date(p.custom_lr_date)}</div>` : ''}`;
}

// Who created this document — shown under its id link on every tab.
// `creator_name` is server-resolved (see _attach_creator_names in
// order_flow_api.py, called once per tab's data function); falls back to the
// raw owner id only for a row from before that resolution existed (or a
// stale cached page), never silently to nothing.
// `also_shown_as` is another user id this same row may already display under
// a more specific label (e.g. the assigned Merchandiser) — when the creator
// IS that person, showing "Created by: <name>" right underneath it is the
// same name twice for no reason, so it's skipped rather than repeated.
function of_creator_html(row, also_shown_as) {
    const who = row && (row.creator_name || row.owner);
    if (!who) return '';
    if (also_shown_as && row.owner && also_shown_as === row.owner) return '';
    return `<div class="of-micro text-muted"><i class="fa fa-user-o"></i> ${of_esc(who)}</div>`;
}

/**
 * One quiet summary row for a tab's secondary numbers (Purchase/Job Work/
 * Billing/Finance) — a single line with thin dividers between figures
 * instead of six individually bordered, colored tiles, so a "1" doesn't
 * carry the same visual weight as a "₹2,621.00". Meaning still lives in
 * the value's own color, not in a whole tinted box.
 *
 * `stats` is an array of {label, value, tone, hint}; `tone` is one of
 * green/amber/orange/info/purple/red/gold (see .of-stat--* in
 * order_flow.css), or omitted for the plain text color.
 *
 * Not used for the Sales Tracker's stage tiles (.of-tile) — those are
 * click-to-filter controls, a different thing from a plain readout.
 */
function of_stat_strip(stats) {
    const cells = stats.map(s => `
        <div class="of-stat ${s.tone ? `of-stat--${s.tone}` : ''}" title="${of_esc(s.hint || '')}">
            <span class="of-stat__value">${s.value}</span>
            <span class="of-stat__label">${of_esc(s.label)}</span>
        </div>`).join('');
    return `<div class="of-stat-strip">${cells}</div>`;
}

// Under Action Required on a Sales Tracker row (order_flow_api._attach_tracker_insights):
// what the order is still waiting for and from whom, whether that lands after its due
// date, what is out at embroidery, the last mile (ready to ship, drafts left open,
// delivered not invoiced) and how long nothing has happened. Lists only documents the
// user may open.
function of_insights_html(o) {
    const i = o.insights;
    if (!i) return '';
    const sd = (v) => v ? moment(v).format('DD-MMM') : '';
    const link = (dt, name) => `<a href="/app/${frappe.router.slug(dt)}/${encodeURIComponent(name)}" target="_blank" style="font-weight:600;">${of_esc(name)}</a>`;
    const line = (icon, color, html, title) => `<div class="of-micro" style="margin-top:2px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${color ? 'color:' + color + ';' : ''}"
        ${title ? `title="${of_esc(title)}"` : ''}><i class="fa fa-${icon}" style="width:13px;"></i> ${html}</div>`;
    let out = '';
    const w = i.waiting || [];
    w.slice(0, 3).forEach((x) => {
        const tip = `${x.kind === 'jobber' ? __('At the jobber') : __('From the supplier')}: ${x.received} of ${x.qty} ${x.uom} back`
            + (x.due ? `, due ${sd(x.due)}` : '') + (x.note ? ` — ${__(x.note)}` : '');
        out += line(x.kind === 'jobber' ? 'cogs' : 'shopping-cart', x.overdue_days > 0 ? 'var(--of-red)' : '',
            `${link(x.doctype, x.name)} · ${of_round2(x.received)}/${of_round2(x.qty)}${x.due ? ' · ' + sd(x.due) : ''}`
            + (x.overdue_days > 0 ? ` <b>+${x.overdue_days}d</b>` : '') + (x.note ? ` <span style="color:var(--of-orange);">· ${__('no SCO')}</span>` : ''), tip);
    });
    if (w.length > 3) out += line('ellipsis-h', 'var(--text-light)', `+${w.length - 3} ${__('more')}`);
    if (i.late) {
        out += line('exclamation-triangle', 'var(--of-red)', `<b>${__('Late')}</b>: ${__('due')} ${sd(i.late.order_due)}, ${__('expected')} ${sd(i.late.expected)}`,
            __('The latest purchase / jobber due date for this order is after its delivery date.'));
    }
    (i.embroidery || []).slice(0, 2).forEach((e) => {
        const long = e.since_days != null && e.since_days > 7;
        out += line('scissors', long ? 'var(--of-red)' : 'var(--of-purple)',
            `${link('Embroidery Work Order', e.name)} · ${of_round2(e.out - e.back)} ${__('out')}` + (e.since_days != null ? ` · ${e.since_days}d` : ''),
            `${__('Embroidery')} (${__(e.work)}): ${e.out - e.back} out, ${e.back} back`);
    });
    const lm = i.last_mile || {};
    const lm_bits = [];
    if (flt_of(lm.ready_to_ship) > 0) lm_bits.push(`<span style="color:var(--of-green);font-weight:600;">${__('Ready')} ${of_round2(lm.ready_to_ship)}</span>`);
    (lm.draft_dns || []).forEach((d) => lm_bits.push(`${__('Draft')} ${link('Delivery Note', d)}`));
    (lm.draft_invoices || []).forEach((d) => lm_bits.push(`${__('Draft')} ${link('Sales Invoice', d)}`));
    if (flt_of(lm.needs_invoice) > 0) lm_bits.push(`<span style="color:var(--of-orange);font-weight:600;">${__('To invoice')} ${of_round2(lm.needs_invoice)}</span>`);
    if (lm_bits.length) out += line('truck', '', lm_bits.join(' · '));
    if (i.stale_days) out += line('hourglass-o', 'var(--text-light)', __('Idle {0}d', [i.stale_days]), __('No activity on this order for {0} days', [i.stale_days]));
    return out ? `<div class="of-insights" style="margin-top:6px;padding-top:4px;border-top:1px dashed var(--border-color);">${out}</div>` : '';
}

function of_card(title, icon, inner, actions_html, footer_html, title_suffix_html) {
    // footer_html (e.g. a pagination bar) renders AFTER .of-scroll, not
    // inside it — a control the user needs to click must stay put while the
    // table scrolls sideways underneath it, not scroll away with the table.
    // title_suffix_html (e.g. the Draft/Submitted filter pills) is raw HTML,
    // unlike `title` — it renders right after the title text, in the same
    // row the Create button already occupies, instead of a whole extra row.
    return `<div class="of-card">
        <div class="of-card__head" style="${actions_html ? 'display:flex;justify-content:space-between;align-items:center;' : ''}">
            <span style="display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap;"><i class="fa fa-${icon}"></i> ${of_esc(title)}${title_suffix_html || ''}</span>
            ${actions_html || ''}
        </div>
        <div class="of-scroll-hint"><i class="fa fa-arrows-h"></i> ${__('Scroll sideways to see every column')}</div>
        <div class="of-scroll">${inner}</div>
        ${footer_html || ''}
    </div>`;
}

/**
 * One slim "how much of this ledger is settled" strip.
 *
 * Replaces three KPI cards per sub-tab, two of which restated tiles already shown
 * at the top of the Accounts tab. The settled amount and the percentage are the
 * only figures not available above, so they lead.
 */
// The lines of a Pick List as "item name / item code × qty" (picked once submitted) —
// the first 3, then "+N more" that opens to the rest.
function of_pl_items_html(items, is_draft) {
    items = items || [];
    if (!items.length) return '<span class="of-val--zero">—</span>';
    const line = (it) => {
        const qty = is_draft || flt(it.picked_qty) === flt(it.qty)
            ? of_round2(it.qty)
            : `${of_round2(it.picked_qty)} / ${of_round2(it.qty)}`;
        return `<div class="of-pl-item">
            <div class="of-pl-item__name">${of_esc(it.item_name || it.item_code)}</div>
            <div class="of-micro text-muted">${it.item_name && it.item_name !== it.item_code ? of_esc(it.item_code) + ' · ' : ''}<b>× ${qty}</b> ${of_esc(it.uom || '')}</div>
        </div>`;
    };
    const head = items.slice(0, 3).map(line).join('');
    const rest = items.slice(3);
    return head + (rest.length ? `<details class="of-pl-more"><summary class="of-micro">${__('+{0} more', [rest.length])}</summary>${rest.map(line).join('')}</details>` : '');
}

// ── Table filter search box (Customer / Supplier / …): an input over the table's own
// options (OrderFlow.tf_options[list][field]); the matches open in one popup on <body>.
// The options shown by name only — several records with the same name (five suppliers called
// "DAC") become one entry whose value is their ids joined by "||" (order_flow_api.TF_MULTI_SEP;
// the server matches any of them).
function of_tf_merged(opts) {
    const by = new Map();
    (opts || []).forEach(([v, label]) => {
        const name = String(label || v).trim();
        const k = name.toLowerCase();
        if (!by.has(k)) by.set(k, [[], name]);
        by.get(k)[0].push(v);
    });
    return [...by.values()].map(([vals, name]) => [vals.join('||'), name]);
}

// The name to show in the box for the chosen value (one id or several joined by "||").
function of_tf_label(opts, cur) {
    const names = String(cur).split('||').map(v => {
        const o = (opts || []).find(x => x[0] === v);
        return o ? (o[1] || o[0]) : v;
    });
    return [...new Set(names)].join(', ');
}

function of_tf_combo_pop() {
    let $p = $('#of-tf-pop');
    if (!$p.length) {
        $p = $('<div id="of-tf-pop" class="of-tf-pop"></div>').appendTo(document.body);
        // The popup is fixed on the screen: keep it under its search box while the page (or any
        // table) scrolls, and hide it once the box itself has scrolled out of sight.
        const follow = () => { if ($p.is(':visible')) of_tf_combo_place($p); };
        window.addEventListener('scroll', follow, true);
        window.addEventListener('resize', follow);
    }
    return $p;
}

function of_tf_combo_place($p) {
    const combo = $p.data('combo');
    const input = combo && combo.querySelector('.of-tf-combo-input');
    if (!input || !document.body.contains(input)) { $p.hide(); return; }
    const r = input.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || (r.width === 0 && r.height === 0)) { $p.hide(); return; }
    const w = Math.min(Math.max(260, r.width + 60), window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left - 8, window.innerWidth - w - 8));
    $p.css({ left, top: r.bottom + 4, width: w, minWidth: 0 });
}

function of_tf_combo_open(of, $input, on_focus) {
    const $c = $input.closest('.of-tf-combo');
    const key = $c.data('list'), field = $c.data('f');
    const opts = of_tf_merged(((of.tf_options[key] || {})[field]) || []);
    const q = on_focus ? '' : String($input.val() || '').trim().toLowerCase();
    if (on_focus) $input.select();
    const hits = opts.filter(o => !q || String(o[1] || '').toLowerCase().includes(q) || String(o[0]).toLowerCase().includes(q)).slice(0, 80);
    const $p = of_tf_combo_pop();
    $p.data('combo', $c[0]).data('active', 0)
      .html(hits.length ? hits.map((o, i) => `<div class="of-tf-pop__item${i === 0 ? ' is-active' : ''}" data-v="${of_esc(o[0])}">
            <span>${of_esc(o[1] || o[0])}</span></div>`).join('')
          : `<div class="of-tf-pop__empty">${__('No match in this table')}</div>`)
      .show();
    of_tf_combo_place($p);
    $p.off('mousedown').on('mousedown', '.of-tf-pop__item', (ev) => {
        ev.preventDefault();
        of.set_table_filter(key, field, $(ev.currentTarget).data('v'));
        $p.hide();
    });
}

function of_tf_combo_key(of, $input, e) {
    const $p = of_tf_combo_pop();
    const $items = $p.find('.of-tf-pop__item');
    let a = $p.data('active') || 0;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!$p.is(':visible')) return of_tf_combo_open(of, $input, false);
        a = Math.max(0, Math.min($items.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1)));
        $items.removeClass('is-active').eq(a).addClass('is-active')[0]?.scrollIntoView({ block: 'nearest' });
        $p.data('active', a);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        const $c = $input.closest('.of-tf-combo');
        if (!String($input.val() || '').trim()) { of.set_table_filter($c.data('list'), $c.data('f'), ''); $p.hide(); return; }
        const $pick = $items.eq(a);
        if ($pick.length) { of.set_table_filter($c.data('list'), $c.data('f'), $pick.data('v')); $p.hide(); }
    } else if (e.key === 'Escape') {
        $p.hide(); $input.blur();
    }
}

function of_tf_combo_close(of, $input) {
    // A redraw (after picking, or a background refresh) replaces the box while it has focus, and
    // the browser then "blurs" the removed, empty box — that is not the user clearing the filter.
    if (!$input[0] || !$input[0].isConnected) return;
    const $p = of_tf_combo_pop();
    const $c = $input.closest('.of-tf-combo');
    if ($p.data('combo') === $c[0]) $p.hide();
    // typed text that was not picked: an emptied box clears the filter, anything else snaps back
    const key = $c.data('list'), field = $c.data('f');
    const cur = ((of.table_filters[key] || {})[field]) || '';
    if (!String($input.val() || '').trim()) { if (cur) of.set_table_filter(key, field, ''); return; }
    $input.val(cur ? of_tf_label(((of.tf_options[key] || {})[field]) || [], cur) : '');
}

// A plain sub-tab (Purchase Flow, Job Work, Sales Tracker) drawn as a summary card: the count
// of that list, a short line under it, and optionally Draft / Submitted. Keeps class of-subtab /
// data-subtab, so the sub-tab switcher and permission hiding work unchanged.
function of_tabcard(o) {
    const ds = o.ds || null;
    const ds_line = ds && (flt_of(ds.draft) || flt_of(ds.submitted))
        ? `${flt_of(ds.draft) ? `<span class="of-kcard__draft">${flt_of(ds.draft)} ${__('draft')}</span> · ` : ''}${flt_of(ds.submitted)} ${__('submitted')}` : '';
    return `<button class="of-subtab of-kcard of-kcard--${o.tone || 'blue'}${o.active ? ' is-active' : ''}" data-subtab="${o.sub}">
        <span class="of-kcard__title"><i class="fa fa-${o.icon}"></i> ${of_esc(o.title)}</span>
        <span class="of-kcard__amt">${o.value} <small>${of_esc(o.value_label || '')}</small></span>
        <span class="of-kcard__meta">${[o.meta, ds_line].filter(Boolean).join(' · ') || '&nbsp;'}</span>
    </button>`;
}

// A sub-tab drawn as a summary card: what is still open, a progress bar of what is settled,
// and how many documents. Keeps class of-acc-subtab / data-subtab, so the sub-tab switcher works.
function of_kcard(o) {
    const total = flt_of(o.total), settled = flt_of(o.settled), open = flt_of(o.open);
    const pct = total > 0 ? Math.max(0, Math.min(100, (settled / total) * 100)) : 0;
    return `<button class="of-acc-subtab of-kcard of-kcard--${o.tone}${o.active ? ' is-active' : ''}" data-subtab="${o.sub}">
        <span class="of-kcard__title"><i class="fa fa-${o.icon}"></i> ${of_esc(o.title)}</span>
        <span class="of-kcard__amt">${of_money(open)} <small>${of_esc(o.open_label)}</small></span>
        <span class="of-bar"><span class="of-bar__fill${pct >= 100 ? '' : (pct > 0 ? ' of-bar__fill--part' : ' of-bar__fill--none')}" style="width:${pct}%;"></span></span>
        <span class="of-kcard__meta">${pct.toFixed(0)}% ${of_esc(o.settled_label)} ${__('of')} ${of_money(total)} · ${o.docs} ${of_esc(o.doc_label)}${o.docs === 1 ? '' : 's'}</span>
    </button>`;
}

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



// Embroidery work order notes, shown in full: one line per entry; a "• <date time>: …" status
// entry gets its date in bold. The box scrolls when the notes are long.
function of_ewo_notes_html(notes) {
    const lines = String(notes || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const html = lines.map(l => {
        const m = l.match(/^[•\-*]\s*(\d{1,2}-\d{1,2}-\d{4}(?:\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)?)\s*:\s*(.*)$/i);
        return m
            ? `<div class="of-ewo-note of-ewo-note--log"><b>${of_esc(m[1])}</b> ${of_esc(m[2])}</div>`
            : `<div class="of-ewo-note">${of_esc(l)}</div>`;
    }).join('');
    return `<div class="of-ewo-notes">${html}</div>`;
}

// Finance tab: the invoice's own ERPNext status (Unpaid, Partly Paid, Overdue, Paid,
// Return, Credit Note Issued…) as a pill, and under it whether the goods it bills have
// been delivered / received (goods_status from get_accounts_flow).
const OF_INVOICE_STATUS_PILL = {
    'Draft': 'draft', 'Paid': 'ready', 'Partly Paid': 'wait', 'Partly Paid and Discounted': 'wait',
    'Unpaid': 'warn', 'Unpaid and Discounted': 'warn',
    'Overdue': 'blocked', 'Overdue and Discounted': 'blocked',
    'Return': 'done', 'Credit Note Issued': 'done', 'Debit Note Issued': 'done',
    'Internal Transfer': 'dn',
};
function of_invoice_status_html(d) {
    const st = d.status || (flt_of(d.outstanding_amount) <= 0 ? 'Paid' : 'Unpaid');
    const pill = `<span class="of-pill of-pill--${OF_INVOICE_STATUS_PILL[st] || 'wait'}">${of_esc(__(st))}</span>`;
    const g = d.goods_status;
    if (!g) return pill;
    const tone = /^(Delivered|Received)$/.test(g) ? 'var(--of-green)' : (/^Partly/.test(g) ? 'var(--of-orange)' : 'var(--text-muted)');
    const icon = /^(Delivered|Received)$/.test(g) ? 'check-circle' : (/^Partly/.test(g) ? 'adjust' : 'circle-o');
    return `${pill}<div class="of-micro" style="margin-top:4px;color:${tone};font-weight:600;white-space:nowrap;"><i class="fa fa-${icon}"></i> ${of_esc(__(g))}</div>`;
}

// ── Finance › Returns / Notes ─────────────────────────────────────────────────────────────
// Chips on an invoice row for the Credit / Debit Notes made against it.
function of_return_chips(returns, doctype) {
    if (!returns || !returns.length) return '';
    const slug = doctype === 'Sales Invoice' ? 'sales-invoice' : 'purchase-invoice';
    const label = doctype === 'Sales Invoice' ? __('Credit Note') : __('Debit Note');
    return `<div class="of-ret-chips">${returns.map(r => `<a class="of-ret-chip${flt_of(r.docstatus) === 0 ? ' is-draft' : ''}"
        href="/app/${slug}/${encodeURIComponent(r.name)}" target="_blank" title="${of_esc(label)} ${of_esc(r.name)}${flt_of(r.docstatus) === 0 ? ' (draft)' : ''}">
        <i class="fa fa-undo"></i> ${of_esc(r.name)} ${of_money(Math.abs(flt_of(r.amount)))}${flt_of(r.docstatus) === 0 ? ` · ${__('draft')}` : ''}</a>`).join('')}</div>`;
}

// An invoice's Remarks (editable after submit; a return's reason) under the party.
function of_remark_html(remarks) {
    const t = (remarks || '').trim();
    if (!t) return '';
    return `<div class="of-remark" title="${of_esc(t)}"><i class="fa fa-comment-o"></i> ${of_esc(t)}</div>`;
}

// What settled an invoice (order_flow_api._attach_payments): under the Received / Paid amount only a
// link "N payments"; clicking it (of_payments_dialog) lists each Payment Entry — date, mode, cheque /
// ref. no., amount set off on this invoice ("1 of N invoices" when one entry settled several),
// receipt / voucher print (Payment Receipt DAC) — and Journal Entries that set a credit note or
// advance off against it (Payment Reconciliation).
function of_payment_lines(payments, currency, invoice) {
    if (!payments || !payments.length) return '';
    const drafts = payments.filter(p => flt_of(p.docstatus) === 0).length;
    const label = payments.length === 1 ? __('1 payment') : __('{0} payments', [payments.length]);
    return `<div><button class="of-pay-link" data-invoice="${of_esc(invoice || '')}" data-currency="${of_esc(currency || '')}"
        data-payments="${of_esc(JSON.stringify(payments))}" title="${__('See the payments and print receipts')}">
        <i class="fa fa-file-text-o"></i> ${label}${drafts ? ` <span class="of-pay-tag">${drafts} ${__('draft')}</span>` : ''}</button></div>`;
}

function of_payments_dialog(invoice, payments, currency) {
    const rows = payments.map(p => {
        const pe = p.doctype === 'Payment Entry';
        const draft = flt_of(p.docstatus) === 0;
        return `<tr>
            <td><a href="/app/${pe ? 'payment-entry' : 'journal-entry'}/${encodeURIComponent(p.name)}" target="_blank" style="font-weight:600;">${of_esc(p.name)}</a>
                ${draft ? ` <span class="of-pay-tag">${__('draft')}</span>` : ''}</td>
            <td>${p.date ? frappe.datetime.str_to_user(p.date) : ''}</td>
            <td>${pe ? of_esc(p.mode || '') : of_esc(__('Adjusted ({0})', [__(p.mode || 'Journal Entry')]))}</td>
            <td>${of_esc(p.ref_no || '')}</td>
            <td style="text-align:right;font-weight:700;">${of_money(p.amount, currency)}
                ${flt_of(p.n_refs) > 1 ? `<div class="of-pay-tag" style="display:inline-block;" title="${__('This one entry settled {0} invoices', [p.n_refs])}">${__('1 of {0} invoices', [p.n_refs])}</div>` : ''}</td>
            <td>${pe ? `<button class="btn btn-xs btn-default of-pay-dlg-print" data-name="${of_esc(p.name)}" data-docstatus="${p.docstatus}"
                title="${__('Print the receipt / voucher')}"><i class="fa fa-print"></i></button>` : ''}</td>
        </tr>`;
    }).join('');
    const total = payments.filter(p => flt_of(p.docstatus) === 1).reduce((a, p) => a + flt_of(p.amount), 0);
    const d = new frappe.ui.Dialog({ title: __('Payments — {0}', [invoice]), size: 'large',
        fields: [{ fieldtype: 'HTML', fieldname: 'html' }] });
    d.fields_dict.html.$wrapper.html(`<table class="table table-bordered of-pay-table">
        <thead><tr><th>${__('Entry')}</th><th>${__('Date')}</th><th>${__('Mode')}</th><th>${__('Cheque / Ref. No.')}</th>
            <th style="text-align:right;">${__('Amount')}</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="4" style="text-align:right;font-weight:600;">${__('Total settled (submitted)')}</td>
            <td style="text-align:right;font-weight:700;">${of_money(total, currency)}</td><td></td></tr></tfoot></table>`);
    d.$wrapper.on('click', '.of-pay-dlg-print', (e) => {
        const $b = $(e.currentTarget);
        window.dacs_print_copies('Payment Entry', String($b.data('name')), { is_return: 0, docstatus: cint($b.data('docstatus')) });
    });
    d.show();
}

// Returns / Notes: All · Credit Notes (customers) · Debit Notes (suppliers) — sets the table's
// "kind" filter (order_flow_api._accounts_notes); each with its own New button.
function of_notes_kind_bar(kind, m) {
    const tab = (k, icon, label, n) => `<button class="of-notes-kind${kind === k ? ' is-active' : ''}" data-kind="${k}">
        <i class="fa fa-${icon}"></i> ${label}${n !== null ? ` <span class="of-notes-kind__n">${n}</span>` : ''}</button>`;
    const cn = flt_of(m.notes_credit_count), dn = flt_of(m.notes_debit_count);
    const new_btn = kind === 'credit' && frappe.model.can_create('Sales Invoice')
        ? `<a class="of-btn of-btn--primary" href="/app/sales-invoice/new?is_return=1" target="_blank" title="${__('Direct Credit Note — not from an invoice (e.g. a service item). From an invoice: open it › Create › Return / Credit Note')}"><i class="fa fa-plus"></i> ${__('New Credit Note')}</a>`
        : kind === 'debit' && frappe.model.can_create('Purchase Invoice')
        ? `<a class="of-btn of-btn--primary" href="/app/purchase-invoice/new?is_return=1" target="_blank" title="${__('Direct Debit Note — not from a bill. From a bill: open it › Create › Return / Debit Note')}"><i class="fa fa-plus"></i> ${__('New Debit Note')}</a>` : '';
    return `<div class="of-notes-kinds">
        ${tab('', 'list', __('All'), cn + dn)}
        ${tab('credit', 'user', __('Credit Notes — customers'), cn)}
        ${tab('debit', 'truck', __('Debit Notes — suppliers'), dn)}
        <span style="margin-left:auto;">${new_btn}</span>
    </div>`;
}

// Goods side of a note (return_goods.note_goods): has the stock come back?
function of_goods_chip(g) {
    if (!g || !g.status) return '';
    const m = {
        done: ['is-done', 'check', __('Stock returned')], self: ['is-done', 'check', __('Stock returned')],
        draft: ['is-wait', 'clock-o', __('Return in draft')], pending: ['is-miss', 'exclamation-triangle', __('Stock not returned')],
        unlinked: ['is-wait', 'question', __('Stock not returned')], none: ['is-none', 'minus', __('No stock item')],
    }[g.status];
    if (!m) return '';
    return `<div class="of-goods-chip ${m[0]}" title="${of_esc(g.text || '')}"><i class="fa fa-${m[1]}"></i> ${of_esc(m[2])}</div>`;
}

// Sales / Purchase Returns (goods back) still waiting for their Credit / Debit Note
// (return_goods.goods_credit "pending") — above the notes table, each with Make Credit / Debit Note.
function of_goods_waiting_html(list) {
    if (!list || !list.length) return '';
    return `<div class="of-goods-waiting"><b><i class="fa fa-exclamation-triangle"></i> ${__('{0} return(s) with the goods back but no Credit / Debit Note yet', [list.length])}</b>
        ${list.map(r => {
            const sales = r.doctype === 'Delivery Note';
            const slug = sales ? 'delivery-note' : 'purchase-receipt';
            const can = frappe.model.can_create(sales ? 'Sales Invoice' : 'Purchase Invoice');
            return `<div class="of-goods-waiting__row">
                <a href="/app/${slug}/${encodeURIComponent(r.name)}" target="_blank" style="font-weight:600;">${of_esc(r.name)}</a>
                <span class="of-micro text-muted">${sales ? __('Sales Return') : __('Purchase Return')} · ${of_esc(r.party_name || '')} · ${of_date(r.posting_date)}</span>
                ${can ? `<button class="of-btn of-btn--primary of-make-goods-btn" data-doctype="${r.doctype}" data-name="${of_esc(r.name)}">
                    <i class="fa fa-file-text-o"></i> ${sales ? __('Make Credit Note') : __('Make Debit Note')}</button>` : ''}
            </div>`;
        }).join('')}</div>`;
}

// The Returns / Notes summary card (a sub-tab, like the other three).
function of_notes_kcard(m, active, total) {
    const credit = flt_of(m.notes_customer_credit), owed = flt_of(m.notes_supplier_refund);
    const act = flt_of(m.notes_customer_credit_count) + flt_of(m.notes_supplier_refund_count) + flt_of(m.notes_drafts);
    return `<button class="of-acc-subtab of-kcard of-kcard--orange${active ? ' is-active' : ''}" data-subtab="notes">
        <span class="of-kcard__title"><i class="fa fa-undo"></i> ${__('Returns / Notes')}</span>
        <span class="of-kcard__amt">${act} <small>${__('to act on')}</small></span>
        <span class="of-kcard__meta">${of_money(credit)} ${__('customer credit')} · ${of_money(owed)} ${__('supplier owes us')} · ${flt_of(m.notes_credit_count)} ${__('credit')} / ${flt_of(m.notes_debit_count)} ${__('debit notes')}</span>
    </button>`;
}

function of_note_row_html(n, can_pay) {
    const cn = n.kind === 'credit_note';
    const slug = cn ? 'sales-invoice' : 'purchase-invoice';
    const party_slug = cn ? 'customer' : 'supplier';
    const type_chip = cn
        ? `<span class="of-note-type is-credit" title="${__('Sales return: reduces what the customer owes')}">${__('Credit Note')} · ${__('sales return')}</span>`
        : `<span class="of-note-type is-debit" title="${__('Purchase return: reduces what we owe the supplier')}">${__('Debit Note')} · ${__('purchase return')}</span>`;
    const against = n.return_against
        ? `<a href="/app/${slug}/${encodeURIComponent(n.return_against)}" target="_blank" style="font-weight:600;">${of_esc(n.return_against)}</a>
           ${n.against_status ? `<div><span class="of-pill of-pill--${OF_INVOICE_STATUS_PILL[n.against_status] || 'wait'}">${of_esc(__(n.against_status))}</span></div>` : ''}
           ${n.against_outstanding != null ? `<div class="of-micro text-muted">${cn ? __('still due') : __('still to pay')}: ${of_money(Math.max(flt_of(n.against_outstanding), 0), n.currency)}</div>` : ''}`
        : `<span class="of-chip" style="background:var(--subtle-fg);color:var(--text-color);">${__('Direct')}</span><div class="of-micro text-muted">${__('not against an invoice')}</div>`;
    const items = n.items || [];
    const items_html = items.length ? items.slice(0, 3).map(it => `<div class="of-note-item">
            <b>${of_esc(it.item_name || it.item_code)}</b>
            <span class="of-micro text-muted">${it.item_name && it.item_name !== it.item_code ? of_esc(it.item_code) + ' · ' : ''}${Math.abs(flt_of(it.qty))} ${of_esc(it.uom || '')} × ${of_money(it.rate, n.currency)} = ${of_money(Math.abs(flt_of(it.amount)), n.currency)}</span>
        </div>`).join('') + (items.length > 3 ? `<div class="of-micro" style="color:var(--of-blue);">+${items.length - 3} ${__('more — click ▸ to see all')}</div>` : '')
        : '<span class="of-val--zero">—</span>';
    const due = flt_of(n.refund_due);
    const effect = {
        draft: `<span class="of-pill of-pill--draft">${__('Draft')}</span><div class="of-micro text-muted">${__('no effect until submitted')}</div>`,
        credit: cn ? `<span class="of-note-eff is-credit">${__('Customer credit')} ${of_money(due, n.currency)}</span>`
                   : `<span class="of-note-eff is-owed">${__('Supplier owes us')} ${of_money(due, n.currency)}</span>`,
        reduced: `<span class="of-note-eff is-done">${__('Reduced')} ${of_esc(n.return_against || '')}</span>`,
        settled: `<span class="of-note-eff is-done">${__('Settled')}</span>`,
    }[n.effect] || '';
    const party_type = cn ? 'Customer' : 'Supplier';
    const adjust = `<button class="of-btn ${n.next === 'adjust' ? 'of-btn--primary' : ''} of-adjust-btn" data-party-type="${party_type}" data-party="${of_esc(n.party)}"
            title="${__('Payment Reconciliation: set this credit off against their unpaid invoices / bills')}"><i class="fa fa-exchange"></i> ${__('Adjust')}</button>`;
    const refund = can_pay ? `<button class="of-btn ${n.next !== 'adjust' ? (cn ? 'of-btn--warning' : 'of-btn--success') : ''} of-refund-btn" data-doctype="${n.doctype}" data-name="${of_esc(n.name)}">
            <i class="fa fa-${cn ? 'reply' : 'inr'}"></i> ${cn ? __('Refund') : __('Receive refund')}</button>` : '';
    const g = n.goods || {};
    const goods_btn = g.status === 'pending' && n.docstatus == 1 && frappe.model.can_create(cn ? 'Delivery Note' : 'Purchase Receipt')
        ? `<button class="of-btn of-btn--danger of-make-goods-btn" data-doctype="${n.doctype}" data-name="${of_esc(n.name)}"
            title="${__('Make the {0} for the items not yet back — only what is missing', [cn ? __('Sales Return') : __('Purchase Return')])}">
            <i class="fa fa-cubes"></i> ${cn ? __('Sales Return') : __('Purchase Return')}</button>` : '';
    const actions = goods_btn + (n.effect === 'credit' ? (n.next === 'adjust' ? adjust + refund : refund + adjust) : '');
    return `<tr class="of-doc-row">
        <td><i class="fa fa-caret-right of-doc-items-toggle" data-doctype="${n.doctype}" data-docname="${of_esc(n.name)}" data-docstatus="${n.docstatus}" style="cursor:pointer;margin-right:4px;color:var(--text-light);"></i>
            <a href="/app/${slug}/${encodeURIComponent(n.name)}" target="_blank" style="font-weight:700;">${of_esc(n.name)}</a>
            <div>${type_chip}</div>${of_creator_html(n)}</td>
        <td style="text-align:left;"><a href="/app/${party_slug}/${encodeURIComponent(n.party)}" target="_blank" style="font-weight:600;">${of_esc(n.party_name || n.party)}</a>
            <div class="of-micro text-muted">${of_esc(n.party)}</div>${of_remark_html(n.remarks)}</td>
        <td>${against}</td>
        <td style="text-align:left;">${items_html}</td>
        <td class="of-meta">${of_date(n.posting_date)}</td>
        <td style="font-weight:700;color:${cn ? 'var(--of-red)' : 'var(--of-green)'};">${of_money(Math.abs(flt_of(n.grand_total)), n.currency)}</td>
        <td>${effect}${of_goods_chip(g)}</td>
        <td style="text-align:left;"><div class="of-micro" style="font-weight:600;color:var(--text-color);margin-bottom:5px;">${of_esc(n.next_text || '')}</div>
            <div class="of-po-actions">${actions}<button class="of-btn of-print-copies-btn" data-doctype="${n.doctype}" data-name="${of_esc(n.name)}" data-is-return="1" data-docstatus="${n.docstatus}"
                title="${cn ? __('Print the Credit Note') : __('Print the Debit Note')} — ${__('choose the copy')}"><i class="fa fa-print"></i></button><a class="of-btn" href="/app/${slug}/${encodeURIComponent(n.name)}" target="_blank"><i class="fa fa-external-link"></i> ${__('Open')}</a></div></td>
    </tr>`;
}

// Finance only: the entries the accounts team starts by hand — Receive / Pay open the payment prompt,
// the rest a new form in a new tab. Only what the user may create is shown.
function of_fin_new_bar() {
    const can = (dt) => frappe.model.can_create(dt);
    const read = (dt) => frappe.model.can_read(dt);
    const q = (o) => '?' + Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const items = [
        can('Payment Entry') && ['/app/payment-entry/new' + q({ payment_type: 'Internal Transfer' }), 'exchange', __('Internal Transfer'),
            __('Between our own accounts: cash deposit, bank to bank')],
        can('Sales Invoice') && ['/app/sales-invoice/new' + q({ is_return: 1 }), 'undo', __('Credit Note (direct)'),
            __('A return / allowance to a customer not made from an invoice (e.g. a service item). From an invoice: open it › Create › Return / Credit Note')],
        can('Purchase Invoice') && ['/app/purchase-invoice/new' + q({ is_return: 1 }), 'undo', __('Debit Note (direct)'),
            __('A return / claim on a supplier not made from a bill. From a bill: open it › Create › Return / Debit Note')],
        read('Payment Reconciliation') && ['/app/payment-reconciliation', 'link', __('Payment Reconciliation'),
            __('Match advances, credit notes and unlinked payments with invoices')],
        read('Bank Reconciliation Tool') && ['/app/bank-reconciliation-tool', 'university', __('Bank Reconciliation'),
            __('Match the bank statement with the entries')],
    ].filter(Boolean);
    // Receive / Pay: the one payment prompt (public/js/bulk_payment.js) — one invoice, several of one
    // party, several parties (a Bulk Payment, one Payment Entry each), or an advance.
    const bulk = can('Payment Entry')
        ? `<button class="of-btn of-btn--primary of-pay-new-btn" data-type="Receive" title="${of_esc(__('Money from customers: one or many invoices, one or many customers, or an advance'))}"><i class="fa fa-arrow-down"></i> ${__('Receive')}</button>
           <button class="of-btn of-btn--primary of-pay-new-btn" data-type="Pay" title="${of_esc(__('Money to suppliers / jobbers: one or many bills, one or many suppliers, or an advance'))}"><i class="fa fa-arrow-up"></i> ${__('Pay')}</button>`
        : '';
    // Journal Entry: a short prompt with ready-made patterns (public/js/journal_prompt.js)
    const je = can('Journal Entry')
        ? `<button class="of-btn of-je-new-btn" title="${of_esc(__('Adjustments with no other document: bank charges, cash deposit, expense, TDS deposit, write-off, corrections'))}"><i class="fa fa-book"></i> ${__('Journal Entry')}</button>`
        : '';
    if (!items.length && !bulk && !je) return '';
    return `<div class="of-fin-new">
        <span class="of-fin-new__label"><i class="fa fa-plus"></i> ${__('New')}</span>${bulk}${je}
        ${items.map(([href, icon, label, title]) => `<a class="of-btn of-fin-new__btn" href="${href}" target="_blank" title="${of_esc(title)}"><i class="fa fa-${icon}"></i> ${of_esc(label)}</a>`).join('')}
    </div>`;
}

// Doctypes whose drafts can be submitted from their row (dashboard_submit.SUBMITTABLE).
// Not Sales Orders (approval workflow) nor Pick Lists (their own "Submit Pick List" review).
const OF_DASHBOARD_SUBMITTABLE = ['Material Request', 'Purchase Order', 'Purchase Receipt', 'Subcontracting Receipt',
    'Embroidery Work Order', 'Sales Invoice', 'Purchase Invoice'];

// Submit a draft from its row: show the document back, require a tick, then submit as the
// user (full server validation). Offers the print prompt afterwards where the form would.
function of_submit_draft_prompt(doctype, name, on_done) {
    frappe.call({ method: 'erp_dacsinc_custom.dashboard_submit.get_submit_preview', args: { doctype, name } }).then(r => {
        const d = r.message;
        if (!d) return;
        const money = (v) => (v == null ? '' : format_currency(flt(v, 2), d.currency || undefined));
        const has_rate = d.items.some(i => i.rate != null);
        const total_qty = d.items.reduce((a, i) => a + flt(i.qty), 0);
        const total_amt = d.items.reduce((a, i) => a + flt(i.amount), 0);
        const uoms = [...new Set(d.items.map(i => i.uom).filter(Boolean))];
        const rows = d.items.map((i, n) => `<tr>
            <td class="of-ct-num of-ct-muted">${n + 1}</td>
            <td><div class="of-ct-item">${of_esc(i.item_code)}</div>${i.item_name && i.item_name !== i.item_code ? `<div class="of-ct-sub">${of_esc(i.item_name)}</div>` : ''}</td>
            <td class="of-ct-num">${flt(i.qty, 3)} <span class="of-ct-muted">${of_esc(i.uom)}</span></td>
            ${has_rate ? `<td class="of-ct-num">${money(i.rate)}</td><td class="of-ct-num of-ct-strong">${money(i.amount)}</td>` : ''}
        </tr>`).join('');
        const meta = (label, value) => value ? `<div class="of-cm-card"><div class="of-cm-label">${label}</div><div class="of-cm-value">${value}</div></div>` : '';

        const dlg = new frappe.ui.Dialog({
            title: __('Submit {0} {1}', [__(doctype), name]),
            size: 'large',
            fields: [
                { fieldtype: 'HTML', fieldname: 'body' },
                { fieldtype: 'Check', fieldname: 'checked', label: __('I have checked this {0} (items, quantities, rates and party)', [__(doctype)]) },
            ],
            primary_action_label: __('Submit'),
            primary_action: (v) => {
                if ((d.mr_over || []).length) return frappe.msgprint(__('Correct the highlighted quantities on the Purchase Order first.'));
                if (!v.checked) return frappe.msgprint(__('Tick the confirmation to submit.'));
                dlg.get_primary_btn().prop('disabled', true);
                frappe.call({
                    method: 'erp_dacsinc_custom.dashboard_submit.submit_from_dashboard',
                    args: { doctype, name }, freeze: true, freeze_message: __('Submitting…'),
                }).then(() => {
                    dlg.hide();
                    frappe.show_alert({ message: __('{0} {1} submitted', [__(doctype), name]), indicator: 'green' });
                    on_done && on_done();
                    if (window.dacs_print_prompt && ['Sales Invoice', 'Purchase Order', 'Embroidery Work Order'].includes(doctype)) {
                        const label = doctype === 'Purchase Order' && d.is_subcontracted ? __('Subcontract PO') : __(doctype);
                        window.dacs_print_prompt(doctype, name, label);
                    }
                }).catch(() => dlg.get_primary_btn().prop('disabled', false));
            },
        });
        dlg.$wrapper.addClass('of-confirm-dialog');
        const over = d.mr_over || [];
        const over_html = over.length ? `<div class="of-cm-warn" style="background:#fff1f0;border-color:#f5c2c0;color:#8a1f17;">
            <i class="fa fa-ban"></i><div><b>${__('{0} line(s) ask for more than their Material Request still has open — ERPNext will not submit this as it is.', [over.length])}</b>
            <ul style="margin:6px 0 4px 16px;padding:0;">${over.map(o => `<li><b>${of_esc(o.item_code)}</b>: ${__('asks {0} {1}, only {2} {1} left on {3}', [flt(o.qty, 3), of_esc(o.uom || ''), flt(o.allowed_qty, 3), of_esc(o.material_request)])}</li>`).join('')}</ul>
            <a href="/app/purchase-order/${encodeURIComponent(name)}" target="_blank">${__('Open the Purchase Order and click "Correct quantities"')}</a></div></div>` : '';
        dlg.fields_dict.body.$wrapper.html(`${over_html}
            <div class="of-cm-warn"><i class="fa fa-exclamation-triangle"></i>
                ${__('Submitting is final. To change it afterwards, the {0} has to be cancelled and amended.', [__(doctype)])}</div>
            <div class="of-cm-grid">
                ${meta(__('Document'), `<a href="/app/${frappe.router.slug(doctype)}/${encodeURIComponent(name)}" target="_blank">${of_esc(name)}</a>`)}
                ${meta(__('Party'), of_esc(d.party))}
                ${meta(__('Date'), d.date ? frappe.datetime.str_to_user(d.date) : '')}
                ${meta(__('Supplier Bill No'), of_esc(d.bill_no))}
                ${meta(__('Total'), d.total != null ? `<span class="of-cm-total">${money(d.total)}</span>` : '')}
            </div>
            <div class="of-ct-wrap">
                <table class="of-confirm-table">
                    <thead><tr><th class="of-ct-num">#</th><th>${__('Item')}</th><th class="of-ct-num">${__('Qty')}</th>
                        ${has_rate ? `<th class="of-ct-num">${__('Rate')}</th><th class="of-ct-num">${__('Amount')}</th>` : ''}</tr></thead>
                    <tbody>${rows || `<tr><td colspan="5" class="of-ct-muted">${__('No items')}</td></tr>`}</tbody>
                    ${d.items.length > 1 || (has_rate && d.total != null && Math.abs(flt(d.total) - total_amt) > 0.01) ? `<tfoot><tr><td></td><td>${__('{0} line(s)', [d.items.length])}${has_rate && d.total != null && Math.abs(flt(d.total) - total_amt) > 0.01 ? ` <span class="of-ct-muted">· ${__('items, before tax')}</span>` : ''}</td>
                        <td class="of-ct-num">${uoms.length === 1 ? `${flt(total_qty, 3)} <span class="of-ct-muted">${of_esc(uoms[0])}</span>` : ''}</td>
                        ${has_rate ? `<td></td><td class="of-ct-num">${money(total_amt)}</td>` : ''}</tr></tfoot>` : ''}
                </table>
            </div>`);
        dlg.fields_dict.checked.$wrapper.addClass('of-cm-check');
        dlg.show();
    });
}

function of_empty_row(cols) {
    return `<tr><td colspan="${cols}" class="of-empty"><i class="fa fa-inbox"></i>Nothing here for these filters.</td></tr>`;
}

/**
 * The Sales Tracker's "Request" action. Step 1 asks WHAT to request — Raw
 * Material (for BOM items, raised as a Material Request with purpose Raw
 * Material) or Trade Items (plain lines, bought as-is) — each showing how
 * many records are short; step 2 lists exactly those records with their
 * qty, ticked and editable. Figures come from
 * order_flow_api.get_so_request_options, i.e. the Sales Order's own Item
 * Stock & Action Plan, so the prompt never disagrees with the Sales Order.
 */
function of_show_request_prompt(so, on_done) {
    frappe.call({
        method: 'erp_dacsinc_custom.order_flow_api.get_so_request_options',
        args: { sales_order: so }, freeze: true, freeze_message: __('Checking what is short…')
    }).then(r => {
        const opt = r.message || { rm: [], fg: [] };
        const n_rm = (opt.rm || []).length, n_fg = (opt.fg || []).length;
        if (!n_rm && !n_fg) {
            frappe.msgprint({ title: __('Nothing to request'), indicator: 'green',
                message: __('Everything on {0} is in stock, picked, or already on a Material Request / Purchase Order.', [so]) });
            return;
        }
        const pick = (kind) => of_show_request_list(so, opt, kind, on_done);
        if (!n_rm) return pick('fg');
        if (!n_fg) return pick('rm');
        const d = new frappe.ui.Dialog({
            title: __('What do you want to request? — {0}', [so]),
            fields: [{ fieldtype: 'HTML', fieldname: 'choice', options: `
                <div style="display:flex; gap:12px; flex-wrap:wrap;">
                    <button class="btn btn-default of-req-kind" data-kind="rm" style="flex:1; min-width:200px; padding:14px; text-align:left;">
                        <div style="font-weight:700;"><i class="fa fa-sitemap"></i> ${__('Raw Material (RM)')} · ${n_rm}</div>
                        <div class="text-muted" style="font-size:12px; white-space:normal;">${__('For BOM items — fabric, buttons… needed to make the finished goods.')}</div>
                    </button>
                    <button class="btn btn-default of-req-kind" data-kind="fg" style="flex:1; min-width:200px; padding:14px; text-align:left;">
                        <div style="font-weight:700;"><i class="fa fa-shopping-cart"></i> ${__('Trade Items (MR)')} · ${n_fg}</div>
                        <div class="text-muted" style="font-size:12px; white-space:normal;">${__('Items bought as they are — no BOM.')}</div>
                    </button>
                </div>` }]
        });
        d.$wrapper.on('click', '.of-req-kind', function () { d.hide(); pick($(this).data('kind')); });
        d.show();
    });
}

function of_show_request_list(so, opt, kind, on_done) {
    const rows = kind === 'rm' ? (opt.rm || []) : (opt.fg || []);
    const esc = (v) => frappe.utils.escape_html(v == null ? '' : String(v));
    const fmt = (n) => { const v = flt(n); return Math.abs(v - Math.round(v)) < 0.0005 ? String(Math.round(v)) : v.toFixed(2); };
    const body = rows.map((x, i) => `
        <tr>
            <td class="text-center"><input type="checkbox" class="of-req-pick" data-i="${i}" checked></td>
            <td><b>${esc(x.item_code)}</b>${x.item_name && x.item_name !== x.item_code ? `<div class="text-muted" style="font-size:11px;">${esc(x.item_name)}</div>` : ''}</td>
            <td style="font-size:11px;">${kind === 'rm'
                ? `${__('For')}: ${(x.needed_by || []).map(esc).join(', ')}`
                : `${__('Ordered')} ${fmt(x.ordered)}${flt(x.delivered) ? ` · ${__('delivered')} ${fmt(x.delivered)}` : ''}${flt(x.covered) ? ` · ${__('already on PO/MR')} ${fmt(x.covered)}` : ''}`}</td>
            <td style="width:120px;"><input type="number" class="form-control form-control-sm text-right of-req-qty" data-i="${i}"
                   value="${fmt(x.qty)}" min="0" max="${flt(x.qty)}" step="any"><div class="text-muted" style="font-size:10px; text-align:right;">${esc(x.uom)}</div></td>
        </tr>`).join('');
    const d = new frappe.ui.Dialog({
        title: kind === 'rm' ? __('Request Raw Material — {0}', [so]) : __('Raise MR for Trade Items — {0}', [so]),
        size: 'large',
        fields: [{ fieldtype: 'HTML', fieldname: 'list', options: `
            <div class="text-muted" style="font-size:12px; margin-bottom:8px;">${kind === 'rm'
                ? __('Short for this order — stock bought for other orders stays with them. One draft Material Request (purpose Raw Material) is created.')
                : __('Still to buy after stock, picks and existing PO/MR. One draft Material Request is created.')}</div>
            <table class="table table-sm table-bordered" style="font-size:12px;">
                <thead><tr class="bg-light"><th class="text-center" style="width:32px;"></th><th>${__('Item')}</th>
                    <th>${kind === 'rm' ? __('Needed For') : __('Why')}</th><th class="text-right">${__('Request Qty')}</th></tr></thead>
                <tbody>${body}</tbody></table>` }],
        primary_action_label: __('Create Material Request'),
        primary_action: () => {
            const items = []; let bad = false;
            d.$wrapper.find('.of-req-pick:checked').each((n, el) => {
                const i = $(el).data('i'), x = rows[i];
                const q = flt(d.$wrapper.find(`.of-req-qty[data-i="${i}"]`).val());
                // Never more than is short — the MR guard would refuse it anyway.
                if (!(q > 0) || q > flt(x.qty) + 0.0005) { bad = true; return; }
                const it = { item_code: x.item_code, qty: q, uom: x.uom, warehouse: x.warehouse || undefined };
                if (kind === 'rm') it.custom_procurement_purpose = 'Raw Material';
                items.push(it);
            });
            if (bad) { frappe.msgprint(__('Each ticked qty must be more than 0 and not more than what is short.')); return; }
            if (!items.length) { frappe.msgprint(__('Tick at least one item.')); return; }
            frappe.call({
                method: 'erp_dacsinc_custom.custom_script.create_material_request_custom',
                args: { items: items, company: opt.company, sales_order_name: so },
                freeze: true, freeze_message: __('Creating Material Request…')
            }).then(res => {
                if (!res.message) return;
                d.hide();
                window.open(frappe.utils.get_form_link('Material Request', res.message), '_blank');
                frappe.show_alert({ message: __('Material Request {0} created (Draft) — submit it.', [res.message]), indicator: 'green' }, 7);
                if (on_done) on_done();
            });
        }
    });
    d.show();
}


// Same flag + per-trip lines as the Sales Order's so_embroidery_history_html
// (kept in sync by hand — this page does not always have sales_order.js loaded).
function of_embroidery_history_html(hist) {
    hist = hist || [];
    if (!hist.length) return '';
    const sent = hist.reduce((a, t) => a + flt_of(t.sent), 0);
    const back = hist.reduce((a, t) => a + flt_of(t.received), 0);
    const out = Math.max(0, sent - back);
    const flag = out > 0.001
        ? `<span class="of-chip" style="background:#f3e8ff;color:#6b21a8;font-weight:600;"><i class="fa fa-magic"></i> ${__('Embroidery: sent {0} · back {1} · {2} at jobber', [of_round2(sent), of_round2(back), of_round2(out)])}</span>`
        : `<span class="of-chip" style="background:#dcfce7;color:#166534;font-weight:600;"><i class="fa fa-check"></i> ${__('Embroidery: sent {0} · all back', [of_round2(sent)])}</span>`;
    const lines = hist.map(t => `<div class="of-micro" style="margin-top:2px;">
            <b>${of_esc(t.ewo)}</b>
            ${t.jobber ? ` · ${of_esc(t.jobber)}` : ''}: ${__('sent')} ${of_round2(t.sent)} → ${__('back')} ${of_round2(t.received)}${flt_of(t.at_jobber) > 0.001 ? ` <b style="color:#6b21a8;">(${of_round2(t.at_jobber)} ${__('at jobber')})</b>` : ' ✓'}
            ${of_ewo_thumbs(t.attachments, t.ewo)}
        </div>`).join('');
    return `<div style="margin-top:4px;">${flag}${lines}</div>`;
}

// Attached images / files of an Embroidery Work Order, as thumbnails:
// up to 4 small squares (click = full size in a popup), "+N" for more,
// a paper-clip + name for non-image files. Data: so_embroidery.ewo_attachments.
function of_ewo_thumbs(atts, ewo) {
    atts = atts || [];
    if (!atts.length) return '';
    const e = (v) => frappe.utils.escape_html(v == null ? '' : String(v));
    const shown = atts.slice(0, 4);
    const more = atts.length - shown.length;
    return `<div class="ewo-thumbs" style="display:flex; flex-wrap:wrap; gap:4px; margin-top:4px; align-items:center;">
        ${shown.map(a => a.is_image
            ? `<a href="#" onclick="of_view_attachment('${encodeURI(a.file_url)}', '${e(ewo || '').replace(/'/g, "&#39;")}'); return false;"
                  title="${e(a.file_name)}" style="display:inline-block; width:32px; height:32px; border:1px solid var(--border-color, #d1d8dd); border-radius:4px; overflow:hidden; background:#fff;">
                   <img src="${encodeURI(a.file_url)}" loading="lazy" style="width:100%; height:100%; object-fit:cover; display:block;"></a>`
            : `<a href="${encodeURI(a.file_url)}" target="_blank" title="${e(a.file_name)}" style="font-size:11px; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">📎 ${e(a.file_name)}</a>`).join('')}
        ${more > 0 ? `<a href="#" data-atts="${encodeURIComponent(JSON.stringify(atts))}" onclick="of_ewo_gallery(this, '${e(ewo || '').replace(/'/g, "&#39;")}'); return false;" style="font-size:11px; font-weight:600;" title="${__('See all attachments')}">+${more}</a>` : ''}
    </div>`;
}
window.of_view_attachment = function (url, ewo) {
    const d = new frappe.ui.Dialog({
        title: ewo ? __('Embroidery — {0}', [ewo]) : __('Attachment'),
        size: 'large',
        fields: [{ fieldtype: 'HTML', options: `<div style="text-align:center;">
            <img src="${url}" style="max-width:100%; max-height:70vh; border-radius:4px;">
            <div style="margin-top:8px;"><a href="${url}" target="_blank"><i class="fa fa-external-link"></i> ${__('Open in new tab')}</a></div></div>` }]
    });
    d.show();
};
window.of_ewo_thumbs = of_ewo_thumbs;

// All attachments of one work order in a popup (the "+N" on the thumbnails).
window.of_ewo_gallery = function (el, ewo) {
    let atts = [];
    try { atts = JSON.parse(decodeURIComponent(el.getAttribute('data-atts') || '[]')); } catch (e) { atts = []; }
    const e = (v) => frappe.utils.escape_html(v == null ? '' : String(v));
    const d = new frappe.ui.Dialog({
        title: ewo ? __('Embroidery — {0}', [ewo]) : __('Attachments'),
        size: 'large',
        fields: [{ fieldtype: 'HTML', options: `<div style="display:flex; flex-wrap:wrap; gap:10px;">${atts.map(a => a.is_image
            ? `<a href="${encodeURI(a.file_url)}" target="_blank" title="${e(a.file_name)}"><img src="${encodeURI(a.file_url)}" style="width:160px; height:160px; object-fit:cover; border:1px solid #d1d8dd; border-radius:6px;"></a>`
            : `<a href="${encodeURI(a.file_url)}" target="_blank">📎 ${e(a.file_name)}</a>`).join('')}</div>` }]
    });
    d.show();
};
