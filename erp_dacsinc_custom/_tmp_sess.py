import frappe
def make():
    from frappe.sessions import Session
    frappe.form_dict["sid"] = "x"; frappe.local.request_ip = "127.0.0.1"
    s = Session(user="Administrator", resume=False, full_name="Administrator", user_type="System User")
    frappe.db.commit()
    print("SID=" + s.data.sid)
def drop(sid):
    frappe.cache.hdel("session", sid); frappe.db.delete("Sessions", {"sid": sid}); frappe.db.commit()
