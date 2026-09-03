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
            frm.remove_custom_button('Delivery Note', 'Create');
            frm.remove_custom_button('Sales Invoice', 'Create');
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
        /* Wraps at ANY width, not only on a narrow screen: this header can
           hold a search box plus Refresh, Pick Lists, Create Pick List and two
           Material Request buttons, and without wrapping the last of them was
           simply cut off at the card edge. */
        .so-card__actions {
            display: flex; align-items: center; gap: 8px;
            flex-wrap: wrap; row-gap: 8px; justify-content: flex-end;
        }
        /* The bulk-action holder is one flex ITEM in the row above, so its own
           buttons need to wrap inside it too — otherwise the group overflows
           as a single unrelenting block. */
        #bulk-pick-action-btn {
            display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap;
        }
        /* margin-left on the individual buttons fought the flex gap once they
           started wrapping, leaving ragged first-in-row indents. */
        #bulk-pick-action-btn > .so-btn { margin-left: 0 !important; }
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
        /* Sourcing actions (raise a request for what is short) — deliberately
           distinct from the blue "move it forward" actions. */
        .so-btn--warning { background: var(--so-orange); border-color: var(--so-orange); color: #fff; }
        /* Every coloured .so-btn modifier hover MUST restate its background,
           not just its colour. .so-btn:hover above has the same specificity
           and supplies a LIGHT background, so a modifier setting only
           color:#fff inherits that light background and its label turns
           white-on-white — invisible on hover. A brightness() filter did not
           save it either, since the background being dimmed was already the
           light one. (No backticks in this comment: the whole stylesheet is a
           JS template literal.) */
        .so-btn--warning:hover:not(:disabled) {
            background: #e8590c; border-color: #e8590c; color: #fff;
        }
        /* Used by "Create DN" but never defined, so it rendered as a plain
           button and its hover fell through to the light base style. */
        .so-btn--success { background: var(--so-green); border-color: var(--so-green); color: #fff; }
        .so-btn--success:hover:not(:disabled) {
            background: #1e7e34; border-color: #1e7e34; color: #fff;
        }
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

        /* ── "About to create" preview table (so_show_mapped_doc_preview) ──
           Deliberately independent of --so-blue etc. above: those are scoped
           to .so-card/.so-modal, but this table renders inside a plain
           frappe.ui.Dialog with neither class, so the variables (and the
           header background/border built from them) silently resolved to
           nothing there — a blue-bordered box with invisible white-on-
           nothing header text. Literal colours for the header accent side-
           step that entirely; everything else still follows the active
           theme via Frappe's own global tokens. */
        .doc-preview-wrap {
            border: 1px solid #b9c1c8; border-radius: 8px;
            overflow: hidden; max-height: 320px; overflow-y: auto;
        }
        [data-theme="dark"] .doc-preview-wrap { border-color: #4a5560; }
        .doc-preview-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .doc-preview-table thead th {
            position: sticky; top: 0;
            background: #3498db; color: #fff;
            font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .03em;
            text-align: left; padding: 9px 12px; white-space: nowrap;
        }
        .doc-preview-table thead th.text-right { text-align: right; }
        .doc-preview-table tbody td {
            padding: 9px 12px; border-top: 1px solid #d1d8dd;
            color: var(--text-color); vertical-align: middle;
            /* Some uses of this table set table-layout:fixed, where content
               that cannot wrap is clipped rather than widening its column. */
            word-break: break-word; overflow-wrap: anywhere;
        }
        .doc-preview-table thead th { word-break: break-word; }
        /* Compact label/value breakdown inside a cell — replaces a nested
           <table>, which fought the outer column widths. */
        .doc-preview-calc { font-size: 11px; line-height: 1.6; }
        .doc-preview-calc div { display: flex; justify-content: space-between; gap: 8px; }
        .doc-preview-calc .is-total {
            border-top: 1px solid var(--border-color); margin-top: 3px; padding-top: 3px;
            font-weight: 700;
        }
        [data-theme="dark"] .doc-preview-table tbody td { border-top: 1px solid #434c56; }
        .doc-preview-table tbody tr:first-child td { border-top: none; }
        .doc-preview-table tbody tr:hover td { background: var(--subtle-fg); }
        .doc-preview-table tbody td.text-right { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
        .doc-preview-item-name { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
        .doc-preview-hint { font-size: 12px; color: var(--text-muted); margin: 10px 2px 0; }
        .doc-preview-src__meta {
            font-size: 11px; color: var(--text-muted); margin-top: 2px; line-height: 1.5;
        }
        .doc-preview-src__lines { margin-top: 5px; }
        .doc-preview-src__lines:empty { display: none; }
        .doc-preview-src__line {
            font-size: 11px; line-height: 1.6; padding-left: 8px;
            border-left: 2px solid var(--border-color);
        }
        .doc-preview-src__item { font-weight: 600; }
        .doc-preview-src__qty { font-weight: 700; margin-left: 6px; font-variant-numeric: tabular-nums; }
        .doc-preview-src__from { color: var(--text-muted); margin-left: 6px; }
        /* frappe.format() wraps a Currency value in its own right-aligned
           block — inside this one-line caption that broke the amount onto a
           line of its own, right-aligned, stranding the separator before it
           at the end of the previous line. Force anything it returns inline. */
        .doc-preview-src__meta > * {
            display: inline !important; text-align: inherit !important; margin: 0 !important;
        }
        .doc-preview-src__sep { opacity: .5; padding: 0 2px; }
        .doc-preview-cust__name { font-weight: 600; margin-bottom: 1px; }

        /* ── Source picker ───────────────────────────────────────── */
        /* Deliberately minimal: the picker reuses .doc-preview-table (bordered,
           blue header) so it matches every other dialog here, and native
           checkboxes so the tick can never disagree with the selection. Only
           the toolbar above it needs styling of its own. */
        .so-pick-toolbar {
            display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
            margin: 0 2px 8px;
        }
        .so-pick-toolbar__count {
            margin-left: auto; font-size: 12px; color: var(--text-muted);
        }
        .doc-preview-note {
            margin: 10px 0 0; padding: 8px 10px; border-radius: 6px;
            background: #eef2ff; border: 1px solid #c7d2fe; color: #3730a3;
            font-size: 12px; line-height: 1.5;
        }
        .doc-preview-note:empty { display: none; }
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
        /* Labels here carry a qty suffix ("Create Delivery Note (400)") that
           .so-btn's own base nowrap would otherwise force past the column's
           width — wrap at word boundaries (never mid-word) instead of
           letting the button overflow and read as cut off, on any screen
           size, not just the narrow-viewport case below. */
        .so-action .so-btn {
            white-space: normal;
            height: auto;
            line-height: 1.3;
            text-align: center;
        }
        /* Only shown when a cell offers 2+ real actions (so_build_action_html) —
           a lone action never needs "this is the one to pick" or "or" against
           nothing. Recommended sits directly above the primary button it labels. */
        .so-action__tag {
            font-size: 9px; font-weight: 700; color: var(--so-blue);
            text-transform: uppercase; letter-spacing: .04em; line-height: 1;
        }
        .so-action__or {
            font-size: 9px; font-weight: 700; color: var(--text-light);
            text-transform: uppercase; letter-spacing: .06em; line-height: 1;
        }

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
        /* A visible frame around the whole table — border-collapse merges
           into it cleanly, so the RM card never looks like it bleeds
           straight into the page at its own right/bottom edge. */
        .so-rm table {
            width: 100%; border-collapse: collapse; font-size: 12px;
            border: 1px solid var(--border-color);
            /* Nine dense columns. With table-layout:fixed at width:100% the
               table can never exceed its container, so on a narrow screen it
               silently squeezed every column instead of scrolling — which is
               what made the Status pill and the calc line run out of room in
               the first place, and left the "scroll sideways" hint above it
               with nothing to scroll. A floor means the .so-scroll wrapper
               actually scrolls when there isn't room, and the percentage
               widths apply as intended when there is. */
            min-width: 940px;
        }
        /* Grey header, not a second blue bar — one blue header per card. */
        .so-rm th {
            background: var(--subtle-fg); color: var(--text-muted);
            font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .02em;
            padding: 10px 12px; text-align: center;
            border: 1px solid var(--border-color);
        }
        .so-rm td {
            padding: 12px 10px; text-align: center; vertical-align: middle;
            border: 1px solid var(--border-color); line-height: 1.5;
            /* table-layout is fixed, so anything that cannot wrap gets
               visually cut off instead of widening its column. break-word
               (not anywhere) so wrapping prefers spaces and only splits
               inside a word when a single word genuinely cannot fit —
               "anywhere" was chopping document ids like PUR-ORD-2026-00109
               mid-token even when there was a space to break at. The
               value+uom pairs that must stay on one line opt out with their
               own nowrap span. */
            overflow-wrap: break-word; white-space: normal;
        }
        .so-rm th { overflow-wrap: break-word; }
        /* A status pill must WRAP rather than clip — "In Process at Jobber"
           does not fit one line in this column at any sensible width, and
           nowrap made it lose its last characters. It wraps as a block with
           its own line-height so it still reads as one pill. */
        .so-rm td .so-pill {
            display: inline-block; max-width: 100%;
            white-space: normal; line-height: 1.35; text-align: center;
        }
        .so-rm th:first-child, .so-rm td:first-child { text-align: left; }
        /* Consistent vertical rhythm for a cell stacking several pieces
           (a calc line, a value, a uom, a hint, a button) — one rule here
           instead of an inline margin-top on every individual piece. */
        .so-rm td > * + * { margin-top: 6px; }
        .so-rm tbody tr:nth-child(even) td { background: var(--subtle-fg); }
        .so-rm tbody tr:hover td { background: rgba(52, 152, 219, 0.07); }

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

        /* ── Alert callout ───────────────────────────────────────────
           A proper card (icon badge + title + body + optional action
           row), not just a tinted line of text — used wherever a dialog
           needs to actually stop the reader (an existing draft, a
           partial/excluded-lines note) rather than just footnote it. */
        .so-alert {
            display: flex; gap: 10px; align-items: flex-start;
            padding: 12px 14px; border-radius: 8px; margin: 0 0 14px 0;
            font-size: 12px; line-height: 1.5;
        }
        .so-alert__icon {
            flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            font-size: 12px; color: #fff;
        }
        .so-alert__body { flex: 1 1 auto; min-width: 0; }
        .so-alert__title { font-weight: 700; font-size: 12.5px; color: var(--heading-color); margin-bottom: 3px; }
        .so-alert__text { color: var(--text-color); }
        .so-alert__text b { font-weight: 700; }
        .so-alert__actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }

        .so-alert--warning { background: rgba(253, 126, 20, 0.10); border: 1px solid rgba(253, 126, 20, 0.35); }
        .so-alert--warning .so-alert__icon { background: var(--so-orange); }

        .so-alert--info { background: rgba(52, 152, 219, 0.08); border: 1px solid rgba(52, 152, 219, 0.25); }
        .so-alert--info .so-alert__icon { background: var(--so-blue); }

        .so-alert--muted { background: var(--subtle-fg); border: 1px solid var(--border-color); }
        .so-alert--muted .so-alert__icon { background: var(--so-gray); }

        .so-draft-link {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 6px 11px; border-radius: 6px;
            background: var(--card-bg); border: 1px solid var(--so-orange);
            color: var(--so-orange) !important; font-weight: 600; font-size: 12px;
            text-decoration: none !important; transition: background .12s, color .12s;
        }
        .so-draft-link:hover { background: var(--so-orange); color: #fff !important; }
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

        /* This table genuinely scrolls sideways on a narrow screen (see the
           768px media query below), but a phone hides its scrollbar until you
           touch it — with nothing else on screen, a table cut off at the edge
           just looks broken. This line says outright that there's more to see
           and which way to find it. Hidden on desktop, where it already fits. */
        .so-scroll-hint { display: none; }

        /* ── Responsive: tablet ──────────────────────────────────── */
        @media (max-width: 768px) {
            /* The header row (title + search/refresh/bulk-pick actions) already
               wraps as two flex items via .so-card__head's flex-wrap; let the
               actions themselves wrap too instead of overflowing the card. */
            .so-card__actions { flex-wrap: wrap; row-gap: 8px; }
            .so-search input { width: 130px; }

            /* A long Next-Action label ("Create Sales Invoice", "Subcontract PO")
               inside a table cell should wrap onto a second line rather than
               force the column — and the table's own .so-scroll — wider than
               it needs to be. */
            .so-table td .so-btn {
                white-space: normal;
                height: auto;
                line-height: 1.3;
                word-break: break-word;
            }

            .so-scroll-hint {
                display: flex;
                align-items: center;
                gap: 4px;
                font-size: 10px;
                font-weight: 700;
                color: var(--so-blue);
                padding: 6px 16px;
                border-bottom: 1px solid var(--border-color);
                background: var(--subtle-fg);
            }
        }

        /* ── Responsive: phone ───────────────────────────────────── */
        @media (max-width: 480px) {
            .so-card__actions {
                flex-direction: column;
                align-items: stretch;
                width: 100%;
            }
            .so-search { width: 100%; box-sizing: border-box; }
            .so-search input { width: 100%; }

            /* Chips are normally short enough to stay on one line, but a
               longer label must still be able to wrap instead of forcing an
               even wider horizontal scroll on its table. */
            .so-chip { white-space: normal; font-size: 9px; }
        }
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

    // Which Raw Material rows are open is tracked on the form (updated by the
    // toggle handler itself, see _wire_row_toggle_and_search) rather than read
    // off the DOM here — this function re-runs on far more than an explicit
    // refresh (every action button that creates a document calls it back, as
    // do item_code / qty / warehouse changes), and each render hides every RM
    // row. Scraping the DOM at render time would lose the set whenever two
    // renders overlap, which is exactly when it matters.
    frm._so_open_rows = frm._so_open_rows || [];

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
            <div id="so-next-actions-banner"></div>
            <div id="so-route-banner"></div>
            <div class="so-scroll-hint"><i class="fa fa-arrows-h"></i> ${__('Scroll sideways to see every column')}</div>
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
                            <th style="width:9%;">Status</th>
                            <th style="width:17%; min-width:200px;">Next Action</th>
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

            // SO-wide, not per-item — every item's entry carries the same
            // value (see custom_script.get_item_stock_details_bulk), so the
            // first one found is enough to gate/annotate the whole-order
            // Create DN / Create SI buttons below with it.
            const so_route_lock = Object.values(dataMap)[0]?.so_route_lock || '';
            const $route_banner = container.find('#so-route-banner');
            if (so_route_lock === 'si') {
                $route_banner.html(`
                    <div class="so-hint" style="margin:0 16px 10px 16px; background:var(--so-blue-tint,rgba(52,152,219,0.08)); border-left:3px solid var(--so-blue);">
                        <i class="fa fa-lock"></i> ${__('This order is already on the <b>Sales Invoice (Update Stock)</b> route — no Delivery Note is needed or allowed for the remaining items.')}
                    </div>`);
            } else if (so_route_lock === 'dn') {
                $route_banner.html(`
                    <div class="so-hint" style="margin:0 16px 10px 16px; background:var(--so-blue-tint,rgba(52,152,219,0.08)); border-left:3px solid var(--so-blue);">
                        <i class="fa fa-lock"></i> ${__('This order is already on the <b>Delivery Note</b> route — a direct Sales Invoice (Update Stock) is not allowed for the remaining items.')}
                    </div>`);
            } else {
                $route_banner.html('');
            }

            let eligible_for_picking = false;
            let bulk_eligible_items = {};

            // Whole-order "what do I actually need to do next" — the table
            // below already answers this per line, but a merchandiser
            // scanning a multi-line order for the FIRST thing to act on
            // still has to read every row. Accumulated as three simple,
            // order-wide totals (never re-deriving the per-row logic below
            // — just reading the same numbers each row already computes)
            // and rendered as one short checklist above the table.
            const so_summary = { needs_invoice_qty: 0, ready_to_ship_qty: 0, shortfall_qty: 0 };

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

                // A single Delivery Note / Sales Invoice can carry more than
                // one item ROW against this same Sales Order line (one per
                // Pick List batch that fed it) — row_dns/row_sis are those
                // raw rows, so the SAME document name showed up once per
                // row instead of once per document (a DN picked in 5 batches
                // read as "DN: 00017, 00017, 00017, 00017, 00017"). De-dupe
                // by the parent document name before rendering.
                const _dedupe_by_parent = (rows) => {
                    const seen = new Set();
                    return (rows || []).filter(x => {
                        if (seen.has(x.parent)) return false;
                        seen.add(x.parent);
                        return true;
                    });
                };

                const _build_dn_si_row_links = (d) => {
                    let html = '';
                    const dns = _dedupe_by_parent(d.row_dns);
                    if (dns.length) {
                        const drafts = dns.filter(x => x.docstatus === 0);
                        const subms = dns.filter(x => x.docstatus === 1);
                        if (drafts.length) {
                            const links = drafts.map(x => `<a href="/app/delivery-note/${encodeURIComponent(x.parent)}" target="_blank" title="Draft Delivery Note: ${esc(x.parent)}"><b>${esc(x.parent.substring(x.parent.lastIndexOf('-') + 1))}</b></a>`).join(', ');
                            html += `<div class="so-micro" style="margin-top:2px; color:var(--so-orange);"><i class="fa fa-truck"></i> Draft: ${links}</div>`;
                        }
                        if (subms.length) {
                            const links = subms.map(x => `<a href="/app/delivery-note/${encodeURIComponent(x.parent)}" target="_blank" title="Delivery Note: ${esc(x.parent)}"><b>${esc(x.parent.substring(x.parent.lastIndexOf('-') + 1))}</b></a>`).join(', ');
                            html += `<div class="so-micro" style="margin-top:2px; color:var(--so-green);"><i class="fa fa-truck"></i> DN: ${links}</div>`;
                        }
                    }
                    const sis = _dedupe_by_parent(d.row_sis);
                    if (sis.length) {
                        const drafts = sis.filter(x => x.docstatus === 0);
                        const subms = sis.filter(x => x.docstatus === 1);
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

                // Same three independent zones as the Next Action cell below
                // (billing / ship-what's-ready / source-the-shortfall) — see
                // the FG row's own Status/Next Action logic further down for
                // exactly how each is resolved into an actual action.
                if (flt(item.rate) > 0) {
                    const unbilled_qty = Math.max(0, flt(delivered) - (flt(item.billed_amt) / flt(item.rate)));
                    if (unbilled_qty > 0.01) so_summary.needs_invoice_qty += unbilled_qty;
                }
                if (picked_submitted_undeliv > 0) {
                    so_summary.ready_to_ship_qty += Math.min(picked_submitted_undeliv, Math.max(0, required - delivered));
                }
                if (needed_stock_qty > 0.01) {
                    so_summary.shortfall_qty += needed_stock_qty;
                }

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
                // The Delivery Note is mapped FROM one Pick List, so this must
                // be a Pick List that still has something left to deliver.
                // Taking merely the first SUBMITTED one handed the mapper a
                // fully-delivered Pick List whenever an earlier batch had
                // already shipped — every row mapped at qty 0 and ERPNext threw
                // "Quantity for Item ... cannot be zero", while the button next
                // to it correctly offered the qty still pending on the OTHER
                // pick lists. Confirmed live: an order with pick lists of
                // 90 (fully delivered), 10 and 10 offered "Create Delivery
                // Note (20)" and failed outright.
                const subm_pl = (picks.find(p => flt(p.docstatus) === 1
                    && flt(p.picked_qty) - flt(p.delivered_qty) > 0.001) || {}).pick_list_name || '';
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
                    const is_fully_billed = flt(item.billed_amt) >= flt(item.amount) - 0.01;
                    if (is_fully_billed) {
                        // Fully delivered and fully billed — nothing left to do on this line.
                        status_html = so_pill('done', 'check-circle', 'Completed');
                    } else {
                        // Fully delivered but not fully billed.
                        status_html = so_pill('wait', 'file-text-o', 'SI Pending');
                        const dn_subms = (d.row_dns || []).filter(x => x.docstatus === 1);
                        if (dn_subms.length > 0) {
                            action_parts.push(so_cmd_btn(`so_make_sales_invoice_from_dn('${js_str(pair_key)}')`, 'file-text-o', 'Create Sales Invoice', true));
                        } else {
                            action_parts.push(so_cmd_btn(`so_make_sales_invoice('${so_nm}')`, 'file-text-o', 'Create Sales Invoice', true));
                        }
                    }
                    if (stale_qty > 0 && stale_pl) {
                        status_html += `<div class="so-micro" style="margin-top:4px;color:var(--so-orange);">
                            Pick List still open (${stale_qty})</div>`;
                        action_parts.push(so_cmd_btn(`so_open_doc('Pick List','${js_str(stale_pl)}')`, 'external-link', 'Close Pick List', true));
                    }

                } else if (picked_submitted_undeliv >= (required - delivered)) {
                    // Fully picked → the next command is either a Delivery Note or a
                    // direct Sales Invoice with Update Stock — whichever route this
                    // Sales Order isn't already locked out of (so_route_lock).
                    status_html = so_pill('dn', 'cube', so_dn_si_status_label(d.so_route_lock));
                    if (subm_pl) {
                        action_parts.push(so_cmd_btn(
                            `so_prompt_dn_or_si('${so_nm}','${js_str(item.name)}','${ic_arg}','${js_str(subm_pl)}',${flt(picked_submitted_undeliv)},'${d.so_route_lock || ''}','${js_str(pair_key)}')`,
                            'truck', so_dn_si_action_label(d.so_route_lock, required - delivered), true));
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
                        // Submitting the Pick List and sourcing the balance are two
                        // independent jobs, not alternatives — this line is short
                        // whether or not that draft gets submitted. Stating the
                        // shortfall without offering its own next step (Material
                        // Request / Purchase Order / Order from MR) left the only
                        // actionable thing here as "Submit Pick List", with no way
                        // to act on the rest. '' keeps so_build_action_html from
                        // pairing the two groups as an "or".
                        const sf = so_shortfall_actions(d, so_nm, ic_arg, pair_key, shortage_qty, submitted, false);
                        action_parts.push('');
                        action_parts.push(so_shortfall(shortage_qty, sf.rm_blocks_this ? 0 : d.total_incoming_qty));
                        if (sf.status_note) status_html += sf.status_note;
                        sf.buttons.forEach(b => action_parts.push(b));
                    }
                    // A submitted Pick List can cover only PART of what's still
                    // required (picked_submitted_undeliv not reaching required -
                    // delivered up in the "fully picked" branch above) — but
                    // whatever it DOES cover is real, reserved stock sitting
                    // ready to ship right now. That must never be dropped just
                    // because the rest of the line still needs picking/sourcing —
                    // shipping what's ready and covering the remainder are two
                    // independent actions, not alternatives to choose between
                    // (the trailing '' entry keeps so_build_action_html from
                    // pairing this with whatever action follows it as an "or").
                    if (picked_submitted_undeliv > 0 && subm_pl) {
                        status_html = `<div class="so-micro" style="margin-bottom:4px;color:var(--so-green);font-weight:600;">
                            <i class="fa fa-check-circle"></i> ${flt(picked_submitted_undeliv)} Already Picked — Ready to Ship</div>` + status_html;
                        action_parts.unshift(so_cmd_btn(
                            `so_prompt_dn_or_si('${so_nm}','${js_str(item.name)}','${ic_arg}','${js_str(subm_pl)}',${flt(picked_submitted_undeliv)},'${d.so_route_lock || ''}','${js_str(pair_key)}')`,
                            'truck', so_dn_si_action_label(d.so_route_lock, picked_submitted_undeliv), true), '');
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
                            action_parts.push(so_shortfall(shortage_qty, d.total_incoming_qty));
                            // Same reasoning as the "no stock at all" branch below: never
                            // offer to buy qty an existing incoming PO already covers.
                            const uncovered_by_incoming = Math.max(0, flt(shortage_qty) - flt(d.total_incoming_qty));
                            if (uncovered_by_incoming > 0.01 && submitted) {
                                action_parts.push(so_buy_btn(d, so_nm, ic_arg, uncovered_by_incoming));
                            }
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

                            // Driven by the server's own rm_shortfall_exists (which already
                            // nets out RM still outstanding at a jobber, not just physical
                            // Bin stock) rather than has_incoming — "Incoming" can come from
                            // something entirely unrelated to this FG's own raw material need
                            // (an Embroidery Work Order, a different batch already in transit,
                            // or — the case that prompted this — stock that WAS fully received
                            // for this order and has since been used/diverted elsewhere), so a
                            // real RM shortfall for whatever THIS shortfall still needs to
                            // produce must keep showing, and driving the pill/action shown,
                            // even while something unrelated happens to be en route too.
                            const rm_shortfall_exists = !!(d.rm_procurement_status && d.rm_procurement_status.rm_shortfall_exists);
                            const rm_blocks_this = d.is_bom_item && rm_shortfall_exists;

                            status_html = (has_incoming && !rm_blocks_this)
                                ? so_pill('wait', 'truck', 'Awaiting Stock')
                                : rm_blocks_this
                                    ? so_pill('blocked', 'flask', 'RM Needed')
                                    : (mr_open > 0
                                        ? so_pill('planned', 'file-text-o', 'Requested')
                                        : so_pill('blocked', 'exclamation-triangle', 'Out of Stock'));
                            // Surface the RM block right here too, not only inside the
                            // collapsible Raw Material Pipeline sub-row below — otherwise
                            // "why is there no PO button" is invisible until it's expanded.
                            if (rm_blocks_this) {
                                status_html += `<div class="so-micro" style="margin-top:4px;color:var(--so-red);font-weight:600;">
                                    <i class="fa fa-flask"></i> RM Not in Stock</div>`;
                            }
                            // Incoming is only a real answer to THIS shortfall for a plain
                            // (non-BOM) item — for an RM-blocked BOM item, whatever's
                            // "Incoming" is unrelated (an EWO, a different batch), so it must
                            // never read as if it already covers this shortfall.
                            action_parts.push(so_shortfall(needed_stock_qty, rm_blocks_this ? 0 : d.total_incoming_qty));

                            // Which next step this shortfall actually calls for —
                            // RM pipeline / track incoming / order against an existing
                            // MR / buy it — lives in so_shortfall_actions, shared with
                            // the draft-Pick-List branch above so the two can never
                            // again offer different actions for the same situation.
                            const sf = so_shortfall_actions(d, so_nm, ic_arg, pair_key, needed_stock_qty, submitted, true);
                            if (sf.status_note) status_html += sf.status_note;
                            sf.buttons.forEach(b => action_parts.push(b));
                        }
                    }

                    // A submitted Pick List can cover only PART of what's still
                    // required — picked_submitted_undeliv not reaching required -
                    // delivered up in the "fully picked" branch above falls
                    // through to here instead, but whatever it DOES cover is
                    // real, reserved stock sitting ready to ship right now. That
                    // must never be dropped just because the REST of the line
                    // still shows "Out of Stock"/needs procuring — shipping
                    // what's ready and sourcing the remainder are independent
                    // actions, not alternatives (the trailing '' keeps
                    // so_build_action_html from pairing this with the shortfall's
                    // own action as an "or").
                    if (picked_submitted_undeliv > 0 && subm_pl) {
                        status_html = `<div class="so-micro" style="margin-bottom:4px;color:var(--so-green);font-weight:600;">
                            <i class="fa fa-check-circle"></i> ${flt(picked_submitted_undeliv)} Already Picked — Ready to Ship</div>` + status_html;
                        action_parts.unshift(so_cmd_btn(
                            `so_prompt_dn_or_si('${so_nm}','${js_str(item.name)}','${ic_arg}','${js_str(subm_pl)}',${flt(picked_submitted_undeliv)},'${d.so_route_lock || ''}','${js_str(pair_key)}')`,
                            'truck', so_dn_si_action_label(d.so_route_lock, picked_submitted_undeliv), true), '');
                    }

                } else {
                    // Fully planned → open the pick list that covers it.
                    status_html = so_pill('planned', 'star', 'Fully Planned');
                    const pl = subm_pl || draft_pl;
                    if (pl) {
                        action_parts.push(so_cmd_btn(`so_open_doc('Pick List','${js_str(pl)}')`, 'external-link', 'Open Pick List', true));
                        if (subm_pl) {
                            action_parts.push(so_cmd_btn(
                                `so_prompt_dn_or_si('${so_nm}','${js_str(item.name)}','${ic_arg}','${js_str(subm_pl)}',${flt(picked_submitted_undeliv)},'${d.so_route_lock || ''}','${js_str(pair_key)}')`,
                                'truck', so_dn_si_action_label(d.so_route_lock, picked_submitted_undeliv)));
                        }
                    } else {
                        action_parts.push(`<span class="so-action__note">Proceed from Pick List</span>`);
                    }
                }

                // A line delivered in more than one batch bills in more than
                // one batch too — the branch above only owns billing once
                // the WHOLE line has shipped (delivered >= required), with
                // its own more precise DN-linked check. Every other branch
                // above decides what to do with the REMAINING qty only, with
                // no idea whether whatever's ALREADY out the door has been
                // invoiced yet. A line 100-of-500 delivered must show "needs
                // invoicing" for that 100 right now, not wait for the other
                // 400 to ship first — so this runs independently of
                // whichever branch fired, and is skipped entirely once the
                // line is fully delivered (that case owns itself above).
                if (delivered > 0 && delivered < required && flt(item.rate) > 0) {
                    const unbilled_delivered_qty = Math.max(0, flt(delivered) - (flt(item.billed_amt) / flt(item.rate)));
                    if (unbilled_delivered_qty > 0.01) {
                        status_html = `<div class="so-micro" style="margin-bottom:4px;color:var(--so-info);font-weight:600;">
                            <i class="fa fa-file-text-o"></i> ${flt(unbilled_delivered_qty)} Delivered — Needs Invoice</div>` + status_html;
                        const dn_subms = (d.row_dns || []).filter(x => x.docstatus === 1);
                        action_parts.unshift(dn_subms.length
                            ? so_cmd_btn(`so_make_sales_invoice_from_dn('${js_str(pair_key)}')`, 'file-text-o', `Create Sales Invoice (${flt(unbilled_delivered_qty)})`, true)
                            : so_cmd_btn(`so_make_sales_invoice('${so_nm}')`, 'file-text-o', `Create Sales Invoice (${flt(unbilled_delivered_qty)})`, true), '');
                    }
                }

                const action_html = so_build_action_html(action_parts);

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
                const rm_row_html = get_rm_breakdown_html(d, frm.doc.name, frm.doc.docstatus, pair_key);

                // Rows with a Raw Material pipeline collapse by default; clicking
                // anywhere on the row opens it.
                const main_row = `
                    <tr class="so-row-main${rm_row_html ? ' is-toggleable' : ''}" data-pair-key="${esc(pair_key)}">
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

            // One short checklist, aggregated across every line, so the very
            // first thing someone sees on opening this order is exactly
            // what's left to do — not something they have to find by
            // reading every row's own Next Action cell.
            const summary_parts = [];
            if (so_summary.needs_invoice_qty > 0.01) {
                summary_parts.push(`<span class="so-chip so-chip--warn"><i class="fa fa-file-text-o"></i> ${__('Invoice {0} delivered', [flt(so_summary.needs_invoice_qty)])}</span>`);
            }
            if (so_summary.ready_to_ship_qty > 0.01) {
                summary_parts.push(`<span class="so-chip so-chip--ok"><i class="fa fa-truck"></i> ${__('Ship {0} ready', [flt(so_summary.ready_to_ship_qty)])}</span>`);
            }
            if (so_summary.shortfall_qty > 0.01) {
                summary_parts.push(`<span class="so-chip so-chip--bad"><i class="fa fa-shopping-cart"></i> ${__('Source {0} shortfall', [flt(so_summary.shortfall_qty)])}</span>`);
            }
            container.find('#so-next-actions-banner').html(summary_parts.length ? `
                <div class="so-hint" style="margin:0 16px 10px 16px; display:flex; align-items:center; flex-wrap:wrap; gap:8px;">
                    <b>${__('To complete this order')}:</b> ${summary_parts.join(' ')}
                </div>` : '');

            _wire_row_toggle_and_search(container, tbody, frm);

            // ── Bulk Pick List button ─────────────────────────────────
            const bulk_items = Object.values(bulk_eligible_items).filter(x => x.so_lines.length > 0);
            const total_bulk_qty = bulk_items.reduce((t, x) => t + x.total_eligible_pick_qty, 0);
            eligible_for_picking = (frm.doc.docstatus === 1) && (total_bulk_qty > 0);

            const $bulk_btn = container.find('#bulk-pick-action-btn');
            const render_create_btn = () => {
                const dn_names = so_get_all_submitted_dn_names(frm);
                const pending_rm_count = (frm.doc.docstatus === 1) ? so_collect_pending_rm(frm).length : 0;
                const pending_fg_count = (frm.doc.docstatus === 1) ? so_collect_pending_fg(frm).length : 0;
                $bulk_btn.html(`
                    <button class="so-btn so-btn--primary" id="btn-create-bulk-picklist" ${!eligible_for_picking ? 'disabled' : ''}
                            title="${eligible_for_picking ? 'Pick every pickable line' : 'Nothing pickable yet'}">
                        <i class="fa fa-clipboard"></i> Create Pick List${total_bulk_qty > 0 ? ` · ${Math.floor(total_bulk_qty)}` : ''}
                    </button>
                    ${pending_rm_count > 0 ? `
                        <button class="so-btn so-btn--warning" id="btn-create-mr-all-rm" style="margin-left:6px;"
                                title="Raw materials of the BOM items">
                            <i class="fa fa-flask"></i> Raw Material MR · ${pending_rm_count}
                        </button>
                    ` : ''}
                    ${pending_fg_count > 0 ? `
                        <button class="so-btn so-btn--warning" id="btn-create-mr-all-fg" style="margin-left:6px;"
                                title="Items bought, not made">
                            <i class="fa fa-cube"></i> Finished Item MR · ${pending_fg_count}
                        </button>
                    ` : ''}
                    ${dn_names.length > 0 ? `
                        <button class="so-btn so-btn--primary" id="btn-create-si-all-dns" style="margin-left:6px;"
                                title="One SI from all submitted DNs">
                            <i class="fa fa-file-text-o"></i> Create SI (All DNs)
                        </button>
                    ` : ''}
                `);
                if (eligible_for_picking) {
                    $bulk_btn.find('#btn-create-bulk-picklist').on('click', () => {
                        create_pick_list_for_bulk(frm, bulk_items, total_bulk_qty);
                    });
                }
                if (pending_rm_count > 0) {
                    $bulk_btn.find('#btn-create-mr-all-rm').on('click', () => {
                        so_make_rm_material_request_all(frm);
                    });
                }
                if (pending_fg_count > 0) {
                    $bulk_btn.find('#btn-create-mr-all-fg').on('click', () => {
                        so_make_fg_material_request_all(frm);
                    });
                }
                if (dn_names.length > 0) {
                    $bulk_btn.find('#btn-create-si-all-dns').on('click', () => {
                        so_make_sales_invoice_from_all_dns(frm);
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
                // A Pick List already Completed has nothing left to deliver
                // or invoice — excluded. "Partly Delivered" still has a
                // remaining un-delivered balance on its line (picked_qty
                // minus what's already gone out), so it belongs in this
                // flow too; show_bulk_dn_si_modal and
                // create_dn_or_si_from_pick_lists both compute that
                // remainder rather than the full picked_qty, so only the
                // outstanding balance ever gets mapped into the new DN/SI.
                // "Open" is this doctype's own core status for "nothing
                // delivered yet" — there is no "Submitted" option here.
                const eligible_pls = submitted_pls.filter(x => ['Open', 'Partly Delivered'].includes(x.status || 'Open'));
                const already_processed_count = submitted_pls.length - eligible_pls.length;

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

                const dn_names = so_get_all_submitted_dn_names(frm);
                const pending_rm_count = (frm.doc.docstatus === 1) ? so_collect_pending_rm(frm).length : 0;
                const pending_fg_count = (frm.doc.docstatus === 1) ? so_collect_pending_fg(frm).length : 0;
                $bulk_btn.html(`
                    <button class="so-btn so-btn--primary" id="btn-view-picklists">
                        <i class="fa fa-clipboard"></i> Pick Lists (${existing_pls.length})
                        ${draft_count ? `<span class="so-chip">${draft_count} draft</span>` : ''}
                    </button>
                    ${eligible_for_picking ? `
                        <button class="so-btn" id="btn-create-bulk-picklist" style="margin-left:6px;"
                                title="Pick the remaining qty">
                            <i class="fa fa-plus"></i> New${total_bulk_qty > 0 ? ` · ${Math.floor(total_bulk_qty)}` : ''}
                        </button>
                    ` : ''}
                    ${eligible_pls.length > 0 && so_route_lock !== 'si' ? `
                        <button class="so-btn so-btn--success" id="btn-bulk-create-dn" style="margin-left:6px;"
                                title="DN from Pick Lists">
                            <i class="fa fa-truck"></i> Create DN
                            ${unique_draft_dns.size ? `<span class="so-chip" style="background:var(--so-orange); margin-left:4px;">${unique_draft_dns.size} draft</span>` : ''}
                        </button>
                    ` : ''}
                    ${eligible_pls.length > 0 && so_route_lock !== 'dn' ? `
                        <button class="so-btn so-btn--primary" id="btn-bulk-create-si" style="margin-left:6px;"
                                title="SI (Update Stock) from Pick Lists">
                            <i class="fa fa-file-text-o"></i> Create SI
                            ${unique_draft_sis.size ? `<span class="so-chip" style="background:var(--so-orange); margin-left:4px;">${unique_draft_sis.size} draft</span>` : ''}
                        </button>
                    ` : ''}
                    ${pending_rm_count > 0 ? `
                        <button class="so-btn so-btn--warning" id="btn-create-mr-all-rm" style="margin-left:6px;"
                                title="Raw materials of the BOM items">
                            <i class="fa fa-flask"></i> Raw Material MR · ${pending_rm_count}
                        </button>
                    ` : ''}
                    ${pending_fg_count > 0 ? `
                        <button class="so-btn so-btn--warning" id="btn-create-mr-all-fg" style="margin-left:6px;"
                                title="Items bought, not made">
                            <i class="fa fa-cube"></i> Finished Item MR · ${pending_fg_count}
                        </button>
                    ` : ''}
                    ${dn_names.length > 0 ? `
                        <button class="so-btn so-btn--primary" id="btn-create-si-all-dns" style="margin-left:6px;"
                                title="One SI from all submitted DNs">
                            <i class="fa fa-file-text-o"></i> Create SI (All DNs)
                        </button>
                    ` : ''}
                `);
                $bulk_btn.find('#btn-view-picklists').on('click', () => show_so_picklists_modal(frm, existing_pls));
                if (eligible_for_picking) {
                    $bulk_btn.find('#btn-create-bulk-picklist').on('click', () => {
                        create_pick_list_for_bulk(frm, bulk_items, total_bulk_qty);
                    });
                }
                if (eligible_pls.length > 0 && so_route_lock !== 'si') {
                    $bulk_btn.find('#btn-bulk-create-dn').on('click', () => {
                        show_bulk_dn_si_modal(frm, eligible_pls, 'Delivery Note', already_processed_count, Array.from(unique_draft_dns));
                    });
                }
                if (eligible_pls.length > 0 && so_route_lock !== 'dn') {
                    $bulk_btn.find('#btn-bulk-create-si').on('click', () => {
                        show_bulk_dn_si_modal(frm, eligible_pls, 'Sales Invoice', already_processed_count, Array.from(unique_draft_sis));
                    });
                }
                if (pending_rm_count > 0) {
                    $bulk_btn.find('#btn-create-mr-all-rm').on('click', () => {
                        so_make_rm_material_request_all(frm);
                    });
                }
                if (pending_fg_count > 0) {
                    $bulk_btn.find('#btn-create-mr-all-fg').on('click', () => {
                        so_make_fg_material_request_all(frm);
                    });
                }
                if (dn_names.length > 0) {
                    $bulk_btn.find('#btn-create-si-all-dns').on('click', () => {
                        so_make_sales_invoice_from_all_dns(frm);
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

    const table_html = `<div class="so-scroll"><table class="so-table">
        <thead><tr><th>Sales Order</th><th>Customer</th><th>Pick List</th><th>Item</th><th>Qty</th><th>Warehouse</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows_html}</tbody>
    </table></div>`;

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
function _wire_row_toggle_and_search(container, tbody, frm) {
    const $rows = tbody.find('tr.so-row-main');
    const open_keys = (frm && frm._so_open_rows) || [];

    // Cache the searchable text once, including the collapsed RM rows.
    $rows.each(function () {
        const rm = $(this).next('tr.so-rm-row');
        this._so_search = ((this.textContent || '') + ' ' + (rm.length ? rm.text() : ''))
            .toLowerCase().replace(/\s+/g, ' ');
    });

    // Collapse by default, then re-open whatever was open before this render.
    tbody.find('tr.so-rm-row').hide();
    if (open_keys.length) {
        $rows.each(function () {
            const key = String($(this).data('pairKey') || '');
            if (!key || open_keys.indexOf(key) === -1) return;
            const $rm = $(this).next('tr.so-rm-row');
            if (!$rm.length) return;
            $(this).addClass('is-open');
            $rm.show();
        });
    }

    tbody.on('click', 'tr.so-row-main.is-toggleable', function (e) {
        // Never swallow a click meant for a control inside the row — matches
        // any actual interactive element AND anything wired up with its own
        // onclick (a plain so-chip/so-micro span can still carry one), not
        // just the standard tag names, so a click on it can never also
        // toggle the row underneath it.
        if ($(e.target).closest('a, button, input, select, textarea, [onclick]').length) return;

        const $row = $(this);
        const $rm = $row.next('tr.so-rm-row');
        if (!$rm.length) return;

        const open = !$row.hasClass('is-open');
        $row.toggleClass('is-open', open);
        $rm.toggle(open);

        // Record it so the next render (which may be triggered by any action
        // on this row) restores it instead of collapsing it.
        if (frm) {
            const key = String($row.data('pairKey') || '');
            frm._so_open_rows = (frm._so_open_rows || []).filter(k => k !== key);
            if (open && key) frm._so_open_rows.push(key);
        }
    });

    const $search = container.find('#so-item-search');
    const $count = container.find('#so-search-count');

    const apply_filter = () => {
        const term = ($search.val() || '').trim().toLowerCase();
        const words = term ? term.split(/\s+/) : [];
        let shown = 0;

        $rows.each(function () {
            const search_text = (this._so_search || '').toLowerCase();
            const match = !term || words.every(word => search_text.indexOf(word) !== -1);
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

            // "1 PO · 300 pending" and "300 Received" (a separate footnote
            // further down, since received qty is already counted in
            // Available Stock, not incoming) used to read as two unrelated
            // facts — a reader had to do the arithmetic themselves to
            // realize the PO was actually for 600 and half of it had
            // already arrived. Spell that out directly wherever any of
            // these POs already has SOME of it received.
            const ordered_qty = pending_pos.reduce((a, p) => a + flt(p.ordered_qty || 0), 0);
            const received_qty = pending_pos.reduce((a, p) => a + flt(p.received_qty || 0), 0);
            const partial_note = received_qty > 0.001
                ? `<div class="so-brk__sub" style="color:var(--so-orange); font-weight:600;">
                       ${__('Partially Received ({0} of {1})', [flt(received_qty), flt(ordered_qty)])}
                   </div>`
                : '';

            html += `<div class="so-brk">
                <div class="so-brk__label">${pending_pos.length} PO · ${flt(po_qty)} ${__('pending')}${is_subcon ? ` <span class="so-chip so-chip--sc">SC</span>` : ''}</div>
                ${partial_note}
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
        // "Other PO" mixes two different things that used to look identical
        // at a glance: unclaimed general stock (no sales_order at all — could
        // still end up covering this order) versus a PO already earmarked
        // for a SPECIFIC different Sales Order (spoken for, not really up
        // for grabs). The View button's modal already tells them apart per
        // row (see other_rows in show_details_modal) — this line now does
        // too, so the reader doesn't have to click through just to find out
        // whether this number is worth chasing.
        const other_list = d.other_po_list || [];
        const other_general_qty = other_list.filter(p => !p.sales_order).reduce((s, p) => s + flt(p.pending_qty || 0), 0);
        const other_reserved_qty = Math.max(0, flt(d.total_other_po_qty) - other_general_qty);
        html += `<div class="so-micro" title="Neither figure counts toward this row's own need — general stock is unclaimed and could still help, reserved stock already belongs to a different Sales Order">
            +${flt(other_general_qty)} Unclaimed${other_reserved_qty > 0 ? ` &middot; +${flt(other_reserved_qty)} Reserved Elsewhere` : ''} (Other POs)
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

function get_rm_breakdown_html(data, so_name, docstatus, pair_key) {
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
        // Drafts commit nothing yet, so they're never in rm_pending_mr_total/
        // rm_pending_so_linked_total — but the "Material Request" button just
        // creates one and opens it for review, so without this a click here
        // would show no trace at all until someone remembers to submit it.
        if (item.draft_mr_documents && item.draft_mr_documents.length) {
            const draft_mr_links = item.draft_mr_documents.filter(Boolean).map(mr =>
                `<a href="/app/material-request/${encodeURIComponent(mr)}" target="_blank" title="Draft Material Request: ${esc(mr)}" style="color:#805ad5; font-weight:bold; text-decoration:underline;">${esc(mr)}</a>`
            ).join(', ');
            if (draft_mr_links) refs.push(`<b>MR (Draft):</b> ${draft_mr_links}`);
        }
        if (item.draft_po_documents && item.draft_po_documents.length) {
            const draft_po_links = item.draft_po_documents.filter(Boolean).map(po =>
                `<a href="/app/purchase-order/${encodeURIComponent(po)}" target="_blank" title="Draft Purchase Order: ${esc(po)}" style="color:#2b6cb0; font-weight:bold; text-decoration:underline;">${esc(po)}</a>`
            ).join(', ');
            if (draft_po_links) refs.push(`<b>PO (Draft):</b> ${draft_po_links}`);
        }
        if (item.transfer_documents && item.transfer_documents.length) {
            // The Purchase Order is what this flow is actually managed from —
            // a reference naming only the Subcontracting Order left no way
            // back to that document, so it's shown first/primary, with the
            // SCO itself named alongside for the specific reservation it is.
            const po_list = (item.transfer_po_documents || []).filter(Boolean);
            const po_links = po_list.map(po =>
                `<a href="/app/purchase-order/${encodeURIComponent(po)}" target="_blank" title="Purchase Order: ${esc(po)}" style="color:#2b6cb0; font-weight:bold; text-decoration:underline;">${esc(po)}</a>`
            ).join(', ');
            const sco_links = item.transfer_documents.filter(Boolean).map(sco =>
                `<a href="/app/subcontracting-order/${encodeURIComponent(sco)}" target="_blank" title="Subcontracting Order — still holding this raw material, not yet received back as finished goods: ${esc(sco)}" style="color:#c05621; font-weight:bold; text-decoration:underline;">${esc(sco)}</a>`
            ).join(', ');
            refs.push(`<b>Outstanding at Jobber:</b> ${po_links ? `PO ${po_links}` : ''}${po_links && sco_links ? ' &middot; ' : ''}${sco_links ? `SC ${sco_links}` : ''}`);
        }

        const shortfall_qty = flt(item.rm_shortfall_total || 0);
        // Four distinct states, not a covered/shortfall binary: "Covered"
        // means stock is actually in hand; "Requested" means a pending
        // MR/PO closes the gap but nothing has arrived yet; "Not Required"
        // means this RM isn't being drawn on right now at all (e.g. the
        // finished good already has enough stock) — collapsing any of these
        // into "Covered" reads as "the stock is here" when it may not be,
        // which is exactly backwards.
        const rm_status = item.status || (shortfall_qty > 0 ? 'Shortage' : 'Covered');
        const status_pill_class = shortfall_qty > 0 ? 'so-pill--blocked'
            : rm_status === 'In Process at Jobber' ? 'so-pill--planned'
            : rm_status === 'Requested' ? 'so-pill--wait'
            : rm_status === 'Not Required' ? 'so-pill--draft'
            : 'so-pill--ready';
        // "In Process at Jobber" can still be a MIX — part of the need
        // already sent (job work started on that much), the rest still only
        // a pending MR/PO with nothing moved yet. Spelling out the actual
        // split here rather than letting one status word stand in for both.
        const still_just_requested = flt(item.rm_pending_mr_total || 0) + flt(item.rm_pending_so_linked_total || 0);
        const in_process_note = (rm_status === 'In Process at Jobber' && still_just_requested > 0.001)
            ? `<div class="so-micro" style="margin-top:2px;">+ ${flt(still_just_requested, 2)} ${esc(uom)} still just requested</div>`
            : '';
        const rm_name = item.rm_name && item.rm_name !== item.rm_code ? item.rm_name : '';

        return `
            <tr>
                <td>
                    <a class="so-link" href="/app/item/${encodeURIComponent(item.rm_code)}" target="_blank"
                       title="Item: ${esc(item.rm_code)}">${esc(item.rm_code)}</a>
                    ${rm_name ? `<div class="so-micro so-truncate" title="${esc(rm_name)}">${esc(rm_name)}</div>` : ''}
                </td>
                <td>
                    <div class="so-micro" style="font-family:monospace;"
                         title="This order's own finished-good shortfall (qty still to produce, after its stock/picks/MR/PO) × how much of this raw material one unit of the finished good needs.">
                        ${flt(rm.fg_shortfall || 0).toFixed(2)} &times; ${flt(item.rm_qty_per_fg || 0).toFixed(2)}<span style="white-space:nowrap;">/unit</span>
                    </div>
                    <div style="white-space:nowrap;">
                        <span class="so-val" title="What this row's Shortfall is actually calculated from: Stock/Pending MR/Pending PO below are subtracted from THIS number, not from the full order total shown as 'Full Order'.">${flt(item.rm_needed_for_shortfall || 0).toFixed(2)}</span>
                        <span class="so-micro">${esc(uom)}</span>
                    </div>
                    ${flt(item.rm_required_total || 0).toFixed(2) !== flt(item.rm_needed_for_shortfall || 0).toFixed(2)
                        ? `<div class="so-micro" title="The full BOM requirement if this order's entire quantity were produced from scratch — this item's own finished-good stock/picks already reduce how much new production (and therefore raw material) is actually needed right now">Full Order: ${flt(item.rm_required_total || 0).toFixed(2)}</div>`
                        : ''}
                </td>
                <td>
                    ${so_qty(flt(item.rm_available_stock || 0).toFixed(2))}
                    <div class="so-micro" title="Counted at VV Puram - IND only">at VV Puram - IND</div>
                    ${(item.rm_stock_breakdown || []).length > 1 || ((item.rm_stock_breakdown || [])[0] || {}).warehouse !== 'VV Puram - IND'
                        ? `<button class="so-btn so-btn--view" style="margin-top:2px;"
                               onclick="show_details_modal('${js_str(pair_key)}','rm_stock_details','${js_str(item.rm_code)}')">
                               <i class="fa fa-eye"></i> View</button>`
                        : ''}
                    ${flt(item.rm_transferred_to_other_so_total || 0) > 0
                        ? `<div class="so-micro" style="color:var(--so-red); margin-top:2px;"
                               title="This raw material was bought in a shared batch — this much of that same purchase is currently outstanding at a subcontractor for OTHER Sales Orders (sent but not yet consumed into their finished goods), which is why Stock is lower than the full purchase would suggest.">
                               ⚠ ${flt(item.rm_transferred_to_other_so_total, 2).toFixed(2)} outstanding at jobber for other orders</div>`
                        : ''}
                </td>
                <td>${so_qty(flt(item.rm_pending_mr_total || 0).toFixed(2))}</td>
                <td>${so_qty(flt(item.rm_pending_so_linked_total || 0).toFixed(2))}</td>
                <td title="${flt(item.rm_transferred_to_sc_total || 0) > 0
                ? 'Sent to the subcontractor\'s warehouse for this order and still outstanding there — not yet consumed into a Subcontracting Receipt, so it still counts as coverage. Once it\'s consumed, it shows up as finished-good stock instead and drops out of this figure.'
                : ''}">
                    ${so_qty(flt(item.rm_transferred_to_sc_total || 0).toFixed(2))}
                </td>
                <td class="so-meta" style="max-width:210px; word-break:break-word; line-height:1.6;">
                    ${refs.join('<br>') || '<span class="so-micro">—</span>'}
                </td>
                <td>
                    <span class="so-pill ${status_pill_class}" title="${rm_status === 'In Process at Jobber'
                ? 'This raw material has already been sent to the subcontractor for this order — job work has physically started on however much went, so nothing new needs requesting for that portion'
                : rm_status === 'Requested'
                    ? 'A Material Request or Purchase Order has been raised to cover this, but nothing has arrived (or been sent to a subcontractor) yet'
                : rm_status === 'Not Required'
                    ? 'This item already has enough stock, so this raw material is not needed right now'
                    : ''}">
                        ${esc(rm_status)}
                    </span>
                    ${in_process_note}
                </td>
                <td style="min-width:200px; text-align:left;">
                    ${shortfall_qty > 0
                ? `<div style="text-align:center; white-space:nowrap;"><span class="so-val so-val--bad">${shortfall_qty.toFixed(2)}</span> <span class="so-micro">${esc(uom)}</span></div>
                           <div class="so-micro" style="max-width:190px;" title="Once ${shortfall_qty.toFixed(2)} ${esc(uom)} of this raw material is in stock at VV Puram, the FG-level Next Action above will offer a Subcontract PO for the remaining production.">
                               <i class="fa fa-arrow-down"></i> Request ${shortfall_qty.toFixed(2)} ${esc(uom)} below to unblock a new Subcontract PO
                           </div>
                           ${submitted ? `<button class="so-btn so-btn--primary" style="white-space:normal; text-align:left; max-width:100%;"
                               onclick="so_make_rm_material_request('${js_str(so_name)}','${js_str(item.rm_code)}',${shortfall_qty},'${js_str(uom)}','${js_str(data.warehouse || '')}')">
                               <i class="fa fa-file-text-o"></i> Material Request</button>` : ''}`
                : `<div style="text-align:center;"><span class="so-val so-val--zero">—</span></div>`}
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
    // "Covered" and "still just Requested" both mean no NEW action is needed,
    // but they are not the same fact: Covered means the stock is physically in
    // hand; Requested means a pending MR/PO closes the gap on paper only,
    // nothing has arrived. Collapsing them said "Materials Covered" the moment
    // an MR was raised, with every row underneath still showing 0.00 in Stock —
    // exactly the "stock is here" claim that isn't true yet.
    const pending_arrival = !has_shortfall && !!rm.rm_pending_arrival_exists;
    // Material already sent to the jobber is a materially further-along
    // state than a plain pending MR/PO — job work has physically started on
    // whatever went. Takes priority over the plain "Requested" wording
    // whenever any row's coverage includes it, even if some OTHER row is
    // still only a paper request (that row's own per-row status still says
    // "Requested" — this header just doesn't understate the ones that
    // aren't).
    const in_process = !has_shortfall && !!rm.rm_in_process_exists;
    const fg_already_stocked = !(flt(rm.fg_shortfall) > 0);

    const header_pill_class = has_shortfall ? 'so-pill--blocked'
        : in_process ? 'so-pill--planned'
        : pending_arrival ? 'so-pill--wait' : 'so-pill--ready';
    const header_pill_label = has_shortfall
        ? `Shortage on ${items_with_shortage} Material${items_with_shortage === 1 ? '' : 's'}`
        : in_process ? 'Sent to Jobber — In Process'
        : pending_arrival ? 'Requested — Awaiting Arrival' : 'Materials Covered';
    const header_pill_title = has_shortfall
        ? 'Stock on hand plus what is already requested or ordered still falls short of what this order needs'
        : in_process
            ? 'The raw material this needs has already been sent to the subcontractor — job work has started, nothing further to request right now'
        : pending_arrival
            ? 'A Material Request or Purchase Order has been raised for every material below, but none of it has arrived yet'
            : 'Every raw material below is either already in stock or not needed for this order right now';

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
                        <span class="so-pill ${header_pill_class}" title="${header_pill_title}">
                            ${header_pill_label}
                        </span>
                        ${fg_already_stocked
            ? `<span class="so-chip" style="background:var(--so-info);color:#fff;" title="This item already has enough stock for this order, so nothing new needs to be produced right now. The materials listed below are shown for reference only.">
                                   <i class="fa fa-info-circle"></i> FG Already in Stock — No Production Needed Now
                               </span>`
            : ''}
                        <span class="so-rm__spacer"></span>
                        <span class="so-rm__note">Coverage = Stock + Pending MR + Pending PO + Outstanding at Jobber</span>
                    </div>
                    <div class="so-scroll-hint"><i class="fa fa-arrows-h"></i> ${__('Scroll sideways to see every column')}</div>
                    <div class="so-scroll">
                    <table style="table-layout:fixed;">
                        <thead>
                            <tr>
                                <th style="width:13%;">RM Item</th>
                                <th style="width:12%;">Needed</th>
                                <th style="width:10%;">Stock</th>
                                <th style="width:7%;">Pending MR</th>
                                <th style="width:7%;">Pending PO</th>
                                <th style="width:9%;" title="Outstanding at Jobber">At Jobber</th>
                                <th style="width:12%;">References</th>
                                <th style="width:13%;">Status</th>
                                <th style="width:17%;">Shortfall</th>
                            </tr>
                        </thead>
                        <tbody>${rows || '<tr><td colspan="9" class="so-empty">No Raw Material Data Available.</td></tr>'}</tbody>
                    </table>
                    </div>
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
            // Unsaved draft — only exists in this tab's client-side cache, so a
            // new browser tab has nothing to fetch and would render blank.
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

// Maps the requested doc (nothing saved yet), then shows exactly what it
// contains — item, qty, warehouse — before opening it, so "Create X?" is
// never just a bare text guess at what's about to happen. Cancelling
// discards the mapped draft having changed nothing.
function so_open_mapped_doc(opts) {
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
            // the client-side cache (the mapped doc plus any children) — the
            // mapped doc itself is always the first one.
            const doc = frappe.model.sync(r.message)[0];
            if (opts.after_map) opts.after_map(doc);
            so_show_mapped_doc_preview(doc, opts);
        }
    });
}

