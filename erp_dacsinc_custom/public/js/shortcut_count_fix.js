// Workspace shortcuts: ask for a record count only when the shortcut has a count filter.
//
// Frappe's ShortcutWidget.set_actions counts every DocType shortcut whose filter
// expression is truthy — and an empty filter parses to [] (truthy), so it also counts
// shortcuts that have no filter at all. For a single-record DocType (GST Settings,
// GSTR-1 Beta, Purchase Reconciliation Tool …) there is no table to count, and the
// server answers with a TableMissingError popup every time the workspace opens.
// Here the filter expression is hidden from that check when the shortcut has none;
// shortcuts with a real count filter are untouched.
(() => {
	const factory = frappe.widget && frappe.widget.widget_factory;
	if (!factory || !factory.shortcut || factory.shortcut.__dacs_count_fix) return;

	class ShortcutWidgetNoEmptyCount extends factory.shortcut {
		set_actions() {
			if (this.stats_filter) return super.set_actions();
			const process = frappe.utils.process_filter_expression;
			frappe.utils.process_filter_expression = () => null;
			try {
				return super.set_actions();
			} finally {
				frappe.utils.process_filter_expression = process;
			}
		}
	}
	ShortcutWidgetNoEmptyCount.__dacs_count_fix = true;
	factory.shortcut = ShortcutWidgetNoEmptyCount;
})();
