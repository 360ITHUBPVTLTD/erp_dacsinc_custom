// Same rule as delivery_note.js: a Sales Invoice Item row that came from
// another document is a RECORD of what that document committed, not a place to
// renegotiate it. Editing qty or rate here desyncs the row from the Sales
// Order line it bills against and the Delivery Note it invoices, breaking the
// delivered / billed reconciliation the Order Flow dashboard reads.
//
// The lock condition and the field list live in ONE place each, because the
// four surfaces below (inline cell edit, row refresh, the form-level pass and
// the expanded-row render) all have to apply the same rule.

// Verified against the doctype: Sales Invoice Item carries so_detail /
// sales_order (Sales Order) and dn_detail / delivery_note (Delivery Note).
// It has NO pick-list field at all — a stock-updating invoice reaches its qty
// through the Pick List selection step that builds it, never through a link
// on the row.
const SI_LINK_FIELDS = ['so_detail', 'sales_order', 'dn_detail', 'delivery_note'];

// 'rate' is not listed: it is read-only on every row (Property Setter — users change the
// Price List Rate and the discount instead), and toggling it here would make it editable
// again on rows that are not linked.
const SI_LOCKED_FIELDS = [
	'qty', 'price_list_rate', 'amount', 'item_code', 'warehouse',
	'uom', 'conversion_factor', 'discount_percentage', 'discount_amount'
];

function si_row_is_linked(doc) {
	return !!(doc && SI_LINK_FIELDS.some(f => doc[f]));
}

// A return (Credit Note) keeps its lines linked to the invoice / Delivery Note it reverses, but
// the quantity being returned is the user's to set (as a negative: -1, -2 …); everything else on
// the line stays as the original. ERPNext refuses more than was invoiced.
function si_field_locked(row_doc, parent_doc, fieldname) {
	if (!si_row_is_linked(row_doc)) return false;
	return !(fieldname === 'qty' && parent_doc && cint(parent_doc.is_return));
}

function si_apply_row_locks(row) {
	if (!row || !row.doc) return;
	const parent_doc = row.frm && row.frm.doc;
	SI_LOCKED_FIELDS.forEach(f => row.toggle_editable(f, !si_field_locked(row.doc, parent_doc, f)));
}

