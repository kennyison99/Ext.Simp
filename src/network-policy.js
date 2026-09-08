import { HOSTS } from './download-hosts.js';

export function allowedUrl(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error('Unsupported download URL');
  }
  if (!HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error(`Host ${url.hostname} is not in the downloader host list`);
  }
  url.hash = '';
  return url.href;
}

export function trustedSender(sender, extensionId) {
  if (sender.id !== extensionId || !Number.isInteger(sender.tab?.id) || sender.frameId !== 0) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'https:' && (
      (/^simpcity\.(cr|is|cz|hk|rs|ax)$/.test(url.hostname) && url.pathname.startsWith('/threads/')) ||
      url.hostname === 'gofile.io' || /(^|\.)goonbox\.cr$/.test(url.hostname)
    );
  } catch { return false; }
}

export function downloadUrl(value, senderUrl) {
  const url = new URL(value);
  if (url.protocol === 'blob:' && url.origin === new URL(senderUrl).origin) return url.href;
  return allowedUrl(value);
}

export function downloadName(name = 'download') {
  const parts = String(name).replace(/\\/g, '/').split('/').filter(Boolean).map(part =>
    part.replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').replace(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\.|$)/i, '_$1') || '_');
  return parts.join('/') || 'download';
}

export function headerRule(id, url, headers, extensionId) {
  const requestHeaders = Object.entries(headers || {}).map(([header, value]) => ({
    header: header.toLowerCase(), operation: 'set', value: String(value),
  }));
  if (!requestHeaders.length) return null;
  if (requestHeaders.some(h => /[\r\n]/.test(h.header + h.value))) throw new Error('Invalid request header');
  return {
    id, priority: 1,
    action: { type: 'modifyHeaders', requestHeaders },
    condition: {
      regexFilter: '^' + url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$',
      isUrlFilterCaseSensitive: true,
      initiatorDomains: [extensionId],
    },
  };
}
