// A Delivery Note Item row that came from another document is a RECORD of what
// that document already committed — not a place to renegotiate it. Editing qty
// or rate here desyncs this row from the Sales Order line it bills against and
// the Pick List that physically reserved the stock, silently breaking the
// picked_qty / delivered_qty / billed reconciliation the Order Flow dashboard
// depends on. The quantity decision belongs upstream: at the Pick List, or in
// the "select Pick List(s)" step that builds this document.

const DN_LINK_FIELDS = [
	'so_detail', 'against_sales_order',
	'pick_list_item', 'against_pick_list',
	'dn_detail',
];

const DN_LOCKED_FIELDS = [
	'qty', 'rate', 'price_list_rate', 'amount', 'item_code', 'warehouse',
	'uom', 'conversion_factor', 'discount_percentage', 'discount_amount'
];

function dn_row_is_linked(doc) {
	return !!(doc && DN_LINK_FIELDS.some(f => doc[f]));
}

// A Sales Return (is_return) keeps its lines linked to the Delivery Note it reverses, but the qty
// coming back is the user's to set (negative: -1, -2 …); everything else stays as delivered.
// Same rule as sales_invoice.js (si_field_locked) and custom_script._revert_pick_list_locked_fields.
function dn_field_locked(row_doc, parent_doc, fieldname) {
	if (!dn_row_is_linked(row_doc)) return false;
	return !(fieldname === 'qty' && parent_doc && cint(parent_doc.is_return));
}

function dn_apply_row_locks(row) {
	if (!row || !row.doc) return;
	const parent_doc = row.frm && row.frm.doc;
	DN_LOCKED_FIELDS.forEach(f => row.toggle_editable(f, !dn_field_locked(row.doc, parent_doc, f)));
}

frappe.ui.form.on('Delivery Note', {
	setup: function(frm) {
		if (frm.fields_dict.items && frm.fields_dict.items.grid) {
			// Declarative per-row lock, evaluated by the grid itself on every
			// render.
			const linked = '(' + DN_LINK_FIELDS.map(f => 'doc.' + f).join(' || ') + ')';
			const lock_expr = 'eval: ' + linked;
			const qty_lock_expr = 'eval: ' + linked + ' && !(parent && parent.is_return)';
			const expr_for = (f) => (f === 'qty' ? qty_lock_expr : lock_expr);
			(frm.fields_dict.items.grid.docfields || []).forEach(df => {
				if (DN_LOCKED_FIELDS.includes(df.fieldname)) {
					df.read_only_depends_on = expr_for(df.fieldname);
				}
			});
			DN_LOCKED_FIELDS.forEach(f => {
				const df = frappe.meta.get_docfield('Delivery Note Item', f, frm.doc.name);
				if (df) df.read_only_depends_on = expr_for(f);
				const meta_df = frappe.meta.get_docfield('Delivery Note Item', f);
				if (meta_df) meta_df.read_only_depends_on = expr_for(f);
			});

			let old_on_row_refresh = frm.fields_dict.items.grid.on_row_refresh;
			frm.fields_dict.items.grid.on_row_refresh = function(row) {
				if (old_on_row_refresh) {
					old_on_row_refresh(row);
				}
				dn_apply_row_locks(row);
			};
		}
	},
	onload: function(frm) {
		frm.trigger('make_linked_rows_read_only');
	},
	refresh: function(frm) {
		frm.trigger('make_linked_rows_read_only');
		// Create menu: Sales Invoice and Sales Return stay (the billing / return flow). On a Sales
		// Return, ERPNext's "Credit Note" is replaced by "Make Credit Note" (return_goods.py): that
		// one is made from the original invoice, so it is against it (GST, the invoice's balance).
		dacs_hide_create_buttons(frm, ['Shipment', 'Installation Note', 'Delivery Trip', 'Packing Slip', 'Quality Inspection(s)']
			.concat(cint(frm.doc.is_return) ? ['Credit Note'] : []));
		$(frm.layout.wrapper).find('.dacs-rp').remove();
		if (cint(frm.doc.is_return) && !frm.is_new()) {
			frappe.require('/assets/erp_dacsinc_custom/js/return_actions.js', () => window.dacs_goods_status(frm));
		}
	},
	make_linked_rows_read_only: function(frm) {
		if (frm.fields_dict.items && frm.fields_dict.items.grid) {
			(frm.fields_dict.items.grid.grid_rows || []).forEach(dn_apply_row_locks);
		}
	}
});

frappe.ui.form.on('Delivery Note Item', {
	items_add: function(frm, cdt, cdn) { frm.trigger('make_linked_rows_read_only'); },
	so_detail: function(frm, cdt, cdn) { frm.trigger('make_linked_rows_read_only'); },
	against_sales_order: function(frm, cdt, cdn) { frm.trigger('make_linked_rows_read_only'); },
	pick_list_item: function(frm, cdt, cdn) { frm.trigger('make_linked_rows_read_only'); },
	against_pick_list: function(frm, cdt, cdn) { frm.trigger('make_linked_rows_read_only'); },
	dn_detail: function(frm, cdt, cdn) { frm.trigger('make_linked_rows_read_only'); },
	rate: function(frm, cdt, cdn) { frm.trigger('make_linked_rows_read_only'); },
	price_list_rate: function(frm, cdt, cdn) { frm.trigger('make_linked_rows_read_only'); },
	amount: function(frm, cdt, cdn) { frm.trigger('make_linked_rows_read_only'); },
	qty: function(frm, cdt, cdn) {
		// a Sales Return's quantities are negative: typing 2 means -2
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
			dn_apply_row_locks(grid_row);
		}
	}
});

if (typeof window.dacs_hide_create_buttons !== 'function') {
	// Same helper as in sales_order.js — remove standard "Create" menu buttons, repeating
	// because ERPNext adds some of them after its own async calls.
	window.dacs_hide_create_buttons = function (frm, labels) {
		const remover = () => labels.forEach(l => frm.remove_custom_button(__(l), __('Create')));
		remover();
		[300, 800, 1500, 2500].forEach(delay => setTimeout(remover, delay));
	};
}
