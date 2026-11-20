'use strict';
const $ = id => document.getElementById(id);

api.invoke('settings:get').then(c => {
  $('type').value = c.type; $('host').value = c.host; $('port').value = c.port;
  $('user').value = c.user; $('incognito').checked = c.incognito;
  $('noCache').checked = c.noCache; $('block3p').checked = c.block3p;
  $('timezone').value = c.timezone || 'Asia/Shanghai';
  $('autoTranslate').checked = c.autoTranslate !== false;
  $('translateTo').value = c.translateTo || 'ru';
  if (c.version) $('ver').textContent = 'Proxy Browser ' + c.version;
  if (c.hasPass) $('passhint').textContent = 'Пароль сохранён. Оставьте поле пустым, чтобы не менять.';
  if (!c.configured) $('clear').style.display = 'none';
});

$('save').onclick = async () => {
  $('err').textContent = '';
  const r = await api.invoke('settings:save', {
    type: $('type').value, host: $('host').value, port: $('port').value,
    user: $('user').value, pass: $('pass').value, incognito: $('incognito').checked,
    noCache: $('noCache').checked, block3p: $('block3p').checked,
    timezone: $('timezone').value, autoTranslate: $('autoTranslate').checked,
    translateTo: $('translateTo').value,
  });
  if (r && !r.ok) $('err').textContent = r.error;
};

$('clear').onclick = async () => {
  const r = await api.invoke('data:clear');
  $('err').style.color = '#7ee2a0';
  $('err').textContent = r.ok ? 'Данные браузера очищены.' : 'Не удалось очистить.';
};
