__version__ = "0.0.1"

import json

import frappe

def patch_notifications():
	try:
		import frappe.desk.doctype.notification_log.notification_log as notification_log
		if not getattr(notification_log, "_patched_send_email", False):
			original_send = notification_log.send_notification_email
			
			def patched_send(doc):
				if doc.type in ["Share", "Assignment"]:
					return
				return original_send(doc)
			
			notification_log.send_notification_email = patched_send
			notification_log._patched_send_email = True
	except Exception:
		pass

def _item_names_matching(word):
	"""Names of the items `word` is found in — the fields erpnext's item_query searches (Item search fields, code,
	name, group, description, barcodes)."""
	fields = frappe.get_meta("Item", cached=True).get_search_fields()
	fields = list(dict.fromkeys(fields + ["name", "item_code", "item_group", "item_name", "description"]))
	cond = " or ".join(f"`{f}` like %(txt)s" for f in fields)
	txt = "%" + word.replace("%", "") + "%"
	return set(frappe.db.sql_list(f"""select name from tabItem where ({cond})
		or name in (select parent from `tabItem Barcode` where barcode like %(txt)s)""", {"txt": txt}))


def patch_item_query():
	try:
		import erpnext.controllers.queries as erpnext_queries
		if not getattr(erpnext_queries, "_patched_item_query", False):
			original_item_query = erpnext_queries.item_query
			
			@frappe.whitelist()
			@frappe.validate_and_sanitize_search_inputs
			def patched_item_query(doctype, txt, searchfield, start, page_len, filters, as_dict=False):
				txt = txt.strip() if txt else ""
				if not txt:
					return original_item_query(doctype, txt, searchfield, start, page_len, filters, as_dict)

				words = [w for w in txt.split() if w]
				
				if len(words) <= 1:
					raw_results = original_item_query(doctype, txt, searchfield, start, page_len, filters, as_dict)
				else:
					# every word must match somewhere (any order). Each word's matches are read in full by
					# _item_names_matching — taking item_query's first 3000 per word dropped the item whenever
					# a common word ("shirt") had more matches than that, so "shirt 36 terrier night" found nothing.
					common_names = None
					for w in words:
						names = _item_names_matching(w)
						common_names = names if common_names is None else common_names & names
						if not common_names:
							return []

					# item_query itself (filters, disabled / variant rules, ordering, columns) on the first
					# word, limited to the items every word matched, and paged by it
					if isinstance(filters, str):
						filters = json.loads(filters)
					names = sorted(common_names)
					if isinstance(filters, list):
						filters = filters + [["Item", "name", "in", names]]
					else:
						filters = dict(filters or {})
						if filters.get("name") is not None:
							keep = frappe.get_all("Item", filters={"name": filters["name"]}, pluck="name")
							names = [n for n in names if n in set(keep)]
						filters["name"] = ["in", names or [""]]
					raw_results = original_item_query(doctype, words[0], searchfield, start, page_len, filters, as_dict)

				import re
				def highlight_text(text):
					if not text or not isinstance(text, str):
						return text
					for w in words:
						if not w:
							continue
						pattern = re.compile(re.escape(w), re.IGNORECASE)
						text = pattern.sub(lambda m: f"<b>{m.group(0)}</b>", text)
					return text

				highlighted_results = []
				for item in raw_results:
					if as_dict:
						new_item = dict(item)
						for k, v in new_item.items():
							if k not in ['name', 'value'] and isinstance(v, str):
								new_item[k] = highlight_text(v)
						highlighted_results.append(new_item)
					else:
						new_item = list(item)
						for i in range(1, len(new_item)):
							if isinstance(new_item[i], str):
								new_item[i] = highlight_text(new_item[i])
						highlighted_results.append(tuple(new_item))

				return highlighted_results

			erpnext_queries.item_query = patched_item_query
			erpnext_queries._patched_item_query = True
	except Exception:
		pass

