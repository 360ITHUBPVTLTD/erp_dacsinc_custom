frappe.query_reports["Stock Balance Summary"] = {
	"filters": [
		{
			"fieldname": "item_code",
			"label": __("Item Code"),
			"fieldtype": "Link",
			"options": "Item"
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
				{"value": "Back-Office Only", "label": __("Back-Office Only")}
			],
			"default": "All Warehouses",
            "on_change": function() { frappe.query_report.refresh(); }
		}
	],
	"formatter": function(value, row, column, data) {
		if (!value || value === "null") return "";

		if (column.fieldname === "actual_qty") {
            let color = (parseFloat(value) <= 5) ? "red" : "green";
            value = `<span style="color: ${color}; font-weight: bold;">${value}</span>`;
        }

		// Clickable Link for Stock Entry Drafts
		if (column.fieldname === "se_draft_display" && value) {
			value = `<a style="color: #6200ea; font-weight: bold; text-decoration: underline; cursor: pointer;" 
                        onclick="frappe.query_reports['Stock Balance Summary'].open_draft_se('${data.se_names}')">
                        ${value}
                    </a>`;
		}

        // Material Request Styling
        if (["mr_draft_display", "mr_sub_display"].includes(column.fieldname) && value) {
			value = `<span style="color: #0d47a1; font-weight: 500;">${value}</span>`;
		}

		return value;
	},

    "open_draft_se": function(ids) {
        if (!ids || ids === "undefined") return;
        let id_list = ids.split(",");
        if (id_list.length === 1) {
            frappe.set_route("Form", "Stock Entry", id_list[0]);
        } else {
            frappe.set_route("List", "Stock Entry", { "name": ["in", id_list] });
        }
    },

    "onload": function(report) {
        if (frappe.user_roles.includes("POS User") && !frappe.user_roles.includes("System Manager")) {
            // Hide secure filters for POS User
            const hide_filters = ['warehouse', 'report_mode'];
            hide_filters.forEach(f => {
                let filter = report.get_filter(f);
                if (filter) {
                    filter.df.hidden = 1;
                    filter.refresh();
                }
            });
            report.set_filter_value('report_mode', 'Retail (POS) View');
            report.refresh();
        }
    }
};