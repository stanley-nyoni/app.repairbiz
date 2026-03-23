// ── State ─────────────────────────────────────────────────────────────────────
let token    = localStorage.getItem('rb_token');
let business = (() => { try { return JSON.parse(localStorage.getItem('rb_business') || 'null'); } catch(e) { localStorage.removeItem('rb_business'); return null; } })();
let currentDocType = 'invoice';
let editingDocId   = null;
let docItems = [];
let revenueChart = null, docsChart = null, accChart = null;

// ── API ───────────────────────────────────────────────────────────────────────
async function api(method, path, body = null, isForm = false) {
  const opts = { method, headers: { 'Authorization': `Bearer ${token}` } };
  if (body && !isForm) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  else if (body && isForm) { opts.body = body; }
  try {
    const res = await fetch('/api' + path, opts);
    if (res.status === 401) { doLogout(); return null; }
    const data = await res.json();
    if (res.status === 402 && data.error === 'subscription_required') {
      // Refresh business data and show subscription wall
      business = business || {};
      business.account_status = data.status || 'expired';
      localStorage.setItem('rb_business', JSON.stringify(business));
      checkSubscription();
      return null;
    }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  } catch (e) { toast(e.message, 'error'); return null; }
}

async function apiNoAuth(method, path, body) {
  try {
    const res = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) { showAuthError(data.error || 'Error'); return null; }
    return data;
  } catch (e) { showAuthError('Network error'); return null; }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icons = { success: '✓', error: '✕', warning: '⚠' };
  t.innerHTML = `<span>${icons[type] || '•'}</span> ${msg}`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ── Auth (handled by full implementations appended below) ─────────────────────
function showAuthTab(tab) {
  if(document.getElementById('auth-main')) { showAuthMain(); }
  document.getElementById('tab-login').style.display    = tab==='login'    ? '' : 'none';
  document.getElementById('tab-register').style.display = tab==='register' ? '' : 'none';
  document.querySelectorAll('.auth-tab').forEach((el,i)=>
    el.classList.toggle('active',(i===0&&tab==='login')||(i===1&&tab==='register')));
  document.getElementById('auth-error').style.display='none';
}

function showAuthError(msg, type='error') {
  const el=document.getElementById('auth-error');
  el.textContent=msg; el.className=`alert alert-${type}`; el.style.display='flex';
}

function doLogout() {
  localStorage.removeItem('rb_token'); localStorage.removeItem('rb_business');
  token=null; business=null;
  document.getElementById('app').style.display='none';
  document.getElementById('subscription-wall').style.display='none';
  document.getElementById('auth-screen').style.display='flex';
  if(typeof showAuthMain==='function') showAuthMain();
}

// login/register/logout implemented in full auth block below

// ── Subscription ──────────────────────────────────────────────────────────────
function checkSubscription() {
  if (!business) return true;
  const status = business.account_status;
  const wall = document.getElementById('subscription-wall');
  if (status === 'expired' || status === 'suspended') {
    document.getElementById('app').style.display = 'none';
    const title = document.getElementById('wall-title');
    const sub   = document.getElementById('wall-sub');
    if (status === 'suspended') {
      title.textContent = 'Account Suspended';
      sub.textContent = 'Your account has been suspended. Please contact StanleyBytes to resolve this.';
    } else {
      title.textContent = 'Your trial has ended';
      sub.textContent = 'Get a license code from StanleyBytes to activate your subscription and keep invoicing.';
    }
    wall.style.display = 'flex';
    return false;
  }
  wall.style.display = 'none';
  return true;
}

async function _doActivateLicense(code, inputEl, msgEl, btnEl) {
  const cleaned = (code || '').replace(/-/g,'').trim().toUpperCase();
  if (cleaned.length < 16) {
    msgEl.textContent = 'Please enter a valid 16-character code'; msgEl.style.color = '#ef4444'; return;
  }
  const fullCode = cleaned.replace(/(.{4})(?=.)/g,'$1-');
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Activating…'; }
  msgEl.textContent = 'Checking code…'; msgEl.style.color = '#6b7a99';
  const res = await fetch('/api/license/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ code: fullCode })
  });
  const data = await res.json();
  if (btnEl) { btnEl.disabled = false; btnEl.textContent = '🔑 Activate License'; }
  if (!res.ok) {
    msgEl.textContent = data.error || 'Invalid or already used code'; msgEl.style.color = '#ef4444';
  } else {
    msgEl.textContent = '✅ ' + data.message; msgEl.style.color = '#16a34a';
    business = data.business;
    localStorage.setItem('rb_business', JSON.stringify(business));
    if (inputEl) inputEl.value = '';
    setTimeout(() => {
      document.getElementById('subscription-wall').style.display = 'none';
      initApp();
      updateSettingsPlanInfo();
    }, 1400);
  }
}

async function activateLicense() {
  await _doActivateLicense(
    document.getElementById('license-code-input').value,
    document.getElementById('license-code-input'),
    document.getElementById('license-msg'),
    document.getElementById('license-btn')
  );
}

async function activateLicenseFromSettings() {
  const inp = document.getElementById('settings-license-input');
  const msg = document.getElementById('settings-license-msg');
  await _doActivateLicense(inp.value, inp, msg, null);
}

async function activateLicenseInline() {
  const inp = document.getElementById('inline-license-input');
  const msg = document.getElementById('inline-license-msg');
  if (!inp) return;
  await _doActivateLicense(inp.value, inp, msg, null);
  setTimeout(() => { setWelcomeMessage(); updateSettingsPlanInfo(); }, 1500);
}

