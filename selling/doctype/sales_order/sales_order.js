// Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
// License: GNU General Public License v3. See license.txt

{% include 'erpnext/selling/sales_common.js' %}

frappe.ui.form.on("Sales Order", {
	setup: function(frm) {
		frm.custom_make_buttons = {
			'Delivery Note': 'Delivery Note',
			'Pick List': 'Pick List',
			'Sales Invoice': 'Sales Invoice',
			'Material Request': 'Material Request',
			'Purchase Order': 'Purchase Order',
			'Project': 'Project',
			'Payment Entry': "Payment",
			'Work Order': "Work Order"
		}
		frm.add_fetch('customer', 'tax_id', 'tax_id');

		// formatter for material request product
		frm.set_indicator_formatter('product_code',
			function(doc) { return (doc.stock_qty<=doc.delivered_qty) ? "green" : "orange" })

		frm.set_query('company_address', function(doc) {
			if(!doc.company) {
				frappe.throw(__('Please set Company'));
			}

			return {
				query: 'frappe.contacts.doctype.address.address.address_query',
				filters: {
					link_doctype: 'Company',
					link_name: doc.company
				}
			};
		})

		frm.set_query("bom_no", "products", function(doc, cdt, cdn) {
			var row = locals[cdt][cdn];
			return {
				filters: {
					"product": row.product_code
				}
			}
		});

		frm.set_df_property('packed_products', 'cannot_add_rows', true);
		frm.set_df_property('packed_products', 'cannot_delete_rows', true);
	},
	refresh: function(frm) {
		if(frm.doc.docstatus === 1 && frm.doc.status !== 'Closed'
			&& flt(frm.doc.per_delivered, 6) < 100 && flt(frm.doc.per_billed, 6) < 100) {
			frm.add_custom_button(__('Update Products'), () => {
				erpnext.utils.update_child_products({
					frm: frm,
					child_docname: "products",
					child_doctype: "Sales Order Detail",
					cannot_add_row: false,
				})
			});
		}

		if (frm.doc.docstatus === 0 && frm.doc.is_internal_customer) {
			frm.events.get_products_from_internal_purchase_order(frm);
		}
	},

	get_products_from_internal_purchase_order(frm) {
		frm.add_custom_button(__('Purchase Order'), () => {
			erpnext.utils.map_current_doc({
				method: 'erpnext.buying.doctype.purchase_order.purchase_order.make_inter_company_sales_order',
				source_doctype: 'Purchase Order',
				target: frm,
				setters: [
					{
						label: 'Supplier',
						fieldname: 'supplier',
						fieldtype: 'Link',
						options: 'Supplier'
					}
				],
				get_query_filters: {
					company: frm.doc.company,
					is_internal_supplier: 1,
					docstatus: 1,
					status: ['!=', 'Completed']
				}
			});
		}, __('Get Products From'));
	},

	onload: function(frm) {
		if (!frm.doc.transaction_date){
			frm.set_value('transaction_date', frappe.datetime.get_today())
		}
		erpnext.queries.setup_queries(frm, "Warehouse", function() {
			return {
				filters: [
					["Warehouse", "company", "in", ["", cstr(frm.doc.company)]],
				]
			};
		});

		frm.set_query('project', function(doc, cdt, cdn) {
			return {
				query: "erpnext.controllers.queries.get_project_name",
				filters: {
					'customer': doc.customer
				}
			}
		});

		frm.set_query('warehouse', 'products', function(doc, cdt, cdn) {
			let row  = locals[cdt][cdn];
			let query = {
				filters: [
					["Warehouse", "company", "in", ["", cstr(frm.doc.company)]],
				]
			};
			if (row.product_code) {
				query.query = "erpnext.controllers.queries.warehouse_query";
				query.filters.push(["Bin", "product_code", "=", row.product_code]);
			}
			return query;
		});

		// On cancel and amending a sales order with advance payment, reset advance paid amount
		if (frm.is_new()) {
			frm.set_value("advance_paid", 0)
		}

		frm.ignore_doctypes_on_cancel_all = ['Purchase Order'];
	},

	delivery_date: function(frm) {
		$.each(frm.doc.products || [], function(i, d) {
			if(!d.delivery_date) d.delivery_date = frm.doc.delivery_date;
		});
		refresh_field("products");
	}
});

