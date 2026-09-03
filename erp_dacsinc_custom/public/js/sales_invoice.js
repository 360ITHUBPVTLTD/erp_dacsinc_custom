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

const SI_LOCKED_FIELDS = [
	'qty', 'rate', 'price_list_rate', 'amount', 'item_code', 'warehouse',
	'uom', 'conversion_factor', 'discount_percentage', 'discount_amount'
];

function si_row_is_linked(doc) {
	return !!(doc && SI_LINK_FIELDS.some(f => doc[f]));
}

function si_apply_row_locks(row) {
	if (!row || !row.doc) return;
	const locked = si_row_is_linked(row.doc);
	SI_LOCKED_FIELDS.forEach(f => row.toggle_editable(f, !locked));
}

frappe.ui.form.on('Sales Invoice', {
	setup: function(frm) {
		if (frm.fields_dict.items && frm.fields_dict.items.grid) {
			// Declarative per-row lock, evaluated by the grid itself on every
			// render.
			const lock_expr = 'eval: ' + SI_LINK_FIELDS.map(f => 'doc.' + f).join(' || ');
			(frm.fields_dict.items.grid.docfields || []).forEach(df => {
				if (SI_LOCKED_FIELDS.includes(df.fieldname)) {
					df.read_only_depends_on = lock_expr;
				}
			});
			SI_LOCKED_FIELDS.forEach(f => {
				const df = frappe.meta.get_docfield('Sales Invoice Item', f, frm.doc.name);
				if (df) df.read_only_depends_on = lock_expr;
				const meta_df = frappe.meta.get_docfield('Sales Invoice Item', f);
				if (meta_df) meta_df.read_only_depends_on = lock_expr;
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
	refresh: function(frm) {
		frm.trigger('make_linked_rows_read_only');
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
	qty: function(frm, cdt, cdn) { frm.trigger('make_linked_rows_read_only'); },
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

