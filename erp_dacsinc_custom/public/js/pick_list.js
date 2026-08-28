// Reducing "Picked Qty" below what this row was allocated for its own
// Sales Order leaves that difference in the shared stock pool — any OTHER
// Sales Order line for the same item + warehouse can pick it from here on.
// That's often exactly the intent (deliberately handing spare stock to
// another order), but it happens silently otherwise: nothing on this form
// says the leftover is now up for grabs. Purely informational — never
// blocks the edit — the Item Stock & Action Plan's own "Picked (Others)"
// column is what actually shows it happening once another order claims it.
frappe.ui.form.on("Pick List Item", {
    picked_qty(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (!row.sales_order || !row.item_code) return;

        const allocated = flt(row.qty);
        const picked = flt(row.picked_qty);
        const leftover = allocated - picked;

        if (leftover > 0.001) {
            frappe.show_alert({
                message: __(
                    "{0} {1} of {2} left unpicked for {3} — becomes available for other Sales Orders needing the same item in {4} to pick.",
                    [leftover.toFixed(2), row.stock_uom || row.uom || "", frappe.utils.escape_html(row.item_code),
                        frappe.utils.escape_html(row.sales_order), frappe.utils.escape_html(row.warehouse || "")]
                ),
                indicator: "orange"
            }, 9);
        }
    }
});
