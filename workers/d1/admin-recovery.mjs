import bcrypt from 'bcryptjs';

const TTL = 15 * 60 * 1000;
const WINDOW = 60 * 60 * 1000;
const GENERIC = 'Si hay una cuenta activa con ese email, recibirás un enlace válido por 15 minutos. Revisá también tu carpeta de spam.';
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(n => n.toString(16).padStart(2, '0')).join('');
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32))).map(n => n.toString(16).padStart(2, '0')).join('');
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function allow(db, key, maximum, now) {
  const result = await db.prepare(`INSERT INTO workers_login_limits (key, starts, hits) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET hits = CASE WHEN starts + ? <= ? THEN 1 ELSE MIN(hits + 1, ?) END,
    starts = CASE WHEN starts + ? <= ? THEN ? ELSE starts END RETURNING hits`).bind(await digest(key), now, WINDOW, now, maximum + 1, WINDOW, now, now).first();
  return result.hits <= maximum;
}

// Native binding: no SMTP/API credentials in the app or in browser forms.
export function recoveryEnabled(env) {
  return env.ADMIN_PASSWORD_RESET_ENABLED === 'true' && typeof env.EMAIL?.send === 'function' &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(env.ADMIN_PASSWORD_RESET_FROM || '') &&
    /^https:\/\/[^/]+$/.test(env.NEXT_PUBLIC_SITE_URL || '');
}

export async function queueReset(db, email, env, now = Date.now()) {
  const user = await db.prepare('SELECT id, email, session_version FROM users WHERE email = ? AND is_active = 1').bind(email).first();
  if (!user) return;
  const token = randomToken();
  const tokenDigest = await digest(token);
  // Atomic issuance also revokes older links. No raw token goes into D1.
  await db.batch([
    db.prepare('DELETE FROM workers_admin_password_resets WHERE user_id = ? OR expires_at <= ?').bind(user.id, now),
    db.prepare('INSERT INTO workers_admin_password_resets (digest, user_id, session_version, expires_at) VALUES (?, ?, ?, ?)').bind(tokenDigest, user.id, user.session_version, now + TTL),
  ]);
  const link = env.NEXT_PUBLIC_SITE_URL + '/admin/restablecer#token=' + token;
  try {
    await env.EMAIL.send({
      from: env.ADMIN_PASSWORD_RESET_FROM, to: user.email,
      subject: 'Restablecer tu contraseña del panel',
      text: 'Solicitaste restablecer tu contraseña del panel. Este enlace vence en 15 minutos y se puede usar una sola vez:\n\n' + link + '\n\nSi no lo solicitaste, ignorá este email. Tu contraseña sigue igual.',
      html: '<p>Solicitaste restablecer tu contraseña del panel.</p><p><a href="' + escape(link) + '">Elegir una nueva contraseña</a></p><p>El enlace vence en 15 minutos y se puede usar una sola vez. Si no lo solicitaste, ignorá este email. Tu contraseña sigue igual.</p>',
    });
  } catch {
    await db.prepare('DELETE FROM workers_admin_password_resets WHERE digest = ?').bind(tokenDigest).run();
    // Never log provider messages, recipient, email body or raw token.
    console.error('ADMIN_PASSWORD_RESET_EMAIL_FAILED');
  }
}

export async function consumeReset(db, token, password, now = Date.now()) {
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const tokenDigest = await digest(token);
  const current = await db.prepare(`SELECT r.user_id FROM workers_admin_password_resets r JOIN users u ON u.id = r.user_id
    WHERE r.digest = ? AND r.expires_at > ? AND r.session_version = u.session_version AND u.is_active = 1`).bind(tokenDigest, now).first();
  if (!current) return false;
  const hash = await bcrypt.hash(password, 12);
  // D1 batch is a real atomic transaction: two concurrent consumes cannot both update.
  const result = await db.batch([
    db.prepare(`UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ? AND is_active = 1
      AND session_version < 9007199254740991 AND session_version = (
      SELECT session_version FROM workers_admin_password_resets WHERE digest = ? AND user_id = users.id AND expires_at > ?)`)
      .bind(hash, current.user_id, tokenDigest, now),
    db.prepare('DELETE FROM workers_admin_password_resets WHERE user_id = ? AND session_version < (SELECT session_version FROM users WHERE id = ?)').bind(current.user_id, current.user_id),
  ]);
  return result[0].meta.changes === 1;
}

