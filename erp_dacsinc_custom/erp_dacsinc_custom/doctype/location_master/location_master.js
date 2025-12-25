frappe.ui.form.on('Location Master', {
    refresh: function(frm) {
        frm.add_custom_button(__('Sync All Countries & Cities'), function() {
            frappe.confirm(
                'This will fetch data for all countries in the world. It will run in the background and take a long time. Proceed?',
                function() {
                    frappe.call({
                        method: "erp_dacsinc_custom.erp_dacsinc_custom.doctype.location_master.location_master.start_global_sync",
                        callback: function(r) {
                            if (r.message) {
                                frappe.msgprint(r.message);
                                // Start a timer to refresh the form every 10 seconds to show status
                                setInterval(() => { frm.reload_doc(); }, 10000);
                            }
                        }
                    });
                }
            );
        }).addClass('btn-primary');
    }
});