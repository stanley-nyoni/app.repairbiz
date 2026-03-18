"""
RepairBiz — Premium Invoice PDF
Design: Dark full-width header block with business name and doc type.
        Two-tone body — white content area, light-grey sidebar for meta.
        Items table with proper description wrapping, alternating rows.
        Accent colour driven by business settings.
        Clean, professional, not boring.
"""
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
import io, os, base64
from datetime import datetime

# ── Palette ───────────────────────────────────────────────────────────────────
INK        = colors.HexColor('#0d1117')
DARK       = colors.HexColor('#1a2233')
MID        = colors.HexColor('#4a5568')
LIGHT      = colors.HexColor('#6b7a8d')
PALE       = colors.HexColor('#9aa5b4')
RULE       = colors.HexColor('#dde3ea')
BG_BODY    = colors.HexColor('#ffffff')
BG_STRIPE  = colors.HexColor('#f4f6f9')
BG_SIDEBAR = colors.HexColor('#eef1f6')
WHITE      = colors.white

STATUS_COLORS = {
    'paid':      colors.HexColor('#166534'),
    'approved':  colors.HexColor('#166534'),
    'sent':      colors.HexColor('#1e40af'),
    'partial':   colors.HexColor('#92400e'),
    'draft':     colors.HexColor('#374151'),
    'cancelled': colors.HexColor('#991b1b'),
    'rejected':  colors.HexColor('#991b1b'),
}
STATUS_BG = {
    'paid':      colors.HexColor('#dcfce7'),
    'approved':  colors.HexColor('#dcfce7'),
    'sent':      colors.HexColor('#dbeafe'),
    'partial':   colors.HexColor('#fef3c7'),
    'draft':     colors.HexColor('#f3f4f6'),
    'cancelled': colors.HexColor('#fee2e2'),
    'rejected':  colors.HexColor('#fee2e2'),
}
DOC_LABEL = {
    'invoice':       'INVOICE',
    'receipt':       'RECEIPT',
    'quotation':     'QUOTATION',
    'damage_report': 'SERVICE REPORT',
}

W, H  = A4
ML    = 18*mm
MR    = 18*mm
CW    = W - ML - MR
RIGHT = ML + CW


# ── Colour helpers ─────────────────────────────────────────────────────────────
def _accent_col(biz):
    try:
        col = (biz.get('accent_color') or '#1a2233').strip()
        if not col.startswith('#') or len(col) not in (4, 7):
            col = '#1a2233'
        return colors.HexColor(col)
    except:
        return colors.HexColor('#1a2233')

def _tint(hex_col, factor=0.88):
    """Very light tint of the accent colour."""
    try:
        c = colors.HexColor(hex_col)
        r = c.red   + (1 - c.red)   * factor
        g = c.green + (1 - c.green) * factor
        b = c.blue  + (1 - c.blue)  * factor
        return colors.Color(r, g, b)
    except:
        return BG_SIDEBAR

def _shade(col, factor=0.72):
    """Darker shade of a colour object."""
    try:
        return colors.Color(col.red * factor, col.green * factor, col.blue * factor)
    except:
        return col


# ── Drawing primitives ─────────────────────────────────────────────────────────
def _fill(c, x, y, w, h, col):
    c.setFillColor(col)
    c.rect(x, y, w, h, fill=1, stroke=0)

def _line(c, x1, y1, x2, y2, col=RULE, lw=0.4):
    c.setStrokeColor(col); c.setLineWidth(lw); c.line(x1, y1, x2, y2)

def _rect_stroke(c, x, y, w, h, col, lw=0.5):
    c.setStrokeColor(col); c.setLineWidth(lw)
    c.rect(x, y, w, h, fill=0, stroke=1)

def _txt(c, x, y, text, font='Helvetica', size=9, col=DARK, align='left'):
    text = str(text or '')
    if not text: return
    c.setFillColor(col); c.setFont(font, size)
    if   align == 'right':  c.drawRightString(x, y, text)
    elif align == 'center': c.drawCentredString(x, y, text)
    else:                   c.drawString(x, y, text)