function so_show_mapped_doc_preview(doc, opts) {
    inject_so_styles();
    opts = opts || {};
    const items = doc.items || [];
    if (!items.length) {
        frappe.msgprint(__('Nothing to create — every line is already fully processed.'));
        return;
    }
    // Which source document each mapped line actually came from. Warehouse
    // used to sit in this column and told the reader nothing they needed at
    // this point — "which Delivery Note am I invoicing?" is the real
    // question when a Sales Invoice is being raised from one or more DNs,
    // and a bare item list can't answer it.
    // Precedence matters: a Purchase Order mapped FROM a Material Request
    // carries BOTH material_request and sales_order on every row, and the
    // document actually being created from — the one this dialog's links must
    // lead back to — is the Material Request. Ordering sales_order first sent
    // "Review Purchase Order — from Material Request" to the Sales Order
    // instead, so the MR it was raised from appeared nowhere.
    const source_field = items.some(it => it.material_request) ? 'material_request'
        : items.some(it => it.delivery_note) ? 'delivery_note'
            : items.some(it => it.purchase_receipt) ? 'purchase_receipt'
                : items.some(it => it.sales_order) ? 'sales_order'
                    : null;
    const SOURCE_DOCTYPE = {
        material_request: 'Material Request',
        delivery_note: 'Delivery Note',
        purchase_receipt: 'Purchase Receipt',
        sales_order: 'Sales Order',
    };
    const source_doctype = SOURCE_DOCTYPE[source_field] || null;
    const source_names = source_field
        ? [...new Set(items.map(it => it[source_field]).filter(Boolean))]
        : [];

    // Who the line is ultimately for. Shown whenever the rows carry a Sales
    // Order that ISN'T already the source column — on a PO raised from an MR
    // the source is the MR, and without this the customer the whole order
    // exists to serve appeared nowhere in the review.
    const show_customer = source_field !== 'sales_order' && items.some(it => it.sales_order);
    const customer_so_names = show_customer
        ? [...new Set(items.map(it => it.sales_order).filter(Boolean))]
        : [];

    const rows = items.map(it => {
        const src = source_field ? (it[source_field] || '') : '';
        return `
        <tr>
            <td>${esc(it.item_code || '')}${it.item_name && it.item_name !== it.item_code
                ? `<div class="doc-preview-item-name">${esc(it.item_name)}</div>` : ''}</td>
            <td class="text-right">${flt(it.qty, 2)} ${esc(it.uom || it.stock_uom || '')}</td>
            ${source_field ? `<td class="doc-preview-src" data-src="${esc(src)}">${src
                ? `<a class="so-link" href="/app/${doctype_route(source_doctype)}/${encodeURIComponent(src)}"
                       target="_blank">${esc(src)}</a>
                   <div class="doc-preview-src__meta"><i class="fa fa-spinner fa-spin"></i></div>`
                : em_dash()}</td>` : ''}
            ${show_customer ? `<td class="doc-preview-cust" data-so="${esc(it.sales_order || '')}">${it.sales_order
                ? `<div class="doc-preview-cust__name"><i class="fa fa-spinner fa-spin"></i></div>
                   <a class="so-link" href="/app/sales-order/${encodeURIComponent(it.sales_order)}"
                      target="_blank" style="font-size:11px;">${esc(it.sales_order)}</a>`
                : em_dash()}</td>` : ''}
        </tr>`;
    }).join('');

    const dialog = new frappe.ui.Dialog({
        title: opts.preview_title || __('Review before creating'),
        fields: [{ fieldtype: 'HTML', fieldname: 'preview' }],
        primary_action_label: opts.confirm_label || __('Create'),
        primary_action: () => {
            dialog.hide();
            // The mapped doc is unsaved — it exists only in THIS tab's
            // client-side cache, which a new browser tab has no access to
            // (and there's nothing to fetch from the server for a doc that
            // was never inserted), so opening it in a new tab rendered a
            // blank form. Navigating in the same tab (frappe.set_route,
            // same as every other "Create mapped doc" action across
            // Frappe/ERPNext) is what actually opens it pre-filled.
            frappe.set_route('Form', doc.doctype, doc.name);
        },
        secondary_action_label: __('Cancel'),
        secondary_action: () => dialog.hide()
    });
    dialog.fields_dict.preview.$wrapper.html(`
        <div class="doc-preview-wrap"><table class="doc-preview-table">
            <thead><tr>
                <th>${__('Item')}</th><th class="text-right">${__('Qty')}</th>${
                    source_field ? `<th>${__(source_doctype)}</th>` : ''}${
                    show_customer ? `<th>${__('Customer')}</th>` : ''}
            </tr></thead>
            <tbody>${rows}</tbody>
        </table></div>
        ${source_names.length ? `<div id="so-preview-source-note" class="doc-preview-note"></div>` : ''}
        <p class="doc-preview-hint">${
            __('This opens as a draft, not yet saved — you can still review or edit it before submitting.')
        }</p>`);
    dialog.show();

    // Spell out what this document is actually doing relative to what was
    // already raised — "a Material Request already exists, this covers the
    // balance of it" — rather than leaving the reader to infer it from an
    // item table and a doc id.
    if (source_names.length) {
        const total_qty = items.reduce((sum, it) => sum + flt(it.qty), 0);
        const uom = (items.find(it => it.uom || it.stock_uom) || {});
        const uom_label = uom.uom || uom.stock_uom || '';
        const note = (source_doctype === 'Material Request')
            ? __('{0} was already raised for this — this {1} covers the balance of {2} {3} still to order against it.',
                [source_names.join(', '), __(doc.doctype), flt(total_qty, 2), uom_label])
            : __('Creating this {0} from {1}.', [__(doc.doctype), source_names.join(', ')]);
        dialog.fields_dict.preview.$wrapper.find('#so-preview-source-note').html(
            `<i class="fa fa-info-circle"></i> ${note}`);
    }

    // The source documents' own dates/status aren't on the mapped doc — it
    // only carries their names — so they're fetched after the dialog is
    // already up rather than delaying it behind a round trip.
    if (source_names.length) {
        so_render_preview_sources(dialog, source_doctype, source_names);
    }
    if (customer_so_names.length) {
        so_render_preview_customers(dialog, customer_so_names);
    }
}

