// Returns on their forms: one panel above the form with the two halves of a return and the button
// for each — no loose buttons in the toolbar (Print stays there).
//
//   💰 Money  what the note did in the accounts (customer credit / supplier owes us / reduced the
//             invoice / settled) — Adjust (Payment Reconciliation) · Refund / Receive refund.
//             Same rules as Order Flow › Finance › Returns / Notes (order_flow_api._describe_notes).
//   📦 Goods  whether the goods are back (return_goods.py): a Credit / Debit Note billed from a
//             Delivery Note / Purchase Receipt can't move stock — the Sales / Purchase Return does.
//             Make Sales / Purchase Return while they aren't (only the items and qty missing).
//
// On a Sales / Purchase Return (Delivery Note / Purchase Receipt is_return) the same panel shows the
// goods it moved and whether its Credit / Debit Note is made — Make Credit / Debit Note, from the
// original invoice. Nothing is ever blocked.

const DACS_RP_TONE = {
	green: { bg: '#e6f4ea', fg: '#1e7e34' }, orange: { bg: '#fff1e0', fg: '#b35900' },
	red: { bg: '#fdecea', fg: '#b03a2e' }, blue: { bg: '#e8f0fe', fg: '#1f5fbf' }, gray: { bg: 'var(--subtle-fg)', fg: 'var(--text-muted)' },
};

function dacs_rp_css() {
	if (document.getElementById('dacs-rp-css')) return;
	const st = document.createElement('style');
	st.id = 'dacs-rp-css';
	st.textContent = `
.dacs-rp { margin: 0 0 12px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--card-bg, #fff); overflow: hidden; }
.dacs-rp__head { padding: 8px 14px; font-weight: 700; font-size: 13px; background: var(--subtle-fg); border-bottom: 1px solid var(--border-color); }
.dacs-rp__head small { font-weight: 500; color: var(--text-muted); margin-left: 6px; }
.dacs-rp__row { display: flex; align-items: center; gap: 12px; padding: 9px 14px; flex-wrap: wrap; }
.dacs-rp__row + .dacs-rp__row { border-top: 1px solid var(--border-color); }
.dacs-rp__label { width: 78px; flex: none; font-weight: 700; font-size: 12.5px; }
.dacs-rp__pill { flex: none; font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 10px; white-space: nowrap; }
.dacs-rp__text { flex: 1 1 260px; font-size: 12.5px; color: var(--text-color); }
.dacs-rp__btns { display: flex; gap: 6px; flex-wrap: wrap; margin-left: auto; }
.dacs-rp__btns .btn { font-size: 12px; }
@media (max-width: 768px) { .dacs-rp__btns { margin-left: 0; width: 100%; } .dacs-rp__label { width: auto; } }`;
	document.head.appendChild(st);
}

// rows: [{ label, pill, tone, text, buttons: [{ label, cls, action }] }]
function dacs_render_return_panel(frm, title, rows) {
	dacs_rp_css();
	$(frm.layout.wrapper).find('.dacs-rp').remove();
	const esc = frappe.utils.escape_html;
	const $p = $(`<div class="dacs-rp"><div class="dacs-rp__head">${title}</div></div>`);
	rows.filter(Boolean).forEach(r => {
		const t = DACS_RP_TONE[r.tone] || DACS_RP_TONE.gray;
		const $row = $(`<div class="dacs-rp__row">
			<div class="dacs-rp__label">${r.label}</div>
			${r.pill ? `<span class="dacs-rp__pill" style="background:${t.bg};color:${t.fg};">${esc(r.pill)}</span>` : ''}
			<div class="dacs-rp__text">${esc(r.text || '')}</div>
			<div class="dacs-rp__btns"></div></div>`);
		(r.buttons || []).forEach(b => $(`<button class="btn btn-xs ${b.cls || 'btn-default'}">${esc(b.label)}</button>`)
			.on('click', b.action).appendTo($row.find('.dacs-rp__btns')));
		$p.append($row);
	});
	$(frm.layout.wrapper).prepend($p);
}

// Credit / Debit Note (Sales / Purchase Invoice is_return)
window.dacs_return_actions = function (frm) {
	const d = frm.doc;
	$(frm.layout.wrapper).find('.dacs-rp').remove();
	if (!cint(d.is_return)) return;
	const credit = d.doctype === 'Sales Invoice';
	const party_type = credit ? 'Customer' : 'Supplier';
	const party = credit ? d.customer : d.supplier;
	const money = (v) => format_currency(Math.abs(flt(v)), d.currency);
	const title = (credit ? __('Credit Note') : __('Debit Note'))
		+ (d.return_against ? ` <small>${__('against')} ${frappe.utils.escape_html(d.return_against)}</small>` : ` <small>${__('direct')}</small>`);

	frm.set_intro();
	if (d.docstatus === 0) {
		frm.set_intro(credit
			? __('Credit Note (sales return): keep only the items and quantities being returned (negative: -1, -2 …), write the reason in Remarks, then Submit.')
			: __('Debit Note (purchase return): keep only the items and quantities being returned (negative: -1, -2 …), write the reason in Remarks, then Submit.'), 'blue');
	}
	if (d.__islocal) return;

	// 💰 Money
	let money_row = null;
	if (d.docstatus === 1) {
		const out = flt(d.outstanding_amount);
		if (out < -0.005) {
			const btns = [{ label: __('Adjust'), cls: 'btn-primary', action: () => {
				const q = new URLSearchParams({ company: d.company, party_type, party });
				window.open(`/app/payment-reconciliation?${q.toString()}`, '_blank');
			} }];
			if (frappe.model.can_create('Payment Entry')) {
				btns.push({ label: credit ? __('Refund to Customer') : __('Receive Refund'), cls: 'btn-default', action: () =>
					frappe.require('/assets/erp_dacsinc_custom/js/payment_prompt.js', () =>
						of_refund_prompt(d.doctype, d.name, () => frm.reload_doc(), { from_form: 1 })) });
			}
			money_row = { label: '💰 ' + __('Money'), tone: 'orange', pill: credit ? __('Customer credit {0}', [money(out)]) : __('Supplier owes us {0}', [money(out)]),
				text: credit ? __('Adjust it against their unpaid invoices, or refund it.') : __('Adjust it against their unpaid bills, or receive the refund.'),
				buttons: btns };
		} else if (d.return_against && !cint(d.update_outstanding_for_self)) {
			money_row = { label: '💰 ' + __('Money'), tone: 'green', pill: __('Reduced {0}', [d.return_against]),
				text: credit ? __('{0} taken off the invoice. Nothing to refund.', [money(d.grand_total)]) : __('{0} taken off the bill. Nothing to receive.', [money(d.grand_total)]) };
		} else {
			money_row = { label: '💰 ' + __('Money'), tone: 'green', pill: __('Settled'), text: __('Refunded or adjusted.') };
		}
	} else if (d.docstatus === 0) {
		money_row = { label: '💰 ' + __('Money'), tone: 'gray', pill: __('Draft'), text: __('No effect until submitted.') };
	}
	dacs_render_return_panel(frm, title, [money_row]);
	dacs_goods_status(frm, (goods_row) => dacs_render_return_panel(frm, title, [money_row, goods_row]));
};

