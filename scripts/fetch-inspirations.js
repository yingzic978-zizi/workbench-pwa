#!/usr/bin/env node
/**
 * 每日灵感自动抓取脚本（v40 重写版）
 * 用法: node scripts/fetch-inspirations.js
 *
 * 抓取策略（每平台 3 层 fallback，零成本运行）：
 *   第 1 层：vvhan 聚合热榜 API（一次性拿到 5 平台 JSON）
 *   第 2 层：各平台公开页 HTML 抓取（微博热搜/抖音热榜/快手热榜等）
 *   第 3 层：内置 60 条题库按平台抽（保证每天不空）
 *
 * 关键词过滤："睡衣 / 家居服 / 居家服 / 睡裙 / 家居袜 / 真丝 / 纯棉 / 冰丝 / 莫代尔 / 莱赛尔 / 半边绒 / 雪花绒 / 夹棉 / 情侣 / 儿童 / 孕妇 / 大码 / 可外穿 / 新中式 / 法式 / 银发 / 源头工厂 / 工厂" 等
 * 命中 ≥1 条关键词 → 入库；命中 0 条 → 平台题库兜底
 *
 * 输出：覆盖仓库根的 inspirations.json
 *   { updated, note, items: [ { id, platform, title, body, source, tags, date, url, heat } ] }
 *   - 新增 heat 字段（热度数字字符串，如 "123.4万" / "45.2w" / "8901"），UI 可选展示
 *
 * 配合 .github/workflows/inspiration-fetch.yml 每日定时运行。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

const OUT = path.join(__dirname, '..', 'inspirations.json');
const TODAY = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); // 北京时间

// 5 平台 + 兜底标识
const PLATFORMS = ['抖音', '小红书', '淘宝', '微博', '快手'];
const PF_ABBR = { '抖音': 'dy', '小红书': 'xhs', '淘宝': 'tb', '微博': 'wb', '快手': 'ks', '综合': 'all' };

// 抓取目标关键词（命中即入灵感库）
const KEYWORDS = [
  '睡衣', '家居服', '居家服', '睡裙', '睡袍', '家居裤', '家居袜', '睡衣女', '睡衣男', '睡衣套装',
  '宝宝睡衣', '儿童睡衣', '孕妇睡衣', '情侣睡衣', '夹棉睡衣', '冰丝睡衣', '莫代尔睡衣', '纯棉睡衣',
  '真丝睡衣', '莱赛尔睡衣', '半边绒睡衣', '雪花绒睡衣', '家居服女', '家居服男', '大码睡衣', '睡衣品牌',
  '睡衣测评', '睡衣推荐', '睡衣种草', '家居服测评', '家居服推荐', '家居服种草', '家居服穿搭',
  '可外穿', '新中式', '法式家居', '源头工厂', '睡衣工厂', '家居服工厂', '睡衣店铺', '睡衣店',
];

// 面料/品类词（命中即入面料标签）
const FABRICS = ['纯棉', '莱赛尔', '莫代尔棉', '莫代尔', '云朵棉', '雪花绒', '半边绒', '羊毛绒', '夹棉', '冰丝', '真丝', '天丝', '棉绸', '全棉', '可外穿', '情侣', '儿童', '孕妇', '大码', '新中式', '法式', '源头工厂'];

// 平台题库（按平台分类的兜底题；用于命中为空时补位）
const POOL = {
  '抖音': [
    { title: '抖音睡衣销量榜·冰丝/棉绸/睡裙三大爆款品类', body: '2026 抖音睡衣销量榜显示：儿童冰丝、女士棉绸套装、网红睡裙位列前茅。选题方向：对比「10 元棉绸 vs 百元品质款」上身差异，钩子「同样是棉绸，为什么她家的能卖爆？」', tags: ['抖音', '冰丝', '棉绸'] },
    { title: '猫咪睡衣单日销量 30w 的账号矩阵打法', body: '「品牌自营+商家自营+20 个达人号」矩阵打法拆解，爆品可外穿显瘦。选题方向：拆解矩阵号分工，钩子「一件猫咪睡衣，人家一天卖你一年的量」。', tags: ['抖音', '可外穿', '达人矩阵'] },
    { title: '抖音「可外穿家居服」通勤场景爆发', body: '自带胸垫 + 外穿设计切入「下楼拿快递 / 取外卖」场景。选题方向：拍「穿着睡衣出门被夸好看」反差，钩子「谁说睡衣不能上街」。', tags: ['抖音', '可外穿'] },
    { title: '抖音大码家居服「微胖女孩」自信人设', body: '放大「显瘦遮肉」卖点，微胖博主真实上身对比带转化。选题方向：微胖博主真实对比，钩子「130 斤穿出 100 斤的错觉」。', tags: ['抖音', '大码'] },
    { title: '抖音儿童家居服「亲子同款」种草', body: '亲子装情绪价值高，宝妈群体自发传播。选题方向：拍「和孩子一起赖床」温馨 vlog，钩子「一套睡衣，两代人的快乐」。', tags: ['抖音', '儿童', '情侣'] },
    { title: '抖音「工厂直供」人设直播话术拆解', body: '厂长 / 老板娘出镜砍价建立信任。选题方向：拆「工厂大门随便进」信任公式，钩子「没有中间商，这价我自己都穿」。', tags: ['抖音', '源头工厂'] },
    { title: '抖音新中式家居服国风爆款', body: '盘扣 + 提花溢价高，国风审美人群买账。选题方向：国风变装视频，钩子「穿上像从古画里走出来」。', tags: ['抖音', '新中式'] },
    { title: '抖音「情侣睡衣挑战」话题玩法', body: 'CP 同框拉互动，评论区自发玩梗。选题方向：拍「男朋友被迫穿情侣款」反差萌，钩子「他嘴上说丑，身体很诚实」。', tags: ['抖音', '情侣'] },
    { title: '抖音家居服「开箱测评」信任打法', body: '素人开箱 + 真实吐槽比硬广更可信。选题方向：做「9.9 vs 99 开箱盲测」，钩子「贵真的有道理吗」。', tags: ['抖音', '测评'] },
    { title: '抖音「反季清仓」家居服冲量节奏', body: '过季款低价清，精明消费者蹲守。选题方向：拆「反季囤货省一半」逻辑，钩子「夏天买冬睡衣，聪明人都这么干」。', tags: ['抖音', '反季'] },
  ],
  '小红书': [
    { title: '小红书 #今夏家居服 TOP3 精准人群打法', body: '咖色猫咪可外穿全棉款成话题 TOP3，锁定 155-160cm / 80-100 斤人群。选题方向：按身高段出「小个子睡衣尺码攻略」，钩子「155 的姐妹别再穿到拖地了」。', tags: ['小红书', '全棉', '可外穿'] },
    { title: '小红书情侣家居服「同款不同色」种草', body: '情侣款靠「CP 感 + 居家仪式感」拉互动。选题方向：拍「男朋友穿和我同款」的反差萌，钩子「他嫌丑，穿上一秒真香」。', tags: ['小红书', '情侣', '可外穿'] },
    { title: '小红书「小个子睡衣尺码攻略」', body: '155-160cm 专属推荐解决「拖地」痛点。选题方向：身高段精准推荐，钩子「155 的姐妹别再穿到拖地了」。', tags: ['小红书', '小个子'] },
    { title: '小红书「莫代尔亲肤」肤感测评笔记', body: '放大触感体验，脸颊测试法直观。选题方向：用「脸颊测试法」拍触感，钩子「脸能贴的睡衣才敢穿」。', tags: ['小红书', '莫代尔棉'] },
    { title: '小红书「法式家居服」氛围感穿搭', body: '蕾丝 + 慵懒风满足独处仪式感。选题方向：居家咖啡角摆拍，钩子「在家也要有巴黎午后的松弛感」。', tags: ['小红书', '法式'] },
    { title: '小红书「孕妈家居服」舒适刚需', body: '托腹 + 哺乳口设计解决孕期痛点。选题方向：孕妈真实体验，钩子「怀孕也想美美的躺平」。', tags: ['小红书', '孕妇'] },
    { title: '小红书「凉感面料」夏日实测', body: '红外测温对比直观打「凉」卖点。选题方向：对比凉感 vs 普通款，钩子「37 度也睡得凉」。', tags: ['小红书', '莱赛尔', '天丝'] },
    { title: '小红书「老钱风家居服」低调质感', body: '莫代尔素色满足低调高级感。选题方向：质感细节特写，钩子「不出门也要的高级感」。', tags: ['小红书', '莫代尔棉'] },
    { title: '小红书「宿舍家居服」学生党平价', body: '亲民价位 + 宿舍场景精准触达。选题方向：学生宿舍 vlog，钩子「大学四年睡好一点」。', tags: ['小红书', '平价'] },
    { title: '小红书「家居服改造」DIY 互动', body: '旧衣改造类内容互动率高。选题方向：教程类「10 分钟旧 T 变家居服」，钩子「不花钱拥有专属款」。', tags: ['小红书', 'DIY'] },
  ],
  '淘宝': [
    { title: '淘宝睡衣销量榜·纯棉基础款长青逻辑', body: '纯棉基础款靠「回购 + 平价 + 多色」稳居榜单。选题方向：做「闭眼入的 5 件纯棉基础款」清单，钩子「穿过就回不去的舒服」。', tags: ['淘宝', '纯棉'] },
    { title: '天猫 super 品类日·家居服会场打法', body: '大促会场靠「满减 + 赠品 + 直播专享价」冲量。选题方向：拆「大促前 7 天蓄水」节奏，钩子「现在加购，开门就抢」。', tags: ['淘宝', '纯棉'] },
    { title: '淘宝「冰丝凉感」夏季主推款', body: '搜索词爆发，SEO 占位关键。选题方向：拆「凉感关键词」SEO，钩子「搜冰丝的人夏天都买了它」。', tags: ['淘宝', '冰丝'] },
    { title: '淘宝「情侣睡衣」送礼场景', body: '节日礼盒装提升客单与情感价值。选题方向：送礼清单植入，钩子「异地恋也能同款入睡」。', tags: ['淘宝', '情侣'] },
    { title: '淘宝「儿童家居服」A类标准背书', body: 'A 类无荧光剂是父母核心关切。选题方向：放大 A 类标准，钩子「贴身穿更要零添加」。', tags: ['淘宝', '儿童'] },
    { title: '淘宝「加厚夹棉」冬季爆款', body: '北方刚需，保暖是第一卖点。选题方向：北方暖气房外保暖，钩子「南方没暖气，这件顶一床被」。', tags: ['淘宝', '夹棉'] },
    { title: '淘宝「卡通家居服」IP 联名', body: '萌系 IP 溢价高，年轻人买账。选题方向：IP 同款盘点，钩子「把童年穿在身上」。', tags: ['淘宝', '卡通'] },
    { title: '淘宝「回购榜单」闭眼入清单', body: '从众心理驱动转化。选题方向：做「10 万+ 回购」合集，钩子「大家都在回购不会错」。', tags: ['淘宝', '纯棉'] },
  ],
  '快手': [
    { title: '快手老铁经济·源头工厂直播话术', body: '快手靠「老板娘人设 + 工厂实景 + 一口价」建立信任。选题方向：工厂流水线实拍 + 老板娘出镜，钩子「没有中间商，这价我自己都穿」。', tags: ['快手', '源头工厂'] },
    { title: '快手 9.9 福利款引流直播', body: '低价福利款做引流，再转高客单。选题方向：拆「福利款 → 利润款」过款节奏，钩子「9 块 9 先抢，好货在后头」。', tags: ['快手', '源头工厂'] },
    { title: '快手「宝妈创业」人设家居服', body: '真实逆袭故事引发共情。选题方向：宝妈带娃创业故事，钩子「带娃赚钱两不误」。', tags: ['快手', '宝妈'] },
    { title: '快手「大码男装家居服」空白市场', body: '男性大码缺货，蓝海机会。选题方向：男性大码痛点，钩子「180 斤也能穿出型」。', tags: ['快手', '大码'] },
    { title: '快手「年货节家居服」囤货打法', body: '节前冲量，礼赠场景强。选题方向：拆年货清单，钩子「过年回家，先从一套新睡衣开始」。', tags: ['快手', '年货'] },
    { title: '快手「厂长砍价」剧情直播', body: '人设剧情拉停留。选题方向：厂长被员工「逼」降价喜剧，钩子「今天不降价不让走」。', tags: ['快手', '源头工厂'] },
    { title: '快手「三农+家居服」乡土信任', body: '产地直发，乡土人设建立信任。选题方向：农村院子发货实拍，钩子「从我家院子到你家衣柜」。', tags: ['快手', '源头工厂'] },
    { title: '快手「银发家居服」爸妈刚需', body: '中老年舒适款孝心场景强。选题方向：孝心场景，钩子「给爸妈的体面温暖」。', tags: ['快手', '银发'] },
  ],
  '微博': [
    { title: '微博 #家居服穿搭# 话题热度', body: '微博话题靠「明星同款 + 晒单」引爆。选题方向：做「明星同款平替」盘点，钩子「她同款睡衣，我找到了 1/10 价」。', tags: ['微博', '可外穿'] },
    { title: '微博热搜·换季家居服情绪梗', body: '换季「不想出门只想宅」情绪梗易传播。选题方向：拍「周末宅家 day」vlog，钩子「穿上就不想脱的宅家快乐」。', tags: ['微博', '全棉'] },
    { title: '微博「明星同款平替」盘点', body: '流量借势，平价替代吃红利。选题方向：明星机场家居风，钩子「她同款睡衣，我找到了 1/10 价」。', tags: ['微博', '平替'] },
    { title: '微博「双十一预售」家居服剧透', body: '节点营销提前蓄水。选题方向：预售清单，钩子「先加购，开门就抢」。', tags: ['微博', '大促'] },
    { title: '微博「国货家居服」情绪营销', body: '支持国货情绪拉动转化。选题方向：国货溯源故事，钩子「国产睡衣不比大牌差」。', tags: ['微博', '国货'] },
    { title: '微博「宅家 vlog」话题互动', body: 'UGC 征集拉互动。选题方向：发起「我的宅家穿搭」投票，钩子「晒出你的快乐老家」。', tags: ['微博', '宅家'] },
  ],
};

// ===== 工具函数 =====
function get(url, opts = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('bad url: ' + url)); }
    const req = https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      port: u.port || 443,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Accept': opts.accept || '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        ...(opts.headers || {}),
      },
      timeout: 8000,
    }, (res) => {
      // 跟随 1 次重定向
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return get(res.headers.location, opts).then(resolve, reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, text: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout(' + url + ')')));
  });
}

function matchKeyword(text) {
  return KEYWORDS.find(k => text.includes(k)) || null;
}
function extractFabrics(text) {
  const tags = new Set();
  for (const f of FABRICS) if (text.includes(f)) tags.add(f);
  return [...tags];
}

function suggest(text) {
  const hit = FABRICS.find(f => text.includes(f)) || '家居服';
  const variants = [
    `可围绕「${hit}」做一期「工厂实拍 vs 网上爆款」的上身对比，钩子「同样是${hit}，为什么她家的能卖爆？」`,
    `建议从「小个子/大码/情侣」细分人群切入，钩子「155 的姐妹别再穿到拖地了」，精准锁定人群提高转化`,
    `可拆「源头工厂人设 + 老板娘出镜」短视频，钩子「工厂大门随便进，价格标签随便看」，强化信任感`,
    `建议做「10 元平替 vs 百元品质款」实测，钩子「差 90 块到底差在哪」，拉满评论区互动`,
    `可绑定「夏季/换季/送礼」场景做系列，钩子「这件${hit}我妈抢着穿」，用亲情场景带转化`,
  ];
  return variants[text.length % variants.length];
}

function heatToNumber(heat) {
  if (!heat) return 0;
  const s = String(heat).replace(/,/g, '').trim();
  if (/万|w/i.test(s)) return Math.round(parseFloat(s) * 10000);
  if (/亿/i.test(s)) return Math.round(parseFloat(s) * 100000000);
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
}

// 稳定伪随机：跨天不同、同天可复现
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function shuffle(arr, seed) { const a = [...arr]; const rng = mulberry32(seed); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function dateSeed() { return parseInt(TODAY.replace(/-/g, ''), 10) || 1; }

function fromPool(platform, n, exclude) {
  const pool = (POOL[platform] || []).filter(p => !exclude.has(p.title));
  const picked = shuffle(pool, dateSeed() + platform.charCodeAt(0)).slice(0, n);
  return picked.map(p => ({
    id: '', platform, title: p.title, body: p.body,
    source: '内置题库', tags: [...p.tags], date: TODAY,
    url: platformUrl(platform), heat: '',
  }));
}

function platformUrl(platform) {
  return ({ '抖音': 'https://www.douyin.com', '小红书': 'https://www.xiaohongshu.com', '淘宝': 'https://www.taobao.com', '微博': 'https://s.weibo.com', '快手': 'https://www.kuaishou.com' })[platform] || '';
}

// ===== 各平台 fetcher =====

// 1) vvhan 聚合热榜 API：一次拿到 5 平台数据
async function fetchVvhan(type) {
  const url = `https://api.vvhan.com/api/hotlist?type=${type}`;
  const r = await get(url, { accept: 'application/json' });
  if (r.status !== 200) throw new Error('vvhan HTTP ' + r.status);
  let json;
  try { json = JSON.parse(r.text); } catch (e) { throw new Error('vvhan json parse fail'); }
  if (!json || !json.success || !Array.isArray(json.data)) throw new Error('vvhan bad format');
  return json.data.map((it, idx) => ({
    title: String(it.title || '').trim(),
    url: String(it.url || '').trim(),
    heat: String(it.hot || it.score || '').trim(),
    rank: it.index || idx + 1,
  })).filter(it => it.title);
}

// 2) 微博热搜 HTML 解析（兜底）
async function fetchWeiboHtml() {
  const r = await get('https://s.weibo.com/top/summary', { accept: 'text/html' });
  if (r.status !== 200) throw new Error('weibo HTTP ' + r.status);
  // 抓标题 + 热度
  const titleRe = /<a[^>]*href="\/weibo\?q=[^"]*"[^>]*>([^<]{4,80})<\/a>/g;
  const heatRe = /<span>(\d{3,})<\/span>/g;
  const titles = [];
  let m;
  while ((m = titleRe.exec(r.text))) titles.push(m[1].trim());
  const heats = [];
  while ((m = heatRe.exec(r.text))) heats.push(m[1]);
  return titles.slice(0, 50).map((t, i) => ({ title: t, heat: heats[i] || '', url: 'https://s.weibo.com/top/summary', rank: i + 1 }));
}

// 各平台 fetcher 组合
const PLATFORM_FETCHERS = {
  '微博':    [() => fetchVvhan('wbHot'),   fetchWeiboHtml],
  '抖音':    [() => fetchVvhan('dyHot')],
  '小红书':  [() => fetchVvhan('xhsHot')],
  '快手':    [() => fetchVvhan('ksHot')],
  '淘宝':    [() => fetchVvhan('tbHot')],
};

async function fetchPlatform(platform) {
  const fetchers = PLATFORM_FETCHERS[platform] || [];
  for (const f of fetchers) {
    try {
      const items = await f();
      if (items && items.length) {
        console.log(`[灵感] ${platform} 抓到 ${items.length} 条`);
        return items;
      }
    } catch (e) {
      console.warn(`[灵感] ${platform} 抓取失败: ${e.message}`);
    }
  }
  console.warn(`[灵感] ${platform} 全部 fetcher 失败，返回空`);
  return [];
}

function toInspiration(platform, item) {
  const title = item.title || '';
  const body = item.body || '';
  const url = item.url || platformUrl(platform);
  const source = platformDomain(url) || '网络';
  const tags = ['灵感', platform, ...extractFabrics(title + body)];
  const bodyFull = body ? body + '\n\n💡 选题建议：' + suggest(title + body) : `💡 选题建议：${suggest(title)}`;
  return {
    id: '', platform, title,
    body: bodyFull,
    source, tags: [...new Set(tags)], date: TODAY, url,
    heat: item.heat || '',
  };
}

function platformDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

async function build() {
  const allItems = [];
  const usedTitles = new Set();

  // 1. 并行抓 5 平台
  const results = await Promise.all(PLATFORMS.map(p => fetchPlatform(p).then(items => ({ platform: p, items }))));

  // 2. 过滤 + 入库（每平台最多 5 条）
  for (const { platform, items } of results) {
    const matched = items
      .filter(it => matchKeyword(it.title))
      .slice(0, 5);
    if (matched.length === 0) {
      console.log(`[灵感] ${platform} 关键词未命中，题库兜底 3 条`);
      const fb = fromPool(platform, 3, usedTitles);
      fb.forEach(it => { if (!usedTitles.has(it.title)) { allItems.push(it); usedTitles.add(it.title); } });
    } else {
      for (const it of matched) {
        if (usedTitles.has(it.title)) continue;
        usedTitles.add(it.title);
        allItems.push(toInspiration(platform, it));
      }
      // 不够 3 条的用题库补齐
      if (matched.length < 3) {
        const fb = fromPool(platform, 3 - matched.length, usedTitles);
        fb.forEach(it => { if (!usedTitles.has(it.title)) { allItems.push(it); usedTitles.add(it.title); } });
      }
    }
  }

  // 3. 排序 + 补 id + 截断
  const order = { '抖音': 0, '小红书': 1, '淘宝': 2, '快手': 3, '微博': 4, '综合': 5 };
  allItems.sort((a, b) => {
    const oa = order[a.platform] ?? 9, ob = order[b.platform] ?? 9;
    if (oa !== ob) return oa - ob;
    // 同平台按热度降序
    return heatToNumber(b.heat) - heatToNumber(a.heat);
  });
  allItems.forEach((it, i) => { it.id = `insp-${PF_ABBR[it.platform] || 'all'}-${String(i + 1).padStart(2, '0')}`; });

  return allItems;
}

(async () => {
  console.log('[灵感] v40 真抓模式启动，日期 ' + TODAY);
  let items;
  try {
    items = await build();
  } catch (e) {
    console.error('[灵感] 抓取出错: ' + e.message + '，全量题库兜底');
    items = [];
    for (const p of PLATFORMS) items.push(...fromPool(p, 3, new Set()));
  }
  const out = {
    updated: TODAY,
    note: '每日灵感由 GitHub Actions 真抓 5 平台热榜（微博/抖音/小红书/淘宝/快手），按「睡衣/家居服/居家服」等关键词过滤，命中入库；未命中/抓取失败的平台由内置题库兜底。灵感页打开即自动拉取，可按平台筛选；UI 可展示「热度」字段。',
    items,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  const stats = items.reduce((m, it) => { m[it.platform] = (m[it.platform] || 0) + 1; return m; }, {});
  console.log('[灵感] 写入 ' + OUT + '，共 ' + items.length + ' 条，平台分布：' + JSON.stringify(stats));
})();
