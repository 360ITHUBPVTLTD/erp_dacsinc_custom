# Copyright (c) 2026, Administrator and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class EmbroideryWorkOrderReceipt(Document):
	"""One receipt of a Stock Transfer Embroidery Work Order: what came back, into which warehouse, by which
	Repack Stock Entry (uniform_transfer_api.receive_embroidery_transfer)."""
