def get_data():
	return {
		"fieldname": "lead",
		"non_standard_fieldnames": {"Quotation": "party_name", "Opportunity": "party_name"},
		"dynamic_links": {"party_name": ["Lead", "quotation_to"]},
		"transactions": [
			{"products": ["Opportunity", "Quotation", "Prospect"]},
		],
	}
