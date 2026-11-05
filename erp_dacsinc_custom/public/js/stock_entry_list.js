// Stock Entry list: no "Add Stock Entry" for a Merchandiser User (docs/merchandiser-purchase.md).
// They only make jobber transfers of their own orders, from the Subcontracting Order / Order Flow.
// Same "merchandiser" test as sales_order.js so_is_scoped_merchandiser: Administrator, System
// Manager, Super Admin and Admin keep the button. ERPNext's own list settings are kept (wrapped).
(() => {
    const is_merchandiser = () => {
        const r = frappe.user_roles || [];
        return r.includes('Merchandiser User') && frappe.session.user !== 'Administrator'
            && !['System Manager', 'Super Admin', 'Admin'].some((x) => r.includes(x));
    };
    const settings = (frappe.listview_settings['Stock Entry'] = frappe.listview_settings['Stock Entry'] || {});
    const base_onload = settings.onload;
    settings.onload = function (listview) {
        if (base_onload) base_onload.apply(this, arguments);
        if (!is_merchandiser()) return;
        listview.can_create = false;            // set_primary_action skips it, also after a selection is cleared
        listview.page.clear_primary_action();
    };
})();