frappe.ui.form.on('Sales Invoice', {
	setup: function(frm) {
		if (frm.fields_dict.items && frm.fields_dict.items.grid) {
			// Declarative per-row lock, evaluated by the grid itself on every
			// render.
			const linked = '(' + SI_LINK_FIELDS.map(f => 'doc.' + f).join(' || ') + ')';
			const lock_expr = 'eval: ' + linked;
			// qty: locked on linked lines except on a return (the returned qty is entered there)
			const qty_lock_expr = 'eval: ' + linked + ' && !(parent && parent.is_return)';
			const expr_for = (f) => (f === 'qty' ? qty_lock_expr : lock_expr);
			(frm.fields_dict.items.grid.docfields || []).forEach(df => {
				if (SI_LOCKED_FIELDS.includes(df.fieldname)) {
					df.read_only_depends_on = expr_for(df.fieldname);
				}
			});
			SI_LOCKED_FIELDS.forEach(f => {
				const df = frappe.meta.get_docfield('Sales Invoice Item', f, frm.doc.name);
				if (df) df.read_only_depends_on = expr_for(f);
				const meta_df = frappe.meta.get_docfield('Sales Invoice Item', f);
				if (meta_df) meta_df.read_only_depends_on = expr_for(f);
			});

			let old_on_row_refresh = frm.fields_dict.items.grid.on_row_refresh;
			frm.fields_dict.items.grid.on_row_refresh = function(row) {
				if (old_on_row_refresh) {
					old_on_row_refresh(row);
				}
				si_apply_row_locks(row);
			};
		}
	},
	onload: function(frm) {
		frm.trigger('make_linked_rows_read_only');
	},
	is_return: function(frm) {
		si_update_stock_hint(frm);
	},
	onload_post_render: function(frm) {
		si_remove_get_items_buttons(frm);
	},
	refresh: function(frm) {
		frm.trigger('make_linked_rows_read_only');
		si_update_stock_hint(frm);
		si_remove_get_items_buttons(frm);
		dacs_einvoice_box(frm);
		dacs_gstin_update_button(frm);
		// Create menu: Return / Credit Note stays. Payment is the "Receive Payment" button below.
		dacs_hide_create_buttons(frm, ['Payment Request', 'Invoice Discounting', 'Maintenance Schedule',
			'Delivery Note', 'Dunning', 'Quality Inspection(s)', 'Payment']);
		dacs_load_return_actions(frm);
		// Print with the copy choice — Original … Quadruplicate or All 4 (print_prompt.js ›
		// dacs_print_copies); took over from the DB Client Script "sales invoice Form new"
		// (patches/si_print_button_to_app.py). A Credit Note prints as such.
		if (!frm.is_new()) {
			frm.add_custom_button(cint(frm.doc.is_return) ? __('Print Credit Note') : __('Print Sales Invoice'), () =>
				dacs_print_copies('Sales Invoice', frm.doc.name, { is_return: cint(frm.doc.is_return), docstatus: frm.doc.docstatus })
			).css({ 'background-color': '#000', 'color': '#fff' });
		}
		// A new invoice opened directly: fetch the customer's delivered, not-yet-billed Delivery
		// Note lines — what Order Flow › Pending DN/SI invoices (public/js/invoice_fetch.js).
		if (frm.is_new() && !cint(frm.doc.is_return) && frappe.model.can_create('Sales Invoice')) {
			frm.add_custom_button(__('Fetch Pending to Bill'), () =>
				frappe.require('/assets/erp_dacsinc_custom/js/invoice_fetch.js', () => window.dacs_fetch_pending_to_bill(frm))
			).addClass('btn-primary');
		}
		// The Receive Payment prompt (public/js/bulk_payment.js — the same one as Order Flow ›
		// Finance) in place of ERPNext's Create › Payment.
		if (frm.doc.docstatus === 1 && !cint(frm.doc.is_return) && flt(frm.doc.outstanding_amount) > 0 && frappe.model.can_create('Payment Entry')) {
			frm.add_custom_button(__('Receive Payment'), () => {
				frappe.require('/assets/erp_dacsinc_custom/js/bulk_payment.js', () =>
					dacs_pay_invoice('Sales Invoice', frm.doc.name, () => frm.reload_doc(), { from_form: 1 }));
			}).addClass('btn-primary');
		}
	},
	make_linked_rows_read_only: function(frm) {
		if (frm.fields_dict.items && frm.fields_dict.items.grid) {
			(frm.fields_dict.items.grid.grid_rows || []).forEach(si_apply_row_locks);
		}
	}
});

frappe.ui.form.on('Sales Invoice Item', {
	items_add: function(frm, cdt, cdn) { frm.trigger('make_linked_rows_read_only'); },
	so_detail: function(frm, cdt, cdn) { frm.trigger('make_linked_rows_read_only'); },
	sales_order: function(frm, cdt, cdn) { frm.trigger('make_linked_rows_read_only'); },
	dn_detail: function(frm, cdt, cdn) { frm.trigger('make_linked_rows_read_only'); },
	delivery_note: function(frm, cdt, cdn) { frm.trigger('make_linked_rows_read_only'); },
	rate: function(frm, cdt, cdn) { frm.trigger('make_linked_rows_read_only'); },
	price_list_rate: function(frm, cdt, cdn) { frm.trigger('make_linked_rows_read_only'); },
	amount: function(frm, cdt, cdn) { frm.trigger('make_linked_rows_read_only'); },
	qty: function(frm, cdt, cdn) {
		// a return's quantities are negative: typing 2 on a Credit Note means -2
		const row = locals[cdt][cdn];
		if (cint(frm.doc.is_return) && flt(row.qty) > 0) {
			frappe.model.set_value(cdt, cdn, 'qty', -flt(row.qty));
			frappe.show_alert({ message: __('Return quantities are negative — set to {0}', [-flt(row.qty)]), indicator: 'blue' }, 3);
			return;
		}
		frm.trigger('make_linked_rows_read_only');
	},
	item_code: function(frm, cdt, cdn) { frm.trigger('make_linked_rows_read_only'); },

	// The expanded row form renders its own controls from the grid's field
	// definitions, so read_only has to be set on the row form controls too.
	form_render: function(frm, cdt, cdn) {
		const grid = frm.fields_dict.items && frm.fields_dict.items.grid;
		const grid_row = grid && grid.get_row(cdn);
		if (grid_row) {
			si_apply_row_locks(grid_row);
		}
	}
});