// Fills each source-document cell in the preview table with that document's
// own date and status. The mapped doc only carries the source NAMES, so the
// rest is fetched after the dialog is already open and dropped straight into
// the row it belongs to — no separate summary block above the table repeating
// what the column already says.
function so_render_preview_sources(dialog, doctype, names) {
    const $wrap = dialog.fields_dict.preview.$wrapper;

    // Field names differ per doctype and Frappe rejects the whole query with
    // "Field not permitted in query" for one that doesn't exist — a Material
    // Request is dated transaction_date (not posting_date) and has no
    // grand_total/currency at all, which broke this dialog outright the first
    // time a Purchase Order was previewed from one.
    const DATE_FIELD = {
        'Material Request': 'transaction_date',
        'Sales Order': 'transaction_date',
        'Delivery Note': 'posting_date',
        'Purchase Receipt': 'posting_date',
    };
    const HAS_TOTAL = {
        'Material Request': false,
        'Sales Order': true,
        'Delivery Note': true,
        'Purchase Receipt': true,
    };
    const date_field = DATE_FIELD[doctype] || 'posting_date';
    const has_total = HAS_TOTAL[doctype] !== false;
    const fields = ['name', date_field, 'status'].concat(has_total ? ['grand_total', 'currency'] : []);

    const fill = (name, html) => {
        $wrap.find('.doc-preview-src').filter((i, el) => $(el).data('src') === name)
            .find('.doc-preview-src__meta').html(html);
    };

    frappe.db.get_list(doctype, {
        filters: { name: ['in', names] },
        fields: fields,
        limit: names.length,
    }).then(docs => {
        const by_name = {};
        (docs || []).forEach(x => { by_name[x.name] = x; });
        // Every referenced name gets resolved one way or another — a source
        // the read couldn't return (permissions, or just deleted) still shows
        // its id, since silently blanking it would misrepresent what this
        // document covers.
        names.forEach(nm => {
            const x = by_name[nm];
            if (!x) return fill(nm, '');
            const bits = [];
            if (x[date_field]) bits.push(fmt_date(x[date_field]));
            if (x.status) bits.push(esc(x.status));
            if (x.grand_total != null) {
                // Plain string, not frappe.format's Currency HTML block —
                // see .doc-preview-src__meta in the stylesheet.
                const amt = (typeof format_currency === 'function')
                    ? format_currency(x.grand_total, x.currency)
                    : flt(x.grand_total, 2);
                bits.push(esc(amt));
            }
            fill(nm, bits.join('<span class="doc-preview-src__sep">·</span>'));
        });
    }).catch(() => {
        names.forEach(nm => fill(nm, ''));
    });
}

