// Payment Entry: Mode of Payment offers only the modes ticked "Show in Payment Entry"
// (payment_modes.py) — the POS counter / store modes stay out.
frappe.ui.form.on('Payment Entry', {
    setup(frm) {
        frm.set_query('mode_of_payment', () => ({
            filters: { enabled: 1, custom_show_in_payment_entry: 1 },
        }));
    },
});
