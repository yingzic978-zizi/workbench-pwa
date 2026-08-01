#!/usr/bin/env node
/**
 * 飞书多维表格 → 工作台 inspirations.json 同步脚本
 * 用法: node scripts/fetch-feishu-inspirations.js
 *
 * 数据源：飞书多维表格「01_爆款素材库」
 *   base_token: N7rqbZvpeahjsksLfQDcqNPcnac
 *   table_id:   tblAcu4IJVMclq7V
 *   筛选条件:   「是否值得复用」字段 = 「强复用」
 *
 * 鉴权：飞书自建应用 OAuth（tenant_access_token，每次现取，2h 过期）
 *   需要环境变量:
 *     FEISHU_APP_ID      自建应用 App ID
 *     FEISHU_APP_SECRET  自建应用 App Secret
 *
 * 字段映射（飞书 → inspirations.json）：
 *   - 来源平台     → platform
 *   - 爆款速览     → title（fallback: 我的产品改编方向 / 视频ID）
 *   - 视频结构拆解 / 卖点表达方式 / 我的产品改编方向 → body（拼接）
 *   - 来源账号     → source
 *   - 爆点标签 / 核心卖点 / 目标人群 / 产品类别 / 视频类型 → tags
 *   - 视频链接     → url（用户点击"查看来源"跳真的视频）
 *   - date         → TODAY（北京时间）
 *   - heat         → ''（飞书没有热度数据）
 *
 * 输出：覆盖仓库根的 inspirations.json（与 v40 schema 完全兼容，前端 0 改动）
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

// ===== HTTP =====
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

// ===== 鉴权：拿 tenant_access_token（2h 过期，每次现取） =====
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

// ===== 拉所有「强复用」记录 =====
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
    // 过滤：「是否值得复用」=「强复用」（单选字段 → operator 必须是 'is'，不能用 'contains'）
    url.searchParams.set('filter', JSON.stringify({
      conjunction: 'and',
      conditions: [{
        field_name: '是否值得复用',
        operator: 'is',
        value: ['强复用'],
      }],
    }));

    const r = await http('GET', url.toString(), null, { 'Authorization': `Bearer ${token}` });
    const items = (r.data && r.data.items) || [];
    allItems.push(...items);
    console.log(`[飞书] 第 ${pageNo} 页拉到 ${items.length} 条，累计 ${allItems.length}`);
    pageToken = r.data && r.data.page_token;
    if (!r.data || !r.data.has_more) break;
  } while (pageToken);
  return allItems;
}

// ===== 字段映射 =====
function arr(v) { return Array.isArray(v) ? v : []; }
function first(arr, fallback = '') { return (Array.isArray(arr) && arr.length) ? arr[0] : fallback; }
function pickPlatform(fields) {
  const p = first(arr(fields['来源平台'] && fields['来源平台'].value));
  // 来源平台可能是 ["抖音"] 或 ["服饰内衣-内衣裤袜"] 等，统一映射到 5+1
  if (/抖音/.test(p)) return '抖音';
  if (/小红书/.test(p)) return '小红书';
  if (/淘宝|天猫/.test(p)) return '淘宝';
  if (/微博/.test(p)) return '微博';
  if (/快手/.test(p)) return '快手';
  return '综合';
}

function toInspiration(fields, index) {
  const platform = pickPlatform(fields);
  const platformAbbr = PF_ABBR[platform] || 'all';

  // 标题：优先用爆款速览，否则我的产品改编方向，否则视频ID
  const title = (fields['爆款速览'] && fields['爆款速览'].value && fields['爆款速览'].value.trim())
    || (fields['我的产品改编方向'] && fields['我的产品改编方向'].value && fields['我的产品改编方向'].value.split('\n')[0].trim())
    || (fields['视频ID'] && fields['视频ID'].value && fields['视频ID'].value.trim())
    || `爆款记录 #${index + 1}`;

  // body：把最有价值的几个字段拼起来
  const bodyParts = [
    fields['视频结构拆解'] && fields['视频结构拆解'].value,
    fields['卖点表达方式'] && fields['卖点表达方式'].value,
    fields['我的产品改编方向'] && fields['我的产品改编方向'].value,
    fields['人工总结'] && fields['人工总结'].value,
  ].filter(Boolean);
  const body = bodyParts.join('\n\n');

  // source：账号名
  const source = (fields['来源账号'] && fields['来源账号'].value && fields['来源账号'].value.trim())
    || (fields['视频ID'] && fields['视频ID'].value && ('视频' + fields['视频ID'].value))
    || '飞书爆款素材库';

  // tags：所有 select / multi-select 字段合并去重
  const tagsRaw = [
    platform,
    ...arr(fields['爆点标签'] && fields['爆点标签'].value),
    ...arr(fields['核心卖点'] && fields['核心卖点'].value),
    ...arr(fields['目标人群'] && fields['目标人群'].value),
    ...arr(fields['产品类别'] && fields['产品类别'].value),
    ...arr(fields['视频类型'] && fields['视频类型'].value),
    ...arr(fields['黄金3秒钩子类型'] && fields['黄金3秒钩子类型'].value),
    ...arr(fields['核心情绪'] && fields['核心情绪'].value),
    ...arr(fields['使用场景'] && fields['使用场景'].value),
  ];
  // 过滤：去掉空 / 太长的 select option（"Turquoise" 等色名） / 重复
  const tags = [...new Set(tagsRaw.filter(t => t && typeof t === 'string' && t.length <= 12))];

  // url：视频链接（用户点击"查看来源"跳这个）
  let url = (fields['视频链接'] && fields['视频链接'].value) || '';
  // 飞书文本字段可能是 markdown link [text](url)，提取 URL
  const linkMatch = url.match(/\((https?:\/\/[^)]+)\)/);
  if (linkMatch) url = linkMatch[1];

  return {
    id: `insp-${platformAbbr}-${String(index + 1).padStart(2, '0')}`,
    platform,
    title: title.length > 80 ? title.slice(0, 80) + '…' : title,
    body: body || title,
    source,
    tags,
    date: TODAY,
    url,
    heat: '',
    // v40 扩展字段：保留飞书原数据，便于后续前端扩展（不写到 inspirations.json）
    _recordId: fields['_record_id'] && fields['_record_id'].value,
  };
}

(async () => {
  console.log('[飞书] 同步脚本启动，日期 ' + TODAY);
  if (!APP_ID || !APP_SECRET) {
    console.error('❌ 缺少环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET');
    console.error('   请在 GitHub Secrets 或本地 .env 配好后重试');
    process.exit(1);
  }
  try {
    const token = await getTenantToken();
    const records = await listStrongReuseRecords(token);
    console.log(`[飞书] 共拉到 ${records.length} 条「强复用」记录`);
    if (records.length === 0) {
      console.warn('[飞书] ⚠️ 没有任何「强复用」记录。请在飞书表「是否值得复用」字段选「强复用」');
      // 写一个空 inspirations.json，避免前端 fetch 报 404
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
    // 平台分布排序 + 按平台内部按 视频链接 是否有效 排序（有效在前）
    const order = { '抖音': 0, '小红书': 1, '淘宝': 2, '快手': 3, '微博': 4, '综合': 5 };
    items.sort((a, b) => {
      const oa = order[a.platform] ?? 9, ob = order[b.platform] ?? 9;
      if (oa !== ob) return oa - ob;
      return (b.url ? 1 : 0) - (a.url ? 1 : 0);
    });
    // 重置 id 为排序后顺序
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