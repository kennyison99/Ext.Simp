// GoFile website-token algorithm, verified against https://gofile.io/js/wt.obf.js
// retrieved 2026-09-08. Keep local: MV3 cannot evaluate downloaded JavaScript.
// A future GoFile salt/algorithm change requires an extension update.
window.citylinkGenerateWT = async token => {
  const bucket = Math.floor(Date.now() / 1000 / 14400);
  const input = `${navigator.userAgent}::${navigator.language || ''}::${token}::${bucket}::12af056dacea0b`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};
