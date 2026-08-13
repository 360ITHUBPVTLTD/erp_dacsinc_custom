// frappe.query_reports["Lead Report"] = {
// 	filters: [
// 		{
// 			fieldname: "inverse_report",
// 			label: "Activity Report",
// 			fieldtype: "Check",
// 			default: 0,
// 			reqd: 0,
// 		},
// 		{
// 			fieldname: "custom_lead_category",
// 			label: "Lead Category",
// 			fieldtype: "Select",
// 			options: "\nEnquiry\nPipeline\nOrder\nLost Enquiry\nLost Pipeline",
// 			reqd: 0,
// 		},
// 		{
// 			fieldname: "mobile_no",
// 			label: "Mobile No",
// 			fieldtype: "Data",
// 			reqd: 0,
// 		},
// 		{
// 			fieldname: "source",
// 			label: "Source",
// 			fieldtype: "Link",
// 			options: "Lead Source",
// 			reqd: 0,
// 		},
// 		{
// 			fieldname: "lead_owner",
// 			label: "Lead Owner",
// 			fieldtype: "Link",
// 			options: "User",
// 			reqd: 0,
// 		},
// 		{
// 			fieldname: "assigned_to",
// 			label: "Assigned To",
// 			fieldtype: "Link",
// 			options: "User",
// 			reqd: 0,
// 		},
// 		{
// 			fieldname: "custom_created_at_option",
// 			label: "Created / Activity Date Filter",
// 			fieldtype: "Select",
// 			options: "\nToday\nUpcoming\nOverdue\nThis Month\nThis Week\nCustom",
// 			default: "Today",
// 			reqd: 0,
// 		},
// 		{
// 			fieldname: "custom_created_at",
// 			label: "Custom Date Range",
// 			fieldtype: "DateRange",
// 			reqd: 0,
// 		},
// 		{
// 			fieldname: "lead_activity_status",
// 			label: "Lead Activity Status",
// 			fieldtype: "Select",
// 			options: "\nWith Activity\nWithout Activity",
// 			reqd: 0,
// 		},
// 		{
// 			fieldname: "lead_type",
// 			label: "Lead Type",
// 			fieldtype: "Select",
// 			options: "\nHOT\nCOLD\nWARM",
// 			reqd: 0,
// 		},
// 		{
// 			fieldname: "direction_type",
// 			label: "Direction Type",
// 			fieldtype: "Select",
// 			options: "\nInbound\nOutbound",
// 			reqd: 0,
// 		},
// 		{
// 			fieldname: "industry",
// 			label: "Industry",
// 			fieldtype: "Link",
// 			options: "Industry Type",
// 			reqd: 0,
// 		},
// 		{
// 			fieldname: "category",
// 			label: "Activity Category",
// 			fieldtype: "Select",
// 			options:
// 				"\nInitial Call\nFollow up Call\nInitial Meeting\nFollow up meetings\nMeeting (Sample)\nProposal/Quotation\nOrder Closure",
// 			reqd: 0,
// 		},
// 		{
// 			fieldname: "status",
// 			label: "Activity Status",
// 			fieldtype: "Select",
// 			options: "\nOpen\nCompleted\nCancelled",
// 			default: "Open",
// 			reqd: 0,
// 		},
// 	],

// 	onload: function (report) {
// 	// Lead Owner Filter
// 	let lead_owner_filter = report.get_filter("lead_owner");
// 	let assigned_to_filter = report.get_filter("assigned_to");

// 	// Check if user is DAC CRM Head Head
// 	let is_crm_head = frappe.user.has_role("DAC CRM Head Head");

// 	if (!is_crm_head) {
// 		// For non-DAC CRM Head users → set session user as default and lock
// 		lead_owner_filter.set_value(frappe.session.user);
// 		$(lead_owner_filter.$input).attr("disabled", true);

// 		assigned_to_filter.set_value(frappe.session.user);
// 		$(assigned_to_filter.$input).attr("disabled", true);
// 	} else {
// 		// For DAC CRM Head → keep empty and editable
// 		$(lead_owner_filter.$input).attr("disabled", false);
// 		$(assigned_to_filter.$input).attr("disabled", false);
// 	}

// 	function toggle_filters_visibility() {
// 		const inverse = report.get_filter_value("inverse_report");

// 		const lead_filters = [
// 			"custom_lead_category",
// 			"lead_owner",
// 			"mobile_no",
// 			"source",
// 			"lead_activity_status",
// 			"lead_type",
// 			"direction_type",
// 			"industry",
// 		];

