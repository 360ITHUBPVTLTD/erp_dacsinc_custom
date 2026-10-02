import frappe
def make(user):
    from werkzeug.test import EnvironBuilder
    from werkzeug.wrappers import Request
    from frappe.sessions import Session
    frappe.local.request = Request(EnvironBuilder(path="/", base_url="http://dacsinc.local:8000").get_environ())
    frappe.local.request_ip = "127.0.0.1"
    s = Session(user=user, resume=False, full_name=user, user_type="System User")
    frappe.db.commit(); print("SID", s.sid)
def drop(sid):
    frappe.db.delete("Sessions", {"sid": sid}); frappe.cache.hdel("session", sid); frappe.db.commit()
def users():
    import json
    print("USERS", json.dumps(frappe.get_all("User", filters={"user_type": "System User", "name": ["not in", ["Guest"]]}, pluck="name")))
