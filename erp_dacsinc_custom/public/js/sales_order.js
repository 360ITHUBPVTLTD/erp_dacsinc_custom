// ================================================================
//  Sales Order — Client Script
//  File: erp_dacsinc_custom/public/js/sales_order.js
// ================================================================

// ================================================================
//  SECTION 1: FORM EVENT HANDLERS
// ================================================================

frappe.ui.form.on('Sales Order', {
    refresh: function (frm) {
        // --- Show Who Needs to Approve (Workflow Approver Indicator) ---
        if (!frm.is_new()) {
            frappe.call({
                method: 'erp_dacsinc_custom.order_flow_api.get_so_approvers',
                args: { sales_order: frm.doc.name }
            }).then(r => {
                const info = r.message;
                if (info) {
                    let html = '';
                    if (info.state === 'Pending Merchandiser Approval') {
                        if (info.merchandiser) {
                            html = `<div style="font-size: 13px; font-weight: 500; color: #721c24; background-color: #f8d7da; border-color: #f5c6cb; padding: 10px 14px; border-radius: 6px; border: 1px solid; margin-bottom: 15px;">
                                <i class="fa fa-info-circle"></i> ${__('Pending Merchandiser Approval. (Waiting for Merchandiser Approval: {0})', [info.merchandiser_fullname])}
                            </div>`;
                        } else {
                            html = `<div style="font-size: 13px; font-weight: 500; color: #856404; background-color: #fff3cd; border-color: #ffeeba; padding: 10px 14px; border-radius: 6px; border: 1px solid; margin-bottom: 15px;">
                                <i class="fa fa-exclamation-triangle"></i> ${__('Pending Merchandiser Approval. (Waiting for Merchandiser Approval - Unassigned)')}
                            </div>`;
                        }
                    } else if (info.state === 'Pending Final Approval') {
                        const list = info.final_approvers && info.final_approvers.length ? info.final_approvers.join(', ') : __('System Manager');
                        html = `<div style="font-size: 13px; font-weight: 500; color: #0c5460; background-color: #d1ecf1; border-color: #bee5eb; padding: 10px 14px; border-radius: 6px; border: 1px solid; margin-bottom: 15px;">
                            <i class="fa fa-info-circle"></i> ${__('Pending Final Approval. Allowed Approvers: {0}', [list])}
                        </div>`;

                        const is_final = info.final_users && info.final_users.includes(frappe.session.user);
                        const is_admin = frappe.user_roles.includes("System Manager") || frappe.session.user === "Administrator";
                        if (!is_final && !is_admin) {
                            if (frm.page.actions_btn_group) {
                                frm.page.actions_btn_group.hide();
                            }
                            frm.page.clear_actions_menu();
                        }
                    }

                    if (html) {
                        frm.dashboard.set_headline(html);
                    } else {
                        frm.dashboard.clear_headline();
                    }
                }
            });
        }

        // --- Remove unwanted standard "Create" buttons ---
        setTimeout(() => {
            frm.remove_custom_button('Maintenance Visit', 'Create');
            frm.remove_custom_button('Work Order', 'Create');
            frm.remove_custom_button('Purchase Order', 'Create');
            frm.remove_custom_button('Project', 'Create');
            frm.remove_custom_button('Payment Request', 'Create');
            frm.remove_custom_button('Request for Raw Materials', 'Create');
            frm.remove_custom_button('Pick List', 'Create');
            // frm.remove_custom_button('Material Request', 'Create');
            // frm.remove_custom_button('Delivery Note', 'Create');
            // frm.remove_custom_button('Sales Invoice', 'Create');
        }, 500);

        // --- Custom "Create Purchase Order" button (submitted docs only) ---
        if (frm.doc.docstatus === 1) {
            frm.add_custom_button(__('Create Purchase Order'), function () {
                frappe.new_doc('Purchase Order', {});
            }, __('Create'));
        }

        // --- Clear all custom HTML sections before re-rendering ---
        const custom_fields_to_clear = [
            'custom_delivery_note_html',
            'custom_sales_invoice_html',
            'custom_stock_reservation_html',
            'custom_available_quantity_html',
            'custom_material_request_html'
        ];
        custom_fields_to_clear.forEach(fieldname => {
            if (frm.fields_dict[fieldname]) {
                frm.fields_dict[fieldname].$wrapper.html('');
            }
        });

        // --- Reset cached stock data ---
        frm.custom_stock_data = {};

        // --- Render tables ---
        generate_stock_overview_table(frm);

        if (!frm.is_new()) {
            generate_procurement_table(frm);
            generate_delivery_note_table(frm);
            generate_sales_invoice_table(frm);
        }

        // --- Print Sales Order button ---
        frm.remove_custom_button(__('Print Sales Order'));
        if (!frm.is_new()) {
            frm.add_custom_button(__('Print Sales Order'), () => {
                window.open(
                    `/api/method/frappe.utils.print_format.download_pdf?doctype=Sales%20Order&name=${frm.doc.name}&format=Sales%20Order%20Print%20Format%203&letterhead=DAC%20Letter%20Header`
                );
            }).css({
                'background-color': '#6c757d',
                'color': '#FFFFFF',
                'border-color': '#6c757d'
            });
        }
    },

    items_add: function (frm) {
        generate_stock_overview_table(frm);
    },

    items_remove: function (frm) {
        generate_stock_overview_table(frm);
    }
});

frappe.ui.form.on('Sales Order Item', {
    item_code: function (frm) {
        setTimeout(() => generate_stock_overview_table(frm), 300);
    },
    qty: function (frm) {
        setTimeout(() => generate_stock_overview_table(frm), 300);
    },
    warehouse: function (frm) {
        setTimeout(() => generate_stock_overview_table(frm), 300);
    }
});


// ================================================================
//  SECTION 2: STYLES
//  Injected once into <head>.
//  Palette = the original widget colours, kept as named variables so
//  every status, number and header pulls from one place.
//  Surfaces / text / borders use Frappe tokens so dark mode follows.
// ================================================================

function inject_so_styles() {
    if (document.getElementById('so-design-system')) return;

    const style = document.createElement('style');
    style.id = 'so-design-system';
    style.textContent = `
        .so-card, .so-modal {
            --so-blue:   #3498DB;   /* headers, primary action */
            --so-blue-d: #2980b9;
            --so-info:   #007bff;   /* picked / delivered */
            --so-green:  #28a745;   /* available, covered */
            --so-teal:   #17a2b8;   /* completed */
            --so-orange: #fd7e14;   /* partial, held by others */
            --so-amber:  #ff9800;   /* awaiting stock */
            --so-red:    #dc3545;   /* shortfall, conflict */
            --so-purple: #6f42c1;   /* planned, subcontract */
            --so-gray:   #6c757d;   /* draft */
        }

        /* ── Card ────────────────────────────────────────────────── */
        .so-card {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            margin-bottom: 18px;
            overflow: hidden;
        }
        .so-card__head {
            display: flex; align-items: center; justify-content: space-between;
            gap: 12px; flex-wrap: wrap; padding: 12px 14px;
            border-bottom: 1px solid var(--border-color);
        }
        .so-card__title { margin: 0; font-size: 14px; font-weight: 600; color: var(--heading-color); }
        .so-card__sub { display: block; font-size: 11px; color: var(--text-muted); margin-top: 2px; font-weight: 400; }
        .so-card__actions { display: flex; align-items: center; gap: 8px; }
        .so-scroll { overflow-x: auto; }
        /* Card that holds stat tiles + sections rather than a single full-bleed table */
        .so-card--padded { padding: 12px; }
        .so-card--padded .so-modal__section { margin-top: 16px; }
        .so-card--padded .so-modal__section:first-of-type { margin-top: 0; }

        .so-section { margin-top: 18px; }
        .so-section__title {
            display: flex; align-items: center; gap: 7px;
            font-size: 13px; font-weight: 600; color: var(--heading-color); margin: 0 0 8px 0;
        }

        /* ── Buttons ─────────────────────────────────────────────── */
        .so-btn {
            display: inline-flex; align-items: center; gap: 5px;
            font-size: 11px; font-weight: 500; line-height: 1; white-space: nowrap;
            padding: 6px 10px; border-radius: 4px; cursor: pointer;
            border: 1px solid var(--border-color);
            background: var(--control-bg); color: var(--text-color);
        }
        .so-btn:hover:not(:disabled) { background: var(--fg-hover-color, var(--subtle-fg)); color: var(--text-color); }
        .so-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .so-btn--primary { background: var(--so-blue); border-color: var(--so-blue-d); color: #fff; }
        .so-btn--primary:hover:not(:disabled) { background: var(--so-blue-d); color: #fff; }
        /* Small "View" button — one control for every detail popup. */
        .so-btn--view {
            padding: 3px 9px; font-size: 11px; color: var(--so-info);
            border-color: var(--border-color); background: var(--card-bg);
        }
        .so-btn--view:hover:not(:disabled) { background: var(--so-blue); border-color: var(--so-blue-d); color: #fff; }

        /* ── Table: full grid, centred columns; only the first column is left-aligned ── */
        .so-table { width: 100%; border-collapse: collapse; font-size: 12px; color: var(--text-color); margin-top: 5px; }
        .so-table th {
            background: var(--so-blue); color: #fff;
            font-size: 11px; font-weight: 600;
            padding: 8px 10px; text-align: center;
            border: 1px solid #2980b9;
        }
        .so-table td {
            padding: 6px 8px; text-align: center; vertical-align: middle;
            border: 1px solid #d1d8dd;
        }
        [data-theme="dark"] .so-table td {
            border: 1px solid #434c56;
        }
        .so-table th:first-child, .so-table td:first-child { text-align: left; }
        .so-table tbody tr:hover td { background: var(--subtle-fg); }
        .so-table tfoot td { background: var(--subtle-fg); font-weight: 600; font-size: 11px; }
        /* The item a details modal was opened for, singled out in a list of
           its Pick List siblings so it never reads as just another row. */
        .so-table tr.is-highlighted td { background: rgba(52, 152, 219, 0.12); }
        .so-table .so-num { text-align: right; }   /* totals rows only */
        /* An open RM detail row belongs to the row above — drop the divider between
           them. A collapsed row keeps its border so the grid stays intact. */
        .so-table--rows tbody tr.so-row-main.is-open td { border-bottom-color: transparent; }

        /* ── Expand / collapse ───────────────────────────────────── */
        .so-row-main.is-toggleable { cursor: pointer; }
        .so-row-main.is-toggleable:hover td { background: var(--subtle-fg); }
        .so-caret {
            color: var(--text-light); font-size: 12px; margin-right: 4px;
            transition: transform 0.15s ease; display: inline-block;
        }
        .so-row-main.is-open .so-caret { transform: rotate(90deg); color: var(--so-blue); }

        /* ── Search ──────────────────────────────────────────────── */
        .so-search {
            display: inline-flex; align-items: center; gap: 6px;
            border: 1px solid var(--border-color); border-radius: 4px;
            background: var(--card-bg); padding: 0 8px; height: 28px;
        }
        .so-search:focus-within { border-color: var(--so-blue); box-shadow: 0 0 0 2px rgba(52,152,219,0.18); }
        .so-search .fa { color: var(--text-light); font-size: 11px; }
        .so-search input {
            border: none; outline: none; background: none; color: var(--text-color);
            font-size: 12px; width: 190px; height: 100%; padding: 0;
        }
        .so-search input::placeholder { color: var(--text-light); }

        /* ── Numbers ─────────────────────────────────────────────── */
        .so-val { font-size: 13px; font-weight: 700; line-height: 1.3; font-variant-numeric: tabular-nums; }
        .so-val--lg   { font-size: 15px; }
        .so-val--zero { font-weight: 400; color: var(--text-light); }
        .so-val--pos  { color: var(--so-green); }
        .so-val--info { color: var(--so-info); }
        .so-val--warn { color: var(--so-orange); }
        .so-val--bad  { color: var(--so-red); }

        /* ── Text ────────────────────────────────────────────────── */
        .so-meta  { font-size: 11px; color: var(--text-muted); line-height: 1.4; }
        .so-micro { font-size: 11px; color: var(--text-light); line-height: 1.4; }
        .so-truncate { max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0 auto; }
        a.so-truncate { display: inline-block; vertical-align: bottom; max-width: 100%; }
        td:first-child .so-truncate { margin: 0; }
        .so-stack > * + * { margin-top: 4px; }
        .so-link { color: var(--so-info); font-weight: 500; text-decoration: none; }
        .so-link:hover { color: var(--so-blue-d); text-decoration: underline; }
        /* #007bff is too dark on the dark theme's near-black surfaces */
        [data-theme="dark"] .so-card, [data-theme="dark"] .so-modal { --so-info: #5aa9f8; }

        /* ── Chips ───────────────────────────────────────────────── */
        .so-chip {
            display: inline-block; font-size: 10px; font-weight: 600; line-height: 1.5;
            padding: 1px 6px; border-radius: 3px; white-space: nowrap; text-decoration: none;
            max-width: 100%; overflow: hidden; text-overflow: ellipsis; vertical-align: middle;
        }
        .so-chip + .so-chip { margin-left: 4px; }
        .so-chip--bom  { background: var(--so-blue) !important; color: #fff !important; }
        a.so-chip--bom:hover { background: var(--so-blue-d) !important; color: #fff !important; }
        .so-chip--sc   { background: var(--so-purple) !important; color: #fff !important; }
        .so-chip--ok   { border: 1px solid var(--so-green);  color: var(--so-green); }
        .so-chip--warn { border: 1px solid var(--so-orange); color: var(--so-orange); }
        .so-chip--bad  { border: 1px solid var(--so-red);    color: var(--so-red); }

        /* ── Status pill: solid fill, white text (as before) ─────── */
        .so-pill {
            display: inline-block; font-size: 11px; font-weight: 600; line-height: 1.4;
            padding: 3px 10px; border-radius: 12px; color: #fff;
            /* Wrap on word boundaries only — never nowrap (cuts off long
               labels) and never word-break:break-word (splits a single word
               like "Received" into "Rece"/"ived"). */
            white-space: normal;
            max-width: 100%;
        }
        /* A pill sitting directly against a following note/chip on the same
           line (no whitespace in the source) must not read as glued together. */
        .so-pill + .so-chip, .so-pill + .so-micro { margin-left: 6px; }
        .so-pill--done    { background: var(--so-teal); }
        .so-pill--ready   { background: var(--so-green); }
        .so-pill--dn      { background: var(--so-info); }
        .so-pill--partial { background: var(--so-orange); }
        .so-pill--wait    { background: var(--so-amber); }
        .so-pill--draft   { background: var(--so-gray); }
        .so-pill--blocked { background: var(--so-red); }
        .so-pill--planned { background: var(--so-purple); }

        /* ── Next action ─────────────────────────────────────────── */
        .so-action { display: flex; flex-direction: column; gap: 6px; align-items: center; }
        .so-action__note { font-size: 11px; color: var(--text-muted); }
        .so-shortfall { font-size: 12px; font-weight: 700; color: var(--so-red); }

        /* ── Cell breakdown (POs / EWOs) ─────────────────────────── */
        .so-brk { font-size: 11px; line-height: 1.5; }
        .so-brk__label { font-weight: 600; color: var(--text-color); }
        .so-brk__sub { color: var(--text-muted); }
        .so-brk + .so-brk { margin-top: 6px; }

        /* ── Nested RM pipeline: fills the row, marked by a left accent ── */
        .so-rm-row > td { padding: 0 !important; }
        .so-rm { border-left: 3px solid var(--so-blue); }
        .so-rm__head {
            display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
            padding: 8px 12px; background: var(--subtle-fg);
        }
        .so-rm__title { font-size: 12px; font-weight: 600; color: var(--so-blue); }
        .so-rm__spacer { flex: 1 1 auto; }
        .so-rm__note { font-size: 11px; color: var(--text-muted); }
        .so-rm__head .so-chip { max-width: 240px; }
        .so-rm table { width: 100%; border-collapse: collapse; font-size: 12px; }
        /* Grey header, not a second blue bar — one blue header per card. */
        .so-rm th {
            background: var(--subtle-fg); color: var(--text-muted);
            font-size: 12px; font-weight: 600;
            padding: 8px; text-align: center;
            border: 1px solid var(--border-color);
        }
        .so-rm td { padding: 8px; text-align: center; vertical-align: middle; border: 1px solid var(--border-color); }
        .so-rm th:first-child, .so-rm td:first-child { text-align: left; }

        /* ── Modal ───────────────────────────────────────────────── */
        .so-modal { font-size: 13px; color: var(--text-color); }
        .so-modal__lead { font-size: 12px; color: var(--text-muted); margin: 0 0 14px 0; }
        .so-stats {
            display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
            border: 1px solid var(--border-color); border-radius: 6px;
            overflow: hidden; margin-bottom: 16px;
        }
        .so-stat { padding: 10px 12px; border-right: 1px solid var(--border-color); }
        .so-stat:last-child { border-right: none; }
        .so-stat__label { display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 3px; }
        .so-stat__value { font-size: 18px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
        .so-stat__unit { font-size: 11px; font-weight: 400; color: var(--text-muted); margin-left: 3px; }
        .so-modal__section { margin-top: 18px; }
        .so-modal__section:first-child { margin-top: 0; }
        .so-modal__h {
            font-size: 12px; font-weight: 600; color: var(--heading-color); margin-bottom: 8px;
        }
        .so-modal__h small { font-weight: 400; color: var(--text-muted); font-size: 11px; margin-left: 6px; }
        .so-modal .so-table { border: 1px solid var(--border-color); }
        .so-hint { font-size: 11px; color: var(--text-muted); margin: 12px 0 0 0; }
        /* Editable quantity on a draft Pick List row */
        .so-qty-in {
            width: 80px; padding: 4px 6px; text-align: right;
            font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums;
            border: 1px solid var(--so-blue); border-radius: 4px;
            background: var(--card-bg); color: var(--text-color);
        }
        .so-qty-in:focus { outline: none; box-shadow: 0 0 0 2px rgba(52,152,219,0.25); }

        /* ── Empty states ────────────────────────────────────────── */
        .so-empty { padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 12px; }
        .so-empty--sm { padding: 12px 0; text-align: left; }
    `;
    document.head.appendChild(style);
}


