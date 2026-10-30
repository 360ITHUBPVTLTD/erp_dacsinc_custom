"""Order Stage on the Sales Order list (so_stage.py): add the fields and fill them for every order. Safe to run again."""

from erp_dacsinc_custom import so_stage


def execute():
	so_stage.setup_fields()
	so_stage.refresh_all()
