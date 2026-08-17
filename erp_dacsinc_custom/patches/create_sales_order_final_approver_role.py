"""
Create the "Sales Order Final Approver" role and wire it into the Sales
Order Workflow's "Pending Final Approval" transition.

Why this exists: final approval is meant to be controlled purely by the
per-user list in Admin Settings > Sales Order Final Approval (a Table
MultiSelect of Users, not Roles) — a Merchandiser Manager or any other broad
role should NOT automatically be able to final-approve just by holding that
role. But a Frappe Workflow Transition can only be gated by a Role, never by
a list of individual users. This role is the bridge: it grants nothing
except passing that one transition, it is never assigned by hand, and
order_flow_permissions.sync_sales_order_final_approver_role() keeps it
assigned to exactly the users in that Admin Settings list — no more, no
less.

Before this patch, the transition was gated on "System Manager" only, which
is why a user who WAS in the Admin Settings final-approval list but did not
also hold System Manager got "No valid transition found to approve Sales
Order ... in state Pending Final Approval": our own approve_sales_orders()
authorized them, but frappe.model.workflow.get_transitions() — a framework
call that checks the Workflow Transition's `allowed` role, independent of
our own check — did not.
"""

from erp_dacsinc_custom.order_flow_api import setup_sales_order_workflow
from erp_dacsinc_custom.order_flow_permissions import sync_sales_order_final_approver_role


def execute():
    # Creates the "Sales Order Final Approver" role (if missing) and rebuilds
    # the workflow so its two new transition rows exist on this site —
    # setup_sales_order_workflow(force=False) is a no-op once the workflow
    # already exists, which it does on every site this patch will ever run
    # against.
    setup_sales_order_workflow(force=True)

    # Retroactively grant the role to whoever is already in the Admin
    # Settings list, so existing final approvers aren't the ones who
    # discover this bug next.
    sync_sales_order_final_approver_role()
