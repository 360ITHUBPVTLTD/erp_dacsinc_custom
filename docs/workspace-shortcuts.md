# Workspace shortcut counts

A workspace shortcut of type DocType can show a record count (the pill on the shortcut) when it has a
**count filter** (`stats_filter`). Frappe's `ShortcutWidget.set_actions` decides whether to count with
`frappe.utils.process_filter_expression(stats_filter)` — which returns `[]` for an empty filter, and `[]`
is truthy, so Frappe counts **every** DocType shortcut.

For a single-record DocType (GST Settings, GSTR-1 Beta, Purchase Reconciliation Tool, …) there is no
table, so the count request fails with `TableMissingError` and a popup appears each time the workspace
(e.g. GST India) opens.

`public/js/shortcut_count_fix.js` (app_include_js) replaces `frappe.widget.widget_factory.shortcut` with
a subclass whose `set_actions` hides the filter expression from that check when the shortcut has no
count filter. Shortcuts with a real count filter are counted as before; clicks and routes are unchanged.
It relies on `frappe.widget.widget_factory` (defined in Frappe's desk bundle, loaded before app
scripts) — re-check after a Frappe update, and drop it once Frappe stops counting unfiltered shortcuts.