function updateSettingsPlanInfo() {
  const el = document.getElementById('settings-plan-info');
  if (!el || !business) return;
  const statusColors = { trial:'#e8620a', active:'#0d9f6f', expired:'#dc2626', suspended:'#6b7a99' };
  const planNames = { trial:'Free Trial', starter:'Starter', pro:'Pro', business:'Business' };
  const status = business.account_status || 'trial';
  const plan = business.plan || 'trial';
  const days = business.days_remaining;
  const expDate = plan === 'trial' ? business.trial_expires_at : business.license_expires_at;
  let expText = expDate ? `Expires: ${expDate.substring(0,10)}` : '';
  if (days !== undefined) expText += ` (${days} day${days===1?'':'s'} left)`;
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
      <div><span style="font-size:12px;font-weight:700;color:#1a2744">Plan:</span>
        <span style="margin-left:6px;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;background:${statusColors[status]}22;color:${statusColors[status]}">${(planNames[plan]||plan).toUpperCase()}</span>
      </div>
      <div style="font-size:12px;color:#6b7a99">${expText}</div>
    </div>
    ${status==='active'?'<div style="font-size:12px;color:#0d9f6f;margin-top:5px">✅ Active. Enter a new code below to renew or upgrade.</div>':''}
    ${status==='trial'?'<div style="font-size:12px;color:#e8620a;margin-top:5px">🆓 Free trial. Enter a code to upgrade anytime — no expiry needed.</div>':''}
  `;
}

// ── Welcome messages ──────────────────────────────────────────────────────────
function setWelcomeMessage() {
  if (!business) return;
  const h = new Date().getHours();
  const name = business.business_name.split(' ')[0];
  let greeting;
  if (h < 12)      greeting = `Good morning, ${name}! ☀️`;
  else if (h < 17) greeting = `Good afternoon, ${name}! 👋`;
  else             greeting = `Good evening, ${name}! 🌙`;
  const subs = [
    'What would you like to create today?',
    'Your documents are ready when you are.',
    'Keep the invoices flowing!',
    "Another day, another invoice. Let's go!",
    'Your customers are waiting for that quote.',
    'Ready to send a professional invoice?',
    "Great to have you back. Let's get to work.",
    "New day, new opportunities. What's first?",
  ];
  const sub = subs[(business.login_count||0) % subs.length];
  document.getElementById('welcome-text').textContent = `${greeting} ${sub}`;

  // Trial countdown bar
  const bar = document.getElementById('trial-bar');
  const status = business.account_status;
  if (status === 'trial') {
      const d = business.days_remaining !== undefined ? business.days_remaining : null;
      bar.style.display = 'block';
      const urgent = d !== null && d <= 5;
      const col  = urgent ? '#dc2626' : '#92400e';
      const icon = urgent ? '⚠️' : '🕐';
      const dText = d === null ? 'Trial active' : d === 0 ? 'Last day!' : `${d} day${d===1?'':'s'} left`;
      document.getElementById('trial-bar-left').innerHTML = `
        <div style="background:var(--navy);padding:14px 18px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-size:14px;font-weight:700;color:#fff">${icon} Free Trial — <strong style="color:${urgent?'#fca5a5':'#fde68a'}">${dText}</strong></div>
            <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:2px">Have a license code? Enter it below to activate your plan</div>
          </div>
        </div>`;
      document.getElementById('trial-bar-right').innerHTML = `
        <div style="padding:14px 18px;background:var(--sf2);display:flex;flex-direction:column;gap:8px">
          <input id="inline-license-input" type="text" placeholder="XXXX-XXXX-XXXX-XXXX"
            style="width:100%;padding:11px;border:1.5px solid var(--border);border-radius:var(--rs);font-family:'Poppins',sans-serif;font-size:14px;text-align:center;letter-spacing:.12em;text-transform:uppercase;outline:none;font-weight:600;box-sizing:border-box;background:#fff;color:var(--navy)"
            oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/(.{4})(?=.)/g,'$1-').substring(0,19)"
            onkeydown="if(event.key==='Enter')activateLicenseInline()">
          <button onclick="activateLicenseInline()"
            style="width:100%;padding:11px;background:var(--navy);color:#fff;border:none;border-radius:var(--rs);font-family:'Poppins',sans-serif;font-size:13px;font-weight:700;cursor:pointer">
            Activate License
          </button>
          <span id="inline-license-msg" style="font-size:12px;font-weight:600;text-align:center;min-height:14px;color:var(--muted)"></span>
        </div>`;
    } else {
      bar.style.display = 'none';
    }

  document.getElementById('welcome-actions').innerHTML =
    `<button class="btn btn-primary btn-sm" onclick="openCreateDoc('invoice')">+ Invoice</button>
     <button class="btn btn-ghost btn-sm" onclick="openCreateDoc('quotation')">+ Quote</button>`;
}

// ── App Init ──────────────────────────────────────────────────────────────────
function initApp() {
  document.getElementById('auth-screen').style.display = 'none';
  if (business && !business.email_verified) {
    document.getElementById('auth-screen').style.display = 'flex';
    if (typeof showVerifyScreen === 'function') showVerifyScreen(business.email);
    return;
  }
  if (!checkSubscription()) return;
  document.getElementById('app').style.display = 'block';
  updateSidebar();
  setWelcomeMessage();
  navigate('dashboard');
}

function updateSidebar() {
  if (!business) return;
  document.getElementById('sidebar-biz-name').textContent = business.business_name;
  document.getElementById('sidebar-email').textContent    = business.email;
  const av = document.getElementById('sidebar-avatar');
  if (business.logo_path) av.innerHTML = `<img src="/${business.logo_path}" alt="">`;
  else av.textContent = business.business_name.charAt(0).toUpperCase();
}

// ── Navigation ────────────────────────────────────────────────────────────────
const pageLabels = { dashboard:'Dashboard', documents:'Documents', accounting:'Accounting', settings:'Settings', customers:'Customers', catalogue:'Services & Parts' };

function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const el = document.getElementById('page-' + page);
  if (el) el.classList.add('active');
  const navItem = [...document.querySelectorAll('.nav-item')].find(n => n.getAttribute('onclick') === `navigate('${page}')`);
  if (navItem) navItem.classList.add('active');
  document.getElementById('topbar-title').textContent = pageLabels[page] || page;
  ['dashboard','documents','accounting','settings'].forEach(p => {
    const bn = document.getElementById('bnav-' + p);
    if (bn) bn.classList.toggle('active', p === page);
  });
  const actions = document.getElementById('topbar-actions');
  actions.innerHTML = '';
  if (page === 'documents' && window.innerWidth >= 768)
    actions.innerHTML = `<button class="btn btn-primary btn-sm" onclick="openCreateDoc('invoice')">+ New Document</button>`;
  if (page === 'customers' && window.innerWidth >= 768)
    actions.innerHTML = `<button class="btn btn-primary btn-sm" onclick="openSaveCustomer()">+ Add Customer</button>`;
  if (page === 'dashboard')   loadDashboard();
  if (page === 'documents')   loadDocuments();
  if (page === 'accounting')  loadAccounting();
  if (page === 'settings')    loadSettings();
  if (page === 'customers')   loadCustomers();
  if (page === 'catalogue')   { if(typeof loadCatalogue==='function') loadCatalogue(); }
  closeSidebar();
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar'), bd = document.getElementById('sidebar-backdrop');
  sb.classList.toggle('open'); bd.classList.toggle('show', sb.classList.contains('open'));
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('show');
}
function showCreateMenu() { openModal('create-menu-modal'); }

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
  const data = await api('GET', '/dashboard');
  if (!data) return;
  const s = data.stats;
  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card"><div class="stat-icon orange"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
      <div><div class="stat-value">${s.invoices}</div><div class="stat-label">Invoices This Month</div></div></div>
    <div class="stat-card"><div class="stat-icon green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/></svg></div>
      <div><div class="stat-value">${s.receipts}</div><div class="stat-label">Receipts This Month</div></div></div>
    <div class="stat-card"><div class="stat-icon blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/></svg></div>
      <div><div class="stat-value">${s.quotations}</div><div class="stat-label">Quotations This Month</div></div></div>
    <div class="stat-card"><div class="stat-icon purple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
      <div><div class="stat-value">R ${formatMoney(s.revenue)}</div><div class="stat-label">Revenue This Month</div></div></div>
  `;

  // ── Overdue panel ──────────────────────────────────────────────────────────
  const overduePanel = document.getElementById('overdue-panel');
  const overdue = data.overdue_invoices || [];
  if (overdue.length > 0 && overduePanel) {
    document.getElementById('overdue-title').textContent =
      `${overdue.length} Overdue Invoice${overdue.length > 1 ? 's' : ''}`;
    document.getElementById('overdue-total').textContent =
      `R ${formatMoney(data.unpaid_total)}`;
    document.getElementById('overdue-list').innerHTML = overdue.slice(0,3).map(d => `
      <div class="overdue-row">
        <div>
          <span style="font-size:12px;font-weight:700;color:#991b1b">${escHtml(d.customer_name)}</span>
          <span style="font-size:11px;color:#b91c1c;margin-left:8px">${d.doc_number}</span>
          <span style="font-size:11px;color:#dc2626;margin-left:6px">· Due ${formatDate(d.due_date)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:13px;font-weight:800;color:#b91c1c">R ${formatMoney(d.total)}</span>
          <button class="btn btn-sm" style="background:#fee2e2;color:#b91c1c;font-size:11px;padding:4px 10px" onclick="openPaymentModal(${d.id})">💳 Pay</button>
          ${d.customer_phone ? `<button class="btn btn-ghost btn-sm btn-icon" style="color:#25d366" onclick="openWhatsApp('${escVal(d.customer_phone)}','${escVal(d.doc_number)}','${escVal(d.customer_name)}')" title="WhatsApp reminder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 11a19.79 19.79 0 01-3.07-8.67A2 2 0 012 .18h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
          </button>` : ''}
        </div>
      </div>`).join('') +
      (overdue.length > 3 ? `<p style="font-size:11px;color:#b91c1c;text-align:center;margin-top:6px;cursor:pointer" onclick="navigate('documents')">+ ${overdue.length - 3} more overdue — View All →</p>` : '');
    overduePanel.style.display = 'block';
  } else if (overduePanel) {
    overduePanel.style.display = 'none';
  }

  // ── Onboarding ─────────────────────────────────────────────────────────────
  loadOnboarding();

  const labels    = data.monthly_chart.map(d => d.month);
  const revenues  = data.monthly_chart.map(d => d.revenue);
  const docsCount = data.monthly_chart.map(d => d.docs);
  if (revenueChart) revenueChart.destroy();
  revenueChart = new Chart(document.getElementById('revenue-chart').getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [{ label:'Revenue (R)', data:revenues, backgroundColor:'rgba(232,93,38,0.8)', borderRadius:6 }] },
    options: { plugins:{ legend:{ display:false } }, scales:{ y:{ beginAtZero:true, ticks:{ callback:v=>'R'+v } } }, responsive:true }
  });
  if (docsChart) docsChart.destroy();
  docsChart = new Chart(document.getElementById('docs-chart').getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [{ label:'Documents', data:docsCount, borderColor:'#1a2744', backgroundColor:'rgba(26,39,68,0.08)', fill:true, tension:0.4, pointBackgroundColor:'#1a2744' }] },
    options: { plugins:{ legend:{ display:false } }, scales:{ y:{ beginAtZero:true } }, responsive:true }
  });

  const limit = window.innerWidth < 768 ? 3 : 5;
  const recent = data.recent_documents.slice(0, limit);
  const wrap = document.getElementById('recent-docs-wrap');
  if (!recent.length) {
    wrap.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><h3>No documents yet</h3><p>Create your first document above</p></div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="doc-cards">
      ${recent.map(d => docCardHtml(d, true)).join('')}
    </div>
    ${data.recent_documents.length > limit ? `<div style="text-align:center;margin-top:8px"><button class="btn btn-ghost btn-sm" onclick="navigate('documents')">View All →</button></div>` : ''}
  `;
}

function docCardHtml(d, compact) {
  const borderColors = { invoice:'#e85d26', receipt:'#22c55e', quotation:'#3b82f6', damage_report:'#f59e0b' };
  return `<div class="doc-card" style="border-left-color:${borderColors[d.doc_type]||'#e85d26'}">
    <div class="doc-card-top">
      <div>
        <div class="doc-card-num">${d.doc_number}</div>
        <span class="badge badge-${d.doc_type}" style="margin-top:4px;display:inline-block">${docTypeLabel(d.doc_type)}</span>
      </div>
      <div class="doc-card-amount">R ${formatMoney(d.total)}</div>
    </div>
    <div class="doc-card-customer">${escHtml(d.customer_name)} &nbsp;·&nbsp; ${formatDate(d.issue_date)}</div>
    <div class="doc-card-footer">
      <span class="badge badge-${d.status}">${d.status}</span>
      <div class="doc-card-actions">
        <button class="btn btn-ghost btn-sm btn-icon" onclick="viewDoc(${d.id})" title="View">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        ${!compact ? `<button class="btn btn-ghost btn-sm btn-icon" onclick="editDoc(${d.id})" title="Edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>` : ''}
      </div>
    </div>
  </div>`;
}

// ── Documents Page ────────────────────────────────────────────────────────────
async function loadDocuments() {
  const search = document.getElementById('doc-search')?.value || '';
  const type   = document.getElementById('doc-filter-type')?.value || '';
  const month  = document.getElementById('doc-filter-month')?.value || '';
  const year   = document.getElementById('doc-filter-year')?.value || '';
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (type)   params.set('type',   type);
  if (month)  params.set('month',  month);
  if (year)   params.set('year',   year);
  const docs = await api('GET', '/documents?' + params.toString());
  if (!docs) return;
  const cnt = document.getElementById('doc-count');
  if (cnt) cnt.textContent = `${docs.length} document${docs.length !== 1 ? 's' : ''}`;

  // Desktop table
  const tbl = document.getElementById('documents-table');
  const cds = document.getElementById('documents-cards');
  const emptyHtml = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><h3>No documents</h3><p>Try adjusting your filters</p></div>`;
  if (!docs.length) { tbl.innerHTML = emptyHtml; cds.innerHTML = emptyHtml; return; }

  tbl.innerHTML = `<table><thead><tr>
    <th>Doc #</th><th>Type</th><th>Customer</th><th>Date</th><th>Amount</th><th>Status</th><th>Actions</th>
  </tr></thead><tbody>${docs.map(d => `<tr>
    <td><strong style="font-size:13px">${d.doc_number}</strong></td>
    <td><span class="badge badge-${d.doc_type}">${docTypeLabel(d.doc_type)}</span></td>
    <td>${escHtml(d.customer_name)}</td>
    <td style="color:var(--muted);font-size:12px">${formatDate(d.issue_date)}</td>
    <td><strong>R ${formatMoney(d.total)}</strong></td>
    <td><span class="badge badge-${d.status}">${d.status}</span></td>
    <td><div style="display:flex;gap:4px">
      <button class="btn btn-ghost btn-sm btn-icon" onclick="viewDoc(${d.id})" title="View"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
      <button class="btn btn-ghost btn-sm btn-icon" onclick="editDoc(${d.id})" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
      <button class="btn btn-danger btn-sm btn-icon" onclick="deleteDoc(${d.id})" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
    </div></td>
  </tr>`).join('')}</tbody></table>`;

  cds.innerHTML = docs.map(d => docCardHtml(d, false)).join('');
}

