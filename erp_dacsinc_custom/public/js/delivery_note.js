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

function dn_apply_row_locks(row) {
	if (!row || !row.doc) return;
	const locked = dn_row_is_linked(row.doc);
	DN_LOCKED_FIELDS.forEach(f => row.toggle_editable(f, !locked));
}

frappe.ui.form.on('Delivery Note', {
	setup: function(frm) {
		if (frm.fields_dict.items && frm.fields_dict.items.grid) {
			// Declarative per-row lock, evaluated by the grid itself on every
			// render.
			const lock_expr = 'eval: ' + DN_LINK_FIELDS.map(f => 'doc.' + f).join(' || ');
			(frm.fields_dict.items.grid.docfields || []).forEach(df => {
				if (DN_LOCKED_FIELDS.includes(df.fieldname)) {
					df.read_only_depends_on = lock_expr;
				}
			});
			DN_LOCKED_FIELDS.forEach(f => {
				const df = frappe.meta.get_docfield('Delivery Note Item', f, frm.doc.name);
				if (df) df.read_only_depends_on = lock_expr;
				const meta_df = frappe.meta.get_docfield('Delivery Note Item', f);
				if (meta_df) meta_df.read_only_depends_on = lock_expr;
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
	qty: function(frm, cdt, cdn) { frm.trigger('make_linked_rows_read_only'); },
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

