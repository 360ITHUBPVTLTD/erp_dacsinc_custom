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
  - Discard, Restore marked worksheet, Refill, Clear all.
  - **Save**: lists every change (role · document: + / − rights) and the version
    number it will become.
- Print / PDF prints only that sheet (A4 landscape), with its legend and signature
  lines.

## Storage and rights

`access_worksheet.py` keeps one JSON blob per sheet (`doc_access`, `tab_access`) in
a `DefaultValue` row under parent `__dacsinc_access_ws`, so no migration is needed.

- Anyone signed in sees the saved sheets. A guest sees the client's sheet, with the
  tab sheet empty.
- Only the **Admin** role can edit and save (`save_sheet`, POST with a CSRF token).
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
  - Point of Sale, Stock Balance and the other PAGE_DOCS pages follow only their own
    documents (Point of Sale → POS Invoice), not the companion roles.
  - Tracked in DefaultValue `report_custom_roles:*` / `page_custom_roles`. Tracking
    maps are stored one row per entry, since a row holds at most 64 KB.
- **Order Flow tabs** → Admin Settings › Order Flow.
  - Each main tab gets `of_tab_<tab>_roles`, and each sub-tab gets
    `of_sub_<tab>_<key>_roles` (section "Sub-tab Visibility").
  - Only the sheet roles are managed there. Any other role already on a tab (Sales
    User, Accounts Team, Inward Team…) is kept, so users not yet moved to a sheet
    role don't lose the dashboard.
  - A tab nobody may see gets `Admin`, so it counts as configured.
  - `order_flow_permissions.get_allowed_subtabs()` feeds the page's `allowed_subtabs`,
    and the page hides the other sub-tab buttons.
- In developer mode a save also rewrites `access/agreed_access.json` (the bundle
  shipped to other sites).

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