// 		const inverse_filters = ["category", "status"];
// 		const assigned_to = report.get_filter("assigned_to");

// 		if (inverse) {
// 			lead_filters.forEach(f => {
// 				const df = report.get_filter(f);
// 				if (df) $(df.wrapper).hide();
// 			});

// 			inverse_filters.forEach(f => {
// 				const df = report.get_filter(f);
// 				if (df) $(df.wrapper).show();
// 			});

// 			if (assigned_to) $(assigned_to.wrapper).show();

// 			const custom_option = report.get_filter("custom_created_at_option");
// 			if (custom_option) $(custom_option.wrapper).show();

// 			const custom_range = report.get_filter("custom_created_at");
// 			if (custom_range) $(custom_range.wrapper).show();
// 		} else {
// 			lead_filters.forEach(f => {
// 				const df = report.get_filter(f);
// 				if (df) $(df.wrapper).show();
// 			});

// 			inverse_filters.forEach(f => {
// 				const df = report.get_filter(f);
// 				if (df) $(df.wrapper).hide();
// 			});

// 			if (assigned_to) $(assigned_to.wrapper).hide();

// 			const custom_option = report.get_filter("custom_created_at_option");
// 			if (custom_option) {
// 				$(custom_option.wrapper).hide();
// 				custom_option.set_value("Custom");
// 			}

// 			const custom_range = report.get_filter("custom_created_at");
// 			if (custom_range) $(custom_range.wrapper).show();
// 		}
// 	}

// 	toggle_filters_visibility();

// 	const inverse_filter = report.get_filter("inverse_report");
// 	if (inverse_filter) {
// 		$(inverse_filter.input).on("change", toggle_filters_visibility);
// 	}
// },

// };

// // Lead Activity Dialog
// window.showFollowupDetails = function (lead_id) {
// 	frappe.call({
// 		method: "erp_dacsinc_custom.erp_dacsinc_custom.report.lead_report.lead_report.get_lead_activities_record",
// 		args: { lead_id: lead_id },
// 		callback: function (r) {
// 			if (r.message) {
// 				const dialog = new frappe.ui.Dialog({
// 					title: `Lead Activities for ${lead_id}`,
// 					fields: [
// 						{ fieldname: "lead_activities", fieldtype: "HTML", options: r.message },
// 					],
// 					size: "extra-large",
// 				});
// 				dialog.show();
// 			}
// 		},
// 	});
// };

// // Open Lead Activity Prompt for Category
// window.openLeadActivityPrompt = function (custom_lead_category) {
// 	let filters = frappe.query_report.get_filter_values();
// 	frappe.call({
// 		method: "erp_dacsinc_custom.erp_dacsinc_custom.report.lead_report.lead_report.get_lead_activities",
// 		args: { custom_lead_category: custom_lead_category, filters: filters },
// 		callback: function (r) {
// 			if (r.message) {
// 				const dialog = new frappe.ui.Dialog({
// 					title: `Leads with category: ${custom_lead_category}`,
// 					fields: [
// 						{
// 							fieldname: "lead_activity_table",
// 							fieldtype: "HTML",
// 							options: r.message,
// 						},
// 					],
// 					size: "extra-large",
// 				});
// 				dialog.show();
// 			} else {
// 				frappe.msgprint("No records found for this category.");
// 			}
// 		},
// 	});
// };