function clearDocFilters() {
  ['doc-search','doc-filter-type','doc-filter-month','doc-filter-year'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  loadDocuments();
}

// ── Customers ─────────────────────────────────────────────────────────────────
async function loadCustomers() {
  const search = document.getElementById('cust-search')?.value || '';
  const custs = await api('GET', '/customers' + (search ? `?search=${encodeURIComponent(search)}` : ''));
  if (!custs) return;
  const wrap = document.getElementById('customers-list');
  if (!wrap) return;
  if (!custs.length) {
    wrap.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><h3>No customers yet</h3><p>Save customer details for quick access when creating documents</p></div>`;
    return;
  }
  wrap.innerHTML = `<div style="display:grid;gap:10px">` + custs.map(c => `
    <div class="doc-card" style="border-left-color:var(--info);cursor:default">
      <div class="doc-card-top">
        <div>
          <div class="doc-card-num">${escHtml(c.name)}</div>
          ${c.phone ? `<div style="font-size:12px;color:var(--muted);margin-top:2px">${escHtml(c.phone)}</div>` : ''}
          ${c.email ? `<div style="font-size:12px;color:var(--muted)">${escHtml(c.email)}</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end">
          ${c.tax_reg_no ? `<span class="badge badge-draft" style="font-size:9px">TAX: ${escHtml(c.tax_reg_no)}</span>` : ''}
        </div>
      </div>
      ${c.address ? `<div class="doc-card-customer">${escHtml(c.address)}</div>` : ''}
      <div class="doc-card-footer">
        <span style="font-size:11px;color:var(--muted)">${c.notes ? escHtml(c.notes.slice(0,50)) : ''}</span>
        <div class="doc-card-actions">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="editCustomer(${c.id})" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteCustomer(${c.id})" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
        </div>
      </div>
    </div>
  `).join('') + `</div>`;
}

let editingCustomerId = null;
function openSaveCustomer(prefill) {
  editingCustomerId = null;
  document.getElementById('cust-modal-title').textContent = 'Add Customer';
  document.getElementById('cust-form-name').value    = prefill?.name    || '';
  document.getElementById('cust-form-phone').value   = prefill?.phone   || '';
  document.getElementById('cust-form-email').value   = prefill?.email   || '';
  document.getElementById('cust-form-addr').value    = prefill?.address || '';
  document.getElementById('cust-form-tax').value     = prefill?.tax_reg_no || '';
  document.getElementById('cust-form-notes').value   = prefill?.notes   || '';
  openModal('cust-modal');
}

async function editCustomer(id) {
  const custs = await api('GET', '/customers');
  const c = custs?.find(x => x.id === id);
  if (!c) return;
  editingCustomerId = id;
  document.getElementById('cust-modal-title').textContent = 'Edit Customer';
  document.getElementById('cust-form-name').value  = c.name  || '';
  document.getElementById('cust-form-phone').value = c.phone || '';
  document.getElementById('cust-form-email').value = c.email || '';
  document.getElementById('cust-form-addr').value  = c.address || '';
  document.getElementById('cust-form-tax').value   = c.tax_reg_no || '';
  document.getElementById('cust-form-notes').value = c.notes || '';
  openModal('cust-modal');
}

async function saveCustomer() {
  const name = document.getElementById('cust-form-name').value.trim();
  if (!name) { toast('Customer name is required', 'error'); return; }
  const payload = {
    name,
    phone:      document.getElementById('cust-form-phone').value,
    email:      document.getElementById('cust-form-email').value,
    address:    document.getElementById('cust-form-addr').value,
    tax_reg_no: document.getElementById('cust-form-tax').value,
    notes:      document.getElementById('cust-form-notes').value,
  };
  let result;
  if (editingCustomerId) result = await api('PUT', `/customers/${editingCustomerId}`, payload);
  else                   result = await api('POST', '/customers', payload);
  if (result) {
    toast(editingCustomerId ? 'Customer updated' : 'Customer saved', 'success');
    closeModal('cust-modal');
    if (document.getElementById('page-customers')?.classList.contains('active')) loadCustomers();
  }
}

async function deleteCustomer(id) {
  if (!confirm('Delete this customer?')) return;
  const r = await api('DELETE', `/customers/${id}`);
  if (r) { toast('Customer deleted'); loadCustomers(); }
}

// Load customers into datalist for form autocomplete
async function loadCustomerSuggestions() {
  const custs = await api('GET', '/customers');
  if (!custs) return;
  const dl = document.getElementById('customer-datalist');
  if (dl) dl.innerHTML = custs.map(c => `<option value="${escVal(c.name)}" data-phone="${escVal(c.phone||'')}" data-email="${escVal(c.email||'')}" data-addr="${escVal(c.address||'')}" data-tax="${escVal(c.tax_reg_no||'')}">`).join('');
  return custs;
}

function onCustomerNameInput() {
  const val  = document.getElementById('f-cust-name')?.value;
  const dl   = document.getElementById('customer-datalist');
  if (!dl || !val) return;
  const opt  = [...dl.options].find(o => o.value === val);
  if (opt) {
    if (opt.dataset.phone) document.getElementById('f-cust-phone').value = opt.dataset.phone;
    if (opt.dataset.email) document.getElementById('f-cust-email').value = opt.dataset.email;
    if (opt.dataset.addr)  document.getElementById('f-cust-addr').value  = opt.dataset.addr;
    if (opt.dataset.tax)   document.getElementById('f-cust-tax').value   = opt.dataset.tax;
  }
}

// ── Create / Edit Document ────────────────────────────────────────────────────
const DOC_LABELS = { invoice:'Invoice', receipt:'Receipt', quotation:'Quotation', damage_report:'Damage Report' };
const STATUSES   = {
  invoice:       ['draft','sent','paid','cancelled'],
  receipt:       ['draft','paid','cancelled'],
  quotation:     ['draft','sent','approved','rejected','cancelled'],
  damage_report: ['draft','sent','approved','rejected'],
};

function openCreateDoc(type) {
  currentDocType = type; editingDocId = null;
  docItems = [{ item_name:'', description:'', quantity:1, unit_price:0, total:0 }];
  document.getElementById('modal-title').textContent = `New ${DOC_LABELS[type]}`;
  closeModal('create-menu-modal');
  renderDocForm({}, type);
  openModal('doc-modal');
  loadCustomerSuggestions();
}

async function editDoc(id) {
  const doc = await api('GET', `/documents/${id}`);
  if (!doc) return;
  currentDocType = doc.doc_type; editingDocId = id;
  docItems = doc.items?.length ? doc.items : [{ item_name:'', description:'', quantity:1, unit_price:0, total:0 }];
  document.getElementById('modal-title').textContent = `Edit ${DOC_LABELS[doc.doc_type]} — ${doc.doc_number}`;
  renderDocForm(doc, doc.doc_type);
  openModal('doc-modal');
  loadCustomerSuggestions();
}

function renderDocForm(doc, type) {
  const today   = new Date().toISOString().split('T')[0];
  const dueDate = new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0];
  const biz     = business;
  const isDmg   = type === 'damage_report';
  const statusOpts = (STATUSES[type]||[]).map(s =>
    `<option value="${s}" ${doc.status===s?'selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`).join('');

  document.getElementById('doc-modal-body').innerHTML = `
    <div id="form-error" class="alert alert-error" style="display:none"></div>
    <datalist id="customer-datalist"></datalist>

    <!-- Customer Section -->
    <div class="form-section">
      <div class="form-section-title">Customer Information</div>
      <div class="form-group">
        <label class="form-label">Customer Name <span class="req">*</span></label>
        <div style="position:relative">
          <input type="text" class="form-control" id="f-cust-name" value="${escVal(doc.customer_name||'')}"
            placeholder="Type name or select saved customer" list="customer-datalist" autocomplete="off"
            oninput="onCustomerNameInput()">
        </div>
      </div>
      <div class="form-row c2">
        <div class="form-group">
          <label class="form-label">Phone</label>
          <input type="tel" class="form-control" id="f-cust-phone" value="${escVal(doc.customer_phone||'')}" placeholder="+27 …">
        </div>
        <div class="form-group">
          <label class="form-label">Email <span style="color:var(--muted);font-weight:400;font-size:11px">(optional)</span></label>
          <input type="email" class="form-control" id="f-cust-email" value="${escVal(doc.customer_email||'')}" placeholder="customer@email.com">
        </div>
      </div>
      <div class="form-row c2">
        <div class="form-group">
          <label class="form-label">Address</label>
          <input type="text" class="form-control" id="f-cust-addr" value="${escVal(doc.customer_address||'')}" placeholder="Street, City">
        </div>
        <div class="form-group">
          <label class="form-label">Tax Reg No <span style="color:var(--muted);font-weight:400;font-size:11px">(optional)</span></label>
          <input type="text" class="form-control" id="f-cust-tax" value="${escVal(doc.customer_tax_reg_no||'')}" placeholder="4012345678">
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px">
        <span style="font-size:11px;color:var(--muted)">Save this customer for future documents?</span>
        <button class="btn btn-ghost btn-sm" type="button" onclick="saveCurrentCustomer()" style="font-size:11px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Save Customer
        </button>
      </div>
    </div>

    <!-- Doc Details -->
    <div class="form-section">
      <div class="form-section-title">Document Details</div>
      <div class="form-row c3">
        <div class="form-group">
          <label class="form-label">Issue Date</label>
          <input type="date" class="form-control" id="f-issue-date" value="${doc.issue_date||today}">
        </div>
        ${type !== 'receipt' && !isDmg ? `
        <div class="form-group">
          <label class="form-label">Due Date</label>
          <input type="date" class="form-control" id="f-due-date" value="${doc.due_date||dueDate}">
        </div>` : '<div></div>'}
        <div class="form-group">
          <label class="form-label">Status</label>
          <select class="form-control" id="f-status">${statusOpts}</select>
        </div>
      </div>
    </div>

    <!-- Appliance (damage report) -->
    ${isDmg ? `<div class="form-section">
      <div class="form-section-title">Appliance Details</div>
      <div class="form-row c2">
        <div class="form-group"><label class="form-label">Appliance Type</label>
          <input type="text" class="form-control" id="f-app-type" value="${escVal(doc.appliance_type||'')}" placeholder="Washing Machine, Fridge…"></div>
        <div class="form-group"><label class="form-label">Brand</label>
          <input type="text" class="form-control" id="f-app-brand" value="${escVal(doc.appliance_brand||'')}" placeholder="Samsung, LG, Bosch…"></div>
      </div>
      <div class="form-row c2">
        <div class="form-group"><label class="form-label">Model Number</label>
          <input type="text" class="form-control" id="f-model" value="${escVal(doc.model_number||'')}"></div>
        <div class="form-group"><label class="form-label">Serial Number</label>
          <input type="text" class="form-control" id="f-serial" value="${escVal(doc.serial_number||'')}"></div>
      </div>
      <div class="form-group"><label class="form-label">Problem Description</label>
        <textarea class="form-control" id="f-problem" rows="3">${escHtml(doc.problem_description||'')}</textarea></div>
      <div class="form-group"><label class="form-label">Technician Notes</label>
        <textarea class="form-control" id="f-tech-notes" rows="2">${escHtml(doc.technician_notes||'')}</textarea></div>
      <div class="form-group"><label class="form-label">Estimated Repair Cost (R)</label>
        <input type="number" class="form-control" id="f-est-cost" value="${doc.estimated_cost||''}" placeholder="0.00"></div>
    </div>` : ''}

    <!-- Items -->
    ${!isDmg ? `<div class="form-section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div class="form-section-title" style="margin-bottom:0">Items / Services</div>
        <button class="btn btn-ghost btn-sm" type="button" onclick="addItem()">+ Add Item</button>
      </div>
      <div class="items-wrap"><table class="items-table">
        <thead><tr>
          <th style="width:26%">Item Name</th>
          <th style="width:30%">Description</th>
          <th style="width:9%">Qty</th>
          <th style="width:14%">Unit (R)</th>
          <th style="width:14%">Total (R)</th>
          <th style="width:7%"></th>
        </tr></thead>
        <tbody id="items-tbody"></tbody>
      </table></div>
      <div style="display:flex;justify-content:flex-end;margin-top:10px">
        <div style="min-width:220px;background:var(--sf2);border-radius:8px;padding:10px 12px">
          <div class="total-row"><span>Subtotal</span><strong id="f-subtotal">R 0.00</strong></div>
          <div class="total-row">
            <span>VAT (%)</span>
            <input type="number" class="tax-in" id="f-tax-rate" value="${doc.tax_rate||0}" oninput="recalcTotals()">
          </div>
          <div class="total-row"><span>VAT Amount</span><strong id="f-tax-amt">R 0.00</strong></div>
          <div class="total-row grand"><span>TOTAL</span><strong id="f-total">R 0.00</strong></div>
        </div>
      </div>
    </div>` : ''}

    <!-- Banking Details -->
    ${type==='invoice'||type==='quotation' ? `<div class="form-section">
      <div class="form-section-title">Banking Details</div>
      <div class="form-row c2">
        <div class="form-group"><label class="form-label">Bank Name</label>
          <input type="text" class="form-control" id="f-bank-name" value="${escVal(doc.bank_name||biz.bank_name||'')}"></div>
        <div class="form-group"><label class="form-label">Account Holder</label>
          <input type="text" class="form-control" id="f-bank-holder" value="${escVal(doc.bank_account_holder||biz.bank_account_holder||'')}"></div>
      </div>
      <div class="form-row c3">
        <div class="form-group"><label class="form-label">Account Number</label>
          <input type="text" class="form-control" id="f-bank-acc" value="${escVal(doc.bank_account_number||biz.bank_account_number||'')}"></div>
        <div class="form-group"><label class="form-label">Branch Code</label>
          <input type="text" class="form-control" id="f-bank-branch" value="${escVal(doc.bank_branch_code||biz.bank_branch_code||'')}"></div>
        <div class="form-group"><label class="form-label">Reference</label>
          <input type="text" class="form-control" id="f-bank-ref" value="${escVal(doc.bank_reference||biz.bank_reference||'')}"></div>
      </div>
    </div>` : ''}

    <!-- Notes & Terms -->
    <div class="form-section">
      <div class="form-section-title">Notes &amp; Terms</div>
      <div class="form-group"><label class="form-label">Notes</label>
        <textarea class="form-control" id="f-notes" rows="3" placeholder="Work done, warranty info…">${escHtml(doc.notes||'')}</textarea></div>
      <div class="form-group"><label class="form-label">Terms &amp; Conditions</label>
        <textarea class="form-control" id="f-terms" rows="3">${escHtml(doc.terms||biz.terms||'')}</textarea></div>
    </div>
  `;
  renderItems(); recalcTotals();
}

function saveCurrentCustomer() {
  const name = document.getElementById('f-cust-name')?.value.trim();
  if (!name) { toast('Enter a customer name first', 'warning'); return; }
  openSaveCustomer({
    name,
    phone:      document.getElementById('f-cust-phone')?.value || '',
    email:      document.getElementById('f-cust-email')?.value || '',
    address:    document.getElementById('f-cust-addr')?.value  || '',
    tax_reg_no: document.getElementById('f-cust-tax')?.value   || '',
  });
}

function renderItems() {
  const tbody = document.getElementById('items-tbody');
  if (!tbody) return;
  tbody.innerHTML = docItems.map((item, i) => `<tr>
    <td><input class="form-control" type="text" value="${escVal(item.item_name||'')}" oninput="updateItem(${i},'item_name',this.value)" placeholder="Service/Part"></td>
    <td><input class="form-control" type="text" value="${escVal(item.description||'')}" oninput="updateItem(${i},'description',this.value)" placeholder="Details…"></td>
    <td><input class="form-control" type="number" value="${item.quantity||1}" oninput="updateItem(${i},'quantity',this.value)" min="0.01" step="0.01"></td>
    <td><input class="form-control" type="number" value="${item.unit_price||0}" oninput="updateItem(${i},'unit_price',this.value)" min="0" step="0.01"></td>
    <td><input class="form-control" type="number" value="${(item.total||0).toFixed(2)}" readonly style="background:var(--sf2);color:var(--muted)"></td>
    <td style="text-align:center">${docItems.length>1?`<button class="btn btn-danger btn-sm btn-icon" type="button" onclick="removeItem(${i})">✕</button>`:''}</td>
  </tr>`).join('');
}

function updateItem(i, field, val) {
  docItems[i][field] = val;
  if (field==='quantity'||field==='unit_price')
    docItems[i].total = (parseFloat(docItems[i].quantity)||0) * (parseFloat(docItems[i].unit_price)||0);
  recalcTotals();
  const rows = document.querySelectorAll('#items-tbody tr');
  if (rows[i]) { const inp = rows[i].querySelectorAll('input')[4]; if (inp) inp.value = docItems[i].total.toFixed(2); }
}
function addItem()     { docItems.push({ item_name:'', description:'', quantity:1, unit_price:0, total:0 }); renderItems(); }
function removeItem(i) { docItems.splice(i,1); renderItems(); recalcTotals(); }

function recalcTotals() {
  const sub = docItems.reduce((s,i) => s+((parseFloat(i.quantity)||0)*(parseFloat(i.unit_price)||0)), 0);
  const tr  = parseFloat(document.getElementById('f-tax-rate')?.value||0);
  const ta  = sub * tr / 100;
  const tot = sub + ta;
  const s = document.getElementById('f-subtotal'); if (s) s.textContent = 'R '+formatMoney(sub);
  const v = document.getElementById('f-tax-amt');  if (v) v.textContent = 'R '+formatMoney(ta);
  const t = document.getElementById('f-total');    if (t) t.textContent = 'R '+formatMoney(tot);
}

async function saveDocument() {
  const btn  = document.getElementById('save-doc-btn');
  const name = document.getElementById('f-cust-name')?.value.trim();
  if (!name) {
    document.getElementById('form-error').textContent = 'Customer name is required';
    document.getElementById('form-error').style.display = 'flex';
    return;
  }
  btn.disabled = true; btn.innerHTML = '<span>Saving…</span>';
  const isDmg = currentDocType === 'damage_report';
  const payload = {
    doc_type: currentDocType,
    customer_name:      name,
    customer_phone:     document.getElementById('f-cust-phone')?.value  || '',
    customer_email:     document.getElementById('f-cust-email')?.value  || '',
    customer_address:   document.getElementById('f-cust-addr')?.value   || '',
    customer_tax_reg_no: document.getElementById('f-cust-tax')?.value   || '',
    issue_date: document.getElementById('f-issue-date')?.value || new Date().toISOString().split('T')[0],
    due_date:   document.getElementById('f-due-date')?.value   || null,
    status:     document.getElementById('f-status')?.value     || 'draft',
    notes:      document.getElementById('f-notes')?.value      || '',
    terms:      document.getElementById('f-terms')?.value      || '',
    tax_rate:   parseFloat(document.getElementById('f-tax-rate')?.value||0),
  };
  if (!isDmg) payload.items = docItems.map(i => ({ item_name:i.item_name||'', description:i.description||'', quantity:parseFloat(i.quantity)||0, unit_price:parseFloat(i.unit_price)||0 }));
  if (isDmg) {
    payload.appliance_type     = document.getElementById('f-app-type')?.value   || '';
    payload.appliance_brand    = document.getElementById('f-app-brand')?.value  || '';
    payload.model_number       = document.getElementById('f-model')?.value      || '';
    payload.serial_number      = document.getElementById('f-serial')?.value     || '';
    payload.problem_description= document.getElementById('f-problem')?.value    || '';
    payload.technician_notes   = document.getElementById('f-tech-notes')?.value || '';
    payload.estimated_cost     = parseFloat(document.getElementById('f-est-cost')?.value)||null;
  }
  if (currentDocType==='invoice'||currentDocType==='quotation') {
    payload.bank_name           = document.getElementById('f-bank-name')?.value   || '';
    payload.bank_account_holder = document.getElementById('f-bank-holder')?.value || '';
    payload.bank_account_number = document.getElementById('f-bank-acc')?.value    || '';
    payload.bank_branch_code    = document.getElementById('f-bank-branch')?.value || '';
    payload.bank_reference      = document.getElementById('f-bank-ref')?.value    || '';
  }
  const result = editingDocId
    ? await api('PUT',  `/documents/${editingDocId}`, payload)
    : await api('POST', '/documents', payload);
  btn.disabled = false; btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg> Save';
  if (result) {
    closeModal('doc-modal');
    if (editingDocId) {
      toast('Document updated!', 'success');
      if (document.getElementById('page-documents')?.classList.contains('active')) loadDocuments();
      if (document.getElementById('page-dashboard')?.classList.contains('active')) loadDashboard();
    } else {
      // Show share/download sheet after creation
      showPostSaveSheet(result);
    }
  }
}

// ── Post-save share sheet ─────────────────────────────────────────────────────
function showPostSaveSheet(doc) {
  const label = DOC_LABELS[doc.doc_type] || 'Document';
  document.getElementById('share-doc-name').textContent = `${label} ${doc.doc_number} — ${escHtml(doc.customer_name)}`;
  document.getElementById('share-doc-amount').textContent = `R ${formatMoney(doc.total)}`;
  window._shareDocId  = doc.id;
  window._shareDocNum = doc.doc_number;
  openModal('share-modal');
  if (document.getElementById('page-documents')?.classList.contains('active')) loadDocuments();
  if (document.getElementById('page-dashboard')?.classList.contains('active'))  loadDashboard();
}

async function shareAction(action) {
  const id  = window._shareDocId;
  const num = window._shareDocNum;
  if (!id) return;

  if (action === 'download') {
    downloadPDF(id, num);
    closeModal('share-modal');
    return;
  }

  // Fetch the PDF as a blob URL first
  toast('Preparing PDF…');
  try {
    const res = await fetch(`/api/documents/${id}/pdf/view`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Could not load PDF');
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    if (action === 'open') {
      const newTab = window.open(blobUrl, '_blank');
      if (!newTab) {
        // Popup blocked — force download instead
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `${num}.pdf`;
        a.click();
        toast('PDF downloaded — popup was blocked by browser', 'success');
      }
      closeModal('share-modal');
      return;
    }

    // For native share (WhatsApp, email, etc.) use Web Share API if available
    if (action === 'native') {
      const pdfFile = new File([blob], `${num}.pdf`, { type: 'application/pdf' });
      // Try native share with file
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
        try {
          await navigator.share({
            title: `${num}`,
            text: `Please find your ${DOC_LABELS[currentDocType] || 'document'} attached.`,
            files: [pdfFile],
          });
          closeModal('share-modal');
          return;
        } catch(e) {
          if (e.name === 'AbortError') return; // user cancelled
          // Fall through to open in new tab
        }
      }
      // Fallback for browsers that don't support file sharing
      // Open PDF in new tab so user can share manually
      const newTab = window.open(blobUrl, '_blank');
      if (!newTab) {
        // If popup blocked, create a download link instead
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `${num}.pdf`;
        a.click();
      }
      toast('PDF opened — share it from your browser', 'success');
      closeModal('share-modal');
      return;
    }

    if (action === 'whatsapp') {
      // WhatsApp can't receive files from web directly — best is open PDF then copy link
      window.open(blobUrl, '_blank');
      toast('PDF opened. You can share it from your browser.', 'success');
      closeModal('share-modal');
      return;
    }

    if (action === 'email') {
      const custEmail = '';
      const subject   = encodeURIComponent(`${num} — ${DOC_LABELS[currentDocType] || 'Document'}`);
      const body      = encodeURIComponent(`Please find your ${DOC_LABELS[currentDocType]||'document'} ${num} attached.\n\nThank you for your business.`);
      window.open(blobUrl, '_blank');
      window.open(`mailto:${custEmail}?subject=${subject}&body=${body}`);
      closeModal('share-modal');
      return;
    }

  } catch(e) {
    toast(e.message || 'Failed to prepare PDF', 'error');
  }
}

// ── View Document ─────────────────────────────────────────────────────────────
async function viewDoc(id) {
  const doc = await api('GET', `/documents/${id}`);
  if (!doc) return;
  document.getElementById('view-modal-title').textContent = `${DOC_LABELS[doc.doc_type]} — ${doc.doc_number}`;
  document.getElementById('view-modal-body').innerHTML   = renderDocView(doc);
  document.getElementById('view-modal-footer').innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;flex:1;flex-wrap:wrap">
      <select class="form-control" id="view-status-sel" style="width:150px">
        ${(STATUSES[doc.doc_type]||[]).map(s=>`<option value="${s}"${doc.status===s?' selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`).join('')}
      </select>
      <button class="btn btn-navy btn-sm" onclick="updateDocStatus(${doc.id})">Update</button>
    </div>
    <button class="btn btn-ghost btn-sm" onclick="editDoc(${doc.id})">Edit</button>
    <button class="btn btn-ghost btn-sm" onclick="closeModal('view-modal')">Close</button>
    <button class="btn btn-primary btn-sm" onclick="window._shareDocId=${doc.id};window._shareDocNum='${doc.doc_number}';document.getElementById('share-doc-name').textContent='${escVal(DOC_LABELS[doc.doc_type]+' '+doc.doc_number)}';document.getElementById('share-doc-amount').textContent='R ${formatMoney(doc.total)}';closeModal('view-modal');openModal('share-modal')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
      Share PDF
    </button>
  `;
  openModal('view-modal');
}

function renderDocView(doc) {
  const isDmg = doc.doc_type === 'damage_report';
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <div>
        <p style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">Customer</p>
        <p style="font-weight:700;font-size:15px;margin-bottom:2px">${escHtml(doc.customer_name)}</p>
        ${doc.customer_phone   ? `<p style="color:var(--muted);font-size:12px">${escHtml(doc.customer_phone)}</p>` : ''}
        ${doc.customer_email   ? `<p style="color:var(--muted);font-size:12px">${escHtml(doc.customer_email)}</p>` : ''}
        ${doc.customer_address ? `<p style="color:var(--muted);font-size:12px">${escHtml(doc.customer_address)}</p>` : ''}
        ${doc.customer_tax_reg_no ? `<p style="color:var(--muted);font-size:12px">Tax Reg: ${escHtml(doc.customer_tax_reg_no)}</p>` : ''}
      </div>
      <div style="text-align:right">
        <p style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">Amount</p>
        <p style="font-weight:800;font-size:22px;color:var(--accent)">R ${formatMoney(doc.total)}</p>
        <span class="badge badge-${doc.status}">${doc.status}</span>
        <p style="font-size:12px;color:var(--muted);margin-top:4px">${formatDate(doc.issue_date)}${doc.due_date?` · Due ${formatDate(doc.due_date)}`:''}</p>
      </div>
    </div>
    ${!isDmg && doc.items?.length ? `
    <div style="background:var(--sf2);border-radius:8px;overflow:hidden;margin-bottom:14px">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:var(--navy)">
          <th style="padding:7px 10px;text-align:left;font-size:10px;color:white;font-weight:700;text-transform:uppercase">Item</th>
          <th style="padding:7px 10px;text-align:right;font-size:10px;color:white;font-weight:700">Qty</th>
          <th style="padding:7px 10px;text-align:right;font-size:10px;color:white;font-weight:700">Unit</th>
          <th style="padding:7px 10px;text-align:right;font-size:10px;color:white;font-weight:700">Total</th>
        </tr></thead>
        <tbody>
          ${doc.items.map((i,idx)=>`<tr style="background:${idx%2===0?'white':'var(--sf2)'}">
            <td style="padding:8px 10px;font-size:13px;font-weight:600">${escHtml(i.item_name)}${i.description?`<br><span style="font-size:11px;color:var(--muted);font-weight:400">${escHtml(i.description)}</span>`:''}
            </td>
            <td style="padding:8px 10px;text-align:right;font-size:13px">${i.quantity}</td>
            <td style="padding:8px 10px;text-align:right;font-size:13px">R ${formatMoney(i.unit_price)}</td>
            <td style="padding:8px 10px;text-align:right;font-size:13px;font-weight:700">R ${formatMoney(i.total)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div style="padding:10px 12px;display:flex;justify-content:flex-end">
        <div style="min-width:180px">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);padding:3px 0">
            <span>Subtotal</span><span>R ${formatMoney(doc.subtotal)}</span></div>
          ${doc.tax_rate ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);padding:3px 0">
            <span>VAT (${doc.tax_rate}%)</span><span>R ${formatMoney(doc.tax_amount)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:800;color:var(--accent);border-top:2px solid var(--border);padding-top:6px;margin-top:4px">
            <span>Total</span><span>R ${formatMoney(doc.total)}</span></div>
        </div>
      </div>
    </div>` : ''}
    ${isDmg ? `<div style="background:var(--sf2);border-radius:8px;padding:12px;margin-bottom:14px;font-size:13px">
      ${doc.appliance_type  ? `<div><strong>Type:</strong> ${escHtml(doc.appliance_type)}</div>`  : ''}
      ${doc.appliance_brand ? `<div><strong>Brand:</strong> ${escHtml(doc.appliance_brand)}</div>` : ''}
      ${doc.model_number    ? `<div><strong>Model:</strong> ${escHtml(doc.model_number)}</div>`    : ''}
      ${doc.problem_description ? `<div style="margin-top:8px"><strong>Problem:</strong> ${escHtml(doc.problem_description)}</div>` : ''}
      ${doc.estimated_cost  ? `<div style="margin-top:8px;font-weight:700;color:var(--accent)">Estimated Cost: R ${formatMoney(doc.estimated_cost)}</div>` : ''}
    </div>` : ''}
    ${doc.notes ? `<div style="margin-bottom:10px"><strong style="font-size:11px;color:var(--muted);text-transform:uppercase">Notes</strong><p style="font-size:13px;margin-top:4px">${escHtml(doc.notes)}</p></div>` : ''}
  `;
}

async function updateDocStatus(id) {
  const status = document.getElementById('view-status-sel')?.value;
  const r = await api('PATCH', `/documents/${id}/status`, { status });
  if (r) { toast('Status updated', 'success'); closeModal('view-modal'); if (document.getElementById('page-documents')?.classList.contains('active')) loadDocuments(); }
}

async function deleteDoc(id) {
  if (!confirm('Delete this document? This cannot be undone.')) return;
  const r = await api('DELETE', `/documents/${id}`);
  if (r) { toast('Document deleted'); loadDocuments(); }
}

async function downloadPDF(id, docNumber) {
  toast('Generating PDF…');
  try {
    const res = await fetch(`/api/documents/${id}/pdf`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) throw new Error('Failed');
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${docNumber}.pdf`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
    toast('PDF downloaded ✓', 'success');
  } catch(e) {
    toast('Download failed — try Open PDF instead', 'error');
  }
}

// ── Accounting ────────────────────────────────────────────────────────────────
async function loadAccounting() {
  const year = document.getElementById('acc-year')?.value || '2026';
  const data = await api('GET', `/accounting?year=${year}`);
  if (!data) return;
  const totalRevenue = data.totals.reduce((s,t) => s+(t.revenue||0), 0);
  const totalDocs    = data.totals.reduce((s,t) => s+(t.count||0), 0);
  document.getElementById('acc-totals').innerHTML = `
    <div class="stat-card"><div class="stat-icon orange"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
      <div><div class="stat-value">R ${formatMoney(totalRevenue)}</div><div class="stat-label">Total Revenue ${year}</div></div></div>
    ${data.totals.map(t=>`<div class="stat-card"><div class="stat-icon blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
      <div><div class="stat-value">${t.count}</div><div class="stat-label">${docTypeLabel(t.doc_type)}s</div></div></div>`).join('')}
  `;
  const months     = data.monthly.map(m=>m.month.substring(0,3));
  const invRevenue = data.monthly.map(m=>m.invoice_revenue||0);
  const recRevenue = data.monthly.map(m=>m.receipt_revenue||0);
  if (accChart) accChart.destroy();
  accChart = new Chart(document.getElementById('acc-chart').getContext('2d'), {
    type: 'bar',
    data: { labels:months, datasets:[
      { label:'Invoices', data:invRevenue, backgroundColor:'rgba(232,93,38,0.8)', borderRadius:4 },
      { label:'Receipts', data:recRevenue, backgroundColor:'rgba(34,197,94,0.8)',  borderRadius:4 },
    ]},
    options: { plugins:{ legend:{ position:'top' } }, scales:{ y:{ beginAtZero:true, ticks:{ callback:v=>'R'+v } } }, responsive:true }
  });
  document.getElementById('acc-table').innerHTML = `<table><thead><tr>
    <th>Month</th><th>Invoices</th><th>Receipts</th><th>Quotations</th><th>Reports</th><th>Total Revenue</th>
  </tr></thead><tbody>${data.monthly.map(m=>{
    const rev=(m.invoice_revenue||0)+(m.receipt_revenue||0);
    return `<tr><td><strong>${m.month}</strong></td><td>${m.invoice_count||0}</td><td>${m.receipt_count||0}</td><td>${m.quotation_count||0}</td><td>${m.damage_report_count||0}</td><td><strong style="color:var(--accent)">R ${formatMoney(rev)}</strong></td></tr>`;
  }).join('')}</tbody></table>`;
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  const biz = await api('GET', '/business');
  if (!biz) return;
  business = biz; localStorage.setItem('rb_business', JSON.stringify(biz));
  const set = (id,v) => { const el=document.getElementById(id); if(el) el.value=v||''; };
  set('s-biz-name', biz.business_name); set('s-phone', biz.phone);
  set('s-email', biz.email); set('s-address', biz.address);
  set('s-bank-name', biz.bank_name); set('s-bank-holder', biz.bank_account_holder);
  set('s-bank-acc', biz.bank_account_number); set('s-bank-branch', biz.bank_branch_code);
  set('s-bank-ref', biz.bank_reference); set('s-terms', biz.terms);
  if (biz.logo_path) { const p=document.getElementById('logo-preview'); if(p){p.src='/'+biz.logo_path;p.style.display='block';} }
  updateSidebar();
  updateSettingsPlanInfo();
}

async function saveSettings() {
  const payload = {
    business_name: document.getElementById('s-biz-name').value,
    phone: document.getElementById('s-phone').value,
    address: document.getElementById('s-address').value,
    bank_name: document.getElementById('s-bank-name').value,
    bank_account_holder: document.getElementById('s-bank-holder').value,
    bank_account_number: document.getElementById('s-bank-acc').value,
    bank_branch_code: document.getElementById('s-bank-branch').value,
    bank_reference: document.getElementById('s-bank-ref').value,
    terms: document.getElementById('s-terms').value,
  };
  const result = await api('PUT', '/business', payload);
  if (result) { business=result; localStorage.setItem('rb_business',JSON.stringify(result)); updateSidebar(); toast('Settings saved!','success'); }
}

async function uploadLogo(input) {
  const file = input.files[0]; if (!file) return;
  const form = new FormData(); form.append('logo', file);
  const result = await api('POST', '/business/logo', form, true);
  if (result) { business.logo_path=result.logo_path; localStorage.setItem('rb_business',JSON.stringify(business)); const p=document.getElementById('logo-preview'); if(p){p.src='/'+result.logo_path;p.style.display='block';} updateSidebar(); toast('Logo uploaded!','success'); }
}

async function changePassword() {
  const cur=document.getElementById('s-cur-pass').value, nw=document.getElementById('s-new-pass').value;
  if (!cur||!nw) { toast('Fill in both fields','warning'); return; }
  const r = await api('POST','/auth/change-password',{current_password:cur,new_password:nw});
  if (r) { document.getElementById('s-cur-pass').value=''; document.getElementById('s-new-pass').value=''; toast('Password updated!','success'); }
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(overlay =>
  overlay.addEventListener('click', e => { if (e.target===overlay) overlay.classList.remove('open'); })
);

// ── Utils ─────────────────────────────────────────────────────────────────────
function formatMoney(n) { return (parseFloat(n)||0).toLocaleString('en-ZA',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function formatDate(d) {
  if (!d) return '—';
  try { return new Date(d+'T00:00:00').toLocaleDateString('en-ZA',{day:'2-digit',month:'short',year:'numeric'}); } catch { return d; }
}
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escVal(s)  { return String(s||'').replace(/"/g,'&quot;'); }
function docTypeLabel(t) { return {invoice:'Invoice',receipt:'Receipt',quotation:'Quotation',damage_report:'Report'}[t]||t; }

// ── Auth screens ──────────────────────────────────────────────────────────────
function showAuthMain() {
  document.getElementById('auth-main').style.display   = '';
  document.getElementById('auth-verify').style.display = 'none';
  document.getElementById('auth-forgot').style.display = 'none';
}
function showAuthTab(tab) {
  showAuthMain();
  document.getElementById('tab-login').style.display    = tab==='login'    ? '' : 'none';
  document.getElementById('tab-register').style.display = tab==='register' ? '' : 'none';
  document.querySelectorAll('.auth-tab').forEach((el,i)=>
    el.classList.toggle('active',(i===0&&tab==='login')||(i===1&&tab==='register')));
  document.getElementById('auth-error').style.display = 'none';
}
function showVerifyScreen(email) {
  document.getElementById('auth-main').style.display   = 'none';
  document.getElementById('auth-verify').style.display = '';
  document.getElementById('auth-forgot').style.display = 'none';
  document.getElementById('verify-email-display').textContent = email;
  document.getElementById('auth-verify-error').style.display  = 'none';
  document.getElementById('otp-input').value = '';
  setTimeout(()=>document.getElementById('otp-input')?.focus(), 100);
}
function showForgotPassword() {
  document.getElementById('auth-main').style.display   = 'none';
  document.getElementById('auth-verify').style.display = 'none';
  document.getElementById('auth-forgot').style.display = '';
  document.getElementById('forgot-step-1').style.display = '';
  document.getElementById('forgot-step-2').style.display = 'none';
  document.getElementById('auth-forgot-error').style.display = 'none';
}

async function doLogin() {
  const btn=document.getElementById('login-btn');
  const email=document.getElementById('login-email').value.trim();
  const pass=document.getElementById('login-password').value;
  if (!email||!pass){showAuthError('Please fill in all fields');return;}
  btn.disabled=true; btn.textContent='Signing in…';
  const data=await apiNoAuth('POST','/auth/login',{email,password:pass});
  btn.disabled=false; btn.textContent='Sign In to Dashboard';
  if (!data) return;
  token=data.token; business=data.business;
  localStorage.setItem('rb_token',token); localStorage.setItem('rb_business',JSON.stringify(business));
  if (!business.email_verified) { showVerifyScreen(email); } else { initApp(); }
}

async function doRegister() {
  const btn=document.getElementById('reg-btn');
  const biz=document.getElementById('reg-biz').value.trim();
  const email=document.getElementById('reg-email').value.trim();
  const pass=document.getElementById('reg-password').value;
  if (!biz||!email||!pass){showAuthError('Business name, email and password are required');return;}
  if (pass.length<6){showAuthError('Password must be at least 6 characters');return;}
  btn.disabled=true; btn.textContent='Creating account…';
  const data=await apiNoAuth('POST','/auth/register',{business_name:biz,email,password:pass,phone:document.getElementById('reg-phone').value,address:document.getElementById('reg-address').value});
  btn.disabled=false; btn.textContent='Create Account & Get Code';
  if (!data) return;
  token=data.token; business=data.business;
  localStorage.setItem('rb_token',token); localStorage.setItem('rb_business',JSON.stringify(business));
  showVerifyScreen(email);
}

async function doVerifyEmail() {
  const otp=document.getElementById('otp-input').value.trim();
  if (otp.length!==6){showVerifyError('Enter the 6-digit code from your email');return;}
  const btn=document.getElementById('verify-btn');
  btn.disabled=true; btn.textContent='Verifying…';
  try {
    const res=await fetch('/api/auth/verify-email',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({otp})});
    const data=await res.json();
    btn.disabled=false; btn.textContent='Verify & Start Free Trial';
    if (!res.ok){showVerifyError(data.error||'Incorrect code');return;}
    business=data.business; localStorage.setItem('rb_business',JSON.stringify(business));
    initApp();
  } catch(e){btn.disabled=false;btn.textContent='Verify & Start Free Trial';showVerifyError('Network error');}
}

async function doResendOtp() {
  const btn=document.getElementById('resend-btn');
  btn.disabled=true; btn.textContent='Sending…';
  try {
    const res=await fetch('/api/auth/resend-otp',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({})});
    const data=await res.json();
    btn.disabled=false; btn.textContent='Resend Code';
    if (!res.ok){showVerifyError(data.error||'Could not resend');return;}
    document.getElementById('auth-verify-error').style.display='none';
    document.getElementById('otp-input').value='';
    const p=document.createElement('p'); p.style.cssText='font-size:12px;color:#15803d;text-align:center;margin-top:8px';
    p.textContent='✓ New code sent — check your email'; btn.parentNode.insertBefore(p,btn.nextSibling);
    setTimeout(()=>p.remove(),4000);
  } catch(e){btn.disabled=false;btn.textContent='Resend Code';}
}

async function doForgotPassword() {
  const email=document.getElementById('forgot-email').value.trim();
  if (!email){showForgotError('Enter your email address');return;}
  const btn=document.getElementById('forgot-btn');
  btn.disabled=true; btn.textContent='Sending…';
  try {
    await fetch('/api/auth/forgot-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
    btn.disabled=false; btn.textContent='Send Reset Code';
    document.getElementById('forgot-step-1').style.display='none';
    document.getElementById('forgot-step-2').style.display='';
    document.getElementById('auth-forgot-error').style.display='none';
  } catch(e){btn.disabled=false;btn.textContent='Send Reset Code';showForgotError('Network error');}
}

async function doResetPassword() {
  const email=document.getElementById('forgot-email').value.trim();
  const otp=document.getElementById('reset-otp').value.trim();
  const pw=document.getElementById('reset-new-password').value;
  if (!otp||otp.length!==6){showForgotError('Enter the 6-digit code');return;}
  if (!pw||pw.length<6){showForgotError('Password must be at least 6 characters');return;}
  const btn=document.getElementById('reset-btn');
  btn.disabled=true; btn.textContent='Resetting…';
  try {
    const res=await fetch('/api/auth/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,otp,new_password:pw})});
    const data=await res.json();
    btn.disabled=false; btn.textContent='Set New Password';
    if (!res.ok){showForgotError(data.error||'Invalid code');return;}
    showAuthMain(); showAuthTab('login');
    document.getElementById('login-email').value=email;
    showAuthError('Password reset! Sign in with your new password.','success');
  } catch(e){btn.disabled=false;btn.textContent='Set New Password';showForgotError('Network error');}
}

function showAuthError(msg,type='error'){const el=document.getElementById('auth-error');el.textContent=msg;el.className=`alert alert-${type}`;el.style.display='flex';}
function showVerifyError(msg){const el=document.getElementById('auth-verify-error');el.textContent=msg;el.style.display='flex';}
function showForgotError(msg){const el=document.getElementById('auth-forgot-error');el.textContent=msg;el.style.display='flex';}

function doLogout() {
  localStorage.removeItem('rb_token'); localStorage.removeItem('rb_business');
  token=null; business=null;
  document.getElementById('app').style.display='none';
  document.getElementById('subscription-wall').style.display='none';
  document.getElementById('auth-screen').style.display='flex';
  showAuthMain();
}

// ── WhatsApp ───────────────────────────────────────────────────────────────────
function openWhatsApp(phone,docNumber,customerName){
  if (!phone){toast('No phone number saved for this customer','warning');return;}
  const clean=phone.replace(/\s+/g,'').replace(/^0/,'+27');
  const msg=docNumber?encodeURIComponent(`Hi ${customerName}, please find your document ${docNumber} attached. Thank you for your business!`):encodeURIComponent(`Hi ${customerName},`);
  window.open(`https://wa.me/${clean}?text=${msg}`,'_blank');
}

// ── Quick mark paid ────────────────────────────────────────────────────────────
async function quickMarkPaid(docId){
  const r=await api('PATCH',`/documents/${docId}/status`,{status:'paid'});
  if(r){toast('Invoice marked as paid ✓','success');
    if(document.getElementById('page-dashboard')?.classList.contains('active'))loadDashboard();
    if(document.getElementById('page-documents')?.classList.contains('active'))loadDocuments();}
}

// ── Customer history ───────────────────────────────────────────────────────────
async function viewCustomerHistory(custId,custName){
  document.getElementById('cust-history-title').textContent=`${custName} — History`;
  document.getElementById('cust-history-body').innerHTML='<div class="spinner"></div>';
  openModal('cust-history-modal');
  const data=await api('GET',`/customers/${custId}/history`);
  if(!data){document.getElementById('cust-history-body').innerHTML='<p style="color:var(--muted);padding:20px">Could not load history.</p>';return;}
  const c=data.customer; const docs=data.documents;
  document.getElementById('cust-history-body').innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px">
      <div style="background:var(--sf2);border-radius:10px;padding:12px;text-align:center"><div style="font-size:20px;font-weight:800;color:var(--navy)">${data.doc_count}</div><div style="font-size:11px;color:var(--muted);margin-top:2px">Total Jobs</div></div>
      <div style="background:var(--sf2);border-radius:10px;padding:12px;text-align:center"><div style="font-size:18px;font-weight:800;color:var(--accent)">R ${formatMoney(data.total_spent)}</div><div style="font-size:11px;color:var(--muted);margin-top:2px">Total Spent</div></div>
      <div style="background:var(--sf2);border-radius:10px;padding:12px;text-align:center"><div style="font-size:20px;font-weight:800;color:var(--success)">${docs.filter(d=>d.status==='paid').length}</div><div style="font-size:11px;color:var(--muted);margin-top:2px">Paid Jobs</div></div>
    </div>
    ${c.phone||c.email?`<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
      ${c.phone?`<a href="tel:${escVal(c.phone)}" class="btn btn-ghost btn-sm">📞 ${escHtml(c.phone)}</a>`:''}
      ${c.phone?`<button class="btn btn-ghost btn-sm" onclick="openWhatsApp('${escVal(c.phone)}','','${escVal(c.name)}')" style="color:#25d366">💬 WhatsApp</button>`:''}
      ${c.email?`<a href="mailto:${escVal(c.email)}" class="btn btn-ghost btn-sm">✉ ${escHtml(c.email)}</a>`:''}
    </div>`:''}
    <div style="margin-bottom:8px;font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">Document History</div>
    ${!docs.length?`<div class="empty-state"><h3>No documents yet</h3></div>`:
      docs.map(d=>`<div class="doc-card" style="border-left-color:${{invoice:'#e85d26',receipt:'#22c55e',quotation:'#3b82f6',damage_report:'#f59e0b'}[d.doc_type]||'#e85d26'}">
        <div class="doc-card-top"><div><div class="doc-card-num">${d.doc_number}</div><span class="badge badge-${d.doc_type}" style="margin-top:3px;display:inline-block">${docTypeLabel(d.doc_type)}</span></div><div class="doc-card-amount">R ${formatMoney(d.total)}</div></div>
        <div class="doc-card-customer">${formatDate(d.issue_date)}</div>
        <div class="doc-card-footer"><span class="badge badge-${d.status}">${d.status}</span>
          <button class="btn btn-ghost btn-sm btn-icon" onclick="closeModal('cust-history-modal');viewDoc(${d.id})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
        </div></div>`).join('')}`;
}

// ── Duplicate / Convert ────────────────────────────────────────────────────────
function showConvertMenu(docId,docType){
  const opts={invoice:[['receipt','Convert to Receipt'],['quotation','Convert to Quotation']],quotation:[['invoice','Convert to Invoice'],['receipt','Convert to Receipt']],receipt:[['invoice','Convert to Invoice']],damage_report:[['quotation','Convert to Quotation'],['invoice','Convert to Invoice']]};
  document.getElementById('convert-modal-title').textContent='Duplicate or Convert';
  document.getElementById('convert-modal-body').innerHTML=`
    <p style="font-size:13px;color:var(--muted);margin-bottom:14px">All details will be copied into the new document.</p>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn btn-navy btn-full" onclick="duplicateDoc(${docId})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        Duplicate as new ${docTypeLabel(docType)}
      </button>
      ${(opts[docType]||[]).map(([type,label])=>`<button class="btn btn-ghost btn-full" onclick="convertDoc(${docId},'${type}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
        ${label}
      </button>`).join('')}
    </div>`;
  openModal('convert-modal');
}
async function duplicateDoc(docId){closeModal('convert-modal');const result=await api('POST',`/documents/${docId}/duplicate`);if(result){toast(`Duplicated as ${result.doc_number}`,'success');showPostSaveSheet(result);}}
async function convertDoc(docId,targetType){closeModal('convert-modal');const result=await api('POST',`/documents/${docId}/convert`,{target_type:targetType});if(result){toast(`Converted to ${DOC_LABELS[targetType]} ${result.doc_number}`,'success');showPostSaveSheet(result);}}

// ── Catalogue ──────────────────────────────────────────────────────────────────
let catalogueItems=[]; let editingCatId=null;
async function loadCatalogue(){catalogueItems=await api('GET','/catalogue')||[];renderCatalogueList();}
function renderCatalogueList(){
  const wrap=document.getElementById('catalogue-list'); if(!wrap)return;
  const search=(document.getElementById('cat-search')?.value||'').toLowerCase();
  const catFilter=document.getElementById('cat-filter-category')?.value||'';
  const cats=[...new Set(catalogueItems.map(i=>i.category).filter(Boolean))].sort();
  const catSel=document.getElementById('cat-filter-category');
  if(catSel){const cur=catSel.value;catSel.innerHTML='<option value="">All Categories</option>'+cats.map(c=>`<option value="${escVal(c)}"${c===cur?' selected':''}>${escHtml(c)}</option>`).join('');}
  let items=catalogueItems;
  if(search)items=items.filter(i=>(i.item_name||'').toLowerCase().includes(search)||(i.description||'').toLowerCase().includes(search)||(i.category||'').toLowerCase().includes(search));
  if(catFilter)items=items.filter(i=>i.category===catFilter);
  if(!items.length){wrap.innerHTML=`<div class="empty-state">${catalogueItems.length===0?`<h3>No items yet</h3><p>Add your common services, parts and rates</p><button class="btn btn-primary" style="margin-top:12px" onclick="openCatalogueItem()">+ Add First Item</button>`:`<h3>No results</h3>`}</div>`;return;}
  const grouped={};items.forEach(i=>{const c=i.category||'General';if(!grouped[c])grouped[c]=[];grouped[c].push(i);});
  wrap.innerHTML=Object.entries(grouped).sort(([a],[b])=>a.localeCompare(b)).map(([cat,citems])=>`
    <div style="margin-bottom:18px">
      <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">${escHtml(cat)}</div>
      ${citems.map(item=>`<div class="cat-item">
        <div class="cat-item-icon">🔧</div>
        <div class="cat-item-info"><div class="cat-item-name">${escHtml(item.item_name)}</div>${item.description?`<div class="cat-item-desc">${escHtml(item.description)}</div>`:''}</div>
        <div class="cat-item-price">R ${formatMoney(item.unit_price)}</div>
        <div class="cat-item-actions">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="openCatalogueItem(${item.id})" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteCatalogueItem(${item.id})" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>
        </div></div>`).join('')}
    </div>`).join('');}
function openCatalogueItem(id){editingCatId=id||null;const item=id?catalogueItems.find(i=>i.id===id):null;document.getElementById('cat-modal-title').textContent=item?'Edit Item':'Add Item';document.getElementById('cat-form-name').value=item?.item_name||'';document.getElementById('cat-form-desc').value=item?.description||'';document.getElementById('cat-form-price').value=item?.unit_price||'';document.getElementById('cat-form-category').value=item?.category||'';openModal('cat-modal');}
async function saveCatalogueItem(){const name=document.getElementById('cat-form-name').value.trim();const price=parseFloat(document.getElementById('cat-form-price').value);if(!name){toast('Item name required','error');return;}if(isNaN(price)||price<0){toast('Enter a valid price','error');return;}const btn=document.getElementById('cat-save-btn');btn.disabled=true;const payload={item_name:name,description:document.getElementById('cat-form-desc').value.trim(),unit_price:price,category:document.getElementById('cat-form-category').value.trim()||'General'};const result=editingCatId?await api('PUT',`/catalogue/${editingCatId}`,payload):await api('POST','/catalogue',payload);btn.disabled=false;if(result){toast(editingCatId?'Item updated':'Item added','success');closeModal('cat-modal');await loadCatalogue();}}
async function deleteCatalogueItem(id){if(!confirm('Remove this item?'))return;const r=await api('DELETE',`/catalogue/${id}`);if(r){toast('Item removed');await loadCatalogue();}}
async function openCatPicker(){if(!catalogueItems.length)catalogueItems=await api('GET','/catalogue')||[];renderCatPickerList();openModal('cat-picker-modal');}
function renderCatPickerList(){const search=(document.getElementById('cat-picker-search')?.value||'').toLowerCase();const wrap=document.getElementById('cat-picker-list');if(!wrap)return;let items=catalogueItems;if(search)items=items.filter(i=>(i.item_name||'').toLowerCase().includes(search)||(i.description||'').toLowerCase().includes(search));if(!items.length){wrap.innerHTML=`<div class="empty-state" style="padding:24px"><h3>${catalogueItems.length===0?'Catalogue is empty':'No results'}</h3></div>`;return;}wrap.innerHTML=items.map(item=>`<div class="cat-item" onclick="addItemFromCatalogue(${item.id})" style="cursor:pointer;margin-bottom:8px"><div class="cat-item-info"><div class="cat-item-name">${escHtml(item.item_name)}</div>${item.description?`<div class="cat-item-desc">${escHtml(item.description)}</div>`:''}<div style="font-size:10px;color:var(--muted);margin-top:2px">${escHtml(item.category||'General')}</div></div><div class="cat-item-price">R ${formatMoney(item.unit_price)}</div><button class="btn btn-primary btn-sm" style="flex-shrink:0">+ Add</button></div>`).join('');}
function addItemFromCatalogue(id){const item=catalogueItems.find(i=>i.id===id);if(!item)return;docItems.push({item_name:item.item_name,description:item.description||'',quantity:1,unit_price:item.unit_price,total:item.unit_price});renderItems();recalcTotals();toast(`Added: ${item.item_name}`,'success');}

// ── Payment recording ──────────────────────────────────────────────────────────
let _payDocId=null;
async function openPaymentModal(docId){
  _payDocId=docId;
  const doc=await api('GET',`/documents/${docId}`); if(!doc)return;
  const amountPaid=parseFloat(doc.amount_paid||0); const balance=Math.max(0,parseFloat(doc.total||0)-amountPaid);
  document.getElementById('payment-doc-info').innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
      <div><div style="font-size:13px;font-weight:700;color:var(--navy)">${escHtml(doc.customer_name)} — ${doc.doc_number}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">${docTypeLabel(doc.doc_type)} · ${formatDate(doc.issue_date)}</div></div>
      <div style="text-align:right"><div style="font-size:18px;font-weight:800;color:var(--accent)">R ${formatMoney(doc.total)}</div>
        ${amountPaid>0?`<div style="font-size:11px;color:var(--success)">Paid: R ${formatMoney(amountPaid)}</div>`:''}
        ${balance>0?`<div style="font-size:12px;font-weight:700;color:#b91c1c">Balance: R ${formatMoney(balance)}</div>`:''}</div></div>`;
  document.getElementById('pay-amount').value=balance>0?balance.toFixed(2):doc.total;
  document.getElementById('pay-date').value=new Date().toISOString().split('T')[0];
  document.getElementById('pay-ref').value=''; document.getElementById('pay-note').value='';
  document.getElementById('payment-change-box').style.display='none';
  const payments=await api('GET',`/documents/${docId}/payments`);
  const ep=document.getElementById('existing-payments');
  if(payments?.length){ep.innerHTML=`<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Payment History</div>`+payments.map(p=>`<div class="exp-row"><div style="flex:1"><span style="font-size:12px;font-weight:600">${p.method?.toUpperCase()}</span>${p.reference?`<span style="font-size:11px;color:var(--muted);margin-left:6px">${escHtml(p.reference)}</span>`:''}<div style="font-size:11px;color:var(--muted)">${formatDate(p.paid_at)}${p.note?` · ${escHtml(p.note)}`:''}</div></div><span style="font-size:13px;font-weight:700;color:var(--success)">R ${formatMoney(p.amount)}</span><button class="btn btn-danger btn-sm btn-icon" onclick="deletePaymentRecord(${p.id},${docId})">✕</button></div>`).join('');}else{ep.innerHTML='';}
  openModal('payment-modal');
}
async function recordPayment(){
  const amount=parseFloat(document.getElementById('pay-amount')?.value||0);
  if(!amount||amount<=0){toast('Enter a valid amount','error');return;}
  const btn=document.getElementById('pay-btn'); btn.disabled=true;
  const result=await api('POST',`/documents/${_payDocId}/payments`,{amount,method:document.getElementById('pay-method')?.value,reference:document.getElementById('pay-ref')?.value,note:document.getElementById('pay-note')?.value,paid_at:document.getElementById('pay-date')?.value});
  btn.disabled=false;
  if(result){const doc=result.document;const ps=doc.payment_status;
    if(ps==='paid')toast(`Invoice fully PAID ✓`,'success');
    else if(ps==='partial')toast(`Partial payment recorded — R ${formatMoney(doc.amount_paid)} of R ${formatMoney(doc.total)} paid`,'success');
    else toast('Payment recorded','success');
    closeModal('payment-modal');
    if(document.getElementById('page-dashboard')?.classList.contains('active'))loadDashboard();
    if(document.getElementById('page-documents')?.classList.contains('active'))loadDocuments();}
}
async function deletePaymentRecord(paymentId,docId){if(!confirm('Remove this payment record?'))return;const r=await api('DELETE',`/payments/${paymentId}`);if(r){toast('Payment removed');openPaymentModal(docId);}}

// ── Expenses ───────────────────────────────────────────────────────────────────
let _editingExpenseId=null; let _accProfitChart=null; let _accTab='revenue';
function switchAccTab(tab){_accTab=tab;['revenue','expenses','profit'].forEach(t=>{const btn=document.getElementById(`acc-tab-${t}`);const pane=document.getElementById(`acc-pane-${t}`);if(btn){btn.style.background=t===tab?'var(--accent)':'#fff';btn.style.color=t===tab?'#fff':'var(--muted)';}if(pane)pane.style.display=t===tab?'block':'none';});}
function openExpenseModal(id){_editingExpenseId=id||null;document.getElementById('expense-modal-title').textContent=id?'Edit Expense':'Add Expense';['exp-desc','exp-amount','exp-category','exp-vendor','exp-notes'].forEach(i=>{const el=document.getElementById(i);if(el)el.value='';});document.getElementById('exp-date').value=new Date().toISOString().split('T')[0];openModal('expense-modal');}
async function saveExpense(){const desc=document.getElementById('exp-desc').value.trim();const amount=parseFloat(document.getElementById('exp-amount').value||0);if(!desc){toast('Description required','error');return;}if(amount<=0){toast('Enter a valid amount','error');return;}const btn=document.getElementById('exp-save-btn');btn.disabled=true;const payload={description:desc,amount,category:document.getElementById('exp-category').value||'General',vendor:document.getElementById('exp-vendor').value,expense_date:document.getElementById('exp-date').value,notes:document.getElementById('exp-notes').value};const result=_editingExpenseId?await api('PUT',`/expenses/${_editingExpenseId}`,payload):await api('POST','/expenses',payload);btn.disabled=false;if(result){toast(_editingExpenseId?'Expense updated':'Expense recorded','success');closeModal('expense-modal');loadAccounting();}}
async function deleteExpense(id){if(!confirm('Delete this expense?'))return;const r=await api('DELETE',`/expenses/${id}`);if(r){toast('Expense deleted');loadAccounting();}}

// ── Job Templates ──────────────────────────────────────────────────────────────
let templates=[]; let editingTemplateId=null; let templateItems=[];
async function loadTemplates(){templates=await api('GET','/templates')||[];renderTemplatesList();}
function renderTemplatesList(){const wrap=document.getElementById('templates-list');if(!wrap)return;if(!templates.length){wrap.innerHTML=`<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px">No templates yet. Create one to speed up document creation.</div>`;return;}wrap.innerHTML=templates.map(t=>`<div class="doc-card" style="border-left-color:var(--navy);margin-bottom:8px"><div class="doc-card-top"><div><div class="doc-card-num">${escHtml(t.name)}</div><span class="badge badge-${t.doc_type}" style="margin-top:3px;display:inline-block">${docTypeLabel(t.doc_type)}</span><span style="font-size:11px;color:var(--muted);margin-left:8px">${t.items?.length||0} item(s)</span></div><div style="display:flex;gap:5px"><button class="btn btn-ghost btn-sm btn-icon" onclick="openTemplateModal(${t.id})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><button class="btn btn-danger btn-sm btn-icon" onclick="deleteTemplate(${t.id})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button></div></div></div>`).join('');}
function openTemplateModal(id){editingTemplateId=id||null;const t=id?templates.find(x=>x.id===id):null;document.getElementById('template-modal-title').textContent=t?'Edit Template':'New Job Template';document.getElementById('tpl-name').value=t?.name||'';document.getElementById('tpl-doc-type').value=t?.doc_type||'invoice';document.getElementById('tpl-tax-rate').value=t?.tax_rate||0;document.getElementById('tpl-notes').value=t?.notes||'';templateItems=t?.items?.map(i=>({...i}))||[{item_name:'',description:'',quantity:1,unit_price:0}];renderTemplateItems();openModal('template-modal');}
function renderTemplateItems(){const wrap=document.getElementById('tpl-items-list');if(!wrap)return;wrap.innerHTML=templateItems.map((item,i)=>`<div class="tpl-item-row"><input class="form-control" type="text" value="${escVal(item.item_name||'')}" placeholder="Item name" oninput="templateItems[${i}].item_name=this.value" style="font-size:12px"><input class="form-control" type="number" value="${item.quantity||1}" placeholder="Qty" min="0.01" step="0.01" oninput="templateItems[${i}].quantity=parseFloat(this.value)||1" style="font-size:12px"><input class="form-control" type="number" value="${item.unit_price||0}" placeholder="Price" min="0" step="0.01" oninput="templateItems[${i}].unit_price=parseFloat(this.value)||0" style="font-size:12px">${templateItems.length>1?`<button class="btn btn-danger btn-sm btn-icon" onclick="templateItems.splice(${i},1);renderTemplateItems()">✕</button>`:'<div></div>'}</div>`).join('');}
function addTemplateItem(){templateItems.push({item_name:'',description:'',quantity:1,unit_price:0});renderTemplateItems();}
async function saveTemplate(){const name=document.getElementById('tpl-name').value.trim();if(!name){toast('Template name required','error');return;}const btn=document.getElementById('tpl-save-btn');btn.disabled=true;const payload={name,doc_type:document.getElementById('tpl-doc-type').value,tax_rate:parseFloat(document.getElementById('tpl-tax-rate').value)||0,notes:document.getElementById('tpl-notes').value,items:templateItems.filter(i=>i.item_name)};const result=editingTemplateId?await api('PUT',`/templates/${editingTemplateId}`,payload):await api('POST','/templates',payload);btn.disabled=false;if(result){toast(editingTemplateId?'Template updated':'Template saved','success');closeModal('template-modal');await loadTemplates();}}
async function deleteTemplate(id){if(!confirm('Delete this template?'))return;const r=await api('DELETE',`/templates/${id}`);if(r){toast('Template deleted');await loadTemplates();}}
async function openTemplatePicker(){if(!templates.length)templates=await api('GET','/templates')||[];const wrap=document.getElementById('template-picker-list');if(!templates.length){wrap.innerHTML=`<div style="text-align:center;padding:24px;color:var(--muted)">No templates saved yet.<br><button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="closeModal('template-picker-modal');navigate('settings')">Go to Settings to create one</button></div>`;openModal('template-picker-modal');return;}wrap.innerHTML=templates.map(t=>`<div class="cat-item" onclick="applyTemplate(${t.id})" style="margin-bottom:8px"><div class="cat-item-icon">📋</div><div class="cat-item-info"><div class="cat-item-name">${escHtml(t.name)}</div><div class="cat-item-desc">${docTypeLabel(t.doc_type)} · ${t.items?.length||0} item(s)${t.tax_rate?` · VAT ${t.tax_rate}%`:''}</div></div><button class="btn btn-primary btn-sm">Use</button></div>`).join('');openModal('template-picker-modal');}
function applyTemplate(id){const t=templates.find(x=>x.id===id);if(!t)return;closeModal('template-picker-modal');currentDocType=t.doc_type;editingDocId=null;docItems=t.items?.length?t.items.map(i=>({item_name:i.item_name,description:i.description||'',quantity:i.quantity||1,unit_price:i.unit_price||0,total:(i.quantity||1)*(i.unit_price||0)})):[{item_name:'',description:'',quantity:1,unit_price:0,total:0}];document.getElementById('modal-title').textContent=`New ${DOC_LABELS[t.doc_type]} — ${t.name}`;renderDocForm({tax_rate:t.tax_rate,notes:t.notes},t.doc_type);openModal('doc-modal');loadCustomerSuggestions();toast(`Template "${t.name}" applied`,'success');}

// ── Signature ──────────────────────────────────────────────────────────────────
let _sigDocId=null,_sigCanvas=null,_sigCtx=null,_sigDrawing=false;
function openSignatureModal(docId){_sigDocId=docId;openModal('signature-modal');setTimeout(()=>{_sigCanvas=document.getElementById('signature-canvas');if(!_sigCanvas)return;_sigCanvas.width=_sigCanvas.offsetWidth;_sigCanvas.height=180;_sigCtx=_sigCanvas.getContext('2d');_sigCtx.strokeStyle='#1a2744';_sigCtx.lineWidth=2.5;_sigCtx.lineCap='round';_sigCtx.lineJoin='round';_sigCtx.fillStyle='#fff';_sigCtx.fillRect(0,0,_sigCanvas.width,_sigCanvas.height);const getPos=(e)=>{const r=_sigCanvas.getBoundingClientRect();const src=e.touches?e.touches[0]:e;return{x:src.clientX-r.left,y:src.clientY-r.top};};_sigCanvas.onmousedown=_sigCanvas.ontouchstart=(e)=>{e.preventDefault();_sigDrawing=true;const p=getPos(e);_sigCtx.beginPath();_sigCtx.moveTo(p.x,p.y);};_sigCanvas.onmousemove=_sigCanvas.ontouchmove=(e)=>{e.preventDefault();if(!_sigDrawing)return;const p=getPos(e);_sigCtx.lineTo(p.x,p.y);_sigCtx.stroke();};_sigCanvas.onmouseup=_sigCanvas.ontouchend=()=>{_sigDrawing=false;};},100);}
function clearSignature(){if(_sigCtx&&_sigCanvas){_sigCtx.fillStyle='#fff';_sigCtx.fillRect(0,0,_sigCanvas.width,_sigCanvas.height);}}
async function saveSignature(){if(!_sigCanvas||!_sigDocId)return;const data=_sigCanvas.toDataURL('image/png');const btn=document.getElementById('sig-save-btn');btn.disabled=true;const r=await api('POST',`/documents/${_sigDocId}/signature`,{signature_data:data});btn.disabled=false;if(r){toast('Signature saved — will appear in PDF ✓','success');closeModal('signature-modal');}}

// ── Settings (enhanced) ────────────────────────────────────────────────────────
async function loadSettings(){
  const biz=await api('GET','/business'); if(!biz)return;
  business=biz; localStorage.setItem('rb_business',JSON.stringify(biz));
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v||'';};
  set('s-biz-name',biz.business_name); set('s-phone',biz.phone);
  set('s-email',biz.email); set('s-address',biz.address);
  set('s-bank-name',biz.bank_name); set('s-bank-holder',biz.bank_account_holder);
  set('s-bank-acc',biz.bank_account_number); set('s-bank-branch',biz.bank_branch_code);
  set('s-bank-ref',biz.bank_reference); set('s-terms',biz.terms);
  const accent=biz.accent_color||'#1a2233';
  const colorEl=document.getElementById('s-accent-color');const hexEl=document.getElementById('s-accent-color-hex');
  if(colorEl)colorEl.value=accent; if(hexEl)hexEl.value=accent;
  const bar=document.getElementById('pdf-accent-bar'); if(bar)bar.style.background=accent;
  set('s-footer-message',biz.footer_message||'Thank you for your business.');
  const sigCheck=document.getElementById('s-show-signature'); if(sigCheck)sigCheck.checked=!!(biz.pdf_show_signature);
  set('s-inv-prefix',biz.invoice_prefix||'INV'); set('s-rec-prefix',biz.receipt_prefix||'REC');
  set('s-quo-prefix',biz.quotation_prefix||'QUO'); set('s-rep-prefix',biz.report_prefix||'REP');
  set('s-doc-format',biz.doc_number_format||'{PREFIX}-{N:05d}');
  updateFormatPreview();
  if(biz.logo_path){const p=document.getElementById('logo-preview');if(p){p.src='/'+biz.logo_path;p.style.display='block';}}
  updateSidebar(); updateSettingsPlanInfo(); loadTemplates();
}
async function saveSettings(){
  const accent=document.getElementById('s-accent-color-hex')?.value||document.getElementById('s-accent-color')?.value||'#1a2233';
  const payload={business_name:document.getElementById('s-biz-name').value,phone:document.getElementById('s-phone').value,address:document.getElementById('s-address').value,bank_name:document.getElementById('s-bank-name').value,bank_account_holder:document.getElementById('s-bank-holder').value,bank_account_number:document.getElementById('s-bank-acc').value,bank_branch_code:document.getElementById('s-bank-branch').value,bank_reference:document.getElementById('s-bank-ref').value,terms:document.getElementById('s-terms').value,accent_color:accent,footer_message:document.getElementById('s-footer-message')?.value||'',pdf_show_signature:document.getElementById('s-show-signature')?.checked?1:0,invoice_prefix:document.getElementById('s-inv-prefix')?.value||'INV',receipt_prefix:document.getElementById('s-rec-prefix')?.value||'REC',quotation_prefix:document.getElementById('s-quo-prefix')?.value||'QUO',report_prefix:document.getElementById('s-rep-prefix')?.value||'REP',doc_number_format:document.getElementById('s-doc-format')?.value||'{PREFIX}-{N:05d}'};
  const result=await api('PUT','/business',payload);
  if(result){business=result;localStorage.setItem('rb_business',JSON.stringify(result));updateSidebar();toast('Settings saved!','success');}
}
function syncColorHex(val){if(/^#[0-9a-fA-F]{6}$/.test(val)){const cp=document.getElementById('s-accent-color');if(cp)cp.value=val;const bar=document.getElementById('pdf-accent-bar');if(bar)bar.style.background=val;}}
function updateFormatPreview(){const fmt=document.getElementById('s-doc-format')?.value||'{PREFIX}-{N:05d}';const prefix=document.getElementById('s-inv-prefix')?.value||'INV';const year=new Date().getFullYear();const preview=fmt.replace('{PREFIX}',prefix).replace('{YEAR}',year).replace('{N:05d}','00001').replace('{N}','1');const el=document.getElementById('format-preview');if(el)el.textContent=`Preview: ${preview}`;}

// ── Accounting (full with expenses + profit) ───────────────────────────────────
async function loadAccounting(){
  const year=document.getElementById('acc-year')?.value||new Date().getFullYear().toString();
  const data=await api('GET',`/accounting?year=${year}`); if(!data)return;
  const totalRevenue=data.totals.reduce((s,t)=>s+(t.revenue||0),0);
  document.getElementById('acc-totals').innerHTML=`<div class="stat-card"><div class="stat-icon orange"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div><div><div class="stat-value">R ${formatMoney(totalRevenue)}</div><div class="stat-label">Total Revenue ${year}</div></div></div>${data.totals.map(t=>`<div class="stat-card"><div class="stat-icon blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><div><div class="stat-value">${t.count}</div><div class="stat-label">${docTypeLabel(t.doc_type)}s</div></div></div>`).join('')}`;
  const months=data.monthly.map(m=>m.month.substring(0,3));
  const invRev=data.monthly.map(m=>m.invoice_revenue||0);
  const recRev=data.monthly.map(m=>m.receipt_revenue||0);
  if(accChart)accChart.destroy();
  accChart=new Chart(document.getElementById('acc-chart').getContext('2d'),{type:'bar',data:{labels:months,datasets:[{label:'Invoices',data:invRev,backgroundColor:'rgba(232,93,38,0.8)',borderRadius:4},{label:'Receipts',data:recRev,backgroundColor:'rgba(34,197,94,0.8)',borderRadius:4}]},options:{plugins:{legend:{position:'top'}},scales:{y:{beginAtZero:true,ticks:{callback:v=>'R'+v}}},responsive:true}});
  document.getElementById('acc-table').innerHTML=`<table><thead><tr><th>Month</th><th>Invoices</th><th>Receipts</th><th>Quotations</th><th>Reports</th><th>Total Revenue</th></tr></thead><tbody>${data.monthly.map(m=>{const rev=(m.invoice_revenue||0)+(m.receipt_revenue||0);return `<tr><td><strong>${m.month}</strong></td><td>${m.invoice_count||0}</td><td>${m.receipt_count||0}</td><td>${m.quotation_count||0}</td><td>${m.damage_report_count||0}</td><td><strong style="color:var(--accent)">R ${formatMoney(rev)}</strong></td></tr>`;}).join('')}</tbody></table>`;
  // Expenses tab
  const totalExp=data.total_expenses||0; const expByCat=data.expense_by_category||[];
  document.getElementById('acc-expense-totals').innerHTML=`<div class="stat-card"><div class="stat-icon" style="background:#fee2e2;color:#b91c1c"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-2 9H20l-2-9"/></svg></div><div><div class="stat-value">R ${formatMoney(totalExp)}</div><div class="stat-label">Total Expenses ${year}</div></div></div>${expByCat.slice(0,3).map(c=>`<div class="stat-card"><div class="stat-icon blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg></div><div><div class="stat-value">R ${formatMoney(c.total)}</div><div class="stat-label">${escHtml(c.category)}</div></div></div>`).join('')}`;
  const expData=await api('GET',`/expenses?year=${year}`);
  const expTable=document.getElementById('acc-expense-table');
  if(expData?.length){expTable.innerHTML=`<table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Vendor</th><th>Amount</th><th></th></tr></thead><tbody>${expData.map(e=>`<tr><td style="font-size:12px;color:var(--muted)">${formatDate(e.expense_date)}</td><td><strong style="font-size:13px">${escHtml(e.description)}</strong>${e.notes?`<br><span style="font-size:11px;color:var(--muted)">${escHtml(e.notes)}</span>`:''}</td><td><span class="badge badge-draft">${escHtml(e.category||'General')}</span></td><td style="font-size:12px;color:var(--muted)">${escHtml(e.vendor||'—')}</td><td><strong style="color:#b91c1c">R ${formatMoney(e.amount)}</strong></td><td><button class="btn btn-danger btn-sm btn-icon" onclick="deleteExpense(${e.id})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button></td></tr>`).join('')}</tbody></table>`;}
  else{expTable.innerHTML=`<div class="empty-state" style="padding:30px"><h3>No expenses for ${year}</h3><p>Tap "+ Add Expense" to start tracking</p></div>`;}
  // Profit tab
  const profRev=data.monthly.map(m=>(m.invoice_revenue||0)+(m.receipt_revenue||0));
  const profExp=data.monthly.map(m=>m.expenses||0);
  const profNet=profRev.map((r,i)=>r-(profExp[i]||0));
  const netTotal=profNet.reduce((a,b)=>a+b,0);
  document.getElementById('acc-profit-totals').innerHTML=`<div class="stat-card"><div class="stat-icon green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg></div><div><div class="stat-value" style="color:${netTotal>=0?'var(--success)':'#b91c1c'}">R ${formatMoney(netTotal)}</div><div class="stat-label">Net Profit ${year}</div></div></div><div class="stat-card"><div class="stat-icon orange"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></div><div><div class="stat-value">R ${formatMoney(totalRevenue)}</div><div class="stat-label">Revenue</div></div></div><div class="stat-card"><div class="stat-icon" style="background:#fee2e2;color:#b91c1c"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4"/></svg></div><div><div class="stat-value">R ${formatMoney(totalExp)}</div><div class="stat-label">Expenses</div></div></div><div class="stat-card"><div class="stat-icon purple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div><div><div class="stat-value">${totalRevenue>0?Math.round((netTotal/totalRevenue)*100):0}%</div><div class="stat-label">Profit Margin</div></div></div>`;
  if(_accProfitChart)_accProfitChart.destroy();
  _accProfitChart=new Chart(document.getElementById('acc-profit-chart').getContext('2d'),{type:'bar',data:{labels:months,datasets:[{label:'Revenue',data:profRev,backgroundColor:'rgba(34,197,94,0.7)',borderRadius:4},{label:'Expenses',data:profExp,backgroundColor:'rgba(239,68,68,0.6)',borderRadius:4},{label:'Profit',data:profNet,type:'line',borderColor:'#1a2744',backgroundColor:'rgba(26,39,68,0.08)',fill:true,tension:0.4,pointBackgroundColor:'#1a2744'}]},options:{plugins:{legend:{position:'top'}},scales:{y:{beginAtZero:true,ticks:{callback:v=>'R'+v}}},responsive:true}});
}

// ── Onboarding ────────────────────────────────────────────────────────────────
const ONBOARDING_STEPS = [
  {
    key:    'has_logo',
    icon:   '🖼️',
    title:  'Upload your business logo',
    hint:   'Appears on every PDF you send to customers',
    action: () => navigate('settings'),
  },
  {
    key:    'has_banking',
    icon:   '🏦',
    title:  'Add your banking details',
    hint:   'Printed on invoices so customers know where to pay',
    action: () => navigate('settings'),
  },
  {
    key:    'has_catalogue',
    icon:   '🔧',
    title:  'Add your services & parts',
    hint:   'Save common jobs so you can add them to invoices in one tap',
    action: () => navigate('catalogue'),
  },
  {
    key:    'has_terms',
    icon:   '📋',
    title:  'Set your terms & conditions',
    hint:   'Printed on every document — warranty period, payment terms etc.',
    action: () => navigate('settings'),
  },
  {
    key:    'has_document',
    icon:   '📄',
    title:  'Create your first invoice',
    hint:   'Try it out — create a test invoice and share the PDF',
    action: () => openCreateDoc('invoice'),
  },
];

function dismissOnboarding() {
  localStorage.setItem('rb_onboarding_dismissed', '1');
  const panel = document.getElementById('onboarding-panel');
  if (panel) panel.style.display = 'none';
}

async function loadOnboarding() {
  // Don't show if user has explicitly dismissed
  if (localStorage.getItem('rb_onboarding_dismissed')) return;

  const data = await api('GET', '/onboarding');
  if (!data) return;

  const steps   = ONBOARDING_STEPS.map(s => ({ ...s, done: !!data[s.key] }));
  const doneCount = steps.filter(s => s.done).length;
  const total     = steps.length;
  const allDone   = doneCount === total;

  // Auto-dismiss if everything is done and user has been around for a while
  if (allDone && data.login_count > 3) {
    dismissOnboarding();
    return;
  }

  const panel = document.getElementById('onboarding-panel');
  if (!panel) return;
  panel.style.display = 'block';

  // Progress bar
  document.getElementById('onboarding-fraction').textContent = `${doneCount} / ${total} complete`;
  document.getElementById('onboarding-bar').style.width = `${(doneCount / total) * 100}%`;

  if (allDone) {
    document.getElementById('onboarding-steps').style.display   = 'none';
    document.getElementById('onboarding-complete').style.display = 'block';
    return;
  }

  document.getElementById('onboarding-steps').style.display   = 'grid';
  document.getElementById('onboarding-complete').style.display = 'none';

  document.getElementById('onboarding-steps').innerHTML = steps.map((s, i) => `
    <div class="onboarding-step ${s.done ? 'done' : ''}" onclick="${s.done ? '' : `onboardingGo(${i})`}">
      <div class="ob-icon ${s.done ? 'done' : 'pending'}">${s.icon}</div>
      <div class="ob-body">
        <div class="ob-title ${s.done ? 'done' : ''}">${s.title}</div>
        <div class="ob-hint">${s.hint}</div>
      </div>
      <div class="ob-check ${s.done ? 'done' : 'pending'}">${s.done ? '✓' : i + 1}</div>
    </div>`).join('');
}

function onboardingGo(stepIndex) {
  const step = ONBOARDING_STEPS[stepIndex];
  if (step && step.action) step.action();
}

// ── Boot ──────────────────────────────────────────────────────────────────────
function initApp() {
  document.getElementById('auth-screen').style.display = 'none';
  if (business && !business.email_verified) {
    document.getElementById('auth-screen').style.display = 'flex';
    showVerifyScreen(business.email);
    return;
  }
  if (!checkSubscription()) return;
  document.getElementById('app').style.display = 'block';
  updateSidebar();
  setWelcomeMessage();
  navigate('dashboard');
}

if (token && business) {
  initApp();
} else {
  document.getElementById('auth-screen').style.display = 'flex';
  if (window.location.hash === '#register') {
    showAuthTab('register');
    history.replaceState(null, '', window.location.pathname);
  }
}