// Fills the Customer column with each row's Sales Order customer — the name,
// not just the code, since the code alone answers nothing at review time.
function so_render_preview_customers(dialog, so_names) {
    const $wrap = dialog.fields_dict.preview.$wrapper;
    const fill = (so, html) => {
        $wrap.find('.doc-preview-cust').filter((idx, el) => $(el).data('so') === so)
            .find('.doc-preview-cust__name').html(html);
    };

    frappe.db.get_list('Sales Order', {
        filters: { name: ['in', so_names] },
        fields: ['name', 'customer', 'customer_name'],
        limit: so_names.length,
    }).then(docs => {
        const by_name = {};
        (docs || []).forEach(x => { by_name[x.name] = x; });
        so_names.forEach(nm => {
            const x = by_name[nm];
            if (!x) return fill(nm, em_dash());
            fill(nm, `<a class="so-link" href="/app/customer/${encodeURIComponent(x.customer)}"
                         target="_blank">${esc(x.customer_name || x.customer)}</a>`);
        });
    }).catch(() => {
        so_names.forEach(nm => fill(nm, em_dash()));
    });
}

/**
 * "Which documents do you want to build this from?" — one shared picker for
 * every create-from-source action on this widget, so choosing Pick Lists for
 * a Delivery Note and choosing Delivery Notes for a Sales Invoice look and
 * behave the same way instead of each action inventing its own.
 *
 * opts:
 *   doctype       source doctype (Pick List / Delivery Note)
 *   names         source names to offer
 *   multi         true = checkboxes (build from several at once),
 *                 false = radios (the mapper only takes one)
 *   qty_by_name   optional {name: qty} shown as the row's pending/qty figure
 *   title/hint/confirm_label
 *   on_confirm(selected_names)
 *
 * A single option still opens the picker rather than silently auto-choosing:
 * seeing WHICH document is about to be used is the point of the step.
 */
