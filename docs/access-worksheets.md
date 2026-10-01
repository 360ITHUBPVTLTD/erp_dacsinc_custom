# Access worksheets (/roles-and-permissions)

The page `www/roles-and-permissions.html` (controller `www/roles_and_permissions.py`) is
client-facing. The roles are `WS_ROLES` (Admin excluded) and the documents are
`DT_GROUPS`. It has two tabs (the URL hash remembers which one):

- **Agreed access** (`#agreed-docs`, `#agreed-tabs`): the two decided sheets, as
  sub-tabs.
  - **Document access** (`#decided-docs`).
  - **Order Flow dashboard** (`#decided-tabs`).
- **Blank worksheets** (`#blank`): the two paper sheets, with Download PDF / Print.
  - Order Flow tabs → `public/docs/tab-access-worksheet.pdf`.
  - Document access → `public/docs/document-access-worksheet.pdf`.

## Decided sheets

- **Document Access**: each cell holds six boxes: V view, E create & edit, S submit,
  C cancel, D delete, O only own records. S and C are shaded (not possible) on
  documents that are never submitted. Clicking a box toggles it. Unticking V clears
  the whole cell, and ticking any other box also ticks V.
- The starting point is `DA_CLIENT`, the client's hand-marked sheet from 28 Sep 2026,
  typed in. It was read like this:
  - A cell struck through with lines, or one big X over the whole cell = no access,
    even where V itself is untouched.
  - A crossed single box = that box is not allowed. Blank or ✓ = allowed.
  - A **pencil** tick = give it; pencil overrides the ink strikes.
  - O counts only where it was ticked or circled.
  - Cells that differ from the client's sheet get a blue ring.
  - "Reset to client's sheet" puts every cell back to `DA_CLIENT`.
- **Order Flow tabs**: each cell cycles hidden → ✓ (can see) → A (can see and act).
  Turning on a sub-tab also turns on its main tab, and hiding a main tab hides its
  sub-tabs.
  - The tab sheet follows the documents: a role sees a tab only if it can view that
    tab's documents (`TAB_DOCS`, tab → documents it shows). It gets ✓ for view, and A
    if it can create or submit them. SO Approvals is the exception: A only with
    Submit on Sales Order, since approving is submitting.
  - Until the tab sheet is saved, it is filled this way automatically (shown as
    unsaved changes) and keeps following the Document Access sheet, live, until a
    tab cell is changed by hand. "Suggest from Document Access" refills it and makes
    it follow again.
- Both decided sheets scroll inside their own frame. The role names stay on top,
  the document / tab names stay on the left, and hovering a cell lights up its row
  and role column with a "Role · Document" tip.
- Confirmations use a dialog (`askConfirm`):
  - Granting **Delete** or **Cancel**.
  - Removing View (which removes every right on that document).
  - Discard.
  - **Save**: lists every change (role · document: + / − rights) and the version
    number it will become.
- **Resets are System Manager only** and need the word typed into the dialog:
  - Add document… and removing an added one (REMOVE), Sync from ERP (SYNC), Restore
    marked worksheet (RESTORE), Refill from document access (REFILL), Clear all
    (CLEAR);
  - Apply to the ERP (APPLY) and Reset profiles (RESET).

  For everyone else the reset buttons are greyed out ("System Manager only"), and
  Apply / Reset profiles aren't shown. The server enforces the same rule
  (`access_worksheet.RESET_ROLE`):
  - A save that follows a restore, refill or clear carries `reset=<kind>`, and only
    System Manager may make it. The version's note records the reset.
  - `activate`, `reset_profiles` and `get_activation_preview` require System Manager.

  Editing cells and saving stays with the Admin role.
- Print / PDF prints only that sheet (A4 landscape), with its legend and signature
  lines.

## Storage and rights

`access_worksheet.py` keeps one JSON blob per sheet (`doc_access`, `tab_access`) in
a `DefaultValue` row under parent `__dacsinc_access_ws`, so no migration is needed.

- **Only Admin, System Manager and Administrator can open the page** or read the
  saved sheets (`access_worksheet.VIEW_ROLES`, `can_view`; the page's
  `get_context` and `get_saved`).
  - A guest is sent to the login page.
  - Anyone else gets "not permitted".
- Only the **Admin** role can edit and save (`save_sheet`, POST with a CSRF token). Resets
  need System Manager (above).
