from flask import Flask, request, jsonify, send_file, send_from_directory
import sqlite3, hashlib, hmac, os, json, jwt, uuid, io, secrets, string, smtplib, ssl, random, threading
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from functools import wraps
from pdf_generator import generate_pdf

app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'repairbiz-secret-2026-change-in-prod')
DB_PATH = '/data/repairbiz.db' if os.path.isdir('/data') else 'repairbiz.db'
UPLOAD_FOLDER = '/data/uploads' if os.path.isdir('/data') else 'static/uploads'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
ADMIN_KEY = os.environ.get('ADMIN_KEY', 'admin-repairbiz-2026')

# Email config
SMTP_HOST    = os.environ.get('SMTP_HOST', 'smtp.gmail.com')
SMTP_PORT    = int(os.environ.get('SMTP_PORT', '587'))
SMTP_USER    = os.environ.get('SMTP_USER', '')
SMTP_PASS    = os.environ.get('SMTP_PASS', '')
SMTP_FROM    = os.environ.get('SMTP_FROM', SMTP_USER)
EMAIL_ENABLED = bool(SMTP_USER and SMTP_PASS)

PLANS = {
    'starter': {'name':'Starter','price':99,'docs_per_month':50,'customers':100},
    'pro':     {'name':'Pro',    'price':179,'docs_per_month':300,'customers':500},
    'business':{'name':'Business','price':399,'docs_per_month':9999,'customers':9999},
}

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    with get_db() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS businesses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
            business_name TEXT NOT NULL, phone TEXT, address TEXT, logo_path TEXT,
            bank_name TEXT, bank_account_holder TEXT, bank_account_number TEXT,
            bank_branch_code TEXT, bank_reference TEXT,
            terms TEXT DEFAULT 'Payment due within 7 days of invoice date.