// ERPNext's "Get Items From" menu (Sales Order, Quotation, Delivery Note, Timesheet) is
// hidden: invoices are made from the Delivery Note / Sales Order or the Order Flow
// dashboard (Pending DN/SI), so the billing caps and locks there always apply. Some of
// these buttons are added after our refresh runs, hence the repeats.
function si_remove_get_items_buttons(frm) {
	const parent = __('Get Items From');
	const labels = [__('Sales Order'), __('Quotation'), __('Delivery Note'), __('Timesheet')];
	const remover = () => labels.forEach(l => frm.remove_custom_button(l, parent));
	remover();
	[200, 500, 1000, 2000].forEach(delay => setTimeout(remover, delay));
}

if (typeof window.dacs_hide_create_buttons !== 'function') {
	// Same helper as in sales_order.js — remove standard "Create" menu buttons, repeating
	// because ERPNext adds some of them after its own async calls.
	window.dacs_hide_create_buttons = function (frm, labels) {
		const remover = () => labels.forEach(l => frm.remove_custom_button(__(l), __('Create')));
		remover();
		[300, 800, 1500, 2500].forEach(delay => setTimeout(remover, delay));
	};
}

// Update Stock is set on save (si_stock.py) — the line under it says by which rule.
function si_update_stock_hint(frm) {
	// invoice: direct ticks it, from Delivery Notes unticks it
	if (!cint(frm.doc.is_return)) {
		frm.set_df_property('update_stock', 'description', frm.doc.docstatus === 0
			? __('Set on save — ticked for a direct invoice (the goods leave the warehouse with it), unticked when billed from Delivery Notes.')
			: (cint(frm.doc.update_stock) ? __('Stock went out with this invoice.') : __('Stock went out with the Delivery Note.')));
	} else if (!cint(frm.doc.is_pos)) {
		// Credit Note: same rule, the goods coming back (si_stock.set_return_update_stock)
		frm.set_df_property('update_stock', 'description', frm.doc.docstatus === 0
			? __('Set on save — ticked when the goods come back with this note (a direct return, or a note on a direct invoice); unticked when they went out with a Delivery Note (use Update Stock (return the goods) / Make Sales Return).')
			: (cint(frm.doc.update_stock) ? __('The goods came back into stock with this note.') : __('No stock moved with this note.')));
	}
}

// Credit / Debit Note actions on the form: public/js/return_actions.js (shared with Purchase Invoice).
if (typeof window.dacs_load_return_actions !== 'function') {
	window.dacs_load_return_actions = function (frm) {
		// Print: a return prints as a Credit Note / Debit Note (print_format credit_note_dac /
		// debit_note_dac); an ordinary invoice keeps its own default.
		const ret_pf = frm.doc.doctype === 'Sales Invoice' ? 'Credit Note DAC' : 'Debit Note DAC';
		frm.return_print_format = ret_pf;
		if (cint(frm.doc.is_return)) {
			if (frm.meta.default_print_format !== ret_pf) {
				frm.meta._dacs_default_print_format = frm.meta.default_print_format || null;
				frm.meta.default_print_format = ret_pf;
			}
		} else if (frm.meta.default_print_format === ret_pf) {
			frm.meta.default_print_format = frm.meta._dacs_default_print_format || null;
		}
		if (!cint(frm.doc.is_return)) { $(frm.layout.wrapper).find('.dacs-rp').remove(); return; }
		frappe.require('/assets/erp_dacsinc_custom/js/return_actions.js', () => window.dacs_return_actions(frm));
	};
}

