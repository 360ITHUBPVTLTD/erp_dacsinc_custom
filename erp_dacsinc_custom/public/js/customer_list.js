// Adds "Assign Merchandiser" to the Customer list view — bulk-sets
// Customer.custom_merchandiser_user for every checked row. This is the exact
// field Merchandiser User's "own customers only" scoping is keyed off (see
// get_sales_order_permission_query_conditions / get_customer_permission_
// query_conditions in custom_script.py), so this is a genuine access-control
// action, not just a data edit — confirmed before it runs.

frappe.listview_settings['Customer'] = frappe.listview_settings['Customer'] || {};

(function () {
    const existing_onload = frappe.listview_settings['Customer'].onload;
    frappe.listview_settings['Customer'].onload = function (listview) {
        if (existing_onload) {
            try { existing_onload(listview); } catch (e) { /* keep ours working */ }
        }

        // Super Admin only.
        if (!frappe.user_roles.includes('Super Admin')) return;

        listview.page.add_action_item(__("Assign Merchandiser"), function () {
            const checked_items = listview.get_checked_items();
            if (!checked_items || checked_items.length === 0) return;
            const customers = checked_items.map((d) => d.name);

            const dialog = new frappe.ui.Dialog({
                title: __("Assign Merchandiser — {0} customer(s)", [customers.length]),
                fields: [
                    {
                        fieldname: "merchandiser_user",
                        fieldtype: "Link",
                        options: "User",
                        label: __("Merchandiser User"),
                        reqd: 1,
                        get_query: () => ({
                            query: "frappe.core.doctype.user.user.user_query",
                            filters: { role: "Merchandiser User" },
                        }),
                    },
                ],
                primary_action_label: __("Assign"),
                primary_action: (values) => {
                    frappe.confirm(
                        __("Set {0} as the Merchandiser for {1} customer(s)? This controls which Sales Orders and Customers they can see.", [
                            values.merchandiser_user, customers.length,
                        ]),
                        () => {
                            frappe.call({
                                method: "erp_dacsinc_custom.custom_script.bulk_assign_merchandiser",
                                args: { customers: customers, merchandiser_user: values.merchandiser_user },
                                freeze: true,
                                freeze_message: __("Assigning..."),
                                callback: (r) => {
                                    dialog.hide();
                                    if (!r.message) return;
                                    frappe.show_alert({
                                        message: __("Updated {0} customer(s)", [r.message.updated]),
                                        indicator: "green",
                                    });
                                    listview.refresh();
                                },
                            });
                        }
                    );
                },
            });
            dialog.show();
        });
    };
})();