// ================================================================
//  SECTION 3: STOCK OVERVIEW TABLE
// ================================================================

function generate_stock_overview_table(frm, callback) {
    // Called from async command callbacks too, by which time the user may have
    // navigated away — never assume a live Sales Order form is still mounted.
    if (!frm || !frm.fields_dict || !frm.doc) return;

    const container = frm.fields_dict['custom_available_quantity_html']?.$wrapper;
    if (!container || !container.length) return;

    inject_so_styles();

    // Show placeholder for new unsaved docs
    if (frm.is_new()) {
        container.html(`
            <div class="so-card">
                <div class="so-card__head">
                    <h4 class="so-card__title">Item Stock &amp; Action Plan</h4>
                </div>
                <div class="so-empty">
                    <i class="fa fa-save"></i>
                    Save the Sales Order to Enable Real-Time Stock Tracking.
                </div>
            </div>
        `);
        return;
    }

    // Render skeleton
    container.html(`
        <div class="so-card">
            <div class="so-card__head">
                <div>
                    <h4 class="so-card__title">Item Stock &amp; Action Plan</h4>
                    <span class="so-card__sub">Real-Time Availability and Procurement Status</span>
                </div>
                <div class="so-card__actions">
                    <span class="so-search">
                        <i class="fa fa-search"></i>
                        <input type="search" id="so-item-search" autocomplete="off"
                               placeholder="Search Item, Status, Supplier…">
                    </span>
                    <span class="so-micro" id="so-search-count"></span>
                    <button class="so-btn" id="btn-refresh-stock-table">
                        <i class="fa fa-refresh"></i> Refresh
                    </button>
                    <span id="bulk-pick-action-btn"></span>
                </div>
            </div>
            <div class="so-scroll">
                <table class="so-table so-table--rows">
                    <thead>
                        <tr>
                            <th style="width:18%; min-width:190px;">Item</th>
                            <th style="width:7%;">Required</th>
                            <th style="width:7%;">Delivered</th>
                            <th style="width:11%;">Available Stock</th>
                            <th style="width:13%;" title="Pending Purchase Orders, Embroidery Work Orders and Material Requests">Incoming</th>
                            <th style="width:9%;">Picked (This SO)</th>
                            <th style="width:11%;">Picked (Others)</th>
                            <th style="width:11%;">Status</th>
                            <th style="width:15%; min-width:150px;">Next Action</th>
                        </tr>
                    </thead>
                    <tbody id="stock-tbody">
                        <tr><td colspan="9" class="so-empty">
                            <i class="fa fa-spinner fa-spin"></i> Loading Stock Data…
                        </td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `);

    // Wire up refresh button
    container.find('#btn-refresh-stock-table').on('click', () => generate_stock_overview_table(frm));

    const items = (frm.doc.items || []).filter(i => i.item_code);
    const tbody = container.find('#stock-tbody');

    if (!items.length) {
        tbody.html('<tr><td colspan="9" class="text-center text-muted" style="padding:20px;">Add Items to See Their Stock Status.</td></tr>');
        return;
    }

    // Build item_bom_pairs exactly as the Python API expects: "ITEM_CODE||bom_no_or_no_bom"
    const item_bom_pairs = items.map(i => `${i.item_code}||${i.bom_no || 'no_bom'}`);

    frappe.call({
        method: 'erp_dacsinc_custom.custom_script.get_item_stock_details_bulk',
        args: {
            item_bom_pairs: item_bom_pairs,
            sales_order_name: frm.doc.name
        },
        callback: (r) => {
            if (!r.message) {
                tbody.html('<tr><td colspan="9" class="text-center text-danger" style="padding:20px;">Error Loading Stock Details.</td></tr>');
                return;
            }

            const dataMap = r.message;
            frm.custom_stock_data = dataMap;

            let eligible_for_picking = false;
            let bulk_eligible_items = {};

            const rows_html = items.map(item => {
                // The API key is "ITEM_CODE||bom_or_no_bom"
                const pair_key = `${item.item_code}||${item.bom_no || 'no_bom'}`;
                const d = dataMap[pair_key];
                if (!d) return '';

                // ── BOM chip: compact pill, full ID on hover ──────────
                const bom_no = d.bom_no || item.bom_no || '';
                const bom_chip = d.is_bom_item
                    ? `<a class="so-chip so-chip--bom" href="/app/bom/${encodeURIComponent(bom_no)}"
                          target="_blank" title="Open BOM ${esc(bom_no)}">
                           <i class="fa fa-sitemap"></i> BOM</a>`
                    : '';

                const _build_dn_si_row_links = (d) => {
                    let html = '';
                    if (d.row_dns && d.row_dns.length) {
                        const drafts = d.row_dns.filter(x => x.docstatus === 0);
                        const subms = d.row_dns.filter(x => x.docstatus === 1);
                        if (drafts.length) {
                            const links = drafts.map(x => `<a href="/app/delivery-note/${encodeURIComponent(x.parent)}" target="_blank" title="Draft Delivery Note: ${esc(x.parent)}"><b>${esc(x.parent.substring(x.parent.lastIndexOf('-') + 1))}</b></a>`).join(', ');
                            html += `<div class="so-micro" style="margin-top:2px; color:var(--so-orange);"><i class="fa fa-truck"></i> Draft: ${links}</div>`;
                        }
                        if (subms.length) {
                            const links = subms.map(x => `<a href="/app/delivery-note/${encodeURIComponent(x.parent)}" target="_blank" title="Delivery Note: ${esc(x.parent)}"><b>${esc(x.parent.substring(x.parent.lastIndexOf('-') + 1))}</b></a>`).join(', ');
                            html += `<div class="so-micro" style="margin-top:2px; color:var(--so-green);"><i class="fa fa-truck"></i> DN: ${links}</div>`;
                        }
                    }
                    if (d.row_sis && d.row_sis.length) {
                        const drafts = d.row_sis.filter(x => x.docstatus === 0);
                        const subms = d.row_sis.filter(x => x.docstatus === 1);
                        if (drafts.length) {
                            const links = drafts.map(x => `<a href="/app/sales-invoice/${encodeURIComponent(x.parent)}" target="_blank" title="Draft Sales Invoice: ${esc(x.parent)}"><b>${esc(x.parent.substring(x.parent.lastIndexOf('-') + 1))}</b></a>`).join(', ');
                            html += `<div class="so-micro" style="margin-top:2px; color:var(--so-orange);"><i class="fa fa-file-text-o"></i> Draft: ${links}</div>`;
                        }
                        if (subms.length) {
                            const links = subms.map(x => `<a href="/app/sales-invoice/${encodeURIComponent(x.parent)}" target="_blank" title="Sales Invoice: ${esc(x.parent)}"><b>${esc(x.parent.substring(x.parent.lastIndexOf('-') + 1))}</b></a>`).join(', ');
                            html += `<div class="so-micro" style="margin-top:2px; color:var(--so-green);"><i class="fa fa-file-text-o"></i> SI: ${links}</div>`;
                        }
                    }
                    return html;
                };

                // ── Qty calculations ──────────────────────────────────
                const required = d.required_qty || 0;
                const delivered = d.delivered_qty || 0;
                const picked_submitted_undeliv = d.picked_submitted_undelivered_qty || 0;
                const picked_draft_so = d.picked_draft_qty_so || 0;
                const picked_for_others = d.picked_for_others_qty || 0;
                const draft_for_others = d.draft_qty_for_others || 0;
                const picked_submitted_other_rows = d.picked_submitted_other_rows || 0;
                const picked_draft_other_rows = d.picked_draft_other_rows || 0;
                const total_actual_stock = d.total_available_stock || 0;

                const all_reservation = picked_submitted_undeliv + picked_draft_so + picked_for_others + draft_for_others
                    + picked_submitted_other_rows + picked_draft_other_rows;
                const truly_available_stock = Math.max(0, total_actual_stock - all_reservation);

                const total_committed_pipeline = delivered + picked_submitted_undeliv;
                const total_planned_pipeline = total_committed_pipeline + picked_draft_so;
                const remaining_to_plan = required - total_planned_pipeline;
                const needed_stock_qty = remaining_to_plan;
                const can_fulfill_qty = Math.min(needed_stock_qty, truly_available_stock);
                const shortage_qty = Math.max(0, needed_stock_qty - truly_available_stock);

                // ── Bulk pick eligibility ─────────────────────────────
                if (frm.doc.docstatus === 1 && can_fulfill_qty > 0) {
                    const line_unpicked = item.qty - (item.delivered_qty || 0);
                    if (!bulk_eligible_items[item.item_code]) {
                        bulk_eligible_items[item.item_code] = {
                            item_code: item.item_code,
                            warehouse: item.warehouse || frm.doc.set_warehouse,
                            stock_uom: item.stock_uom,
                            total_eligible_pick_qty: 0,
                            so_lines: []
                        };
                    }
                    bulk_eligible_items[item.item_code].total_eligible_pick_qty += can_fulfill_qty;
                    if (line_unpicked > 0) {
                        bulk_eligible_items[item.item_code].so_lines.push({
                            so_item_name: item.name,
                            line_qty: item.qty,
                            delivered_qty: item.delivered_qty,
                            unpicked_qty: line_unpicked
                        });
                    }
                    eligible_for_picking = true;
                }

                // ── Status & Action HTML ──────────────────────────────
                // Every state offers the command that moves the line forward.
                const picks = d.picked_for_this_so_details || [];
                const draft_pl = (picks.find(p => flt(p.docstatus) === 0) || {}).pick_list_name || '';
                const subm_pl = (picks.find(p => flt(p.docstatus) === 1) || {}).pick_list_name || '';
                const so_nm = js_str(frm.doc.name);
                const ic_arg = js_str(item.item_code);
                const submitted = frm.doc.docstatus === 1;

                let status_html = '';
                let action_parts = [];

                // A Delivery Note raised straight off the Sales Order does not close the
                // Pick List, so the line can be delivered while a pick is still open.
                const stale_qty = flt(d.stale_pick_qty || 0);
                const stale_pl = ((d.stale_pick_lists || [])[0] || {}).pick_list_name || '';
                // Stock held by a Pick List belonging to an order that is already
                // delivered — ERPNext keeps it reserved, so picking here will fail.
                const stale_blocked = flt(d.stale_blocked_qty || 0);

                if (delivered >= required && required > 0) {
                    // Fully delivered — nothing left to do on this line.
                    status_html = so_pill('done', 'check-circle', 'Completed');
                    if (stale_qty > 0 && stale_pl) {
                        status_html += `<div class="so-micro" style="margin-top:4px;color:var(--so-orange);">
                            Pick List still open (${stale_qty})</div>`;
                        action_parts.push(so_cmd_btn(`so_open_doc('Pick List','${js_str(stale_pl)}')`, 'external-link', 'Close Pick List', true));
                    }

                } else if (picked_submitted_undeliv >= (required - delivered)) {
                    // Fully picked → the next command is either a Delivery Note or a
                    // direct Sales Invoice with Update Stock — whichever route this
                    // Sales Order isn't already locked out of (so_route_lock).
                    status_html = so_pill('dn', 'cube', 'Ready for DN / SI');
                    if (subm_pl) {
                        action_parts.push(so_cmd_btn(
                            `so_prompt_dn_or_si('${so_nm}','${js_str(item.name)}','${ic_arg}','${js_str(subm_pl)}',${flt(picked_submitted_undeliv)},'${d.so_route_lock || ''}')`,
                            'truck', 'Waiting for DN / SI', true));
                        action_parts.push(so_cmd_btn(`so_open_doc('Pick List','${js_str(subm_pl)}')`, 'external-link', 'Open Pick List'));
                    } else {
                        action_parts.push(`<span class="so-action__note">Proceed from Pick List</span>`);
                    }

                } else if (picked_draft_so > 0) {
                    // Draft pick list exists → submit it.
                    status_html = so_pill('draft', 'clock-o', 'Awaiting Pick');
                    if (draft_pl) {
                        action_parts.push(so_cmd_btn(`so_confirm_submit_pick_list('${js_str(draft_pl)}')`, 'check', 'Submit Pick List', true));
                        action_parts.push(so_cmd_btn(`so_open_doc('Pick List','${js_str(draft_pl)}')`, 'external-link', 'Open Pick List'));
                    }

                    if (can_fulfill_qty > 0 && needed_stock_qty > 0) {
                        const line_unpicked = item.qty - (item.delivered_qty || 0);
                        const line_pick_qty = Math.min(can_fulfill_qty, line_unpicked);
                        if (line_pick_qty > 0) {
                            status_html += `<div class="so-micro" style="margin-top:4px;">+${flt(line_pick_qty)} More Available</div>`;
                            if (submitted) {
                                const bd = _build_pick_btn_data(item, line_pick_qty, frm, d);
                                action_parts.push(`<button class="so-btn" onclick="create_pick_list_for_item(${bd})"><i class="fa fa-plus"></i> Pick ${flt(line_pick_qty)} more</button>`);
                            }
                        }
                    }
                    if (needed_stock_qty > 0 && shortage_qty > 0) {
                        action_parts.push(so_shortfall(shortage_qty));
                    }

                } else if (needed_stock_qty > 0) {
                    // Still needs picking
                    if (truly_available_stock > 0) {
                        const line_unpicked = item.qty - (item.delivered_qty || 0);
                        const line_pick_qty = Math.min(can_fulfill_qty, line_unpicked);

                        status_html = (truly_available_stock < needed_stock_qty)
                            ? so_pill('partial', 'adjust', 'Partial Stock')
                            : so_pill('ready', 'check', 'Ready to Pick');

                        if (line_pick_qty > 0) {
                            if (submitted) {
                                if (stale_blocked > 0) {
                                    // ERPNext will refuse to allocate: a stale Pick List still
                                    // reserves this stock. Offer the repair, not a doomed Pick.
                                    action_parts.push(so_cmd_btn(`so_fix_stale_pick_lists('${ic_arg}')`,
                                        'wrench', 'Fix Stale Pick Lists', true));
                                    action_parts.push(`<span class="so-action__note">${flt(stale_blocked)} Held by a Closed Order</span>`);
                                } else {
                                    const bd = _build_pick_btn_data(item, line_pick_qty, frm, d);
                                    action_parts.push(`<button class="so-btn so-btn--primary" onclick="create_pick_list_for_item(${bd})"><i class="fa fa-hand-paper-o"></i> Pick ${flt(line_pick_qty)}</button>`);
                                }
                            } else {
                                action_parts.push(`<span class="so-action__note">Submit the SO to Enable Picking</span>`);
                            }
                        } else {
                            action_parts.push(`<span class="so-action__note">Line Fulfilled / Planned</span>`);
                        }
                        if (shortage_qty > 0) {
                            action_parts.push(so_shortfall(shortage_qty));
                            if (submitted) action_parts.push(so_buy_btn(d, so_nm, ic_arg, shortage_qty));
                        }

                    } else {
                        // No stock at all
                        if (picked_for_others > 0 || draft_for_others > 0) {
                            status_html = so_pill('blocked', 'lock', 'Allocation Conflict');
                            action_parts.push(so_cmd_btn(`show_picked_others_details_modal('${js_str(pair_key)}')`, 'eye', 'View', true));
                            if (submitted) action_parts.push(so_buy_btn(d, so_nm, ic_arg, needed_stock_qty));
                        } else {
                            const has_incoming = (flt(d.total_incoming_qty) > 0
                                || flt(d.total_incoming_po_count) > 0
                                || flt(d.total_incoming_ewo_count) > 0);
                            const mr_open = flt(d.total_mr_pending_qty || 0);
                            const open_mr = (d.material_requests || [])
                                .find(m => flt(m.pending_qty) > 0) || {};

                            status_html = has_incoming
                                ? so_pill('wait', 'truck', 'Awaiting Stock')
                                : (mr_open > 0
                                    ? so_pill('planned', 'file-text-o', 'Requested')
                                    : so_pill('blocked', 'exclamation-triangle', 'Out of Stock'));
                            action_parts.push(so_shortfall(needed_stock_qty));

                            if (has_incoming) {
                                // Stock is on its way — the command is to track it.
                                action_parts.push(so_cmd_btn(`show_details_modal('${js_str(pair_key)}','incoming_docs')`, 'eye', 'Track Incoming', true));
                                if (mr_open > 0 && open_mr.name) {
                                    action_parts.push(so_cmd_btn(`so_make_po_from_mr('${js_str(open_mr.name)}')`, 'shopping-cart', `Order ${flt(mr_open)} on MR`));
                                }
                            } else if (mr_open > 0 && open_mr.name) {
                                // An MR already exists — the next step is to order against
                                // it, not to raise a second request for the same shortfall.
                                status_html += `<div class="so-micro" style="margin-top:4px;">MR ${esc(open_mr.name)}</div>`;
                                if (submitted) {
                                    action_parts.push(so_cmd_btn(`so_make_po_from_mr('${js_str(open_mr.name)}')`, 'shopping-cart', 'Order from MR', true));
                                    action_parts.push(so_cmd_btn(`so_open_doc('Material Request','${js_str(open_mr.name)}')`, 'external-link', 'Open MR'));
                                }
                            } else if (submitted) {
                                action_parts.push(so_buy_btn(d, so_nm, ic_arg, needed_stock_qty, true));
                                if (!d.is_bom_item) {
                                    action_parts.push(so_cmd_btn(`so_make_material_request('${so_nm}')`, 'file-text-o', 'Material Request'));
                                }
                            }
                        }
                    }

                } else {
                    // Fully planned → open the pick list that covers it.
                    status_html = so_pill('planned', 'star', 'Fully Planned');
                    const pl = subm_pl || draft_pl;
                    if (pl) {
                        action_parts.push(so_cmd_btn(`so_open_doc('Pick List','${js_str(pl)}')`, 'external-link', 'Open Pick List', true));
                        if (subm_pl) {
                            action_parts.push(so_cmd_btn(
                                `so_prompt_dn_or_si('${so_nm}','${js_str(item.name)}','${ic_arg}','${js_str(subm_pl)}',${flt(picked_submitted_undeliv)},'${d.so_route_lock || ''}')`,
                                'truck', 'Waiting for DN / SI'));
                        }
                    } else {
                        action_parts.push(`<span class="so-action__note">Proceed from Pick List</span>`);
                    }
                }

                const action_html = action_parts.length
                    ? `<div class="so-action">${action_parts.join('')}</div>`
                    : `<span class="so-action__note">—</span>`;

                // ── Incoming PO cell ──────────────────────────────────
                const incoming_html = _build_incoming_html(item, d, pair_key);

                // ── Available stock cell ──────────────────────────────
                const is_subcon_rcpt = (d.completed_receipt_docs || []).some(doc => flt(doc.is_subcontracted) === 1);
                let avail_html = `<div class="so-stack">`
                    + so_qty(total_actual_stock, total_actual_stock > 0 ? 'pos' : null, 'lg');

                if ((d.received_for_so_qty || 0) > 0) {
                    avail_html += `<div class="so-micro">
                        ${flt(d.received_for_so_qty)} For This SO
                        ${is_subcon_rcpt ? `<span class="so-chip so-chip--sc" title="Includes subcontracted receipts">SC</span>` : ''}
                        · ${flt(d.general_stock_qty || 0)} General
                    </div>`;
                }
                // Name the warehouse holding the biggest chunk so the number has context.
                const top_wh = (d.warehouse_stock || [])[0];
                if (top_wh && top_wh.warehouse) {
                    const extra_wh = (d.warehouse_stock || []).length - 1;
                    avail_html += `<div class="so-micro" title="Largest stocking warehouse">
                        ${esc(top_wh.warehouse)}${extra_wh > 0 ? ` +${extra_wh}` : ''}
                    </div>`;
                }
                if ((d.warehouse_stock || []).length > 0 || (d.completed_receipt_docs || []).length > 0) {
                    avail_html += `<button class="so-btn so-btn--view" onclick="show_details_modal('${js_str(pair_key)}','stock_details')"><i class="fa fa-eye"></i> View</button>`;
                }
                avail_html += `</div>`;

                // ── Picked (This SO) cell ─────────────────────────────
                const picked_sub_so = flt(d.picked_submitted_qty_so_actual || 0);
                const draft_shown = flt(d.picked_draft_qty_raw !== undefined
                    ? d.picked_draft_qty_raw : picked_draft_so);
                const pick_rows = d.picked_for_this_so_details || [];

                let picked_html = `<div class="so-stack">`
                    + so_qty(picked_sub_so, picked_sub_so > 0 ? 'info' : null);
                if (draft_shown > 0) {
                    // Spell out that a draft exists — a bare "0" hid the fact that a
                    // Pick List had already been raised against this order.
                    picked_html += `<div class="so-micro" style="color:var(--so-orange);">
                        ${draft_shown} In Draft</div>`;
                }
                if (flt(d.stale_pick_qty || 0) > 0) {
                    picked_html += `<div class="so-micro" style="color:var(--so-orange);"
                        title="Delivered without going through this Pick List — it is still open">
                        ${flt(d.stale_pick_qty)} Already Delivered</div>`;
                }
                if (pick_rows.length > 0) {
                    picked_html += `<div class="so-micro">${pick_rows.length} Pick List${pick_rows.length === 1 ? '' : 's'}</div>`;
                    picked_html += `<button class="so-btn so-btn--view" onclick="show_details_modal('${js_str(pair_key)}','picked')"><i class="fa fa-eye"></i> View</button>`;
                }
                picked_html += `</div>`;

                // ── Picked (Others) cell ──────────────────────────────
                const total_others = flt(picked_for_others) + flt(draft_for_others);
                let picked_others_html = `<div class="so-stack">`
                    + so_qty(total_others, total_others > 0 ? 'warn' : null);
                if (total_others > 0) {
                    const split = [];
                    if (flt(picked_for_others) > 0) split.push(`${flt(picked_for_others)} Submitted`);
                    if (flt(draft_for_others) > 0) split.push(`${flt(draft_for_others)} Draft`);
                    picked_others_html += `<div class="so-micro">${split.join(' · ')}</div>`;
                }
                if (Array.isArray(d.conflict_details) && d.conflict_details.length > 0) {
                    // Name the blocking orders inline — a bare count forces a click.
                    const blockers = [...new Set(d.conflict_details
                        .map(c => c.so_customer_name || c.customer_name || c.sales_order)
                        .filter(Boolean))];
                    if (blockers.length) {
                        picked_others_html += `<div class="so-meta so-truncate" style="max-width:140px;" title="${esc(blockers.join(', '))}">
                            ${esc(blockers[0])}${blockers.length > 1 ? ` +${blockers.length - 1}` : ''}
                        </div>`;
                    }
                    picked_others_html += `<button class="so-btn so-btn--view" onclick="show_picked_others_details_modal('${js_str(pair_key)}')"><i class="fa fa-eye"></i> View</button>`;
                }
                picked_others_html += `</div>`;

                // ── Final row HTML ────────────────────────────────────
                // The item name repeats the code in this dataset — only show it when it adds something.
                const item_name = item.item_name || d.item_name || '';
                const show_name = item_name && item_name !== item.item_code;
                const rm_row_html = get_rm_breakdown_html(d, frm.doc.name, frm.doc.docstatus);

                // Rows with a Raw Material pipeline collapse by default; clicking
                // anywhere on the row opens it.
                const main_row = `
                    <tr class="so-row-main${rm_row_html ? ' is-toggleable' : ''}">
                        <td>
                            <div class="so-stack">
                                <div>
                                    ${rm_row_html
                        ? `<i class="fa fa-caret-right so-caret" title="Show raw materials"></i>`
                        : ''}
                                    <a class="so-link" href="/app/item/${encodeURIComponent(item.item_code)}" target="_blank"
                                       title="Item: ${esc(item.item_code)}">${esc(item.item_code)}</a>
                                </div>
                                ${show_name ? `<div class="so-meta so-truncate" title="${esc(item_name)}">${esc(item_name)}</div>` : ''}
                                <div>${bom_chip}</div>
                            </div>
                        </td>
                        <td>
                            ${so_qty(item.qty || 0)}
                            <div class="so-micro">${esc(item.uom || item.stock_uom || '')}</div>
                        </td>
                        <td>
                            <div class="so-stack">
                                ${so_qty(item.delivered_qty || 0, flt(item.delivered_qty) > 0 ? 'info' : null)}
                                ${_build_dn_si_row_links(d)}
                            </div>
                        </td>
                        <td>${avail_html}</td>
                        <td>${incoming_html}</td>
                        <td>${picked_html}</td>
                        <td>${picked_others_html}</td>
                        <td>${status_html}</td>
                        <td>${action_html}</td>
                    </tr>`;

                return main_row + rm_row_html;
            }).join('');

            tbody.html(rows_html || '<tr><td colspan="9" class="so-empty">No Valid Items Found.</td></tr>');

            _wire_row_toggle_and_search(container, tbody);

            // ── Bulk Pick List button ─────────────────────────────────
            const bulk_items = Object.values(bulk_eligible_items).filter(x => x.so_lines.length > 0);
            const total_bulk_qty = bulk_items.reduce((t, x) => t + x.total_eligible_pick_qty, 0);
            eligible_for_picking = (frm.doc.docstatus === 1) && (total_bulk_qty > 0);

            const $bulk_btn = container.find('#bulk-pick-action-btn');
            const render_create_btn = () => {
                $bulk_btn.html(`
                    <button class="so-btn so-btn--primary" id="btn-create-bulk-picklist" ${!eligible_for_picking ? 'disabled' : ''}
                            title="${eligible_for_picking ? 'Create one Pick List covering every pickable line' : 'Nothing is currently pickable on this order'}">
                        <i class="fa fa-clipboard"></i> Create Pick List${total_bulk_qty > 0 ? ` · ${Math.floor(total_bulk_qty)}` : ''}
                    </button>
                `);
                if (eligible_for_picking) {
                    $bulk_btn.find('#btn-create-bulk-picklist').on('click', () => {
                        create_pick_list_for_bulk(frm, bulk_items, total_bulk_qty);
                    });
                }
            };

            // This is the one place that manages picking for the whole order —
            // if Pick Lists already exist (from auto-creation on submit, or an
            // earlier click here), this button opens them for review instead of
            // only ever offering to create another one.
            frappe.call({
                method: 'erp_dacsinc_custom.order_flow_api.get_pick_lists_for_so',
                args: { sales_order: frm.doc.name }
            }).then(r => {
                const existing_pls = r.message || [];
                if (!existing_pls.length) {
                    render_create_btn();
                    if (callback) callback();
                    return;
                }

                const draft_count = existing_pls.filter(x => flt(x.docstatus) === 0).length;
                const submitted_pls = existing_pls.filter(x => flt(x.docstatus) === 1);

                const unique_draft_dns = new Set();
                const unique_draft_sis = new Set();
                if (frm.custom_stock_data) {
                    Object.values(frm.custom_stock_data).forEach(d => {
                        (d.row_dns || []).forEach(dn => {
                            if (dn.docstatus === 0) unique_draft_dns.add(dn.parent);
                        });
                        (d.row_sis || []).forEach(si => {
                            if (si.docstatus === 0) unique_draft_sis.add(si.parent);
                        });
                    });
                }

                $bulk_btn.html(`
                    <button class="so-btn so-btn--primary" id="btn-view-picklists">
                        <i class="fa fa-clipboard"></i> Pick Lists (${existing_pls.length})
                        ${draft_count ? `<span class="so-chip">${draft_count} draft</span>` : ''}
                    </button>
                    ${eligible_for_picking ? `
                        <button class="so-btn" id="btn-create-bulk-picklist" style="margin-left:6px;"
                                title="Create another Pick List for the remaining pickable qty">
                            <i class="fa fa-plus"></i> New${total_bulk_qty > 0 ? ` · ${Math.floor(total_bulk_qty)}` : ''}
                        </button>
                    ` : ''}
                    ${submitted_pls.length > 0 ? `
                        <button class="so-btn so-btn--success" id="btn-bulk-create-dn" style="margin-left:6px;"
                                title="Create a Delivery Note from all submitted Pick Lists">
                            <i class="fa fa-truck"></i> Create DN
                            ${unique_draft_dns.size ? `<span class="so-chip" style="background:var(--so-orange); margin-left:4px;">${unique_draft_dns.size} draft</span>` : ''}
                        </button>
                        <button class="so-btn so-btn--primary" id="btn-bulk-create-si" style="margin-left:6px;"
                                title="Create a Sales Invoice from all submitted Pick Lists">
                            <i class="fa fa-file-text-o"></i> Create SI
                            ${unique_draft_sis.size ? `<span class="so-chip" style="background:var(--so-orange); margin-left:4px;">${unique_draft_sis.size} draft</span>` : ''}
                        </button>
                    ` : ''}
                `);
                $bulk_btn.find('#btn-view-picklists').on('click', () => show_so_picklists_modal(frm, existing_pls));
                if (eligible_for_picking) {
                    $bulk_btn.find('#btn-create-bulk-picklist').on('click', () => {
                        create_pick_list_for_bulk(frm, bulk_items, total_bulk_qty);
                    });
                }
                if (submitted_pls.length > 0) {
                    $bulk_btn.find('#btn-bulk-create-dn').on('click', () => {
                        show_bulk_dn_si_modal(frm, submitted_pls, 'Delivery Note');
                    });
                    $bulk_btn.find('#btn-bulk-create-si').on('click', () => {
                        show_bulk_dn_si_modal(frm, submitted_pls, 'Sales Invoice');
                    });
                }
                if (callback) callback();
            }).catch(() => {
                render_create_btn();
                if (callback) callback();
            });
        }
    });
}

