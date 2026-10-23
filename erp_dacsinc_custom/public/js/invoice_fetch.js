// "Fetch Pending to Bill" on a new Sales Invoice (invoice_fetch.py): the customer's delivered,
// not-yet-invoiced Delivery Note lines — what Order Flow › Pending DN/SI invoices — shown the way
// the dashboard shows them: a customer card with totals, one card per Delivery Note (date, Sales
// Order, Customer PO) with the dashboard's blue-header table, ticked by line or by whole DN. The
// invoice is built from just those lines by custom_script.make_sales_invoice_from_dn_items
// (ERPNext's DN → SI mapping) and opens in place of the empty one.
window.dacs_fetch_pending_to_bill = function (frm) {
	const esc = frappe.utils.escape_html;
	const money = (v, cur) => format_currency(flt(v), cur || frm.doc.currency);
	const qty = (v) => String(flt(v, 3));
	let lines = [];

	const css = `
	.dfp { font-size: 12.5px; --dfp-blue: #3498DB; --dfp-blue-d: #2e86c1; }
	.dfp-cust { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 2px 0 12px; }
	.dfp-cust__name { font-size: 15px; font-weight: 700; margin-right: auto; }
	.dfp-cust__name small { display: block; font-size: 11px; font-weight: 500; color: var(--text-muted); }
	.dfp-tile { border: 1px solid var(--border-color); border-radius: 8px; padding: 6px 12px; min-width: 110px; background: var(--card-bg, #fff); }
	.dfp-tile b { display: block; font-size: 15px; }
	.dfp-tile span { font-size: 11px; color: var(--text-muted); }
	.dfp-tile.is-amt b { color: #1e7e34; }
	.dfp-scroll { max-height: 56vh; overflow: auto; padding-right: 2px; }
	.dfp-dn { border: 1px solid var(--border-color); border-radius: 8px; margin-bottom: 10px; overflow: hidden; background: var(--card-bg, #fff); }
	.dfp-dn.is-picked { border-color: var(--dfp-blue); box-shadow: 0 0 0 1px var(--dfp-blue) inset; }
	.dfp-dn__head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; background: var(--subtle-fg); }
	.dfp-dn__head label { display: flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; font-weight: 700; font-size: 13.5px; }
	.dfp-chip { display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 10px; background: var(--card-bg, #fff); border: 1px solid var(--border-color); color: var(--text-color); white-space: nowrap; }
	.dfp-chip.is-warn { background: #fff1e0; border-color: #ffd8a8; color: #b35900; }
	.dfp-chip.is-bad { background: #fdecea; border-color: #f5c2c7; color: #b03a2e; }
	.dfp-dn__sum { margin-left: auto; font-weight: 700; color: #1e7e34; }
	.dfp-dn__sum small { font-weight: 500; color: var(--text-muted); margin-right: 6px; }
	.dfp-tw { overflow-x: auto; }
	.dfp-t { width: 100%; min-width: 620px; border-collapse: collapse; }
	.dfp-t th { background: var(--dfp-blue); color: #fff; font-size: 11.5px; font-weight: 600; padding: 6px 8px; border: 1px solid var(--dfp-blue-d); white-space: nowrap; text-align: center; }
	.dfp-t td { padding: 6px 8px; border: 1px solid var(--border-color); text-align: center; vertical-align: middle; }
	.dfp-t td.l, .dfp-t th.l { text-align: left; }
	.dfp-t tr.is-locked td { background: var(--subtle-fg); color: var(--text-muted); }
	.dfp-t tr.is-picked td { background: #eef6fd; }
	.dfp-tobill { display: inline-block; min-width: 34px; padding: 2px 8px; border-radius: 10px; background: #e6f4ea; color: #1e7e34; font-weight: 700; }
	.dfp-muted { color: var(--text-muted); }
	.dfp-empty { text-align: center; padding: 30px 10px; color: var(--text-muted); border: 1px dashed var(--border-color); border-radius: 8px; }
	.dfp-empty i { font-size: 22px; display: block; margin-bottom: 6px; }
	.dfp-hint { margin-top: 8px; padding: 7px 10px; border-radius: 6px; background: #e8f0fe; color: #1f5fbf; font-size: 12px; }
	.dfp-foot { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; padding-top: 10px; margin-top: 4px; border-top: 1px solid var(--border-color); }
	.dfp-foot__sel b { font-size: 14px; color: #1e7e34; }`;

	const d = new frappe.ui.Dialog({
		title: __('Fetch Pending to Bill'),
		size: 'extra-large',
		fields: [
			{ fieldtype: 'Link', fieldname: 'customer', label: __('Customer'), options: 'Customer', reqd: 1,
			  default: frm.doc.customer, change: () => load() },
			{ fieldtype: 'HTML', fieldname: 'list' },
		],
		primary_action_label: __('Get Items'),
		primary_action() {
			const picked = d.$wrapper.find('.dfp-line:checked').map((i, el) => el.value).get();
			if (!picked.length) { frappe.msgprint(__('Tick the lines to bill.')); return; }
			frappe.call({
				method: 'erp_dacsinc_custom.custom_script.make_sales_invoice_from_dn_items',
				args: { dn_item_names: picked },
				freeze: true, freeze_message: __('Building the Sales Invoice…'),
			}).then(r => {
				if (!r.message) return;
				d.hide();
				const doc = frappe.model.sync(r.message)[0];
				frappe.set_route('Form', doc.doctype, doc.name);
			});
		},
	});

	const tile = (val, label, cls) => `<div class="dfp-tile ${cls || ''}"><b>${val}</b><span>${label}</span></div>`;

	const render = () => {
		const $w = d.fields_dict.list.$wrapper;
		const cust = d.get_value('customer');
		if (!lines.length) {
			$w.html(`<style>${css}</style><div class="dfp"><div class="dfp-empty"><i class="fa fa-check-circle-o"></i>
				${__('Nothing delivered and waiting to be billed for this customer.')}</div><div class="dfp-hint-slot"></div></div>`);
			d.set_primary_action(__('Get Items'), d.primary_action);
			hint();
			return;
		}
		const groups = {};
		lines.forEach(l => (groups[l.delivery_note] = groups[l.delivery_note] || []).push(l));
		const free = lines.filter(l => !l.draft);
		const cards = Object.keys(groups).map(dn => {
			const ls = groups[dn], open = ls.filter(l => !l.draft);
			const sos = [...new Set(ls.map(l => l.sales_order).filter(Boolean))];
			const total = open.reduce((a, l) => a + flt(l.amount), 0);
			return `<div class="dfp-dn" data-dn="${esc(dn)}">
				<div class="dfp-dn__head">
					<label><input type="checkbox" class="dfp-dn-check" ${open.length ? '' : 'disabled'}>
						<a href="/app/delivery-note/${encodeURIComponent(dn)}" target="_blank" onclick="event.stopPropagation()">${esc(dn)}</a></label>
					<span class="dfp-chip"><i class="fa fa-calendar"></i> ${frappe.datetime.str_to_user(ls[0].posting_date)}</span>
					${sos.map(so => `<a class="dfp-chip" href="/app/sales-order/${encodeURIComponent(so)}" target="_blank">${esc(so)}</a>`).join('')}
					${ls[0].po_no ? `<span class="dfp-chip">${__('PO')}: ${esc(ls[0].po_no)}</span>` : ''}
					<span class="dfp-dn__sum"><small>${open.length} ${open.length === 1 ? __('line') : __('lines')}</small>${money(total, ls[0].currency)}</span>
				</div>
				<div class="dfp-tw"><table class="dfp-t"><thead><tr><th style="width:34px;"></th><th class="l">${__('Item')}</th><th>${__('Delivered')}</th>
					<th>${__('Billed')}</th><th>${__('Returned')}</th><th>${__('To bill')}</th><th>${__('Rate')}</th><th>${__('Amount')}</th></tr></thead>
				<tbody>${ls.map(l => `<tr class="${l.draft ? 'is-locked' : ''}">
					<td><input type="checkbox" class="dfp-line" value="${esc(l.dn_detail)}" data-amount="${l.amount}" ${l.draft ? 'disabled' : ''}></td>
					<td class="l"><b>${esc(l.item_name || l.item_code)}</b>${l.item_name && l.item_name !== l.item_code ? `<div class="dfp-muted" style="font-size:11px;">${esc(l.item_code)}</div>` : ''}
						${l.draft ? `<div style="margin-top:3px;"><a class="dfp-chip is-warn" href="/app/sales-invoice/${encodeURIComponent(l.draft)}" target="_blank"><i class="fa fa-lock"></i> ${__('On draft invoice')} ${esc(l.draft)}</a></div>` : ''}</td>
					<td>${qty(l.delivered)} <span class="dfp-muted">${esc(l.uom || '')}</span></td>
					<td>${flt(l.invoiced) ? qty(l.invoiced) : '<span class="dfp-muted">—</span>'}</td>
					<td>${flt(l.returned) ? qty(l.returned) : '<span class="dfp-muted">—</span>'}</td>
					<td><span class="dfp-tobill">${qty(l.pending)}</span></td>
					<td>${flt(l.rate) ? money(l.rate, l.currency) : `<span class="dfp-chip is-bad" title="${__('This Delivery Note line has no rate — the invoice line will be ₹0. Check the price before submitting.')}">${__('Rate 0')}</span>`}</td>
					<td><b>${money(l.amount, l.currency)}</b></td></tr>`).join('')}</tbody></table></div>
			</div>`;
		}).join('');
		const name = lines[0].customer_name && lines[0].customer_name !== cust ? lines[0].customer_name : cust;
		$w.html(`<style>${css}</style><div class="dfp">
			<div class="dfp-cust">
				<div class="dfp-cust__name">${esc(name)}<small>${esc(cust)}</small></div>
				${tile(Object.keys(groups).length, __('Delivery Notes'))}
				${tile(free.length, __('Lines to bill'))}
				${tile(money(free.reduce((a, l) => a + flt(l.amount), 0)), __('To bill'), 'is-amt')}
			</div>
			<div class="dfp-scroll">${cards}</div>
			<div class="dfp-hint-slot"></div>
			<div class="dfp-foot">
				<label style="margin:0;display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" class="dfp-all"> ${__('Select everything')}</label>
				<span class="dfp-muted">${__('Ticked lines are billed in full (what is still to bill). One invoice = one customer.')}</span>
				<span class="dfp-foot__sel">${__('Selected')}: <span class="dfp-sel-n">0</span> · <b class="dfp-total">${money(0)}</b></span>
			</div></div>`);
		const sync = () => {
			let total = 0, n = 0;
			$w.find('.dfp-line').each((i, el) => {
				$(el).closest('tr').toggleClass('is-picked', el.checked);
				if (el.checked) { total += flt($(el).data('amount')); n++; }
			});
			$w.find('.dfp-total').text(money(total));
			$w.find('.dfp-sel-n').text(n === 1 ? __('1 line') : __('{0} lines', [n]));
			$w.find('.dfp-dn').each((i, card) => {
				const $l = $(card).find('.dfp-line:not(:disabled)'), on = $l.filter(':checked').length;
				$(card).find('.dfp-dn-check').prop('checked', $l.length && on === $l.length).prop('indeterminate', on > 0 && on < $l.length);
				$(card).toggleClass('is-picked', on > 0);
			});
			const $all = $w.find('.dfp-line:not(:disabled)');
			$w.find('.dfp-all').prop('checked', $all.length && $all.filter(':checked').length === $all.length);
			d.set_primary_action(n ? (n === 1 ? __('Get 1 line') : __('Get {0} lines', [n])) : __('Get Items'), d.primary_action);
		};
		$w.find('.dfp-line').on('change', sync);
		$w.find('.dfp-dn-check').on('change', (e) => { $(e.target).closest('.dfp-dn').find('.dfp-line:not(:disabled)').prop('checked', e.target.checked); sync(); });
		$w.find('.dfp-all').on('change', (e) => { $w.find('.dfp-line:not(:disabled)').prop('checked', e.target.checked); sync(); });
		// one Delivery Note on screen: tick it straight away
		if (Object.keys(groups).length === 1) { $w.find('.dfp-line:not(:disabled)').prop('checked', true); }
		sync();
		hint();
	};

	const hint = () => {
		const c = d.get_value('customer');
		if (!c) return;
		frappe.call({ method: 'erp_dacsinc_custom.invoice_fetch.billing_hint', args: { customer: c } }).then(r => {
			if (cint(r.message)) {
				d.fields_dict.list.$wrapper.find('.dfp-hint-slot').html(`<div class="dfp-hint"><i class="fa fa-info-circle"></i>
					${__('{0} picked order(s) of this customer are not delivered yet — make their Delivery Note first (Order Flow › Pending DN/SI); they can be billed after that.', [cint(r.message)])}</div>`);
			}
		});
	};

	const load = () => {
		const c = d.get_value('customer');
		lines = [];
		if (!c) { d.fields_dict.list.$wrapper.html(''); return; }
		d.fields_dict.list.$wrapper.html(`<div class="text-muted" style="padding:14px 4px;">${__('Loading…')}</div>`);
		frappe.call({ method: 'erp_dacsinc_custom.invoice_fetch.get_billable_dn_lines', args: { customer: c, company: frm.doc.company } })
			.then(r => { lines = r.message || []; render(); });
	};

	d.show();
	load();
};