def _bold(c, x, y, text, size=9, col=DARK, align='left'):
    _txt(c, x, y, text, 'Helvetica-Bold', size, col, align)

def _label(c, x, y, text, size=6.5, col=PALE):
    _txt(c, x, y, text.upper(), 'Helvetica', size, col)

def _fmt(n):
    try:    return f"R {float(n):,.2f}"
    except: return "R 0.00"

def _fmt_qty(n):
    try:
        v = float(n)
        return str(int(v)) if v == int(v) else f"{v:.2f}".rstrip('0').rstrip('.')
    except: return str(n)


# ── Text wrapping ──────────────────────────────────────────────────────────────
def _wrap(text, max_w, font, size, cv):
    if not text: return []
    lines = []
    for para in str(text).replace('\r\n', '\n').split('\n'):
        para = para.strip()
        if not para: lines.append(''); continue
        words = para.split(); cur = ''
        for w in words:
            test = cur + (' ' if cur else '') + w
            if cv.stringWidth(test, font, size) <= max_w: cur = test
            else:
                if cur: lines.append(cur)
                cur = w
        if cur: lines.append(cur)
    return lines or []


# ── Public entry ───────────────────────────────────────────────────────────────
def generate_pdf(doc, biz, items):
    buf = io.BytesIO()
    cv  = canvas.Canvas(buf, pagesize=A4)
    cv.setTitle(f"{DOC_LABEL.get(doc.get('doc_type',''), 'DOCUMENT')} {doc.get('doc_number','')}")
    _draw_page(cv, doc, biz, items)
    cv.save(); buf.seek(0)
    return buf.read()