- Values are validated against the allowed letters.
- Each save carries the version it was edited from, and it's refused if someone else
  saved in between ("reload, then edit again").

## Saving applies the access (`access_sync.py`)

Once the site is switched on (below), saving a sheet applies it in the same transaction; if applying fails, nothing is saved.

- **Document access** → Custom DocPerm for the sheet roles on the sheet documents.
  - The sheet row is exact: V = read, select, print, email, report, export; E = write,
    create; S = submit; C = cancel, amend; D = delete; O = if_owner.
    "Contact & Address" covers both Contact and Address.
  - Other roles' rows are never touched, and no role is deleted. HR Manager and the
    like stay manual.
- **Dependencies**, so creating never hits "no permission":
  - A role that may create/edit a document gets Read + Select on everything linked
    from it, child tables included.
  - On another *sheet* document it gets only Select, plus Read where the form fetches
    from it (fetch_from), or displays it: Address and Contact (`DISPLAY_READ`), since
    forms load the company's and the party's address and contact. This is read on
    all records, never edit. The sheet stays the decision there.
  - Masters the role may edit (Item, Customer, Supplier, Lead…) pass edit on to their
    setup masters (Brand, Item Group, UOM, Customer Group, Territory…). Company,
    Currency, Price List, Account, Cost Center and similar only ever get Read.
  - Dependency grants only add. What they added is tracked in DefaultValue
    `derived_applied`, and only that is taken back later, so hand-made rules (e.g.
    Merchandiser User's own-customer scoping and HR rows) stay.
- **Companion standard roles** (`COMPANIONS`). ERPNext screens rely on what its
  standard roles can read. A sheet role that may view a group's documents gets the
  **read-only** part of the matching standard role:
  - Sales User: selling / CRM / POS documents;
  - Stock User: stock documents;
  - Purchase User: purchase / subcontracting documents;
  - Accounts User: Sales Invoice / Payment / Journal;
  - Manufacturing User: BOM;
  - POS User: POS documents.

  That means read / select / report on the doctypes that role reads (settings,
  Price List, Bin, ledgers, masters). It never touches the sheet's own documents,
  and skips the HR / framework modules. The reports and desk pages that role may
  open come too. Every sheet role also reads Page and the Selling / Stock / Buying /
  Accounts / POS Settings and Global Defaults. So removing Sales User etc. from the
  profiles doesn't break screens.
- **Reports and desk pages** (Point of Sale, Stock Balance, Warehouse Capacity
  Summary, BOM Comparison Tool, Sales Funnel) open through their **Custom Role**,
  Frappe's own override that migrate doesn't reset.
  - A report's Custom Role replaces its own role list, so the report's own roles
    are always kept in it.
  - A page's Custom Role is added to its own roles for opening it. But the desk's list
    of pages a user can open (sidebar, search, workspace shortcuts) uses **only** the
    Custom Role once one exists, so the page's own roles are always copied into it.
    Page / Report `on_update` hooks re-copy them when someone edits a page's or
    report's roles by hand. Roles a page lists that don't exist on the site are
    skipped.
  - POS Admin / POS Store Manager are not given Query / Script reports on Material
    Request, Sales Invoice or Customer. Their SQL would show every record, past the
    POS record scope (`docs/pos-store-scope.md`). This also removes the POS roles
    from such reports when someone put them on the report itself.
  - Point of Sale, Stock Balance and the other PAGE_DOCS pages follow only their own
    documents (Point of Sale → POS Invoice), not the companion roles.
  - Tracked in DefaultValue `report_custom_roles:*` / `page_custom_roles`. Tracking
    maps are stored one row per entry, since a row holds at most 64 KB.
- **Order Flow tabs** → Admin Settings › Order Flow.
  - Each main tab gets `of_tab_<tab>_roles`, and each sub-tab gets
    `of_sub_<tab>_<key>_roles` (section "Sub-tab Visibility"). ✓ and A both list
    the role there.
  - A also lists it in `of_tab_<tab>_act_roles` / `of_sub_<tab>_<key>_act_roles`
    (sections "Tab Actions" / "Sub-tab Actions").
    `order_flow_permissions.can_act_tab` decides who may use a tab's create /
    submit / approve buttons. The page hides them for ✓-only roles, and
    `guard_act` refuses the server calls.
  - Rules for the act lists:
    - A role on an act list also sees the tab.
    - A sub-tab without its own act list follows its tab's.
    - An empty act list lets everyone who sees the tab act (as before the lists
      existed).
    - Admins always may act.
  - When act lists are first filled, other (non-sheet) roles that already saw a tab
    are put on its act list too, so they keep acting as before.
  - Only the sheet roles are managed there. Any other role already on a tab (Sales
    User, Accounts Team, Inward Team…) is kept, so users not yet moved to a sheet
    role don't lose the dashboard.
  - A tab nobody may see gets `Admin`, so it counts as configured.
  - POS Admin / POS Store Manager get no Order Flow tabs (`NO_ORDER_FLOW_ROLES`, also
    in the page's refill). The dashboard is built on Sales Orders, which they can't
    read, so every tab would fail for them. They work from the POS screen and the MR /
    Stock Entry lists.
  - `order_flow_permissions.get_allowed_subtabs()` feeds the page's `allowed_subtabs`,
    and the page hides the other sub-tab buttons.
- In developer mode a save also rewrites `access/agreed_access.json` (the bundle
  shipped to other sites).

## Role Permission Manager → sheet (`access_reverse.py`)

The sheet also follows changes made in Frappe's Role Permission Manager, so the two
never disagree.

- **What's caught:** Role Permission Manager's `add` / `update` / `remove` / `reset`
  are wrapped (`override_whitelisted_methods`). `update` writes with `db.set_value`,
  which fires no document events. Custom DocPerm insert / update / delete events catch
  other editors. Only sheet roles on sheet documents are followed, and only while
  the sheet is switched on.
- **Reading back:** each role's permission-level-0 rows on that document are turned
  back into letters, combining a role's rows as Frappe does:
  - V = read, E = write or create, S = submit, C = cancel, D = delete;
  - O when only the "Only if creator" row has rights.

  Read / Select that the sheet itself adds for linked documents (Address, Contact,
  fetched masters) is not read back as V unless Print / Email / Report / Export are
  on too. A no-op read-back over every sheet document changes nothing (tested).
- **When a cell changes:**
  - A new sheet version is stored, with the note "Role Permission Manager · <user>:
    <role> · <document>: <old> → <new>".
  - In developer mode the bundle is rewritten, so the next push carries the change to
    live.
  - The Document access sheet is re-applied in a background job (`queue="short"`,
    deduplicated) so linked-document rights and reports follow. This also normalises
    the rows: E = write + create, V = its whole set.
- **Not a sheet change:** a tweak that doesn't change a letter (e.g. unticking only
  Export) is left alone until the sheet is next applied, which restores the letter's
  full set.
- The sheet's own apply sets `frappe.flags.dacs_access_applying`, so its writes are
  never read back.
- **Sync from ERP** (Document access bar, System Manager, typed SYNC; `sync_from_erp`):
  - Reads every cell back at once and lists each change (role · document: old →
    new) before anything is saved.
  - Confirming records them as one version ("Sync from ERP · <user>: …"). It's
    refused if the sheet was saved after the preview.
  - Needs the page's own changes saved or discarded first.
  - For rights changed where nothing notices (SQL, Data Import, before this
    existed).
- **Adding a document** (Document access bar, "Add document…", System Manager;
  `add_sheet_document`):
  - Choose any main document type (not child tables, singles, or framework
    modules) and a group.
  - Its row starts from what each role can do on it in the ERP today, every right
    counted, so nobody loses one. The dialog shows that row before it's recorded.
  - From then on the sheet decides it like any other row (applied, followed from
    Role Permission Manager, included in Sync from ERP).
  - Added documents are kept in the sheet (`added`: document → group, submittable),
    so the bundle carries them to live. The bundle fingerprint includes them.
  - A save from a page that doesn't show the row keeps it.
  - "Restore marked worksheet" leaves added rows as they are, since they weren't on
    the paper sheet.
  - An added row has "added" and × next to its name. × takes it off the sheet
    (typed REMOVE; `remove_sheet_document`). Roles keep their rights on it, and the
    sheet just stops deciding them. Built-in rows can't be removed.
  - The blank PDF worksheets list only the built-in documents.
- Customer, Supplier and Item Price are protected masters: there, V gives Read +
  Select only (Print / Email / Report / Export stay with Accounts), and roles
  without V are pick-only. See `docs/master-data-protection.md`.
- Record-level rules in code (a Merchandiser's own customers, POS store scope,
  `permission_query_conditions` / `has_permission`) are not sheet cells. The page
  says so under the sheet.
- **▸ on a document** (Document access) opens its permissions as tick boxes inside
  the sheet, as in Role Permission Manager. There are 15 rows (Select, Read, Write,
  Create, Delete, Submit, Cancel, Amend, Print, Email, Report, Export, Import, Share,
  Only If Creator) with a box under each role column, read from the ERP
  (`access_sync.sheet_rights`, `rows=`). "Show all tick boxes" opens every document.
  - A box shows the ERP's right today. On a cell with an unsaved change it shows
    what Save will give, outlined blue.
  - Yellow = the ERP differs from the sheet. A grey tick = needed to pick it in
    linked documents. Greyed boxes can't be ticked (hover says why: never
    submitted, master data, Import / Share only in Role Permission Manager).
  - Ticking switches the letter that gives it, so its set follows (V = Select,
    Read, Print, Email, Report, Export · E = Create, Write · C = Cancel, Amend).
  - Rows follow the document: one that is never submitted has no Submit / Cancel /
    Amend rows. The ⋯ panel drops its Approve group the same way.
  - Live: opened documents re-read the ERP with the page's 15 s check, and after
    each save. A change made in Role Permission Manager, or by another user, shows
    up by itself ("Tick boxes updated from the ERP").