// Every Pick List tied to this Sales Order (one per line — see
// custom_script._create_pick_lists_one_per_item), reviewed in one place: a
// draft's quantity can be edited and submitted right here, exactly like the
// per-item "Picked (This SO)" modal already does, just for the whole order
// rather than one line.
function show_so_picklists_modal(frm, pick_lists) {
    const by_pl = {};
    pick_lists.forEach(row => (by_pl[row.name] = by_pl[row.name] || []).push(row));

    const so_name = frm.doc.name;
    const customer_name = frm.doc.customer_name || frm.doc.customer || '';

    const rows_html = Object.entries(by_pl).map(([pl_name, rows]) => rows.map((row, idx) => {
        const is_draft = flt(row.docstatus) === 0;
        const qty_cell = is_draft
            ? `<input type="number" class="so-qty-in" min="0" max="${flt(row.qty || 0)}" step="any" value="${flt(row.qty || 0)}"
                    data-pick="${esc(pl_name)}" data-row="${esc(row.pick_list_item || '')}" data-item="${esc(row.item_code)}"
                    title="Edit the quantity to pick down, then Submit — it cannot go above ${flt(row.qty || 0)}, what was already picked">`
            : so_qty(row.qty || 0);
        const action_cell = idx > 0
            ? ''
            : (is_draft
                ? so_cmd_btn(`so_submit_pick_list('${js_str(pl_name)}','')`, 'check', 'Submit', true)
                : `<span class="so-micro">—</span>`);

        return `<tr>
            <td>${idx === 0 ? `<a href="/app/sales-order/${encodeURIComponent(so_name)}" target="_blank">${esc(so_name)}</a>` : ''}</td>
            <td>${idx === 0 ? esc(customer_name) : ''}</td>
            <td>${idx === 0 ? `<a href="/app/pick-list/${encodeURIComponent(pl_name)}" target="_blank">${esc(pl_name)}</a>` : ''}</td>
            <td>${esc(row.item_code)}</td>
            <td>${qty_cell}</td>
            <td>${esc(row.warehouse || '')}</td>
            <td>${is_draft ? so_pill('draft', 'clock-o', 'Draft') : so_pill('done', 'check-circle', row.status)}</td>
            <td>${action_cell}</td>
        </tr>`;
    }).join('')).join('');

    const table_html = `<table class="so-table">
        <thead><tr><th>Sales Order</th><th>Customer</th><th>Pick List</th><th>Item</th><th>Qty</th><th>Warehouse</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows_html}</tbody>
    </table>`;

    so_open_modal(`Pick Lists — ${frm.doc.name}`, table_html);
}

