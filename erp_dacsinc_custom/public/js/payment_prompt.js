// Refund prompt on a return (Order Flow › Finance › Returns / Notes and the Credit / Debit Note form).
// Payments against invoices use the Receive / Pay prompt (public/js/bulk_payment.js). Loaded on
// demand with frappe.require. Step 1 asks what the Payment Entry needs; step 2 shows it back and
// needs a tick before it submits.
//
// opts.from_form: opened from the note's form — the server then needs only Payment Entry
// create + submit permission, not the Order Flow Finance tab.

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
.of-pay-quick-note { font-size: 11px; color: var(--text-muted); margin: 3px 0 8px; }

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
.of-pay-dialog [data-fieldname="amount"] input { font-size: 15px !important; font-weight: 700; height: 34px !important; font-variant-numeric: tabular-nums; }
.of-pay-dialog [data-fieldname="amount"] .control-value { font-size: 15px; font-weight: 700; color: var(--of-green, #1e7e34); background: var(--subtle-fg); border-radius: 6px; padding: 6px 10px; font-variant-numeric: tabular-nums; }
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

// Pay back an advance / opening credit (customer), or record a supplier paying theirs back — the Account
// Summary's "Pay back" / "Receive back" (party_summary.js). Same look and two steps as the refund prompt above;
// the server makes the Payment Entry and matches it with the credit (party_balance.pay_back).
function of_pay_back_prompt(party_type, party, doctype, name, company, on_done) {
    frappe.call({
        method: 'erp_dacsinc_custom.party_balance.get_pay_back',
        args: { party_type, party, doctype, name, company },
    }).then(r => {
        const d = r.message;
        if (!d) return;
        const cust = party_type === 'Customer';
        const money = (v) => format_currency(flt(v, 2), d.currency);
        const mode_by_name = Object.fromEntries((d.modes || []).map(m => [m.name, m]));
        const what = doctype === 'Journal Entry' ? __('Opening balance / journal') : __('Advance');
        const dlg = new frappe.ui.Dialog({
            title: cust ? __('Pay back to Customer') : __('Receive back from Supplier'),
            fields: [
                { fieldtype: 'HTML', fieldname: 'head' },
                { fieldtype: 'Section Break', label: cust ? __('① How much is paid back') : __('① How much is received back') },
                { fieldtype: 'Float', precision: 2, fieldname: 'amount', reqd: 1, default: d.held, label: __('Amount'),
                  description: __('Up to {0}. Less = part; the rest stays held.', [money(d.held)]) },
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
            <div class="of-pay-head ${cust ? 'is-out' : 'is-in'}">
                <div class="of-pay-head__party">
                    <span class="of-pay-head__role"><i class="fa fa-undo"></i> ${cust ? __('Pay back to customer') : __('Received back from supplier')}</span>
                    <b>${pp_esc(d.party_name || d.party)}</b>
                    <span class="of-pay-head__doc">${what} ${pp_esc(d.name)} · ${frappe.datetime.str_to_user(d.posting_date)}</span>
                </div>
                <div class="of-pay-head__tiles">
                    <div class="is-due"><span>${cust ? __('Held for the customer') : __('Supplier owes back')}</span><b>${money(d.held)}</b></div>
                </div>
            </div>`);
        const paint = () => {
            const v = dlg.get_values(true) || {};
            const m = mode_by_name[v.mode_of_payment];
            const is_bank = m && m.account_type === 'Bank';
            ['reference_no', 'reference_date'].forEach(f => {
                dlg.set_df_property(f, 'reqd', is_bank ? 1 : 0);
                dlg.set_df_property(f, 'hidden', is_bank ? 0 : 1);
            });
            dlg.fields_dict.mode_info.$wrapper.html(m
                ? `<div class="of-pay-modeinfo"><i class="fa fa-${is_bank ? 'university' : 'money'}"></i> ${cust ? __('Money goes out of') : __('Money goes into')} <b>${pp_esc(m.account)}</b></div>`
                : `<div class="of-pay-modeinfo is-empty">${__('Choose how the money moves.')}</div>`);
            const amt = flt(v.amount), left = flt(d.held - amt, 2);
            dlg.fields_dict.summary.$wrapper.html(`
                <div class="of-pay-sum ${cust ? 'is-out' : 'is-in'}">
                    <div class="of-pay-sum__big"><span>${cust ? __('Out of') : __('Into')} ${pp_esc((m && m.account) || __('bank / cash'))}</span><b>${money(amt)}</b></div>
                    <div class="of-pay-sum__out"><span>${cust ? __('Held for the customer') : __('Supplier owes back')}</span>
                        <span><s>${money(d.held)}</s> <i class="fa fa-long-arrow-right"></i> <b>${money(Math.max(left, 0))}</b></span></div>
                    <div class="of-pay-sum__state is-${left > 0.004 ? 'part' : (left < -0.004 ? 'adv' : 'full')}">
                        ${left > 0.004 ? __('Part — {0} stays held', [money(left)])
                          : (left < -0.004 ? __('More than held — not allowed') : __('All of it'))}</div>
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
            if (amt - d.held > 0.005) return frappe.msgprint(__('The amount is more than {0}.', [money(d.held)]));
            if (m.account_type === 'Bank' && (!v.reference_no || !v.reference_date)) return frappe.msgprint(__('Enter the Reference No (UTR / cheque no) and Reference Date.'));
            const party_acc = cust ? 'Debtors' : 'Creditors';
            const gl = cust
                ? [[`${party_acc} — ${pp_esc(d.party_name || d.party)}`, money(amt), ''], [pp_esc(m.account), '', money(amt)]]
                : [[pp_esc(m.account), money(amt), ''], [`${party_acc} — ${pp_esc(d.party_name || d.party)}`, '', money(amt)]];
            const crow = (k, val, cls) => `<div class="of-pay-rcpt__row ${cls || ''}"><span>${k}</span><b>${val}</b></div>`;
            const confirm = new frappe.ui.Dialog({
                title: cust ? __('Confirm Pay back') : __('Confirm Received back'),
                fields: [
                    { fieldtype: 'HTML', fieldname: 'body' },
                    { fieldtype: 'Check', fieldname: 'checked', label: __('I have checked the amount, mode of payment and reference') },
                ],
                primary_action_label: cust ? __('Submit Pay back') : __('Submit Receipt'),
                primary_action: (cv) => {
                    if (!cv.checked) return frappe.msgprint(__('Tick the confirmation to submit.'));
                    confirm.get_primary_btn().prop('disabled', true);
                    frappe.call({
                        method: 'erp_dacsinc_custom.party_balance.pay_back',
                        args: { party_type, party, doctype, name, company, mode_of_payment: v.mode_of_payment, amount: amt,
                                posting_date: v.posting_date, reference_no: v.reference_no || null,
                                reference_date: v.reference_date || null, remarks: v.remarks || null },
                        freeze: true, freeze_message: __('Submitting…'),
                    }).then(res => {
                        const x = res.message || {};
                        confirm.hide(); dlg.hide();
                        frappe.msgprint({ title: cust ? __('Paid back') : __('Received back'), indicator: 'green',
                            message: __('Payment Entry {0} is submitted and matched with {1}. Still held: {2}.',
                                [`<a href="/app/payment-entry/${encodeURIComponent(x.payment_entry)}" target="_blank">${pp_esc(x.payment_entry)}</a>`,
                                 pp_esc(name), money(Math.max(d.held - amt, 0))]) });
                        on_done && on_done();
                    }).catch(() => confirm.get_primary_btn().prop('disabled', false));
                },
            });
            confirm.$wrapper.addClass('of-pay-dialog');
            confirm.fields_dict.body.$wrapper.html(`
                <div class="of-pay-rcpt ${cust ? 'is-out' : 'is-in'}">
                    <div class="of-pay-rcpt__top">
                        <span>${cust ? __('Paying back to') : __('Receiving back from')} <b>${pp_esc(d.party_name || d.party)}</b></span>
                        <b class="of-pay-rcpt__amt">${money(amt)}</b>
                        <span>${cust ? __('from') : __('into')} ${pp_esc(m.account)} · ${pp_esc(v.mode_of_payment)} · ${frappe.datetime.str_to_user(v.posting_date)}</span>
                    </div>
                    ${crow(__('Matched with'), `${what} ${pp_esc(d.name)}`)}
                    ${v.reference_no ? crow(__('Reference'), `${pp_esc(v.reference_no)} · ${frappe.datetime.str_to_user(v.reference_date)}`) : ''}
                    ${crow(cust ? __('Still held for the customer') : __('Supplier still owes back'), money(Math.max(d.held - amt, 0)), 'is-total')}
                </div>
                <details class="of-pay-gl"><summary>${__('Ledger entries')}</summary>
                    <table><tr><th>${__('Account')}</th><th>${__('Debit')}</th><th>${__('Credit')}</th></tr>
                    ${gl.map(l => `<tr><td style="padding:3px 8px;">${l[0]}</td><td style="padding:3px 8px;text-align:right;">${l[1]}</td><td style="padding:3px 8px;text-align:right;">${l[2]}</td></tr>`).join('')}</table>
                </details>
                ${cust ? `<div class="of-pay-warn"><i class="fa fa-info-circle"></i> ${__('GST: none for goods. If GST was paid on an advance for services, adjust it separately.')}</div>` : ''}
                <div class="of-pay-warn"><i class="fa fa-exclamation-triangle"></i> ${doctype === 'Journal Entry'
                    ? __('This submits a Payment Entry and matches it with the Journal Entry. To undo it: Unreconcile on Journal Entry {0} (ERPNext puts the button there), then cancel the Payment Entry.', [pp_esc(d.name)])
                    : __('This submits a Payment Entry and matches it with the advance. To undo it, cancel the Payment Entry.')}</div>`);
            confirm.show();
        }
    });
}
window.of_pay_back_prompt = of_pay_back_prompt;
