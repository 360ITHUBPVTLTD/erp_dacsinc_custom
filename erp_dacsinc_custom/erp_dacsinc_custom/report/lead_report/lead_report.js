frappe.query_reports["Lead Report"] = {
    "filters": [
        {
            "fieldname": "inverse_report",
            "label": "Inverse Activity Report",
            "fieldtype": "Check",
            "default": 0,
            "reqd": 0
        },
        {
            "fieldname": "custom_lead_category",
            "label": "Lead Category",
            "fieldtype": "Select",
            "options": "\nEnquiry\nPipeline\nOrder\nLost Enquiry\nLost Pipeline",
            "reqd": 0
        },
        {
            "fieldname": "mobile_no",
            "label": "Mobile No",
            "fieldtype": "Data",
            "reqd": 0
        },
        {
            "fieldname": "source",
            "label": "Source",
            "fieldtype": "Link",
            "options": "Lead Source",
            "reqd": 0
        },
        {
            "fieldname": "lead_owner",
            "label": "Lead Owner",
            "fieldtype": "Link",
            "options": "User",
            "reqd": 0
        },
		{
			"fieldname": "assigned_to",
			"label": "Assigned To",
			"fieldtype": "Link",
			"options": "User",
			"reqd": 0	
		},
        {
            "fieldname": "custom_created_at_option",
            "label": "Created / Activity Date Filter",
            "fieldtype": "Select",
            "options": "\nToday\nUpcoming\nOverdue\nThis Month\nThis Week\nCustom",
            "default": "Today",
            "reqd": 0
        },
        {
            "fieldname": "custom_created_at",
            "label": "Custom Date Range",
            "fieldtype": "DateRange",
            "reqd": 0
        },
        {
            "fieldname": "lead_activity_status",
            "label": "Lead Activity Status",
            "fieldtype": "Select",
            "options": "\nWith Activity\nWithout Activity",
            "reqd": 0
        },
        {
            "fieldname": "lead_type",
            "label": "Lead Type",
            "fieldtype": "Select",
            "options": "\nHOT\nCOLD\nWARM",
            "reqd": 0
        },
        {
            "fieldname": "direction_type",
            "label": "Direction Type",
            "fieldtype": "Select",
            "options": "\nInbound\nOutbound",
            "reqd": 0
        },
        {
            "fieldname": "industry",
            "label": "Industry",
            "fieldtype": "Link",
            "options": "Industry Type",
            "reqd": 0
        },
        {
            "fieldname": "category",
            "label": "Activity Category",
            "fieldtype": "Select",
            "options": "\nInitial Call\nFollow up Call\nInitial Meeting\nFollow up meetings\nMeeting (Sample)\nProposal/Quotation\nOrder Closure",
            "reqd": 0
        },
        {
            "fieldname": "status",
            "label": "Activity Status",
            "fieldtype": "Select",
            "options": "\nOpen\nCompleted\nCancelled",
            "default": "Open",
            "reqd": 0
        },
    ],

    onload: function(report) {
    function toggle_filters_visibility() {
        const inverse = report.get_filter_value('inverse_report');

        // Lead related filters (should always remain visible)
        const lead_filters = ["custom_lead_category","lead_owner","mobile_no","source","lead_activity_status","lead_type","direction_type","industry"];

        // Inverse filters (only for inverse report)
        const inverse_filters = ["category", "status"];

        if (inverse) {
            // Show all lead filters
            lead_filters.forEach(f => {
                const df = report.get_filter(f);
                if(df) $(df.wrapper).hide();
            });
            // Show inverse filters
            inverse_filters.forEach(f => {
                const df = report.get_filter(f);
                if(df) $(df.wrapper).show();
            });

            // Show custom_created_at_option
            const custom_option = report.get_filter('custom_created_at_option');
            if(custom_option) $(custom_option.wrapper).show();

            // Always show custom_created_at range too
            const custom_range = report.get_filter('custom_created_at');
            if(custom_range) $(custom_range.wrapper).show();

        } else {
            // Show all lead filters (do not hide them!)
            lead_filters.forEach(f => {
                const df = report.get_filter(f);
                if(df) $(df.wrapper).show();
            });
            // Hide inverse filters
            inverse_filters.forEach(f => {
                const df = report.get_filter(f);
                if(df) $(df.wrapper).hide();
            });

            // Hide custom_created_at_option and force as "Custom"
            const custom_option = report.get_filter('custom_created_at_option');
            if(custom_option) {
                $(custom_option.wrapper).hide();
                $(custom_option.input).val('Custom'); // force value
            }

            // Show only custom_created_at
            const custom_range = report.get_filter('custom_created_at');
            if(custom_range) $(custom_range.wrapper).show();
        }
    }

    toggle_filters_visibility();

    const inverse_filter = report.get_filter('inverse_report');
    if (inverse_filter) {
        $(inverse_filter.input).on('change', toggle_filters_visibility);
    }
}

};

// Lead Activity Dialog
window.showFollowupDetails = function(lead_id){
    frappe.call({
        method: "erp_dacsinc_custom.erp_dacsinc_custom.report.lead_report.lead_report.get_lead_activities_record",
        args: { lead_id: lead_id },
        callback: function(r){
            if(r.message){
                const dialog = new frappe.ui.Dialog({
                    title: `Lead Activities for ${lead_id}`,
                    fields: [
                        { fieldname:"lead_activities", fieldtype:"HTML", options:r.message }
                    ],
                    size:"extra-large"
                });
                dialog.show();
            }
        }
    });
}

// Open Lead Activity Prompt for Category
window.openLeadActivityPrompt = function(custom_lead_category){
    let filters = frappe.query_report.get_filter_values();
    frappe.call({
        method: "erp_dacsinc_custom.erp_dacsinc_custom.report.lead_report.lead_report.get_lead_activities",
        args: { custom_lead_category: custom_lead_category, filters: filters },
        callback: function(r){
            if(r.message){
                const dialog = new frappe.ui.Dialog({
                    title: `Leads with category: ${custom_lead_category}`,
                    fields: [{ fieldname:"lead_activity_table", fieldtype:"HTML", options:r.message }],
                    size:"extra-large"
                });
                dialog.show();
            } else {
                frappe.msgprint("No records found for this category.");
            }
        }
    });
}

// // Create New Lead
// window.createNewLead = function(){
//     frappe.new_doc("Lead");
// }
