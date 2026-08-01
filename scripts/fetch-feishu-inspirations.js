#!/usr/bin/env node
/**
 * 飞书多维表格 → 工作台 inspirations.json 同步脚本
 * 数据源：飞书多维表格「01_爆款素材库」
 *   base_token: N7rqbZvpeahjsksLfQDcqNPcnac
 *   table_id:   tblAcu4IJVMclq7V
 * 筛选：是否值得复用 = 强复用（本地字符串匹配）
 *
 * 重要：每次 Run 都是「全量拉取 + 本地筛选」重新生成 inspirations.json，
 * 不是增量同步——表里原有强复用、新标强复用都会同步；改成非强复用则下次消失。
 *
 * 鉴权：飞书自建应用 OAuth（tenant_access_token，每次现取，2h 过期）
 *   需要环境变量: FEISHU_APP_ID / FEISHU_APP_SECRET（GitHub Secrets）
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'inspirations.json');
const BASE_TOKEN = 'N7rqbZvpeahjsksLfQDcqNPcnac';
const TABLE_ID = 'tblAcu4IJVMclq7V';
const APP_ID = process.env.FEISHU_APP_ID || '';
const APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const TODAY = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

const PF_ABBR = { '抖音': 'dy', '小红书': 'xhs', '淘宝': 'tb', '微博': 'wb', '快手': 'ks', '综合': 'all' };

// 飞书字段统一取值：文本=string，单选={text,value}，多选=[{text,value}]
// ⚠️ 飞书单选字段 API 返回的 .value 是 option 内部 ID（如 optxxxx），文本在 .text
function asText(field) {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (Array.isArray(field)) return field.map(asText).filter(Boolean).join(' / ');
  if (typeof field === 'object') return (field.text != null ? field.text : '') || (field.value != null ? field.value : '') || '';
  return String(field);
}
function asTextList(field) {
  if (field == null) return [];
  if (typeof field === 'string') return field ? [field] : [];
  if (Array.isArray(field)) return field.map(asText).filter(Boolean);
  return [asText(field)];
}

async function http(method, url, body, headers = {}) {
  const init = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { throw new Error(`HTTP ${res.status} 响应不是 JSON: ${text.slice(0, 200)}`); }
  if (!res.ok || (json.code !== undefined && json.code !== 0)) {
    throw new Error(`HTTP ${res.status} / code ${json.code}: ${json.msg || text.slice(0, 200)}`);
  }
  return json;
}

async function getTenantToken() {
  if (!APP_ID || !APP_SECRET) {
    throw new Error('缺少环境变量 FEISHU_APP_ID 或 FEISHU_APP_SECRET。请到 GitHub Secrets 配置后再运行。');
  }
  const r = await http('POST', 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: APP_ID, app_secret: APP_SECRET,
  });
  if (!r.tenant_access_token) throw new Error('未拿到 tenant_access_token: ' + JSON.stringify(r));
  console.log('[飞书] ✓ tenant_access_token 已获取（' + r.expire + 's 有效）');
  return r.tenant_access_token;
}

// ===== 拉所有记录，本地筛选「强复用」 =====
async function listStrongReuseRecords(token) {
  const allItems = [];
  let pageToken;
  let pageNo = 0;
  do {
    pageNo++;
    const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${BASE_TOKEN}/tables/${TABLE_ID}/records`);
    url.searchParams.set('page_size', '100');
    url.searchParams.set('automatic_fields', 'false');
    if (pageToken) url.searchParams.set('page_token', pageToken);

    const r = await http('GET', url.toString(), null, { 'Authorization': `Bearer ${token}` });
    const items = (r.data && r.data.items) || [];
    allItems.push(...items);
    console.log(`[飞书] 第 ${pageNo} 页拉到 ${items.length} 条，累计 ${allItems.length}`);
    pageToken = r.data && r.data.page_token;
    if (!r.data || !r.data.has_more) break;
  } while (pageToken);

  const norm = s => String(s || '').replace(/\s+/g, '').trim();
  const strongItems = allItems.filter(item => {
    const v = asText(item.fields && item.fields['是否值得复用']);
    return norm(v) === norm('强复用');
  });
  console.log(`[飞书] 共拉 ${allItems.length} 条，其中「强复用」${strongItems.length} 条`);
  if (strongItems.length === 0 && allItems.length > 0) {
    console.log('[飞书] ⚠️ 没有任何「强复用」记录。可在飞书表「是否值得复用」列选「强复用」后重跑。');
    console.log('[飞书] 调试：第 1 条「是否值得复用」原始值 = ' + JSON.stringify((allItems[0].fields || {})['是否值得复用']));
  }
  return strongItems;
}

// ===== 字段映射 =====
function pickPlatform(fields) {
  const p = asText(fields['来源平台']);
  if (/抖音/.test(p)) return '抖音';
  if (/小红书/.test(p)) return '小红书';
  if (/淘宝|天猫/.test(p)) return '淘宝';
  if (/微博/.test(p)) return '微博';
  if (/快手/.test(p)) return '快手';
  return '综合';
}

// 用户要求灵感卡片只展示这 10 个字段（顺序即展示顺序）
// 每项：[展示标签, 飞书列名候选列表] —— 取第一个存在且有值的
const DETAIL_FIELDS = [
  ['账号来源',         ['来源账号', '账号来源', '来源']],
  ['产品类别',         ['产品类别']],
  ['目标人群',         ['目标人群', '目标群人', '人群画像', '人群']],
  ['核心情绪',         ['核心情绪', '情绪']],
  ['用户痛点',         ['用户痛点', '痛点']],
  ['黄金3秒钩子类型',   ['黄金3秒钩子类型', '黄金3秒钩子', '3秒钩子类型', '3秒钩子']],
  ['爆款公式',         ['爆款公式', '公式']],
  ['核心卖点',         ['核心卖点', '卖点']],
  ['可复制元素',       ['可复制元素', '可复制', '复制元素']],
  ['原视频文案',       ['原视频文案', '视频文案', '原文案', '口播文案', '原口播']],
];
function findField(fields, candidates) {
  for (const name of candidates) {
    if (fields[name] != null) {
      const v = asText(fields[name]).trim();
      if (v) return v;
    }
  }
  return '';
}

function toInspiration(fields, index) {
  const platform = pickPlatform(fields);
  const platformAbbr = PF_ABBR[platform] || 'all';

  // 标题：飞书表「爆款速览」字段
  const title = asText(fields['爆款速览']).trim()
    || asText(fields['我的产品改编方向']).split('\n')[0].trim()
    || asText(fields['视频ID']).trim()
    || `爆款记录 #${index + 1}`;

  let url = asText(fields['视频链接']);
  const linkMatch = url.match(/$(https?:\/\/[^)]+)$/);
  if (linkMatch) url = linkMatch[1];

  // 结构化字段：只输出用户要的 10 个，过滤空值
  const detail = {};
  for (const [label, cands] of DETAIL_FIELDS) {
    const v = findField(fields, cands);
    if (v) detail[label] = v;
  }

  return {
    id: `insp-${platformAbbr}-${String(index + 1).padStart(2, '0')}`,
    platform,
    title,
    date: TODAY,
    url,
    heat: '',
    detail,
  };
}

(async () => {
  console.log('[飞书] 同步脚本启动，日期 ' + TODAY);
  if (!APP_ID || !APP_SECRET) {
    console.error('❌ 缺少环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET');
    process.exit(1);
  }
  try {
    const token = await getTenantToken();
    const records = await listStrongReuseRecords(token);
    console.log(`[飞书] 共拉到 ${records.length} 条「强复用」记录`);
    if (records.length === 0) {
      console.warn('[飞书] ⚠️ 没有任何「强复用」记录。请在飞书表「是否值得复用」字段选「强复用」');
      const out = {
        updated: TODAY,
        note: '暂无「强复用」爆款记录。请在飞书多维表格「01_爆款素材库」里把需要推送的记录的「是否值得复用」字段改成「强复用」后，重新 Run workflow。',
        items: [],
      };
      fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
      console.log('[飞书] 已写入空 inspirations.json');
      return;
    }
    const items = records.map((r, i) => toInspiration(r.fields, i));
    // 调试：打印首条记录的字段命中情况，方便确认飞书列名是否对得上
    if (items[0]) {
      const d0 = items[0].detail || {};
      const hit = Object.keys(d0);
      const all = DETAIL_FIELDS.map(x => x[0]);
      const miss = all.filter(k => !hit.includes(k));
      console.log('[飞书][调试] 首条「' + items[0].title + '」命中字段(' + hit.length + '/' + all.length + ')：' + hit.join('、'));
      if (miss.length) console.log('[飞书][调试] 未命中字段：' + miss.join('、') + '（飞书列名可能与脚本映射不同，核对后可微调）');
    }
    const order = { '抖音': 0, '小红书': 1, '淘宝': 2, '快手': 3, '微博': 4, '综合': 5 };
    items.sort((a, b) => {
      const oa = order[a.platform] ?? 9, ob = order[b.platform] ?? 9;
      if (oa !== ob) return oa - ob;
      return (b.url ? 1 : 0) - (a.url ? 1 : 0);
    });
    items.forEach((it, i) => { it.id = `insp-${PF_ABBR[it.platform] || 'all'}-${String(i + 1).padStart(2, '0')}`; });

    const out = {
      updated: TODAY,
      note: `每日灵感由 GitHub Actions 自动同步自飞书多维表格「01_爆款素材库」（仅含「是否值得复用=强复用」的记录，共 ${items.length} 条）。点击「查看来源」跳转真实视频链接。灵感页打开即自动拉取，可按平台筛选。`,
      items,
    };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
    const stats = items.reduce((m, it) => { m[it.platform] = (m[it.platform] || 0) + 1; return m; }, {});
    console.log(`[飞书] ✓ 已写入 ${OUT}，共 ${items.length} 条，平台分布：${JSON.stringify(stats)}`);
  } catch (e) {
    console.error('[飞书] ✗ 同步失败: ' + e.message);
    process.exit(1);
  }
})();
