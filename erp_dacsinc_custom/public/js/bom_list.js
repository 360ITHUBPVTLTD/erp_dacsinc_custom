frappe.listview_settings['BOM'] = {
	onload: function(listview) {
		if (frappe.user.has_role('System Manager')) {
			listview.page.add_inner_button(__('Remove Duplicates in Draft BOMs'), function() {
				frappe.confirm(
					__('Are you sure you want to remove duplicate item rows from all Draft BOMs? This will only keep the first occurrence of each item in the Raw Materials table and discard the rest.'),
					function() {
						frappe.call({
							method: "erp_dacsinc_custom.custom_script.remove_duplicate_bom_items",
							freeze: true,
							freeze_message: __("Processing BOMs..."),
							callback: function(r) {
								if (r.message && r.message.status === "success") {
									let msg = "";
									if (r.message.modified_boms && r.message.modified_boms.length > 0) {
										msg += __("Successfully cleaned {0} Draft BOMs:<br>{1}", [
											r.message.modified_boms.length,
											r.message.modified_boms.join(", ")
										]);
									} else {
										msg += __("No duplicate items found in any Draft BOMs.");
									}
									
									if (r.message.errors && r.message.errors.length > 0) {
										msg += "<br><br>" + __("Failed to clean some BOMs:<br>{0}", [
											r.message.errors.join("<br>")
										]);
										frappe.msgprint({
											title: __('Deduplication Results'),
											message: msg,
											indicator: 'orange'
										});
									} else {
										frappe.msgprint({
											title: __('Deduplication Results'),
											message: msg,
											indicator: 'green'
										});
									}
									listview.refresh();
								}
							}
						});
					}
				);
			});
		}
	}
};
