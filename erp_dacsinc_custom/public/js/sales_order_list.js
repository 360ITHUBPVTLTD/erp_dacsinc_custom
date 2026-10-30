// Old/superseded Sales Orders (custom_old_record_item_is_disabled = 1) should
// not clutter the default view — matches core Item's own "disabled = 0"
// default filter.
//
// The static `filters` property below only seeds a brand-new list view with
// no saved state. Every real user on this site already has a saved (empty)
// Sales Order list filter from before this field existed, and that saved
// state wins over the static default every time (see list_view.js
// setup_defaults: view_user_settings.filters takes priority). So the
// onload below actively re-applies the filter on every visit instead —
// idempotent (filter_area.add() no-ops if it's already present), and a user
// who explicitly removes it during a session keeps it off until they
// navigate away and back.
frappe.listview_settings['Sales Order'] = frappe.listview_settings['Sales Order'] || {};
frappe.listview_settings['Sales Order'].filters = [["Sales Order", "custom_old_record_item_is_disabled", "=", 0]];

(function () {
    const existing_onload = frappe.listview_settings['Sales Order'].onload;
    frappe.listview_settings['Sales Order'].onload = function (listview) {
        if (existing_onload) {
            try { existing_onload(listview); } catch (e) { /* keep ours working */ }
        }
        listview.filter_area.add([["Sales Order", "custom_old_record_item_is_disabled", "=", 0]]);
    };
})();

// Order Stage — the Order Flow dashboard's stage, stored on each order and kept up to date by
// so_stage.py (docs/order-flow-dashboard.md, "The stage on the Sales Order list"). A coloured
// column, and a Stage bar with counts above the list (the list's other filters apply to the
// counts); a click filters by that stage, again clears it.
(function () {
    const S = frappe.listview_settings['Sales Order'];
    const STAGES = [
        ['Draft (Awaiting Approval)', 'gray'],
        ['Rejected', 'red'],
        ['Nothing Raised Yet', 'orange'],
        ['MR Raised', 'orange'],
        ['Awaiting Stock (PO)', 'yellow'],
        ['In Job Work', 'purple'],
        ['Embroidery', 'purple'],
        ['Receiving (Draft PR)', 'gray'],
        ['Stock Arrived', 'cyan'],
        ['Draft Pick List', 'gray'],
        ['Ready to Dispatch', 'blue'],
        ['Dispatched — Invoice Pending', 'pink'],
        ['Completed', 'green'],
        ['Closed', 'darkgrey'],
        ['Cancelled', 'red'],
    ];
    const COLOR = Object.fromEntries(STAGES);
    const FIELD = 'custom_order_stage';
    const esc = frappe.utils.escape_html;

    S.add_fields = (S.add_fields || []).concat(['custom_stage_detail', 'custom_needs_invoice', 'workflow_state']);

    // Status says Rejected, not Draft, for a draft the approval workflow rejected (list and form
    // header). Frappe answers "Draft" for every draft itself unless has_indicator_for_draft is set,
    // so with it set the other drafts get Frappe's own Draft back here.
    const std_indicator = S.get_indicator;
    S.has_indicator_for_draft = 1;
    S.get_indicator = function (doc) {
        if (doc.docstatus === 0) {
            return doc.workflow_state === 'Rejected'
                ? [__('Rejected'), 'red', 'workflow_state,=,Rejected']
                : [__('Draft'), 'red', 'docstatus,=,0'];
        }
        return std_indicator ? std_indicator(doc) : undefined;
    };
    S.formatters = S.formatters || {};
    S.formatters[FIELD] = function (value, df, doc) {
        if (!value) return '';
        const detail = doc.custom_stage_detail && doc.custom_stage_detail !== value ? doc.custom_stage_detail : '';
        const bill = value === 'Rejected' && detail
            ? ` <span class="text-muted small">${esc(detail.replace(/^Rejected /, ''))}</span>`
            : doc.custom_needs_invoice && value !== 'Dispatched — Invoice Pending'
                ? ` <span class="text-muted small">+ ${__('Needs Invoice')}</span>` : '';
        return `<span class="indicator-pill ${COLOR[value] || 'gray'} ellipsis" title="${esc(detail || value)}">`
            + `<span class="ellipsis">${esc(__(value))}</span></span>${bill}`;
    };

    const css = `
        .so-stage-bar { display:flex; flex-wrap:wrap; gap:6px; align-items:center; padding:8px 15px;
            border-bottom:1px solid var(--border-color); }
        .so-stage-bar__label { font-size:var(--text-sm); color:var(--text-muted); margin-right:2px; }
        .so-stage-btn { border:1px solid var(--border-color); background:var(--fg-color); border-radius:999px;
            padding:2px 10px; font-size:var(--text-sm); color:var(--text-color); cursor:pointer; white-space:nowrap; }
        .so-stage-btn:hover { background:var(--fg-hover-color); }
        .so-stage-btn.is-active { background:var(--text-color); color:var(--fg-color); border-color:var(--text-color); }
        .so-stage-btn .indicator { margin-right:2px; }
        .so-stage-btn b { margin-left:4px; font-weight:600; }
        .so-stage-btn.is-empty { opacity:.5; }`;

    const current = (lv) => (lv.filter_area.get() || []).find(f => f[1] === FIELD && f[2] === '=');

    function paint(lv) {
        let $bar = lv.$frappe_list.find('.so-stage-bar');
        if (!$bar.length) {
            if (!document.getElementById('so-stage-css')) $('<style id="so-stage-css">').text(css).appendTo('head');
            $bar = $('<div class="so-stage-bar"></div>').insertBefore(lv.$result);
            $bar.on('click', '.so-stage-btn', function () {
                const stage = $(this).attr('data-stage');
                const cur = current(lv);
                const p = lv.filter_area.remove(FIELD);
                Promise.resolve(p).then(() => {
                    if (stage && !(cur && cur[3] === stage)) lv.filter_area.add([['Sales Order', FIELD, '=', stage]]);
                });
            });
        }
        const others = (lv.filter_area.get() || []).filter(f => f[1] !== FIELD);
        frappe.xcall('frappe.desk.listview.get_group_by_count',
            { doctype: 'Sales Order', current_filters: others, field: FIELD }).then((rows) => {
            const n = Object.fromEntries((rows || []).map(r => [r.name || '', r.count]));
            const total = (rows || []).reduce((a, r) => a + r.count, 0);
            const cur = current(lv);
            const btn = (stage, label, color, count) => `
                <button class="so-stage-btn ${(cur ? cur[3] === stage : !stage) ? 'is-active' : ''} ${count ? '' : 'is-empty'}"
                        data-stage="${esc(stage)}">
                    ${color ? `<span class="indicator ${color}"></span>` : ''}${esc(label)}<b>${count}</b>
                </button>`;
            $bar.html(`<span class="so-stage-bar__label">${__('Stage')}:</span>`
                + btn('', __('All'), '', total)
                + STAGES.filter(([s]) => n[s] || ['Closed', 'Cancelled'].indexOf(s) < 0)
                    .map(([s, c]) => btn(s, __(s), c, n[s] || 0)).join(''));
        });
    }

    const prev_refresh = S.refresh;
    S.refresh = function (lv) {
        if (prev_refresh) {
            try { prev_refresh(lv); } catch (e) { /* keep ours working */ }
        }
        paint(lv);
    };
})();