# ── Full page ──────────────────────────────────────────────────────────────────
def _draw_page(cv, doc, biz, items):
    doc_type   = doc.get('doc_type', 'invoice')
    doc_number = doc.get('doc_number', '')
    status     = doc.get('status', 'draft')
    pay_status = doc.get('payment_status') or ''
    label      = DOC_LABEL.get(doc_type, 'DOCUMENT')
    is_damage  = doc_type == 'damage_report'

    disp_status = 'partial' if pay_status == 'partial' else status

    AC     = _accent_col(biz)
    AC_HEX = biz.get('accent_color') or '#1a2233'
    AC_LT  = _tint(AC_HEX, 0.90)
    AC_LT2 = _tint(AC_HEX, 0.94)
    AC_DK  = _shade(AC, 0.72)

    # ── HEADER BLOCK ──────────────────────────────────────────────────────────
    HEADER_H = 50*mm
    _fill(cv, 0, H - HEADER_H, W, HEADER_H, AC)

    # Decorative diagonal band (right side, subtle)
    cv.saveState()
    cv.setFillColor(colors.Color(0, 0, 0, alpha=0.08))
    p = cv.beginPath()
    p.moveTo(W * 0.58, H)
    p.lineTo(W,        H)
    p.lineTo(W,        H - HEADER_H)
    p.lineTo(W * 0.74, H - HEADER_H)
    p.close()
    cv.drawPath(p, fill=1, stroke=0)
    cv.restoreState()

    # Logo
    logo_right = ML
    logo_path  = biz.get('logo_path', '')
    if logo_path and os.path.exists(logo_path):
        try:
            lh = 15*mm; lw = 36*mm
            ly = H - HEADER_H + (HEADER_H - lh) / 2
            cv.drawImage(logo_path, ML, ly, width=lw, height=lh,
                         preserveAspectRatio=True, mask='auto')
            logo_right = ML + lw + 5*mm
        except: pass

    # Business name & contact
    _bold(cv, logo_right, H - 13*mm, str(biz.get('business_name','') or ''), 15, WHITE)
    biz_sub = [x for x in [biz.get('phone',''), biz.get('email','')] if x]
    if biz_sub:
        _txt(cv, logo_right, H - 19.5*mm, '   ·   '.join(biz_sub), 'Helvetica', 7.5,
             colors.Color(1,1,1,0.60))
    if biz.get('address'):
        _txt(cv, logo_right, H - 25*mm, str(biz['address'])[:80], 'Helvetica', 7,
             colors.Color(1,1,1,0.45))

    # Doc type — big ghost text + solid
    _bold(cv, RIGHT, H - 10*mm, label, 28,
          colors.Color(1,1,1,0.10), 'right')
    _bold(cv, RIGHT, H - 18*mm, label, 17, WHITE, 'right')
    _txt(cv, RIGHT, H - 24.5*mm, doc_number, 'Helvetica', 8.5,
         colors.Color(1,1,1,0.60), 'right')

    # Status badge
    s_text  = disp_status.upper().replace('_', ' ')
    s_col   = STATUS_COLORS.get(disp_status, PALE)
    s_bg    = STATUS_BG.get(disp_status, BG_STRIPE)
    s_w     = cv.stringWidth(s_text, 'Helvetica-Bold', 7.5) + 9*mm
    s_x     = RIGHT - s_w
    s_y     = H - HEADER_H + 5*mm
    _fill(cv, s_x, s_y, s_w, 5.5*mm, s_bg)
    _txt(cv, s_x + 4.5*mm, s_y + 1.8*mm, s_text, 'Helvetica-Bold', 7.5, s_col)

    y = H - HEADER_H

    # ── META BAND (Bill To + Doc Details) ────────────────────────────────────
    META_H = 40*mm
    SPLIT  = ML + CW * 0.52

    _fill(cv, 0,        y - META_H, SPLIT,      META_H, BG_BODY)
    _fill(cv, SPLIT,    y - META_H, W - SPLIT,  META_H, AC_LT)

    # "Bill To"
    bt_y = y - 7.5*mm
    _label(cv, ML, bt_y, 'Bill To', 6.5, PALE)
    bt_y -= 5*mm
    _bold(cv, ML, bt_y, str(doc.get('customer_name','') or ''), 11, INK)
    bt_y -= 5.5*mm
    for fld in [doc.get('customer_phone',''), doc.get('customer_email',''), doc.get('customer_address','')]:
        if fld:
            _txt(cv, ML, bt_y, str(fld)[:60], 'Helvetica', 8, MID)
            bt_y -= 4.5*mm
    if doc.get('customer_tax_reg_no'):
        _txt(cv, ML, bt_y, f"Tax Reg: {doc['customer_tax_reg_no']}", 'Helvetica', 7.5, LIGHT)

    # Doc meta (right)
    mx  = SPLIT + 5*mm
    mvx = RIGHT - 3*mm
    m_y = y - 7.5*mm

    amount_paid = float(doc.get('amount_paid') or 0)
    total_val   = float(doc.get('total') or 0)
    meta_rows   = [('Document No.', doc_number), ('Date Issued', doc.get('issue_date') or '')]
    if doc.get('due_date'):
        meta_rows.append(('Due Date', doc['due_date']))
    if pay_status == 'partial' and amount_paid > 0:
        meta_rows.append(('Amount Paid', _fmt(amount_paid)))
        meta_rows.append(('Balance Due', _fmt(max(0, total_val - amount_paid))))

    for lbl, val in meta_rows:
        _label(cv, mx, m_y, lbl, 6.5, AC_DK)
        _bold(cv, mvx, m_y, str(val), 8.5, INK, 'right')
        m_y -= 6.5*mm

    y -= META_H

    # Thin full-width accent rule
    _fill(cv, 0, y - 0.8, W, 0.8, AC)
    y -= 0.8

    # ── ITEMS TABLE ───────────────────────────────────────────────────────────
    if not is_damage:
        y = _items_table(cv, doc, items, y, AC, AC_LT, AC_LT2, AC_DK)
    else:
        y = _damage_section(cv, doc, y, AC, AC_LT, AC_DK)

    # ── BANKING ───────────────────────────────────────────────────────────────
    bank_fields = [
        ('Bank',           doc.get('bank_name','')),
        ('Account Holder', doc.get('bank_account_holder','')),
        ('Account No.',    doc.get('bank_account_number','')),
        ('Branch Code',    doc.get('bank_branch_code','')),
        ('Reference',      doc.get('bank_reference','')),
    ]
    vis_bank = [(l,v) for l,v in bank_fields if v]
    if vis_bank and doc_type in ('invoice','quotation','receipt'):
        y = _banking_block(cv, vis_bank, y, AC, AC_LT)

    # ── NOTES ────────────────────────────────────────────────────────────────
    if doc.get('notes') and y > 50*mm:
        y = _text_block(cv, 'Notes', doc['notes'], y, AC, 8.5, MID)

    # ── TERMS ────────────────────────────────────────────────────────────────
    if doc.get('terms') and y > 44*mm:
        y = _text_block(cv, 'Terms & Conditions', doc['terms'], y, AC, 7.5, LIGHT)

    # ── SIGNATURE ────────────────────────────────────────────────────────────
    sig_data = doc.get('signature_data','')
    show_sig = biz.get('pdf_show_signature', 0)
    if (sig_data or show_sig) and y > 42*mm:
        y = _signature_block(cv, sig_data, y, AC)

    # ── FOOTER ───────────────────────────────────────────────────────────────
    _footer(cv, doc_number, biz, AC, AC_LT)


