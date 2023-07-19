import frappe

from erpnext.utilities.naming import set_by_naming_series


def execute():

	stock_settings = frappe.get_doc("Stock Settings")

	set_by_naming_series(
		"Product",
		"product_code",
		stock_settings.get("product_naming_by") == "Naming Series",
		hide_name_field=True,
		make_mandatory=0,
	)