function so_pick_source_docs(opts) {
    inject_so_styles();
    const names = opts.names || [];
    if (!names.length) {
        frappe.msgprint(__('Nothing available to create this from.'));
        return;
    }

    const input_type = opts.multi ? 'checkbox' : 'radio';
    // Only Pick Lists carry a per-document pending figure; a Delivery Note
    // picker would otherwise render an empty column under a "Pending" header.
    const has_pending_col = !!opts.qty_by_name && names.some(n => opts.qty_by_name[n] != null);
    const qty_of = (nm) => (opts.qty_by_name && opts.qty_by_name[nm] != null)
        ? flt(opts.qty_by_name[nm], 2) : null;

    // Plain rows with NATIVE checkboxes, in the same bordered table with the
    // blue header the rest of these dialogs use. A custom-styled box was tried
    // and reverted: it rendered unchecked while the count said everything was
    // selected, and a control whose appearance can disagree with its state is
    // worse than the default one.
    const rows_html = names.map((nm, i) => {
        const q = qty_of(nm);
        return `
        <tr>
            <td style="width:36px; text-align:center;">
                <input type="${input_type}" name="so-src-pick" class="so-src-pick" value="${esc(nm)}"
                       ${(opts.multi || i === 0) ? 'checked' : ''}>
            </td>
            <td>
                <a class="so-link" href="/app/${doctype_route(opts.doctype)}/${encodeURIComponent(nm)}"
                   target="_blank">${esc(nm)}</a>
                <div class="doc-preview-src__meta" data-src-meta="${esc(nm)}"><i class="fa fa-spinner fa-spin"></i></div>
                <div class="doc-preview-src__lines" data-src-lines="${esc(nm)}"></div>
            </td>
            ${has_pending_col ? `<td class="text-right" style="font-weight:700; white-space:nowrap;">${
                q != null ? `${q} <small style="font-weight:400;color:var(--text-muted);">${esc(opts.qty_label || __('pending'))}</small>` : ''
            }</td>` : ''}
        </tr>`;
    }).join('');

    const dialog = new frappe.ui.Dialog({
        title: opts.title || __('Select source documents'),
        size: 'large',
        fields: [{ fieldtype: 'HTML', fieldname: 'picker' }],
        primary_action_label: opts.confirm_label || __('Continue'),
        primary_action: () => {
            const selected = dialog.$wrapper.find('.so-src-pick:checked')
                .map((i, el) => $(el).val()).get();
            if (!selected.length) {
                frappe.msgprint(__('Select at least one {0}.', [__(opts.doctype)]));
                return;
            }
            dialog.hide();
            opts.on_confirm(selected);
        },
        secondary_action_label: __('Cancel'),
        secondary_action: () => dialog.hide()
    });

    dialog.fields_dict.picker.$wrapper.html(`
        ${opts.hint ? `<p class="doc-preview-hint" style="margin:0 2px 10px;">${opts.hint}</p>` : ''}
        ${opts.multi ? `<div class="so-pick-toolbar">
            <button class="so-btn so-btn--view" data-pick-all="1">${__('Select all')}</button>
            <button class="so-btn so-btn--view" data-pick-none="1">${__('Clear')}</button>
            <span class="so-pick-toolbar__count" id="so-pick-count"></span>
        </div>` : ''}
        <div class="doc-preview-wrap"><table class="doc-preview-table">
            <thead><tr>
                <th style="width:36px;"></th>
                <th>${__(opts.doctype)}</th>
                ${has_pending_col ? `<th class="text-right">${opts.qty_col_label || __('Pending')}</th>` : ''}
            </tr></thead>
            <tbody>${rows_html}</tbody>
        </table></div>`);
    dialog.show();

    // Live "what am I about to act on" readout — with several candidates each
    // carrying a qty, the sum of the ticked ones is the number that matters,
    // and adding it up by eye is where mistakes come from.
    const $wrap = dialog.fields_dict.picker.$wrapper;
    const update_count = () => {
        const $on = $wrap.find('.so-src-pick:checked');
        let total = 0, counted = 0;
        $on.each((i, el) => {
            const q = qty_of($(el).val());
            if (q != null) { total += q; counted++; }
        });
        const parts = [__('{0} of {1} selected', [$on.length, names.length])];
        if (has_pending_col && counted) {
            parts.push(`<b>${flt(total, 2)} ${esc(opts.qty_label || __('pending'))}</b>`);
        }
        $wrap.find('#so-pick-count').html(parts.join(' · '));
        dialog.get_primary_btn().prop('disabled', !$on.length);
    };
    $wrap.on('change', '.so-src-pick', update_count);
    $wrap.on('click', '[data-pick-all]', (e) => {
        e.preventDefault();
        $wrap.find('.so-src-pick').prop('checked', true);
        update_count();
    });
    $wrap.on('click', '[data-pick-none]', (e) => {
        e.preventDefault();
        $wrap.find('.so-src-pick').prop('checked', false);
        update_count();
    });
    update_count();

    // Same per-doctype date/total resolution the preview uses — a doctype
    // without grand_total must not be asked for one (see
    // so_render_preview_sources). No amount here: choosing WHICH documents to
    // build from is decided on dates, status and the item/qty lines.
    so_fill_source_meta($wrap, opts.doctype, names, { no_total: true });
    so_fill_source_lines($wrap, opts.doctype, names);
}


/**
 * The item lines inside each candidate document — what is actually IN the
 * Delivery Note / Pick List being ticked, and for a Delivery Note which Pick
 * List each line came from. Picking between documents by id and date alone
 * means guessing at their contents; this puts the contents on the row.
 */
function so_fill_source_lines($wrap, doctype, names) {
    const CHILD = {
        'Delivery Note': {
            doctype: 'Delivery Note Item',
            fields: ['parent', 'item_code', 'qty', 'uom', 'against_pick_list'],
            source_label: (r) => r.against_pick_list,
        },
        'Pick List': {
            doctype: 'Pick List Item',
            fields: ['parent', 'item_code', 'qty', 'picked_qty', 'stock_uom'],
            source_label: () => null,
        },
    }[doctype];
    if (!CHILD) return;

    const fill = (nm, html) => $wrap.find('[data-src-lines]')
        .filter((i, el) => $(el).attr('data-src-lines') === nm).html(html);

    // frappe.client.get_list, NOT frappe.db.get_list: the latter routes to
    // frappe.desk.reportview.get_list, whose DatabaseQuery.execute() takes no
    // `parent` argument and throws outright on one — and `parent` is exactly
    // what a child-table read requires in order to resolve permissions
    // against the parent doctype.
    frappe.call({
        method: 'frappe.client.get_list',
        args: {
            doctype: CHILD.doctype,
            parent: doctype,
            filters: { parent: ['in', names] },
            fields: CHILD.fields,
            limit_page_length: 0,
        },
    }).then(r => {
        const rows = (r && r.message) || [];
        const by_parent = {};
        rows.forEach(r2 => {
            (by_parent[r2.parent] = by_parent[r2.parent] || []).push(r2);
        });
        names.forEach(nm => {
            const lines = by_parent[nm] || [];
            if (!lines.length) return fill(nm, '');
            fill(nm, lines.map(r => {
                const qty = flt(r.qty != null ? r.qty : r.picked_qty, 2);
                const src = CHILD.source_label(r);
                return `<div class="doc-preview-src__line">
                    <span class="doc-preview-src__item">${esc(r.item_code)}</span>
                    <span class="doc-preview-src__qty">${qty} ${esc(r.uom || r.stock_uom || '')}</span>
                    ${src ? `<span class="doc-preview-src__from">${__('from')} ${esc(src)}</span>` : ''}
                </div>`;
            }).join(''));
        });
    }).catch(() => names.forEach(nm => fill(nm, '')));
}

// Shared by the picker and the mapped-doc preview: fetch each source's own
// date/status/total and drop it into every [data-src-meta] slot for that name.
function so_fill_source_meta($wrap, doctype, names, meta_opts) {
    meta_opts = meta_opts || {};
    const DATE_FIELD = {
        'Material Request': 'transaction_date', 'Sales Order': 'transaction_date',
        'Delivery Note': 'posting_date', 'Purchase Receipt': 'posting_date',
        'Pick List': 'modified',
    };
    const NO_TOTAL = ['Material Request', 'Pick List'];
    const date_field = DATE_FIELD[doctype] || 'posting_date';
    const has_total = NO_TOTAL.indexOf(doctype) === -1 && !meta_opts.no_total;
    const fields = ['name', date_field, 'status'].concat(has_total ? ['grand_total', 'currency'] : []);

    const fill = (nm, html) => $wrap.find(`[data-src-meta]`)
        .filter((i, el) => $(el).attr('data-src-meta') === nm).html(html);

    frappe.db.get_list(doctype, {
        filters: { name: ['in', names] }, fields: fields, limit: names.length,
    }).then(docs => {
        const by_name = {};
        (docs || []).forEach(x => { by_name[x.name] = x; });
        names.forEach(nm => {
            const x = by_name[nm];
            if (!x) return fill(nm, '');
            const bits = [];
            if (x[date_field]) bits.push(fmt_date(x[date_field]));
            if (x.status) bits.push(esc(x.status));
            if (x.grand_total != null) {
                const amt = (typeof format_currency === 'function')
                    ? format_currency(x.grand_total, x.currency) : flt(x.grand_total, 2);
                bits.push(esc(amt));
            }
            fill(nm, bits.join('<span class="doc-preview-src__sep">·</span>'));
        });
    }).catch(() => names.forEach(nm => fill(nm, '')));
}

/**
 * Delivery Note from one or MORE Pick Lists.
 *
 * ERPNext's own create_delivery_note maps a single Pick List, which is why
 * this goes through create_dn_or_si_from_pick_lists instead — the same
 * server call the bulk "Create DN" button uses, and the only one that can
 * combine several Pick Lists into one Delivery Note. `all_pending` is every
 * Pick List that HAD outstanding qty, so anything left unticked can be
 * reported back as still outstanding rather than silently forgotten.
 */
function so_create_dn_from_pick_lists(so_name, selected, all_pending) {
    if (!selected || !selected.length) return;

    const left = (all_pending || []).filter(p => selected.indexOf(p.name) === -1);
    const left_qty = left.reduce((sum, p) => sum + flt(p.pending), 0);

    frappe.call({
        method: 'erp_dacsinc_custom.custom_script.create_dn_or_si_from_pick_lists',
        args: { sales_order: so_name, pick_lists: selected, doctype: 'Delivery Note' },
        freeze: true,
        freeze_message: __('Creating Delivery Note…'),
        callback: (r) => {
            if (!r.message) return;
            frappe.model.sync(r.message);
            if (left.length) {
                // Say what is still waiting, naming it — an unticked Pick List
                // is deferred, not done, and nothing else on this screen would
                // have told the user that after the redirect.
                frappe.show_alert({
                    message: __('{0} still outstanding on {1} — create another Delivery Note for {2} when ready.',
                        [flt(left_qty, 2), left.length === 1 ? left[0].name : __('{0} Pick Lists', [left.length]),
                         left.map(p => p.name).join(', ')]),
                    indicator: 'orange'
                }, 10);
            }
            // Unsaved draft — a new tab has no access to this tab's cache.
            frappe.set_route('Form', r.message.doctype, r.message.name);
        }
    });
}

// Deliberately removed: a Delivery Note is now always built through
// so_create_dn_from_pick_lists / create_dn_or_si_from_pick_lists, which can
// cover several Pick Lists at once. The old helper routed
// pick_list.create_delivery_note through the "preview, then confirm" flow —
// but that core function INSERTS the Delivery Note itself (verified: it
// returns a doc already in the database), so the preview was never a preview.
// Anything cancelled at that dialog had already created a real document.

/**
 * Once a line is picked, it can ship either via Delivery Note or directly via
 * a Sales Invoice with Update Stock — never both for the same order (see
 * guard_so_fulfillment_route_lock server-side). route_lock is 'dn'/'si'/''
 * from the bulk stock endpoint, pre-hiding whichever option this order has
 * already committed away from.
 */
function so_prompt_dn_or_si(so_name, sales_order_item, item_code, pick_list, picked_qty, route_lock, pair_key) {
    const options = [];
    if (route_lock !== 'si') options.push('Delivery Note');
    if (route_lock !== 'dn') options.push('Sales Invoice (Update Stock)');

    if (!options.length) {
        frappe.msgprint(__('This Sales Order is locked to a fulfillment route that conflicts with this line.'));
        return;
    }

    // A Delivery Note is mapped from ONE Pick List, but the qty offered here
    // is everything still undelivered across ALL of them. With more than one
    // pick list holding stock, the two are different numbers — so the pick
    // list being shipped is an explicit choice, and the qty shown is that
    // pick list's own pending amount rather than a total the DN can't deliver.
    const cached = pair_key ? get_cached_stock_row(pair_key) : null;
    const pending_pls = ((cached && cached.picked_for_this_so_details) || [])
        .filter(p => flt(p.docstatus) === 1 && flt(p.picked_qty) - flt(p.delivered_qty) > 0.001)
        .map(p => ({ name: p.pick_list_name, pending: flt(p.picked_qty) - flt(p.delivered_qty) }));

    // The Delivery Note route asks which Pick List to ship (the mapper takes
    // one at a time); the Sales Invoice route is a qty, since it isn't built
    // from a Pick List at all. So the qty field only belongs to the SI route.
    frappe.prompt([
        {
            fieldtype: 'Select', fieldname: 'route', label: __('Proceed with'),
            options: options, reqd: 1, default: options[0]
        },
        {
            fieldtype: 'Float', fieldname: 'qty', label: __('Quantity to fulfill now'),
            default: flt(picked_qty),
            depends_on: 'eval:doc.route!="Delivery Note"',
            description: __('Capped at the {0} already picked and submitted.', [flt(picked_qty)])
        }
    ], (values) => {
        if (values.route === 'Delivery Note') {
            const pl_names = pending_pls.length ? pending_pls.map(p => p.name)
                : (pick_list ? [pick_list] : []);
            const qty_by_name = {};
            pending_pls.forEach(p => { qty_by_name[p.name] = p.pending; });

            so_pick_source_docs({
                doctype: 'Pick List',
                names: pl_names,
                multi: true,
                qty_by_name: qty_by_name,
                title: __('Create Delivery Note — select Pick List(s)'),
                hint: __('{0} is picked in total across {1} Pick List(s), all selected. Untick any you want to leave for a later Delivery Note — whatever you leave out stays outstanding.',
                    [flt(picked_qty), pl_names.length]),
                confirm_label: __('Create Delivery Note'),
                on_confirm: (selected) => so_create_dn_from_pick_lists(so_name, selected, pending_pls),
            });
            return;
        }

        if (flt(values.qty) > flt(picked_qty)) {
            frappe.msgprint(__('Cannot fulfill more than {0} — that is all that was picked.', [flt(picked_qty)]));
            return;
        }
        so_make_sales_invoice_with_stock(so_name, sales_order_item, item_code, values.qty);
    }, __(so_dn_si_action_label(route_lock)), __('Continue'));
}

// The direct-billing alternative to Delivery Note: a Sales Invoice with
// Update Stock, scoped to this one line and capped at what was picked.
function so_make_sales_invoice_with_stock(so_name, sales_order_item, item_code, qty) {
    frappe.confirm(
        __('Create a Sales Invoice (Update Stock) for {0} (Qty: {1})?', [esc(item_code), flt(qty)]),
        () => {
            frappe.call({
                method: 'erp_dacsinc_custom.custom_script.create_sales_invoice_for_item_with_stock',
                args: { sales_order: so_name, sales_order_item: sales_order_item, item_code: item_code, qty: qty },
                freeze: true,
                freeze_message: __('Building Sales Invoice…'),
                callback: (r) => {
                    if (!r.message) return;   // server threw; Frappe has shown the reason
                    frappe.model.sync(r.message);
                    // Unsaved draft — a new tab has no access to this tab's
                    // client-side cache and would render blank.
                    frappe.set_route('Form', r.message.doctype, r.message.name);
                }
            });
        }
    );
}

// Turn an existing Material Request into a Purchase Order, rather than raising a
// second request for the same shortfall.
function so_make_po_from_mr(mr_name) {
    if (!mr_name) {
        frappe.msgprint(__('No open Material Request for this line.'));
        return;
    }
    so_open_mapped_doc({
        method: 'erpnext.stock.doctype.material_request.material_request.make_purchase_order',
        source_name: mr_name,
        freeze_message: __('Creating Purchase Order from Material Request…'),
        preview_title: __('Review Purchase Order — from Material Request'),
        confirm_label: __('Create Purchase Order')
    });
}

// Maps every pending line on the order — ERPNext has no per-item variant.
function so_make_material_request(so_name) {
    so_open_mapped_doc({
        method: 'erpnext.selling.doctype.sales_order.sales_order.make_material_request',
        source_name: so_name,
        freeze_message: __('Creating Material Request…'),
        preview_title: __('Review Material Request'),
        confirm_label: __('Create Material Request'),
        // Same issue as so_make_purchase_order: ERPNext's own mapper only
        // knows "how much of this SO line has never been put on an MR/PO" —
        // it has no idea a line is already partly covered by stock, a Pick
        // List or a Delivery Note, so it maps the FULL remaining qty even
        // when most of it already shipped straight from stock. Cap every
        // mapped row back down to this app's own shortfall figure (the
        // cached per-item stock data the widget itself was built from),
        // same formula _compute_stage_info-adjacent code uses: required -
        // delivered - picked (submitted, undelivered) - picked (draft).
        after_map: (doc) => {
            (doc.items || []).forEach(row => {
                const cached = get_cached_stock_row(`${row.item_code}||no_bom`);
                if (!cached) return;
                const needed = flt(cached.required_qty) - flt(cached.delivered_qty)
                    - flt(cached.picked_submitted_undelivered_qty) - flt(cached.picked_draft_qty_so);
                if (needed >= 0 && flt(row.qty) !== flt(needed)) {
                    row.qty = flt(needed);
                    if (row.conversion_factor) row.stock_qty = flt(needed) * flt(row.conversion_factor);
                }
            });
        }
    });
}

