// Stock Entry › Stock Entry Type: the list offers the types the user's roles allow
// (stock_entry_types.allowed_types — e.g. a Merchandiser User only Send to Subcontractor,
// Material Transfer, Repack; Production Manager, Admin and any other role that makes Stock
// Entries: every type). Display only: no permission changes, and documents already made with
// another type open as before. docs/merchandiser-purchase.md.
(() => {
    let allowed;  // undefined = not asked yet; null = every type
    const load = () => {
        if (allowed === undefined) {
            allowed = frappe.xcall('erp_dacsinc_custom.stock_entry_types.allowed_types')
                .then((r) => (allowed = r || null))
                .catch(() => (allowed = null));
        }
        return Promise.resolve(allowed);
    };
    frappe.ui.form.on('Stock Entry', {
        setup(frm) {
            load().then((types) => {
                if (!types || !types.length) return;
                frm.set_query('stock_entry_type', () => ({ filters: { name: ['in', types] } }));
            });
        },
    });
})();