/**
 * Row expand/collapse + search over the stock table.
 *
 * The Raw Material pipeline starts collapsed — on a 20-line order it otherwise
 * doubles the height of the table. Clicking anywhere on a row that has one opens
 * it, except on a link, button or input, which keep their own behaviour.
 *
 * Search matches the row's own text AND its raw-material text, so typing a fabric
 * name finds the finished good that consumes it. An expanded row stays expanded
 * while filtering.
 */
function _wire_row_toggle_and_search(container, tbody) {
    const $rows = tbody.find('tr.so-row-main');

    // Cache the searchable text once, including the collapsed RM rows.
    $rows.each(function () {
        const rm = $(this).next('tr.so-rm-row');
        this._so_search = ((this.textContent || '') + ' ' + (rm.length ? rm.text() : ''))
            .toLowerCase().replace(/\s+/g, ' ');
    });

    tbody.find('tr.so-rm-row').hide();

    tbody.on('click', 'tr.so-row-main.is-toggleable', function (e) {
        // Never swallow a click meant for a control inside the row.
        if ($(e.target).closest('a, button, input, select, textarea').length) return;

        const $row = $(this);
        const $rm = $row.next('tr.so-rm-row');
        if (!$rm.length) return;

        const open = !$row.hasClass('is-open');
        $row.toggleClass('is-open', open);
        $rm.toggle(open);
    });

    const $search = container.find('#so-item-search');
    const $count = container.find('#so-search-count');

    const apply_filter = () => {
        const term = ($search.val() || '').trim().toLowerCase();
        let shown = 0;

        $rows.each(function () {
            const match = !term || (this._so_search || '').indexOf(term) !== -1;
            const $row = $(this);
            $row.toggle(match);
            if (match) shown++;

            // A raw-material block is only visible when its row matches AND is open.
            const $rm = $row.next('tr.so-rm-row');
            if ($rm.length) $rm.toggle(match && $row.hasClass('is-open'));
        });

        $count.text(term ? `${shown} of ${$rows.length}` : '');
        tbody.find('tr.so-no-match').remove();
        if (term && shown === 0) {
            tbody.append(`<tr class="so-no-match"><td colspan="9" class="so-empty">No Items Match “${esc(term)}”.</td></tr>`);
        }
    };

    $search.on('input search', apply_filter);
}

// Helper: build the argument string for onclick="create_pick_list_for_item(...)"
function _build_pick_btn_data(item, qty, frm, d) {
    const ic = js_str(item.item_code);
    const so = js_str(frm.doc.name);
    // Must stay the Customer *ID* — it is used as a Link value in the fallback new_doc().
    const cus = js_str(d.customer || frm.doc.customer);
    const wh = js_str(item.warehouse || frm.doc.set_warehouse);
    const sin = js_str(item.name);
    const uom = js_str(item.uom || item.stock_uom);
    return `'${ic}', ${flt(qty)}, '${so}', '${cus}', '${wh}', '${sin}', '${uom}'`;
}

// Helper: build incoming PO HTML cell
function _build_incoming_html(item, d, pair_key) {
    let html = '<div class="so-stack">';

    const pending_stock = (d.incoming_stock || []).filter(doc => flt(doc.pending_qty) > 0);
    const pending_pos = pending_stock.filter(doc => doc.doc_type === 'Purchase Order');
    const pending_ewos = pending_stock.filter(doc => doc.doc_type === 'Embroidery Work Order');
    // Already-received history lives in its own payload key, not in incoming_stock.
    const completed_rcvd = d.completed_receipt_docs || [];

    const total_rcvd_qty = completed_rcvd.reduce((s, x) => s + flt(x.received_qty), 0);
    const total_pending_po_ewo = pending_stock.reduce((s, x) => s + flt(x.pending_qty), 0);

    // Material Requests are part of the same pipeline, one step earlier: requested but
    // not yet ordered. Because "pending" is qty - ordered_qty, an MR and the PO it
    // became can never double-count the same units.
    const mrs = d.material_requests || [];
    const mr_pending = flt(d.total_mr_pending_qty || 0);
    const total_pending_qty = total_pending_po_ewo + mr_pending;

    // The headline is what is STILL COMING — nothing else. Previously it fell back to
    // the received quantity when nothing was pending, so a fully-received PO showed a
    // green "50" here while the same 50 already sat in Available Stock. That read as
    // 100 units and is what made the column untrustworthy.
    html += so_qty(total_pending_qty, total_pending_qty > 0 ? 'warn' : null, 'lg');

    if (total_pending_qty > 0) {

        if (pending_pos.length > 0) {
            const po_qty = pending_pos.reduce((a, p) => a + flt(p.pending_qty), 0);
            const is_subcon = pending_pos.some(p => flt(p.is_subcontracted) === 1);
            // Name the supplier and the nearest expected date, not just a count.
            const suppliers = [...new Set(pending_pos.map(p => p.supplier_name || p.info || p.supplier).filter(Boolean))];
            const due_dates = pending_pos.map(p => p.expected_delivery_date).filter(Boolean).sort();
            html += `<div class="so-brk">
                <div class="so-brk__label">${pending_pos.length} PO · ${flt(po_qty)}${is_subcon ? ` <span class="so-chip so-chip--sc">SC</span>` : ''}</div>
                ${suppliers.length ? `<div class="so-brk__sub so-truncate" style="max-width:140px;" title="${esc(suppliers.join(', '))}">${esc(suppliers[0])}${suppliers.length > 1 ? ` +${suppliers.length - 1}` : ''}</div>` : ''}
                ${due_dates.length ? `<div class="so-brk__sub">Due ${fmt_date(due_dates[0])}</div>` : ''}
            </div>`;
        }

        if (mr_pending > 0) {
            const open_mrs = mrs.filter(m => flt(m.pending_qty) > 0);
            const mr_dates = open_mrs.map(m => m.schedule_date).filter(Boolean).sort();
            html += `<div class="so-brk">
                <div class="so-brk__label" style="color:var(--so-purple);">
                    ${open_mrs.length} MR · ${mr_pending}
                </div>
                <div class="so-brk__sub">Requested, Not Ordered</div>
                ${mr_dates.length ? `<div class="so-brk__sub">By ${fmt_date(mr_dates[0])}</div>` : ''}
            </div>`;
        }

        if (pending_ewos.length > 0) {
            const ewo_qty = pending_ewos.reduce((a, e) => a + flt(e.pending_qty), 0);
            const stages = [...new Set(pending_ewos.map(e => e.stage).filter(Boolean))];
            const stage_text = stages.length > 0 ? stages.join(', ') : 'Processing';
            const jobbers = [...new Set(pending_ewos.map(e => e.jobber_name || e.info || e.jobber_id).filter(Boolean))];
            html += `<div class="so-brk">
                <div class="so-brk__label">${pending_ewos.length} EWO · ${flt(ewo_qty)}</div>
                <div class="so-brk__sub so-truncate" style="max-width:140px;" title="${esc(stage_text)}">${esc(stage_text)}</div>
                ${jobbers.length ? `<div class="so-brk__sub so-truncate" style="max-width:140px;" title="${esc(jobbers.join(', '))}">${esc(jobbers[0])}${jobbers.length > 1 ? ` +${jobbers.length - 1}` : ''}</div>` : ''}
            </div>`;
        }

    }

    // Draft POs/MRs commit nothing (not yet submitted), so they stay out of
    // total_pending_qty above — shown here only for reference so a draft
    // someone already raised isn't invisible while it waits to be submitted.
    const draft_pos = d.draft_purchase_orders || [];
    const draft_mrs = d.draft_material_requests || [];
    if (draft_pos.length > 0) {
        const draft_po_qty = draft_pos.reduce((a, p) => a + flt(p.qty), 0);
        html += `<div class="so-micro" style="color:var(--so-orange);" title="Not yet submitted — not counted above">
            <i class="fa fa-file-o"></i> ${draft_pos.length} PO In Draft · ${flt(draft_po_qty)}
        </div>`;
    }
    if (draft_mrs.length > 0) {
        const draft_mr_qty = draft_mrs.reduce((a, m) => a + flt(m.qty), 0);
        html += `<div class="so-micro" style="color:var(--so-orange);" title="Not yet submitted — not counted above">
            <i class="fa fa-file-o"></i> ${draft_mrs.length} MR In Draft · ${flt(draft_mr_qty)}
        </div>`;
    }

    // A draft Receipt has posted nothing to the stock ledger yet — goods may
    // physically be on the dock, but Available Stock (and total_rcvd_qty
    // below) only reflect what's actually submitted. Shown in a distinct
    // (blue) tone: further along than a draft PO/MR, but not yet real stock.
    const draft_receipts = d.draft_receipt_docs || [];
    if (draft_receipts.length > 0) {
        const draft_recv_qty = draft_receipts.reduce((s, r) => s + flt(r.qty), 0);
        html += `<div class="so-micro" style="color:var(--so-info);" title="Receipt drafted but not submitted — not yet posted to stock">
            <i class="fa fa-inbox"></i> ${draft_receipts.length} Receipt In Draft · ${flt(draft_recv_qty)}
        </div>`;
    }

    // Footnotes. "Received" is history — it is already counted in Available Stock,
    // so it is stated as such and never as an incoming quantity.
    if (total_rcvd_qty > 0) {
        html += `<div class="so-micro" title="Already received and counted in Available Stock">
            <i class="fa fa-check" style="color:var(--so-green);"></i> ${flt(total_rcvd_qty)} Received
        </div>`;
    }
    if (flt(d.total_other_po_qty) > 0) {
        html += `<div class="so-micro" title="On Purchase Orders not reserved for this Sales Order">
            +${flt(d.total_other_po_qty)} On Other POs
        </div>`;
    }
    // A draft "other PO" (not yet submitted, so excluded from the count
    // above) still has its own View button showing via has_docs below —
    // without this line there was no visible sign of WHY, just an
    // otherwise-unexplained View button next to a flat 0.
    if (flt(d.total_other_po_qty_draft) > 0) {
        html += `<div class="so-micro" style="color:var(--so-orange);" title="Not yet submitted — not counted above">
            <i class="fa fa-file-o"></i> +${flt(d.total_other_po_qty_draft)} On Other POs In Draft
        </div>`;
    }

    // One entry point into the full document list, whatever produced the numbers above.
    // Draft POs/MRs/Receipts count too — the incoming_docs modal lists all
    // three in full (see show_details_modal), each linking straight to the
    // real document to review and submit. Missing this meant an item whose
    // ONLY incoming activity was a draft had no way to reach that detail at
    // all — no View button appeared.
    const has_docs = (d.incoming_stock || []).length > 0
        || (d.other_po_list || []).length > 0
        || mrs.length > 0
        || completed_rcvd.length > 0
        || draft_pos.length > 0
        || draft_mrs.length > 0
        || draft_receipts.length > 0;
    if (has_docs) {
        html += `<button class="so-btn so-btn--view" onclick="show_details_modal('${js_str(pair_key)}','incoming_docs')"><i class="fa fa-eye"></i> View</button>`;
    }

    html += '</div>';
    return html;
}


// ================================================================
//  SECTION 4: RM BREAKDOWN HTML
// ================================================================

function get_rm_breakdown_html(data, so_name, docstatus) {
    if (!data.is_bom_item) return '';
    const submitted = (docstatus === 1);

    const rm = data.rm_procurement_status || { fg_shortfall: 0, rm_shortfall_exists: false, rm_items_status: [] };

    const rows = (rm.rm_items_status || []).map(item => {
        const uom = item.rm_uom || '';
        let refs = [];

        if (item.mr_documents && item.mr_documents.length) {
            const mr_links = item.mr_documents.filter(Boolean).map(mr =>
                `<a href="/app/material-request/${encodeURIComponent(mr)}" target="_blank" title="Material Request: ${esc(mr)}" style="color:#805ad5; font-weight:bold; text-decoration:underline;">${esc(mr)}</a>`
            ).join(', ');
            if (mr_links) refs.push(`<b>MR:</b> ${mr_links}`);
        }
        if (item.po_documents && item.po_documents.length) {
            const po_links = item.po_documents.filter(Boolean).map(po =>
                `<a href="/app/purchase-order/${encodeURIComponent(po)}" target="_blank" title="Purchase Order: ${esc(po)}" style="color:#2b6cb0; font-weight:bold; text-decoration:underline;">${esc(po)}</a>`
            ).join(', ');
            if (po_links) refs.push(`<b>PO:</b> ${po_links}`);
        }

        const shortfall_qty = flt(item.rm_shortfall_total || 0);
        // Three distinct states, not a covered/shortfall binary: "Covered"
        // means stock is actually in hand; "Requested" means a pending
        // MR/PO closes the gap but nothing has arrived yet — collapsing
        // those two read as "Covered" the instant an MR was raised, with
        // zero stock on hand, which is exactly backwards.
        const rm_status = item.status || (shortfall_qty > 0 ? 'Shortage' : 'Covered');
        const status_pill_class = shortfall_qty > 0 ? 'so-pill--blocked'
            : rm_status === 'Requested' ? 'so-pill--wait' : 'so-pill--ready';
        const rm_name = item.rm_name && item.rm_name !== item.rm_code ? item.rm_name : '';

        return `
            <tr>
                <td>
                    <a class="so-link" href="/app/item/${encodeURIComponent(item.rm_code)}" target="_blank"
                       title="Item: ${esc(item.rm_code)}">${esc(item.rm_code)}</a>
                    ${rm_name ? `<div class="so-micro so-truncate" title="${esc(rm_name)}">${esc(rm_name)}</div>` : ''}
                </td>
                <td>
                    <span class="so-val">${flt(item.rm_required_total || 0).toFixed(2)}</span>
                    <div class="so-micro">${esc(uom)}</div>
                </td>
                <td>${so_qty(flt(item.rm_available_stock || 0).toFixed(2))}</td>
                <td>${so_qty(flt(item.rm_pending_mr_total || 0).toFixed(2))}</td>
                <td>${so_qty(flt(item.rm_pending_so_linked_total || 0).toFixed(2))}</td>
                <td class="so-meta" style="max-width:180px; word-break:break-word;">
                    ${refs.join('<br>') || '<span class="so-micro">—</span>'}
                </td>
                <td>
                    <span class="so-pill ${status_pill_class}" title="${rm_status === 'Requested' ? 'A Material Request covers the shortfall, but nothing has arrived yet' : ''}">
                        ${esc(rm_status)}
                    </span>
                </td>
                <td>
                    ${shortfall_qty > 0
                ? `<span class="so-val so-val--bad">${shortfall_qty.toFixed(2)}</span><div class="so-micro">${esc(uom)}</div>
                           ${submitted ? `<button class="so-btn so-btn--primary" style="margin-top:4px;"
                               onclick="so_make_rm_material_request('${js_str(so_name)}','${js_str(item.rm_code)}',${shortfall_qty},'${js_str(uom)}','${js_str(data.warehouse || '')}')">
                               <i class="fa fa-file-text-o"></i> Material Request</button>` : ''}`
                : `<span class="so-val so-val--zero">—</span>`}
                </td>
            </tr>`;
    }).join('');

    // This pill must agree with the rows it sits above: it now reflects the
    // SAME per-row math (Needed vs stock + pending MR + pending PO) as the
    // table, via rm_shortfall_exists — not fg_shortfall, a different, FG-level
    // question ("does the finished good itself need more units produced?").
    // Basing this pill on fg_shortfall used to make it say "Covered" while
    // every row below plainly showed 0 stock against a non-zero Needed.
    const items_with_shortage = (rm.rm_items_status || []).filter(i => flt(i.rm_shortfall_total || 0) > 0).length;
    const has_shortfall = !!rm.rm_shortfall_exists;
    const fg_already_stocked = !(flt(rm.fg_shortfall) > 0);

    return `
        <tr class="so-rm-row">
            <td colspan="9">
                <div class="so-rm">
                    <div class="so-rm__head">
                        <span class="so-rm__title"><i class="fa fa-list-ul"></i> Raw Material Pipeline</span>
                        ${data.bom_no
            ? `<a class="so-chip so-chip--bom" href="/app/bom/${encodeURIComponent(data.bom_no)}" target="_blank"
                                  title="Open BOM ${esc(data.bom_no)}">${esc(data.bom_no)}</a>`
            : ''}
                        <span class="so-pill ${has_shortfall ? 'so-pill--blocked' : 'so-pill--ready'}"
                              title="${has_shortfall ? 'Stock + pending MR + pending PO does not yet cover what this order needs' : 'Every raw material below is fully covered by stock and/or pending MR/PO'}">
                            ${has_shortfall
            ? `Shortage on ${items_with_shortage} Material${items_with_shortage === 1 ? '' : 's'}`
            : 'Materials Covered'}
                        </span>
                        ${fg_already_stocked
            ? `<span class="so-chip" style="background:var(--so-info);color:#fff;" title="The finished good already has enough stock for this line, so nothing new needs to be produced right now — the material check above is for reference only.">
                                   <i class="fa fa-info-circle"></i> FG Already in Stock — No Production Needed Now
                               </span>`
            : ''}
                        <span class="so-rm__spacer"></span>
                        <span class="so-rm__note">Coverage = Stock + Pending MR + Pending PO</span>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>RM Item</th>
                                <th>Needed</th>
                                <th>Stock</th>
                                <th>Pending MR</th>
                                <th>Pending PO</th>
                                <th>References</th>
                                <th>Status</th>
                                <th>Shortfall</th>
                            </tr>
                        </thead>
                        <tbody>${rows || '<tr><td colspan="8" class="so-empty">No Raw Material Data Available.</td></tr>'}</tbody>
                    </table>
                </div>
            </td>
        </tr>`;
}


