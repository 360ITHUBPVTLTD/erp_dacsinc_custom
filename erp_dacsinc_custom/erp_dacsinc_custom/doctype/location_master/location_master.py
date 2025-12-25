# Copyright (c) 2025, Pankaj and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class LocationMaster(Document):
	pass
import frappe
import requests
import json
import time
import unicodedata

def remove_accents(input_str):
    """Removes marks like 'ō' and converts to 'o'"""
    if not input_str: return ""
    nksel = unicodedata.normalize('NFKD', input_str)
    return "".join([c for c in nksel if not unicodedata.combining(c)])

@frappe.whitelist()
def start_global_sync():
    """Triggers the background process"""
    frappe.enqueue('erp_dacsinc_custom.erp_dacsinc_custom.doctype.location_master.location_master.run_full_world_sync', timeout=10000)
    return "Sync started in background. Monitor 'Sync Status' field."

def run_full_world_sync():
    base_url = "https://countriesnow.space/api/v0.1/countries"
    
    # 1. Update Status
    frappe.db.set_single_value("Location Master", "sync_status", "Fetching Countries...")
    frappe.db.commit()

    try:
        res = requests.get(f"{base_url}/states", timeout=30)
        all_countries = res.json().get("data", [])
    except Exception as e:
        frappe.log_error(f"Sync Error: {str(e)}")
        return

    # Load existing JSON to resume or start fresh
    current_json = frappe.db.get_single_value("Location Master", "data_json")
    master_data = json.loads(current_json) if current_json else {}

    total_states = sum(len(c.get("states", [])) for c in all_countries)
    processed = 0

    for country_obj in all_countries:
        # Clean Country Name
        country = remove_accents(country_obj.get("name"))
        if country not in master_data:
            master_data[country] = {}

        for s in country_obj.get("states", []):
            state = remove_accents(s.get("name"))
            
            # Skip if already exists to save API calls
            if state in master_data[country] and master_data[country][state]:
                processed += 1
                continue

            try:
                time.sleep(0.3) # Rate limit protection
                city_res = requests.post(f"{base_url}/state/cities", 
                    json={"country": country_obj.get("name"), "state": s.get("name")}, timeout=15)
                
                res_json = city_res.json()
                raw_cities = res_json.get("data", []) if not res_json.get("error") else []
                
                # Clean all city names
                clean_cities = sorted(list(set([remove_accents(c) for c in raw_cities])))
                master_data[country][state] = clean_cities
                
            except Exception:
                master_data[country][state] = []

            processed += 1
            if processed % 10 == 0:
                frappe.db.set_single_value("Location Master", "sync_status", f"Progress: {processed}/{total_states} states.")
                frappe.db.commit()

        # Save after every country
        frappe.db.set_single_value("Location Master", "data_json", json.dumps(master_data, ensure_ascii=False))
        frappe.db.commit()

    frappe.db.set_single_value("Location Master", "sync_status", "Complete! No accents, all records serialized.")
    frappe.db.commit()