frappe.query_reports["Lead Report"] = {
	filters: [
		{
			fieldname: "inverse_report",
			label: "Inverse Activity Report",
			fieldtype: "Check",
			default: 0,
			reqd: 0,
		},
		{
			fieldname: "custom_lead_category",
			label: "Lead Category",
			fieldtype: "Select",
			options: "\nEnquiry\nPipeline\nOrder\nLost Enquiry\nLost Pipeline",
			reqd: 0,
		},
		{
			fieldname: "mobile_no",
			label: "Mobile No",
			fieldtype: "Data",
			reqd: 0,
		},
		{
			fieldname: "source",
			label: "Source",
			fieldtype: "Link",
			options: "Lead Source",
			reqd: 0,
		},
		{
			fieldname: "lead_owner",
			label: "Lead Owner",
			fieldtype: "Link",
			options: "User",
			reqd: 0,
		},
		{
			fieldname: "assigned_to",
			label: "Assigned To",
			fieldtype: "Link",
			options: "User",
			reqd: 0,
		},
		{
			fieldname: "custom_created_at_option",
			label: "Created / Activity Date Filter",
			fieldtype: "Select",
			options: "\nToday\nUpcoming\nOverdue\nThis Month\nThis Week\nCustom",
			default: "Today",
			reqd: 0,
		},
		{
			fieldname: "custom_created_at",
			label: "Custom Date Range",
			fieldtype: "DateRange",
			reqd: 0,
		},
		{
			fieldname: "lead_activity_status",
			label: "Lead Activity Status",
			fieldtype: "Select",
			options: "\nWith Activity\nWithout Activity",
			reqd: 0,
		},
		{
			fieldname: "lead_type",
			label: "Lead Type",
			fieldtype: "Select",
			options: "\nHOT\nCOLD\nWARM",
			reqd: 0,
		},
		{
			fieldname: "direction_type",
			label: "Direction Type",
			fieldtype: "Select",
			options: "\nInbound\nOutbound",
			reqd: 0,
		},
		{
			fieldname: "industry",
			label: "Industry",
			fieldtype: "Link",
			options: "Industry Type",
			reqd: 0,
		},
		{
			fieldname: "category",
			label: "Activity Category",
			fieldtype: "Select",
			options:
				"\nInitial Call\nFollow up Call\nInitial Meeting\nFollow up meetings\nMeeting (Sample)\nProposal/Quotation\nOrder Closure",
			reqd: 0,
		},
		{
			fieldname: "status",
			label: "Activity Status",
			fieldtype: "Select",
			options: "\nOpen\nCompleted\nCancelled",
			default: "Open",
			reqd: 0,
		},
	],

	onload: function (report) {
	// Lead Owner Filter
	let lead_owner_filter = report.get_filter("lead_owner");
	let assigned_to_filter = report.get_filter("assigned_to");

	// Check if user is DAC CRM Head
	let is_crm_head = frappe.user.has_role("DAC CRM");

	if (!is_crm_head) {
		// For non-CRM Head users → set session user as default and lock
		lead_owner_filter.set_value(frappe.session.user);
		$(lead_owner_filter.$input).attr("disabled", true);

		assigned_to_filter.set_value(frappe.session.user);
		$(assigned_to_filter.$input).attr("disabled", true);
	} else {
		// For CRM Head → keep empty and editable
		$(lead_owner_filter.$input).attr("disabled", false);
		$(assigned_to_filter.$input).attr("disabled", false);
	}

	function toggle_filters_visibility() {
		const inverse = report.get_filter_value("inverse_report");

		const lead_filters = [
			"custom_lead_category",
			"lead_owner",
			"mobile_no",
			"source",
			"lead_activity_status",
			"lead_type",
			"direction_type",
			"industry",
		];

		const inverse_filters = ["category", "status"];
		const assigned_to = report.get_filter("assigned_to");

		if (inverse) {
			lead_filters.forEach(f => {
				const df = report.get_filter(f);
				if (df) $(df.wrapper).hide();
			});

			inverse_filters.forEach(f => {
				const df = report.get_filter(f);
				if (df) $(df.wrapper).show();
			});

			if (assigned_to) $(assigned_to.wrapper).show();

			const custom_option = report.get_filter("custom_created_at_option");
			if (custom_option) $(custom_option.wrapper).show();

			const custom_range = report.get_filter("custom_created_at");
			if (custom_range) $(custom_range.wrapper).show();
		} else {
			lead_filters.forEach(f => {
				const df = report.get_filter(f);
				if (df) $(df.wrapper).show();
			});

			inverse_filters.forEach(f => {
				const df = report.get_filter(f);
				if (df) $(df.wrapper).hide();
			});

			if (assigned_to) $(assigned_to.wrapper).hide();

			const custom_option = report.get_filter("custom_created_at_option");
			if (custom_option) {
				$(custom_option.wrapper).hide();
				custom_option.set_value("Custom");
			}

			const custom_range = report.get_filter("custom_created_at");
			if (custom_range) $(custom_range.wrapper).show();
		}
	}

	toggle_filters_visibility();

	const inverse_filter = report.get_filter("inverse_report");
	if (inverse_filter) {
		$(inverse_filter.input).on("change", toggle_filters_visibility);
	}
},

};

// Lead Activity Dialog
window.showFollowupDetails = function (lead_id) {
	frappe.call({
		method: "erp_dacsinc_custom.erp_dacsinc_custom.report.lead_report.lead_report.get_lead_activities_record",
		args: { lead_id: lead_id },
		callback: function (r) {
			if (r.message) {
				const dialog = new frappe.ui.Dialog({
					title: `Lead Activities for ${lead_id}`,
					fields: [
						{ fieldname: "lead_activities", fieldtype: "HTML", options: r.message },
					],
					size: "extra-large",
				});
				dialog.show();
			}
		},
	});
};

// Open Lead Activity Prompt for Category
window.openLeadActivityPrompt = function (custom_lead_category) {
	let filters = frappe.query_report.get_filter_values();
	frappe.call({
		method: "erp_dacsinc_custom.erp_dacsinc_custom.report.lead_report.lead_report.get_lead_activities",
		args: { custom_lead_category: custom_lead_category, filters: filters },
		callback: function (r) {
			if (r.message) {
				const dialog = new frappe.ui.Dialog({
					title: `Leads with category: ${custom_lead_category}`,
					fields: [
						{
							fieldname: "lead_activity_table",
							fieldtype: "HTML",
							options: r.message,
						},
					],
					size: "extra-large",
				});
				dialog.show();
			} else {
				frappe.msgprint("No records found for this category.");
			}
		},
	});
};

// // Create New Lead
// window.createNewLead = function(){
//     frappe.new_doc("Lead");
// }