# ── Items table ────────────────────────────────────────────────────────────────
def _items_table(cv, doc, items, y, AC, AC_LT, AC_LT2, AC_DK):
    if not items: return y
    y -= 5*mm

    # Column definitions: (x_start, width, header_label, number_alignment)
    DESC_X = ML;             DESC_W = CW * 0.44
    QTY_X  = ML + CW*0.44;  QTY_W  = CW * 0.10
    UP_X   = ML + CW*0.54;  UP_W   = CW * 0.22
    AMT_X  = ML + CW*0.76;  AMT_W  = CW * 0.24

    HDR_H  = 7.5*mm
    LH     = 4.0*mm    # text line height
    PAD_V  = 2.8*mm    # top/bottom row padding

    # Header
    _fill(cv, ML, y - HDR_H, CW, HDR_H, AC)
    hy = y - HDR_H + 2.5*mm
    _txt(cv, ML + 4*mm,           hy, 'DESCRIPTION', 'Helvetica-Bold', 7, WHITE)
    _txt(cv, QTY_X + QTY_W/2,    hy, 'QTY',         'Helvetica-Bold', 7, WHITE, 'center')
    _txt(cv, UP_X  + UP_W - 2*mm, hy, 'UNIT PRICE',  'Helvetica-Bold', 7, WHITE, 'right')
    _txt(cv, AMT_X + AMT_W - 2*mm,hy, 'AMOUNT',      'Helvetica-Bold', 7, WHITE, 'right')
    y -= HDR_H

    for idx, item in enumerate(items):
        name  = str(item.get('item_name','') or '').strip()
        desc  = str(item.get('description','') or '').strip()
        qty   = item.get('quantity', 1)
        upr   = float(item.get('unit_price', 0) or 0)
        tot   = float(item.get('total', 0) or 0)

        wrap_w      = DESC_W - 7*mm
        name_lines  = _wrap(name, wrap_w, 'Helvetica-Bold', 8.5, cv) or ['']
        desc_lines  = _wrap(desc, wrap_w, 'Helvetica',      7.5, cv) if desc else []

        n_lines = len(name_lines) + len(desc_lines)
        row_h   = PAD_V + n_lines * LH + PAD_V + 1*mm
        row_h   = max(row_h, 10*mm)

        # Row background (alternating)
        row_bg = BG_STRIPE if idx % 2 == 0 else BG_BODY
        _fill(cv, ML, y - row_h, CW, row_h, row_bg)

        # Left accent tab
        tab_col = AC_LT if idx % 2 == 0 else RULE
        _fill(cv, ML, y - row_h, 3, row_h, tab_col)

        # Draw name lines
        ty = y - PAD_V
        for ln in name_lines:
            _txt(cv, ML + 5*mm, ty - LH + 1*mm, ln, 'Helvetica-Bold', 8.5, INK)
            ty -= LH

        # Draw description lines (indented, smaller, muted)
        for ln in desc_lines:
            _txt(cv, ML + 6*mm, ty - LH + 1*mm, ln, 'Helvetica', 7.5, LIGHT)
            ty -= LH

        # Numeric columns — vertically centred in row
        num_y = y - row_h / 2 - 1.5*mm

        _txt(cv, QTY_X + QTY_W/2,     num_y, _fmt_qty(qty), 'Helvetica',      8.5, MID, 'center')
        _txt(cv, UP_X  + UP_W - 2*mm,  num_y, _fmt(upr),     'Helvetica',      8.5, MID, 'right')
        _bold(cv, AMT_X + AMT_W - 2*mm, num_y, _fmt(tot),    8.5,              INK, 'right')

        # Row bottom divider
        _line(cv, ML + 4*mm, y - row_h, RIGHT, y - row_h, RULE, 0.3)

        y -= row_h

    y -= 3*mm

    # ── Totals ────────────────────────────────────────────────────────────────
    subtotal    = float(doc.get('subtotal',   0) or 0)
    tax_rate    = float(doc.get('tax_rate',   0) or 0)
    tax_amount  = float(doc.get('tax_amount', 0) or 0)
    total_due   = float(doc.get('total',      0) or 0)
    amount_paid = float(doc.get('amount_paid',0) or 0)
    pay_status  = doc.get('payment_status','')

    TX  = ML + CW * 0.56
    TVX = RIGHT
    TW  = TVX - TX
    TRH = 5.5*mm   # totals row height

    def _trow(lbl, val_str, bg=BG_STRIPE, tc=INK, bold_val=False):
        nonlocal y
        _fill(cv, TX, y - TRH, TW, TRH, bg)
        _txt(cv, TX + 3*mm, y - TRH + 1.8*mm, lbl, 'Helvetica', 8, MID)
        fn = 'Helvetica-Bold' if bold_val else 'Helvetica'
        _txt(cv, TVX - 2*mm, y - TRH + 1.8*mm, val_str, fn, 8, tc, 'right')
        y -= TRH

    _trow('Subtotal', _fmt(subtotal))
    if tax_rate:
        _trow(f'VAT  {tax_rate:.0f}%', _fmt(tax_amount))

    # Grand total — full accent background, larger text
    GT_H = 9*mm
    _fill(cv, TX, y - GT_H, TW, GT_H, AC)
    _txt(cv, TX + 3*mm, y - GT_H + 3*mm, 'TOTAL DUE', 'Helvetica-Bold', 9,  WHITE)
    _txt(cv, TVX - 2*mm, y - GT_H + 3*mm, _fmt(total_due), 'Helvetica-Bold', 12, WHITE, 'right')
    y -= GT_H

    if pay_status == 'partial' and amount_paid > 0:
        _trow('Amount Paid',  _fmt(amount_paid), bg=AC_LT2, tc=colors.HexColor('#166534'), bold_val=True)
        bal_col = colors.HexColor('#991b1b')
        _trow('Balance Due',  _fmt(max(0, total_due - amount_paid)), bg=colors.HexColor('#fef2f2'), tc=bal_col, bold_val=True)

    y -= 7*mm
    return y


