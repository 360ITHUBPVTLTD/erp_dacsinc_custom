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
    from it (fetch_from). The sheet stays the decision there.
  - Masters the role may edit (Item, Customer, Supplier, Lead…) pass edit on to their
    setup masters (Brand, Item Group, UOM, Customer Group, Territory…). Company,
    Currency, Price List, Account, Cost Center and similar only ever get Read.
  - Dependency grants only add. What they added is tracked in DefaultValue
    `derived_applied`, and only that is taken back later, so hand-made rules (e.g.
    Merchandiser User's own-customer scoping and HR rows) stay.
- **Order Flow tabs** → Admin Settings › Order Flow.
  - Each main tab gets `of_tab_<tab>_roles`, and each sub-tab gets
    `of_sub_<tab>_<key>_roles` (section "Sub-tab Visibility").
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
- ERPNext / HRMS remove Employee and Employee Self Service from a user who has no
  Employee record linked (User ID). Link one to keep them.

## Switched off / on (nothing is taken away until an Admin says so)

- **Off:** a site's first state; live right after the deploy.
  - Roles, flags and fields exist. Profiles are created only where missing, and
    existing profiles keep their roles, so no user loses one.
  - The sheets are stored, and saving a sheet only records it.
  - No permission, report or Admin Settings tab is changed, and the POS store scope
    is off.
  - The sheet page shows "Not applied to the ERP yet".
- **On:** an Admin presses **Apply to the ERP…** on the sheet page. The dialog first
  lists every user who would lose roles through the profile reset. Then
  `access_sync.activate()`:
  1. resets the profiles to role + Employee + ESS;
  2. applies both sheets;
  3. records DefaultValue `active` = 1.

  From then on every save applies at once.

## Going live (one time) — `patches/setup_access_sheet.py`

- Runs once per site on migrate, with the site still switched **off**:
  1. Creates the flags (also exported in `custom/role.json` and
     `custom/role_profile.json`).
  2. Creates the roles and any missing profiles.
  3. Stores the sheets from `access/agreed_access.json` when the site has none saved.
- `setup_pos_store_scope` adds Customer › POS Store and back-fills it (data only).
- Nobody's access changes on deploy. Map users to profiles, then switch on.
- The patches never run again, and nothing is kept in fixtures, so a later migrate
  doesn't reset what was changed on the site.

## Blank PDFs

After changing `WS_ROLES`, `WS_TABS` or `DT_GROUPS`, run
`apps/erp_dacsinc_custom/scripts/make_worksheet_pdfs.sh`, then bump the `?v=` on the
download links.