def patch_search_widget():
	try:
		import frappe.desk.search as frappe_search
		if not getattr(frappe_search, "_patched_search_widget", False):
			original_search_widget = frappe_search.search_widget
			
			@frappe.whitelist()
			def patched_search_widget(doctype, txt, query=None, searchfield=None, start=0, page_length=10, filters=None, filter_fields=None, as_dict=False, **kwargs):
				# Safely pop or ignore unexpected arguments like 'cmd' that might be passed via form_dict
				kwargs.pop('cmd', None)
				
				txt = txt.strip() if txt else ""
				# item_query matches every word itself (patch_item_query) — the per-word loop below reads 3000
				# rows a word, which lost the item for a common word, so item_query gets the words directly
				if doctype not in ["Item", "Customer", "Supplier"] or not txt or query == "erpnext.controllers.queries.item_query":
					return original_search_widget(doctype, txt, query, searchfield, start, page_length, filters, filter_fields, as_dict, **kwargs)

				words = [w for w in txt.split() if w]
				if len(words) <= 1:
					raw_results = original_search_widget(doctype, txt, query, searchfield, start, page_length, filters, filter_fields, as_dict, **kwargs)
				else:
					matching_names_per_word = []
					for w in words:
						res = original_search_widget(doctype, w, query, searchfield, 0, 3000, filters, filter_fields, True, **kwargs)
						names = {item['name'] for item in res if 'name' in item}
						matching_names_per_word.append(names)

					common_names = None
					for names in matching_names_per_word:
						if common_names is None:
							common_names = names
						else:
							common_names = common_names.intersection(names)

					if not common_names:
						return []

					first_word_results = original_search_widget(doctype, words[0], query, searchfield, 0, 3000, filters, filter_fields, as_dict, **kwargs)

					raw_results = []
					seen = set()
					for item in first_word_results:
						name = item.get('name') if as_dict else item[0]
						if name in common_names and name not in seen:
							seen.add(name)
							raw_results.append(item)
					
					start_val = int(start or 0)
					limit_val = int(page_length or 10)
					raw_results = raw_results[start_val:start_val+limit_val]

				import re
				def highlight_text(text):
					if not text or not isinstance(text, str):
						return text
					for w in words:
						if not w:
							continue
						pattern = re.compile(re.escape(w), re.IGNORECASE)
						text = pattern.sub(lambda m: f"<b>{m.group(0)}</b>", text)
					return text

				highlighted_results = []
				for item in raw_results:
					if as_dict:
						new_item = dict(item)
						for k, v in new_item.items():
							if k not in ['name', 'value'] and isinstance(v, str):
								new_item[k] = highlight_text(v)
						highlighted_results.append(new_item)
					else:
						new_item = list(item)
						for i in range(1, len(new_item)):
							if isinstance(new_item[i], str):
								new_item[i] = highlight_text(new_item[i])
						highlighted_results.append(tuple(new_item))

				return highlighted_results

			frappe_search.search_widget = patched_search_widget
			frappe_search._patched_search_widget = True
	except Exception:
		pass

def patch_docshare():
	try:
		import frappe.share as frappe_share
		if not getattr(frappe_share, "_patched_add_docshare", False):
			original_add_docshare = frappe_share.add_docshare
			
			def patched_add_docshare(doctype, name, user=None, read=1, write=0, submit=0, share=0, everyone=0, flags=None, notify=0):
				if flags is None:
					flags = {}
				flags["ignore_share_permission"] = True
				return original_add_docshare(
					doctype, name, user=user, read=read, write=write, submit=submit,
					share=share, everyone=everyone, flags=flags, notify=notify
				)
				
			frappe_share.add_docshare = patched_add_docshare
			frappe_share._patched_add_docshare = True
	except Exception:
		pass

def patch_overall_discount():
	# Overall discount skips items ticked "Exclude from Overall Discount" (overall_discount.py).
	# Not silent: if this fails, discounts fall back to ERPNext's standard spread (freight
	# included) - logged to logs/erp_dacsinc_custom.log and caught by test_overall_discount.
	try:
		from erp_dacsinc_custom import overall_discount
		overall_discount.patch()
	except Exception:
		try:
			frappe.logger("erp_dacsinc_custom").exception("overall_discount patch failed")
		except Exception:
			pass

def patch_pdf_fill():
	# blank space in prints measured from a first PDF (pdf_fill.py); a failure leaves PDFs as frappe makes them
	try:
		from erp_dacsinc_custom import pdf_fill
		pdf_fill.patch()
	except Exception:
		try:
			frappe.logger("erp_dacsinc_custom").exception("pdf_fill patch failed")
		except Exception:
			pass

patch_notifications()
patch_pdf_fill()
patch_overall_discount()
patch_item_query()
patch_search_widget()
patch_docshare()
