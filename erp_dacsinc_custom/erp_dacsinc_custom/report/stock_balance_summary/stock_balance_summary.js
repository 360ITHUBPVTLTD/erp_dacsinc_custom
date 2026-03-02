frappe.query_reports["Stock Balance Summary"] = {
	"filters": [
		{
			"fieldname": "item_code",
			"label": __("Item Code"),
			"fieldtype": "Link",
			"options": "Item",
            "get_query": function() { return { filters: { "disabled": 0 } }; }
		},
        {
			"fieldname": "item_group",
			"label": __("Item Group"),
			"fieldtype": "Link",
			"options": "Item Group"
		},
        {
			"fieldname": "brand",
			"label": __("Brand"),
			"fieldtype": "Link",
			"options": "Brand"
		},
        {
			"fieldname": "custom_product_category",
			"label": __("Category"),
			"fieldtype": "Link",
			"options": "Product Category"
		},
		{
			"fieldname": "warehouse",
			"label": __("Warehouse"),
			"fieldtype": "Link",
			"options": "Warehouse"
		},
		{
			"fieldname": "report_mode",
			"label": __("Filter View"),
			"fieldtype": "Select",
			"options": [
				{"value": "All Warehouses", "label": __("All Warehouses")},
				{"value": "Retail (POS) View", "label": __("Retail Stores Only")},
				{"value": "Back-Office Only", "label": __("Main Inventory Only (Inverse)")}
			],
			"default": "All Warehouses",
			"on_change": function() { frappe.query_report.refresh(); }
		}
	],
	"formatter": function(value, row, column, data) {
		if (["actual_qty", "final_projected", "system_qty", "unclosed_pos_qty"].includes(column.fieldname)) {
			let color = (value <= 0) ? "red" : (value <= 5 ? "orange" : "green");
			value = `<span style="color: ${color}; font-weight: bold;">${value}</span>`;
		}
		return value;
	},

    "onload": function(report) {
        // --- SECURE FILTER HIDING FOR POS USERS ---
        if (frappe.user_roles.includes("POS User") && !frappe.user_roles.includes("System Manager")) {
            
            // Fix: In reports, use .get_filter('fieldname').df.hidden = 1
            let warehouse_filter = report.get_filter('warehouse');
            if (warehouse_filter) {
                warehouse_filter.df.hidden = 1;
                warehouse_filter.refresh();
            }

            let mode_filter = report.get_filter('report_mode');
            if (mode_filter) {
                mode_filter.df.hidden = 1;
                // Force background value to POS Mode
                report.set_filter_value('report_mode', 'Retail (POS) View');
                mode_filter.refresh();
            }
        }
    }
};