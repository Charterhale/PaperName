'use strict';
const $ = id => document.getElementById(id), C = PaperCore;
let state = {config: {...C.defaults}, meta: null};
async function send(message) {const result = await chrome.runtime.sendMessage(message); if (result?.error) throw new Error(result.error); return result;}
function notice(text) {$('notice').textContent = text;}
function currentMeta() {return {...state.meta, title: $('title').value, year: $('year').value, journal: $('journal').value, abbreviation: $('abbreviation').value};}
function preview() {
  const meta = currentMeta();
  const alias = state.config.aliases?.[C.journalKey(meta.journal)];
  const value = C.filename(meta.title ? {...meta, abbreviation: alias || meta.abbreviation} : {title: 'Article title', year: '2026', abbreviation: 'Nat Med'}, state.config);
  $('preview').textContent = value;
  $('copy').disabled = !value;
}
function renderHistory(entries) {
  $('history').replaceChildren();
  if (!entries.length) {$('history').textContent = '还没有 PDF 下载记录。'; return;}
  for (const entry of entries) {
    const article = document.createElement('article'), name = document.createElement('strong'), reason = document.createElement('p');
    name.textContent = entry.actualFilename || entry.filename || entry.original;
    const status = entry.state === 'complete' ? '下载完成' : entry.state === 'interrupted' ? '下载中断' : entry.filename ? '建议命名' : '原名';
    reason.textContent = status + ' · ' + entry.reason;
    article.append(name, reason); $('history').append(article);
  }
}
async function load() {
  $('refresh').disabled = true;
  try {
    state = await send({type: 'STATE'});
    $('enabled').checked = state.config.enabled; $('online').checked = state.config.online;
    document.querySelector(`input[name="order"][value="${state.config.order}"]`).checked = true;
    for (const key of ['title', 'year', 'journal', 'abbreviation']) $(key).value = state.meta?.[key] || '';
    $('aliases').value = Object.entries(state.config.aliases || {}).map(([key, value]) => `${state.config.aliasNames?.[key] || key} = ${value}`).join('\n');
    $('status').textContent = state.meta ? '已识别当前论文，可以在下载前纠正。' : '未识别论文详情。谷歌学术会在点击单条 PDF 链接时识别。';
    $('apply').disabled = !/^https?:/.test(state.pageUrl || '');
    preview(); renderHistory(state.history);
  } catch (error) {notice('读取失败：' + error.message);}
  finally {$('refresh').disabled = false;}
}
async function saveSettings(config) {
  state.config = {...state.config, ...config};
  await send({type: 'SETTINGS', config}); preview(); notice('设置已保存。');
}
for (const id of ['title', 'year', 'journal', 'abbreviation']) $(id).addEventListener('input', preview);
document.querySelectorAll('input[name="order"]').forEach(input => input.addEventListener('change', () => saveSettings({order: input.value}).catch(e => notice(e.message))));
for (const id of ['enabled', 'online']) $(id).addEventListener('change', () => saveSettings({[id]: $(id).checked}).catch(e => notice(e.message)));
$('refresh').addEventListener('click', load);
$('apply').addEventListener('click', async () => {
  try {await send({type: 'OVERRIDE', tabId: state.tabId, pageUrl: state.pageUrl, meta: currentMeta()}); notice('已关联本页。请返回论文页面正常下载 PDF。');} catch (error) {notice(error.message);}
});
$('save-aliases').addEventListener('click', async () => {
  try {
    const aliases = {}, aliasNames = {};
    for (const line of $('aliases').value.split('\n').filter(s => s.trim())) {
      const match = line.match(/^(.+?)\s*=\s*(.+)$/);
      if (!match) throw new Error('请使用“期刊全名 = 缩写”的格式');
      const raw = C.clean(match[1]), key = /^\d{4}-[\dXx]{4}$/.test(raw) ? raw.toUpperCase() : C.journalKey(raw);
      aliases[key] = C.clean(match[2]); aliasNames[key] = raw;
    }
    await saveSettings({aliases, aliasNames});
  } catch (error) {notice(error.message);}
});
$('copy').addEventListener('click', async () => {try {await navigator.clipboard.writeText($('preview').textContent); notice('文件名已复制。');} catch (_) {notice('复制失败，可以直接选中预览文字复制。');}});
$('clear').addEventListener('click', async () => {try {await send({type: 'CLEAR'}); renderHistory([]); notice('已清空本地记录与在线缓存。');} catch (error) {notice(error.message);}});
load();
