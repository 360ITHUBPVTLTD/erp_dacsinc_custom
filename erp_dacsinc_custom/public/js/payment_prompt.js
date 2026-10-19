// Receive / Pay prompt: record a payment against one Sales / Purchase Invoice
// (dashboard_payment.py). Used by Order Flow › Finance (Receive / Pay on a row) and by the
// Sales Invoice / Purchase Invoice forms (their "Receive Payment" / "Make Payment" button, in
// place of ERPNext's Create › Payment). Loaded on demand with frappe.require.
// Step 1 asks what a Payment Entry needs; step 2 shows everything back with the ledger
// effect and needs a tick before it submits.
//
// opts.from_form: opened from the invoice form — the server then needs only Payment Entry
// create + submit permission (as Create › Payment does), not the Order Flow Finance tab.

(function () {
    if (document.getElementById('of-payment-prompt-css')) return;
    const st = document.createElement('style');
    st.id = 'of-payment-prompt-css';
    st.textContent = `/* ── Finance › Receive / Pay prompt (of_payment_prompt) ─────────────── */
.of-pay-dialog .modal-content { border-radius: 12px; overflow: hidden; }
.of-pay-dialog .modal-body, .of-pay-dialog .control-label, .of-pay-dialog input, .of-pay-dialog select, .of-pay-dialog textarea { font-size: 12.5px; }
.of-pay-dialog .form-section .section-head { font-size: 12px; font-weight: 700; color: var(--heading-color); letter-spacing: .01em; }
.of-pay-dialog .form-section { border-top: 1px solid var(--border-color); }
.of-pay-dialog .form-section:first-child { border-top: 0; }
.of-pay-dialog .help-box, .of-pay-dialog .frappe-control .help-box { font-size: 11px !important; color: var(--text-muted); margin-top: 3px; }
.of-pay-dialog [data-fieldname="mode_of_payment"] select { font-weight: 600; }

.of-pay-head { border-radius: 10px; padding: 10px 12px; display: grid; gap: 8px; margin-bottom: 2px; }
.of-pay-head.is-in  { background: linear-gradient(135deg, rgba(39,174,96,.10), rgba(39,174,96,.03)); border: 1px solid rgba(39,174,96,.25); }
.of-pay-head.is-out { background: linear-gradient(135deg, rgba(243,156,18,.12), rgba(243,156,18,.03)); border: 1px solid rgba(243,156,18,.28); }
.of-pay-head__party { display: grid; gap: 2px; }
.of-pay-head__party b { font-size: 14px; line-height: 1.25; color: var(--heading-color); }
.of-pay-head__role { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
.of-pay-head.is-in .of-pay-head__role { color: #1e8449; }
.of-pay-head.is-out .of-pay-head__role { color: #b9770e; }
.of-pay-head__doc { font-size: 11px; color: var(--text-muted); }
.of-pay-head__tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
.of-pay-head__tiles > div { background: var(--card-bg, #fff); border: 1px solid var(--border-color); border-radius: 8px; padding: 5px 9px; display: grid; gap: 0; }
.of-pay-head__tiles span { font-size: 10.5px; color: var(--text-muted); font-weight: 600; }
.of-pay-head__tiles b { font-size: 13px; font-variant-numeric: tabular-nums; }
.of-pay-head__tiles .is-due b { color: var(--of-red, #e24c4c); }
.of-pay-head__tiles .is-late { border-color: rgba(226,76,76,.4); }
.of-pay-head__tiles em { font-style: normal; font-size: 10.5px; font-weight: 700; color: #fff; background: var(--of-red, #e24c4c); border-radius: 8px; padding: 0 6px; justify-self: start; }
.of-pay-head__note { font-size: 12px; color: var(--text-muted); }

.of-pay-dialog [data-fieldname="settle_amount"] input { font-size: 15px !important; font-weight: 700; height: 34px !important; font-variant-numeric: tabular-nums; }
.of-pay-dialog [data-fieldname="amount"] input { font-size: 13px !important; font-weight: 600; height: 32px !important; font-variant-numeric: tabular-nums; }
.of-pay-quick { margin: -4px 0 10px; border: 1px dashed var(--of-blue, #2490ef); background: transparent; color: var(--of-blue, #2490ef);
    border-radius: 14px; padding: 3px 10px; font-size: 11.5px; font-weight: 600; cursor: pointer; }
.of-pay-quick .fa { display: none; }
.of-pay-quick.is-on { background: var(--of-blue, #2490ef); color: #fff; border-style: solid; }
.of-pay-quick.is-on .fa { display: inline; }

.of-pay-sum { border-radius: 10px; border: 1px solid var(--border-color); overflow: hidden; background: var(--card-bg, #fff); margin-top: 20px; }
.of-pay-sum__big { padding: 9px 12px; display: grid; gap: 2px; }
.of-pay-sum.is-in .of-pay-sum__big  { background: rgba(39,174,96,.08); }
.of-pay-sum.is-out .of-pay-sum__big { background: rgba(243,156,18,.10); }
.of-pay-sum__big span { font-size: 11px; color: var(--text-muted); font-weight: 600; }
.of-pay-sum__big b { font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }
.of-pay-sum.is-in .of-pay-sum__big b  { color: #1e8449; }
.of-pay-sum.is-out .of-pay-sum__big b { color: #b9770e; }
.of-pay-sum__big small { font-size: 11px; color: var(--text-muted); }
.of-pay-sum__rows { padding: 7px 12px; display: grid; gap: 3px; font-size: 12px; }
.of-pay-sum__row { display: flex; justify-content: space-between; gap: 10px; font-variant-numeric: tabular-nums; }
.of-pay-sum__row i { font-style: normal; display: inline-block; width: 12px; color: var(--text-muted); font-weight: 700; }
.of-pay-sum__row.is-cut { color: var(--text-muted); }
.of-pay-sum__row.is-total { border-top: 1px dashed var(--border-color); padding-top: 5px; margin-top: 2px; color: var(--of-blue, #2490ef); }
.of-pay-sum__out { display: flex; justify-content: space-between; gap: 10px; padding: 7px 12px; border-top: 1px solid var(--border-color); font-size: 12px; }
.of-pay-sum__out s { color: var(--text-muted); }
.of-pay-sum__state { padding: 7px 12px; font-size: 12px; font-weight: 700; }
.of-pay-sum__state.is-full { background: rgba(39,174,96,.10); color: #1e8449; }
.of-pay-sum__state.is-part { background: rgba(243,156,18,.12); color: #b9770e; }
.of-pay-sum__state.is-adv  { background: rgba(36,144,239,.10); color: var(--of-blue, #2490ef); }

.of-pay-modeinfo { font-size: 12px; color: var(--text-color); margin: 0 0 10px; }
.of-pay-modeinfo .fa { color: var(--text-muted); margin-right: 3px; }
.of-pay-modeinfo.is-empty { color: var(--of-orange, #f39c12); }

.of-pay-rcpt { border: 1px solid var(--border-color); border-radius: 10px; overflow: hidden; font-size: 12px; }
.of-pay-rcpt__top { padding: 10px 12px; display: grid; gap: 3px; text-align: center; }
.of-pay-rcpt.is-in .of-pay-rcpt__top  { background: rgba(39,174,96,.08); }
.of-pay-rcpt.is-out .of-pay-rcpt__top { background: rgba(243,156,18,.10); }
.of-pay-rcpt__top > span { font-size: 11.5px; color: var(--text-muted); }
.of-pay-rcpt__amt { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
.of-pay-rcpt.is-in .of-pay-rcpt__amt  { color: #1e8449; }
.of-pay-rcpt.is-out .of-pay-rcpt__amt { color: #b9770e; }
.of-pay-rcpt__row { display: flex; justify-content: space-between; gap: 12px; padding: 5px 12px; border-top: 1px solid var(--border-color); }
.of-pay-rcpt__row span { color: var(--text-muted); }
.of-pay-rcpt__row b { font-variant-numeric: tabular-nums; text-align: right; }
.of-pay-rcpt__row.is-cut b { color: var(--text-muted); font-weight: 600; }
.of-pay-rcpt__row.is-total { background: rgba(36,144,239,.06); }
.of-pay-rcpt__row.is-total b { color: var(--of-blue, #2490ef); }
.of-pay-gl { margin: 10px 0 0; font-size: 12.5px; }
.of-pay-gl summary { cursor: pointer; color: var(--of-blue, #2490ef); font-weight: 600; }
.of-pay-gl table { width: 100%; margin-top: 6px; border: 1px solid var(--border-color); }
.of-pay-gl th { background: var(--subtle-fg); padding: 4px 8px; font-weight: 600; }
.of-pay-gl th + th { text-align: right; }
.of-pay-warn { margin-top: 10px; font-size: 12px; padding: 8px 10px; border-radius: 8px; background: #fff8e6; color: #8a6100; border: 1px solid #f5d98b; }
@media (max-width: 640px) { .of-pay-sum { margin-top: 4px; } }
`;
    document.head.appendChild(st);
})();