function page(reset, enabled, message = '', status = 200) {
  const nonce = randomToken();
  const title = reset ? 'Elegí una nueva contraseña' : 'Recuperar acceso al panel';
  const form = reset ? `<form method="post" action="/admin/restablecer"><input type="hidden" name="token" id="reset-token">
    <label for="new-password">Nueva contraseña</label><input id="new-password" name="password" type="password" required minlength="12" maxlength="72" autocomplete="new-password">
    <p class="hint">Usá al menos 12 caracteres, con una letra y un número. Evitá reutilizar contraseñas.</p>
    <label for="confirm-password">Confirmar contraseña</label><input id="confirm-password" name="confirm" type="password" required minlength="12" maxlength="72" autocomplete="new-password">
    <button type="button" id="show-password" aria-controls="new-password confirm-password" aria-pressed="false" class="text-button">Mostrar contraseña</button>
    <button type="submit" id="reset-submit" disabled>Guardar contraseña</button><noscript><p>Activá JavaScript para abrir el enlace privado del email.</p></noscript></form>` :
    `<form method="post" action="/admin/recuperar"><label for="email">Email del administrador</label><input id="email" name="email" type="email" required maxlength="254" autocomplete="username" autocapitalize="none" inputmode="email"><button type="submit">Enviar enlace de recuperación</button></form>`;
  const script = reset && enabled ? `<script nonce="${nonce}">
    const params = new URLSearchParams(location.hash.slice(1)); const token = params.get('token') || '';
    document.getElementById('reset-token').value = token;
    history.replaceState(null, '', location.pathname);
    document.getElementById('reset-submit').disabled = !/^[a-f0-9]{64}$/.test(token);
    if(!token) document.getElementById('message').textContent = 'Abrí el enlace de recuperación desde tu email.';
    document.getElementById('show-password').addEventListener('click', function(){
      const shown = this.getAttribute('aria-pressed') !== 'true'; this.setAttribute('aria-pressed', String(shown));
      for(const id of ['new-password','confirm-password']) document.getElementById(id).type = shown ? 'text' : 'password';
      this.textContent = shown ? 'Ocultar contraseña' : 'Mostrar contraseña';
    });
  </script>` : '';
  return new Response(`<!doctype html><html lang="es-PY"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
    <style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#fafaf7;color:#152b22;font:16px system-ui,sans-serif}main{max-width:440px;margin:8vh auto;padding:28px}h1{font-size:26px;line-height:1.25}form{display:grid;gap:12px;margin:24px 0}input,button{font:inherit;border-radius:10px;padding:13px;width:100%}input{border:1px solid #bbc6bf;background:white}button{border:0;background:#1c4637;color:white;cursor:pointer}button:disabled{opacity:.5;cursor:default}.text-button{background:transparent;color:inherit;text-decoration:underline}a{color:inherit}p{line-height:1.55}.hint{font-size:14px;margin:0}#message:not(:empty){padding:14px;background:#edf3ef;border-radius:10px}label{font-weight:600}:focus-visible{outline:3px solid #188660;outline-offset:3px}</style></head>
    <body><main><h1>${title}</h1><p id="message" role="status">${escape(message || (!enabled ? 'La recuperación por email todavía no está disponible. Contactá al responsable de la tienda.' : ''))}</p>${enabled ? form : ''}<a href="/admin/login">Volver a iniciar sesión</a></main>${script}</body></html>`, {
    status, headers: {'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-robots-tag':'noindex, nofollow, noarchive','referrer-policy':'no-referrer','x-content-type-options':'nosniff',
      'content-security-policy':`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`},
  });
}

async function formData(request) {
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) throw new Error('FORMAT');
  const reader = request.body?.getReader(); if (!reader) return new URLSearchParams();
  const chunks = []; let size = 0;
  try { while (true) { const part = await reader.read(); if(part.done) break; size += part.value.byteLength; if(size > 4096){await reader.cancel(); throw new Error('SIZE');} chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

export async function handleAdminRecovery(request, env, ctx, now = Date.now()) {
  const url = new URL(request.url);
  if (!['/admin/recuperar','/admin/restablecer'].includes(url.pathname.replace(/\/$/,''))) return null;
  const reset = url.pathname.startsWith('/admin/restablecer');
  const enabled = recoveryEnabled(env);
  if (!['GET','HEAD','POST'].includes(request.method)) return page(reset, false, 'Método no permitido.', 405);
  if (request.method !== 'POST') {const response=page(reset, enabled);return request.method==='HEAD'?new Response(null,{status:response.status,headers:response.headers}):response;}
  if (request.headers.get('origin') !== url.origin) return page(reset, false, 'Origen no permitido.', 403);
  if (!enabled || !env.DB) return page(reset, false, '', 503);
  let data;try{data=await formData(request);}catch{return page(reset,false,'Formulario no válido o demasiado grande.',400);}
  try {
    const ip = request.headers.get('cf-connecting-ip') || 'local-preview';
    if (!reset) {
      const email = (data.get('email') || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return page(false,true,'Ingresá un email válido.',400);
      const ipAllowed = await allow(env.DB,'admin-reset-request-ip:'+ip,5,now);
      const emailAllowed = ipAllowed && await allow(env.DB,'admin-reset-request-email:'+email,3,now);
      if(ipAllowed && emailAllowed)ctx.waitUntil(queueReset(env.DB,email,env,now).catch(()=>console.error('ADMIN_PASSWORD_RESET_QUEUE_FAILED')));
      return page(false,true,GENERIC);
    }
    if (!await allow(env.DB,'admin-reset-consume-ip:'+ip,10,now)) return page(true,true,'Demasiados intentos. Esperá una hora antes de volver a probar.',429);
    const password = data.get('password') || '';
    if(password.length < 12 || new TextEncoder().encode(password).length > 72 || !/[a-zA-Z]/.test(password) || !/\d/.test(password))
      return page(true,true,'Usá al menos 12 caracteres, con una letra y un número, y hasta 72 bytes.',400);
    if(password !== data.get('confirm'))return page(true,true,'Las contraseñas no coinciden. Abrí nuevamente el enlace del email.',400);
    const saved = await consumeReset(env.DB,data.get('token') || '',password,now);
    if(!saved)return page(true,true,'El enlace venció o ya se usó. Solicitá uno nuevo.',400);
    return page(false,false,'Contraseña actualizada. Iniciá sesión con tu nueva contraseña. Tus sesiones anteriores se cerraron.');
  } catch {return page(reset,false,'No se pudo completar la recuperación. Probá de nuevo más tarde.',503);}
}