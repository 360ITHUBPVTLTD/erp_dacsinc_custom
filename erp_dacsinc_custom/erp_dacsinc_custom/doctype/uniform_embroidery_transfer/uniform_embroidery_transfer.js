// Copyright (c) 2026, Administrator and contributors
// For license information, please see license.txt

frappe.ui.form.on('Uniform Embroidery Transfer', {});

// "Same item": the line comes back as the plain item itself.
frappe.ui.form.on('Uniform Embroidery Transfer Item', {
    same_item(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (row.same_item && row.source_item) frappe.model.set_value(cdt, cdn, 'target_item', row.source_item);
    },
    source_item(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (row.same_item) frappe.model.set_value(cdt, cdn, 'target_item', row.source_item);
    },
});