frappe.query_reports["Lead Report"] = {
	filters: [
		{
			fieldname: "inverse_report",
			label: __("Activity Report"),
			fieldtype: "Check",
			on_change: function () {
				// 1. Force mutual exclusivity
				if (frappe.query_report.get_filter_value("inverse_report")) {
					frappe.query_report.set_filter_value("show_business_contacts", 0);
				}
				// 2. Reset other filters
				if (frappe.query_report.reset_view_filters) {
					frappe.query_report.reset_view_filters();
				}
				// 3. Update visible filters UI
				if (frappe.query_report.update_view_ui) {
					frappe.query_report.update_view_ui();
				}
				// 4. Trigger Full Report Refresh (Forces Python get_columns to run)
				frappe.query_report.refresh();
			}
		},
		{
			fieldname: "show_business_contacts",
			label: __("Show Business Contacts"),
			fieldtype: "Check",
			on_change: function () {
				// 1. Force mutual exclusivity
				if (frappe.query_report.get_filter_value("show_business_contacts")) {
					frappe.query_report.set_filter_value("inverse_report", 0);
				}
				// 2. Reset other filters
				if (frappe.query_report.reset_view_filters) {
					frappe.query_report.reset_view_filters();
				}
				// 3. Update visible filters UI
				if (frappe.query_report.update_view_ui) {
					frappe.query_report.update_view_ui();
				}
				// 4. Trigger Full Report Refresh (Forces Python get_columns to run)
				frappe.query_report.refresh();
			}
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
			label: "Assign To",
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
			// default: "Today",
			reqd: 0,
			on_change: function () {
				if (frappe.query_report.update_view_ui) {
					frappe.query_report.update_view_ui();
				}
				frappe.query_report.refresh();
			}
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
			label: "Type",
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
		// Permissions for lockdown
		let is_privileged = frappe.user.has_role("DAC CRM Head") || frappe.user.has_role("Administrator");
		if (!is_privileged) {
			report.get_filter("lead_owner").set_value(frappe.session.user);
			$(report.get_filter("lead_owner").$input).attr("disabled", true);
		}

		// RESET FILTERS ON VIEW SWITCH
		report.reset_view_filters = function () {
			const filters_to_reset = [
				"custom_lead_category",
				"mobile_no",
				"source",
				"assigned_to",
				"custom_created_at_option",
				"custom_created_at",
				"lead_activity_status",
				"lead_type",
				"direction_type",
				"industry",
				"category",
				"status"
			];

			filters_to_reset.forEach(f => {
				let filter = report.get_filter(f);
				if (filter) {
					let default_val = "";
					if (f === "status") {
						default_val = "Open";
					} else if (f === "custom_created_at_option") {
						default_val = "Today";
					}
					if (filter.get_value() !== default_val) {
						report.set_filter_value(f, default_val);
					}
				}
			});

			let owner_filter = report.get_filter("lead_owner");
			if (owner_filter) {
				let default_owner = is_privileged ? "" : frappe.session.user;
				if (owner_filter.get_value() !== default_owner) {
					report.set_filter_value("lead_owner", default_owner);
				}
			}
		};

		// CENTRALIZED LOGIC FUNCTION FOR UI VIEW UPDATES
		report.update_view_ui = function () {
			const is_act = report.get_filter_value("inverse_report");
			const is_bc = report.get_filter_value("show_business_contacts");

			const lead_fields = ["custom_lead_category", "mobile_no", "lead_activity_status", "direction_type"];
			const act_fields = ["category", "status", "assigned_to", "custom_created_at_option"];
			const common_fields = ["source", "industry", "lead_owner", "lead_type"];

			if (is_bc) {
				// --- View 1: Business Contacts ---
				// Hide non-applicable fields
				lead_fields.concat(act_fields).forEach(f => {
					let filter = report.get_filter(f);
					if (filter) $(filter.wrapper).hide();
				});

				// Show applicable fields
				common_fields.forEach(f => {
					let filter = report.get_filter(f);
					if (filter) $(filter.wrapper).show();
				});

				// Business Contacts always show custom_created_at (which is custom date range)
				let date_filter = report.get_filter("custom_created_at");
				if (date_filter) $(date_filter.wrapper).show();

			} else if (is_act) {
				// --- View 2: Activity Report ---
				// Hide lead and common fields
				lead_fields.concat(common_fields).forEach(f => {
					let filter = report.get_filter(f);
					if (filter) $(filter.wrapper).hide();
				});

				// Show activity fields only
				act_fields.forEach(f => {
					let filter = report.get_filter(f);
					if (filter) $(filter.wrapper).show();
				});

				// Show custom date range filter only when "Custom" option is selected
				const date_option = report.get_filter_value("custom_created_at_option");
				let date_filter = report.get_filter("custom_created_at");
				if (date_filter) {
					if (date_option === "Custom") {
						$(date_filter.wrapper).show();
					} else {
						$(date_filter.wrapper).hide();
					}
				}

			} else {
				// --- View 3: Normal Lead Report (Default) ---
				// Hide activity fields
				act_fields.forEach(f => {
					let filter = report.get_filter(f);
					if (filter) $(filter.wrapper).hide();
				});

				// Show lead and common fields
				lead_fields.concat(common_fields).forEach(f => {
					let filter = report.get_filter(f);
					if (filter) $(filter.wrapper).show();
				});

				// Normal Lead Report always shows custom_created_at
				let date_filter = report.get_filter("custom_created_at");
				if (date_filter) $(date_filter.wrapper).show();
			}
		};

		// Initial setup
		report.update_view_ui();
	}
};
// --- Global Window Functions ---

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