function pp_esc(v) {
    if (v === undefined || v === null) return '';
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function of_payment_prompt(doctype, name, on_done, opts) {
    opts = opts || {};
    frappe.call({
        method: 'erp_dacsinc_custom.dashboard_payment.get_payment_prompt',
        args: { doctype, name, from_form: opts.from_form ? 1 : 0 },
    }).then(r => {
        const d = r.message;
        if (!d) return;
        const money = (v) => format_currency(flt(v, 2), d.currency);
        const receive = d.receive;
        const mode_by_name = Object.fromEntries((d.modes || []).map(m => [m.name, m]));
        // Only sensible ledgers in each account box (record_payment checks the same).
        const acc_filter = () => ({ filters: { company: d.company, is_group: 0, root_type: 'Expense', disabled: 0 } });
        const tds_filter = () => ({ filters: [['company', '=', d.company], ['is_group', '=', 0], ['disabled', '=', 0],
            ['account_name', 'like', '%TDS%'], ['root_type', 'in', ['Asset', 'Liability']]] });

        const dlg = new frappe.ui.Dialog({
            title: receive ? __('Receive Payment — {0}', [d.name]) : __('Make Payment — {0}', [d.name]),
            size: 'large',
            fields: [
                { fieldtype: 'HTML', fieldname: 'head' },
                // ① How much — the settled amount (big), the bank amount under it, live summary beside.
                { fieldtype: 'Section Break', label: receive ? __('① How much is received') : __('① How much is paid') },
                // Two amounts, kept in step (sync below): what this payment clears on the invoice,
                // and what actually moves through the bank / cash after the deductions.
                { fieldtype: 'Float', precision: 2, fieldname: 'settle_amount', reqd: 1, default: d.outstanding,
                  label: receive ? __('Amount settled on this invoice') : __('Amount settled on this bill'),
                  description: receive ? __('Includes any bank charges, TDS or write-off below.') : __('Includes any TDS or write-off below.') },
                { fieldtype: 'HTML', fieldname: 'quick' },
                { fieldtype: 'Float', precision: 2, fieldname: 'amount', reqd: 1, default: d.outstanding,
                  label: receive ? __('Amount credited in bank / cash') : __('Amount paid to supplier'),
                  description: receive ? __('Calculated for you — change it if the bank shows a different figure.')
                                       : __('Calculated for you. Bank charges are extra, from your bank.') },
                { fieldtype: 'Column Break' },
                { fieldtype: 'HTML', fieldname: 'summary' },
                // ② How — mode (only modes ticked "Show in Payment Entry", payment_modes.py), date, reference.
                { fieldtype: 'Section Break', label: __('② Payment details') },
                { fieldtype: 'Select', fieldname: 'mode_of_payment', label: __('Mode of Payment'), reqd: 1,
                  options: [''].concat((d.modes || []).map(m => m.name)).join('\n') },
                { fieldtype: 'HTML', fieldname: 'mode_info' },
                { fieldtype: 'Date', fieldname: 'posting_date', label: __('Payment Date'), reqd: 1, default: frappe.datetime.get_today() },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Data', fieldname: 'reference_no', label: __('Reference No (UTR / Cheque No)') },
                { fieldtype: 'Date', fieldname: 'reference_date', label: __('Reference Date') },
                // ③ Only if any — folded until opened (opens by itself when a value is set).
                { fieldtype: 'Section Break', fieldname: 'sec_deductions', collapsible: 1,
                  label: receive ? __('③ Bank charges, TDS, write-off (only if any)') : __('③ Bank charges, TDS, write-off (only if any)') },
                { fieldtype: 'Float', precision: 2, fieldname: 'bank_charges',
                  label: receive ? __('Bank charges cut by the bank') : __('Bank charges paid by us (extra)'),
                  description: receive ? __('The bank kept it — not in the credited amount.') : __('On top of the amount paid, from your bank.') },
                { fieldtype: 'Float', precision: 2, fieldname: 'tds_amount',
                  label: receive ? __('TDS cut by the customer') : __('TDS cut by us now (not on the bill)'),
                  description: receive ? __('The customer kept it as TDS.') : __('We keep it and pay it to the government.') },
                { fieldtype: 'Float', precision: 2, fieldname: 'write_off_amount', label: __('Small difference to write off'),
                  description: __('A few rupees nobody pays (round off).') },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Link', fieldname: 'bank_charges_account', label: __('Bank Charges Account'), options: 'Account',
                  default: d.defaults.bank_charges_account, get_query: acc_filter },
                { fieldtype: 'Link', fieldname: 'tds_account', label: __('TDS Account'), options: 'Account',
                  default: d.defaults.tds_account, get_query: tds_filter },
                { fieldtype: 'Link', fieldname: 'write_off_account', label: __('Write Off Account'), options: 'Account',
                  default: d.defaults.write_off_account, get_query: acc_filter },
                { fieldtype: 'Section Break', fieldname: 'sec_remarks', collapsible: 1, label: __('Remarks (optional)') },
                { fieldtype: 'Small Text', fieldname: 'remarks', label: __('Remarks') },
            ],
            primary_action_label: __('Review'),
            primary_action: (v) => review(v),
        });

        // Keep "settled" and "credited / paid" in step: change the settled amount or a deduction →
        // the bank amount follows; change the bank amount → the settled amount follows.
        let syncing = false;
        const cut = (v) => receive ? flt(v.bank_charges) + flt(v.tds_amount) + flt(v.write_off_amount)
                                   : flt(v.tds_amount) + flt(v.write_off_amount);
        const sync = (from) => {
            if (syncing) return;
            syncing = true;
            const v = dlg.get_values(true) || {};
            if (from === 'amount') dlg.set_value('settle_amount', flt(flt(v.amount) + cut(v), 2));
            else dlg.set_value('amount', flt(Math.max(0, flt(v.settle_amount) - cut(v)), 2));
            setTimeout(() => { syncing = false; paint(); }, 50);
        };

        const calc = () => {
            const v = dlg.get_values(true) || {};
            const amount = flt(v.amount), charges = flt(v.bank_charges), tds = flt(v.tds_amount), wo = flt(v.write_off_amount);
            const settled = receive ? amount + charges + tds + wo : amount + tds + wo;
            const bank = receive ? amount : amount + charges;
            return { v, amount, charges, tds, wo, settled, bank,
                     allocated: Math.min(settled, d.outstanding),
                     remaining: flt(d.outstanding - settled, 2), mode: mode_by_name[v.mode_of_payment] };
        };

        const paint = () => {
            const c = calc();
            const is_bank = c.mode && c.mode.account_type === 'Bank';
            dlg.set_df_property('reference_no', 'reqd', is_bank ? 1 : 0);
            dlg.set_df_property('reference_date', 'reqd', is_bank ? 1 : 0);
            // Reference No / Date only matter for a bank mode — shown only then.
            dlg.set_df_property('reference_no', 'hidden', is_bank ? 0 : 1);
            dlg.set_df_property('reference_date', 'hidden', is_bank ? 0 : 1);
            dlg.fields_dict.mode_info.$wrapper.html(c.mode
                ? `<div class="of-pay-modeinfo"><i class="fa fa-${is_bank ? 'university' : 'money'}"></i> ${receive ? __('Money goes into') : __('Money goes out of')} <b>${pp_esc(c.mode.account)}</b></div>`
                : `<div class="of-pay-modeinfo is-empty">${__('Choose how the money was {0}.', [receive ? __('received') : __('paid')])}</div>`);
            // Deductions folded unless something is in them.
            if ((c.charges || c.tds || c.wo) && dlg.fields_dict.sec_deductions && dlg.fields_dict.sec_deductions.is_collapsed
                && dlg.fields_dict.sec_deductions.is_collapsed()) dlg.fields_dict.sec_deductions.collapse(false);
            const full = Math.abs(flt(c.v.settle_amount) - d.outstanding) < 0.005;
            dlg.fields_dict.quick.$wrapper.find('.of-pay-quick').toggleClass('is-on', full);

            const state = c.remaining > 0.004
                ? { cls: 'part', icon: 'adjust', text: __('Part payment — {0} still outstanding', [money(c.remaining)]) }
                : (c.remaining < -0.004
                    ? { cls: 'adv', icon: 'plus-circle', text: __('{0} extra — kept as advance for {1}', [money(-c.remaining), pp_esc(d.party_name || d.party)]) }
                    : { cls: 'full', icon: 'check-circle', text: receive ? __('Invoice fully settled') : __('Bill fully settled') });
            const line = (label, val, sign, cls) => `<div class="of-pay-sum__row ${cls || ''}"><span><i>${sign || ''}</i> ${label}</span><b>${money(val)}</b></div>`;
            const rows = receive ? [
                line(__('Credited in bank / cash'), c.amount, '', ''),
                c.charges ? line(__('Bank charges'), c.charges, '+', 'is-cut') : '',
                c.tds ? line(__('TDS'), c.tds, '+', 'is-cut') : '',
                c.wo ? line(__('Written off'), c.wo, '+', 'is-cut') : '',
                line(__('Settled on the invoice'), c.settled, '=', 'is-total'),
            ] : [
                line(__('Paid to supplier'), c.amount, '', ''),
                c.tds ? line(__('TDS cut by us'), c.tds, '+', 'is-cut') : '',
                c.wo ? line(__('Written off'), c.wo, '+', 'is-cut') : '',
                line(__('Settled on the bill'), c.settled, '=', 'is-total'),
            ];
            dlg.fields_dict.summary.$wrapper.html(`
                <div class="of-pay-sum ${receive ? 'is-in' : 'is-out'}">
                    <div class="of-pay-sum__big">
                        <span>${receive ? __('Into') : __('Out of')} ${pp_esc((c.mode && c.mode.account) || __('bank / cash'))}</span>
                        <b>${money(c.bank)}</b>
                        ${!receive && c.charges ? `<small>${money(c.amount)} + ${money(c.charges)} ${__('bank charges')}</small>` : ''}
                    </div>
                    <div class="of-pay-sum__rows">${rows.join('')}</div>
                    <div class="of-pay-sum__out">
                        <span>${__('Outstanding')}</span>
                        <span><s>${money(d.outstanding)}</s> <i class="fa fa-long-arrow-right"></i> <b>${money(Math.max(c.remaining, 0))}</b></span>
                    </div>
                    <div class="of-pay-sum__state is-${state.cls}"><i class="fa fa-${state.icon}"></i> ${state.text}</div>
                </div>`);
        };

        const today = frappe.datetime.get_today();
        const overdue = d.due_date && d.due_date < today;
        dlg.$wrapper.addClass('of-pay-dialog');
        dlg.fields_dict.head.$wrapper.html(`
            <div class="of-pay-head ${receive ? 'is-in' : 'is-out'}">
                <div class="of-pay-head__party">
                    <span class="of-pay-head__role"><i class="fa fa-${receive ? 'arrow-down' : 'arrow-up'}"></i> ${receive ? __('Receive from customer') : __('Pay to supplier')}</span>
                    <b>${pp_esc(d.party_name || d.party)}</b>
                    <span class="of-pay-head__doc">${pp_esc(doctype)} ${pp_esc(d.name)}${d.bill_no ? ` · ${__('Bill No')} ${pp_esc(d.bill_no)}` : ''}</span>
                </div>
                <div class="of-pay-head__tiles">
                    <div><span>${__('Invoice total')}</span><b>${money(d.invoice_total)}</b></div>
                    <div class="is-due"><span>${__('Outstanding')}</span><b>${money(d.outstanding)}</b></div>
                    ${d.due_date ? `<div class="${overdue ? 'is-late' : ''}"><span>${__('Due')}</span><b>${frappe.datetime.str_to_user(d.due_date)}</b>${overdue ? `<em>${__('overdue')}</em>` : ''}</div>` : ''}
                </div>
                ${d.tds_on_invoice ? `<div class="of-pay-head__note">${__('TDS already deducted on the bill')}: ${money(d.tds_on_invoice)}</div>` : ''}
            </div>`);
        dlg.fields_dict.quick.$wrapper.html(`<button type="button" class="of-pay-quick"><i class="fa fa-check"></i> ${__('Full outstanding')} ${money(d.outstanding)}</button>`);
        dlg.fields_dict.quick.$wrapper.on('click', '.of-pay-quick', () => { dlg.set_value('settle_amount', d.outstanding); });
        if (!(d.modes || []).length) {
            dlg.fields_dict.mode_info.$wrapper.html(`<div class="of-pay-modeinfo is-empty">${__('No Mode of Payment is ticked "Show in Payment Entry" (with an account for {0}).', [pp_esc(d.company)])}</div>`);
        }
        ['settle_amount', 'amount', 'bank_charges', 'tds_amount', 'write_off_amount', 'mode_of_payment'].forEach(f => {
            dlg.fields_dict[f].$input && dlg.fields_dict[f].$input.on('input change', () => setTimeout(paint, 0));
            if (f === 'mode_of_payment') return;
            dlg.fields_dict[f].df.onchange = () => sync(f === 'amount' ? 'amount' : 'settle');
        });
        dlg.fields_dict.mode_of_payment.df.onchange = () => {
            const m = mode_by_name[dlg.get_value('mode_of_payment')];
            if (m && /card/i.test(m.name) && d.defaults.card_charges_account) dlg.set_value('bank_charges_account', d.defaults.card_charges_account);
            paint();
        };
        dlg.show();
        paint();

        function review(v) {
            const c = calc();
            const is_bank = c.mode && c.mode.account_type === 'Bank';
            if (!c.mode) return frappe.msgprint(__('Choose the Mode of Payment.'));
            if (c.amount <= 0) return frappe.msgprint(__('Enter the amount.'));
            if (is_bank && (!v.reference_no || !v.reference_date)) return frappe.msgprint(__('Enter the Reference No (UTR / cheque no) and Reference Date.'));
            if (c.charges && !v.bank_charges_account) return frappe.msgprint(__('Choose the Bank Charges Account.'));
            if (c.tds && !v.tds_account) return frappe.msgprint(__('Choose the TDS Account.'));
            if (c.wo && !v.write_off_account) return frappe.msgprint(__('Choose the Write Off Account.'));
            if ((c.charges || c.tds || c.wo) && c.remaining < -0.004)
                return frappe.msgprint(__('Amount plus deductions is more than the outstanding. Reduce the deductions.'));

            const row = (k, val) => `<tr><td style="padding:4px 10px 4px 0;color:var(--text-muted);">${k}</td><td style="padding:4px 0;"><b>${val}</b></td></tr>`;
            const party_acc = receive ? 'Debtors' : 'Creditors';
            const lines = receive ? [
                [`${pp_esc(c.mode.account)}`, money(c.bank), ''],
                c.charges ? [pp_esc(v.bank_charges_account), money(c.charges), ''] : null,
                c.tds ? [pp_esc(v.tds_account), money(c.tds), ''] : null,
                c.wo ? [pp_esc(v.write_off_account), money(c.wo), ''] : null,
                [`${party_acc} — ${pp_esc(d.party_name || d.party)}`, '', money(c.settled)],
            ] : [
                [`${party_acc} — ${pp_esc(d.party_name || d.party)}`, money(c.settled), ''],
                c.charges ? [pp_esc(v.bank_charges_account), money(c.charges), ''] : null,
                [`${pp_esc(c.mode.account)}`, '', money(c.bank)],
                c.tds ? [pp_esc(v.tds_account), '', money(c.tds)] : null,
                c.wo ? [pp_esc(v.write_off_account), '', money(c.wo)] : null,
            ];
            const gl = lines.filter(Boolean).map(l => `<tr><td style="padding:3px 8px;">${l[0]}</td><td style="padding:3px 8px;text-align:right;white-space:nowrap;">${l[1]}</td><td style="padding:3px 8px;text-align:right;white-space:nowrap;">${l[2]}</td></tr>`).join('');

            const confirm = new frappe.ui.Dialog({
                title: __('Confirm Payment'),
                fields: [
                    { fieldtype: 'HTML', fieldname: 'body' },
                    { fieldtype: 'Check', fieldname: 'checked', label: __('I have checked the amount, mode of payment, reference and accounts') },
                ],
                primary_action_label: __('Submit Payment'),
                primary_action: (cv) => {
                    if (!cv.checked) return frappe.msgprint(__('Tick the confirmation to submit.'));
                    confirm.get_primary_btn().prop('disabled', true);
                    frappe.call({
                        method: 'erp_dacsinc_custom.dashboard_payment.record_payment',
                        args: {
                            doctype, name, mode_of_payment: v.mode_of_payment, amount: c.amount,
                            posting_date: v.posting_date, reference_no: v.reference_no || null, reference_date: v.reference_date || null,
                            bank_charges: c.charges, bank_charges_account: c.charges ? v.bank_charges_account : null,
                            tds_amount: c.tds, tds_account: c.tds ? v.tds_account : null,
                            write_off_amount: c.wo, write_off_account: c.wo ? v.write_off_account : null,
                            remarks: v.remarks || null,
                            from_form: opts.from_form ? 1 : 0,
                        },
                        freeze: true, freeze_message: __('Submitting payment…'),
                    }).then(res => {
                        const m = res.message || {};
                        confirm.hide(); dlg.hide();
                        frappe.msgprint({
                            title: __('Payment submitted'), indicator: 'green',
                            message: __('Payment Entry {0} is submitted. Outstanding on {1} is now {2}.',
                                [`<a href="/app/payment-entry/${encodeURIComponent(m.name)}" target="_blank">${pp_esc(m.name)}</a>`, pp_esc(name), money(m.outstanding)]),
                        });
                        on_done && on_done();
                    }).catch(() => confirm.get_primary_btn().prop('disabled', false));
                },
            });
            confirm.$wrapper.addClass('of-pay-dialog');
            const crow = (k, val, cls) => `<div class="of-pay-rcpt__row ${cls || ''}"><span>${k}</span><b>${val}</b></div>`;
            confirm.fields_dict.body.$wrapper.html(`
                <div class="of-pay-rcpt ${receive ? 'is-in' : 'is-out'}">
                    <div class="of-pay-rcpt__top">
                        <span>${receive ? __('Receiving from') : __('Paying to')} <b>${pp_esc(d.party_name || d.party)}</b></span>
                        <b class="of-pay-rcpt__amt">${money(c.bank)}</b>
                        <span>${receive ? __('into') : __('from')} ${pp_esc(c.mode.account)} · ${pp_esc(v.mode_of_payment)} · ${frappe.datetime.str_to_user(v.posting_date)}</span>
                    </div>
                    ${crow(__('Against'), `${pp_esc(doctype)} ${pp_esc(name)}`)}
                    ${v.reference_no ? crow(__('Reference'), `${pp_esc(v.reference_no)} · ${frappe.datetime.str_to_user(v.reference_date)}`) : ''}
                    ${crow(receive ? __('Credited in bank / cash') : __('Paid to supplier'), money(c.amount))}
                    ${c.charges ? crow(__('Bank Charges'), money(c.charges), 'is-cut') : ''}
                    ${c.tds ? crow(__('TDS'), money(c.tds), 'is-cut') : ''}
                    ${c.wo ? crow(__('Write Off'), money(c.wo), 'is-cut') : ''}
                    ${crow(receive ? __('Settled on the invoice') : __('Settled on the bill'), money(c.settled), 'is-total')}
                    ${crow(__('Outstanding after this'), money(Math.max(c.remaining, 0)))}
                    ${c.remaining < -0.004 ? crow(__('Advance'), money(-c.remaining)) : ''}
                </div>
                <details class="of-pay-gl">
                    <summary>${__('Ledger entries')}</summary>
                    <table>
                        <tr><th>${__('Account')}</th><th>${__('Debit')}</th><th>${__('Credit')}</th></tr>
                        ${gl}
                    </table>
                </details>
                <div class="of-pay-warn"><i class="fa fa-exclamation-triangle"></i> ${__('This submits the Payment Entry. To undo it later, the Payment Entry has to be cancelled.')}</div>`);
            confirm.show();
        }
    });
}

