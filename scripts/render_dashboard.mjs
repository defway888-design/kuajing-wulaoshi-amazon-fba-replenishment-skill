#!/usr/bin/env node
// 只负责把已经完成业务校验与计算的 45 列明细注入包内固定母版；不拉取或推断业务数据。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = join(packageRoot, 'assets', 'dashboard_template.html');
const TEMPLATE_SHA256 = '8f421c10599aa124004faa38ab25e338b02cf25bf8c3b3dcd8c330466e915703';
const VERSION = 'FBA-BI-PURPLE-PINK-V9';
const actions = new Set(['清货', '加快动销', '需补货', '无补货需求']);
const exceptionCategories = new Set(['销量核对异常', '商品参数异常', '库存异常', '映射异常', '商品基础数据异常']);
const statuses = new Set(['新品', '非新品', '未知']);
const stages = [
  ['计划入库', 'working'], ['标发在途', 'shipped'],
  ['接收中', 'receiving'], ['实际在途', 'real']
];
const fields = [
  'owner','site','shop','parent','msku','name','asin','avail','working','shipped','real','receiving',
  'includedLabel','includedQty','base','transit','deduct','fba','d30','d14','d7','daily','monthly',
  'production','domestic','airStart','airDays','railStart','railDays','seaStart','seaDays','listingDays',
  'safety','promo','promoName','airCover','railCover','seaCover','air','rail','sea','months','newStatus','action','note'
];
const countFields = [
  'avail','working','shipped','real','receiving','includedQty','base','transit','deduct','fba',
  'd30','d14','d7','production','domestic','seaStart','seaDays','listingDays','promo',
  'airCover','railCover','seaCover','air','rail','sea','nonFbaExcludedQty','fbmExcludedQty','rawAir','rawRail','rawSea'
];
const optionalPairFields = ['airStart','airDays','railStart','railDays'];
const twoDecimals = /^\d+\.\d{2}$/;
const textKeys = ['owner','site','shop','parent','msku','name','asin','promoName'];
const inputKeys = new Set([...fields.filter(k => k !== 'includedLabel' && k !== 'note'),
  'includedStages','monthsRaw','nonFbaExcludedQty','fbmExcludedQty','rawAir','rawRail','rawSea']);

