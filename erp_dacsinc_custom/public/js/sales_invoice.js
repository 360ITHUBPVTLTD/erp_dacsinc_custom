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
	onload_post_render: function(frm) {
		si_remove_get_items_buttons(frm);
	},
	refresh: function(frm) {
		frm.trigger('make_linked_rows_read_only');
		si_remove_get_items_buttons(frm);
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
		// The Receive Payment prompt (public/js/payment_prompt.js — the same one as Order Flow ›
		// Finance) in place of ERPNext's Create › Payment.
		if (frm.doc.docstatus === 1 && !cint(frm.doc.is_return) && flt(frm.doc.outstanding_amount) > 0 && frappe.model.can_create('Payment Entry')) {
			frm.add_custom_button(__('Receive Payment'), () => {
				frappe.require('/assets/erp_dacsinc_custom/js/payment_prompt.js', () =>
					of_payment_prompt('Sales Invoice', frm.doc.name, () => frm.reload_doc(), { from_form: 1 }));
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