// e-Invoice / e-Way Bill: its own full-width section at the top of the form (custom_einvoice_section, shown when the
// invoice has an IRN or an e-way bill), one compact row — the QR, then the e-invoice and the e-way bill details
// (custom_einvoice_ewaybill_html; data from einvoice_info.get_einvoice_ewaybill: India Compliance's logs + the invoice's
// GST / transport fields). A cancelled IRN or e-way bill shows red with its date and reason.
function dacs_einvoice_box(frm) {
	const f = frm.fields_dict.custom_einvoice_ewaybill_html;
	if (!f) return;
	if (frm.is_new() || !(frm.doc.irn || frm.doc.ewaybill)) { f.$wrapper.empty(); return; }
	frappe.call({ method: 'erp_dacsinc_custom.einvoice_info.get_einvoice_ewaybill', args: { sales_invoice: frm.doc.name } }).then(r => {
		const d = r.message || {};
		const esc = v => frappe.utils.escape_html(v == null ? '' : String(v));
		const dt = v => v ? frappe.datetime.str_to_user(v) : '';
		// label / value pairs, two pairs a line (a wide value takes the whole line); empty values are left out
		const grid = pairs => {
			const cells = pairs.filter(p => p[1]);
			const L = 'color:var(--text-muted);white-space:nowrap;padding:1px 8px 1px 0;vertical-align:top;';
			const V = 'padding:1px 14px 1px 0;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;';
			let rows = '', line = [];
			const flush = () => { if (line.length) rows += `<tr>${line.join('')}${line.length === 1 ? '<td></td><td></td>' : ''}</tr>`; line = []; };
			cells.forEach(([l, v, wide]) => {
				if (wide) { flush(); rows += `<tr><td style="${L}">${l}</td><td colspan="3" style="${V}">${v}</td></tr>`; return; }
				line.push(`<td style="${L}">${l}</td><td style="${V}">${v}</td>`);
				if (line.length === 2) flush();
			});
			flush();
			return `<table style="font-size:12px;border-collapse:collapse;width:100%;table-layout:auto;">${rows}</table>`;
		};
		const pill = (txt, ok) => `<span class="indicator-pill ${ok ? 'green' : 'red'}" style="margin-left:6px;font-size:11px;">${esc(txt)}</span>`;
		const block = (title, status, body) => `<div style="flex:1 1 320px;min-width:0;">
			<div style="font-weight:600;font-size:13px;margin-bottom:4px;">${title}${status}</div>${body}</div>`;
		const parts = [];
		if (d.qr) parts.push(`<img src="data:image/png;base64,${d.qr}" alt="e-Invoice QR" style="width:110px;height:110px;flex:none;border:1px solid var(--border-color);border-radius:4px;">`);
		if (d.irn) {
			const cx = cint(d.irn_cancelled) || d.einvoice_status === 'Cancelled';
			parts.push(block(__('e-Invoice'), pill(cx ? __('Cancelled') : (d.einvoice_status || __('Generated')), !cx), grid([
				[__('IRN'), `<span style="font-family:var(--font-stack-monospace,monospace);font-size:11px;">${esc(d.irn)}</span>`, 1],
				[__('Ack No'), `<b>${esc(d.ack_no)}</b>`], [__('Ack Date'), dt(d.ack_date)],
				[__('Seller GSTIN'), esc(d.company_gstin)], [__('Buyer GSTIN'), esc(d.billing_address_gstin)],
				[__('Place of Supply'), esc(d.place_of_supply)], [__('Invoice Value'), d.grand_total ? format_currency(d.grand_total, frm.doc.currency) : ''],
				[__('Cancelled on'), cx ? dt(d.irn_cancelled_on) : ''], [__('Reason'), cx ? esc(d.irn_cancel_remark) : ''],
			])));
		}
		if (d.ewaybill) {
			const cx = cint(d.ewaybill_cancelled) || d.e_waybill_status === 'Cancelled';
			const transporter = [d.gst_transporter_id, d.transporter_name].filter(Boolean).map(esc).join(' – ');
			parts.push(block(__('e-Way Bill'), pill(cx ? __('Cancelled') : (d.e_waybill_status || __('Generated')), !cx), grid([
				[__('EWB No'), `<b>${esc(d.ewaybill)}</b>`], [__('Generated'), dt(d.ewaybill_date)],
				[__('Valid Upto'), dt(d.ewaybill_valid_upto)], [__('Mode'), esc(d.mode_of_transport)],
				[__('Vehicle No'), esc(d.vehicle_no)], [__('Vehicle Type'), esc(d.gst_vehicle_type)],
				[__('Distance'), d.distance ? `${esc(d.distance)} km` : ''], [__('LR No / Date'), [esc(d.lr_no), dt(d.lr_date)].filter(Boolean).join(' · ')],
				[__('Transporter'), transporter, 1],
				[__('Cancelled on'), cx ? dt(d.ewaybill_cancelled_on) : ''],
			])));
		}
		f.$wrapper.html(`<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;padding:4px 0;">${parts.join('')}</div>`);
	});
}

