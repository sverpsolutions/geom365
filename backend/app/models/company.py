from sqlalchemy import Column, Integer, String, Text, Boolean, Numeric, DateTime
from app.core.database import base

class CompanySetting(base):
    __tablename__ = "company_settings"

    id = Column(Integer, primary_key=True, index=True)
    key_name = Column(String, nullable=True)
    key_value = Column(Text, nullable=True)
    
    enable_markdown_calc = Column(Boolean, default=False)

    # Channel & Markdown Pricing Engine
    enable_channel_pricing  = Column(Boolean, default=False)
    markdown_admin_only     = Column(Boolean, default=True)
    minimum_global_margin   = Column(Numeric(5, 2), default=5.00)
    default_markdown_margin = Column(Numeric(5, 2), default=25.00)

    # Global Toggles
    enable_estimate_stock_check = Column(Boolean, default=True)
    block_estimate_if_no_stock = Column(Boolean, default=False)
    block_negative_stock = Column(Boolean, default=False)  # sales / transfers may not take stock below zero
    enable_bill_modify = Column(Boolean, default=True)
    enable_excel_import = Column(Boolean, default=True)
    enable_gst = Column(Boolean, default=True)
    default_cash_sale_mode = Column(Boolean, default=True)
    low_stock_threshold = Column(Integer, default=10)
    show_product_img = Column(Boolean, default=True)
    
    # Branding
    brand_name = Column(String, nullable=True)
    ho_address = Column(Text, nullable=True)
    ho_email = Column(String, nullable=True)
    ho_phone = Column(String, nullable=True)
    logo_path = Column(String, nullable=True)
    company_cin = Column(String, nullable=True)
    company_tan = Column(String, nullable=True)
    gstin = Column(String(20), nullable=True)
    company_state = Column(String(50), nullable=True)
    item_code_format = Column(String, default="[PREFIX]-[BRAND]-[VARIANT]-[SIZE]")
    hsn_code_length = Column(Integer, default=8)
    strict_hsn_validation = Column(Boolean, default=False)

    # Company profile (from bombayfishries settings / sps_company / hr_company_settings)
    legal_name = Column(String(200))
    company_type = Column(String(40))
    company_pan = Column(String(10))
    state_code = Column(String(2))
    fssai_no = Column(String(14))
    msme_no = Column(String(30))
    iec_no = Column(String(10))
    reg_address = Column(Text)
    reg_city = Column(String(60))
    reg_state = Column(String(60))
    reg_pincode = Column(String(6))
    ho_city = Column(String(60))
    ho_pincode = Column(String(6))
    company_website = Column(String(150))
    alt_phone = Column(String(20))
    bank_account_name = Column(String(150))
    bank_name = Column(String(100))
    bank_account_no = Column(String(30))
    bank_ifsc = Column(String(11))
    bank_branch = Column(String(100))
    upi_id = Column(String(60))
    authorized_signatory = Column(String(100))
    signatory_designation = Column(String(60))
    invoice_terms = Column(Text)
    invoice_footer = Column(String(200))
    fy_start_month = Column(Integer, default=4)
    updated_at = Column(DateTime)
    updated_by = Column(Integer)