// ================================================================
//  SECTION 4b: PROCUREMENT TRAIL (MR → PO → Receipt)
//  What was requested, what was ordered and what arrived, for the
//  whole Sales Order rather than one line at a time.
// ================================================================

function generate_procurement_table(frm) {
    const container = frm.fields_dict['custom_material_request_html']?.$wrapper;
    if (!container || !container.length) return;

    inject_so_styles();
    container.html(`
        <div class="so-section">
            <h5 class="so-section__title"><i class="fa fa-shopping-cart"></i> Procurement — Requests, Orders &amp; Receipts</h5>
            <div id="proc-table-body" class="so-empty so-empty--sm"><i class="fa fa-spinner fa-spin"></i> Loading…</div>
        </div>
    `);

    frappe.call({
        method: 'erp_dacsinc_custom.custom_script.get_linked_procurement_docs',
        args: { sales_order_name: frm.doc.name },
        callback: (r) => {
            const $body = container.find('#proc-table-body');
            const data = r.message || {};
            const mrs = data.material_requests || [];
            const pos = data.purchase_orders || [];
            const prs = data.purchase_receipts || [];

            if (!mrs.length && !pos.length && !prs.length) {
                $body.attr('class', 'so-empty so-empty--sm')
                    .html('Nothing has been requested or ordered against this Sales Order yet.');
                return;
            }

            // ── Material Requests ─────────────────────────────────
            const mr_rows = mrs.map(m => {
                const pending = flt(m.qty) - flt(m.ordered_qty);
                return `
                <tr>
                    <td>${link_id_name('Material Request', m.name)}</td>
                    <td><span class="so-micro">${esc(m.material_request_type || '')}</span></td>
                    <td class="so-meta">${fmt_date(m.transaction_date)}</td>
                    <td class="so-meta">${fmt_date(m.schedule_date)}</td>
                    <td>${so_qty(flt(m.qty))}<div class="so-micro">${flt(m.item_count)} item${flt(m.item_count) === 1 ? '' : 's'}</div></td>
                    <td>${so_qty(flt(m.ordered_qty), flt(m.ordered_qty) > 0 ? 'info' : null)}</td>
                    <td>${so_qty(Math.max(0, pending), pending > 0 ? 'warn' : null)}</td>
                    <td>
                        ${so_doc_status(m.status)}
                        ${pending > 0 ? `<div style="margin-top:4px;">${so_cmd_btn(`so_make_po_from_mr('${js_str(m.name)}')`, 'shopping-cart', 'Order', true)}</div>` : ''}
                    </td>
                </tr>`;
            }).join('');

            // ── Purchase Orders ───────────────────────────────────
            const po_rows = pos.map(p => `
                <tr>
                    <td>
                        ${link_id_name('Purchase Order', p.name)}
                        ${flt(p.is_subcontracted) === 1 ? `<div style="margin-top:3px;"><span class="so-chip so-chip--sc">Subcontract</span></div>` : ''}
                    </td>
                    <td>${link_name_id('Supplier', p.supplier, p.supplier_name)}</td>
                    <td class="so-meta">${fmt_date(p.transaction_date)}</td>
                    <td class="so-meta">${fmt_date(p.schedule_date)}</td>
                    <td>${so_qty(flt(p.qty))}</td>
                    <td>
                        ${so_qty(flt(p.received_qty), flt(p.received_qty) > 0 ? 'pos' : null)}
                        <div class="so-micro">${flt(p.per_received || 0).toFixed(0)}%</div>
                    </td>
                    <td>${so_format_currency(p.amount, p.currency)}</td>
                    <td>${so_doc_status(p.status)}</td>
                </tr>`).join('');

            // ── Receipts ──────────────────────────────────────────
            const pr_rows = prs.map(p => `
                <tr>
                    <td>
                        ${link_id_name(p.doctype, p.name)}
                        ${flt(p.is_subcontracted) === 1 ? `<div style="margin-top:3px;"><span class="so-chip so-chip--sc">Subcontract</span></div>` : ''}
                    </td>
                    <td>${link_name_id('Supplier', p.supplier, p.supplier_name)}</td>
                    <td class="so-meta">${fmt_date(p.posting_date)}</td>
                    <td>${so_qty(flt(p.qty), flt(p.qty) > 0 ? 'pos' : null)}
                        <div class="so-micro">${flt(p.item_count)} item${flt(p.item_count) === 1 ? '' : 's'}</div></td>
                    <td>${so_format_currency(p.amount, p.currency)}</td>
                    <td>${so_doc_status(p.status)}</td>
                </tr>`).join('');

            const total_requested = mrs.reduce((s, m) => s + flt(m.qty), 0);
            const total_ordered = pos.reduce((s, p) => s + flt(p.qty), 0);
            const total_received = prs.reduce((s, p) => s + flt(p.qty), 0);

            $body.attr('class', 'so-card so-card--padded').html(
                so_stats([
                    { label: 'Requested', value: total_requested, tone: total_requested ? 'info' : null },
                    { label: 'Ordered', value: total_ordered, tone: total_ordered ? 'warn' : null },
                    { label: 'Received', value: total_received, tone: total_received ? 'pos' : null },
                    { label: 'Documents', value: mrs.length + pos.length + prs.length }
                ])
                + so_section('Material Requests', `
                    <table class="so-table">
                        <thead><tr><th>Material Request</th><th>Type</th><th>Date</th><th>Needed by</th><th>Requested</th><th>Ordered</th><th>Not ordered</th><th>Status</th></tr></thead>
                        <tbody>${mr_rows}</tbody>
                    </table>`, mr_rows)
                + so_section('Purchase Orders', `
                    <table class="so-table">
                        <thead><tr><th>Purchase Order</th><th>Supplier</th><th>Date</th><th>Expected</th><th>Ordered</th><th>Received</th><th>Amount</th><th>Status</th></tr></thead>
                        <tbody>${po_rows}</tbody>
                    </table>`, po_rows)
                + so_section('Receipts', `
                    <table class="so-table">
                        <thead><tr><th>Receipt</th><th>Supplier</th><th>Date</th><th>Received</th><th>Amount</th><th>Status</th></tr></thead>
                        <tbody>${pr_rows}</tbody>
                    </table>`, pr_rows)
            );
        }
    });
}


// ================================================================
//  SECTION 5: DELIVERY NOTE TABLE
// ================================================================

function generate_delivery_note_table(frm) {
    const container = frm.fields_dict['custom_delivery_note_html']?.$wrapper;
    if (!container || !container.length) return;

    inject_so_styles();
    container.html(`
        <div class="so-section">
            <h5 class="so-section__title"><i class="fa fa-truck"></i> Related Delivery Notes</h5>
            <div id="dn-table-body" class="so-empty so-empty--sm"><i class="fa fa-spinner fa-spin"></i> Loading…</div>
        </div>
    `);

    frappe.call({
        method: 'erp_dacsinc_custom.custom_script.get_linked_delivery_notes',
        args: { sales_order_name: frm.doc.name },
        callback: (r) => {
            const $body = container.find('#dn-table-body');
            const rows = r.message || [];
            if (!rows.length) {
                const msg = frm.doc.skip_delivery_note ? 'Delivery Note Skipped (Direct Billing).' : 'No Delivery Notes yet.';
                $body.attr('class', 'so-empty so-empty--sm').html(msg);
                return;
            }
            const total_value = rows.reduce((s, dn) => s + flt(dn.grand_total), 0);
            const rows_html = rows.map(dn => `
                <tr>
                    <td>${link_id_name('Delivery Note', dn.name)}</td>
                    <td>${link_name_id('Customer', dn.customer, dn.customer_name)}</td>
                    <td class="so-meta">${fmt_date(dn.posting_date)}</td>
                    <td>
                        ${so_doc_status(dn.status)}
                        ${dn.lr_no ? `<div class="so-micro">LR ${esc(dn.lr_no)}</div>` : ''}
                    </td>
                    <td>
                        <span class="so-val">${so_format_currency(dn.grand_total, dn.currency)}</span>
                        <div class="so-micro">${flt(dn.per_billed || 0).toFixed(0)}% billed</div>
                    </td>
                </tr>`).join('');
            $body.attr('class', 'so-card').html(`
                <div class="so-scroll"><table class="so-table">
                    <thead><tr>
                        <th>Delivery Note</th><th>Customer</th><th>Date</th><th>Status</th><th>Total</th>
                    </tr></thead>
                    <tbody>${rows_html}</tbody>
                    <tfoot><tr>
                        <td colspan="4" class="so-num">${rows.length} delivery note${rows.length === 1 ? '' : 's'}</td>
                        <td>${so_format_currency(total_value, rows[0].currency)}</td>
                    </tr></tfoot>
                </table></div>`);
        }
    });
}


// ================================================================
//  SECTION 6: SALES INVOICE TABLE
// ================================================================

function generate_sales_invoice_table(frm) {
    const container = frm.fields_dict['custom_sales_invoice_html']?.$wrapper;
    if (!container || !container.length) return;

    inject_so_styles();
    container.html(`
        <div class="so-section">
            <h5 class="so-section__title"><i class="fa fa-file-text-o"></i> Related Sales Invoices</h5>
            <div id="si-table-body" class="so-empty so-empty--sm"><i class="fa fa-spinner fa-spin"></i> Loading…</div>
        </div>
    `);

    frappe.call({
        method: 'erp_dacsinc_custom.custom_script.get_linked_sales_invoices',
        args: { sales_order_name: frm.doc.name },
        callback: (r) => {
            const $body = container.find('#si-table-body');
            const rows = r.message || [];
            if (!rows.length) {
                $body.attr('class', 'so-empty so-empty--sm').html('No Sales Invoices yet.');
                return;
            }
            const total_value = rows.reduce((s, si) => s + flt(si.grand_total), 0);
            const total_outstanding = rows.reduce((s, si) => s + flt(si.outstanding_amount), 0);
            const rows_html = rows.map(si => `
                <tr>
                    <td>${link_id_name('Sales Invoice', si.name)}</td>
                    <td>${link_name_id('Customer', si.customer, si.customer_name)}</td>
                    <td class="so-meta">
                        ${fmt_date(si.posting_date)}
                        ${si.due_date ? `<div class="so-micro">due ${fmt_date(si.due_date)}</div>` : ''}
                    </td>
                    <td>${so_doc_status(si.status)}</td>
                    <td>
                        <span class="so-val">${so_format_currency(si.grand_total, si.currency)}</span>
                        ${flt(si.outstanding_amount) > 0
                    ? `<div class="so-micro" style="color:var(--red-600);">${so_format_currency(si.outstanding_amount, si.currency)} due</div>`
                    : `<div class="so-micro" style="color:var(--green-600);">paid</div>`}
                    </td>
                </tr>`).join('');
            $body.attr('class', 'so-card').html(`
                <div class="so-scroll"><table class="so-table">
                    <thead><tr>
                        <th>Invoice</th><th>Customer</th><th>Date</th><th>Status</th><th>Total</th>
                    </tr></thead>
                    <tbody>${rows_html}</tbody>
                    <tfoot><tr>
                        <td colspan="4" class="so-num">
                            ${rows.length} invoice${rows.length === 1 ? '' : 's'}${total_outstanding > 0 ? ` · ${so_format_currency(total_outstanding, rows[0].currency)} outstanding` : ''}
                        </td>
                        <td>${so_format_currency(total_value, rows[0].currency)}</td>
                    </tr></tfoot>
                </table></div>`);
        }
    });
}


// ================================================================
//  SECTION 7: PICKLIST ACTIONS
// ================================================================

/**
 * Create a Pick List for a single item line on a Sales Order.
 * Called from inline onclick buttons in the stock table.
 */
function create_pick_list_for_item(item_code, qty, so_name, customer, warehouse, so_item_name, uom) {
    frappe.confirm(
        `Create a Pick List for <b>${flt(qty)} ${esc(uom || '')}</b> × <b>${esc(item_code)}</b>`
        + ` against <b>${esc(so_name)}</b>`
        + `${customer ? ` (${esc((cur_frm && cur_frm.doc && cur_frm.doc.customer_name) || customer)})` : ''}?`
        + (warehouse ? `<br><small class="text-muted">Warehouse: ${esc(warehouse)}</small>` : '')
        + `<br><small class="text-muted">This will create a draft Pick List immediately without leaving the page.</small>`,
        () => {
            so_open_pick_list_draft(so_name, [{
                sales_order_item: so_item_name,
                item_code: item_code,
                qty: flt(qty)
            }]);
        }
    );
}

/**
 * Release stock held by Pick Lists that never closed.
 * When a Delivery Note is raised straight off a Sales Order, the Pick List keeps
 * per_delivered = 0 and status "Open" — and ERPNext goes on reserving its quantity,
 * which blocks every later pick of that item. This recomputes the delivery status
 * from the Delivery Notes and closes the ones that are finished.
 */
function so_fix_stale_pick_lists(item_code) {
    const d = get_cached_stock_row(item_code + '||');
    const blockers = (d && d.stale_blockers) || [];

    if (!blockers.length) {
        frappe.msgprint(__('No stale Pick Lists found for this item.'));
        return;
    }

    const list = blockers.map(b =>
        `<li><b>${esc(b.pick_list)}</b> — holding ${flt(b.held_qty)} for `
        + `${esc(b.sales_order || '')} (already delivered ${flt(b.so_delivered)}/${flt(b.qty)})</li>`
    ).join('');

    frappe.confirm(
        __('Close these Pick Lists and release the stock they are holding?')
        + `<ul style="margin-top:8px;font-size:12px;">${list}</ul>`
        + `<small class="text-muted">${__('Their delivery status is recalculated from the Delivery Notes. Nothing is cancelled and no stock moves.')}</small>`,
        () => {
            frappe.call({
                method: 'erp_dacsinc_custom.custom_script.reconcile_pick_lists',
                args: { pick_lists: blockers.map(b => b.pick_list) },
                freeze: true,
                freeze_message: __('Releasing reserved stock…'),
                callback: (r) => {
                    if (!r.message) return;
                    frappe.show_alert({
                        message: r.message.message,
                        indicator: (r.message.updated || []).length ? 'green' : 'orange'
                    }, 6);
                    if (typeof cur_frm !== 'undefined' && cur_frm) {
                        generate_stock_overview_table(cur_frm);
                    }
                }
            });
        }
    );
}

