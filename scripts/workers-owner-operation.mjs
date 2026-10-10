/** Staging CLI only: a reset updates one active owner and revokes old sessions. */
export function ownerMode(/** @type {string[]} */ args) {
  if (args.length === 0) return 'create';
  if (args.length === 1 && args[0] === '--reset-password') return 'reset';
  throw new Error('Use no arguments to create the first owner, or --reset-password to reset an existing staging owner.');
}
export function validateOwnerPassword(/** @type {string} */ password, /** @type {string} */ confirmation) {
  if (password.length < 12 || password !== confirmation) throw new Error('Use at least 12 characters and matching passwords.');
}
export function ownerAccountQuery(
  /** @type {'create'|'reset'} */ mode,
  /** @type {string} */ email,
  /** @type {string} */ hash,
  /** @type {string|null} */ name,
) {
  if (mode === 'reset') return {
    sql: "UPDATE users SET password_hash=?, session_version=session_version+1 WHERE email=? AND role='owner' AND is_active=1 AND session_version<9007199254740991",
    values: [hash,email],
  };
  return {
    sql: "INSERT INTO users (email,password_hash,role,name) SELECT ?,?,'owner',? WHERE NOT EXISTS (SELECT 1 FROM users WHERE role='owner' AND is_active=1)",
    values: [email,hash,name],
  };
}
/** Ignore terminal navigation/paste markers so invisible arrow keys never become password text. */
export function consumeHiddenPasswordInput(
  /** @type {{value:string, escape:number}} */ state,
  /** @type {string} */ chunk,
) {
  for (const character of chunk) {
    if (character === '\u0003') return 'cancel';
    if (state.escape === 1) { state.escape = character === '[' || character === 'O' ? 2 : 0; continue; }
    if (state.escape === 2) { if (character >= '@' && character <= '~') state.escape = 0; continue; }
    if (character === '\u001b') { state.escape = 1; continue; }
    if (character === '\r' || character === '\n') return 'submit';
    if (character === '\u007f' || character === '\b') state.value = Array.from(state.value).slice(0,-1).join('');
    else if (character.charCodeAt(0) >= 32) state.value += character;
  }
  return 'continue';
}