# ── Damage report section ──────────────────────────────────────────────────────
def _damage_section(cv, doc, y, AC, AC_LT, AC_DK):
    y -= 5*mm

    app_rows = [
        ('Appliance Type', doc.get('appliance_type','')),
        ('Brand',          doc.get('appliance_brand','')),
        ('Model Number',   doc.get('model_number','')),
        ('Serial Number',  doc.get('serial_number','')),
    ]
    present = [(l,v) for l,v in app_rows if v]
    if present:
        HDR_H = 7*mm
        _fill(cv, ML, y - HDR_H, CW, HDR_H, AC)
        _txt(cv, ML + 4*mm, y - HDR_H + 2.5*mm, 'APPLIANCE DETAILS', 'Helvetica-Bold', 7, WHITE)
        y -= HDR_H

        col_w   = CW / 2
        n_rows  = (len(present) + 1) // 2
        grid_h  = n_rows * 11*mm + 5*mm
        _fill(cv, ML, y - grid_h, CW, grid_h, BG_STRIPE)
        _fill(cv, ML, y - grid_h, 3,  grid_h, AC_LT)

        for idx, (lbl, val) in enumerate(present):
            cx = ML + (idx % 2) * col_w + 5*mm
            ry = y - (idx // 2) * 11*mm - 4.5*mm
            _label(cv, cx, ry, lbl, 6.5, PALE)
            _bold(cv,  cx, ry - 5*mm, str(val), 9, INK)

        y -= grid_h + 4*mm

    for fld_label, fld_key in [('Problem Description','problem_description'),('Technician Notes','technician_notes')]:
        val = str(doc.get(fld_key,'') or '').strip()
        if not val: continue

        HDR_H = 6.5*mm
        _fill(cv, ML, y - HDR_H, CW, HDR_H, AC_LT)
        _fill(cv, ML, y - HDR_H, 3,  HDR_H, AC)
        _label(cv, ML + 5*mm, y - HDR_H + 2*mm, fld_label, 6.5, AC_DK)
        y -= HDR_H

        lines   = _wrap(val, CW - 10*mm, 'Helvetica', 9, cv)
        blk_h   = len(lines) * 4.6*mm + 6*mm
        _fill(cv, ML, y - blk_h, CW, blk_h, BG_BODY)
        _fill(cv, ML, y - blk_h, 3,  blk_h, AC_LT)
        ty = y - 4*mm
        for ln in lines:
            if ty < 30*mm: break
            _txt(cv, ML + 5*mm, ty, ln, 'Helvetica', 9, MID)
            ty -= 4.6*mm
        y -= blk_h + 3*mm

    if doc.get('estimated_cost'):
        ec = float(doc['estimated_cost'])
        _fill(cv, ML, y - 10*mm, CW, 10*mm, AC)
        _txt(cv, ML + 4*mm, y - 10*mm + 3.5*mm, 'ESTIMATED REPAIR COST', 'Helvetica-Bold', 7, colors.Color(1,1,1,0.65))
        _txt(cv, RIGHT - 3*mm, y - 10*mm + 3.5*mm, _fmt(ec), 'Helvetica-Bold', 14, WHITE, 'right')
        y -= 10*mm + 5*mm

    return y


# ── Banking block ──────────────────────────────────────────────────────────────
def _banking_block(cv, vis_bank, y, AC, AC_LT):
    y -= 4*mm
    HDR_H = 6.5*mm
    _fill(cv, ML, y - HDR_H, CW, HDR_H, AC_LT)
    _fill(cv, ML, y - HDR_H, 3,  HDR_H, AC)
    _label(cv, ML + 5*mm, y - HDR_H + 2.2*mm, 'Banking Details — Payment Information', 6.5, PALE)
    y -= HDR_H

    col_w  = CW / 3
    n_rows = (len(vis_bank) + 2) // 3
    blk_h  = n_rows * 11*mm + 5*mm
    _fill(cv, ML, y - blk_h, CW, blk_h, BG_STRIPE)
    _fill(cv, ML, y - blk_h, 3,  blk_h, AC_LT)

    for idx, (lbl, val) in enumerate(vis_bank):
        cx = ML + (idx % 3) * col_w + 5*mm
        ry = y - (idx // 3) * 11*mm - 4.5*mm
        _label(cv, cx, ry,        lbl, 6.5, PALE)
        _bold(cv,  cx, ry - 5*mm, str(val), 8.5, INK)

    y -= blk_h + 5*mm
    return y


# ── Generic text block (Notes / Terms) ────────────────────────────────────────
def _text_block(cv, title, text, y, AC, size=8.5, col=MID):
    y -= 3*mm
    HDR_H = 6*mm
    _fill(cv, ML, y - HDR_H, CW, HDR_H, BG_STRIPE)
    _fill(cv, ML, y - HDR_H, 3,  HDR_H, AC)
    _label(cv, ML + 5*mm, y - HDR_H + 2*mm, title, 6.5, PALE)
    y -= HDR_H

    lines = _wrap(str(text), CW - 10*mm, 'Helvetica', size, cv)
    blk_h = len(lines) * (size * 1.45) + 6*mm
    _fill(cv, ML, y - blk_h, CW, blk_h, BG_BODY)
    _fill(cv, ML, y - blk_h, 3,  blk_h, AC)

    ty = y - 3.5*mm
    for ln in lines:
        if ty < 28*mm: break
        _txt(cv, ML + 5*mm, ty, ln, 'Helvetica', size, col)
        ty -= size * 1.45
    y -= blk_h + 3*mm
    return y


# ── Signature block ────────────────────────────────────────────────────────────
def _signature_block(cv, sig_data, y, AC):
    y -= 4*mm
    HDR_H = 6*mm
    SIG_W = 60*mm
    SIG_H = 20*mm

    _fill(cv, ML, y - HDR_H, CW, HDR_H, BG_STRIPE)
    _fill(cv, ML, y - HDR_H, 3,  HDR_H, AC)
    _label(cv, ML + 5*mm, y - HDR_H + 2*mm, 'Customer Signature', 6.5, PALE)
    y -= HDR_H

    _fill(cv, ML, y - SIG_H - 3*mm, SIG_W + 5*mm, SIG_H + 3*mm, BG_BODY)
    _rect_stroke(cv, ML + 1*mm, y - SIG_H - 1*mm, SIG_W + 2*mm, SIG_H, RULE, 0.5)

    if sig_data and sig_data.startswith('data:image'):
        try:
            _, b64 = sig_data.split(',', 1)
            img_buf = io.BytesIO(base64.b64decode(b64))
            cv.drawImage(img_buf, ML + 2*mm, y - SIG_H,
                         width=SIG_W, height=SIG_H - 2*mm,
                         preserveAspectRatio=True, mask='auto')
        except: pass

    _label(cv, ML + 2*mm, y - SIG_H - 0.8*mm, 'Authorised Signature', 6, PALE)
    y -= SIG_H + 8*mm
    return y


# ── Footer ─────────────────────────────────────────────────────────────────────
def _footer(cv, doc_number, biz, AC, AC_LT):
    FOOT_H  = 14*mm
    STRIP_H = 3.5*mm

    _fill(cv, 0, 0,       W, STRIP_H, AC)
    _fill(cv, 0, STRIP_H, W, FOOT_H,  AC_LT)

    footer_msg = str(biz.get('footer_message') or 'Thank you for your business.').strip()
    mid_x = W / 2

    _txt(cv, ML,    STRIP_H + 8*mm,   f"Generated  {datetime.now().strftime('%d %b %Y')}", 'Helvetica', 7, PALE)
    _bold(cv, mid_x, STRIP_H + 8*mm,  footer_msg[:90], 7.5, MID, 'center')
    _txt(cv, RIGHT,  STRIP_H + 8*mm,  doc_number, 'Helvetica', 7, PALE, 'right')
    _txt(cv, mid_x,  STRIP_H + 3.5*mm,'Powered by RepairBiz', 'Helvetica', 6, PALE, 'center')