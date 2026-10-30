# Item barcode: the Barcode field and the Barcodes table

An Item has a **Barcode** field (`custom_barcode`, what people type) and ERPNext's **Barcodes**
table (Item Barcode: what scanning, POS and label printing read). `item_barcode.before_validate`
keeps them in step on every save — before ERPNext's own `validate_barcode`, so the table is
already right when ERPNext checks it, and the row is saved with the item.

| What the user does | Result |
| --- | --- |
| types / changes the Barcode | its row is in the table; the old value's row is removed |
| clears the Barcode | the old value's row is removed |
| deletes the row in the table, Barcode untouched | the Barcode follows the table (next barcode in it, or empty) |
| saves an item whose Barcode never got a row | the row is added |
| adds more barcodes by hand in the table | kept — only the Barcode field's own row is ever added / removed |
| any save | the Barcode field's row first, the rest in the order added, numbered 1, 2, 3… (removing and appending rows left two rows with the same No.) |
| leaves a Barcodes row blank (Add Row, or the grid adding one) | dropped when saving (`item.js` validate) — this Frappe keeps blank rows, and its browser check ("Mandatory fields required in table Barcodes, Row N") runs before any server code |

**Type:** CODE-39 only when the value is valid CODE-39 (capitals, digits, space `- . $ / + %`,
checked with `barcodenumber`, as ERPNext does); otherwise no type. ERPNext refuses a save when a
row's type doesn't fit its value ("Barcode 234eas is not a valid CODE-39 code"), and the old hook
set CODE-39 on everything — lowercase barcodes blocked the item. Any row typed CODE-39 that isn't
valid CODE-39 loses the type on save. Scanning doesn't use the type.

**Duplicates:** entering or changing a Barcode that another item already has is refused. An item
already loaded with another item's barcode still saves (an orange note says so) and the barcode
stays out of its table until one of the two is changed — otherwise every edit of that item failed.

**Why it moved:** the old `custom_script.update_barcode_child` ran on `after_insert` / `on_update`,
after the save, so the row it appended was never stored (local, 30-10-2026: 379 items with a
Barcode and no row — 161 to fill, 216 whose barcode is on another item). `item_barcode.missing_rows()`
lists them; `missing_rows(fix=True)` adds the row to the fill ones (Item Barcode rows only, no item
save, a dated comment on each item). Duplicates are listed only: which item keeps the barcode is the client's call.
