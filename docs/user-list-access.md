# User list: who sees all users

Only **Admin, HR Manager and System Manager** (and Administrator) see every user. Everyone else:

- **User List / Report view and the list APIs** show only their own record
  (`user_scope.get_user_list_conditions`, a `permission_query_conditions` hook on User).
- **Another user's form** is refused: the Employee role has **Select** on User, not Read
  (patch `employee_select_only_on_user`). Every other role already had Select only (the access sheet
  gives User as select-only, `access_sync.DEP_SELECT_ONLY`). Their **own** record still opens — Frappe
  shares each user's record with that user.
- **Picking a user in a Link field** (Assign To, Merchandiser User, Lead Owner, …) still lists every
  user. Frappe's Link search for User (`user_query`) runs through the same `frappe.get_list` as the
  List view, so the hook narrows only list requests (`frappe.desk.reportview.*`,
  `frappe.client.get_list` / `get_count`, `/api/resource/User`), never a search — narrowing every
  query would leave each user picker showing only yourself.

Employee is a base role (`access_sync.BASE_ROLES`), not a sheet role, so saving the access sheet does
not put its Read back.