window.of_payment_prompt = of_payment_prompt;

// Refund on a return (dashboard_payment.get_refund_prompt / record_refund):
//   Credit Note with a customer credit → pay the customer back (Payment Entry type Pay);
//   Debit Note the supplier owes us    → receive the supplier's refund (type Receive).
// Same look as the Receive / Pay prompt; a review step with a tick before it submits.
function of_refund_prompt(doctype, name, on_done, opts) {
    opts = opts || {};
    frappe.call({
        method: 'erp_dacsinc_custom.dashboard_payment.get_refund_prompt',
        args: { doctype, name, from_form: opts.from_form ? 1 : 0 },
    }).then(r => {
        const d = r.message;
        if (!d) return;
        const money = (v) => format_currency(flt(v, 2), d.currency);
        const cn = d.credit_note;
        const mode_by_name = Object.fromEntries((d.modes || []).map(m => [m.name, m]));
        const dlg = new frappe.ui.Dialog({
            title: cn ? __('Refund to Customer — {0}', [d.name]) : __('Receive Refund from Supplier — {0}', [d.name]),
            fields: [
                { fieldtype: 'HTML', fieldname: 'head' },
                { fieldtype: 'Section Break', label: cn ? __('① How much is refunded') : __('① How much is received back') },
                { fieldtype: 'Float', precision: 2, fieldname: 'amount', reqd: 1, default: d.refund_due,
                  label: cn ? __('Refund amount') : __('Amount received from supplier'),
                  description: __('Up to {0}. Less = part refund; the rest stays as credit.', [money(d.refund_due)]) },
                { fieldtype: 'Column Break' },
                { fieldtype: 'HTML', fieldname: 'summary' },
                { fieldtype: 'Section Break', label: __('② Payment details') },
                { fieldtype: 'Select', fieldname: 'mode_of_payment', label: __('Mode of Payment'), reqd: 1,
                  options: [''].concat((d.modes || []).map(m => m.name)).join('\n') },
                { fieldtype: 'HTML', fieldname: 'mode_info' },
                { fieldtype: 'Date', fieldname: 'posting_date', label: __('Payment Date'), reqd: 1, default: frappe.datetime.get_today() },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Data', fieldname: 'reference_no', label: __('Reference No (UTR / Cheque No)') },
                { fieldtype: 'Date', fieldname: 'reference_date', label: __('Reference Date') },
                { fieldtype: 'Section Break', collapsible: 1, label: __('Remarks (optional)') },
                { fieldtype: 'Small Text', fieldname: 'remarks', label: __('Remarks') },
            ],
            primary_action_label: __('Review'),
            primary_action: (v) => review(v),
        });
        dlg.$wrapper.addClass('of-pay-dialog');
        dlg.fields_dict.head.$wrapper.html(`
            <div class="of-pay-head ${cn ? 'is-out' : 'is-in'}">
                <div class="of-pay-head__party">
                    <span class="of-pay-head__role"><i class="fa fa-undo"></i> ${cn ? __('Refund to customer (credit note)') : __('Refund from supplier (debit note)')}</span>
                    <b>${pp_esc(d.party_name || d.party)}</b>
                    <span class="of-pay-head__doc">${cn ? __('Credit Note') : __('Debit Note')} ${pp_esc(d.name)}${d.return_against ? ` · ${__('against')} ${pp_esc(d.return_against)}` : ''}</span>
                </div>
                <div class="of-pay-head__tiles">
                    <div><span>${cn ? __('Credit note total') : __('Debit note total')}</span><b>${money(d.note_total)}</b></div>
                    <div class="is-due"><span>${cn ? __('Customer credit (to refund)') : __('Supplier owes us')}</span><b>${money(d.refund_due)}</b></div>
                </div>
            </div>`);
        const paint = () => {
            const v = dlg.get_values(true) || {};
            const m = mode_by_name[v.mode_of_payment];
            const is_bank = m && m.account_type === 'Bank';
            dlg.set_df_property('reference_no', 'reqd', is_bank ? 1 : 0);
            dlg.set_df_property('reference_date', 'reqd', is_bank ? 1 : 0);
            dlg.set_df_property('reference_no', 'hidden', is_bank ? 0 : 1);
            dlg.set_df_property('reference_date', 'hidden', is_bank ? 0 : 1);
            dlg.fields_dict.mode_info.$wrapper.html(m
                ? `<div class="of-pay-modeinfo"><i class="fa fa-${is_bank ? 'university' : 'money'}"></i> ${cn ? __('Money goes out of') : __('Money goes into')} <b>${pp_esc(m.account)}</b></div>`
                : `<div class="of-pay-modeinfo is-empty">${__('Choose how the money moves.')}</div>`);
            const amt = flt(v.amount), left = flt(d.refund_due - amt, 2);
            dlg.fields_dict.summary.$wrapper.html(`
                <div class="of-pay-sum ${cn ? 'is-out' : 'is-in'}">
                    <div class="of-pay-sum__big"><span>${cn ? __('Out of') : __('Into')} ${pp_esc((m && m.account) || __('bank / cash'))}</span><b>${money(amt)}</b></div>
                    <div class="of-pay-sum__out"><span>${cn ? __('Customer credit') : __('Supplier owes us')}</span>
                        <span><s>${money(d.refund_due)}</s> <i class="fa fa-long-arrow-right"></i> <b>${money(Math.max(left, 0))}</b></span></div>
                    <div class="of-pay-sum__state is-${left > 0.004 ? 'part' : (left < -0.004 ? 'adv' : 'full')}">
                        ${left > 0.004 ? __('Part refund — {0} stays as credit', [money(left)])
                          : (left < -0.004 ? __('More than due — not allowed') : __('Fully refunded'))}</div>
                </div>`);
        };
        ['amount', 'mode_of_payment'].forEach(f => dlg.fields_dict[f].$input && dlg.fields_dict[f].$input.on('input change', () => setTimeout(paint, 0)));
        dlg.fields_dict.mode_of_payment.df.onchange = paint;
        dlg.show();
        paint();

        function review(v) {
            const m = mode_by_name[v.mode_of_payment];
            if (!m) return frappe.msgprint(__('Choose the Mode of Payment.'));
            const amt = flt(v.amount, 2);
            if (amt <= 0) return frappe.msgprint(__('Enter the amount.'));
            if (amt - d.refund_due > 0.005) return frappe.msgprint(__('The amount is more than {0}.', [money(d.refund_due)]));
            if (m.account_type === 'Bank' && (!v.reference_no || !v.reference_date)) return frappe.msgprint(__('Enter the Reference No (UTR / cheque no) and Reference Date.'));
            const party_acc = cn ? 'Debtors' : 'Creditors';
            const gl = cn
                ? [[`${party_acc} — ${pp_esc(d.party_name || d.party)}`, money(amt), ''], [pp_esc(m.account), '', money(amt)]]
                : [[pp_esc(m.account), money(amt), ''], [`${party_acc} — ${pp_esc(d.party_name || d.party)}`, '', money(amt)]];
            const crow = (k, val, cls) => `<div class="of-pay-rcpt__row ${cls || ''}"><span>${k}</span><b>${val}</b></div>`;
            const confirm = new frappe.ui.Dialog({
                title: __('Confirm Refund'),
                fields: [
                    { fieldtype: 'HTML', fieldname: 'body' },
                    { fieldtype: 'Check', fieldname: 'checked', label: __('I have checked the amount, mode of payment and reference') },
                ],
                primary_action_label: cn ? __('Submit Refund') : __('Submit Receipt'),
                primary_action: (cv) => {
                    if (!cv.checked) return frappe.msgprint(__('Tick the confirmation to submit.'));
                    confirm.get_primary_btn().prop('disabled', true);
                    frappe.call({
                        method: 'erp_dacsinc_custom.dashboard_payment.record_refund',
                        args: { doctype, name, mode_of_payment: v.mode_of_payment, amount: amt, posting_date: v.posting_date,
                                reference_no: v.reference_no || null, reference_date: v.reference_date || null,
                                remarks: v.remarks || null, from_form: opts.from_form ? 1 : 0 },
                        freeze: true, freeze_message: __('Submitting…'),
                    }).then(res => {
                        const x = res.message || {};
                        confirm.hide(); dlg.hide();
                        frappe.msgprint({ title: cn ? __('Refund submitted') : __('Refund received'), indicator: 'green',
                            message: __('Payment Entry {0} ({1}) is submitted. Left on {2}: {3}.',
                                [`<a href="/app/payment-entry/${encodeURIComponent(x.name)}" target="_blank">${pp_esc(x.name)}</a>`,
                                 pp_esc(x.payment_type), pp_esc(name), money(Math.abs(flt(x.outstanding)))]) });
                        on_done && on_done();
                    }).catch(() => confirm.get_primary_btn().prop('disabled', false));
                },
            });
            confirm.$wrapper.addClass('of-pay-dialog');
            confirm.fields_dict.body.$wrapper.html(`
                <div class="of-pay-rcpt ${cn ? 'is-out' : 'is-in'}">
                    <div class="of-pay-rcpt__top">
                        <span>${cn ? __('Refunding to') : __('Receiving back from')} <b>${pp_esc(d.party_name || d.party)}</b></span>
                        <b class="of-pay-rcpt__amt">${money(amt)}</b>
                        <span>${cn ? __('from') : __('into')} ${pp_esc(m.account)} · ${pp_esc(v.mode_of_payment)} · ${frappe.datetime.str_to_user(v.posting_date)}</span>
                    </div>
                    ${crow(__('Against'), `${cn ? __('Credit Note') : __('Debit Note')} ${pp_esc(d.name)}`)}
                    ${v.reference_no ? crow(__('Reference'), `${pp_esc(v.reference_no)} · ${frappe.datetime.str_to_user(v.reference_date)}`) : ''}
                    ${crow(cn ? __('Customer credit after this') : __('Supplier owes us after this'), money(Math.max(d.refund_due - amt, 0)), 'is-total')}
                </div>
                <details class="of-pay-gl"><summary>${__('Ledger entries')}</summary>
                    <table><tr><th>${__('Account')}</th><th>${__('Debit')}</th><th>${__('Credit')}</th></tr>
                    ${gl.map(l => `<tr><td style="padding:3px 8px;">${l[0]}</td><td style="padding:3px 8px;text-align:right;">${l[1]}</td><td style="padding:3px 8px;text-align:right;">${l[2]}</td></tr>`).join('')}</table>
                </details>
                <div class="of-pay-warn"><i class="fa fa-exclamation-triangle"></i> ${__('This submits a Payment Entry. To undo it later, cancel the Payment Entry.')}</div>`);
            confirm.show();
        }
    });
}
window.of_refund_prompt = of_refund_prompt;