/**
 * Build a Pick List for the given Sales Order lines and open it UNSAVED.
 * ERPNext's mapper returns a draft document rather than inserting one, so it has
 * to be synced into the client cache before routing — setting a route straight to
 * the returned name lands on a document that does not exist yet.
 */
function so_open_pick_list_draft(so_name, line_items) {
    frappe.call({
        method: 'erp_dacsinc_custom.custom_script.create_pick_list_for_items',
        args: { sales_order: so_name, items: line_items || [] },
        freeze: true,
        freeze_message: __('Building Pick List…'),
        callback: (r) => {
            if (!r.message) return;   // server threw; Frappe has shown the reason

            if (r.message.created) {
                const links = r.message.created.map(n => `<a href="/app/pick-list/${encodeURIComponent(n)}" target="_blank"><b>${esc(n)}</b></a>`).join(', ');
                frappe.show_alert({
                    message: __('Pick List(s) created (Draft): {0}', [links]),
                    indicator: 'green'
                }, 7);
                if (typeof cur_frm !== 'undefined' && cur_frm) {
                    generate_stock_overview_table(cur_frm);
                }
                return;
            }

            frappe.model.sync(r.message);
            frappe.set_route('Form', r.message.doctype, r.message.name);
            frappe.show_alert({
                message: __('Check the quantities, then save and submit.'),
                indicator: 'blue'
            }, 7);
        }
    });
}

/**
 * Next Action commands.
 * The functions below this one open an *unsaved* mapped draft so the user
 * reviews before committing — nothing is written to the database by clicking.
 * so_open_doc is the exception: it opens an ALREADY-EXISTING document by
 * name (a draft/submitted Pick List, an open Material Request), so — like
 * every other document reference in this widget (link_id_name, link_name_id)
 * — it opens in a new tab rather than navigating away from the Sales Order.
 */
function so_open_doc(doctype, name) {
    if (!name) return;
    window.open(frappe.utils.get_form_link(doctype, name), '_blank');
}

// Delivery Note is mapped from the Pick List, not the Sales Order.
function so_make_delivery_note(pick_list_name) {
    if (!pick_list_name) {
        frappe.msgprint(__('No submitted Pick List found for this line.'));
        return;
    }
    frappe.model.open_mapped_doc({
        method: 'erpnext.stock.doctype.pick_list.pick_list.create_delivery_note',
        source_name: pick_list_name,
        freeze_message: __('Creating Delivery Note…')
    });
}

/**
 * Once a line is picked, it can ship either via Delivery Note or directly via
 * a Sales Invoice with Update Stock — never both for the same order (see
 * guard_so_fulfillment_route_lock server-side). route_lock is 'dn'/'si'/''
 * from the bulk stock endpoint, pre-hiding whichever option this order has
 * already committed away from.
 */
function so_prompt_dn_or_si(so_name, sales_order_item, item_code, pick_list, picked_qty, route_lock) {
    const options = [];
    if (route_lock !== 'si') options.push('Delivery Note');
    if (route_lock !== 'dn') options.push('Sales Invoice (Update Stock)');

    if (!options.length) {
        frappe.msgprint(__('This Sales Order is locked to a fulfillment route that conflicts with this line.'));
        return;
    }

    frappe.prompt([
        {
            fieldtype: 'Select', fieldname: 'route', label: __('Proceed with'),
            options: options, reqd: 1, default: options[0]
        },
        {
            fieldtype: 'Float', fieldname: 'qty', label: __('Quantity to fulfill now'),
            reqd: 1, default: picked_qty,
            description: __('Capped at the {0} already picked and submitted.', [flt(picked_qty)])
        }
    ], (values) => {
        if (flt(values.qty) > flt(picked_qty)) {
            frappe.msgprint(__('Cannot fulfill more than {0} — that is all that was picked.', [flt(picked_qty)]));
            return;
        }
        if (values.route === 'Delivery Note') {
            so_make_delivery_note(pick_list);
        } else {
            so_make_sales_invoice_with_stock(so_name, sales_order_item, item_code, values.qty);
        }
    }, __('Waiting for DN / SI'), __('Continue'));
}

// The direct-billing alternative to Delivery Note: a Sales Invoice with
// Update Stock, scoped to this one line and capped at what was picked.
function so_make_sales_invoice_with_stock(so_name, sales_order_item, item_code, qty) {
    frappe.call({
        method: 'erp_dacsinc_custom.custom_script.create_sales_invoice_for_item_with_stock',
        args: { sales_order: so_name, sales_order_item: sales_order_item, item_code: item_code, qty: qty },
        freeze: true,
        freeze_message: __('Building Sales Invoice…'),
        callback: (r) => {
            if (!r.message) return;   // server threw; Frappe has shown the reason
            frappe.model.sync(r.message);
            frappe.set_route('Form', r.message.doctype, r.message.name);
        }
    });
}

// Turn an existing Material Request into a Purchase Order, rather than raising a
// second request for the same shortfall.
function so_make_po_from_mr(mr_name) {
    if (!mr_name) {
        frappe.msgprint(__('No open Material Request for this line.'));
        return;
    }
    frappe.model.open_mapped_doc({
        method: 'erpnext.stock.doctype.material_request.material_request.make_purchase_order',
        source_name: mr_name,
        freeze_message: __('Creating Purchase Order from Material Request…')
    });
}

// Maps every pending line on the order — ERPNext has no per-item variant.
function so_make_material_request(so_name) {
    frappe.model.open_mapped_doc({
        method: 'erpnext.selling.doctype.sales_order.sales_order.make_material_request',
        source_name: so_name,
        freeze_message: __('Creating Material Request…')
    });
}

/**
 * Material Request for ONE raw material row in the RM breakdown table.
 *
 * so_make_material_request() above maps straight from Sales Order Item, i.e.
 * the finished good on the SO — it has no notion of a BOM's raw materials at
 * all. Calling it from an RM row silently requested the finished good
 * instead of the shortfall material. This targets the RM item explicitly
 * via the same custom creator the "Get Item From SO" planner uses.
 */
function so_make_rm_material_request(so_name, item_code, qty, uom, warehouse) {
    frappe.call({
        method: 'erp_dacsinc_custom.custom_script.create_material_request_custom',
        args: {
            items: [{ item_code: item_code, qty: qty, uom: uom, warehouse: warehouse || undefined }],
            company: cur_frm.doc.company,
            sales_order_name: so_name
        },
        freeze: true,
        freeze_message: __('Creating Material Request for {0}…', [item_code]),
        callback: (r) => {
            if (!r.message) return;   // server threw; Frappe has shown the reason
            window.open(frappe.utils.get_form_link('Material Request', r.message), '_blank');
            frappe.show_alert({
                message: __('Material Request {0} created for {1}.', [r.message, item_code]),
                indicator: 'green'
            }, 7);
        }
    });
}

/**
 * Subcontracting Purchase Order for a BOM / job-work finished good.
 * The server builds it in the shape this company already uses (service item on the
 * row, finished good in fg_item) and hands back an unsaved draft to review.
 */
function so_make_subcontract_po(so_name, item_code, qty) {
    frappe.call({
        method: 'erp_dacsinc_custom.custom_script.make_subcontract_purchase_order',
        args: { sales_order: so_name, item_code: item_code, qty: qty },
        freeze: true,
        freeze_message: __('Building Subcontract PO…'),
        callback: (r) => {
            if (!r.message) return;   // server threw; Frappe has shown the reason
            frappe.model.sync(r.message);
            frappe.set_route('Form', r.message.doctype, r.message.name);
            frappe.show_alert({
                message: __('Review the supplier and rate, then save.'),
                indicator: 'blue'
            }, 7);
        }
    });
}

/**
 * Save any edited quantities on a DRAFT Pick List and submit it, straight from
 * the "Picked (This SO)" modal — saves opening the Pick List form.
 */
function so_submit_pick_list(pick_list, pair_key) {
    let invalid = false;
    const over_max = [];
    // Keyed by the Pick List Item row name, never a plain array: a Pick List
    // that was reviewed earlier (e.g. the per-item "Picked (This SO)" modal,
    // then again from the widget's "Pick Lists" button) can leave more than
    // one matching input in the DOM at once if a prior dialog wasn't fully
    // torn down — scoping to the CURRENTLY open dialog and deduplicating by
    // row is what keeps the submitted total from silently adding them up.
    const rows_by_item = new Map();

    const $scope = (so_active_dialog && so_active_dialog.$wrapper) ? so_active_dialog.$wrapper : $(document);
    $scope.find('.so-qty-in').each((i, inp) => {
        if (inp.dataset.pick !== pick_list) return;
        const qty = flt(inp.value);
        const max_qty = flt(inp.max);
        if (!(qty > 0)) invalid = true;
        // The qty a Pick List line was created with is the most that was ever
        // actually available/picked for it — a draft can only be reduced from
        // there, never raised, or the line would promise stock nothing behind
        // it reserved.
        if (max_qty && qty > max_qty) {
            over_max.push({ item: inp.dataset.item || inp.dataset.row, max: max_qty });
        }
        rows_by_item.set(inp.dataset.row, { pick_list_item: inp.dataset.row, qty: qty });
    });

    const rows = Array.from(rows_by_item.values());

    if (!rows.length) {
        frappe.msgprint(__('Nothing to submit on this Pick List.'));
        return;
    }
    if (invalid) {
        frappe.msgprint(__('Quantity must be greater than zero.'));
        return;
    }
    if (over_max.length) {
        const lines = over_max.map(o => `<li>${esc(o.item)} — max <b>${flt(o.max)}</b></li>`).join('');
        frappe.msgprint({
            title: __('Quantity too high'),
            indicator: 'red',
            message: __('You can only reduce a Pick List quantity, never raise it — it was already picked at this amount:')
                + `<ul style="margin-top:6px;">${lines}</ul>`
        });
        return;
    }

    const total = rows.reduce((s, r) => s + r.qty, 0);
    frappe.confirm(
        __('Submit Pick List <b>{0}</b> for a total of <b>{1}</b>?', [esc(pick_list), flt(total)])
        + `<br><small class="text-muted">${__('Submitting reserves the stock and cannot be undone without cancelling.')}</small>`,
        () => {
            frappe.call({
                method: 'erp_dacsinc_custom.custom_script.update_and_submit_pick_list',
                args: { pick_list: pick_list, rows: rows, submit: 1 },
                freeze: true,
                freeze_message: __('Submitting Pick List…'),
                callback: (r) => {
                    if (!r.message) return;   // server threw; Frappe has shown the error
                    frappe.show_alert({
                        message: __('Pick List {0} submitted.', [r.message.name]),
                        indicator: 'green'
                    }, 5);
                    if (typeof cur_frm !== 'undefined' && cur_frm) {
                        generate_stock_overview_table(cur_frm, () => {
                            if (pair_key) {
                                show_details_modal(pair_key, 'picked');
                            } else {
                                frappe.call({
                                    method: 'erp_dacsinc_custom.order_flow_api.get_pick_lists_for_so',
                                    args: { sales_order: cur_frm.doc.name }
                                }).then(res => {
                                    show_so_picklists_modal(cur_frm, res.message || []);
                                });
                            }
                        });
                    }
                }
            });
        }
    );
}

// Submit a draft Pick List straight from its "Next Action" cell — a proper
// confirmation dialog, then submit in place, never a redirect away from the
// Sales Order. No qty edit here (rows: []) — open the Pick List itself first
// if the quantity needs adjusting before submitting.
function so_confirm_submit_pick_list(pick_list) {
    if (!pick_list) {
        frappe.msgprint(__('No draft Pick List found for this line.'));
        return;
    }
    frappe.confirm(
        __('Submit Pick List <b>{0}</b>?', [esc(pick_list)])
        + `<br><small class="text-muted">${__('Submitting reserves the stock and cannot be undone without cancelling. Open the Pick List first if the quantity needs adjusting.')}</small>`,
        () => {
            frappe.call({
                method: 'erp_dacsinc_custom.custom_script.update_and_submit_pick_list',
                args: { pick_list: pick_list, rows: [], submit: 1 },
                freeze: true,
                freeze_message: __('Submitting Pick List…'),
                callback: (r) => {
                    if (!r.message) return;   // server threw; Frappe has shown the error
                    frappe.show_alert({
                        message: __('Pick List {0} submitted.', [r.message.name]),
                        indicator: 'green'
                    }, 5);
                    if (typeof cur_frm !== 'undefined' && cur_frm) {
                        generate_stock_overview_table(cur_frm);
                    }
                }
            });
        }
    );
}

/**
 * make_purchase_order needs `selected_items` as a real argument; the generic
 * mapper endpoint drops it into frappe.flags, so call the method directly and
 * route to the returned draft ourselves.
 */
function so_make_purchase_order(so_name, item_code) {
    frappe.call({
        method: 'erpnext.selling.doctype.sales_order.sales_order.make_purchase_order',
        args: {
            source_name: so_name,
            selected_items: [{ item_code: item_code }]
        },
        freeze: true,
        freeze_message: __('Creating Purchase Order…'),
        callback: (r) => {
            if (!r.message) {
                frappe.msgprint(__('Could not build a Purchase Order for {0}. Check that it is a purchase item with a pending quantity.', [item_code]));
                return;
            }
            frappe.model.sync(r.message);
            frappe.set_route('Form', r.message.doctype, r.message.name);
        }
    });
}

/**
 * Create a bulk Pick List covering multiple eligible items.
 */
function create_pick_list_for_bulk(frm, items, total_qty) {
    if (!items || !items.length) {
        frappe.msgprint(__('No eligible items for bulk Pick List.'));
        return;
    }

    const item_lines = items.map(x =>
        `<li>${esc(x.item_code)} — <b>${flt(x.total_eligible_pick_qty)}</b> ${esc(x.stock_uom || '')}`
        + `${x.warehouse ? ` <span class="text-muted">from ${esc(x.warehouse)}</span>` : ''}</li>`
    ).join('');

    // Every eligible Sales Order line, so the draft covers exactly what the button counted.
    const line_items = [];
    items.forEach(x => (x.so_lines || []).forEach(l => line_items.push({
        sales_order_item: l.so_item_name,
        item_code: x.item_code,
        qty: flt(l.unpicked_qty)
    })));

    frappe.confirm(
        `Create a bulk Pick List for <b>${Math.floor(total_qty)}</b> units across <b>${items.length}</b> item(s)`
        + ` on <b>${esc(frm.doc.name)}</b>?`
        + `<ul style="margin-top:8px; font-size:12px; max-height:180px; overflow:auto;">${item_lines}</ul>`
        + `<small class="text-muted">This will create draft Pick Lists immediately without leaving the page.</small>`,
        () => so_open_pick_list_draft(frm.doc.name, line_items)
    );
}


// ================================================================
//  SECTION 8: DETAIL MODALS
// ================================================================

/**
 * Generic detail modal — called from inline onclick buttons.
 * pair_key: the "ITEM_CODE||BOM" key of the cached row (a bare item_code also works).
 * type: 'stock_details' | 'incoming_docs' | 'picked'
 */
