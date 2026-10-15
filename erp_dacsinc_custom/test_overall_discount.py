"""Overall discount that skips items ticked "Exclude from Overall Discount"
(overall_discount.py, docs/overall-discount.md).

Run after every ERPNext update - it fails if the patch is not active or if
ERPNext's discount code changed under it:
    bench --site dacsinc.local execute erp_dacsinc_custom.test_overall_discount.run
Use this, not `bench run-tests`: run-tests first runs every app's before_tests,
and India Compliance's creates three "_Test ..." companies in the site.

Documents are built in memory and never saved. The figures are those of
SINV-26-00053: goods 1,125 + 2,375 at 5% GST, freight 200 at 18% GST.
"""

import json
import unittest

import frappe
from frappe.tests.utils import FrappeTestCase

from erp_dacsinc_custom.overall_discount import DOCTYPES, FIELD, ITEM_TABLES

def output_gst_accounts(company):
	"""The company's Output CGST / SGST accounts from GST Settings (as used on invoices)."""
	row = frappe.db.get_value("GST Account", {"parent": "GST Settings", "company": company, "account_type": "Output"},
		["cgst_account", "sgst_account"], as_dict=True)
	if not row or not row.cgst_account or not row.sgst_account:
		raise unittest.SkipTest(f"No Output GST accounts in GST Settings for {company}")
	return row.sgst_account, row.cgst_account


def gst_template(company, sgst, rate):
	"""The company's Item Tax Template charging `rate`% GST (half on the SGST account).
	ERPNext rebuilds each row's tax rates from its template, so a real one is needed."""
	name = frappe.db.sql(
		"""select t.name from `tabItem Tax Template` t join `tabItem Tax Template Detail` d on d.parent = t.name
		where t.company = %s and t.disabled = 0 and d.tax_type = %s and d.tax_rate = %s limit 1""",
		(company, sgst, rate / 2),
	)
	if not name:
		raise unittest.SkipTest(f"No {rate}% GST Item Tax Template for {company}")
	return name[0][0]


def test_items():
	"""Any three enabled sales items: rate, tax template and the exclude tick are set on
	the row by the test, so which items they are does not matter (ERPNext only needs
	them to exist). The third one plays the freight row."""
	codes = frappe.get_all("Item", filters={"disabled": 0, "is_sales_item": 1, "has_variants": 0},
		pluck="name", limit=3, order_by="name")
	if len(codes) < 3:
		raise unittest.SkipTest("Need three enabled sales items")
	return codes


def make(doctype, on, pct=0, amount=0, exclude=True):
	doc = frappe.new_doc(doctype)
	company = frappe.defaults.get_global_default("company") or frappe.db.get_value("Company", {}, "name")
	sgst, cgst = output_gst_accounts(company)
	GST5, GST18 = gst_template(company, sgst, 5), gst_template(company, sgst, 18)
	doc.update({
		"company": company, "currency": frappe.get_cached_value("Company", company, "default_currency"),
		"conversion_rate": 1, "plc_conversion_rate": 1, "apply_discount_on": on,
		"additional_discount_percentage": pct, "discount_amount": amount,
	})
	goods_a, goods_b, freight = test_items()
	for code, qty, rate, tax in ((goods_a, 5, 225, GST5), (goods_b, 5, 475, GST5), (freight, 1, 200, GST18)):
		doc.append("items", {"item_code": code, "item_name": code, "qty": qty, "rate": rate, "price_list_rate": rate,
			"conversion_factor": 1, "stock_qty": qty, "item_tax_template": tax})
	for head in (sgst, cgst):
		doc.append("taxes", {"charge_type": "On Net Total", "account_head": head, "description": head, "rate": 0})
	doc.items[2].set(FIELD, 1 if exclude else 0)
	doc.calculate_taxes_and_totals()
	return doc


class TestOverallDiscount(FrappeTestCase):
	def setUp(self):
		self._commit = frappe.db.commit
		frappe.db.commit = lambda *a, **k: None  # nothing from these tests may persist

	def tearDown(self):
		frappe.db.commit = self._commit
		frappe.db.rollback()

	def test_patch_is_active(self):
		from erpnext.controllers.taxes_and_totals import calculate_taxes_and_totals

		self.assertTrue(getattr(calculate_taxes_and_totals, "_overall_discount_patched", False),
			"overall_discount.patch() did not run - discounts are being spread over freight again")

	def test_fields_exist(self):
		for dt in ("Item", *ITEM_TABLES):
			self.assertTrue(frappe.db.exists("Custom Field", f"{dt}-{FIELD}"), f"{FIELD} missing on {dt} - run migrate")

	def test_percent_on_grand_total(self):
		base = make("Sales Invoice", "Grand Total")
		for dt in DOCTYPES:
			with self.subTest(doctype=dt):
				doc = make(dt, "Grand Total", pct=10)
				self.assertAlmostEqual(doc.discount_amount, 367.50, 2)  # 10% of goods incl. GST (3,675)
				self.assertEqual(doc.items[2].net_amount, 200)
				self.assertFalse(doc.items[2].distributed_discount_amount)
				self.assertAlmostEqual(doc.grand_total, 3543.50, 1)
				self.assertAlmostEqual(base.grand_total - doc.grand_total, doc.discount_amount, 1)

	def test_percent_on_net_total(self):
		doc = make("Sales Invoice", "Net Total", pct=10)
		self.assertAlmostEqual(doc.discount_amount, 350, 2)
		self.assertEqual(doc.items[2].net_amount, 200)
		self.assertAlmostEqual(doc.net_total, 3350, 2)

	def test_amount(self):
		doc = make("Sales Invoice", "Grand Total", amount=100)
		self.assertEqual(doc.items[2].net_amount, 200)
		self.assertAlmostEqual(doc.grand_total, 3811, 1)
		doc = make("Sales Invoice", "Net Total", amount=100)
		self.assertEqual(doc.items[2].net_amount, 200)
		self.assertAlmostEqual(doc.net_total, 3600, 2)

	def test_freight_gst_untouched(self):
		doc = make("Sales Invoice", "Grand Total", pct=10)
		freight = test_items()[2]
		tax = sum(json.loads(t.item_wise_tax_detail)[freight][1] for t in doc.taxes)
		self.assertAlmostEqual(tax, 36, 2)

	def test_nothing_ticked_is_standard_erpnext(self):
		doc = make("Sales Invoice", "Grand Total", pct=10, exclude=False)
		self.assertAlmostEqual(doc.discount_amount, 391.10, 2)
		self.assertAlmostEqual(doc.items[2].net_amount, 180, 2)

	def test_all_rows_excluded_is_refused(self):
		doc = make("Sales Invoice", "Net Total")
		for row in doc.items:
			row.set(FIELD, 1)
		doc.discount_amount = 100
		self.assertRaises(frappe.ValidationError, doc.calculate_taxes_and_totals)


def run():
	"""bench --site <site> execute erp_dacsinc_custom.test_overall_discount.run"""
	result = unittest.TextTestRunner(verbosity=2).run(
		unittest.defaultTestLoader.loadTestsFromTestCase(TestOverallDiscount)
	)
	# printed, not raised: bench execute hides a raised error behind a NameError
	print("OVERALL DISCOUNT TESTS:", "PASSED" if result.wasSuccessful() else
		f"FAILED ({len(result.failures) + len(result.errors)})")