function so_make_sales_invoice(so_name) {
    so_open_mapped_doc({
        method: 'erpnext.selling.doctype.sales_order.sales_order.make_sales_invoice',
        source_name: so_name,
        freeze_message: __('Creating Sales Invoice…'),
        preview_title: __('Review Sales Invoice'),
        confirm_label: __('Create Sales Invoice')
    });
}

// Invoices ONLY this one line's Delivery Note row(s) — never the rest of
// whatever Delivery Note(s) it happens to share with other lines. The
// generic ERPNext DN -> SI mapper has no per-item filter when called
// through the shared mapped-doc endpoint (see
// make_sales_invoice_from_dn_items on the server for why), so this calls
// the custom, item-scoped endpoint directly instead of so_open_mapped_doc.
function so_make_sales_invoice_from_dn(pair_key) {
    const d = get_cached_stock_row(pair_key);
    // Only rows with qty still to invoice — an already-billed row makes
    // ERPNext reject the whole invoice (see so_unbilled_dn_map).
    const dn_rows = ((d && d.row_dns) || []).filter(x =>
        x.docstatus === 1 && flt(x.unbilled_qty != null ? x.unbilled_qty : x.qty) > 0.001);

    if (!dn_rows.length) {
        const any_dn = ((d && d.row_dns) || []).some(x => x.docstatus === 1);
        frappe.msgprint(any_dn
            ? __('Every Delivery Note for this line is already fully invoiced — there is nothing left to bill.')
            : __('No submitted Delivery Note found for this line.'));
        return;
    }

    const build = (dn_item_names) => frappe.call({
        method: 'erp_dacsinc_custom.custom_script.make_sales_invoice_from_dn_items',
        args: { dn_item_names: dn_item_names },
        freeze: true,
        freeze_message: __('Creating Sales Invoice from Delivery Note…'),
        callback: (r) => {
            if (!r.message) return;
            const doc = frappe.model.sync(r.message)[0];
            so_show_mapped_doc_preview(doc, {
                preview_title: __('Review Sales Invoice — from Delivery Note'),
                confirm_label: __('Create Sales Invoice')
            });
        }
    });

    // Same select-your-sources step as everywhere else. This action works on
    // Delivery Note ITEM rows, so the picker offers the parent Delivery Notes
    // and the selection is mapped back to the rows belonging to them.
    const parents = [...new Set(dn_rows.map(x => x.parent).filter(Boolean))];
    if (parents.length <= 1) {
        build(dn_rows.map(x => x.name));
        return;
    }

    const unbilled_by_parent = {};
    dn_rows.forEach(x => {
        const q = flt(x.unbilled_qty != null ? x.unbilled_qty : x.qty);
        unbilled_by_parent[x.parent] = flt(unbilled_by_parent[x.parent] || 0) + q;
    });

    so_pick_source_docs({
        doctype: 'Delivery Note',
        names: parents,
        multi: true,
        qty_by_name: unbilled_by_parent,
        qty_label: __('to invoice'),
        qty_col_label: __('To Invoice'),
        title: __('Create Sales Invoice — select Delivery Notes'),
        hint: __('{0} Delivery Note(s) on this line still have qty to invoice, all selected. Fully-invoiced ones are not listed.', [parents.length]),
        confirm_label: __('Create Sales Invoice'),
        on_confirm: (selected) => build(
            dn_rows.filter(x => selected.indexOf(x.parent) !== -1).map(x => x.name)
        ),
    });
}

// Only Delivery Notes that still have qty left to invoice. A fully-billed one
// included here makes ERPNext reject the WHOLE attempt with "All these items
// have already been Invoiced/Returned", taking the genuinely unbilled ones
// down with it. Returns {name: unbilled_qty} so the picker can show how much
// each one still owes — partial billing included, since unbilled_qty is
// derived from billed_amt against the row's own amount (see
// get_item_stock_details_bulk).
function so_unbilled_dn_map(frm) {
    const map = {};
    if (!frm.custom_stock_data) return map;
    Object.values(frm.custom_stock_data).forEach(d => {
        (d.row_dns || []).forEach(dn => {
            if (dn.docstatus !== 1) return;
            const unbilled = flt(dn.unbilled_qty != null ? dn.unbilled_qty : dn.qty);
            if (unbilled <= 0.001) return;
            map[dn.parent] = flt(map[dn.parent] || 0) + unbilled;
        });
    });
    return map;
}

function so_get_all_submitted_dn_names(frm) {
    return Object.keys(so_unbilled_dn_map(frm));
}

