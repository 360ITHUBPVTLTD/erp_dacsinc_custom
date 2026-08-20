frappe.ui.form.on('BOM', {
	refresh: function(frm) {
		if (frm.doc.docstatus === 0 && frappe.user.has_role('System Manager') && !frm.is_new()) {
			frm.add_custom_button(__('Remove Duplicates'), function() {
				frappe.confirm(
					__('Are you sure you want to remove duplicate item rows (matching Item Code and Qty) from this BOM?'),
					function() {
						frappe.call({
							method: 'erp_dacsinc_custom.custom_script.remove_duplicate_items_for_bom',
							args: {
								bom_name: frm.doc.name
							},
							freeze: true,
							freeze_message: __('Removing duplicates...'),
							callback: function(r) {
								if (r.message) {
									frappe.show_alert(__('Duplicate items removed successfully.'));
									frm.reload_doc();
								} else {
									frappe.msgprint(__('No duplicate items found.'));
								}
							}
						});
					}
				);
			}, __('Actions'));
		}
	}
});
