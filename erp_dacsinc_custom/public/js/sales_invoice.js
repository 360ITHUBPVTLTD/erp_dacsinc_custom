frappe.ui.form.on('Sales Invoice', {
	setup: function(frm) {
		if (frm.fields_dict.items && frm.fields_dict.items.grid) {
			// Override edit_cell to block inline editing of rate and price_list_rate if linked to SO
			let old_edit_cell = frm.fields_dict.items.grid.edit_cell;
			frm.fields_dict.items.grid.edit_cell = function(row, fieldname) {
				if (fieldname === 'rate' || fieldname === 'price_list_rate') {
					if (row && row.doc && row.doc.so_detail) {
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
				if (row.doc.so_detail) {
					row.toggle_enable('rate', false);
					row.toggle_enable('price_list_rate', false);
				} else {
					row.toggle_enable('rate', true);
					row.toggle_enable('price_list_rate', true);
				}
			};
		}
	},
	onload: function(frm) {
		frm.trigger('make_rate_read_only_if_linked');
	},
	refresh: function(frm) {
		frm.trigger('make_rate_read_only_if_linked');
	},
	make_rate_read_only_if_linked: function(frm) {
		if (frm.fields_dict.items && frm.fields_dict.items.grid) {
			frm.fields_dict.items.grid.grid_rows.forEach(row => {
				if (row.doc.so_detail) {
					row.toggle_enable('rate', false);
					row.toggle_enable('price_list_rate', false);
				} else {
					row.toggle_enable('rate', true);
					row.toggle_enable('price_list_rate', true);
				}
			});
		}
	}
});

frappe.ui.form.on('Sales Invoice Item', {
	items_add: function(frm, cdt, cdn) {
		frm.trigger('make_rate_read_only_if_linked');
	},
	so_detail: function(frm, cdt, cdn) {
		frm.trigger('make_rate_read_only_if_linked');
	},
	rate: function(frm, cdt, cdn) {
		frm.trigger('make_rate_read_only_if_linked');
	},
	price_list_rate: function(frm, cdt, cdn) {
		frm.trigger('make_rate_read_only_if_linked');
	},
	qty: function(frm, cdt, cdn) {
		frm.trigger('make_rate_read_only_if_linked');
	},
	item_code: function(frm, cdt, cdn) {
		frm.trigger('make_rate_read_only_if_linked');
	},
	form_render: function(frm, cdt, cdn) {
		let row = frappe.get_doc(cdt, cdn);
		if (row.so_detail) {
			frm.fields_dict.items.grid.get_field('rate').df.read_only = 1;
			frm.fields_dict.items.grid.get_field('price_list_rate').df.read_only = 1;
		} else {
			frm.fields_dict.items.grid.get_field('rate').df.read_only = 0;
			frm.fields_dict.items.grid.get_field('price_list_rate').df.read_only = 0;
		}
		frm.fields_dict.items.grid.refresh_field('rate');
		frm.fields_dict.items.grid.refresh_field('price_list_rate');
	}
});
