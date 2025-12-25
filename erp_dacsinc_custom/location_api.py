import frappe
import json


@frappe.whitelist(allow_guest=True)
def get_states(country):
    """Returns all states for a specific country"""
    data_json = frappe.db.get_single_value('Location Master', 'data_json')
    if not data_json:
        return []
    
    master_data = json.loads(data_json)
    country_data = master_data.get(country, {})
    
    # Get state names (keys of the country object)
    return sorted(list(country_data.keys()))

@frappe.whitelist(allow_guest=True)
def get_cities(country, state):
    """Returns all cities for a specific state and country"""
    data_json = frappe.db.get_single_value('Location Master', 'data_json')
    if not data_json:
        return []
    
    master_data = json.loads(data_json)
    
    # Navigate to master_data[country][state]
    cities = master_data.get(country, {}).get(state, [])
    return cities # Already sorted by our sync script