function so_make_sales_invoice_from_all_dns(frm) {
    const unbilled = so_unbilled_dn_map(frm);
    const dn_names = Object.keys(unbilled);
    if (!dn_names.length) {
        frappe.msgprint(__('Every submitted Delivery Note on this order is already fully invoiced — there is nothing left to bill.'));
        return;
    }
    // Unlike a Delivery Note (one Pick List at a time), a Sales Invoice CAN
    // be built from several Delivery Notes at once — so these are checkboxes,
    // all ticked, and the user unticks whatever shouldn't be on this invoice.
    so_pick_source_docs({
        doctype: 'Delivery Note',
        names: dn_names,
        multi: true,
        qty_by_name: unbilled,
        qty_label: __('to invoice'),
        qty_col_label: __('To Invoice'),
        title: __('Create Sales Invoice — select Delivery Notes'),
        hint: __('Delivery Notes with qty still to invoice, all selected. Fully-invoiced ones are not listed. Untick any that should not be on this invoice.'),
        confirm_label: __('Create Sales Invoice'),
        on_confirm: (selected) => so_open_mapped_doc({
            method: 'erp_dacsinc_custom.custom_script.make_sales_invoice_from_multiple_delivery_notes',
            source_name: selected.join(','),
            freeze_message: __('Creating Sales Invoice from Delivery Notes…'),
            preview_title: __('Review Sales Invoice — from Delivery Note(s)'),
            confirm_label: __('Create Sales Invoice')
        }),
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
/**
 * Every raw material still short across ALL BOM lines on this order, summed
 * per item — so one Material Request covers the order instead of one per RM
 * row. The same item needed by two different finished goods is ONE request
 * line for the combined qty, which is also what stops two part-requests being
 * raised for it by hand and then double-ordered.
 *
 * Returns [{item_code, item_name, qty, uom, warehouse, needed_by}].
 */
function so_collect_pending_rm(frm) {
    const by_item = {};
    Object.values(frm.custom_stock_data || {}).forEach(d => {
        if (!d.is_bom_item) return;
        const rm = d.rm_procurement_status || {};
        (rm.rm_items_status || []).forEach(item => {
            // rm_shortfall_total is exactly what the row's own Shortfall
            // column shows and what its per-item Material Request button
            // requests — the two must never disagree about the qty.
            const short = flt(item.rm_shortfall_total);
            if (short <= 0.001) return;
            const key = `${item.rm_code}||${item.rm_uom || ''}||${d.warehouse || ''}`;
            if (!by_item[key]) {
                by_item[key] = {
                    item_code: item.rm_code,
                    item_name: item.rm_name || item.rm_code,
                    uom: item.rm_uom || '',
                    warehouse: d.warehouse || '',
                    qty: 0,
                    needed_by: [],
                    // Item-level figures, NOT summed: stock and pending
                    // MR/PO belong to the raw material itself, so adding them
                    // up once per finished good that consumes it would report
                    // several times the coverage that actually exists.
                    stock: flt(item.rm_available_stock),
                    pending_mr: flt(item.rm_pending_mr_total),
                    pending_po: flt(item.rm_pending_so_linked_total),
                    at_jobber: flt(item.rm_transferred_to_sc_total),
                };
            }
            by_item[key].qty = flt(by_item[key].qty + short, 3);
            // How this qty was arrived at, per finished good: the FG qty still
            // to produce × this raw material's per-unit BOM factor. Shown in
            // the review dialog so the number can be checked rather than
            // taken on trust.
            by_item[key].needed_by.push({
                fg_item: d.item_code || '',
                fg_shortfall: flt(rm.fg_shortfall),
                qty_per_fg: flt(item.rm_qty_per_fg),
                needed: flt(item.rm_needed_for_shortfall),
                shortfall: short,
            });
        });
    });
    return Object.values(by_item).filter(x => x.item_code && x.qty > 0.001);
}

/**
 * One Material Request for every raw material still short on this order,
 * shown for review first — what is going to be requested, how much, and which
 * finished good needs it — since this creates a real document covering
 * several lines at once.
 */
/**
 * Finished goods on this order that are BOUGHT rather than made — no BOM, so
 * there is no raw-material tier and the thing to request IS the item itself.
 *
 * The qty is the same figure the row's own buy button uses: what is left to
 * plan, less stock genuinely free for this order, less what is already on a
 * PO/MR. Recomputed here from the identical fields rather than a second
 * formula, so the bulk action and the per-row action can never disagree about
 * how much is outstanding.
 */
// The one Sales Order line a widget row represents, or null when the row
// groups several (same item, same BOM, more than one line).
function so_resolve_single_so_line(frm, pair_key, d) {
    const bom_key = String(pair_key || '').split('||')[1] || 'no_bom';
    const matches = (frm.doc.items || []).filter(i =>
        i.item_code === d.item_code && ((i.bom_no || 'no_bom') === bom_key));
    return matches.length === 1 ? matches[0].name : null;
}

function so_collect_pending_fg(frm) {
    const out = [];
    Object.entries(frm.custom_stock_data || {}).forEach(([pair_key, d]) => {
        // "Made" means this LINE has a BOM — exactly the test so_buy_btn uses
        // to choose between a Purchase Order and a Subcontract PO. The Item
        // master's own is_sub_contracted_item flag is NOT sufficient on its
        // own: it can be set on an item that is bought outright on this line
        // (confirmed live — "Item 1 without BOM" carries the flag with no
        // bom_no), and treating that as made skipped exactly the rows this
        // action exists for.
        const is_made = (d.is_sub_contracted_item || d.is_bom_item) && d.bom_no;
        if (is_made) return;

        const required = flt(d.required_qty);
        const delivered = flt(d.delivered_qty);
        const picked_sub = flt(d.picked_submitted_undelivered_qty);
        const picked_draft = flt(d.picked_draft_qty_so);
        const all_reservation = picked_sub + picked_draft
            + flt(d.picked_for_others_qty) + flt(d.draft_qty_for_others)
            + flt(d.picked_submitted_other_rows) + flt(d.picked_draft_other_rows);

        const truly_available = Math.max(0, flt(d.total_available_stock) - all_reservation);
        const remaining_to_plan = required - (delivered + picked_sub + picked_draft);
        const shortage = Math.max(0, remaining_to_plan - truly_available);
        // total_incoming_qty covers SUBMITTED POs/EWOs only. A qty already
        // sitting on an open Material Request or a draft PO has been asked for
        // too — raising ANOTHER request for it is the duplicate this button
        // must not offer. total_paper_coverage_qty is that figure, already
        // de-duplicated server-side (a draft PO raised from an MR is the same
        // qty as that MR's open balance, not another one).
        const covered = flt(d.total_incoming_qty) + flt(d.total_paper_coverage_qty);
        const uncovered = Math.max(0, shortage - covered);
        if (uncovered <= 0.001) return;

        out.push({
            item_code: d.item_code,
            item_name: d.item_name || d.item_code,
            qty: flt(uncovered, 3),
            uom: d.stock_uom || '',
            warehouse: d.warehouse || '',
            required: required,
            delivered: delivered,
            stock: truly_available,
            incoming: flt(d.total_incoming_qty) + flt(d.total_paper_coverage_qty),
            // The Sales Order LINE this request serves — set only when the
            // widget row maps to exactly one line, since a row groups every
            // line sharing an item + BOM. Attributing a grouped row to one of
            // several lines would be a guess; leaving it unset means the
            // request still records its Sales Order, just not a single line.
            sales_order_item: so_resolve_single_so_line(frm, pair_key, d),
        });
    });
    return out;
}

/**
 * One Material Request for every non-BOM finished good still short on this
 * order — the counterpart of so_make_rm_material_request_all, which covers the
 * raw materials of the items that ARE made.
 */
function so_make_fg_material_request_all(frm) {
    inject_so_styles();
    const rows = so_collect_pending_fg(frm);
    if (!rows.length) {
        frappe.msgprint(__('No finished good without a BOM is short on this order — nothing to request.'));
        return;
    }

    const total_lines = rows.length;
    const body = `
        <p class="doc-preview-hint" style="margin:0 2px 10px;">
            ${__('One Material Request will be created for these {0} item(s) — finished goods that are bought rather than made, so the item itself is what gets requested.', [total_lines])}
        </p>
        <div class="doc-preview-wrap"><table class="doc-preview-table" style="table-layout:fixed;">
            <thead><tr>
                <th style="width:30%;">${__('Item')}</th>
                <th style="width:44%;">${__('How this qty is worked out')}</th>
                <th style="width:26%;" class="text-right">${__('Request')}</th>
            </tr></thead>
            <tbody>${rows.map((r, i) => `
                <tr>
                    <td>
                        <b>${esc(r.item_code)}</b>${r.item_name && r.item_name !== r.item_code
                            ? `<div class="doc-preview-item-name">${esc(r.item_name)}</div>` : ''}
                        <div class="doc-preview-item-name">${esc(r.warehouse || '—')}</div>
                    </td>
                    <td>
                        <div class="doc-preview-calc">
                            <div><span>${__('Ordered')}</span><span><b>${flt(r.required, 2)}</b></span></div>
                            ${flt(r.delivered) > 0.001 ? `<div><span>&minus; ${__('Delivered / picked')}</span><span>${flt(r.delivered, 2)}</span></div>` : ''}
                            ${flt(r.stock) > 0.001 ? `<div style="color:#059669;"><span>&minus; ${__('Free stock')}</span><span>${flt(r.stock, 2)}</span></div>` : ''}
                            ${flt(r.incoming) > 0.001 ? `<div style="color:#2563eb;"><span>&minus; ${__('Already on PO/MR')}</span><span>${flt(r.incoming, 2)}</span></div>` : ''}
                            <div class="is-total"><span>${__('Still short')}</span>
                                <span style="color:#dc2626;">${flt(r.qty, 2)}</span></div>
                        </div>
                    </td>
                    <td class="text-right" style="white-space:nowrap;">
                        <input type="number" class="form-control input-sm fg-req-qty"
                               data-idx="${i}" data-max="${flt(r.qty, 3)}"
                               value="${flt(r.qty, 2)}" min="0" max="${flt(r.qty, 3)}" step="any"
                               style="width:92px; display:inline-block; text-align:right; font-weight:700;">
                        <div class="doc-preview-item-name">${esc(r.uom)}</div>
                    </td>
                </tr>`).join('')}</tbody>
        </table></div>
        <p class="doc-preview-hint" style="margin:10px 2px 0;">
            ${__('Request less than the full shortfall to take only part of it now — set a line to 0 to leave it out.')}
            <br><b>${__('Submit the Material Request to have it counted.')}</b>
            ${__('It opens as a draft, and a draft commits nothing — the shortfall here only drops once it is submitted.')}
        </p>`;

    const dialog = new frappe.ui.Dialog({
        title: __('Finished Item MR — items bought, not made'),
        size: 'large',
        fields: [{ fieldtype: 'HTML', fieldname: 'preview' }],
        primary_action_label: __('Create Material Request'),
        primary_action: () => {
            const chosen = [];
            let over = null;
            dialog.$wrapper.find('.fg-req-qty').each(function () {
                const $inp = $(this);
                const row = rows[parseInt($inp.data('idx'), 10)];
                const max = flt($inp.data('max'));
                const val = flt($inp.val());
                if (!row) return;
                if (val - max > 0.001) { over = { code: row.item_code, val: val, max: max, uom: row.uom }; return false; }
                if (val > 0.001) {
                    chosen.push({
                        item_code: row.item_code, qty: flt(val, 3),
                        uom: row.uom, warehouse: row.warehouse || undefined,
                        // Keep the Sales Order link so this request counts as
                        // coverage for the line, and stays inside the
                        // over-request cap (guard_mr_item_not_over_so_need).
                        sales_order_item: row.sales_order_item || undefined,
                    });
                }
            });

            if (over) {
                frappe.msgprint({
                    title: __('More than is short'), indicator: 'red',
                    message: __('{0}: only {1} {2} is still short, but {3} was entered.',
                        [over.code, flt(over.max, 2), over.uom, flt(over.val, 2)])
                });
                return;
            }
            if (!chosen.length) {
                frappe.msgprint(__('Every line is set to 0 — nothing to request.'));
                return;
            }

            dialog.hide();
            frappe.call({
                method: 'erp_dacsinc_custom.custom_script.create_material_request_custom',
                args: { items: chosen, company: frm.doc.company, sales_order_name: frm.doc.name },
                freeze: true,
                freeze_message: __('Creating Material Request for {0} item(s)…', [chosen.length]),
                callback: (r) => {
                    if (!r.message) return;
                    window.open(frappe.utils.get_form_link('Material Request', r.message), '_blank');
                    frappe.show_alert({
                        message: __('Material Request {0} created for {1} item(s).', [r.message, chosen.length]),
                        indicator: 'green'
                    }, 7);
                    generate_stock_overview_table(frm);
                }
            });
        },
        secondary_action_label: __('Cancel'),
        secondary_action: () => dialog.hide()
    });
    dialog.fields_dict.preview.$wrapper.html(body);
    dialog.show();
}

function so_make_rm_material_request_all(frm) {
    inject_so_styles();
    const rows = so_collect_pending_rm(frm);
    if (!rows.length) {
        frappe.msgprint(__('No raw material is short on this order — nothing to request.'));
        return;
    }

    const total_lines = rows.length;

    // Needed − what already covers it = what is actually requested. Same
    // subtraction the RM Pipeline row itself shows, spelled out here so the
    // requested qty is verifiable rather than a bare number.
    const coverage_row = (label, val, color) => flt(val) > 0.001
        ? `<div style="color:${color};"><span>&minus; ${label}</span><span>${flt(val, 2)}</span></div>`
        : '';

    const body = `
        <p class="doc-preview-hint" style="margin:0 2px 10px;">
            ${__('One Material Request will be created for these {0} raw material(s). A raw material needed by more than one finished good is combined into a single line.', [total_lines])}
        </p>
        <div class="doc-preview-wrap"><table class="doc-preview-table" style="table-layout:fixed;">
            <thead><tr>
                <th style="width:22%;">${__('Raw Material')}</th>
                <th style="width:28%;">${__('Needed by (finished good)')}</th>
                <th style="width:30%;">${__('How this qty is worked out')}</th>
                <th style="width:20%;" class="text-right">${__('Request')}</th>
            </tr></thead>
            <tbody>${rows.map((r, i) => `
                <tr>
                    <td>
                        <b>${esc(r.item_code)}</b>${r.item_name && r.item_name !== r.item_code
                            ? `<div class="doc-preview-item-name">${esc(r.item_name)}</div>` : ''}
                        <div class="doc-preview-item-name">${esc(r.warehouse || '—')}</div>
                    </td>
                    <td>
                        ${r.needed_by.map(n => `
                            <div class="doc-preview-src__line">
                                <span class="doc-preview-src__item">${esc(n.fg_item)}</span>
                                <div class="doc-preview-src__meta" style="margin:0;">
                                    ${__('{0} to produce', [flt(n.fg_shortfall, 2)])}
                                    &times; ${flt(n.qty_per_fg, 2)}/${__('unit')}
                                    = <b>${flt(n.needed, 2)} ${esc(r.uom)}</b>
                                </div>
                            </div>`).join('')}
                    </td>
                    <td>
                        <div class="doc-preview-calc">
                            <div><span>${__('Needed')}</span><span><b>${flt(r.needed_by.reduce((t, n) => t + flt(n.needed), 0), 2)}</b></span></div>
                            ${coverage_row(__('In stock'), r.stock, '#059669')}
                            ${coverage_row(__('Pending MR'), r.pending_mr, '#6366f1')}
                            ${coverage_row(__('Pending PO'), r.pending_po, '#2563eb')}
                            ${coverage_row(__('At jobber'), r.at_jobber, '#b45309')}
                            <div class="is-total"><span>${__('Still short')}</span>
                                <span style="color:#dc2626;">${flt(r.qty, 2)}</span></div>
                        </div>
                    </td>
                    <td class="text-right" style="white-space:nowrap;">
                        <input type="number" class="form-control input-sm rm-req-qty"
                               data-idx="${i}" data-max="${flt(r.qty, 3)}"
                               value="${flt(r.qty, 2)}" min="0" max="${flt(r.qty, 3)}" step="any"
                               style="width:92px; display:inline-block; text-align:right; font-weight:700;">
                        <div class="doc-preview-item-name">${esc(r.uom)}</div>
                        <div class="doc-preview-item-name rm-req-err" style="color:#dc2626; display:none;"></div>
                    </td>
                </tr>`).join('')}</tbody>
        </table></div>
        <p class="doc-preview-hint" style="margin:10px 2px 0;">
            ${__('Request less than the full shortfall if you only want part of it now — set a line to 0 to leave it out entirely; the rest stays short and can be requested later.')}
            <br><b>${__('Submit the Material Request to have it counted.')}</b>
            ${__('It opens as a draft, and a draft commits nothing — the shortfall here only drops (and stops being asked for again) once it is submitted, at which point it counts as Pending MR.')}
        </p>`;

    const dialog = new frappe.ui.Dialog({
        title: __('Raw Material MR — for the BOM items on this order'),
        // Four columns, one of them a calculation breakdown: the default
        // dialog width cut the Request column (and its qty input) clean off.
        size: 'extra-large',
        fields: [{ fieldtype: 'HTML', fieldname: 'preview' }],
        primary_action_label: __('Create Material Request'),
        primary_action: () => {
            // Read the per-line quantities the user actually wants now. A
            // line left at 0 is excluded; the rest of a reduced line simply
            // stays short and can be requested later (the shortfall recomputes
            // with this request counted as Pending MR, so it is never asked
            // for twice).
            const chosen = [];
            let over = null;
            dialog.$wrapper.find('.rm-req-qty').each(function () {
                const $inp = $(this);
                const idx = parseInt($inp.data('idx'), 10);
                const max = flt($inp.data('max'));
                const val = flt($inp.val());
                const row = rows[idx];
                if (!row) return;
                if (val - max > 0.001) {
                    over = { code: row.item_code, val: val, max: max, uom: row.uom };
                    return false;
                }
                if (val > 0.001) {
                    chosen.push({
                        item_code: row.item_code, qty: flt(val, 3),
                        uom: row.uom, warehouse: row.warehouse || undefined
                    });
                }
            });

            if (over) {
                frappe.msgprint({
                    title: __('More than is short'),
                    indicator: 'red',
                    message: __('{0}: only {1} {2} is still short, but {3} was entered. Requesting more would over-procure — reduce it to {1} or less.',
                        [over.code, flt(over.max, 2), over.uom, flt(over.val, 2)])
                });
                return;
            }
            if (!chosen.length) {
                frappe.msgprint(__('Every line is set to 0 — nothing to request. Enter a qty on at least one raw material.'));
                return;
            }

            dialog.hide();
            frappe.call({
                method: 'erp_dacsinc_custom.custom_script.create_material_request_custom',
                args: {
                    items: chosen,
                    company: frm.doc.company,
                    sales_order_name: frm.doc.name
                },
                freeze: true,
                freeze_message: __('Creating Material Request for {0} raw material(s)…', [chosen.length]),
                callback: (r) => {
                    if (!r.message) return;
                    window.open(frappe.utils.get_form_link('Material Request', r.message), '_blank');
                    const left = total_lines - chosen.length;
                    frappe.show_alert({
                        message: left > 0
                            ? __('Material Request {0} created for {1} of {2} raw material(s) — the other {3} is still short.',
                                 [r.message, chosen.length, total_lines, left])
                            : __('Material Request {0} created for {1} raw material(s).', [r.message, chosen.length]),
                        indicator: 'green'
                    }, 8);
                    generate_stock_overview_table(frm);
                }
            });
        },
        secondary_action_label: __('Cancel'),
        secondary_action: () => dialog.hide()
    });
    dialog.fields_dict.preview.$wrapper.html(body);
    dialog.show();
}

function so_make_rm_material_request(so_name, item_code, qty, uom, warehouse) {
    frappe.confirm(
        __('Create a Material Request for Raw Material {0} (Qty: {1})?', [esc(item_code), flt(qty)]),
        () => {
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
    );
}

/**
 * Subcontracting Purchase Order for a BOM / job-work finished good.
 * The server builds it in the shape this company already uses (service item on the
 * row, finished good in fg_item) and hands back an unsaved draft to review.
 */
function so_make_subcontract_po(so_name, item_code, qty) {
    frappe.confirm(
        __('Create a Subcontracting Purchase Order for {0} (Qty: {1})?', [esc(item_code), flt(qty)]),
        () => {
            frappe.call({
                method: 'erp_dacsinc_custom.custom_script.make_subcontract_purchase_order',
                args: { sales_order: so_name, item_code: item_code, qty: qty },
                freeze: true,
                freeze_message: __('Building Subcontract PO…'),
                callback: (r) => {
                    if (!r.message) return;   // server threw; Frappe has shown the reason
                    frappe.model.sync(r.message);
                    // Unsaved draft — a new tab has no access to this tab's
                    // client-side cache and would render blank.
                    frappe.set_route('Form', r.message.doctype, r.message.name);
                    frappe.show_alert({
                        message: __('Review the supplier and rate, then save.'),
                        indicator: 'blue'
                    }, 7);
                }
            });
        }
    );
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
        __('Submit Pick List <b>{0}</b>, picking a total of <b>{1}</b>?', [esc(pick_list), flt(total)])
        + `<br><small class="text-muted">${__('Submitting reserves this stock and cannot be undone without cancelling. Anything short of the allocated qty stays visible on the Pick List as picked-vs-allocated.')}</small>`,
        () => {
            frappe.call({
                method: 'erp_dacsinc_custom.custom_script.update_and_submit_pick_list',
                // The edited figure is what was PICKED: the line keeps its
                // allocated qty and picked_qty records the short pick, so
                // "88 allocated, 80 picked" survives on the document.
                args: { pick_list: pick_list, rows: rows, submit: 1, qty_means: 'picked' },
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
function so_make_purchase_order(so_name, item_code, qty) {
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
            const doc = frappe.model.sync(r.message)[0];

            // ERPNext's own mapper has no idea this item is already partly
            // covered by stock, a Pick List or a Delivery Note — it only
            // tracks "how much of this SO line has ever been put on a PO",
            // so a line nothing has been ordered for yet maps at its FULL
            // original qty even when most of it already shipped straight
            // from stock. Cap it back down to the shortfall this action was
            // actually raised for (only when there's exactly one mapped row
            // for this item — a split across warehouses/rates is ERPNext's
            // own call to make, not something to guess at by overwriting).
            const matches = (doc.items || []).filter(it => it.item_code === item_code);
            if (qty != null && matches.length === 1 && flt(matches[0].qty) !== flt(qty)) {
                const row = matches[0];
                row.qty = flt(qty);
                if (row.conversion_factor) row.stock_qty = flt(qty) * flt(row.conversion_factor);
                if (row.rate) row.amount = flt(qty) * flt(row.rate);
            }

            so_show_mapped_doc_preview(doc, {
                preview_title: __('Review Purchase Order'),
                confirm_label: __('Create Purchase Order')
            });
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
 * type: 'stock_details' | 'incoming_docs' | 'picked' | 'rm_stock_details'
 * extra: for 'rm_stock_details', the raw material's item_code within this row's rm_items_status.
 */
function show_details_modal(pair_key, type, extra) {
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
                <td>
                    ${so_qty(doc.pending_qty || 0, 'warn')}
                    ${doc.ordered_qty != null ? `<div class="so-micro" style="margin-top:2px;">${flt(doc.received_qty || 0)} of ${flt(doc.ordered_qty)} received</div>` : ''}
                </td>
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
                <td>
                    ${so_qty(po.pending_qty || 0)}
                    ${po.ordered_qty != null ? `<div class="so-micro" style="margin-top:2px;">${flt(po.received_qty || 0)} of ${flt(po.ordered_qty)} received</div>` : ''}
                </td>
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

    } else if (type === 'rm_stock_details') {
        const rm_item = ((d.rm_procurement_status || {}).rm_items_status || []).find(r => r.rm_code === extra);
        if (!rm_item) {
            frappe.msgprint(__('Raw material stock data not loaded yet. Please refresh the table.'));
            return;
        }
        const rm_heading = `${rm_item.rm_code}${rm_item.rm_name && rm_item.rm_name !== rm_item.rm_code ? ` — ${rm_item.rm_name}` : ''}`;
        title = `Stock Details — ${rm_heading}`;

        const wh_rows = (rm_item.rm_stock_breakdown || []).map(w => `
            <tr>
                <td>${link_id_name('Warehouse', w.warehouse)}</td>
                <td>${so_qty(w.actual_qty, flt(w.actual_qty) > 0 ? 'pos' : null)}</td>
            </tr>`).join('');

        body_html = so_stats([
            { label: 'Counted (VV Puram - IND)', value: flt(rm_item.rm_available_stock || 0), unit: rm_item.rm_uom }
        ])
            + so_section('Warehouse stock (all locations)', `
            <table class="so-table">
                <thead><tr><th>Warehouse</th><th>Qty</th></tr></thead>
                <tbody>${wh_rows}</tbody>
            </table>`, wh_rows, 'Only the VV Puram - IND row above counts toward this order\'s Raw Material calculations.');
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

function so_shortfall(qty, incoming_qty) {
    let html = `<span class="so-shortfall">Shortfall: ${flt(qty)}</span>`;
    // A bare "Shortfall: 200" reads as if nothing has been done about it —
    // when a PO already covers some or all of it, say so right here rather
    // than leaving the reader to separately notice the Incoming column and
    // do that arithmetic themselves.
    const incoming = flt(incoming_qty);
    if (incoming > 0.01) {
        const covers_all = incoming >= flt(qty);
        html += `<div class="so-micro" style="margin-top:2px;color:${covers_all ? 'var(--so-green)' : 'var(--so-orange)'};font-weight:600;">
            ${covers_all
                ? `<i class="fa fa-check-circle"></i> ${incoming} Already on Order — Covers It`
                : `${incoming} Already on Order — ${flt(flt(qty) - incoming)} More Needed`}
        </div>`;
    }
    return html;
}

// Which procurement action(s) a shortfall of `qty` actually calls for.
//
// A shortfall is never just a number to report — it always has a specific
// next step, and which one depends on what already exists: raw material
// missing (go to the RM pipeline), a PO already on the way (track it, and
// only buy whatever that PO does NOT cover), an MR already raised (order
// against it rather than raising a second request for the same shortfall),
// or nothing at all yet (buy it / request it).
//
// Shared so every branch that reports a shortfall offers the SAME next steps.
// They used to diverge: the draft-Pick-List branch pushed only the bare
// "Shortfall: N" note with no action at all, so a line that was waiting on a
// Pick List submission AND genuinely short showed no way to source the
// balance — the shortfall was stated and then abandoned.
//
// `allow_primary` is false where the caller already has its own primary
// action (submitting the Pick List), so the cell never shows two primaries.
function so_shortfall_actions(d, so_nm, ic_arg, pair_key, qty, submitted, allow_primary) {
    const primary = (allow_primary !== false);
    const has_incoming = (flt(d.total_incoming_qty) > 0
        || flt(d.total_incoming_po_count) > 0
        || flt(d.total_incoming_ewo_count) > 0);
    const mr_open = flt(d.total_mr_pending_qty || 0);
    const open_mr = (d.material_requests || []).find(m => flt(m.pending_qty) > 0) || {};
    const rm_shortfall_exists = !!(d.rm_procurement_status && d.rm_procurement_status.rm_shortfall_exists);
    const rm_blocks_this = d.is_bom_item && rm_shortfall_exists;

    const buttons = [];
    let status_note = '';

    if (rm_blocks_this) {
        buttons.push(so_cmd_btn(`so_expand_rm_row('${js_str(pair_key)}')`, 'flask', 'View Raw Materials', primary));
        if (has_incoming) {
            buttons.push(so_cmd_btn(`show_details_modal('${js_str(pair_key)}','incoming_docs')`, 'eye', 'Track Incoming'));
        }
    } else if (has_incoming) {
        const uncovered_by_incoming = Math.max(0, flt(qty) - flt(d.total_incoming_qty));
        if (uncovered_by_incoming > 0.01 && submitted) {
            buttons.push(so_buy_btn(d, so_nm, ic_arg, uncovered_by_incoming, primary));
        }
        buttons.push(so_cmd_btn(`show_details_modal('${js_str(pair_key)}','incoming_docs')`, 'eye', 'Track Incoming',
            primary && uncovered_by_incoming <= 0.01));
        if (mr_open > 0 && open_mr.name) {
            buttons.push(so_cmd_btn(`so_make_po_from_mr('${js_str(open_mr.name)}')`, 'shopping-cart', `Order ${flt(mr_open)} on MR`));
        }
    } else if (mr_open > 0 && open_mr.name) {
        status_note = `<div class="so-micro" style="margin-top:4px;">MR ${esc(open_mr.name)}</div>`;
        if (submitted) {
            buttons.push(so_cmd_btn(`so_make_po_from_mr('${js_str(open_mr.name)}')`, 'shopping-cart', 'Order from MR', primary));
            buttons.push(so_cmd_btn(`so_open_doc('Material Request','${js_str(open_mr.name)}')`, 'external-link', 'Open MR'));
        }
    } else if (submitted) {
        buttons.push(so_buy_btn(d, so_nm, ic_arg, qty, primary));
        if (!d.is_bom_item) {
            buttons.push(so_cmd_btn(`so_make_material_request('${so_nm}')`, 'file-text-o', 'Material Request'));
        }
    }
    return { buttons, status_note, rm_blocks_this, has_incoming };
}

// Once a Sales Order has committed to a fulfillment route (a submitted DN,
// or a submitted "Update Stock" SI — see so_route_lock / guard_so_fulfillment_
// route_lock), calling the action "DN / SI" as if it were still an open
// choice is actively misleading: the choice was already made. Same idea as
// order_flow.js's own _compute_stage_info label (server-side) — kept as one
// small helper here so every place in this widget that names this action
// can never drift out of sync with what route is actually locked in.
function so_dn_si_action_label(route_lock, qty) {
    const suffix = (qty != null) ? ` (${flt(qty)})` : '';
    if (route_lock === 'dn') return `Create Delivery Note${suffix}`;
    if (route_lock === 'si') return `Create Sales Invoice (Update Stock)${suffix}`;
    return `Create DN / SI${suffix}`;
}

function so_dn_si_status_label(route_lock) {
    if (route_lock === 'dn') return 'Ready — Delivery Note';
    if (route_lock === 'si') return 'Ready — Sales Invoice';
    return 'Ready for DN / SI';
}

// A Next Action command button. `primary` marks the one step that moves
// this line forward; anything else is a secondary option.
function so_cmd_btn(onclick, icon, label, primary) {
    return `<button class="so-btn${primary ? ' so-btn--primary' : ''}" onclick="${onclick}">`
        + `<i class="fa fa-${icon}"></i> ${esc(label)}</button>`;
}

// Joins a Next Action cell's parts (buttons, shortfall/note spans) into the
// final markup. When a cell genuinely offers more than one real action —
// e.g. both "Purchase Order" and "Material Request" for the same shortfall —
// a plain vertical stack read as one primary button plus an unlabelled
// afterthought, with no visual cue that the second one is a real,
// independently clickable alternative rather than a detail of the first.
// Only kicks in with 2+ actual <button class="so-btn> entries — the common
// case of a single action (the overwhelming majority of cells) is untouched.
function so_build_action_html(action_parts) {
    if (!action_parts.length) return `<span class="so-action__note">—</span>`;
    const is_btn = (html) => /class="so-btn\b/.test(html);

    // "or"/"Recommended" only ever apply WITHIN a contiguous run of real
    // buttons — a note/shortfall span (or an explicit '' break, pushed
    // wherever a caller needs to keep two genuinely independent actions
    // from being read as alternatives) ends the run. Two buttons on
    // opposite sides of one of those are separate, both-may-be-needed
    // actions (e.g. "ship what's already picked" + "source the rest of
    // the shortfall"), never a choice between one or the other.
    const parts = [];
    let i = 0;
    while (i < action_parts.length) {
        if (!is_btn(action_parts[i])) {
            parts.push(action_parts[i]);
            i++;
            continue;
        }
        let j = i;
        while (j < action_parts.length && is_btn(action_parts[j])) j++;
        const run = action_parts.slice(i, j);
        if (run.length > 1) {
            run.forEach((html, k) => {
                if (k > 0) parts.push(`<span class="so-action__or">${esc(__('or'))}</span>`);
                if (/so-btn--primary/.test(html)) {
                    parts.push(`<span class="so-action__tag">${esc(__('Recommended'))}</span>`);
                }
                parts.push(html);
            });
        } else {
            parts.push(run[0]);
        }
        i = j;
    }
    return `<div class="so-action">${parts.join('')}</div>`;
}

// Jumps straight to the Raw Material Pipeline sub-row for this item/BOM —
// used by the FG row's "View Raw Materials" Next Action so a real RM
// shortfall (which needs a Material Request, not just waiting) is one click
// away instead of requiring the user to find and click the row's own caret.
function so_expand_rm_row(pair_key) {
    const $row = $('tr.so-row-main').filter(function () {
        return $(this).data('pair-key') === pair_key;
    }).first();
    if (!$row.length) return;
    const $rm = $row.next('tr.so-rm-row');
    if (!$rm.length) return;
    $row.addClass('is-open');
    $rm.show();
    $rm[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// True only when every raw material line of this BOM item is PHYSICALLY in
// stock right now (available >= needed) — a pending Material Request or
// Purchase Order for the shortfall does not count. Mirrors the server-side
// rule in custom_script.check_bom_raw_materials_in_stock, computed here from
// the same rm_items_status data get_rm_breakdown_html already renders, so
// the two never disagree. An item with no rm_items_status at all (lookup
// failed, or a BOM with no lines) fails open — nothing to block on.
//
// `qty`, when given, is the SPECIFIC fg qty the caller is actually about to
// raise a Subcontract PO for — NOT necessarily this row's own full,
// unmodified fg_shortfall. An earlier, partial Subcontract PO/SCO can
// already have committed raw material for PART of that shortfall (shown as
// "Outstanding at Jobber" further down) — rm_needed_for_shortfall keeps
// reflecting the FULL original shortfall regardless, so checking physical
// stock against that stale, too-large figure incorrectly blocked a second,
// smaller Subcontract PO for just the remaining balance even when there was
// exactly enough stock for THAT smaller amount (confirmed live: 200 fg
// shortfall committed 150 of it to an earlier SCO, leaving 50 genuinely
// remaining; stock physically covered that 50 exactly, but the check —
// comparing against RM needed for the full 200 — still said "not in
// stock"). check_bom_raw_materials_in_stock server-side already takes the
// real qty being ordered as its own parameter and gets this right; this
// mirrors that by recomputing "needed" from qty * rm_qty_per_fg per row
// when qty is passed, instead of trusting the row's own static figure.
function so_rm_physically_in_stock(d, qty) {
    const rm_items = ((d.rm_procurement_status || {}).rm_items_status) || [];
    // Compare at the same 2-decimal precision the RM Pipeline table itself
    // displays (Stock / Needed / Shortfall are all shown rounded to 2dp) —
    // a raw floating-point remainder like 13.999 vs a needed 14.0 (a UOM
    // conversion artifact, not a genuine shortage) used to read as "RM Not
    // in Stock" here while the table right below it showed a matching
    // Stock figure and a 0.00 Shortfall — two supposedly-agreeing checks
    // visibly disagreeing over a thousandth of a unit.
    if (qty == null) {
        return rm_items.every(rm => flt(rm.rm_available_stock, 2) >= flt(rm.rm_needed_for_shortfall, 2));
    }
    return rm_items.every(rm => {
        const needed_for_qty = flt(qty) * flt(rm.rm_qty_per_fg || 0);
        return flt(rm.rm_available_stock, 2) >= flt(needed_for_qty, 2);
    });
}

/**
 * The right way to buy this item.
 * A finished good with a BOM (or flagged as sub-contracted) is not bought off the
 * shelf here — it goes out as job work on a subcontracting PO. Offering a plain
 * Purchase Order for those items sends the user down the wrong path.
 */
function so_buy_btn(d, so_name_arg, item_arg, qty, primary) {
    const subcontract = (d.is_sub_contracted_item || d.is_bom_item) && d.bom_no;
    if (!subcontract) {
        return so_cmd_btn(`so_make_purchase_order('${so_name_arg}','${item_arg}',${flt(qty)})`,
            'shopping-cart', 'Purchase Order', primary);
    }
    // Hard block, no override: raw materials must be physically in stock
    // before a Subcontract PO can be raised — see so_rm_physically_in_stock.
    // The server enforces this too (make_subcontract_purchase_order), so this
    // is about giving the user the right indication, not just UX polish.
    // Checked against THIS qty specifically (the amount this exact button
    // would raise a Subcontract PO for), not the row's full original
    // shortfall — see so_rm_physically_in_stock's own comment for why that
    // distinction matters once an earlier, partial Subcontract PO already
    // exists for part of it.
    if (!so_rm_physically_in_stock(d, qty)) {
        return `<span class="so-action__note so-action__note--blocked" style="color:var(--so-red);font-weight:600;"
            title="${esc('Raw materials for this BOM are not fully in stock yet. See the Raw Material Pipeline below — request or order the shortfall, then wait for it to arrive before creating a Subcontract PO.')}">
            <i class="fa fa-ban"></i> RM Not in Stock — PO Blocked</span>`;
    }
    return so_cmd_btn(`so_make_subcontract_po('${so_name_arg}','${item_arg}',${flt(qty)})`,
        'cogs', 'Subcontract PO', primary);
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
        <div class="so-scroll-hint"><i class="fa fa-arrows-h"></i> ${__('Scroll sideways to see every column')}</div>
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


function show_bulk_dn_si_modal(frm, submitted_pls, doctype, already_processed_count, existing_drafts) {
    // Where more than one Pick List still has qty to ship, choosing WHICH of
    // them this document covers comes first — the same select-your-sources
    // step every other create-from action uses. Without it this button
    // silently swept every eligible Pick List into one document, with no way
    // to ship some now and the rest later.
    const eligible = (submitted_pls || []).filter(
        p => flt(p.picked_qty != null ? p.picked_qty : p.qty) - flt(p.delivered_qty || 0) > 0.001);
    const eligible_names = [...new Set(eligible.map(p => p.name))];

    if (eligible_names.length > 1 && !show_bulk_dn_si_modal._picked) {
        const qty_by_name = {};
        eligible.forEach(p => {
            const rem = flt(p.picked_qty != null ? p.picked_qty : p.qty) - flt(p.delivered_qty || 0);
            qty_by_name[p.name] = flt(qty_by_name[p.name] || 0) + rem;
        });
        so_pick_source_docs({
            doctype: 'Pick List',
            names: eligible_names,
            multi: true,
            qty_by_name: qty_by_name,
            title: __('Create {0} — select Pick List(s)', [doctype]),
            hint: __('All {0} Pick Lists with qty still to ship are selected. Untick any to leave for a later {1} — whatever you leave out stays outstanding.',
                [eligible_names.length, doctype]),
            confirm_label: __('Continue'),
            on_confirm: (selected) => {
                const chosen = submitted_pls.filter(p => selected.indexOf(p.name) !== -1);
                const deferred = eligible_names.filter(n => selected.indexOf(n) === -1);
                // Re-enter with just the chosen Pick Lists; the guard stops
                // this branch running a second time on the same click.
                show_bulk_dn_si_modal._picked = true;
                try {
                    show_bulk_dn_si_modal(frm, chosen, doctype, already_processed_count, existing_drafts, deferred);
                } finally {
                    show_bulk_dn_si_modal._picked = false;
                }
            },
        });
        return;
    }
    const deferred_pls = arguments[5] || [];
    // This dialog can be opened straight from the dashboard's top-level
    // "Create DN / SI" action (order_flow.js), with no Sales Order widget
    // ever rendered on the page first — so the shared .so-* stylesheet
    // (normally injected once by whichever widget loads first) may not
    // exist yet. inject_so_styles() is a no-op once it's already there.
    inject_so_styles();

    if (!submitted_pls || !submitted_pls.length) {
        frappe.msgprint(__('No submitted Pick Lists found.'));
        return;
    }
    existing_drafts = existing_drafts || [];
    const route_doctype = doctype === 'Delivery Note' ? 'delivery-note' : 'sales-invoice';

    // A "Partly Delivered" Pick List still has a remaining, un-delivered
    // balance on its line — picked_qty minus what's already gone out via an
    // earlier DN/SI — so that remainder, not the full picked_qty, is what
    // this preview (and the actual document the server builds) must use.
    const grouped = {};
    let any_partial = false;
    submitted_pls.forEach(p => {
        const remaining = flt(p.picked_qty != null ? p.picked_qty : p.qty) - flt(p.delivered_qty || 0);
        if (remaining <= 0) return;

        const is_partial = (p.status || 'Open') === 'Partly Delivered';
        if (is_partial) any_partial = true;

        const key = `${p.item_code}||${p.warehouse}`;
        if (!grouped[key]) {
            grouped[key] = {
                item_code: p.item_code,
                warehouse: p.warehouse,
                qty: 0,
                pick_lists: new Set(),
                partial_pick_lists: new Set()
            };
        }
        grouped[key].qty += remaining;
        grouped[key].pick_lists.add(p.name);
        if (is_partial) grouped[key].partial_pick_lists.add(p.name);
    });

    if (!Object.keys(grouped).length) {
        frappe.msgprint(__('Every selected Pick List line is already fully delivered or invoiced — nothing left to create.'));
        return;
    }

    const rows_html = Object.values(grouped).map(g => `
        <tr>
            <td><b>${esc(g.item_code)}</b></td>
            <td>${esc(g.warehouse || '—')}</td>
            <td>${so_qty(g.qty)}</td>
            <td class="so-meta">${Array.from(g.pick_lists).map(name =>
                g.partial_pick_lists.has(name) ? `${esc(name)} <span class="so-chip" style="background:var(--so-orange);">Partial — remaining only</span>` : esc(name)
            ).join(', ')}</td>
        </tr>
    `).join('');

    const body_html = `
        <div class="so-modal">
            ${existing_drafts.length ? `
                <div class="so-alert so-alert--warning">
                    <div class="so-alert__icon"><i class="fa fa-exclamation-triangle"></i></div>
                    <div class="so-alert__body">
                        <div class="so-alert__title">${__('{0} already in progress', [doctype])}</div>
                        <div class="so-alert__text">${__('This order already has a draft {0} below. Open it to continue working on it — only make a new one if you specifically mean to create a separate document.', [doctype])}</div>
                        <div class="so-alert__actions">
                            ${existing_drafts.map(name => `
                                <a class="so-draft-link" href="/app/${route_doctype}/${encodeURIComponent(name)}" target="_blank">
                                    <i class="fa fa-external-link"></i> ${esc(name)}
                                </a>
                            `).join('')}
                        </div>
                    </div>
                </div>
            ` : ''}
            <div class="so-alert so-alert--info">
                <div class="so-alert__icon"><i class="fa fa-info-circle"></i></div>
                <div class="so-alert__body">
                    <div class="so-alert__text">${__('Creating a draft <b>{0}</b> mapping the items and quantities picked below:', [doctype])}</div>
                </div>
            </div>
            ${deferred_pls.length ? `
            <div class="so-alert so-alert--warning">
                <div class="so-alert__icon"><i class="fa fa-clock-o"></i></div>
                <div class="so-alert__body">
                    <div class="so-alert__title">${__('{0} Pick List(s) left out — still outstanding', [deferred_pls.length])}</div>
                    <div class="so-alert__text">${__('Not included in this {0}. Create another one for these when ready:', [doctype])}</div>
                    <div class="so-alert__actions">
                        ${deferred_pls.map(name => `
                            <a class="so-draft-link" href="/app/pick-list/${encodeURIComponent(name)}" target="_blank">
                                <i class="fa fa-external-link"></i> ${esc(name)}
                            </a>
                        `).join('')}
                    </div>
                </div>
            </div>` : ''}
            ${already_processed_count > 0 ? `
                <div class="so-alert so-alert--muted">
                    <div class="so-alert__icon"><i class="fa fa-check-circle"></i></div>
                    <div class="so-alert__body">
                        <div class="so-alert__text">${__('{0} Pick List line(s) are already fully delivered/invoiced and are not shown here — only lines with something outstanding appear below.', [already_processed_count])}</div>
                    </div>
                </div>
            ` : ''}
            ${any_partial ? `
                <div class="so-alert so-alert--muted">
                    <div class="so-alert__icon"><i class="fa fa-exclamation-circle"></i></div>
                    <div class="so-alert__body">
                        <div class="so-alert__text">${__('One or more Pick Lists below are already Partly Delivered — only their remaining, not-yet-delivered balance is included in the quantities shown.')}</div>
                    </div>
                </div>
            ` : ''}
            <div class="so-scroll">
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
            const confirm_msg = existing_drafts.length
                ? __('A draft <b>{0}</b> ({1}) already exists for this order. Create ANOTHER one for customer <b>{2}</b> anyway?',
                     [doctype, existing_drafts.map(esc).join(', '), esc(frm.doc.customer_name || frm.doc.customer)])
                : __('Create a draft <b>{0}</b> for customer <b>{1}</b> from these Pick Lists?',
                     [doctype, esc(frm.doc.customer_name || frm.doc.customer)]);
            frappe.confirm(
                confirm_msg,
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
                            // Unsaved draft — a new tab has no access to this tab's
                            // client-side cache and would render blank.
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
// Used by the Order Flow dashboard too (it frappe.require()s this file), so
// its create-from actions get the same select-your-sources step and the same
// detailed preview instead of a second, thinner implementation of both.
window.so_pick_source_docs = so_pick_source_docs;
window.so_show_mapped_doc_preview = so_show_mapped_doc_preview;

// Next Action commands
window.so_open_doc = so_open_doc;
window.so_prompt_dn_or_si = so_prompt_dn_or_si;
window.so_make_sales_invoice_with_stock = so_make_sales_invoice_with_stock;
window.so_make_material_request = so_make_material_request;
window.so_make_sales_invoice = so_make_sales_invoice;
window.so_make_sales_invoice_from_dn = so_make_sales_invoice_from_dn;
window.so_make_sales_invoice_from_all_dns = so_make_sales_invoice_from_all_dns;
window.so_make_rm_material_request = so_make_rm_material_request;
window.so_make_po_from_mr = so_make_po_from_mr;
window.so_make_purchase_order = so_make_purchase_order;
window.so_make_subcontract_po = so_make_subcontract_po;
window.so_submit_pick_list = so_submit_pick_list;
window.so_confirm_submit_pick_list = so_confirm_submit_pick_list;
window.so_fix_stale_pick_lists = so_fix_stale_pick_lists;
