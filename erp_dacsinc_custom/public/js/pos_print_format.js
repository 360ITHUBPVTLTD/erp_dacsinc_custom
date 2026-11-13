// Print view (/app/print/POS Invoice/…): a POS Invoice opens in the print format set on its own POS Profile
// (VV Puram → its format, Rajajinagar → its format …), wherever the print was started — form Print / Ctrl+P,
// a print link. Frappe kept whichever format was picked last, even for another store's bill, or fell back
// to the one POS Invoice default. The user can still pick another format in the selector.
// Other doctypes are untouched. Server side: pos_print.get_pos_print_format. docs/pos-store-scope.md.
(() => {
    const PV = frappe.ui.form.PrintView;
    if (!PV || PV.prototype.__pos_profile_print_format) return;
    PV.prototype.__pos_profile_print_format = true;
    const original = PV.prototype.set_default_print_format;

    PV.prototype.set_default_print_format = function () {
        const frm = this.frm;
        if (!frm || frm.doctype !== 'POS Invoice' || !frm.doc || !frm.doc.pos_profile || frm.doc.__islocal) {
            return original.apply(this, arguments);
        }
        return frappe.call({
            method: 'erp_dacsinc_custom.pos_print.get_pos_print_format',
            args: { pos_invoice: frm.doc.name },
        }).then((r) => {
            const pf = (r && r.message) || '';
            if (pf && frappe.meta.get_print_formats('POS Invoice').includes(pf)) {
                this.print_format_selector.val(pf);
            } else {
                original.apply(this);
            }
        }, () => original.apply(this));
    };
})();
