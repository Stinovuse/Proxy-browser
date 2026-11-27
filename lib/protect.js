'use strict';
/*
 * Защита названий при переводе: бренды, сервисы, домены, адреса, IP, аббревиатуры
 * и слова вида GitHub/iPhone заменяются метками до отправки в переводчик и
 * возвращаются после. Так «Cloudflare» не превращается в «Облачное сияние».
 */
const BRANDS = [
  'Cloudflare', 'Google', 'Google Cloud', 'Gmail', 'YouTube', 'Android', 'Chrome', 'Chromium', 'Amazon', 'Amazon Web Services',
  'Microsoft', 'Azure', 'Windows', 'Outlook', 'Bing', 'Skype', 'LinkedIn', 'GitHub', 'Apple', 'iCloud',
  'Safari', 'Facebook', 'Instagram', 'WhatsApp', 'Telegram', 'Netflix', 'Spotify', 'Twitter',
  'TikTok', 'ByteDance', 'Alibaba', 'Alibaba Cloud', 'AliExpress', 'Tencent', 'Tencent Cloud', 'WeChat', 'Baidu', 'Huawei',
  'Xiaomi', 'Samsung', 'Yandex', 'Mail.ru', 'VK', 'VKontakte', 'Ozon', 'Wildberries', 'Avito', 'Sber', 'Sberbank', 'Tinkoff',
  'T-Bank', 'Akamai', 'Fastly', 'DigitalOcean', 'Hetzner', 'OVH', 'OVHcloud', 'Linode', 'Vultr', 'Contabo', 'Leaseweb',
  'Choopa', 'M247', 'Datacamp', 'Zscaler', 'Oracle', 'IBM', 'Intel', 'Nvidia', 'Comcast', 'Verizon', 'Vodafone',
  'Telefonica', 'Telefónica', 'Movistar', 'Deutsche Telekom', 'Rostelecom', 'Beeline', 'MegaFon', 'Tele2', 'Singtel',
  'StarHub', 'PayPal', 'Mastercard', 'Stripe', 'GitLab', 'Claude', 'Anthropic', 'OpenAI', 'ChatGPT', 'Discord',
  'Reddit', 'Pinterest', 'Snapchat', 'Dropbox', 'Mozilla', 'Firefox', 'Linux',
  'Ubuntu', 'Epic Games', 'Wikipedia', 'DuckDuckGo', 'Yahoo', 'ProtonVPN', 'NordVPN',
  'ExpressVPN', 'Surfshark', 'Mullvad', 'Quad9', 'OpenDNS', 'Cogent', 'Hurricane Electric', 'China Telecom',
  'China Unicom', 'China Mobile', 'Starlink', 'SpaceX', 'Tesla', 'Uber', 'Airbnb', 'Booking.com', 'Shopify', 'eBay', 'Temu',
  'Shein', 'Revolut', 'Binance', 'Coinbase', 'Bybit', 'Kaspersky', 'Avast', 'Norton', 'Bitdefender', 'Hostinger',
  'Namecheap', 'GoDaddy', 'Squarespace', 'Wix', 'WordPress', 'Netlify', 'Vercel', 'Heroku', 'Backblaze', 'Imperva', 'Gcore',
  'StackPath', 'Edgio', 'Figma', 'Trello', 'Jira', 'Atlassian', 'Twitch', 'Patreon',
  'OnlyFans', 'Tinder', 'Bumble', 'Shopee', 'Lazada', 'Gojek', 'Viber', 'KakaoTalk', 'Naver',
];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const B = '(?<![\\p{L}\\p{N}_])';
const E = '(?![\\p{L}\\p{N}_])';
const RULES = [
  /https?:\/\/[^\s<>"']+/giu,                                            // ссылки
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu,                                    // e-mail
  /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/gu,                       // IPv4
  /(?<![\w-])(?:[a-z0-9-]+\.)+(?:com|net|org|io|ru|ai|app|dev|co|me|info|xyz|sg|uk|de|fr|es|cn|jp|us|tv|gg)(?![\w-])/giu, // домены
  /(?<![\w@])@[A-Za-z0-9_]{2,}/gu,                                      // @ники
  new RegExp(B + '(?:' + [...BRANDS].sort((a, b) => b.length - a.length).map(escapeRe).join('|') + ')' + E, 'gu'),
  new RegExp(B + '\\p{L}*\\p{Ll}\\p{Lu}\\p{L}*' + E, 'gu'),            // GitHub, iPhone, macOS
  new RegExp(B + '(?=\\p{L}*\\d)[\\p{L}\\d]*\\p{L}[\\p{L}\\d]*' + E, 'gu'), // слова с цифрами: M247, AS13335
];
const ACRONYM = new RegExp(B + '\\p{Lu}{2,6}' + E, 'gu');               // DNS, ISP, VPN

function protect(text) {
  const spans = [];
  const rules = [...RULES];
  // Аббревиатуры защищаем, только если текст не набран целиком заглавными
  const letters = (text.match(/\p{L}/gu) || []).length;
  const upper = (text.match(/\p{Lu}/gu) || []).length;
  if (!letters || upper / letters < 0.6) rules.push(ACRONYM);
  for (const re of rules) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (!m[0]) { re.lastIndex++; continue; }
      spans.push([m.index, m.index + m[0].length]);
    }
  }
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const tokens = [];
  let out = '';
  let pos = 0;
  for (const [s, e] of spans) {
    if (s < pos) continue; // пересекается с уже защищённым
    out += text.slice(pos, s) + `ZX${tokens.length}QZ`;
    tokens.push(text.slice(s, e));
    pos = e;
  }
  out += text.slice(pos);
  const rest = out.replace(/ZX\d+QZ/g, '');
  return { text: out, tokens, nothingToTranslate: !/\p{L}{2,}/u.test(rest) };
}

// null — если переводчик потерял метку (тогда переводим без защиты)
function restore(translated, tokens) {
  if (!tokens.length) return translated;
  const used = new Set();
  const res = translated.replace(/ZX\s*(\d+)\s*QZ/gi, (m, n) => {
    const i = Number(n);
    if (i >= tokens.length) return m;
    used.add(i);
    return tokens[i];
  });
  return used.size === tokens.length ? res : null;
}

module.exports = { protect, restore, BRANDS };
