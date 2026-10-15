const API = window.API_BASE || '';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// ชนิดการ์ด: [ชื่อ, emoji, สีกรอบ, สีพื้นภาพ] เลือกจาก hash ของ user id (ได้ชนิดเดิมทุกครั้ง)
const TYPES = [['ไฟ', '🔥', '#e8551e', '#ffd9b8'], ['น้ำ', '💧', '#2f7fd1', '#cfe6ff'], ['หญ้า', '🌿', '#3e9b4f', '#d4f0cf'],
  ['สายฟ้า', '⚡', '#e0ac00', '#fff3b0'], ['จิต', '🔮', '#9253c9', '#ebd6fa'], ['ต่อสู้', '🥊', '#b5502f', '#f3d5c4']];
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

let token = localStorage.getItem('tk'), user = null, addrs = [], tab = 'card', mode = 'login';

const msg = (e) => {
  if (!e) return 'เกิดข้อผิดพลาด';
  const d = e.details;
  const l = Array.isArray(d) ? d.map((x) => x.message || x) : d && typeof d === 'object' ? Object.values(d).flat() : [];
  return [e.message, ...l.filter((x) => typeof x === 'string')].join(': ');
};
async function api(path, method = 'GET', body) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
    body: body && JSON.stringify(body),
  });
  if (r.status === 204) return null;
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && token && d.error?.code !== 'INVALID_CREDENTIALS') logout(true);
    throw new Error(msg(d.error));
  }
  return d;
}
function toast(t, bad) {
  const e = $('#toast');
  e.textContent = t; e.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => (e.className = ''), 3500);
}
const field = (n, l, t = 'text', v = '', req = true, x = '') =>
  `<label>${l}<input name="${n}" type="${t}" value="${esc(v)}" ${req ? 'required' : ''} ${x}></label>`;

function logout(expired) {
  token = null; user = null; localStorage.removeItem('tk');
  sessionStorage.removeItem('cd-session');
  render(); if (expired) toast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', true);
}
function setSession(d) {
  token = d.accessToken;
  user = d.user;
  localStorage.setItem('tk', token);
  sessionStorage.setItem('cd-session', JSON.stringify({ token, user }));
  tab = 'card';
}

const authView = () => {
  const login = mode === 'login';
  return `<main class="auth"><div class="back" aria-hidden="true"><div class="ball"></div></div>
  <form id="auth" class="panel"><h1>${login ? 'เข้าสู่ระบบเทรนเนอร์' : 'สมัครเป็นเทรนเนอร์'}</h1>
  ${login ? '' : `<div class="g2">${field('firstName', 'ชื่อ')}${field('lastName', 'นามสกุล')}</div>${field('displayName', 'ชื่อเทรนเนอร์')}`}
  ${field('email', 'อีเมล', 'email', '', true, 'autocomplete="email"')}
  ${field('password', 'รหัสผ่าน', 'password', '', true, login ? 'autocomplete="current-password"' : 'minlength="8" autocomplete="new-password"')}
  <button class="btn">${login ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}</button>
  <p class="sw">${login ? 'ยังไม่มีบัญชี?' : 'มีบัญชีแล้ว?'} <a href="#" data-act="mode">${login ? 'สมัครเป็นเทรนเนอร์' : 'เข้าสู่ระบบ'}</a></p></form></main>`;
};

const cardView = () => {
  const h = hash(user.id), [tn, em, c, bg] = TYPES[h % TYPES.length];
  const date = new Date(user.createdAt).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
  return `<div class="card" style="--c:${c};--bg:${bg}"><div class="ch"><b>${esc(user.displayName)}</b><span>HP ${40 + (h % 14) * 10}</span></div>
  <div class="art" aria-hidden="true">${em}</div>
  <div class="cm"><div>${esc(user.firstName)} ${esc(user.lastName)}</div>${esc(user.email)}</div>
  <div class="cf"><span>เทรนเนอร์ธาตุ${tn}</span><span>เข้าร่วม ${date}</span></div></div>`;
};

const main = () => {
  if (tab === 'card') return `<div class="split">${cardView()}<form id="profile" class="panel"><h2>แก้ไขบัตรเทรนเนอร์</h2>
    <div class="g2">${field('firstName', 'ชื่อ', 'text', user.firstName)}${field('lastName', 'นามสกุล', 'text', user.lastName)}</div>
    ${field('displayName', 'ชื่อเทรนเนอร์', 'text', user.displayName)}${field('email', 'อีเมล', 'email', user.email)}
    <button class="btn">บันทึกการเปลี่ยนแปลง</button></form></div>`;
  if (tab === 'pw') return `<form id="pw" class="panel" style="max-width:460px"><h2>เปลี่ยนรหัสผ่าน</h2>
    ${field('currentPassword', 'รหัสผ่านปัจจุบัน', 'password', '', true, 'autocomplete="current-password"')}
    ${field('newPassword', 'รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)', 'password', '', true, 'minlength="8" autocomplete="new-password"')}
    <button class="btn">เปลี่ยนรหัสผ่าน</button></form>`;
  return `<section class="panel"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">ที่อยู่จัดส่งการ์ด</h2>
    <button class="btn sm" data-act="add">เพิ่มที่อยู่</button></div><div class="addr">${
    addrs.length ? addrs.map(addrCard).join('') : '<div class="empty">ยังไม่มีที่อยู่จัดส่ง เพิ่มที่อยู่เพื่อรับการ์ดที่สุ่มได้</div>'}</div></section>`;
};
const addrCard = (a) => `<article class="a${a.isDefault ? ' def' : ''}">${a.isDefault ? '<span class="tag">ที่อยู่หลัก</span>' : ''}
  <b>${esc(a.recipientName)}</b><p>${esc(a.phone)}</p>
  <p>${esc([a.line1, a.line2, a.subdistrict, a.district, a.province, a.postalCode].filter(Boolean).join(' '))}</p>
  <div class="row"><button class="btn alt sm" data-act="edit" data-id="${a.id}">แก้ไข</button>
  ${a.isDefault ? '' : `<button class="btn alt sm" data-act="def" data-id="${a.id}">ตั้งเป็นที่อยู่หลัก</button>`}
  <button class="btn alt sm" data-act="del" data-id="${a.id}">ลบ</button></div></article>`;

