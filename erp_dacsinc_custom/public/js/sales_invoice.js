frappe.ui.form.on('Sales Invoice', {
	setup: function(frm) {
		if (frm.fields_dict.items && frm.fields_dict.items.grid) {
			// Override edit_cell to block inline editing of rate/price_list_rate/
			// amount (linked to a Sales Order line) and qty/item_code/warehouse (an
			// Update Stock invoice against a Sales Order — in this company's
			// flow the only way to reach one is create_dn_or_si_from_pick_lists,
			// mapped straight from a Pick List's own reservation; editing it
			// here only desyncs this row from what's actually reserved,
			// silently breaking picked_qty vs delivered_qty reconciliation
			// everywhere the Order Flow dashboard depends on it. Use the Pick
			// List itself to change any of this).
			// amount is locked alongside rate (not qty) — it's qty * rate, and
			// editing amount directly would just back-derive a different rate.
			let old_edit_cell = frm.fields_dict.items.grid.edit_cell;
			frm.fields_dict.items.grid.edit_cell = function(row, fieldname) {
				if (row && row.doc) {
					if (['rate', 'price_list_rate', 'amount'].includes(fieldname) && row.doc.so_detail) {
						return; // Block editing
					}
					if (['qty', 'item_code', 'warehouse'].includes(fieldname) && frm.doc.update_stock && row.doc.so_detail) {
						return; // Block editing
					}
				}
				return old_edit_cell.apply(this, arguments);
			};

			// Keep existing row refresh logic as backup
			let old_on_row_refresh = frm.fields_dict.items.grid.on_row_refresh;
			frm.fields_dict.items.grid.on_row_refresh = function(row) {
				if (old_on_row_refresh) {
					old_on_row_refresh(row);
				}
				const stock_row_locked = !!(frm.doc.update_stock && row.doc.so_detail);
				row.toggle_enable('rate', !row.doc.so_detail);
				row.toggle_enable('price_list_rate', !row.doc.so_detail);
				row.toggle_enable('amount', !row.doc.so_detail);
				row.toggle_enable('qty', !stock_row_locked);
				row.toggle_enable('item_code', !stock_row_locked);
				row.toggle_enable('warehouse', !stock_row_locked);
			};
		}
	},
	onload: function(frm) {
		frm.trigger('make_pick_list_rows_read_only_if_linked');
	},
	refresh: function(frm) {
		frm.trigger('make_pick_list_rows_read_only_if_linked');
	},
	make_pick_list_rows_read_only_if_linked: function(frm) {
		if (frm.fields_dict.items && frm.fields_dict.items.grid) {
			frm.fields_dict.items.grid.grid_rows.forEach(row => {
				const stock_row_locked = !!(frm.doc.update_stock && row.doc.so_detail);
				row.toggle_enable('rate', !row.doc.so_detail);
				row.toggle_enable('price_list_rate', !row.doc.so_detail);
				row.toggle_enable('amount', !row.doc.so_detail);
				row.toggle_enable('qty', !stock_row_locked);
				row.toggle_enable('item_code', !stock_row_locked);
				row.toggle_enable('warehouse', !stock_row_locked);
			});
		}
	}
});

frappe.ui.form.on('Sales Invoice Item', {
	items_add: function(frm, cdt, cdn) {
		frm.trigger('make_pick_list_rows_read_only_if_linked');
	},
	so_detail: function(frm, cdt, cdn) {
		frm.trigger('make_pick_list_rows_read_only_if_linked');
	},
	rate: function(frm, cdt, cdn) {
		frm.trigger('make_pick_list_rows_read_only_if_linked');
	},
	price_list_rate: function(frm, cdt, cdn) {
		frm.trigger('make_pick_list_rows_read_only_if_linked');
	},
	amount: function(frm, cdt, cdn) {
		frm.trigger('make_pick_list_rows_read_only_if_linked');
	},
	qty: function(frm, cdt, cdn) {
		frm.trigger('make_pick_list_rows_read_only_if_linked');
	},
	item_code: function(frm, cdt, cdn) {
		frm.trigger('make_pick_list_rows_read_only_if_linked');
	},
	form_render: function(frm, cdt, cdn) {
		let row = frappe.get_doc(cdt, cdn);
		const rate_locked = !!row.so_detail;
		const stock_row_locked = !!(frm.doc.update_stock && row.so_detail);
		frm.fields_dict.items.grid.get_field('rate').df.read_only = rate_locked ? 1 : 0;
		frm.fields_dict.items.grid.get_field('price_list_rate').df.read_only = rate_locked ? 1 : 0;
		frm.fields_dict.items.grid.get_field('amount').df.read_only = rate_locked ? 1 : 0;
		frm.fields_dict.items.grid.get_field('qty').df.read_only = stock_row_locked ? 1 : 0;
		frm.fields_dict.items.grid.get_field('item_code').df.read_only = stock_row_locked ? 1 : 0;
		frm.fields_dict.items.grid.get_field('warehouse').df.read_only = stock_row_locked ? 1 : 0;
		frm.fields_dict.items.grid.refresh_field('rate');
		frm.fields_dict.items.grid.refresh_field('price_list_rate');
		frm.fields_dict.items.grid.refresh_field('amount');
		frm.fields_dict.items.grid.refresh_field('qty');
		frm.fields_dict.items.grid.refresh_field('item_code');
		frm.fields_dict.items.grid.refresh_field('warehouse');
	}
});