// Status of the other half (return_goods.get_status). For a note → the 📦 Goods row; for a Sales /
// Purchase Return → the panel with its 📦 Goods row and the 💰 Money row.
window.dacs_goods_status = function (frm, done) {
	const d = frm.doc;
	if (!cint(d.is_return) || d.__islocal) return;
	const note = d.doctype === 'Sales Invoice' || d.doctype === 'Purchase Invoice';
	frappe.call({ method: 'erp_dacsinc_custom.return_goods.get_status', args: { doctype: d.doctype, name: d.name } }).then(r => {
		const st = r.message;
		if (!st || frm.doc.name !== d.name) return;
		const tone = { done: 'green', self: 'green', none: 'gray', not_billed: 'gray', draft: 'orange', pending: 'red', unlinked: 'orange' }[st.status] || 'gray';
		const pill = note
			? { done: __('Stock returned'), self: __('Stock returned'), none: __('No stock item'), draft: __('Return in draft'), pending: __('Stock not returned'), unlinked: __('Stock not returned') }[st.status]
			: { done: __('Note made'), not_billed: __('No note needed'), draft: __('Note in draft'), pending: d.doctype === 'Delivery Note' ? __('Credit Note not made') : __('Debit Note not made') }[st.status];
		const buttons = [];
		const make = () => frappe.model.open_mapped_doc({
			method: note ? 'erp_dacsinc_custom.return_goods.make_goods_return' : 'erp_dacsinc_custom.return_goods.make_note_from_goods', frm });
		const target = note ? (d.doctype === 'Sales Invoice' ? 'Delivery Note' : 'Purchase Receipt')
			: (d.doctype === 'Delivery Note' ? 'Sales Invoice' : 'Purchase Invoice');
		const can_make = d.docstatus === 1 && st.status === 'pending' && frappe.model.can_create(target);
		if (can_make) {
			buttons.push({ label: note ? (d.doctype === 'Sales Invoice' ? __('Make Sales Return') : __('Make Purchase Return'))
				: (d.doctype === 'Delivery Note' ? __('Make Credit Note') : __('Make Debit Note')), cls: 'btn-danger', action: make });
		}
		(st.docs || []).forEach(x => buttons.push({ label: x.name + (x.docstatus === 0 ? ` (${__('draft')})` : ''), cls: 'btn-default',
			action: () => window.open(`/app/${frappe.router.slug(target)}/${encodeURIComponent(x.name)}`, '_blank') }));
		let row = { label: note ? '📦 ' + __('Goods') : '💰 ' + __('Money'), tone, pill, text: st.text, buttons };
		if (note && d.docstatus === 0 && cint(d.custom_return_goods) && st.status === 'pending') {
			row = { label: '📦 ' + __('Goods'), tone: 'blue', pill: __('Returned on Submit'), buttons: [],
				text: __('Update Stock is ticked: submitting makes and submits the {0} for these items and quantities{1}.', [
					d.doctype === 'Sales Invoice' ? __('Sales Return') : __('Purchase Return'),
					d.custom_return_warehouse ? ` (${d.custom_return_warehouse})` : '']) };
		}
		if (done) done(row);
		else {
			const sales = d.doctype === 'Delivery Note';
			dacs_render_return_panel(frm, (sales ? __('Sales Return') : __('Purchase Return'))
				+ (d.return_against ? ` <small>${__('against')} ${frappe.utils.escape_html(d.return_against)}</small>` : ''), [
				{ label: '📦 ' + __('Goods'), tone: d.docstatus === 1 ? 'green' : 'gray', pill: d.docstatus === 1 ? __('Stock moved') : __('Draft'),
				  text: d.docstatus === 1 ? (sales ? __('The goods are back in stock.') : __('The goods went back to the supplier.')) : __('Stock moves when submitted.') },
				row]);
		}
		// Clicked on Order Flow › Finance › Returns / Notes (it opened this form in a new tab and
		// left a note in localStorage for a minute): go straight on to the new document.
		if (!can_make) return;
		const key = `dacs_make:${d.doctype}:${d.name}`;
		let asked = null;
		try { asked = localStorage.getItem(key); localStorage.removeItem(key); } catch (e) { /* no storage */ }
		if (asked && Date.now() - cint(asked) < 60000) make();
	});
};