function show_details_modal(pair_key, type) {
    const d = get_cached_stock_row(pair_key);
    if (!d) {
        frappe.msgprint(__('Stock data not loaded yet. Please refresh the table.'));
        return;
    }

    const item_code = d.item_code || String(pair_key || '').split('||')[0];
    const heading = `${item_code}${d.item_name && d.item_name !== item_code ? ` — ${d.item_name}` : ''}`;

    let title = '';
    let body_html = '';

    if (type === 'stock_details') {
        title = `Stock Details — ${heading}`;

        const wh_rows = (d.warehouse_stock || []).map(w => `
            <tr>
                <td>${link_id_name('Warehouse', w.warehouse)}</td>
                <td>${so_qty(w.actual_qty, flt(w.actual_qty) > 0 ? 'pos' : null)}</td>
            </tr>`).join('');

        const rcpt_rows = (d.completed_receipt_docs || []).map(r => {
            const is_sc = flt(r.is_subcontracted) === 1;
            const rcpt_id = r.pr_name || r.sr_name;
            const rcpt_dt = r.pr_name ? 'Purchase Receipt' : 'Subcontracting Receipt';
            return `
            <tr>
                <td>${link_id_name(rcpt_dt, rcpt_id, r.item_name)}</td>
                <td class="so-meta">${fmt_date(r.posting_date)}</td>
                <td class="so-meta">${r.supplier ? esc(r.supplier) : em_dash()}</td>
                <td>${link_id_name('Purchase Order', r.po_name)}</td>
                <td class="so-meta">${r.warehouse ? esc(r.warehouse) : em_dash()}</td>
                <td>${so_qty(r.received_qty)}</td>
                <td>${is_sc ? `<span class="so-chip so-chip--sc">Subcontract</span>` : `<span class="so-micro">Standard</span>`}</td>
            </tr>`;
        }).join('');

        // Not yet posted to stock — explains a lower-than-expected Available
        // Stock when goods have physically shown up but the Receipt itself
        // is still a draft.
        const draft_rcpt_rows = (d.draft_receipt_docs || []).map(r => {
            const rcpt_id = r.pr_name || r.sr_name;
            const rcpt_dt = r.pr_name ? 'Purchase Receipt' : 'Subcontracting Receipt';
            return `
            <tr>
                <td>${link_id_name(rcpt_dt, rcpt_id)}</td>
                <td class="so-meta">${fmt_date(r.posting_date)}</td>
                <td class="so-meta">${r.supplier ? esc(r.supplier) : em_dash()}</td>
                <td>${link_id_name('Purchase Order', r.po_name)}</td>
                <td>${so_qty(r.qty)}</td>
                <td>${so_doc_status('Draft')}</td>
            </tr>`;
        }).join('');

        body_html = so_stats([
            { label: 'Total available', value: flt(d.total_available_stock), unit: d.stock_uom },
            { label: 'For this SO', value: flt(d.received_for_so_qty || 0), tone: 'pos' },
            { label: 'General stock', value: flt(d.general_stock_qty || 0), tone: 'info' },
            { label: 'Reserved by others', value: flt(d.picked_for_others_qty || 0) + flt(d.draft_qty_for_others || 0) + flt(d.picked_submitted_other_rows || 0) + flt(d.picked_draft_other_rows || 0), tone: 'warn' }
        ])
            + so_section('Warehouse stock', `
            <table class="so-table">
                <thead><tr><th>Warehouse</th><th>Qty</th></tr></thead>
                <tbody>${wh_rows}</tbody>
            </table>`, wh_rows)
            + so_section('Completed receipts against this SO', `
            <table class="so-table">
                <thead><tr><th>Receipt</th><th>Date</th><th>Supplier</th><th>Against PO</th><th>Warehouse</th><th>Qty</th><th>Type</th></tr></thead>
                <tbody>${rcpt_rows}</tbody>
            </table>`, rcpt_rows)
            + so_section('Draft receipts — not yet posted', `
            <table class="so-table">
                <thead><tr><th>Receipt</th><th>Date</th><th>Supplier</th><th>Against PO</th><th>Qty</th><th>Status</th></tr></thead>
                <tbody>${draft_rcpt_rows}</tbody>
            </table>`, draft_rcpt_rows, 'Goods may physically be on the dock — not counted in the stock above');

    } else if (type === 'incoming_docs') {
        title = `Incoming Documents — ${heading}`;

        const docs = d.incoming_stock || [];
        const doc_rows = docs.map(doc => {
            const is_ewo = doc.doc_type === 'Embroidery Work Order';
            const party = is_ewo
                ? link_name_id('Supplier', doc.jobber_id, doc.jobber_name || doc.info)
                : link_name_id('Supplier', doc.supplier, doc.supplier_name || doc.info);
            const note = flt(doc.is_subcontracted) === 1
                ? `<div style="margin-top:4px;"><span class="so-chip so-chip--sc">Subcontract</span></div>`
                : (is_ewo
                    ? `<div class="so-micro" style="margin-top:4px;">${esc(doc.stage || 'In process')}</div>`
                    : `<div class="so-micro" style="margin-top:4px;">Standard</div>`);
            return `
            <tr>
                <td><span class="so-micro">${esc(doc.doc_type || '—')}</span></td>
                <td>
                    ${link_id_name(doc.doc_type, doc.name, doc.item_name)}
                    ${doc.po_ref ? `<div class="so-micro">against ${link_id_name('Purchase Order', doc.po_ref)}</div>` : ''}
                </td>
                <td>${party}</td>
                <td>${so_qty(doc.pending_qty || 0, 'warn')}</td>
                <td class="so-meta">${fmt_date(doc.expected_delivery_date || doc.date)}</td>
                <td class="so-meta">${doc.warehouse ? esc(doc.warehouse) : em_dash()}</td>
                <td>${so_doc_status(doc.status)}${note}</td>
            </tr>`;
        }).join('')
            // Draft POs for this SO commit nothing (not yet submitted, excluded
            // from total_incoming_qty), but belong in this same list so they are
            // never the only thing invisible here — the Draft pill is the
            // indication, same as every other row's real status.
            + (d.draft_purchase_orders || []).map(po => `
            <tr>
                <td><span class="so-micro">Purchase Order</span></td>
                <td>${link_id_name('Purchase Order', po.name)}</td>
                <td>${link_name_id('Supplier', po.supplier, po.supplier_name || po.info)}</td>
                <td>${so_qty(po.qty || 0)}</td>
                <td class="so-meta">${fmt_date(po.expected_delivery_date || po.date)}</td>
                <td class="so-meta">${po.warehouse ? esc(po.warehouse) : em_dash()}</td>
                <td>${so_doc_status('Draft')}</td>
            </tr>`).join('');

        // POs feeding general stock / other orders — same item, different demand.
        const other_rows = (d.other_po_list || []).map(po => `
            <tr>
                <td>${link_id_name('Purchase Order', po.name)}</td>
                <td>${link_name_id('Supplier', po.supplier, po.supplier_name || po.info)}</td>
                <td>${po.sales_order
                ? link_id_name('Sales Order', po.sales_order, po.so_customer_name)
                : `<span class="so-micro">General stock</span>`}</td>
                <td>${so_qty(po.pending_qty || 0)}</td>
                <td class="so-meta">${fmt_date(po.expected_delivery_date)}</td>
                <td>${so_doc_status(po.status)}</td>
            </tr>`).join('');

        const rcpt_rows = (d.completed_receipt_docs || []).map(r => `
            <tr>
                <td>${link_id_name(r.pr_name ? 'Purchase Receipt' : 'Subcontracting Receipt', r.pr_name || r.sr_name)}</td>
                <td class="so-meta">${r.supplier ? esc(r.supplier) : em_dash()}</td>
                <td>${link_id_name('Purchase Order', r.po_name)}</td>
                <td>${so_qty(r.received_qty, 'pos')}</td>
                <td class="so-meta">${fmt_date(r.posting_date)}</td>
            </tr>`).join('');

        // Material Requests: the step before a PO exists.
        const mr_rows = (d.material_requests || []).map(m => {
            const pending = flt(m.pending_qty);
            const ordered = flt(m.ordered_qty);
            return `
            <tr>
                <td>${link_id_name('Material Request', m.name)}</td>
                <td><span class="so-micro">${esc(m.material_request_type || '')}</span></td>
                <td>${so_qty(m.qty || 0)}</td>
                <td>${so_qty(ordered, ordered > 0 ? 'info' : null)}</td>
                <td>${so_qty(pending, pending > 0 ? 'warn' : null)}</td>
                <td class="so-meta">${fmt_date(m.schedule_date || m.date)}</td>
                <td>
                    ${so_doc_status(m.status)}
                    ${pending > 0
                    ? `<div style="margin-top:4px;">${so_cmd_btn(`so_make_po_from_mr('${js_str(m.name)}')`, 'shopping-cart', 'Order', true)}</div>`
                    : ''}
                </td>
            </tr>`;
        }).join('')
            // Draft MRs commit nothing (not yet submitted, excluded from
            // total_mr_pending_qty) — listed here too so the Draft pill is the
            // indication, not a separate hidden-away place.
            + (d.draft_material_requests || []).map(m => `
            <tr>
                <td>${link_id_name('Material Request', m.name)}</td>
                <td><span class="so-micro">${esc(m.material_request_type || '')}</span></td>
                <td>${so_qty(m.qty || 0)}</td>
                <td>${em_dash()}</td>
                <td>${so_qty(m.qty || 0, 'warn')}</td>
                <td class="so-meta">${fmt_date(m.schedule_date || m.date)}</td>
                <td>${so_doc_status('Draft')}</td>
            </tr>`).join('');

        body_html = so_stats([
            { label: 'Pending for this SO', value: flt(d.total_incoming_qty || 0), unit: d.stock_uom, tone: 'warn' },
            { label: 'Requested (MR)', value: flt(d.total_mr_pending_qty || 0) },
            { label: 'On other POs', value: flt(d.total_other_po_qty || 0) },
            { label: 'Already received', value: (d.completed_receipt_docs || []).reduce((s, r) => s + flt(r.received_qty), 0), tone: 'pos' }
        ])
            + so_section('Material Requests', `
            <table class="so-table">
                <thead><tr><th>Material Request</th><th>Type</th><th>Requested</th><th>Ordered</th><th>Not yet ordered</th><th>Needed by</th><th>Status</th></tr></thead>
                <tbody>${mr_rows}</tbody>
            </table>`, mr_rows, 'Requested but not yet on a Purchase Order')
            + so_section('Pending for this Sales Order', `
            <table class="so-table">
                <thead><tr><th>Type</th><th>Document</th><th>Supplier / Jobber</th><th>Pending</th><th>Expected</th><th>Warehouse</th><th>Status</th></tr></thead>
                <tbody>${doc_rows || '<tr><td colspan="7" class="so-empty">Nothing on order for this Sales Order.</td></tr>'}</tbody>
            </table>`, true)
            + so_section('Other &amp; general Purchase Orders', `
            <table class="so-table">
                <thead><tr><th>Purchase Order</th><th>Supplier</th><th>Reserved for</th><th>Pending</th><th>Expected</th><th>Status</th></tr></thead>
                <tbody>${other_rows}</tbody>
            </table>`, other_rows, 'Not reserved for this order')
            + so_section('Already received against this SO', `
            <table class="so-table">
                <thead><tr><th>Receipt</th><th>Supplier</th><th>Against PO</th><th>Qty</th><th>Date</th></tr></thead>
                <tbody>${rcpt_rows}</tbody>
            </table>`, rcpt_rows)
            + so_section('Draft receipts — not yet posted', `
            <table class="so-table">
                <thead><tr><th>Receipt</th><th>Supplier</th><th>Against PO</th><th>Qty</th><th>Date</th><th>Status</th></tr></thead>
                <tbody>${(d.draft_receipt_docs || []).map(r => `
                    <tr>
                        <td>${link_id_name(r.pr_name ? 'Purchase Receipt' : 'Subcontracting Receipt', r.pr_name || r.sr_name)}</td>
                        <td class="so-meta">${r.supplier ? esc(r.supplier) : em_dash()}</td>
                        <td>${link_id_name('Purchase Order', r.po_name)}</td>
                        <td>${so_qty(r.qty)}</td>
                        <td class="so-meta">${fmt_date(r.posting_date)}</td>
                        <td>${so_doc_status('Draft')}</td>
                    </tr>`).join('')}</tbody>
            </table>`, (d.draft_receipt_docs || []).length, 'Goods may physically be on the dock — not counted as incoming or received');

    } else if (type === 'picked') {
        title = `Pick Lists (This SO) — ${heading}`;

        const docs = d.picked_for_this_so_details || [];
        let has_draft = false;

        const doc_rows = docs.map(doc => {
            const submitted = flt(doc.docstatus) === 1;
            if (!submitted) has_draft = true;

            // Draft rows are editable in place: change the qty and submit without
            // leaving the Sales Order.
            const qty_cell = submitted
                ? so_qty(doc.qty || 0)
                : `<input type="number" class="so-qty-in" min="0" max="${flt(doc.qty || 0)}" step="any"
                          value="${flt(doc.qty || 0)}"
                          data-pick="${esc(doc.pick_list_name)}"
                          data-row="${esc(doc.pick_list_item || '')}"
                          data-item="${esc(item_code)}"
                          title="Edit the quantity to pick down, then Submit — it cannot go above ${flt(doc.qty || 0)}, what was already picked">`;

            const action_cell = submitted
                ? `<span class="so-micro">—</span>`
                : so_cmd_btn(`so_submit_pick_list('${js_str(doc.pick_list_name)}','${js_str(pair_key)}')`,
                    'check', 'Submit', true);

            const other_items = doc.other_items || [];
            // Submit acts on the whole Pick List document, not just this row —
            // whoever clicks Submit here must see every other item riding
            // along with it. The item this modal was opened for is tagged so
            // it's never ambiguous which row is "the one you're viewing" once
            // it's sitting in a list next to items that look just like it.
            const other_items_row = other_items.length > 0 ? `
            <tr>
                <td colspan="7" style="padding-top:0;">
                    <div class="so-hint" style="color:var(--so-orange); margin-top:0;">
                        <i class="fa fa-exclamation-triangle"></i>
                        This Pick List has ${other_items.length + 1} items — Submit acts on the whole document.
                        ${submitted ? '' : 'Adjust any quantity below before submitting:'}
                    </div>
                    <table class="so-table" style="margin-top:4px;">
                        <thead><tr><th>Item</th><th>Warehouse</th><th>Qty</th>${submitted ? '<th>Picked</th>' : ''}</tr></thead>
                        <tbody>
                            <tr class="is-highlighted">
                                <td>${link_id_name('Item', item_code, d.item_name)} <span class="so-chip so-chip--ok">Viewing this item</span></td>
                                <td class="so-meta">${doc.warehouse ? esc(doc.warehouse) : em_dash()}</td>
                                <td>${so_qty(doc.qty || 0)}</td>
                                ${submitted ? `<td>${so_qty(doc.picked_qty || 0, flt(doc.picked_qty) > 0 ? 'info' : null)}</td>` : ''}
                            </tr>
                            ${other_items.map(oi => {
                // Same edit-in-place pattern as this item's own Qty column
                // above — one Submit reads every .so-qty-in on the page for
                // this Pick List, so editing another item's qty here is
                // picked up by that same click, not a separate action.
                const oi_qty_cell = submitted
                    ? so_qty(oi.qty || 0)
                    : `<input type="number" class="so-qty-in" min="0" max="${flt(oi.qty || 0)}" step="any"
                                              value="${flt(oi.qty || 0)}"
                                              data-pick="${esc(doc.pick_list_name)}"
                                              data-row="${esc(oi.pick_list_item || '')}"
                                              data-item="${esc(oi.item_code)}"
                                              title="Edit the quantity to pick down, then Submit — it cannot go above ${flt(oi.qty || 0)}, what was already picked">`;
                return `
                                <tr>
                                    <td>${link_id_name('Item', oi.item_code, oi.item_name)}</td>
                                    <td class="so-meta">${oi.warehouse ? esc(oi.warehouse) : em_dash()}</td>
                                    <td>${oi_qty_cell}</td>
                                    ${submitted ? `<td>${so_qty(oi.picked_qty || 0, flt(oi.picked_qty) > 0 ? 'info' : null)}</td>` : ''}
                                </tr>`;
            }).join('')}
                        </tbody>
                    </table>
                </td>
            </tr>` : '';

            return `
            <tr>
                <td>${link_id_name('Pick List', doc.pick_list_name, doc.customer_name || doc.customer)}</td>
                <td>
                    <span class="so-pill ${submitted ? 'so-pill--dn' : 'so-pill--draft'}">
                        ${submitted ? 'Submitted' : 'Draft'}
                    </span>
                    ${doc.pick_status ? `<div class="so-micro">${esc(doc.pick_status)}</div>` : ''}
                </td>
                <td class="so-meta">${doc.warehouse ? esc(doc.warehouse) : em_dash()}</td>
                <td>${qty_cell}</td>
                <td>${so_qty(doc.picked_qty || 0, flt(doc.picked_qty) > 0 ? 'info' : null)}</td>
                <td>
                    <div class="so-meta">${esc(doc.delivery_status || '—')}</div>
                    <div class="so-micro">${flt(doc.per_delivered || 0).toFixed(0)}% delivered</div>
                </td>
                <td>${action_cell}</td>
            </tr>${other_items_row}`;
        }).join('');

        body_html = so_stats([
            { label: 'Submitted', value: flt(d.picked_submitted_qty_so_actual || 0), unit: d.stock_uom, tone: 'info' },
            { label: 'Draft', value: flt(d.picked_draft_qty_raw !== undefined ? d.picked_draft_qty_raw : d.picked_draft_qty_so || 0) },
            { label: 'Delivered', value: flt(d.delivered_qty || 0), tone: 'pos' },
            { label: 'Required', value: flt(d.required_qty || 0) }
        ])
            + (flt(d.stale_pick_qty || 0) > 0
                ? `<p class="so-hint" style="color:var(--so-orange);">
                 <i class="fa fa-exclamation-triangle"></i>
                 ${flt(d.stale_pick_qty)} of this line was delivered without going through the Pick List,
                 so the Pick List below is still open. Cancel or close it to release the reservation.
               </p>`
                : '')
            + so_section('Pick Lists on this Sales Order', `
            <table class="so-table">
                <thead><tr><th>Pick List</th><th>Status</th><th>Warehouse</th><th>Qty</th><th>Picked</th><th>Delivery</th><th>Action</th></tr></thead>
                <tbody>${doc_rows || '<tr><td colspan="7" class="so-empty">No pick lists found.</td></tr>'}</tbody>
            </table>`, true)
            + (has_draft
                ? `<p class="so-hint"><i class="fa fa-pencil"></i>
                 Edit a draft quantity above and hit Submit — no need to open the Pick List.</p>`
                : '');
    }

    so_open_modal(title, body_html);
}