function render() {
  if (!user) { $('#app').innerHTML = authView(); return; }
  const tabs = [['card', 'บัตรเทรนเนอร์'], ['addr', 'ที่อยู่จัดส่ง'], ['pw', 'รหัสผ่าน']];
  $('#app').innerHTML = `<div class="wrap"><header><span class="logo"></span><b>Card Gacha</b>
    <button class="btn alt sm" data-act="logout">ออกจากระบบ</button></header>
    <nav>${tabs.map(([k, l]) => `<button data-act="tab" data-id="${k}" aria-current="${tab === k}">${l}</button>`).join('')}</nav>${main()}</div>`;
}

function openAddr(a = {}) {
  const v = (k) => a[k] ?? '';
  $('#dlg').innerHTML = `<form id="addr" data-id="${a.id || ''}"><h2>${a.id ? 'แก้ไขที่อยู่' : 'เพิ่มที่อยู่'}</h2>
    ${field('recipientName', 'ชื่อผู้รับ', 'text', v('recipientName'))}${field('phone', 'เบอร์โทร', 'tel', v('phone'), true, 'pattern="[0-9+\\-\\s]{8,20}"')}
    ${field('line1', 'ที่อยู่', 'text', v('line1'))}${field('line2', 'ที่อยู่เพิ่มเติม', 'text', v('line2'), false)}
    <div class="g2">${field('subdistrict', 'ตำบล/แขวง', 'text', v('subdistrict'), false)}${field('district', 'อำเภอ/เขต', 'text', v('district'))}
    ${field('province', 'จังหวัด', 'text', v('province'))}${field('postalCode', 'รหัสไปรษณีย์', 'text', v('postalCode'), true, 'pattern="\\d{5}" maxlength="5" inputmode="numeric"')}</div>
    ${a.isDefault ? '' : '<label class="chk"><input type="checkbox" name="isDefault"> ตั้งเป็นที่อยู่หลัก</label>'}
    <div class="row end"><button type="button" class="btn alt" data-act="close">ยกเลิก</button><button class="btn">บันทึกที่อยู่</button></div></form>`;
  $('#dlg').showModal();
}
async function loadAddrs() { addrs = (await api('/users/me/addresses')).addresses; render(); }

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const { act, id } = el.dataset; e.preventDefault();
  try {
    if (act === 'mode') { mode = mode === 'login' ? 'register' : 'login'; render(); }
    else if (act === 'logout') logout();
    else if (act === 'tab') { tab = id; render(); if (id === 'addr') await loadAddrs(); }
    else if (act === 'add') openAddr();
    else if (act === 'edit') openAddr(addrs.find((a) => a.id === id));
    else if (act === 'close') $('#dlg').close();
    else if (act === 'def') { await api('/users/me/addresses/' + id, 'PATCH', { isDefault: true }); await loadAddrs(); toast('ตั้งที่อยู่หลักแล้ว'); }
    else if (act === 'del' && confirm('ลบที่อยู่นี้?')) { await api('/users/me/addresses/' + id, 'DELETE'); await loadAddrs(); toast('ลบที่อยู่แล้ว'); }
  } catch (err) { toast(err.message, true); }
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, d = Object.fromEntries(new FormData(f));
  try {
    if (f.id === 'auth') {
      setSession(await api(mode === 'login' ? '/auth/login' : '/auth/register', 'POST', d));
      window.location.assign('/demo/?local=1');
    } else if (f.id === 'profile') {
      user = (await api('/users/me', 'PATCH', d)).user; render(); toast('บันทึกบัตรเทรนเนอร์แล้ว');
    } else if (f.id === 'pw') {
      await api('/users/me/password', 'PUT', d); f.reset(); toast('เปลี่ยนรหัสผ่านแล้ว');
    } else if (f.id === 'addr') {
      const id = f.dataset.id, body = { ...d };
      if (id) { if (d.isDefault) body.isDefault = true; else delete body.isDefault; } // update รับเฉพาะ true
      else body.isDefault = !!d.isDefault;
      await api('/users/me/addresses' + (id ? '/' + id : ''), id ? 'PATCH' : 'POST', body);
      $('#dlg').close(); await loadAddrs(); toast('บันทึกที่อยู่แล้ว');
    }
  } catch (err) { toast(err.message, true); }
});

// เอฟเฟกต์ holo ตามตำแหน่งเมาส์บนการ์ด
document.addEventListener('pointermove', (e) => {
  const c = e.target.closest?.('.card'); if (!c) return;
  const r = c.getBoundingClientRect();
  c.style.setProperty('--mx', ((e.clientX - r.left) / r.width) * 100 + '%');
  c.style.setProperty('--my', ((e.clientY - r.top) / r.height) * 100 + '%');
});

(async () => {
  if (token) { try { user = (await api('/users/me')).user; } catch { token = null; } }
  render();
})();
