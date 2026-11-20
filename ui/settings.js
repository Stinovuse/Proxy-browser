'use strict';
const $ = id => document.getElementById(id);
let tzLocales = {};

function updateLangHint() {
  const mode = $('browserLang').value;
  const tz = $('timezone').value;
  let text = '';
  if (mode === 'auto') {
    const loc = tz === 'system' ? null : (tzLocales[tz] || 'en-US');
    text = loc ? `Сейчас сайты увидят язык <b>${loc}</b> (по поясу ${tz}).` : 'При системном часовом поясе язык не подменяется.';
  } else if (mode === 'system') {
    text = 'Сайты увидят язык вашей системы.';
  } else {
    text = `Сайты увидят язык <b>${mode}</b> независимо от часового пояса.`;
  }
  $('langhint').innerHTML = text;
}

api.invoke('settings:get').then(c => {
  if (!c) return;
  $('type').value = c.type; $('host').value = c.host; $('port').value = c.port;
  $('user').value = c.user; $('incognito').checked = c.incognito;
  $('noCache').checked = c.noCache; $('block3p').checked = c.block3p;
  $('timezone').value = c.timezone || 'Asia/Singapore';
  $('browserLang').value = c.browserLang || 'auto';
  tzLocales = c.tzLocales || {};
  $('autoTranslate').checked = c.autoTranslate !== false;
  $('translateTo').value = c.translateTo || 'ru';
  if (c.version) $('ver').textContent = 'S Browser ' + c.version;
  if (c.hasPass) $('passhint').textContent = 'Пароль сохранён. Оставьте поле пустым, чтобы не менять.';
  if (!c.configured) $('clear').style.display = 'none';
  updateLangHint();
});
$('timezone').onchange = updateLangHint;
$('browserLang').onchange = updateLangHint;

$('save').onclick = async () => {
  $('err').style.color = '';
  $('err').textContent = '';
  const r = await api.invoke('settings:save', {
    type: $('type').value, host: $('host').value, port: $('port').value,
    user: $('user').value, pass: $('pass').value, incognito: $('incognito').checked,
    noCache: $('noCache').checked, block3p: $('block3p').checked,
    timezone: $('timezone').value, browserLang: $('browserLang').value,
    autoTranslate: $('autoTranslate').checked, translateTo: $('translateTo').value,
  });
  if (r && !r.ok) $('err').textContent = r.error;
};

$('clear').onclick = async () => {
  const r = await api.invoke('data:clear');
  $('err').style.color = '#34d399';
  $('err').textContent = r && r.ok ? 'Данные браузера очищены.' : 'Не удалось очистить.';
};