/**
 * Show conflict details modal for items picked by other Sales Orders.
 */
function show_picked_others_details_modal(pair_key) {
    const d = get_cached_stock_row(pair_key);

    if (!d) {
        frappe.msgprint(__('Stock data not loaded yet. Please refresh the table.'));
        return;
    }
    if (!Array.isArray(d.conflict_details) || !d.conflict_details.length) {
        frappe.msgprint(__('No conflict data available for this item.'));
        return;
    }

    const item_code = d.item_code || String(pair_key || '').split('||')[0];
    const heading = `${item_code}${d.item_name && d.item_name !== item_code ? ` — ${d.item_name}` : ''}`;

    const submitted_qty = flt(d.picked_for_others_qty || 0);
    const draft_qty = flt(d.draft_qty_for_others || 0);

    const rows = d.conflict_details.map(c => {
        const is_submitted = flt(c.docstatus) === 1;
        // held_qty is what the other order is still holding — already-delivered
        // quantity has been netted off server-side.
        const blocked_qty = flt(c.held_qty !== undefined ? c.held_qty
            : (is_submitted ? c.picked_qty : c.qty) || 0);
        return `
        <tr>
            <td>${link_id_name('Pick List', c.pick_list_name)}</td>
            <td>${link_id_name('Sales Order', c.sales_order)}</td>
            <td>${link_name_id('Customer', c.so_customer || c.customer, c.so_customer_name || c.customer_name)}</td>
            <td class="so-meta">${fmt_date(c.so_delivery_date)}</td>
            <td class="so-meta">${c.warehouse ? esc(c.warehouse) : em_dash()}</td>
            <td>
                <span class="so-pill ${is_submitted ? 'so-pill--blocked' : 'so-pill--draft'}">
                    ${is_submitted ? 'Submitted' : 'Draft'}
                </span>
                ${c.pick_status ? `<div class="so-micro">${esc(c.pick_status)}</div>` : ''}
            </td>
            <td>${so_qty(blocked_qty, is_submitted ? 'bad' : 'warn')}</td>
        </tr>`;
    }).join('');

    const needed_here = flt(d.required_qty || 0) - flt(d.delivered_qty || 0);

    so_open_modal(`Stock Conflicts — ${heading}`,
        `<p class="so-modal__lead">These Pick Lists on other Sales Orders are holding the stock this order needs.</p>`
        + so_stats([
            { label: 'Total stock', value: flt(d.total_available_stock || 0), unit: d.stock_uom },
            { label: 'Held (submitted)', value: submitted_qty, tone: 'bad' },
            { label: 'Held (draft)', value: draft_qty, tone: 'warn' },
            { label: 'Needed here', value: needed_here }
        ])
        + so_section('Who is holding it', `
            <table class="so-table">
                <thead><tr>
                    <th>Pick List</th><th>Sales Order</th><th>Customer</th><th>Delivery date</th>
                    <th>Warehouse</th><th>Status</th><th>Held</th>
                </tr></thead>
                <tbody>${rows}</tbody>
                <tfoot><tr>
                    <td colspan="6" class="so-num">Total held</td>
                    <td>${submitted_qty + draft_qty}</td>
                </tr></tfoot>
            </table>`, true)
        + `<p class="so-hint"><i class="fa fa-lightbulb-o" style="margin-top:2px;"></i>
             <span>Cancel or reduce a draft Pick List above to release stock back to this order.</span></p>`);
}


// ================================================================
//  SECTION 9: UTILITY
// ================================================================

function flt(val, precision) {
    const n = parseFloat(val);
    if (isNaN(n)) return 0;
    return precision !== undefined ? parseFloat(n.toFixed(precision)) : n;
}

function so_format_currency(val, currency) {
    if (val === undefined || val === null) return '--';
    return frappe.format(val, { fieldtype: 'Currency', options: currency || undefined });
}

// Escape a value for safe output inside HTML text / attributes.
function esc(val) {
    if (val === undefined || val === null) return '';
    return String(val)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Escape a value used as a single-quoted argument inside an inline onclick="".
// Two layers: JS string escaping first, then HTML attribute escaping — item codes
// here legitimately contain quotes, #, / and &.
function js_str(val) {
    return String(val === undefined || val === null ? '' : val)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function doctype_route(doctype) {
    return String(doctype || '').toLowerCase().trim().replace(/\s+/g, '-');
}

// Document reference: the ID is the link, the human-readable title sits under it.
// Use for transactions (PO / Pick List / Delivery Note / Receipt …).
function link_id_name(doctype, id, title) {
    if (!id) return em_dash();
    const url = `/app/${doctype_route(doctype)}/${encodeURIComponent(id)}`;
    const show = title && String(title).trim() && String(title).trim() !== String(id).trim();
    return `<a class="so-link" href="${url}" target="_blank" title="${esc(doctype)}: ${esc(id)}">${esc(id)}</a>`
        + (show ? `<div class="so-micro so-truncate" title="${esc(title)}">${esc(title)}</div>` : '');
}

// Master reference: the readable name is the link text, the ID sits under it.
// Use for Customer / Supplier / Item / Warehouse.
function link_name_id(doctype, id, name) {
    if (!id && !name) return em_dash();
    if (!id) return esc(name);
    const url = `/app/${doctype_route(doctype)}/${encodeURIComponent(id)}`;
    const show = name && String(name).trim() && String(name).trim() !== String(id).trim();
    return `<a class="so-link so-truncate" href="${url}" target="_blank"
               title="${esc(doctype)}: ${esc(id)}">${esc(show ? name : id)}</a>`
        + (show ? `<div class="so-micro">${esc(id)}</div>` : '');
}

// Dates arriving from the server are raw (YYYY-MM-DD) — never print them unformatted.
// dd-mmm-yyyy everywhere in this dashboard (matches of_date in order_flow.js),
// regardless of the site's own date_format setting.
function fmt_date(val) {
    if (!val) return '--';
    try {
        const date_str = String(val).split(' ')[0];
        if (typeof moment !== 'undefined') {
            const d = moment(date_str);
            if (d.isValid()) return d.format('DD-MMM-YYYY');
        }
        return frappe.datetime.str_to_user(date_str) || '--';
    } catch (e) {
        return esc(val);
    }
}

function em_dash() {
    return '<span class="so-val--zero">—</span>';
}

// A quantity. Zero is always muted — a bright green 0 is noise, not information.
// tone: 'pos' | 'warn' | 'bad' | 'info' | null.   size: 'lg' | null.
function so_qty(val, tone, size) {
    const n = flt(val);
    const cls = ['so-val'];
    if (size === 'lg') cls.push('so-val--lg');
    if (!n) cls.push('so-val--zero');
    else if (tone) cls.push(`so-val--${tone}`);
    return `<div class="${cls.join(' ')}">${val === undefined || val === null ? 0 : val}</div>`;
}

function so_pill(kind, icon, label) {
    return `<span class="so-pill so-pill--${kind}"><i class="fa fa-${icon}"></i> ${esc(label)}</span>`;
}

function so_shortfall(qty) {
    return `<span class="so-shortfall">Shortfall: ${flt(qty)}</span>`;
}

// A Next Action command button. `primary` marks the one step that moves
// this line forward; anything else is a secondary option.
function so_cmd_btn(onclick, icon, label, primary) {
    return `<button class="so-btn${primary ? ' so-btn--primary' : ''}" onclick="${onclick}">`
        + `<i class="fa fa-${icon}"></i> ${esc(label)}</button>`;
}

/**
 * The right way to buy this item.
 * A finished good with a BOM (or flagged as sub-contracted) is not bought off the
 * shelf here — it goes out as job work on a subcontracting PO. Offering a plain
 * Purchase Order for those items sends the user down the wrong path.
 */
function so_buy_btn(d, so_name_arg, item_arg, qty, primary) {
    const subcontract = (d.is_sub_contracted_item || d.is_bom_item) && d.bom_no;
    return subcontract
        ? so_cmd_btn(`so_make_subcontract_po('${so_name_arg}','${item_arg}',${flt(qty)})`,
            'cogs', 'Subcontract PO', primary)
        : so_cmd_btn(`so_make_purchase_order('${so_name_arg}','${item_arg}')`,
            'shopping-cart', 'Purchase Order', primary);
}

// Map an ERPNext document status onto the pill palette.
function so_doc_status(status) {
    if (!status) return em_dash();
    const s = String(status).toLowerCase();
    let kind = 'draft';
    if (/(completed|closed|paid|delivered)/.test(s)) kind = 'ready';
    else if (/(overdue|cancelled|return|unpaid)/.test(s)) kind = 'blocked';
    else if (/(to deliver|to receive|to bill|partly)/.test(s)) kind = 'wait';
    else if (/(submitted|open|in progress|ordered)/.test(s)) kind = 'dn';
    return `<span class="so-pill so-pill--${kind}">${esc(status)}</span>`;
}

// Stat tiles for modal headers. items: [{label, value, unit, tone}]
function so_stats(items) {
    const tiles = items.map(s => {
        const n = flt(s.value);
        const tone = (!n || !s.tone) ? (n ? '' : 'so-val--zero') : `so-val--${s.tone}`;
        return `<div class="so-stat">
            <span class="so-stat__label">${esc(s.label)}</span>
            <div class="so-stat__value ${tone}">${s.value}${s.unit ? `<span class="so-stat__unit">${esc(s.unit)}</span>` : ''}</div>
        </div>`;
    }).join('');
    return `<div class="so-stats">${tiles}</div>`;
}

// A titled modal section. `show` may be a truthy flag or the rows string itself,
// so an empty table is dropped rather than rendered as an empty shell.
function so_section(title, table_html, show, note) {
    if (!show) return '';
    return `<div class="so-modal__section">
        <div class="so-modal__h">${title}${note ? ` <small>${note}</small>` : ''}</div>
        <div class="so-scroll">${table_html}</div>
    </div>`;
}

// Held so in-modal commands (e.g. submitting a Pick List) can close the dialog.
let so_active_dialog = null;

function so_open_modal(title, body_html) {
    inject_so_styles();
    if (so_active_dialog && so_active_dialog.$wrapper && so_active_dialog.$wrapper.is(':visible')) {
        so_active_dialog.set_title(__(title));
        so_active_dialog.fields_dict.content.$wrapper.html(`<div class="so-modal">${body_html}</div>`);
    } else {
        const dialog = new frappe.ui.Dialog({
            title: __(title),
            size: 'extra-large',
            fields: [{ fieldtype: 'HTML', fieldname: 'content' }]
        });
        dialog.fields_dict.content.$wrapper.html(`<div class="so-modal">${body_html}</div>`);
        dialog.show();
        so_active_dialog = dialog;
    }
}

// Read a cached item payload by its "ITEM||BOM" key. Falls back to a prefix
// match so a bare item_code still resolves.
function get_cached_stock_row(pair_key) {
    const cache = (typeof cur_frm !== 'undefined' && cur_frm) ? cur_frm.custom_stock_data : null;
    if (!cache) return null;
    if (cache[pair_key]) return cache[pair_key];
    const prefix = String(pair_key || '').split('||')[0] + '||';
    for (const key of Object.keys(cache)) {
        if (key.startsWith(prefix)) return cache[key];
    }
    return null;
}


function show_bulk_dn_si_modal(frm, submitted_pls, doctype) {
    if (!submitted_pls || !submitted_pls.length) {
        frappe.msgprint(__('No submitted Pick Lists found.'));
        return;
    }

    const grouped = {};
    submitted_pls.forEach(p => {
        const key = `${p.item_code}||${p.warehouse}`;
        if (!grouped[key]) {
            grouped[key] = {
                item_code: p.item_code,
                warehouse: p.warehouse,
                qty: 0,
                pick_lists: new Set()
            };
        }
        grouped[key].qty += flt(p.qty);
        grouped[key].pick_lists.add(p.name);
    });

    const rows_html = Object.values(grouped).map(g => `
        <tr>
            <td><b>${esc(g.item_code)}</b></td>
            <td>${esc(g.warehouse || '—')}</td>
            <td>${so_qty(g.qty)}</td>
            <td class="so-meta">${Array.from(g.pick_lists).join(', ')}</td>
        </tr>
    `).join('');

    const body_html = `
        <div class="so-modal">
            <div class="so-hint" style="margin-bottom:12px;">
                <i class="fa fa-info-circle"></i>
                ${__('Creating a draft <b>{0}</b> mapping the items and quantities picked below:', [doctype])}
            </div>
            <table class="so-table">
                <thead>
                    <tr>
                        <th>Item Code</th>
                        <th>Warehouse</th>
                        <th>Qty</th>
                        <th>Source Pick List(s)</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows_html}
                </tbody>
            </table>
        </div>
    `;

    const dialog = new frappe.ui.Dialog({
        title: __(`Create ${doctype}`),
        size: 'large',
        fields: [
            { fieldtype: 'HTML', fieldname: 'content' }
        ],
        primary_action_label: __(`Create ${doctype}`),
        primary_action: () => {
            dialog.hide();
            frappe.confirm(
                __('Create a draft <b>{0}</b> for customer <b>{1}</b> from these Pick Lists?',
                   [doctype, esc(frm.doc.customer_name || frm.doc.customer)]),
                () => {
                    const unique_pls = Array.from(new Set(submitted_pls.map(p => p.name)));
                    frappe.call({
                        method: 'erp_dacsinc_custom.custom_script.create_dn_or_si_from_pick_lists',
                        args: {
                            sales_order: frm.doc.name,
                            pick_lists: unique_pls,
                            doctype: doctype
                        },
                        freeze: true,
                        freeze_message: __(`Creating ${doctype}…`),
                        callback: (r) => {
                            if (!r.message) return;
                            frappe.model.sync(r.message);
                            frappe.set_route('Form', r.message.doctype, r.message.name);
                        }
                    });
                }
            );
        }
    });
    dialog.fields_dict.content.$wrapper.html(body_html);
    dialog.show();
}

// ================================================================
//  SECTION 10: GLOBAL EXPORTS
//  Frappe loads doctype_js in a module scope — functions used in
//  onclick="" HTML attributes must be explicitly on window so that
//  dynamically-generated table buttons can call them.
// ================================================================

window.create_pick_list_for_item = create_pick_list_for_item;
window.create_pick_list_for_bulk = create_pick_list_for_bulk;
window.show_details_modal = show_details_modal;
window.show_picked_others_details_modal = show_picked_others_details_modal;
window.show_bulk_dn_si_modal = show_bulk_dn_si_modal;

// Next Action commands
window.so_open_doc = so_open_doc;
window.so_make_delivery_note = so_make_delivery_note;
window.so_prompt_dn_or_si = so_prompt_dn_or_si;
window.so_make_sales_invoice_with_stock = so_make_sales_invoice_with_stock;
window.so_make_material_request = so_make_material_request;
window.so_make_rm_material_request = so_make_rm_material_request;
window.so_make_po_from_mr = so_make_po_from_mr;
window.so_make_purchase_order = so_make_purchase_order;
window.so_make_subcontract_po = so_make_subcontract_po;
window.so_submit_pick_list = so_submit_pick_list;
window.so_confirm_submit_pick_list = so_confirm_submit_pick_list;
window.so_fix_stale_pick_lists = so_fix_stale_pick_lists;