All repairs carry a 30-day warranty on parts and labour.
The business is not liable for pre-existing damage.',
            plan TEXT DEFAULT 'trial', trial_expires_at TEXT,
            license_expires_at TEXT, license_code TEXT,
            is_active INTEGER DEFAULT 1, login_count INTEGER DEFAULT 0,
            last_login_at TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS license_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL, plan TEXT NOT NULL, months INTEGER DEFAULT 1,
            business_id INTEGER, used_at TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, notes TEXT,
            FOREIGN KEY(business_id) REFERENCES businesses(id)
        );
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_id INTEGER NOT NULL, name TEXT NOT NULL,
            phone TEXT, email TEXT, address TEXT, tax_reg_no TEXT, notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_id INTEGER NOT NULL, doc_number TEXT NOT NULL,
            doc_type TEXT NOT NULL CHECK(doc_type IN ('invoice','receipt','quotation','damage_report')),
            customer_name TEXT NOT NULL, customer_phone TEXT, customer_email TEXT,
            customer_address TEXT, customer_tax_reg_no TEXT,
            issue_date TEXT NOT NULL, due_date TEXT, status TEXT DEFAULT 'draft',
            subtotal REAL DEFAULT 0, tax_rate REAL DEFAULT 0,
            tax_amount REAL DEFAULT 0, total REAL DEFAULT 0,
            notes TEXT, appliance_type TEXT, appliance_brand TEXT,
            model_number TEXT, serial_number TEXT, problem_description TEXT,
            technician_notes TEXT, estimated_cost REAL,
            bank_name TEXT, bank_account_holder TEXT, bank_account_number TEXT,
            bank_branch_code TEXT, bank_reference TEXT, terms TEXT,
            signature_data TEXT, amount_paid REAL DEFAULT 0,
            payment_status TEXT DEFAULT 'unpaid',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(business_id) REFERENCES businesses(id),
            UNIQUE(business_id, doc_number)
        );
        CREATE TABLE IF NOT EXISTS document_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL,
            item_name TEXT NOT NULL, description TEXT,
            quantity REAL NOT NULL DEFAULT 1, unit_price REAL NOT NULL DEFAULT 0,
            total REAL NOT NULL DEFAULT 0,
            FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS document_photos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id INTEGER NOT NULL, file_path TEXT NOT NULL,
            FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_id INTEGER NOT NULL, document_id INTEGER NOT NULL,
            amount REAL NOT NULL, method TEXT DEFAULT 'cash',
            reference TEXT, note TEXT, paid_at TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE,
            FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_id INTEGER NOT NULL, description TEXT NOT NULL,
            amount REAL NOT NULL, category TEXT DEFAULT 'General',
            vendor TEXT, expense_date TEXT NOT NULL, notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS job_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_id INTEGER NOT NULL, name TEXT NOT NULL,
            doc_type TEXT DEFAULT 'invoice', notes TEXT, tax_rate REAL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS job_template_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL,
            item_name TEXT NOT NULL, description TEXT,
            quantity REAL DEFAULT 1, unit_price REAL DEFAULT 0,
            FOREIGN KEY(template_id) REFERENCES job_templates(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS catalogue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_id INTEGER NOT NULL, item_name TEXT NOT NULL,
            description TEXT, unit_price REAL NOT NULL DEFAULT 0,
            category TEXT DEFAULT 'General',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS doc_sequences (
            business_id INTEGER NOT NULL,
            doc_type    TEXT NOT NULL,
            year        TEXT NOT NULL,
            last_n      INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (business_id, doc_type, year)
        );
        ''')
        # Migrations
        existing_biz = [r[1] for r in db.execute('PRAGMA table_info(businesses)').fetchall()]
        for col, dtype in [
            ('plan','TEXT DEFAULT "trial"'),('trial_expires_at','TEXT'),
            ('license_expires_at','TEXT'),('license_code','TEXT'),
            ('is_active','INTEGER DEFAULT 1'),('login_count','INTEGER DEFAULT 0'),
            ('last_login_at','TEXT'),('email_verified','INTEGER DEFAULT 0'),
            ('otp_code','TEXT'),('otp_expires_at','TEXT'),
            ('accent_color','TEXT DEFAULT "#1a2233"'),
            ('doc_number_format','TEXT DEFAULT "{PREFIX}-{N:05d}"'),
            ('invoice_prefix','TEXT DEFAULT "INV"'),('receipt_prefix','TEXT DEFAULT "REC"'),
            ('quotation_prefix','TEXT DEFAULT "QUO"'),('report_prefix','TEXT DEFAULT "REP"'),
            ('footer_message','TEXT DEFAULT "Thank you for your business."'),
            ('pdf_show_signature','INTEGER DEFAULT 0'),
        ]:
            if col not in existing_biz:
                db.execute(f'ALTER TABLE businesses ADD COLUMN {col} {dtype}')
        existing_docs = [r[1] for r in db.execute('PRAGMA table_info(documents)').fetchall()]
        for col, dtype in [
            ('customer_email','TEXT'),('customer_tax_reg_no','TEXT'),
            ('signature_data','TEXT'),('amount_paid','REAL DEFAULT 0'),
            ('payment_status','TEXT DEFAULT "unpaid"'),
        ]:
            if col not in existing_docs:
                db.execute(f'ALTER TABLE documents ADD COLUMN {col} {dtype}')
        db.commit()

init_db()

# ── Email ──────────────────────────────────────────────────────────────────────
def send_email(to_addr, subject, html_body, text_body=None):
    """Send email via SendGrid HTTPS API — works on Railway."""
    SENDGRID_KEY = os.environ.get('SENDGRID_API_KEY', '')

    if not SENDGRID_KEY:
        print(f"\n{'='*52}\n[EMAIL DEV MODE]\nTo: {to_addr}\nSubject: {subject}\n{text_body or html_body}\n{'='*52}\n")
        return True

    def _send():
        import urllib.request
        import json as _json
        from_email = SMTP_FROM or SMTP_USER or 'noreply@repairbiz.co.za'
        payload = {
            "personalizations": [{"to": [{"email": to_addr}]}],
            "from": {"email": from_email, "name": "RepairBiz"},
            "subject": subject,
            "content": [
                {"type": "text/plain",
                 "value": text_body or "Please view this email in an HTML client."},
                {"type": "text/html", "value": html_body},
            ]
        }
        try:
            req = urllib.request.Request(
                "https://api.sendgrid.com/v3/mail/send",
                data=_json.dumps(payload).encode('utf-8'),
                headers={
                    "Authorization": f"Bearer {SENDGRID_KEY}",
                    "Content-Type":  "application/json",
                },
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                print(f"[EMAIL SENT] To: {to_addr} Status: {resp.status}")
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='ignore')
            print(f"[EMAIL ERROR] SendGrid HTTP {e.code}: {body}")
        except Exception as e:
            print(f"[EMAIL ERROR] SendGrid failed: {e}")

    threading.Thread(target=_send, daemon=True).start()
    return True

def gen_otp(): return str(random.randint(100000, 999999))

def send_otp_email(to, biz_name, otp):
    html = f"""<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
      <div style="background:#1a2233;border-radius:12px;padding:28px 24px;text-align:center;margin-bottom:24px">
        <h1 style="color:#fff;font-size:22px;margin:0 0 4px">RepairBiz</h1>
        <p style="color:rgba(255,255,255,0.55);font-size:13px;margin:0">Professional Invoicing</p>
      </div>
      <h2 style="color:#1a2233;font-size:18px;margin:0 0 12px">Verify your email address</h2>
      <p style="color:#4a5568;font-size:14px;line-height:1.6;margin:0 0 24px">
        Hi <strong>{biz_name}</strong>, welcome to RepairBiz!<br>
        Enter this code to activate your 30-day free trial:
      </p>
      <div style="background:#f4f6f9;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;border:2px dashed #dde3ea">
        <span style="font-size:42px;font-weight:800;letter-spacing:10px;color:#1a2233;font-family:monospace">{otp}</span>
        <p style="color:#9aa5b4;font-size:12px;margin:12px 0 0">Expires in <strong>15 minutes</strong></p>
      </div>
      <p style="color:#9aa5b4;font-size:12px">If you didn't register, ignore this email.<br>
      Help: <a href="mailto:info@stanleybytes.co.za" style="color:#1a2233">info@stanleybytes.co.za</a> · 061 144 0669</p>
    </div>"""
    send_email(to, f"Your RepairBiz code: {otp}", html,
               f"RepairBiz verification code: {otp}\n\nExpires in 15 minutes.")

def send_welcome_email(to, biz_name):
    html = f"""<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
      <div style="background:#1a2233;border-radius:12px;padding:28px 24px;text-align:center;margin-bottom:24px">
        <h1 style="color:#fff;font-size:22px;margin:0">RepairBiz</h1>
      </div>
      <h2 style="color:#1a2233;font-size:18px;margin:0 0 12px">Welcome, {biz_name}! 🎉</h2>
      <p style="color:#4a5568;font-size:14px;line-height:1.6;margin:0 0 16px">Your 30-day free trial has started. Get set up:</p>
      <ol style="color:#4a5568;font-size:14px;line-height:2;padding-left:20px;margin:0 0 24px">
        <li>Upload your logo in <strong>Settings</strong></li>
        <li>Add your banking details</li>
        <li>Save common services in <strong>Services &amp; Parts</strong></li>
        <li>Create your first invoice and WhatsApp it to a customer</li>
      </ol>
      <p style="color:#4a5568;font-size:14px">Questions? WhatsApp <strong>061 144 0669</strong></p>
      <p style="color:#9aa5b4;font-size:12px;margin-top:24px">StanleyBytes · info@stanleybytes.co.za</p>
    </div>"""
    send_email(to, "Welcome to RepairBiz — your trial has started!", html)

# ── Auth helpers ───────────────────────────────────────────────────────────────
def hash_password(p):
    salt = os.urandom(16).hex()
    h = hashlib.pbkdf2_hmac('sha256', p.encode(), salt.encode(), 310000)
    return f"{salt}${h.hex()}"

def verify_password(p, stored):
    try:
        salt, h = stored.split('$')
        return hmac.compare_digest(h, hashlib.pbkdf2_hmac('sha256', p.encode(), salt.encode(), 310000).hex())
    except: return False

def create_token(bid):
    return jwt.encode({'business_id':bid,'exp':datetime.utcnow()+timedelta(days=90)},
                      app.config['SECRET_KEY'], algorithm='HS256')

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        tok = request.headers.get('Authorization','').replace('Bearer ','')
        if not tok: return jsonify({'error':'Token required'}), 401
        try:
            data = jwt.decode(tok, app.config['SECRET_KEY'], algorithms=['HS256'])
            request.business_id = data['business_id']
        except jwt.ExpiredSignatureError: return jsonify({'error':'Token expired'}), 401
        except: return jsonify({'error':'Invalid token'}), 401
        return f(*args, **kwargs)
    return decorated

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        key = request.headers.get('X-Admin-Key','') or request.args.get('admin_key','')
        if key != ADMIN_KEY: return jsonify({'error':'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated

def get_account_status(biz):
    if not biz['is_active']: return 'suspended'
    plan = biz['plan'] or 'trial'
    if plan == 'trial':
        exp = biz['trial_expires_at']
        if not exp: return 'trial'
        return 'expired' if datetime.now() > datetime.fromisoformat(exp) else 'trial'
    exp = biz['license_expires_at']
    if exp and datetime.now() > datetime.fromisoformat(exp): return 'expired'
    return 'active'

def check_subscription(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        with get_db() as db:
            biz = db.execute('SELECT * FROM businesses WHERE id=?',(request.business_id,)).fetchone()
        status = get_account_status(biz)
        if status in ('expired','suspended'):
            return jsonify({'error':'subscription_required','status':status}), 402
        return f(*args, **kwargs)
    return decorated

PREFIXES = {'invoice':'INV','receipt':'REC','quotation':'QUO','damage_report':'REP'}

def next_doc_number(db, business_id, doc_type):
    biz    = db.execute('SELECT * FROM businesses WHERE id=?',(business_id,)).fetchone()
    prefix = {
        'invoice':       biz['invoice_prefix']  or 'INV',
        'receipt':       biz['receipt_prefix']  or 'REC',
        'quotation':     biz['quotation_prefix'] or 'QUO',
        'damage_report': biz['report_prefix']    or 'REP',
    }.get(doc_type, 'DOC')
    year = datetime.now().strftime('%Y')
    db.execute(
        'INSERT OR IGNORE INTO doc_sequences (business_id,doc_type,year,last_n) VALUES (?,?,?,0)',
        (business_id, doc_type, year))
    db.execute(
        'UPDATE doc_sequences SET last_n=last_n+1 WHERE business_id=? AND doc_type=? AND year=?',
        (business_id, doc_type, year))
    n = db.execute(
        'SELECT last_n FROM doc_sequences WHERE business_id=? AND doc_type=? AND year=?',
        (business_id, doc_type, year)).fetchone()['last_n']
    fmt = biz['doc_number_format'] or '{PREFIX}-{N:05d}'
    try:
        return (fmt
                .replace('{PREFIX}', prefix)
                .replace('{YEAR}',   year)
                .replace('{N:05d}',  f'{n:05d}')
                .replace('{N}',      str(n)))
    except:
        return f"{prefix}-{year}-{n:05d}"

def _biz_dict(b):
    keys = ['id','email','business_name','phone','address','logo_path',
            'bank_name','bank_account_holder','bank_account_number',
            'bank_branch_code','bank_reference','terms','plan',
            'trial_expires_at','license_expires_at','login_count','created_at',
            'email_verified','accent_color','doc_number_format','footer_message',
            'invoice_prefix','receipt_prefix','quotation_prefix','report_prefix',
            'pdf_show_signature','last_login_at','is_active']
    d = {k: b[k] for k in keys if k in b.keys()}
    d['account_status'] = get_account_status(b)
    if d['account_status']=='trial' and b['trial_expires_at']:
        d['days_remaining'] = max(0,(datetime.fromisoformat(b['trial_expires_at'])-datetime.now()).days)
    elif d['account_status']=='active' and b['license_expires_at']:
        d['days_remaining'] = max(0,(datetime.fromisoformat(b['license_expires_at'])-datetime.now()).days)
    else: d['days_remaining'] = 0
    d['plan_info'] = PLANS.get(d['plan'], PLANS['starter'])
    return d

def _doc_dict(doc, items=None, photos=None):
    d = dict(doc)
    if items is not None:  d['items']  = [dict(i) for i in items]
    if photos is not None: d['photos'] = [p['file_path'] for p in photos]
    try:
        if d.get('due_date') and d.get('status') not in ('paid','cancelled','rejected'):
            d['overdue'] = datetime.now().date() > datetime.fromisoformat(d['due_date']).date()
        else: d['overdue'] = False
    except: d['overdue'] = False
    return d

def _customer_dict(c):
    return {k:c[k] for k in ['id','name','phone','email','address','tax_reg_no','notes','created_at']}

def _payment_dict(p):
    return {k:p[k] for k in ['id','document_id','amount','method','reference','note','paid_at','created_at']}

def _expense_dict(e):
    return {k:e[k] for k in ['id','description','amount','category','vendor','expense_date','notes','created_at']}

def _template_dict(t, items=None):
    d = {k:t[k] for k in ['id','name','doc_type','notes','tax_rate','created_at']}
    if items is not None: d['items'] = [dict(i) for i in items]
    return d

def _cat_dict(r):
    return {k:r[k] for k in ['id','item_name','description','unit_price','category','created_at']}

# ── Auth routes ────────────────────────────────────────────────────────────────
@app.route('/api/auth/register', methods=['POST'])
def register():
    d = request.json
    if not all(k in d for k in ['email','password','business_name']):
        return jsonify({'error':'Missing required fields'}), 400
    if len(d.get('password','')) < 6:
        return jsonify({'error':'Password must be at least 6 characters'}), 400
    email = d['email'].lower().strip()
    otp   = gen_otp()
    otp_exp = (datetime.now()+timedelta(minutes=15)).isoformat()
    with get_db() as db:
        if db.execute('SELECT id FROM businesses WHERE email=?',(email,)).fetchone():
            return jsonify({'error':'Email already registered'}), 409
        db.execute('INSERT INTO businesses (email,password_hash,business_name,phone,address,plan,email_verified,otp_code,otp_expires_at) VALUES (?,?,?,?,?,?,?,?,?)',
                   (email,hash_password(d['password']),d['business_name'],d.get('phone',''),d.get('address',''),'trial',0,otp,otp_exp))
        db.commit()
        biz = db.execute('SELECT * FROM businesses WHERE email=?',(email,)).fetchone()
    send_otp_email(email, d['business_name'], otp)
    return jsonify({'token':create_token(biz['id']),'business':_biz_dict(biz),
                    'message':'Check your email for a 6-digit verification code.'}), 201

@app.route('/api/auth/verify-email', methods=['POST'])
@token_required
def verify_email():
    otp_input = str(request.json.get('otp','')).strip()
    with get_db() as db:
        biz = db.execute('SELECT * FROM businesses WHERE id=?',(request.business_id,)).fetchone()
        if not biz: return jsonify({'error':'Not found'}), 404
        if biz['email_verified']:
            return jsonify({'message':'Already verified','business':_biz_dict(biz)})
        if not biz['otp_code']:
            return jsonify({'error':'No code found. Request a new one.'}), 400
        if biz['otp_expires_at'] and datetime.now()>datetime.fromisoformat(biz['otp_expires_at']):
            return jsonify({'error':'Code expired. Request a new one.'}), 400
        if biz['otp_code'] != otp_input:
            return jsonify({'error':'Incorrect code. Try again.'}), 400
        trial_exp = (datetime.now()+timedelta(days=30)).isoformat()
        db.execute('UPDATE businesses SET email_verified=1,otp_code=NULL,otp_expires_at=NULL,trial_expires_at=? WHERE id=?',
                   (trial_exp,request.business_id))
        db.commit()
        biz = db.execute('SELECT * FROM businesses WHERE id=?',(request.business_id,)).fetchone()
    send_welcome_email(biz['email'], biz['business_name'])
    return jsonify({'message':'Email verified! Your 30-day trial has started.','business':_biz_dict(biz)})

@app.route('/api/auth/resend-otp', methods=['POST'])
@token_required
def resend_otp():
    with get_db() as db:
        biz = db.execute('SELECT * FROM businesses WHERE id=?',(request.business_id,)).fetchone()
        if not biz: return jsonify({'error':'Not found'}), 404
        if biz['email_verified']: return jsonify({'message':'Already verified'})
        if biz['otp_expires_at']:
            age = (datetime.fromisoformat(biz['otp_expires_at'])-datetime.now()).total_seconds()
            if age > 14*60: return jsonify({'error':'Wait 1 minute before requesting a new code.'}), 429
        otp = gen_otp(); otp_exp = (datetime.now()+timedelta(minutes=15)).isoformat()
        db.execute('UPDATE businesses SET otp_code=?,otp_expires_at=? WHERE id=?',(otp,otp_exp,request.business_id))
        db.commit()
    send_otp_email(biz['email'], biz['business_name'], otp)
    return jsonify({'message':f'New code sent to {biz["email"]}'})

@app.route('/api/auth/login', methods=['POST'])
def login():
    d = request.json
    with get_db() as db:
        biz = db.execute('SELECT * FROM businesses WHERE email=?',(d.get('email','').lower(),)).fetchone()
        if not biz or not verify_password(d.get('password',''),biz['password_hash']):
            return jsonify({'error':'Invalid email or password'}), 401
        db.execute('UPDATE businesses SET login_count=login_count+1,last_login_at=? WHERE id=?',
                   (datetime.now().isoformat(),biz['id']))
        db.commit()
        biz = db.execute('SELECT * FROM businesses WHERE id=?',(biz['id'],)).fetchone()
    if not biz['email_verified']:
        otp = gen_otp(); otp_exp = (datetime.now()+timedelta(minutes=15)).isoformat()
        with get_db() as db:
            db.execute('UPDATE businesses SET otp_code=?,otp_expires_at=? WHERE id=?',(otp,otp_exp,biz['id']))
            db.commit()
        send_otp_email(biz['email'], biz['business_name'], otp)
    return jsonify({'token':create_token(biz['id']),'business':_biz_dict(biz)})

@app.route('/api/auth/change-password', methods=['POST'])
@token_required
def change_password():
    d = request.json
    with get_db() as db:
        biz = db.execute('SELECT * FROM businesses WHERE id=?',(request.business_id,)).fetchone()
        if not verify_password(d.get('current_password',''),biz['password_hash']):
            return jsonify({'error':'Current password incorrect'}), 400
        db.execute('UPDATE businesses SET password_hash=? WHERE id=?',(hash_password(d['new_password']),request.business_id))
        db.commit()
    return jsonify({'message':'Password updated'})

@app.route('/api/auth/forgot-password', methods=['POST'])
def forgot_password():
    email = (request.json.get('email') or '').lower().strip()
    if not email: return jsonify({'error':'Email required'}), 400
    with get_db() as db:
        biz = db.execute('SELECT * FROM businesses WHERE email=?',(email,)).fetchone()
    if biz:
        otp = gen_otp(); otp_exp = (datetime.now()+timedelta(minutes=15)).isoformat()
        with get_db() as db:
            db.execute('UPDATE businesses SET otp_code=?,otp_expires_at=? WHERE id=?',(otp,otp_exp,biz['id']))
            db.commit()
        html = f"""<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
          <div style="background:#1a2233;border-radius:12px;padding:28px;text-align:center;margin-bottom:24px">
            <h1 style="color:#fff;font-size:22px;margin:0">RepairBiz</h1></div>
          <h2 style="color:#1a2233;font-size:18px;margin:0 0 12px">Reset your password</h2>
          <div style="background:#f4f6f9;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;border:2px dashed #dde3ea">
            <span style="font-size:42px;font-weight:800;letter-spacing:10px;color:#1a2233;font-family:monospace">{otp}</span>
            <p style="color:#9aa5b4;font-size:12px;margin:12px 0 0">Expires in 15 minutes</p></div>
          <p style="color:#9aa5b4;font-size:12px">If you didn't request this, ignore this email.</p></div>"""
        send_email(email, f"RepairBiz password reset code: {otp}", html,
                   f"Password reset code: {otp}\n\nExpires in 15 minutes.")
    return jsonify({'message':'If that email is registered, a reset code has been sent.'})

@app.route('/api/auth/reset-password', methods=['POST'])
def reset_password():
    d = request.json
    email = (d.get('email') or '').lower().strip()
    otp   = str(d.get('otp') or '').strip()
    pw    = d.get('new_password','')
    if not all([email,otp,pw]): return jsonify({'error':'Email, code and password required'}), 400
    if len(pw) < 6: return jsonify({'error':'Password must be at least 6 characters'}), 400
    with get_db() as db:
        biz = db.execute('SELECT * FROM businesses WHERE email=?',(email,)).fetchone()
        if not biz or biz['otp_code']!=otp: return jsonify({'error':'Invalid code'}), 400
        if biz['otp_expires_at'] and datetime.now()>datetime.fromisoformat(biz['otp_expires_at']):
            return jsonify({'error':'Code expired'}), 400
        db.execute('UPDATE businesses SET password_hash=?,otp_code=NULL,otp_expires_at=NULL WHERE id=?',
                   (hash_password(pw),biz['id']))
        db.commit()
    return jsonify({'message':'Password reset. You can now sign in.'})

# ── License ────────────────────────────────────────────────────────────────────
@app.route('/api/license/activate', methods=['POST'])
@token_required
def activate_license():
    code = (request.json.get('code') or '').strip().upper()
    if not code: return jsonify({'error':'License code required'}), 400
    with get_db() as db:
        lc = db.execute('SELECT * FROM license_codes WHERE code=?',(code,)).fetchone()
        if not lc: return jsonify({'error':'Invalid license code'}), 404
        if lc['used_at']: return jsonify({'error':'Code already used'}), 409
        plan = lc['plan']; months = lc['months'] or 1; now = datetime.now()
        biz  = db.execute('SELECT * FROM businesses WHERE id=?',(request.business_id,)).fetchone()
        cur_exp = biz['license_expires_at']
        base    = datetime.fromisoformat(cur_exp) if cur_exp and datetime.fromisoformat(cur_exp)>now else now
        new_exp = (base+timedelta(days=30*months)).isoformat()
        db.execute('UPDATE businesses SET plan=?,license_expires_at=?,license_code=? WHERE id=?',(plan,new_exp,code,request.business_id))
        db.execute('UPDATE license_codes SET used_at=?,business_id=? WHERE id=?',(now.isoformat(),request.business_id,lc['id']))
        db.commit()
        biz = db.execute('SELECT * FROM businesses WHERE id=?',(request.business_id,)).fetchone()
    return jsonify({'message':f'License activated! {plan} plan active until {new_exp[:10]}.','business':_biz_dict(biz)})

# ── Business settings ──────────────────────────────────────────────────────────
@app.route('/api/business', methods=['GET'])
@token_required
def get_business():
    with get_db() as db:
        biz = db.execute('SELECT * FROM businesses WHERE id=?',(request.business_id,)).fetchone()
    return jsonify(_biz_dict(biz))

@app.route('/api/business', methods=['PUT'])
@token_required
def update_business():
    d = request.json
    fields = ['business_name','phone','address','bank_name','bank_account_holder',
              'bank_account_number','bank_branch_code','bank_reference','terms',
              'accent_color','doc_number_format','footer_message',
              'invoice_prefix','receipt_prefix','quotation_prefix','report_prefix',
              'pdf_show_signature']
    updates = {k:d[k] for k in fields if k in d}
    if not updates: return jsonify({'error':'Nothing to update'}), 400
    with get_db() as db:
        db.execute(f"UPDATE businesses SET {', '.join(f'{k}=?' for k in updates)} WHERE id=?",
                   list(updates.values())+[request.business_id])
        db.commit()
        biz = db.execute('SELECT * FROM businesses WHERE id=?',(request.business_id,)).fetchone()
    return jsonify(_biz_dict(biz))

@app.route('/api/business/logo', methods=['POST'])
@token_required
def upload_logo():
    if 'logo' not in request.files: return jsonify({'error':'No file'}), 400
    f = request.files['logo']
    ext = f.filename.rsplit('.',1)[-1].lower()
    if ext not in ('png','jpg','jpeg','gif','webp'): return jsonify({'error':'Invalid file type'}), 400
    fname = f"logo_{request.business_id}.{ext}"
    save_path = os.path.join(app.config['UPLOAD_FOLDER'], fname)
    f.save(save_path)
    web_path = f"static/uploads/{fname}"
    with get_db() as db:
        db.execute('UPDATE businesses SET logo_path=? WHERE id=?',(save_path, request.business_id))
        db.commit()
    return jsonify({'logo_path': web_path})

# ── Customers ──────────────────────────────────────────────────────────────────
@app.route('/api/customers', methods=['GET'])
@token_required
def list_customers():
    search = request.args.get('search','')
    with get_db() as db:
        if search:
            rows = db.execute("SELECT * FROM customers WHERE business_id=? AND (name LIKE ? OR phone LIKE ? OR email LIKE ?) ORDER BY name",
                              (request.business_id,f'%{search}%',f'%{search}%',f'%{search}%')).fetchall()
        else:
            rows = db.execute("SELECT * FROM customers WHERE business_id=? ORDER BY name",(request.business_id,)).fetchall()
    return jsonify([_customer_dict(r) for r in rows])

@app.route('/api/customers', methods=['POST'])
@token_required
def create_customer():
    d = request.json
    if not d.get('name'): return jsonify({'error':'Name required'}), 400
    with get_db() as db:
        cur = db.execute('INSERT INTO customers (business_id,name,phone,email,address,tax_reg_no,notes) VALUES (?,?,?,?,?,?,?)',
                         (request.business_id,d['name'],d.get('phone',''),d.get('email',''),d.get('address',''),d.get('tax_reg_no',''),d.get('notes','')))
        db.commit()
        row = db.execute('SELECT * FROM customers WHERE id=?',(cur.lastrowid,)).fetchone()
    return jsonify(_customer_dict(row)), 201

@app.route('/api/customers/<int:cust_id>', methods=['PUT'])
@token_required
def update_customer(cust_id):
    d = request.json
    with get_db() as db:
        if not db.execute('SELECT id FROM customers WHERE id=? AND business_id=?',(cust_id,request.business_id)).fetchone():
            return jsonify({'error':'Not found'}), 404
        fields  = ['name','phone','email','address','tax_reg_no','notes']
        updates = {k:d[k] for k in fields if k in d}
        if updates:
            db.execute(f"UPDATE customers SET {', '.join(f'{k}=?' for k in updates)} WHERE id=?",
                       list(updates.values())+[cust_id])
            db.commit()
        row = db.execute('SELECT * FROM customers WHERE id=?',(cust_id,)).fetchone()
    return jsonify(_customer_dict(row))

@app.route('/api/customers/<int:cust_id>', methods=['DELETE'])
@token_required
def delete_customer(cust_id):
    with get_db() as db:
        if not db.execute('SELECT id FROM customers WHERE id=? AND business_id=?',(cust_id,request.business_id)).fetchone():
            return jsonify({'error':'Not found'}), 404
        db.execute('DELETE FROM customers WHERE id=?',(cust_id,)); db.commit()
    return jsonify({'message':'Deleted'})

@app.route('/api/customers/<int:cust_id>/history', methods=['GET'])
@token_required
def customer_history(cust_id):
    with get_db() as db:
        cust = db.execute('SELECT * FROM customers WHERE id=? AND business_id=?',(cust_id,request.business_id)).fetchone()
        if not cust: return jsonify({'error':'Not found'}), 404
        docs = db.execute("SELECT * FROM documents WHERE business_id=? AND customer_name=? ORDER BY created_at DESC LIMIT 50",
                          (request.business_id,cust['name'])).fetchall()
        total = db.execute("SELECT COALESCE(SUM(total),0) as s FROM documents WHERE business_id=? AND customer_name=? AND doc_type IN ('invoice','receipt') AND status IN ('paid','sent')",
                           (request.business_id,cust['name'])).fetchone()['s']
    return jsonify({'customer':_customer_dict(cust),'documents':[_doc_dict(d) for d in docs],'total_spent':total,'doc_count':len(docs)})

# ── Documents ──────────────────────────────────────────────────────────────────
@app.route('/api/documents', methods=['GET'])
@token_required
@check_subscription
def list_documents():
    q = request.args
    filters = ["d.business_id=?"]; params = [request.business_id]
    if q.get('type'):   filters.append("d.doc_type=?");                    params.append(q['type'])
    if q.get('month'):  filters.append("strftime('%m',d.issue_date)=?");   params.append(q['month'].zfill(2))
    if q.get('year'):   filters.append("strftime('%Y',d.issue_date)=?");   params.append(q['year'])
    if q.get('search'):
        s = q['search']
        filters.append("(d.doc_number LIKE ? OR d.customer_name LIKE ? OR d.customer_phone LIKE ?)")
        params += [f"%{s}%",f"%{s}%",f"%{s}%"]
    with get_db() as db:
        docs = db.execute(f"SELECT * FROM documents d WHERE {' AND '.join(filters)} ORDER BY d.created_at DESC",params).fetchall()
    return jsonify([_doc_dict(d) for d in docs])

@app.route('/api/documents', methods=['POST'])
@token_required
@check_subscription
def create_document():
    d = request.json
    doc_type = d.get('doc_type')
    if doc_type not in PREFIXES: return jsonify({'error':'Invalid document type'}), 400
    with get_db() as db:
        biz = db.execute('SELECT * FROM businesses WHERE id=?',(request.business_id,)).fetchone()
        doc_number = next_doc_number(db, request.business_id, doc_type)
        items      = d.get('items',[])
        subtotal   = sum(float(i.get('quantity',1))*float(i.get('unit_price',0)) for i in items)
        tax_rate   = float(d.get('tax_rate',0))
        tax_amount = subtotal * tax_rate / 100
        total      = subtotal + tax_amount
        cur = db.execute('''INSERT INTO documents (business_id,doc_number,doc_type,customer_name,customer_phone,customer_email,customer_address,customer_tax_reg_no,issue_date,due_date,status,subtotal,tax_rate,tax_amount,total,notes,appliance_type,appliance_brand,model_number,serial_number,problem_description,technician_notes,estimated_cost,bank_name,bank_account_holder,bank_account_number,bank_branch_code,bank_reference,terms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                         (request.business_id,doc_number,doc_type,d.get('customer_name',''),d.get('customer_phone',''),d.get('customer_email',''),d.get('customer_address',''),d.get('customer_tax_reg_no',''),d.get('issue_date',datetime.now().strftime('%Y-%m-%d')),d.get('due_date'),d.get('status','draft'),subtotal,tax_rate,tax_amount,total,d.get('notes',''),d.get('appliance_type'),d.get('appliance_brand'),d.get('model_number'),d.get('serial_number'),d.get('problem_description'),d.get('technician_notes'),d.get('estimated_cost'),d.get('bank_name',biz['bank_name']),d.get('bank_account_holder',biz['bank_account_holder']),d.get('bank_account_number',biz['bank_account_number']),d.get('bank_branch_code',biz['bank_branch_code']),d.get('bank_reference',biz['bank_reference']),d.get('terms',biz['terms'])))
        doc_id = cur.lastrowid
        for item in items:
            qty=float(item.get('quantity',1)); price=float(item.get('unit_price',0))
            db.execute('INSERT INTO document_items (document_id,item_name,description,quantity,unit_price,total) VALUES (?,?,?,?,?,?)',
                       (doc_id,item.get('item_name',''),item.get('description',''),qty,price,qty*price))
        db.commit()
        doc       = db.execute('SELECT * FROM documents WHERE id=?',(doc_id,)).fetchone()
        item_rows = db.execute('SELECT * FROM document_items WHERE document_id=?',(doc_id,)).fetchall()
    return jsonify(_doc_dict(doc, item_rows)), 201

@app.route('/api/documents/<int:doc_id>', methods=['GET'])
@token_required
def get_document(doc_id):
    with get_db() as db:
        doc = db.execute('SELECT * FROM documents WHERE id=? AND business_id=?',(doc_id,request.business_id)).fetchone()
        if not doc: return jsonify({'error':'Not found'}), 404
        items  = db.execute('SELECT * FROM document_items WHERE document_id=?',(doc_id,)).fetchall()
        photos = db.execute('SELECT * FROM document_photos WHERE document_id=?',(doc_id,)).fetchall()
    return jsonify(_doc_dict(doc, items, photos))

@app.route('/api/documents/<int:doc_id>', methods=['PUT'])
@token_required
@check_subscription
def update_document(doc_id):
    d = request.json
    with get_db() as db:
        doc = db.execute('SELECT * FROM documents WHERE id=? AND business_id=?',(doc_id,request.business_id)).fetchone()
        if not doc: return jsonify({'error':'Not found'}), 404
        items = d.get('items')
        if items is not None:
            subtotal   = sum(float(i.get('quantity',1))*float(i.get('unit_price',0)) for i in items)
            tax_rate   = float(d.get('tax_rate',doc['tax_rate'] or 0))
            tax_amount = subtotal*tax_rate/100; total = subtotal+tax_amount
            d.update({'subtotal':subtotal,'tax_rate':tax_rate,'tax_amount':tax_amount,'total':total})
        fields  = ['customer_name','customer_phone','customer_email','customer_address','customer_tax_reg_no','due_date','status','notes','appliance_type','appliance_brand','model_number','serial_number','problem_description','technician_notes','estimated_cost','bank_name','bank_account_holder','bank_account_number','bank_branch_code','bank_reference','terms','subtotal','tax_rate','tax_amount','total']
        updates = {k:d[k] for k in fields if k in d}
        if updates:
            db.execute(f"UPDATE documents SET {', '.join(f'{k}=?' for k in updates)} WHERE id=?",list(updates.values())+[doc_id])
        if items is not None:
            db.execute('DELETE FROM document_items WHERE document_id=?',(doc_id,))
            for item in items:
                qty=float(item.get('quantity',1)); price=float(item.get('unit_price',0))
                db.execute('INSERT INTO document_items (document_id,item_name,description,quantity,unit_price,total) VALUES (?,?,?,?,?,?)',
                           (doc_id,item.get('item_name',''),item.get('description',''),qty,price,qty*price))
        db.commit()
        doc       = db.execute('SELECT * FROM documents WHERE id=?',(doc_id,)).fetchone()
        item_rows = db.execute('SELECT * FROM document_items WHERE document_id=?',(doc_id,)).fetchall()
    return jsonify(_doc_dict(doc, item_rows))

@app.route('/api/documents/<int:doc_id>', methods=['DELETE'])
@token_required
def delete_document(doc_id):
    with get_db() as db:
        if not db.execute('SELECT id FROM documents WHERE id=? AND business_id=?',(doc_id,request.business_id)).fetchone():
            return jsonify({'error':'Not found'}), 404
        db.execute('DELETE FROM documents WHERE id=?',(doc_id,)); db.commit()
    return jsonify({'message':'Deleted'})

@app.route('/api/documents/<int:doc_id>/status', methods=['PATCH'])
@token_required
def update_status(doc_id):
    status = request.json.get('status')
    if status not in ['draft','sent','paid','cancelled','approved','rejected']:
        return jsonify({'error':'Invalid status'}), 400
    with get_db() as db:
        db.execute('UPDATE documents SET status=? WHERE id=? AND business_id=?',(status,doc_id,request.business_id))
        db.commit()
    return jsonify({'status':status})

@app.route('/api/documents/<int:doc_id>/signature', methods=['POST'])
@token_required
def save_signature(doc_id):
    data = request.json.get('signature_data','')
    with get_db() as db:
        if not db.execute('SELECT id FROM documents WHERE id=? AND business_id=?',(doc_id,request.business_id)).fetchone():
            return jsonify({'error':'Not found'}), 404
        db.execute('UPDATE documents SET signature_data=? WHERE id=?',(data,doc_id)); db.commit()
    return jsonify({'message':'Signature saved'})

@app.route('/api/documents/<int:doc_id>/duplicate', methods=['POST'])
@token_required
@check_subscription
def duplicate_document(doc_id):
    with get_db() as db:
        doc   = db.execute('SELECT * FROM documents WHERE id=? AND business_id=?',(doc_id,request.business_id)).fetchone()
        if not doc: return jsonify({'error':'Not found'}), 404
        items = db.execute('SELECT * FROM document_items WHERE document_id=?',(doc_id,)).fetchall()
        new_num = next_doc_number(db, request.business_id, doc['doc_type'])
        today   = datetime.now().strftime('%Y-%m-%d')
        cur = db.execute('''INSERT INTO documents (business_id,doc_number,doc_type,customer_name,customer_phone,customer_email,customer_address,customer_tax_reg_no,issue_date,due_date,status,subtotal,tax_rate,tax_amount,total,notes,appliance_type,appliance_brand,model_number,serial_number,problem_description,technician_notes,estimated_cost,bank_name,bank_account_holder,bank_account_number,bank_branch_code,bank_reference,terms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                         (request.business_id,new_num,doc['doc_type'],doc['customer_name'],doc['customer_phone'],doc['customer_email'],doc['customer_address'],doc['customer_tax_reg_no'],today,doc['due_date'],'draft',doc['subtotal'],doc['tax_rate'],doc['tax_amount'],doc['total'],doc['notes'],doc['appliance_type'],doc['appliance_brand'],doc['model_number'],doc['serial_number'],doc['problem_description'],doc['technician_notes'],doc['estimated_cost'],doc['bank_name'],doc['bank_account_holder'],doc['bank_account_number'],doc['bank_branch_code'],doc['bank_reference'],doc['terms']))
        new_id = cur.lastrowid
        for item in items:
            db.execute('INSERT INTO document_items (document_id,item_name,description,quantity,unit_price,total) VALUES (?,?,?,?,?,?)',
                       (new_id,item['item_name'],item['description'],item['quantity'],item['unit_price'],item['total']))
        db.commit()
        new_doc   = db.execute('SELECT * FROM documents WHERE id=?',(new_id,)).fetchone()
        new_items = db.execute('SELECT * FROM document_items WHERE document_id=?',(new_id,)).fetchall()
    return jsonify(_doc_dict(new_doc, new_items)), 201

@app.route('/api/documents/<int:doc_id>/convert', methods=['POST'])
@token_required
@check_subscription
def convert_document(doc_id):
    target = request.json.get('target_type')
    if target not in PREFIXES: return jsonify({'error':'Invalid target type'}), 400
    with get_db() as db:
        doc   = db.execute('SELECT * FROM documents WHERE id=? AND business_id=?',(doc_id,request.business_id)).fetchone()
        if not doc: return jsonify({'error':'Not found'}), 404
        items = db.execute('SELECT * FROM document_items WHERE document_id=?',(doc_id,)).fetchall()
        new_num = next_doc_number(db, request.business_id, target)
        today   = datetime.now().strftime('%Y-%m-%d')
        cur = db.execute('''INSERT INTO documents (business_id,doc_number,doc_type,customer_name,customer_phone,customer_email,customer_address,customer_tax_reg_no,issue_date,due_date,status,subtotal,tax_rate,tax_amount,total,notes,bank_name,bank_account_holder,bank_account_number,bank_branch_code,bank_reference,terms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                         (request.business_id,new_num,target,doc['customer_name'],doc['customer_phone'],doc['customer_email'],doc['customer_address'],doc['customer_tax_reg_no'],today,doc['due_date'],'draft',doc['subtotal'],doc['tax_rate'],doc['tax_amount'],doc['total'],doc['notes'],doc['bank_name'],doc['bank_account_holder'],doc['bank_account_number'],doc['bank_branch_code'],doc['bank_reference'],doc['terms']))
        new_id = cur.lastrowid
        for item in items:
            db.execute('INSERT INTO document_items (document_id,item_name,description,quantity,unit_price,total) VALUES (?,?,?,?,?,?)',
                       (new_id,item['item_name'],item['description'],item['quantity'],item['unit_price'],item['total']))
        db.commit()
        new_doc   = db.execute('SELECT * FROM documents WHERE id=?',(new_id,)).fetchone()
        new_items = db.execute('SELECT * FROM document_items WHERE document_id=?',(new_id,)).fetchall()
    return jsonify(_doc_dict(new_doc, new_items)), 201

# ── Payments ───────────────────────────────────────────────────────────────────
@app.route('/api/documents/<int:doc_id>/payments', methods=['GET'])
@token_required
def list_payments(doc_id):
    with get_db() as db:
        if not db.execute('SELECT id FROM documents WHERE id=? AND business_id=?',(doc_id,request.business_id)).fetchone():
            return jsonify({'error':'Not found'}), 404
        payments = db.execute('SELECT * FROM payments WHERE document_id=? ORDER BY paid_at DESC',(doc_id,)).fetchall()
    return jsonify([_payment_dict(p) for p in payments])

@app.route('/api/documents/<int:doc_id>/payments', methods=['POST'])
@token_required
def add_payment(doc_id):
    d      = request.json
    amount = float(d.get('amount',0))
    if amount <= 0: return jsonify({'error':'Amount must be greater than 0'}), 400
    with get_db() as db:
        doc = db.execute('SELECT * FROM documents WHERE id=? AND business_id=?',(doc_id,request.business_id)).fetchone()
        if not doc: return jsonify({'error':'Not found'}), 404
        paid_at = d.get('paid_at') or datetime.now().strftime('%Y-%m-%d')
        cur = db.execute('INSERT INTO payments (business_id,document_id,amount,method,reference,note,paid_at) VALUES (?,?,?,?,?,?,?)',
                         (request.business_id,doc_id,amount,d.get('method','cash'),d.get('reference',''),d.get('note',''),paid_at))
        total_paid = db.execute('SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE document_id=?',(doc_id,)).fetchone()['s'] + amount
        doc_total  = float(doc['total'])
        if total_paid >= doc_total:   pay_status='paid';    status='paid'
        elif total_paid > 0:          pay_status='partial'; status=doc['status']
        else:                         pay_status='unpaid';  status=doc['status']
        db.execute('UPDATE documents SET amount_paid=?,payment_status=?,status=? WHERE id=?',(total_paid,pay_status,status,doc_id))
        db.commit()
        payment     = db.execute('SELECT * FROM payments WHERE id=?',(cur.lastrowid,)).fetchone()
        updated_doc = db.execute('SELECT * FROM documents WHERE id=?',(doc_id,)).fetchone()
    return jsonify({'payment':_payment_dict(payment),'document':_doc_dict(updated_doc)}), 201

@app.route('/api/payments/<int:payment_id>', methods=['DELETE'])
@token_required
def delete_payment(payment_id):
    with get_db() as db:
        p = db.execute('SELECT * FROM payments WHERE id=? AND business_id=?',(payment_id,request.business_id)).fetchone()
        if not p: return jsonify({'error':'Not found'}), 404
        db.execute('DELETE FROM payments WHERE id=?',(payment_id,))
        total_paid = db.execute('SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE document_id=?',(p['document_id'],)).fetchone()['s']
        doc        = db.execute('SELECT * FROM documents WHERE id=?',(p['document_id'],)).fetchone()
        if total_paid >= float(doc['total']) and total_paid > 0: pay_status='paid'
        elif total_paid > 0: pay_status='partial'
        else:                pay_status='unpaid'
        db.execute('UPDATE documents SET amount_paid=?,payment_status=? WHERE id=?',(total_paid,pay_status,p['document_id']))
        db.commit()
    return jsonify({'message':'Deleted'})

# ── Expenses ───────────────────────────────────────────────────────────────────
@app.route('/api/expenses', methods=['GET'])
@token_required
def list_expenses():
    year  = request.args.get('year', datetime.now().strftime('%Y'))
    month = request.args.get('month','')
    with get_db() as db:
        if month:
            rows = db.execute("SELECT * FROM expenses WHERE business_id=? AND strftime('%Y',expense_date)=? AND strftime('%m',expense_date)=? ORDER BY expense_date DESC",
                              (request.business_id,year,month.zfill(2))).fetchall()
        else:
            rows = db.execute("SELECT * FROM expenses WHERE business_id=? AND strftime('%Y',expense_date)=? ORDER BY expense_date DESC",
                              (request.business_id,year)).fetchall()
    return jsonify([_expense_dict(r) for r in rows])

@app.route('/api/expenses', methods=['POST'])
@token_required
def create_expense():
    d = request.json
    if not d.get('description'): return jsonify({'error':'Description required'}), 400
    if not d.get('amount'):      return jsonify({'error':'Amount required'}), 400
    with get_db() as db:
        cur = db.execute('INSERT INTO expenses (business_id,description,amount,category,vendor,expense_date,notes) VALUES (?,?,?,?,?,?,?)',
                         (request.business_id,d['description'],float(d['amount']),d.get('category','General'),d.get('vendor',''),d.get('expense_date',datetime.now().strftime('%Y-%m-%d')),d.get('notes','')))
        db.commit()
        row = db.execute('SELECT * FROM expenses WHERE id=?',(cur.lastrowid,)).fetchone()
    return jsonify(_expense_dict(row)), 201

@app.route('/api/expenses/<int:eid>', methods=['PUT'])
@token_required
def update_expense(eid):
    d = request.json
    with get_db() as db:
        if not db.execute('SELECT id FROM expenses WHERE id=? AND business_id=?',(eid,request.business_id)).fetchone():
            return jsonify({'error':'Not found'}), 404
        db.execute('UPDATE expenses SET description=?,amount=?,category=?,vendor=?,expense_date=?,notes=? WHERE id=?',
                   (d.get('description'),float(d.get('amount',0)),d.get('category','General'),d.get('vendor',''),d.get('expense_date'),d.get('notes',''),eid))
        db.commit()
        row = db.execute('SELECT * FROM expenses WHERE id=?',(eid,)).fetchone()
    return jsonify(_expense_dict(row))

@app.route('/api/expenses/<int:eid>', methods=['DELETE'])
@token_required
def delete_expense(eid):
    with get_db() as db:
        if not db.execute('SELECT id FROM expenses WHERE id=? AND business_id=?',(eid,request.business_id)).fetchone():
            return jsonify({'error':'Not found'}), 404
        db.execute('DELETE FROM expenses WHERE id=?',(eid,)); db.commit()
    return jsonify({'message':'Deleted'})

# ── Job Templates ──────────────────────────────────────────────────────────────
@app.route('/api/templates', methods=['GET'])
@token_required
def list_templates():
    with get_db() as db:
        rows = db.execute('SELECT * FROM job_templates WHERE business_id=? ORDER BY name',(request.business_id,)).fetchall()
        result = []
        for t in rows:
            items = db.execute('SELECT * FROM job_template_items WHERE template_id=?',(t['id'],)).fetchall()
            result.append(_template_dict(t, items))
    return jsonify(result)

@app.route('/api/templates', methods=['POST'])
@token_required
def create_template():
    d = request.json
    if not d.get('name'): return jsonify({'error':'Name required'}), 400
    with get_db() as db:
        cur = db.execute('INSERT INTO job_templates (business_id,name,doc_type,notes,tax_rate) VALUES (?,?,?,?,?)',
                         (request.business_id,d['name'],d.get('doc_type','invoice'),d.get('notes',''),float(d.get('tax_rate',0))))
        tid = cur.lastrowid
        for item in d.get('items',[]):
            db.execute('INSERT INTO job_template_items (template_id,item_name,description,quantity,unit_price) VALUES (?,?,?,?,?)',
                       (tid,item.get('item_name',''),item.get('description',''),float(item.get('quantity',1)),float(item.get('unit_price',0))))
        db.commit()
        t     = db.execute('SELECT * FROM job_templates WHERE id=?',(tid,)).fetchone()
        items = db.execute('SELECT * FROM job_template_items WHERE template_id=?',(tid,)).fetchall()
    return jsonify(_template_dict(t, items)), 201

@app.route('/api/templates/<int:tid>', methods=['PUT'])
@token_required
def update_template(tid):
    d = request.json
    with get_db() as db:
        if not db.execute('SELECT id FROM job_templates WHERE id=? AND business_id=?',(tid,request.business_id)).fetchone():
            return jsonify({'error':'Not found'}), 404
        db.execute('UPDATE job_templates SET name=?,doc_type=?,notes=?,tax_rate=? WHERE id=?',
                   (d.get('name'),d.get('doc_type','invoice'),d.get('notes',''),float(d.get('tax_rate',0)),tid))
        db.execute('DELETE FROM job_template_items WHERE template_id=?',(tid,))
        for item in d.get('items',[]):
            db.execute('INSERT INTO job_template_items (template_id,item_name,description,quantity,unit_price) VALUES (?,?,?,?,?)',
                       (tid,item.get('item_name',''),item.get('description',''),float(item.get('quantity',1)),float(item.get('unit_price',0))))
        db.commit()
        t     = db.execute('SELECT * FROM job_templates WHERE id=?',(tid,)).fetchone()
        items = db.execute('SELECT * FROM job_template_items WHERE template_id=?',(tid,)).fetchall()
    return jsonify(_template_dict(t, items))

@app.route('/api/templates/<int:tid>', methods=['DELETE'])
@token_required
def delete_template(tid):
    with get_db() as db:
        if not db.execute('SELECT id FROM job_templates WHERE id=? AND business_id=?',(tid,request.business_id)).fetchone():
            return jsonify({'error':'Not found'}), 404
        db.execute('DELETE FROM job_templates WHERE id=?',(tid,)); db.commit()
    return jsonify({'message':'Deleted'})

# ── Catalogue ──────────────────────────────────────────────────────────────────
@app.route('/api/catalogue', methods=['GET'])
@token_required
def list_catalogue():
    with get_db() as db:
        rows = db.execute('SELECT * FROM catalogue WHERE business_id=? ORDER BY category,item_name',(request.business_id,)).fetchall()
    return jsonify([_cat_dict(r) for r in rows])

@app.route('/api/catalogue', methods=['POST'])
@token_required
def create_catalogue_item():
    d = request.json
    if not d.get('item_name'): return jsonify({'error':'Item name required'}), 400
    with get_db() as db:
        cur = db.execute('INSERT INTO catalogue (business_id,item_name,description,unit_price,category) VALUES (?,?,?,?,?)',
                         (request.business_id,d['item_name'],d.get('description',''),float(d.get('unit_price',0)),d.get('category','General')))
        db.commit()
        row = db.execute('SELECT * FROM catalogue WHERE id=?',(cur.lastrowid,)).fetchone()
    return jsonify(_cat_dict(row)), 201

@app.route('/api/catalogue/<int:item_id>', methods=['PUT'])
@token_required
def update_catalogue_item(item_id):
    d = request.json
    with get_db() as db:
        if not db.execute('SELECT id FROM catalogue WHERE id=? AND business_id=?',(item_id,request.business_id)).fetchone():
            return jsonify({'error':'Not found'}), 404
        db.execute('UPDATE catalogue SET item_name=?,description=?,unit_price=?,category=? WHERE id=?',
                   (d.get('item_name'),d.get('description',''),float(d.get('unit_price',0)),d.get('category','General'),item_id))
        db.commit()
        row = db.execute('SELECT * FROM catalogue WHERE id=?',(item_id,)).fetchone()
    return jsonify(_cat_dict(row))

@app.route('/api/catalogue/<int:item_id>', methods=['DELETE'])
@token_required
def delete_catalogue_item(item_id):
    with get_db() as db:
        if not db.execute('SELECT id FROM catalogue WHERE id=? AND business_id=?',(item_id,request.business_id)).fetchone():
            return jsonify({'error':'Not found'}), 404
        db.execute('DELETE FROM catalogue WHERE id=?',(item_id,)); db.commit()
    return jsonify({'message':'Deleted'})

@app.route('/api/onboarding')
@token_required
def onboarding_status():
    with get_db() as db:
        biz      = db.execute('SELECT * FROM businesses WHERE id=?',(request.business_id,)).fetchone()
        doc_count= db.execute('SELECT COUNT(*) as c FROM documents WHERE business_id=?',(request.business_id,)).fetchone()['c']
        cat_count= db.execute('SELECT COUNT(*) as c FROM catalogue WHERE business_id=?',(request.business_id,)).fetchone()['c']
    return jsonify({
        'has_logo':      bool(biz['logo_path']),
        'has_banking':   bool(biz['bank_account_number']),
        'has_document':  doc_count > 0,
        'has_catalogue': cat_count > 0,
        'has_terms':     bool(biz['terms'] and len(biz['terms'].strip()) > 10),
        'login_count':   biz['login_count'] or 1,
    })

# ── PDF ────────────────────────────────────────────────────────────────────────
def _build_pdf(doc_id, business_id):
    with get_db() as db:
        doc   = db.execute('SELECT * FROM documents WHERE id=? AND business_id=?',(doc_id,business_id)).fetchone()
        if not doc: return None, None
        biz   = db.execute('SELECT * FROM businesses WHERE id=?',(business_id,)).fetchone()
        items = db.execute('SELECT * FROM document_items WHERE document_id=?',(doc_id,)).fetchall()
    return generate_pdf(dict(doc), dict(biz), [dict(i) for i in items]), doc

@app.route('/api/documents/<int:doc_id>/pdf')
@token_required
def download_pdf(doc_id):
    pdf_bytes, doc = _build_pdf(doc_id, request.business_id)
    if not pdf_bytes: return jsonify({'error':'Not found'}), 404
    labels = {'invoice':'Invoice','receipt':'Receipt','quotation':'Quote','damage_report':'Report'}
    fname  = f"{labels.get(doc['doc_type'],'Doc')}-{doc['doc_number']}.pdf"
    return send_file(io.BytesIO(pdf_bytes), mimetype='application/pdf', as_attachment=True, download_name=fname)

@app.route('/api/documents/<int:doc_id>/pdf/view')
@token_required
def view_pdf(doc_id):
    pdf_bytes, doc = _build_pdf(doc_id, request.business_id)
    if not pdf_bytes: return jsonify({'error':'Not found'}), 404
    labels = {'invoice':'Invoice','receipt':'Receipt','quotation':'Quote','damage_report':'Report'}
    fname  = f"{labels.get(doc['doc_type'],'Doc')}-{doc['doc_number']}.pdf"
    return send_file(io.BytesIO(pdf_bytes), mimetype='application/pdf', as_attachment=False, download_name=fname)

@app.route('/api/documents/<int:doc_id>/photos', methods=['POST'])
@token_required
def upload_photo(doc_id):
    with get_db() as db:
        if not db.execute('SELECT id FROM documents WHERE id=? AND business_id=?',(doc_id,request.business_id)).fetchone():
            return jsonify({'error':'Not found'}), 404
    if 'photo' not in request.files: return jsonify({'error':'No file'}), 400
    f    = request.files['photo']
    ext  = f.filename.rsplit('.',1)[-1].lower()
    fname= f"photo_{doc_id}_{uuid.uuid4().hex[:8]}.{ext}"
    f.save(os.path.join(app.config['UPLOAD_FOLDER'], fname))
    fpath = f"static/uploads/{fname}"
    with get_db() as db:
        db.execute('INSERT INTO document_photos (document_id,file_path) VALUES (?,?)',(doc_id,fpath)); db.commit()
    return jsonify({'file_path':fpath})

# ── Dashboard ──────────────────────────────────────────────────────────────────
@app.route('/api/dashboard')
@token_required
@check_subscription
def dashboard():
    now   = datetime.now(); month = now.strftime('%m'); year = now.strftime('%Y')
    today = now.strftime('%Y-%m-%d')
    with get_db() as db:
        def cnt(t): return db.execute("SELECT COUNT(*) as c FROM documents WHERE business_id=? AND doc_type=? AND strftime('%m',issue_date)=? AND strftime('%Y',issue_date)=?",
                                       (request.business_id,t,month,year)).fetchone()['c']
        rev    = db.execute("SELECT COALESCE(SUM(total),0) as s FROM documents WHERE business_id=? AND doc_type IN ('invoice','receipt') AND strftime('%m',issue_date)=? AND strftime('%Y',issue_date)=?",
                            (request.business_id,month,year)).fetchone()['s']
        recent = db.execute("SELECT * FROM documents WHERE business_id=? ORDER BY created_at DESC LIMIT 5",(request.business_id,)).fetchall()
        overdue= db.execute("SELECT * FROM documents WHERE business_id=? AND doc_type='invoice' AND status NOT IN ('paid','cancelled') AND due_date IS NOT NULL AND due_date < ? ORDER BY due_date ASC",
                            (request.business_id,today)).fetchall()
        unpaid = db.execute("SELECT COALESCE(SUM(total),0) as s, COUNT(*) as c FROM documents WHERE business_id=? AND doc_type='invoice' AND status NOT IN ('paid','cancelled')",
                            (request.business_id,)).fetchone()
        monthly = []
        for i in range(5,-1,-1):
            d  = now - timedelta(days=30*i); m=d.strftime('%m'); y=d.strftime('%Y')
            row= db.execute("SELECT COALESCE(SUM(total),0) as s, COUNT(*) as c FROM documents WHERE business_id=? AND strftime('%m',issue_date)=? AND strftime('%Y',issue_date)=?",
                            (request.business_id,m,y)).fetchone()
            monthly.append({'month':d.strftime('%b %Y'),'revenue':row['s'],'docs':row['c']})
    return jsonify({'stats':{'invoices':cnt('invoice'),'receipts':cnt('receipt'),'quotations':cnt('quotation'),'damage_reports':cnt('damage_report'),'revenue':rev},
                    'recent_documents':[_doc_dict(d) for d in recent],'monthly_chart':monthly,
                    'overdue_invoices':[_doc_dict(d) for d in overdue],
                    'unpaid_total':unpaid['s'],'unpaid_count':unpaid['c']})

# ── Accounting ─────────────────────────────────────────────────────────────────
@app.route('/api/accounting')
@token_required
@check_subscription
def accounting():
    year = request.args.get('year', datetime.now().strftime('%Y'))
    with get_db() as db:
        monthly = []
        for m in range(1,13):
            mm   = str(m).zfill(2)
            rows = db.execute("SELECT doc_type,COUNT(*) as count,COALESCE(SUM(total),0) as revenue FROM documents WHERE business_id=? AND strftime('%m',issue_date)=? AND strftime('%Y',issue_date)=? GROUP BY doc_type",
                              (request.business_id,mm,year)).fetchall()
            exp  = db.execute("SELECT COALESCE(SUM(amount),0) as s FROM expenses WHERE business_id=? AND strftime('%m',expense_date)=? AND strftime('%Y',expense_date)=?",
                              (request.business_id,mm,year)).fetchone()
            data = {'month':datetime(int(year),m,1).strftime('%B'),'month_num':mm,'expenses':exp['s']}
            for r in rows: data[r['doc_type']+'_count']=r['count']; data[r['doc_type']+'_revenue']=r['revenue']
            monthly.append(data)
        totals     = db.execute("SELECT doc_type,COUNT(*) as count,COALESCE(SUM(total),0) as revenue FROM documents WHERE business_id=? AND strftime('%Y',issue_date)=? GROUP BY doc_type",
                                (request.business_id,year)).fetchall()
        total_exp  = db.execute("SELECT COALESCE(SUM(amount),0) as s FROM expenses WHERE business_id=? AND strftime('%Y',expense_date)=?",
                                (request.business_id,year)).fetchone()['s']
        exp_by_cat = db.execute("SELECT category,COALESCE(SUM(amount),0) as total FROM expenses WHERE business_id=? AND strftime('%Y',expense_date)=? GROUP BY category ORDER BY total DESC",
                                (request.business_id,year)).fetchall()
    return jsonify({'monthly':monthly,'totals':[dict(t) for t in totals],'year':year,
                    'total_expenses':total_exp,'expense_by_category':[dict(r) for r in exp_by_cat]})

# ── Admin ──────────────────────────────────────────────────────────────────────
@app.route('/api/admin/stats')
@admin_required
def admin_stats():
    with get_db() as db:
        total_users   = db.execute("SELECT COUNT(*) as c FROM businesses").fetchone()['c']
        trial_users   = db.execute("SELECT COUNT(*) as c FROM businesses WHERE plan='trial'").fetchone()['c']
        active_paid   = db.execute("SELECT COUNT(*) as c FROM businesses WHERE plan!='trial' AND is_active=1").fetchone()['c']
        total_docs    = db.execute("SELECT COUNT(*) as c FROM documents").fetchone()['c']
        total_rev     = db.execute("SELECT COALESCE(SUM(total),0) as s FROM documents WHERE doc_type IN ('invoice','receipt')").fetchone()['s']
        new_this_month= db.execute("SELECT COUNT(*) as c FROM businesses WHERE strftime('%Y-%m',created_at)=strftime('%Y-%m','now')").fetchone()['c']
        active_today  = db.execute("SELECT COUNT(*) as c FROM businesses WHERE date(last_login_at)=date('now')").fetchone()['c']
        unverified    = db.execute("SELECT COUNT(*) as c FROM businesses WHERE email_verified=0").fetchone()['c']
    return jsonify({'total_users':total_users,'trial_users':trial_users,'active_paid':active_paid,
                    'total_docs':total_docs,'total_revenue':total_rev,'new_this_month':new_this_month,
                    'active_today':active_today,'unverified':unverified})

@app.route('/api/admin/users')
@admin_required
def admin_list_users():
    search = request.args.get('search','')
    plan   = request.args.get('plan','')
    status = request.args.get('status','')
    sort   = request.args.get('sort','created_at')
    order  = 'DESC' if request.args.get('order','desc')=='desc' else 'ASC'
    safe_sorts = ['created_at','business_name','email','last_login_at','login_count']
    if sort not in safe_sorts: sort = 'created_at'
    filters = ['1=1']; params = []
    if search:
        filters.append("(email LIKE ? OR business_name LIKE ? OR phone LIKE ?)")
        params += [f'%{search}%',f'%{search}%',f'%{search}%']
    if plan: filters.append("plan=?"); params.append(plan)
    if status == 'trial': filters.append("plan='trial'")
    elif status == 'expired':
        filters.append("(plan='trial' AND trial_expires_at < datetime('now')) OR (plan!='trial' AND license_expires_at < datetime('now'))")
    elif status == 'active': filters.append("plan!='trial' AND is_active=1")
    elif status == 'suspended': filters.append("is_active=0")
    where = ' AND '.join(filters)
    with get_db() as db:
        users = db.execute(
            f"""SELECT b.*,
                (SELECT COALESCE(COUNT(*),0) FROM documents d WHERE d.business_id=b.id) as doc_count,
                (SELECT COALESCE(COUNT(*),0) FROM documents d WHERE d.business_id=b.id
                 AND strftime('%Y-%m',d.created_at)=strftime('%Y-%m','now')) as docs_this_month
            FROM businesses b WHERE {where} ORDER BY {sort} {order}""",
            params).fetchall()
    result = []
    for u in users:
        ud = _biz_dict(u)
        ud['doc_count']      = u['doc_count'] or 0
        ud['docs_this_month'] = u['docs_this_month'] or 0
        result.append(ud)
    return jsonify(result)

@app.route('/api/admin/users/<int:user_id>', methods=['GET'])
@admin_required
def admin_get_user(user_id):
    with get_db() as db:
        u = db.execute('SELECT * FROM businesses WHERE id=?',(user_id,)).fetchone()
        if not u: return jsonify({'error':'Not found'}), 404
        doc_stats = db.execute(
            "SELECT doc_type, COUNT(*) as count, COALESCE(SUM(total),0) as rev FROM documents WHERE business_id=? GROUP BY doc_type",
            (user_id,)).fetchall()
        recent_docs = db.execute(
            "SELECT * FROM documents WHERE business_id=? ORDER BY created_at DESC LIMIT 10",
            (user_id,)).fetchall()
    ud = _biz_dict(u)
    ud['doc_stats']   = [dict(d) for d in doc_stats]
    ud['recent_docs'] = [dict(d) for d in recent_docs]
    return jsonify(ud)



@app.route('/api/admin/users/<int:user_id>/documents', methods=['GET'])
@admin_required
def admin_get_user_documents(user_id):
    with get_db() as db:
        docs = db.execute(
            'SELECT * FROM documents WHERE business_id=? ORDER BY created_at DESC',
            (user_id,)).fetchall()
    return jsonify([dict(d) for d in docs])

@app.route('/api/admin/documents/<int:doc_id>', methods=['GET'])
@admin_required
def admin_get_document(doc_id):
    with get_db() as db:
        doc = db.execute('SELECT * FROM documents WHERE id=?',(doc_id,)).fetchone()
        if not doc: return jsonify({'error':'Not found'}), 404
        items = db.execute('SELECT * FROM document_items WHERE document_id=?',(doc_id,)).fetchall()
        biz   = db.execute('SELECT * FROM businesses WHERE id=?',(doc['business_id'],)).fetchone()
    d = dict(doc)
    d['items'] = [dict(i) for i in items]
    d['business'] = {'business_name':biz['business_name'],'email':biz['email']}
    return jsonify(d)

@app.route('/api/admin/documents/<int:doc_id>', methods=['PUT'])
@admin_required
def admin_update_document(doc_id):
    d = request.json
    fields = ['status','notes','customer_name','customer_phone','due_date']
    updates = {k:d[k] for k in fields if k in d}
    if not updates: return jsonify({'error':'Nothing to update'}), 400
    with get_db() as db:
        db.execute(f"UPDATE documents SET {', '.join(f'{k}=?' for k in updates)} WHERE id=?",
                   list(updates.values())+[doc_id])
        db.commit()
        doc = db.execute('SELECT * FROM documents WHERE id=?',(doc_id,)).fetchone()
    return jsonify(dict(doc))

@app.route('/api/admin/documents/<int:doc_id>/pdf')
@admin_required
def admin_view_pdf(doc_id):
    with get_db() as db:
        doc   = db.execute('SELECT * FROM documents WHERE id=?',(doc_id,)).fetchone()
        if not doc: return jsonify({'error':'Not found'}), 404
        biz   = db.execute('SELECT * FROM businesses WHERE id=?',(doc['business_id'],)).fetchone()
        items = db.execute('SELECT * FROM document_items WHERE document_id=?',(doc_id,)).fetchall()
    pdf_bytes = generate_pdf(dict(doc), dict(biz), [dict(i) for i in items])
    return send_file(io.BytesIO(pdf_bytes), mimetype='application/pdf',
                     as_attachment=False, download_name=f"{doc['doc_number']}.pdf")

@app.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
@admin_required
def admin_delete_user(user_id):
    with get_db() as db:
        db.execute('DELETE FROM businesses WHERE id=?',(user_id,))
        db.commit()
    return jsonify({'message':'User deleted'})


@app.route('/api/admin/licenses', methods=['POST'])
@admin_required
def create_license():
    d = request.json
    plan   = d.get('plan','starter')
    months = int(d.get('months',1))
    count  = int(d.get('count',1))
    notes  = d.get('notes','')
    codes  = []
    with get_db() as db:
        for _ in range(count):
            raw  = secrets.token_hex(8).upper()
            code = '-'.join([raw[i:i+4] for i in range(0,16,4)])
            db.execute('INSERT INTO license_codes (code,plan,months,notes) VALUES (?,?,?,?)',(code,plan,months,notes))
            codes.append(code)
        db.commit()
    return jsonify({'codes':codes,'plan':plan,'months':months})

@app.route('/api/admin/licenses', methods=['GET'])
@admin_required
def list_licenses():
    with get_db() as db:
        rows = db.execute("SELECT lc.*,b.business_name,b.email FROM license_codes lc LEFT JOIN businesses b ON lc.business_id=b.id ORDER BY lc.created_at DESC LIMIT 200").fetchall()
    return jsonify([dict(r) for r in rows])

@app.route('/api/admin/users/<int:user_id>/suspend', methods=['POST'])
@admin_required
def suspend_user(user_id):
    action = request.json.get('action','suspend')
    val    = 0 if action=='suspend' else 1
    with get_db() as db:
        db.execute('UPDATE businesses SET is_active=? WHERE id=?',(val,user_id)); db.commit()
    return jsonify({'message':f'User {"suspended" if val==0 else "unsuspended"}'})

@app.route('/api/admin/fix-logo-paths')
@admin_required
def fix_logo_paths():
    with get_db() as db:
        bizs = db.execute("SELECT id, logo_path FROM businesses WHERE logo_path IS NOT NULL").fetchall()
        fixed = 0
        for b in bizs:
            old_path = b['logo_path']
            if not old_path: continue
            # If stored as web path, convert to filesystem path
            if old_path.startswith('static/uploads/'):
                fname = old_path.replace('static/uploads/', '')
                new_path = os.path.join(app.config['UPLOAD_FOLDER'], fname)
                db.execute('UPDATE businesses SET logo_path=? WHERE id=?', (new_path, b['id']))
                fixed += 1
        db.commit()
    return jsonify({'message': f'Fixed {fixed} logo paths'})

# ── Static routes ──────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory('templates','landing.html')

@app.route('/app')
@app.route('/app/')
def app_page():
    return send_from_directory('templates','index.html')

@app.route('/admin')
@app.route('/admin/')
def admin_page():
    return send_from_directory('templates','admin.html')

@app.route('/<path:path>')
def serve_static(path):
    if path.startswith('api/'): return jsonify({'error':'Not found'}), 404
    if path.startswith('static/') and os.path.exists(path):
        return send_from_directory('.', path)
    return send_from_directory('templates','landing.html')

if __name__ == '__main__':
    app.run(debug=True, port=5000)