function fail(message) { throw new Error(`看板渲染输入无效：${message}`); }
function int(value, field, row) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`第 ${row} 行 ${field} 必须是非负整数`);
}
function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function replaceExactlyOnce(source, marker, value) {
  if (source.split(marker).length !== 2) throw new Error(`母版插槽数量异常：${marker}`);
  return source.replace(marker, value);
}
function specialNote(row) {
  const parts = [];
  if (row.fbmExcludedQty > 0) parts.push(`可用总库存含FBM可售${row.fbmExcludedQty}件，已从补货扣减库存中剔除。`);
  const zeroSales = row.d30 === 0 && row.d14 === 0 && row.d7 === 0;
  const zeroClearance = zeroSales && row.newStatus === '非新品' && row.fba >= 7;
  if (zeroClearance) {
    if (row.action !== '清货') fail('零销量特殊清货商品最终动作不为清货');
    parts.push(`销量为0；FBA可售库存${row.fba}件；按1件/月模拟，库存可支持${row.fba.toFixed(2)}个月；执行清货`);
  } else if (zeroSales && row.action === '无补货需求') {
    parts.push(`销量为0；FBA可售库存${row.fba}件，实际库存可支持月数无法计算，存在库存风险。`);
  } else if (zeroSales && row.action === '需补货') {
    parts.push(`销量为0；仅因本周促销备货${row.promo}件形成补货建议。`);
  }
  const hadReplenishment = row.rawAir > 0 || row.rawRail > 0 || row.rawSea > 0;
  if (hadReplenishment && row.action === '清货') {
    parts.push('测算存在补货需求，但命中清货条件；清货优先，空运、铁路、海运建议补货量均置0。');
  } else if (hadReplenishment && row.action === '加快动销') {
    parts.push('测算存在补货需求，但命中加快动销条件；加快动销优先，空运、铁路、海运建议补货量均置0。');
  }
  return parts.map((part, i) => i < parts.length - 1 ? part.replace(/[。；]+$/, '') : part).join('；');
}
function normalizeRow(input, index) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(`第 ${index} 行不是对象`);
  for (const key of Object.keys(input)) if (!inputKeys.has(key)) fail(`第 ${index} 行含未定义字段 ${key}`);
  for (const key of inputKeys) if (!Object.hasOwn(input, key)) fail(`第 ${index} 行缺少 ${key}`);
  const row = { ...input };
  for (const key of textKeys) if (typeof row[key] !== 'string') fail(`第 ${index} 行 ${key} 必须为文本`);
  for (const key of ['owner','site','shop','parent','msku','asin']) if (!row[key].trim()) fail(`第 ${index} 行 ${key} 为空`);
  if (!/^[A-Z]{2}$/.test(row.site)) fail(`第 ${index} 行站点不是大写英文缩写`);
  row.name = row.name.trim() || '未获取';
  for (const key of countFields) int(row[key], key, index);
  for (const key of optionalPairFields) if (row[key] !== null) int(row[key], key, index);
  for (const prefix of ['air','rail']) {
    const absentStart = row[`${prefix}Start`] === null;
    const absentDays = row[`${prefix}Days`] === null;
    if (absentStart !== absentDays) fail(`第 ${index} 行 ${prefix} 运输与起运天数未成对填写`);
    if (absentStart && (row[`${prefix}Cover`] !== 0 || row[prefix] !== 0 || row[`raw${prefix[0].toUpperCase()}${prefix.slice(1)}`] !== 0)) fail(`第 ${index} 行未启用的 ${prefix} 补货量不为 0`);
    if (!absentStart && row[`${prefix}Cover`] !== row.production + row.domestic + row[`${prefix}Start`] + row[`${prefix}Days`] + row.listingDays) fail(`第 ${index} 行 ${prefix} 覆盖天数不一致`);
  }
  if (row.seaCover !== row.production + row.domestic + row.seaStart + row.seaDays + row.listingDays) fail(`第 ${index} 行海运覆盖天数不一致`);
  if (typeof row.safety !== 'number' && typeof row.safety !== 'string') fail(`第 ${index} 行安全系数类型错误`);
  if (!Number.isFinite(Number(row.safety)) || Number(row.safety) < 1 || Number(row.safety) > 2) fail(`第 ${index} 行安全系数越界`);
  if (typeof row.daily !== 'string' || !twoDecimals.test(row.daily) || typeof row.monthly !== 'string' || !twoDecimals.test(row.monthly)) fail(`第 ${index} 行加权销量必须为两位小数文本`);
  if (!statuses.has(row.newStatus) || !actions.has(row.action)) fail(`第 ${index} 行新品状态或最终动作不在固定值中`);
  if (!Array.isArray(row.includedStages) || row.includedStages.some(s => !stages.some(([label]) => label === s)) || new Set(row.includedStages).size !== row.includedStages.length) fail(`第 ${index} 行可用总库存已含阶段无效`);
  row.includedLabel = stages.filter(([label]) => row.includedStages.includes(label)).map(([label]) => label).join('、') || '无';
  const stageSum = stages.filter(([label]) => row.includedStages.includes(label)).reduce((n, [,key]) => n + row[key], 0);
  if (row.fbmExcludedQty > row.nonFbaExcludedQty || row.includedQty !== stageSum || row.transit !== row.working + row.shipped + row.receiving || row.base !== row.avail - row.includedQty - row.nonFbaExcludedQty || row.deduct !== row.base + row.transit) fail(`第 ${index} 行库存防重关系不守恒`);
  if (row.monthsRaw === null) {
    if (row.months !== null || row.d30 !== 0 || row.d14 !== 0 || row.d7 !== 0) fail(`第 ${index} 行零销量月数不一致`);
  } else if (typeof row.monthsRaw !== 'number' || !Number.isFinite(row.monthsRaw) || row.monthsRaw < 0 || typeof row.months !== 'string' || !twoDecimals.test(row.months)) fail(`第 ${index} 行支持月数无效`);
  if (row.action === '需补货') {
    if (row.air + row.rail + row.sea <= 0 || row.air !== row.rawAir || row.rail !== row.rawRail || row.sea !== row.rawSea) fail(`第 ${index} 行补货动作与建议量不一致`);
  } else if (row.air !== 0 || row.rail !== 0 || row.sea !== 0) fail(`第 ${index} 行非补货动作的最终建议量不为 0`);
  const zeroClearance = row.d30 === 0 && row.d14 === 0 && row.d7 === 0 && row.newStatus === '非新品' && row.fba >= 7;
  if (row.action === '清货' && !(zeroClearance || row.monthsRaw > 6)) fail(`第 ${index} 行清货条件不成立`);
  if (row.action === '加快动销' && !(row.monthsRaw > 4 && row.monthsRaw <= 6)) fail(`第 ${index} 行加快动销条件不成立`);
  if (row.action === '需补货' && (zeroClearance || row.monthsRaw > 4)) fail(`第 ${index} 行补货动作覆盖了更高优先级动作`);
  if (row.action === '无补货需求' && (zeroClearance || row.monthsRaw > 4 || row.rawAir + row.rawRail + row.rawSea > 0)) fail(`第 ${index} 行无补货需求条件不成立`);
  row.note = specialNote(row);
  for (const key of fields) if (!Object.hasOwn(row, key)) fail(`第 ${index} 行渲染字段 ${key} 缺失`);
  return row;
}
function normalizeException(input, index) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(`第 ${index} 条待核实商品不是对象`);
  const keys = ['owner','site','shop','parent','msku','name','asin','issues'];
  if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) fail(`第 ${index} 条待核实商品字段不完整`);
  const row = { ...input };
  for (const key of keys.filter(key => key !== 'issues')) if (typeof row[key] !== 'string') fail(`第 ${index} 条待核实商品 ${key} 必须为文本`);
  if (!/^[A-Z]{2}$/.test(row.site) || !row.shop.trim() || !row.msku.trim()) fail(`第 ${index} 条待核实商品身份不完整`);
  for (const key of ['owner','parent','name','asin']) row[key] = row[key].trim() || '未获取';
  if (!Array.isArray(row.issues) || row.issues.length < 1 || row.issues.length > 10) fail(`第 ${index} 条待核实商品异常项数量无效`);
  row.issues = row.issues.map((issue, j) => {
    if (!issue || typeof issue !== 'object' || Array.isArray(issue) || Object.keys(issue).length !== 2 ||
        typeof issue.category !== 'string' || !exceptionCategories.has(issue.category) ||
        typeof issue.detail !== 'string' || !issue.detail.trim() || issue.detail.length > 500) fail(`第 ${index} 条待核实商品第 ${j + 1} 项说明无效`);
    if (/\b(?:sid|mid|request[_ -]?id|trace[_ -]?id)\s*[:=]/i.test(issue.detail)) fail(`第 ${index} 条待核实商品说明包含内部代码`);
    return {category:issue.category, detail:issue.detail.trim()};
  });
  return row;
}
function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('顶层必须是对象');
  const required = ['templateVersion','generatedAt','period','periodStart','periodEnd','sourceMode','listingTotal','totalProducts','rows','exceptions'];
  for (const key of required) if (!Object.hasOwn(input, key)) fail(`缺少 ${key}`);
  for (const key of Object.keys(input)) if (!required.includes(key)) fail(`顶层含未定义字段 ${key}`);
  if (input.templateVersion !== VERSION) fail(`模板版本必须为 ${VERSION}`);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(input.generatedAt)) fail('北京时间格式错误');
  if (!/^\d{4}-W\d{2}$/.test(input.period) || !/^\d{4}-\d{2}-\d{2}$/.test(input.periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(input.periodEnd)) fail('周期格式错误');
  if (!['online','upload'].includes(input.sourceMode)) fail('来源路径无效');
  if (!Array.isArray(input.rows) || !Array.isArray(input.exceptions) || !Number.isSafeInteger(input.totalProducts) ||
      !Number.isSafeInteger(input.listingTotal) || input.totalProducts !== input.rows.length ||
      input.listingTotal !== input.rows.length + input.exceptions.length || input.rows.length === 0) fail('原始商品、参与计算商品或待核实商品数不守恒');
  const rows = input.rows.map((row, i) => normalizeRow(row, i + 1));
  const exceptions = input.exceptions.map((row, i) => normalizeException(row, i + 1));
  const identities = [...rows, ...exceptions].map(row => [row.site,row.shop,row.msku].join('\u0000'));
  if (new Set(identities).size !== identities.length) fail('参与计算与待核实商品的身份重复');
  return { ...input, rows, exceptions };
}
function render(payload, template) {
  const subtitle = `生成时间：${payload.generatedAt}（北京时间）｜周期：${payload.period}（${payload.periodStart} 至 ${payload.periodEnd}）｜参与计算商品：${payload.totalProducts} 个`;
  const source = payload.sourceMode === 'online'
    ? '数据来源：LingXing MCP + 运营在线参数表｜在线文件：跨境吴老师版亚马逊FBA备货管理表'
    : '数据来源：LingXing MCP + 运营上传参数表｜工作簿：跨境吴老师版亚马逊FBA备货管理表.xlsx';
  let html = replaceExactlyOnce(template, '__FBA_SUB__', htmlEscape(subtitle));
  html = replaceExactlyOnce(html, '__FBA_SOURCE__', htmlEscape(source));
  const publicRows = payload.rows.map(({ includedStages, nonFbaExcludedQty, fbmExcludedQty, rawAir, rawRail, rawSea, ...row }) => row);
  const json = JSON.stringify({ ...payload, rows: publicRows }).replace(/[<>&\u2028\u2029]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4,'0')}`);
  html = replaceExactlyOnce(html, '__FBA_PAYLOAD_JSON__', json);
  if (/__FBA_(?:SUB|SOURCE|PAYLOAD_JSON)__/.test(html)) throw new Error('母版插槽未完全填充');
  return html;
}

function main(args) {
  const inputFlag = args.indexOf('--input');
  const outputFlag = args.indexOf('--output');
  if (inputFlag < 0 || outputFlag < 0 || !args[inputFlag + 1] || !args[outputFlag + 1]) throw new Error('用法：node scripts/render_dashboard.mjs --input 已校验结果.json --output 看板.html');
  const inputPath = resolve(args[inputFlag + 1]);
  const outputPath = resolve(args[outputFlag + 1]);
  if (inputPath === outputPath || outputPath === resolve(templatePath)) throw new Error('输出路径不得覆盖输入或母版');
  if (existsSync(outputPath) && !args.includes('--overwrite')) throw new Error('输出已存在；如需覆盖请显式传 --overwrite');
  const template = readFileSync(templatePath, 'utf8');
  const actualHash = createHash('sha256').update(template, 'utf8').digest('hex');
  if (actualHash !== TEMPLATE_SHA256) throw new Error('母版 SHA-256 校验失败，停止渲染');
  const payload = validate(JSON.parse(readFileSync(inputPath, 'utf8')));
  const html = render(payload, template);
  writeFileSync(outputPath, html, 'utf8');
  process.stdout.write(`跨境吴老师备货 BI 看板已生成：${outputPath}\n`);
}

try { main(process.argv.slice(2)); }
catch (error) { process.stderr.write(`跨境吴老师当前无法继续亚马逊 FBA 备货管理：${error.message}。\n`); process.exitCode = 1; }