frappe.ui.form.on("Sales Order Product", {
	product_code: function(frm,cdt,cdn) {
		var row = locals[cdt][cdn];
		if (frm.doc.delivery_date) {
			row.delivery_date = frm.doc.delivery_date;
			refresh_field("delivery_date", cdn, "products");
		} else {
			frm.script_manager.copy_from_first_row("products", row, ["delivery_date"]);
		}
	},
	delivery_date: function(frm, cdt, cdn) {
		if(!frm.doc.delivery_date) {
			erpnext.utils.copy_value_in_all_rows(frm.doc, cdt, cdn, "products", "delivery_date");
		}
	}
});

erpnext.selling.SalesOrderController = class SalesOrderController extends erpnext.selling.SellingController {
	onload(doc, dt, dn) {
		super.onload(doc, dt, dn);
	}

	refresh(doc, dt, dn) {
		var me = this;
		super.refresh();
		let allow_delivery = false;

		if (doc.docstatus==1) {

			if(this.frm.has_perm("submit")) {
				if(doc.status === 'On Hold') {
				   // un-hold
				   this.frm.add_custom_button(__('Resume'), function() {
					   me.frm.cscript.update_status('Resume', 'Draft')
				   }, __("Status"));

				   if(flt(doc.per_delivered, 6) < 100 || flt(doc.per_billed) < 100) {
					   // close
					   this.frm.add_custom_button(__('Close'), () => this.close_sales_order(), __("Status"))
				   }
				}
			   	else if(doc.status === 'Closed') {
				   // un-close
				   this.frm.add_custom_button(__('Re-open'), function() {
					   me.frm.cscript.update_status('Re-open', 'Draft')
				   }, __("Status"));
			   }
			}
			if(doc.status !== 'Closed') {
				if(doc.status !== 'On Hold') {
					allow_delivery = this.frm.doc.products.some(product => product.delivered_by_supplier === 0 && product.qty > flt(product.delivered_qty))
						&& !this.frm.doc.skip_delivery_note

					if (this.frm.has_perm("submit")) {
						if(flt(doc.per_delivered, 6) < 100 || flt(doc.per_billed) < 100) {
							// hold
							this.frm.add_custom_button(__('Hold'), () => this.hold_sales_order(), __("Status"))
							// close
							this.frm.add_custom_button(__('Close'), () => this.close_sales_order(), __("Status"))
						}
					}

					if (flt(doc.per_picked, 6) < 100 && flt(doc.per_delivered, 6) < 100) {
						this.frm.add_custom_button(__('Pick List'), () => this.create_pick_list(), __('Create'));
					}

					const order_is_a_sale = ["Sales", "Shopping Cart"].indexOf(doc.order_type) !== -1;
					const order_is_maintenance = ["Maintenance"].indexOf(doc.order_type) !== -1;
					// order type has been customised then show all the action buttons
					const order_is_a_custom_sale = ["Sales", "Shopping Cart", "Maintenance"].indexOf(doc.order_type) === -1;

					// delivery note
					if(flt(doc.per_delivered, 6) < 100 && (order_is_a_sale || order_is_a_custom_sale) && allow_delivery) {
						this.frm.add_custom_button(__('Delivery Note'), () => this.make_delivery_note_based_on_delivery_date(), __('Create'));
						this.frm.add_custom_button(__('Work Order'), () => this.make_work_order(), __('Create'));
					}

					// sales invoice
					if(flt(doc.per_billed, 6) < 100) {
						this.frm.add_custom_button(__('Sales Invoice'), () => me.make_sales_invoice(), __('Create'));
					}

					// material request
					if(!doc.order_type || (order_is_a_sale || order_is_a_custom_sale) && flt(doc.per_delivered, 6) < 100) {
						this.frm.add_custom_button(__('Material Request'), () => this.make_material_request(), __('Create'));
						this.frm.add_custom_button(__('Request for Raw Materials'), () => this.make_raw_material_request(), __('Create'));
					}

					// Make Purchase Order
					if (!this.frm.doc.is_internal_customer) {
						this.frm.add_custom_button(__('Purchase Order'), () => this.make_purchase_order(), __('Create'));
					}

					// maintenance
					if(flt(doc.per_delivered, 2) < 100 && (order_is_maintenance || order_is_a_custom_sale)) {
						this.frm.add_custom_button(__('Maintenance Visit'), () => this.make_maintenance_visit(), __('Create'));
						this.frm.add_custom_button(__('Maintenance Schedule'), () => this.make_maintenance_schedule(), __('Create'));
					}

					// project
					if(flt(doc.per_delivered, 2) < 100) {
							this.frm.add_custom_button(__('Project'), () => this.make_project(), __('Create'));
					}

					if(!doc.auto_repeat) {
						this.frm.add_custom_button(__('Subscription'), function() {
							erpnext.utils.make_subscription(doc.doctype, doc.name)
						}, __('Create'))
					}

					if (doc.docstatus === 1 && !doc.inter_company_order_reference) {
						let me = this;
						let internal = me.frm.doc.is_internal_customer;
						if (internal) {
							let button_label = (me.frm.doc.company === me.frm.doc.represents_company) ? "Internal Purchase Order" :
								"Inter Company Purchase Order";

							me.frm.add_custom_button(button_label, function() {
								me.make_inter_company_order();
							}, __('Create'));
						}
					}
				}
				// payment request
				if(flt(doc.per_billed, precision('per_billed', doc)) < 100 + frappe.boot.sysdefaults.over_billing_allowance) {
					this.frm.add_custom_button(__('Payment Request'), () => this.make_payment_request(), __('Create'));
					this.frm.add_custom_button(__('Payment'), () => this.make_payment_entry(), __('Create'));
				}
				this.frm.page.set_inner_btn_group_as_primary(__('Create'));
			}
		}

		if (this.frm.doc.docstatus===0) {
			this.frm.add_custom_button(__('Quotation'),
				function() {
					let d = erpnext.utils.map_current_doc({
						method: "erpnext.selling.doctype.quotation.quotation.make_sales_order",
						source_doctype: "Quotation",
						target: me.frm,
						setters: [
							{
								label: "Customer",
								fieldname: "party_name",
								fieldtype: "Link",
								options: "Customer",
								default: me.frm.doc.customer || undefined
							}
						],
						get_query_filters: {
							company: me.frm.doc.company,
							docstatus: 1,
							status: ["!=", "Lost"]
						}
					});

					setTimeout(() => {
						d.$parent.append(`
							<span class='small text-muted'>
								${__("Note: Please create Sales Orders from individual Quotations to select from among Alternative Products.")}
							</span>
					`);
					}, 200);

				}, __("Get Products From"));
		}

		this.order_type(doc);
	}

	create_pick_list() {
		frappe.model.open_mapped_doc({
			method: "erpnext.selling.doctype.sales_order.sales_order.create_pick_list",
			frm: this.frm
		})
	}

	make_work_order() {
		var me = this;
		me.frm.call({
			method: "erpnext.selling.doctype.sales_order.sales_order.get_work_order_products",
			args: {
				sales_order: this.frm.docname,
			},
			freeze: true,
			callback: function(r) {
				if(!r.message) {
					frappe.msgprint({
						title: __('Work Order not created'),
						message: __('No Products with Bill of Materials to Manufacture'),
						indicator: 'orange'
					});
					return;
				}
				else {
					const fields = [{
						label: 'Products',
						fieldtype: 'Table',
						fieldname: 'products',
						description: __('Select BOM and Qty for Production'),
						fields: [{
							fieldtype: 'Read Only',
							fieldname: 'product_code',
							label: __('Product Code'),
							in_list_view: 1
						}, {
							fieldtype: 'Link',
							fieldname: 'bom',
							options: 'BOM',
							reqd: 1,
							label: __('Select BOM'),
							in_list_view: 1,
							get_query: function (doc) {
								return { filters: { product: doc.product_code } };
							}
						}, {
							fieldtype: 'Float',
							fieldname: 'pending_qty',
							reqd: 1,
							label: __('Qty'),
							in_list_view: 1
						}, {
							fieldtype: 'Data',
							fieldname: 'sales_order_product',
							reqd: 1,
							label: __('Sales Order Product'),
							hidden: 1
						}],
						data: r.message,
						get_data: () => {
							return r.message
						}
					}]
					var d = new frappe.ui.Dialog({
						title: __('Select Products to Manufacture'),
						fields: fields,
						primary_action: function() {
							var data = {products: d.fields_dict.products.grid.get_selected_children()};
							me.frm.call({
								method: 'make_work_orders',
								args: {
									products: data,
									company: me.frm.doc.company,
									sales_order: me.frm.docname,
									project: me.frm.project
								},
								freeze: true,
								callback: function(r) {
									if(r.message) {
										frappe.msgprint({
											message: __('Work Orders Created: {0}', [r.message.map(function(d) {
													return repl('<a href="/app/work-order/%(name)s">%(name)s</a>', {name:d})
												}).join(', ')]),
											indicator: 'green'
										})
									}
									d.hide();
								}
							});
						},
						primary_action_label: __('Create')
					});
					d.show();
				}
			}
		});
	}

	order_type() {
		this.toggle_delivery_date();
	}

	tc_name() {
		this.get_terms();
	}

	make_material_request() {
		frappe.model.open_mapped_doc({
			method: "erpnext.selling.doctype.sales_order.sales_order.make_material_request",
			frm: this.frm
		})
	}

	skip_delivery_note() {
		this.toggle_delivery_date();
	}

	toggle_delivery_date() {
		this.frm.fields_dict.products.grid.toggle_reqd("delivery_date",
			(this.frm.doc.order_type == "Sales" && !this.frm.doc.skip_delivery_note));
	}

	make_raw_material_request() {
		var me = this;
		this.frm.call({
			method: "erpnext.selling.doctype.sales_order.sales_order.get_work_order_products",
			args: {
				sales_order: this.frm.docname,
				for_raw_material_request: 1
			},
			callback: function(r) {
				if(!r.message) {
					frappe.msgprint({
						message: __('No Products with Bill of Materials.'),
						indicator: 'orange'
					});
					return;
				}
				else {
					me.make_raw_material_request_dialog(r);
				}
			}
		});
	}

	make_raw_material_request_dialog(r) {
		var me = this;
		var fields = [
			{fieldtype:'Check', fieldname:'include_exploded_products',
				label: __('Include Exploded Products')},
			{fieldtype:'Check', fieldname:'ignore_existing_ordered_qty',
				label: __('Ignore Existing Ordered Qty')},
			{
				fieldtype:'Table', fieldname: 'products',
				description: __('Select BOM, Qty and For Warehouse'),
				fields: [
					{fieldtype:'Read Only', fieldname:'product_code',
						label: __('Product Code'), in_list_view:1},
					{fieldtype:'Link', fieldname:'warehouse', options: 'Warehouse',
						label: __('For Warehouse'), in_list_view:1},
					{fieldtype:'Link', fieldname:'bom', options: 'BOM', reqd: 1,
						label: __('BOM'), in_list_view:1, get_query: function(doc) {
							return {filters: {product: doc.product_code}};
						}
					},
					{fieldtype:'Float', fieldname:'required_qty', reqd: 1,
						label: __('Qty'), in_list_view:1},
				],
				data: r.message,
				get_data: function() {
					return r.message
				}
			}
		]
		var d = new frappe.ui.Dialog({
			title: __("Products for Raw Material Request"),
			fields: fields,
			primary_action: function() {
				var data = d.get_values();
				me.frm.call({
					method: 'erpnext.selling.doctype.sales_order.sales_order.make_raw_material_request',
					args: {
						products: data,
						company: me.frm.doc.company,
						sales_order: me.frm.docname,
						project: me.frm.project
					},
					freeze: true,
					callback: function(r) {
						if(r.message) {
							frappe.msgprint(__('Material Request {0} submitted.',
							['<a href="/app/material-request/'+r.message.name+'">' + r.message.name+ '</a>']));
						}
						d.hide();
						me.frm.reload_doc();
					}
				});
			},
			primary_action_label: __('Create')
		});
		d.show();
	}

	make_delivery_note_based_on_delivery_date() {
		var me = this;

		var delivery_dates = this.frm.doc.products.map(i => i.delivery_date);
		delivery_dates = [ ...new Set(delivery_dates) ];

		var product_grid = this.frm.fields_dict["products"].grid;
		if(!product_grid.get_selected().length && delivery_dates.length > 1) {
			var dialog = new frappe.ui.Dialog({
				title: __("Select Products based on Delivery Date"),
				fields: [{fieldtype: "HTML", fieldname: "dates_html"}]
			});

			var html = $(`
				<div style="border: 1px solid #d1d8dd">
					<div class="list-product list-product--head">
						<div class="list-product__content list-product__content--flex-2">
							${__('Delivery Date')}
						</div>
					</div>
					${delivery_dates.map(date => `
						<div class="list-product">
							<div class="list-product__content list-product__content--flex-2">
								<label>
								<input type="checkbox" data-date="${date}" checked="checked"/>
								${frappe.datetime.str_to_user(date)}
								</label>
							</div>
						</div>
					`).join("")}
				</div>
			`);

			var wrapper = dialog.fields_dict.dates_html.$wrapper;
			wrapper.html(html);

			dialog.set_primary_action(__("Select"), function() {
				var dates = wrapper.find('input[type=checkbox]:checked')
					.map((i, el) => $(el).attr('data-date')).toArray();

				if(!dates) return;

				me.make_delivery_note(dates);
				dialog.hide();
			});
			dialog.show();
		} else {
			this.make_delivery_note();
		}
	}

	make_delivery_note(delivery_dates) {
		frappe.model.open_mapped_doc({
			method: "erpnext.selling.doctype.sales_order.sales_order.make_delivery_note",
			frm: this.frm,
			args: {
				delivery_dates
			}
		})
	}

	make_sales_invoice() {
		frappe.model.open_mapped_doc({
			method: "erpnext.selling.doctype.sales_order.sales_order.make_sales_invoice",
			frm: this.frm
		})
	}

	make_maintenance_schedule() {
		frappe.model.open_mapped_doc({
			method: "erpnext.selling.doctype.sales_order.sales_order.make_maintenance_schedule",
			frm: this.frm
		})
	}

	make_project() {
		frappe.model.open_mapped_doc({
			method: "erpnext.selling.doctype.sales_order.sales_order.make_project",
			frm: this.frm
		})
	}

	make_inter_company_order() {
		frappe.model.open_mapped_doc({
			method: "erpnext.selling.doctype.sales_order.sales_order.make_inter_company_purchase_order",
			frm: this.frm
		});
	}

	make_maintenance_visit() {
		frappe.model.open_mapped_doc({
			method: "erpnext.selling.doctype.sales_order.sales_order.make_maintenance_visit",
			frm: this.frm
		})
	}

	make_purchase_order(){
		let pending_products = this.frm.doc.products.some((product) =>{
			let pending_qty = flt(product.stock_qty) - flt(product.ordered_qty);
			return pending_qty > 0;
		})
		if(!pending_products){
			frappe.throw({message: __("Purchase Order already created for all Sales Order products"), title: __("Note")});
		}

		var me = this;
		var dialog = new frappe.ui.Dialog({
			title: __("Select Products"),
			size: "large",
			fields: [
				{
					"fieldtype": "Check",
					"label": __("Against Default Supplier"),
					"fieldname": "against_default_supplier",
					"default": 0
				},
				{
					fieldname: 'products_for_po', fieldtype: 'Table', label: 'Select Products',
					fields: [
						{
							fieldtype:'Data',
							fieldname:'product_code',
							label: __('Product'),
							read_only:1,
							in_list_view:1
						},
						{
							fieldtype:'Data',
							fieldname:'product_name',
							label: __('Product name'),
							read_only:1,
							in_list_view:1
						},
						{
							fieldtype:'Float',
							fieldname:'pending_qty',
							label: __('Pending Qty'),
							read_only: 1,
							in_list_view:1
						},
						{
							fieldtype:'Link',
							read_only:1,
							fieldname:'uom',
							label: __('UOM'),
							in_list_view:1,
						},
						{
							fieldtype:'Data',
							fieldname:'supplier',
							label: __('Supplier'),
							read_only:1,
							in_list_view:1
						},
					]
				}
			],
			primary_action_label: 'Create Purchase Order',
			primary_action (args) {
				if (!args) return;

				let selected_products = dialog.fields_dict.products_for_po.grid.get_selected_children();
				if(selected_products.length == 0) {
					frappe.throw({message: 'Please select Products from the Table', title: __('Products Required'), indicator:'blue'})
				}

				dialog.hide();

				var method = args.against_default_supplier ? "make_purchase_order_for_default_supplier" : "make_purchase_order"
				return frappe.call({
					method: "erpnext.selling.doctype.sales_order.sales_order." + method,
					freeze: true,
					freeze_message: __("Creating Purchase Order ..."),
					args: {
						"source_name": me.frm.doc.name,
						"selected_products": selected_products
					},
					freeze: true,
					callback: function(r) {
						if(!r.exc) {
							if (!args.against_default_supplier) {
								frappe.model.sync(r.message);
								frappe.set_route("Form", r.message.doctype, r.message.name);
							}
							else {
								frappe.route_options = {
									"sales_order": me.frm.doc.name
								}
								frappe.set_route("List", "Purchase Order");
							}
						}
					}
				})
			}
		});

		dialog.fields_dict["against_default_supplier"].df.onchange = () => set_po_products_data(dialog);

		function set_po_products_data (dialog) {
			var against_default_supplier = dialog.get_value("against_default_supplier");
			var products_for_po = dialog.get_value("products_for_po");

			if (against_default_supplier) {
				let products_with_supplier = products_for_po.filter((product) => product.supplier)

				dialog.fields_dict["products_for_po"].df.data = products_with_supplier;
				dialog.get_field("products_for_po").refresh();
			} else {
				let po_products = [];
				me.frm.doc.products.forEach(d => {
					let ordered_qty = me.get_ordered_qty(d, me.frm.doc);
					let pending_qty = (flt(d.stock_qty) - ordered_qty) / flt(d.conversion_factor);
					if (pending_qty > 0) {
						po_products.push({
							"doctype": "Sales Order Product",
							"name": d.name,
							"product_name": d.product_name,
							"product_code": d.product_code,
							"pending_qty": pending_qty,
							"uom": d.uom,
							"supplier": d.supplier
						});
					}
				});

				dialog.fields_dict["products_for_po"].df.data = po_products;
				dialog.get_field("products_for_po").refresh();
			}
		}

		set_po_products_data(dialog);
		dialog.get_field("products_for_po").grid.only_sortable();
		dialog.get_field("products_for_po").refresh();
		dialog.wrapper.find('.grid-heading-row .grid-row-check').click();
		dialog.show();
	}

	get_ordered_qty(product, so) {
		let ordered_qty = product.ordered_qty;
		if (so.packed_products && so.packed_products.length) {
			// calculate ordered qty based on packed products in case of product bundle
			let packed_products = so.packed_products.filter(
				(pi) => pi.parent_detail_docname == product.name
			);
			if (packed_products && packed_products.length) {
				ordered_qty = packed_products.reduce(
					(sum, pi) => sum + flt(pi.ordered_qty),
					0
				);
				ordered_qty = ordered_qty / packed_products.length;
			}
		}
		return ordered_qty;
	}

	hold_sales_order(){
		var me = this;
		var d = new frappe.ui.Dialog({
			title: __('Reason for Hold'),
			fields: [
				{
					"fieldname": "reason_for_hold",
					"fieldtype": "Text",
					"reqd": 1,
				}
			],
			primary_action: function() {
				var data = d.get_values();
				frappe.call({
					method: "frappe.desk.form.utils.add_comment",
					args: {
						reference_doctype: me.frm.doctype,
						reference_name: me.frm.docname,
						content: __('Reason for hold:') + ' ' + data.reason_for_hold,
						comment_email: frappe.session.user,
						comment_by: frappe.session.user_fullname
					},
					callback: function(r) {
						if(!r.exc) {
							me.update_status('Hold', 'On Hold')
							d.hide();
						}
					}
				});
			}
		});
		d.show();
	}
	close_sales_order(){
		this.frm.cscript.update_status("Close", "Closed")
	}
	update_status(label, status){
		var doc = this.frm.doc;
		var me = this;
		frappe.ui.form.is_saving = true;
		frappe.call({
			method: "erpnext.selling.doctype.sales_order.sales_order.update_status",
			args: {status: status, name: doc.name},
			callback: function(r){
				me.frm.reload_doc();
			},
			always: function() {
				frappe.ui.form.is_saving = false;
			}
		});
	}
};

extend_cscript(cur_frm.cscript, new erpnext.selling.SalesOrderController({frm: cur_frm}));