// Customer's GSTIN given after the invoice was submitted (invoice_gstin.py, docs/invoice-gstin-update.md): Accounts
// Manager / Admin, same-state GSTIN only, no e-Invoice / e-Way Bill yet; taxes and ledger stay as they are.
// Pick the address → a Before / After confirmation → update → result alert (and the e-Invoice reminder).
function dacs_gstin_update_button(frm) {
	if (frm.doc.docstatus !== 1 || cint(frm.doc.is_return) || cint(frm.doc.is_pos) || frm.doc.irn || frm.doc.ewaybill
		|| !frappe.user.has_role(['Accounts Manager', 'Admin'])) return;
	frappe.xcall('erp_dacsinc_custom.invoice_gstin.get_gstin_update', { invoice: frm.doc.name }).then(r => {
		if (!r || frm.doc.docstatus !== 1) return;
		frm.add_custom_button(__('Update Customer GSTIN'), () => dacs_gstin_update_dialog(frm, r));
	});
}

function dacs_gstin_update_dialog(frm, r) {
	const esc = frappe.utils.escape_html;
	const by_name = {};
	r.addresses.forEach(a => by_name[a.name] = a);
	const opts = r.addresses.map(a => ({ value: a.name, label: `${a.gstin} — ${[a.address_line1, a.city, a.state].filter(Boolean).join(', ')}` }));
	const d = new frappe.ui.Dialog({
		title: __('Update Customer GSTIN — {0}', [frm.doc.name]),
		fields: [
			{ fieldtype: 'HTML', options: `<div class="alert alert-info small mb-3">${__('Use this only when the customer gave their GSTIN after the invoice was made. The new GSTIN is of the same state, so the taxes, totals and accounting entries stay exactly as they are; only the invoice\'s GST details change (B2C → B2B in GSTR-1).')}</div>` },
			{ fieldname: 'address', fieldtype: 'Select', label: __("Customer's GST address"), options: opts, default: opts[0].value, reqd: 1 },
		],
		primary_action_label: __('Next'),
		primary_action: v => {
			const a = by_name[v.address];
			const row = (label, before, after) => `<tr><td>${label}</td><td>${esc(before || '—')}</td><td><b>${esc(after || '—')}</b></td></tr>`;
			const msg = `<p>${__('Please check before updating invoice <b>{0}</b> ({1}):', [esc(frm.doc.name), esc(frm.doc.customer_name)])}</p>
				<table class="table table-bordered table-sm small">
					<tr><th></th><th>${__('Before')}</th><th>${__('After')}</th></tr>
					${row(__('GSTIN'), r.current.gstin, a.gstin)}
					${row(__('GST Category'), r.current.gst_category, a.gst_category)}
					${row(__('Billing Address'), r.current.address, [a.name, a.city, a.state, a.pincode].filter(Boolean).join(', '))}
					${row(__('Place of Supply'), frm.doc.place_of_supply, frm.doc.place_of_supply)}
					${row(__('Grand Total'), format_currency(frm.doc.grand_total, frm.doc.currency), format_currency(frm.doc.grand_total, frm.doc.currency) + ' ' + __('(no change)'))}
				</table>
				<div class="alert alert-warning small">${__('This cannot be undone from here. After the update the invoice is B2B: if e-Invoicing applies, generate the e-Invoice for it straight away.')}</div>`;
			frappe.confirm(msg, () => {
				d.hide();
				frappe.xcall('erp_dacsinc_custom.invoice_gstin.update_customer_gstin', { invoice: frm.doc.name, address: v.address }, __('Updating GSTIN…'))
					.then(res => {
						frappe.msgprint({
							title: __('Customer GSTIN updated'), indicator: 'green',
							message: res.changes.map(esc).join('<br>') + '<br><br>' + __('Taxes, totals and accounting entries are unchanged. A note is added to the invoice.')
								+ (res.einvoice_status === 'Pending' ? '<br><br><b>' + __('Next: generate the e-Invoice for this invoice.') + '</b>' : ''),
						});
						frm.reload_doc();
					});
			});
		},
	});
	d.show();
}