- **Printing** (the Print / Save as PDF button or the browser's own Ctrl+P) prints
  only the sheet on screen: its print header (version, printed date), the legend and
  the table. The status strip, Reset profiles, the tabs, the heading, the intro text,
  the bar and the ▸ / ⋯ buttons are left out.
- **Confirmations.** Save lists the rights **taken away** first (red) and those
  **given**, with each role's active user count (`role_users` in the page boot) and
  the total reached. When anything is taken away and the sheet is applied, SAVE must
  be typed. Discard lists what will be lost. Resets / syncs / clear / apply / remove
  ask for a typed word; granting Delete or Cancel and removing View ask on the cell.
- **⋯ on a Document access cell** opens "every permission" for that role and document
  (`access_sync.cell_rights`). It lists Frappe's own permissions, as in Role
  Permission Manager, grouped in plain words: See it (Select, Read), Work on it
  (Create, Write), Approve (Submit, Cancel, Amend), Remove (Delete), Take it out of
  the ERP (Print, Email, Report, Export), Never given by this sheet (Import, Share),
  and Which records (Only If Creator).
  - Each line says what gives it: the letter, "needed to pick it in <documents>"
    (linked-document rights), "Accounts only (master data)", or "never submitted".
  - Each line also shows the role's right in the ERP now; differences are
    highlighted.
  - A one-line summary sits on top, e.g. "can only pick Customer in forms… the
    list and records stay closed".
  - Ticking a line switches its letter. Rights come in sets (V, E, C), so the
    sheet stays the only place rights are decided. Nothing applies until Save.
- **Page:** every 15 s (and when the tab becomes visible) it fetches
  `access_worksheet.get_saved`. A newer version replaces the table, with a toast and
  the version's note in the bar. If the page has unsaved changes they're kept; the
  toast says Save will be refused (version check), and Discard loads the newer
  version.

## Admin Settings → tab sheet (`access_reverse.read_back_tabs`)

- Saving Admin Settings (on_update) reads the tab / sub-tab lists back into the
  tab sheet for the sheet roles:
  - on the act list → A;
  - on the view list → ✓ (or A when the act list is empty, since then every viewer
    may act);
  - on neither → hidden.

  A sub-tab without its own act list follows its tab's. A tab whose lists are both
  empty (never configured) is left as it is.
- A change is stored as a new tab sheet version ("Admin Settings · <user>: <role> ·
  <tab>: view → view + act"). The bundle is rewritten, and the page picks it up
  live.
- The sheet's own apply is not read back (`frappe.flags.dacs_access_applying`).
- **Sync from Admin Settings** (tab sheet bar, System Manager, typed SYNC;
  `sync_tabs_from_settings`): preview every difference, then record them as one
  version.
- Refill from document access and Clear all are System Manager only, typed REFILL /
  CLEAR (see Resets above).

## Roles and profiles (dynamic)

- The sheet's columns are the roles flagged **Access Sheet Role** (Role ›
  `custom_dacsinc_access_role`, from `sheet_roles()`). Flag a role and it becomes a
  column.
- Every flagged role has a Role Profile holding exactly that role + Employee +
  Employee Self Service, flagged **Access Sheet Profile**. It is created when the
  role is flagged (Role `on_update`).
  - Same-named older profiles were reset to that and reused. Profiles renamed in the
    past get the role's name back.
  - Users on several profiles (User Access Profile) are re-synced.
- The Roles & Permissions desk page shows and assigns only flagged profiles and
  roles. A user may hold several.
  - This covers the user rows, profile role lists, the Role Profiles view and the
    doctype access overview / detail.
  - Other roles and profiles a user still holds stay on the user, just not shown.
    The per-user Doctype Access tab still shows real access.
- ERPNext / HRMS remove Employee and Employee Self Service from a user who has no
  Employee record linked (User ID). Link one to keep them.

## Switched off / on — users' roles are never changed by applying

- **Off** (a site's state after `setup_access_sheet`):
  - Roles, flags, fields and missing profiles exist, and the sheets are stored.
  - Saving a sheet only records it.
  - No permission or tab is changed, and the POS store scope is off.
- **On** (`access_sync.apply_permissions()`): the patch `apply_access_sheet_permissions`
  on migrate, or **Apply to the ERP…** on the sheet page.
  - Applies the Document access sheet (document permissions, linked documents, report
    access) and the Order Flow tab / sub-tab roles.
  - The patch first works the tab sheet out from the Document access sheet
    (`derive_tab_cells()`, the same rule as the page's Refill), because the stored tab
    sheet was never hand-made.
  - Records DefaultValue `active` = 1. From then on every save applies at once, and
    the POS store scope works.
  - **No user's roles or profiles are touched.**
- **Reset profiles…** (`reset_profiles()`, Admin only) is separate and explicit. Each
  sheet role's profile becomes role + Employee + ESS. The dialog first lists every
  user who would lose roles. Until then profiles keep their old extra roles; assign
  users on the Roles & Permissions page.

## Speed

**Applying Document access writes only what changed** (`_apply_doc_access`).

- Each role's rows on each sheet document are compared with what the sheet wants,
  and only differing pairs are rewritten.
- All rows are read in one query.
- Caches are cleared only for doctypes that changed.
- A save takes about 4 s (about 16 s when every row was deleted and re-created
  each time). The result is identical to a full rebuild (tested).

**On the page:**

- A box click redraws only its own cell and the bar (`renderCell`, `renderBar`),
  not the whole table.
- While a save runs, cells, Save and the live refresh are held, so what is saved
  is what is shown.
- A save that times out says to reload and check, rather than guessing.

## Sheet changes made locally reach live — once per change

- Every save in developer mode rewrites `access/agreed_access.json` with a
  `fingerprint` of the sheets' content.
- On every migrate, `sync_from_bundle` (after_migrate) compares it with the last one
  the site took (DefaultValue `bundle_applied`):
  - **Different:** the pushed sheets are stored as a new version ("from the app
    code") and, where switched on, applied.
  - **Same:** nothing.
- So changes made on live stay until a newer sheet is pushed. If the same sheet is
  edited both locally and on live, the next push wins.
- **Rule changes in the code** (dependencies, companions, pages…) bump
  `RULES_VERSION` in `access_sync.py`. The next migrate then re-applies the site's
  sheets once, without replacing them.

## Going live — patches (each runs once per site)

1. `setup_access_sheet`:
   - Creates the flags (also in `custom/role.json` and `custom/role_profile.json`),
     the roles and any missing profiles.
   - Stores the sheets from `access/agreed_access.json` when the site has none.
2. `setup_pos_store_scope`: adds Customer › POS Store and back-fills it (data only).
3. `apply_access_sheet_permissions`: switches on as above. Users' roles are unchanged.
4. `reset_access_sheet_profiles`: each sheet profile becomes exactly role + Employee +
   ESS. Users lose the extra roles that came only through the old profile (Sales
   User, Accounts User, Item Manager…); roles held another way stay.
5. `apply_access_pages_and_reports`: re-applies the Document access sheet with the
   companion rule and the page / report Custom Roles (only where switched on).

Patches never re-run, and nothing is kept in fixtures, so a later migrate doesn't
reset what was changed on the site through the sheet page.

## Blank PDFs

After changing `WS_ROLES`, `WS_TABS` or `DT_GROUPS`, run
`apps/erp_dacsinc_custom/scripts/make_worksheet_pdfs.sh`, then bump the `?v=` on the
download links.
