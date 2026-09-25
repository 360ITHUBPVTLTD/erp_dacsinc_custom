// Shared by purchase_order.js and material_request.js: a row linked to a Sales
// Order line must not push that line's total commitment past what it needs.
//
// The server guards (guard_po_item_not_over_so_need /
// guard_mr_item_not_over_so_need) are the enforcement — they refuse the save
// and state the full arithmetic.
//
// This only puts the LIMIT on the form, quietly. An earlier version also
// popped a dialog as the qty was typed; it was removed because it interrupted
// ordinary editing — a qty passes through over-limit values on the way to a
// valid one (and while reducing an existing row), so a modal on every change
// fires when nothing is wrong yet. Showing the ceiling up front and letting
// the save be the moment of truth is quieter and just as safe.
window.so_qty_cap = {
	// Debounced so editing a qty does not fire a request per keystroke. This
	// is only ever a note — no dialog — so refreshing it while the user works
	// is unobtrusive, unlike the typing-time validation that was removed.
	refresh: function (frm) {
		if (frm.__so_cap_timer) clearTimeout(frm.__so_cap_timer);
		frm.__so_cap_timer = setTimeout(() => window.so_qty_cap.set_intro(frm), 400);
	},

	// A standing note stating the ACTUAL limit for the rows on this document.
	// The earlier wording explained the policy ("rows linked to a Sales Order
	// line are capped at what that line still needs…") and left the reader to
	// work out what that meant for them. The number they can actually enter is
	// the thing worth saying, so it says that instead.
	set_intro: function (frm) {
		// Clear rather than just return — a banner left from the draft state
		// would otherwise persist after submit.
		if (frm.doc.docstatus !== 0) { frm.set_intro(''); return; }
		const linked = [...new Set((frm.doc.items || [])
			.map(it => it.sales_order_item).filter(Boolean))];
		const rm_rows = window.so_qty_cap.rm_rows(frm);
		if (!linked.length && !rm_rows.length) { frm.set_intro(''); return; }

		Promise.all([
			linked.length ? window.so_qty_cap.fg_note(frm, linked) : Promise.resolve(null),
			rm_rows.length ? window.so_qty_cap.rm_note(frm, rm_rows) : Promise.resolve(null),
		]).then(parts => {
			parts = parts.filter(Boolean);
			frm.set_intro('');
			if (!parts.length) return;
			const html = parts.map(p => p.html).join(' &nbsp;|&nbsp; ');
			frm.set_intro(html, parts.some(p => p.full) ? 'orange' : 'blue');
		});
	},

	// Material Request rows asking for RAW MATERIAL against a Sales Order —
	// Sales Order set, and marked Raw Material (or, not yet saved, simply not
	// tied to a line the order sells). Capped by the order's own raw-material
	// shortfall: guard_mr_rm_not_over_so_shortfall is the enforcement, this is
	// the note that shows the limit before the save refuses it.
	rm_rows: function (frm) {
		if (frm.doc.doctype !== 'Material Request') return [];
		return (frm.doc.items || []).filter(it => it.sales_order && it.item_code
			&& (it.custom_procurement_purpose === 'Raw Material'
				|| (!it.custom_procurement_purpose && !it.sales_order_item)));
	},

	rm_note: function (frm, rm_rows) {
		const pairs = [];
		const on_this_doc = {};
		rm_rows.forEach(it => {
			const key = `${it.sales_order}||${it.item_code}`;
			if (!(key in on_this_doc)) pairs.push({ sales_order: it.sales_order, item_code: it.item_code });
			on_this_doc[key] = flt(on_this_doc[key]) + flt(it.qty);
		});
		return frappe.call({
			method: 'erp_dacsinc_custom.custom_script.get_so_rm_allowances',
			args: { rows: JSON.stringify(pairs), exclude_name: frm.doc.name || '' },
		}).then(r => {
			const map = (r && r.message) || {};
			const rows = Object.keys(on_this_doc).filter(k => map[k]).map(k => {
				const info = map[k];
				const used = flt(on_this_doc[k]);
				return { info, used, left: Math.max(0, flt(info.allowed) - used) };
			});
			if (!rows.length) return null;
			const esc = frappe.utils.escape_html;
			const html = rows.slice(0, 2).map(x => {
				const bits = [__('RM needed {0}', [flt(x.info.need)])];
				if (flt(x.info.covered) > 0.001) bits.push(__('covered {0}', [flt(x.info.covered)]));
				if (x.used > 0.001) bits.push(__('this one {0}', [x.used]));
				bits.push(`<b>${__('left {0}', [x.left > 0.001 ? x.left : 0])}</b>`);
				return `<span title="${esc(__('Raw material for {0}: what its BOM lines still need, less usable stock, open POs, other Material Requests (drafts included) and material at the jobber.', [x.info.sales_order]))}">`
					+ `${esc(x.info.item_code)} (${esc(x.info.sales_order)}) — ${bits.join(' · ')}</span>`;
			}).join(' &nbsp;|&nbsp; ') + (rows.length > 2 ? ` &nbsp;|&nbsp; +${rows.length - 2} ${__('more')}` : '');
			return { html, full: rows.some(x => flt(x.used) > flt(x.info.allowed) + 0.01 || x.left <= 0.001) };
		});
	},

	// The Sales Order LINE cap (rows carrying sales_order_item) — the original
	// note, unchanged in what it counts; see set_intro's history above.
	fg_note: function (frm, linked) {
		return frappe.call({
			method: 'erp_dacsinc_custom.custom_script.get_so_item_commitments',
			args: {
				sales_order_items: JSON.stringify(linked),
				exclude_doctype: frm.doc.doctype,
				exclude_name: frm.doc.name || '',
			},
		}).then(r => {
			const map = (r && r.message) || {};
			if (!linked.some(soi => map[soi])) return null;

			// The figure from the server EXCLUDES this document, so it is the
			// line's allowance, not what is still free to type here. Whatever
			// this document already puts against the same line has to come off
			// it — otherwise a form already holding the full 10 still advertised
			// "max 10", and with the same item on several rows the number was
			// plainly wrong. Summing every row sharing the line is also what
			// makes the multi-row case correct: two rows of 5 against a 10 line
			// leave 0, not 5 each.
			const qty_field = (frm.doc.doctype === 'Purchase Order' && frm.doc.is_subcontracted)
				? 'fg_item_qty' : 'qty';
			const on_this_doc = {};
			(frm.doc.items || []).forEach(it => {
				if (!it.sales_order_item) return;
				on_this_doc[it.sales_order_item] =
					flt(on_this_doc[it.sales_order_item]) + flt(it[qty_field]);
			});

			// Keyed off `linked` so each allowance keeps the Sales Order line it
			// belongs to — the server returns a map, and its values carry no
			// back-reference to their own key.
			// The note must count the SAME things this form's own guard counts,
			// or it contradicts the save.
			//
			// On a Purchase Order that is guard_po_item_not_over_so_need, which
			// counts other PURCHASE ORDERS only — deliberately, because a PO
			// raised from a Material Request CONVERTS that request rather than
			// adding to it. Counting the open MR as well double-counted the
			// very qty being converted: an MR of 10 with 9 on this PO reported
			// "already 1 · this one 9 · left 0" when 1 can plainly still be
			// added (taking the PO to 10 and the MR to nil).
			//
			// On a Material Request it is guard_mr_item_not_over_so_need, which
			// counts POs plus other unordered MRs — there the full commitment
			// is right, since a second request IS additional demand.
			const is_po = frm.doc.doctype === 'Purchase Order';
			const rows = linked.filter(soi => map[soi]).map(soi => {
				const info = map[soi];
				const used = flt(on_this_doc[soi]);
				const elsewhere = is_po ? flt(info.on_po) : flt(info.committed);
				const docs = (info.docs || []).filter(d =>
					is_po ? d.doctype === 'Purchase Order' : true);
				return {
					item_code: info.item_code,
					so_qty: flt(info.so_qty),
					elsewhere: elsewhere,
					docs: docs,
					used: used,
					left: Math.max(0, flt(info.so_qty) - elsewhere - used),
				};
			});

			// One line per item, but every figure that matters on it: what the
			// order asked for, what is already raised against it elsewhere,
			// what this document is adding, and what that leaves. A bare
			// "Item: 0" was short but said nothing about how it got to 0.
			const brief = rows.slice(0, 2).map(x => {
				const bits = [__('order {0}', [x.so_qty])];
				if (x.elsewhere > 0.001) bits.push(__('already {0}', [x.elsewhere]));
				if (x.used > 0.001) bits.push(__('this one {0}', [x.used]));
				bits.push(`<b>${__('left {0}', [x.left > 0.001 ? x.left : 0])}</b>`);
				return `${frappe.utils.escape_html(x.item_code)} — ${bits.join(' · ')}`;
			}).join(' &nbsp;|&nbsp; ')
				+ (rows.length > 2 ? ` &nbsp;|&nbsp; +${rows.length - 2} ${__('more')}` : '');

			// Which documents hold the "already" figure — on the hover, since
			// naming them inline is what made this unreadable before.
			const detail = rows.map(x => {
				const bits = [__('order needs {0}', [x.so_qty])];
				(x.docs || []).forEach(d => bits.push(`${d.name}: ${flt(d.qty)} (${d.status})`));
				if (x.used > 0.001) bits.push(__('{0} on this document', [x.used]));
				return `${x.item_code}: ${bits.join(', ')}`;
			}).join('\n');

			const all_full = rows.every(x => x.left <= 0.001);
			return {
				html: `<span title="${frappe.utils.escape_html(detail)}">${brief}</span>`,
				full: all_full,
			};
		});
	},
};
