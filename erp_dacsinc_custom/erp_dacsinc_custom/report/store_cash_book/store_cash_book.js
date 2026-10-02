// Store Cash Book (store_cash_book.py): one line per POS shift; the cash in the drawer
// from one shift to the next. Amounts that don't match are shown in red.
frappe.query_reports["Store Cash Book"] = {
	filters: [
		{ fieldname: "from_date", label: __("From Date"), fieldtype: "Date", default: frappe.datetime.add_days(frappe.datetime.get_today(), -30), reqd: 1 },
		{ fieldname: "to_date", label: __("To Date"), fieldtype: "Date", default: frappe.datetime.get_today(), reqd: 1 },
		{ fieldname: "pos_profile", label: __("Store"), fieldtype: "Link", options: "POS Profile" },
	],
	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (data && ["opening_mismatch", "short_extra"].includes(column.fieldname) && data[column.fieldname] != null) {
			const v = flt(data[column.fieldname]);
			if (Math.abs(v) > 0.004) value = `<span style="color: var(--red-600, #c0392b); font-weight: 600;">${value}</span>`;
		}
		if (data && column.fieldname === "status" && data.status === __("Open")) value = `<span style="color: var(--orange-600, #c26b00);">${value}</span>`;
		return value;
	},
};
