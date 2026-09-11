"""
Let a Sales Order's own creator push it through the merchandiser-approval
step themselves, even when the customer's assigned merchandiser is someone
else.

Why: Frappe's own workflow engine refuses ANY transition where the acting
user is also the document's owner, unless that specific Workflow Transition
row has `allow_self_approval` set (see has_approval_access in
frappe/model/workflow.py) — regardless of which role authorized the
transition. Confirmed live: a user who holds a broader operational role
(and so already has Sales Order access company-wide via
is_scoped_merchandiser_for_doctype) was denied with "Self approval is not
allowed" trying to approve a Sales Order they themselves had created for a
customer whose merchandiser was someone else.

Deliberately scoped to only the two transitions that lead INTO or THROUGH
the merchandiser-approval stage (Draft -> Pending Merchandiser Approval,
and Pending Merchandiser Approval -> Pending Final Approval) — not to the
separate Pending Final Approval -> Approved transitions, so final approval
still requires someone other than the order's creator.
"""

from erp_dacsinc_custom.order_flow_api import setup_sales_order_workflow


def execute():
    # setup_sales_order_workflow(force=False) is a no-op once the workflow
    # already exists, which it does on every site this patch will ever run
    # against.
    setup_sales_order_workflow(force=True)
