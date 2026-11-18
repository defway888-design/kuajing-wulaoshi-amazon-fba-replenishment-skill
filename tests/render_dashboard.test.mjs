import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Script } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const renderer = join(root, 'scripts', 'render_dashboard.mjs');

function makeRow(overrides = {}) {
  return {
    owner:'运营甲',site:'US',shop:'示例店铺',parent:'B000000001',msku:'SKU-001',name:'示例本地品名',asin:'B000000001',
    avail:0,working:0,shipped:0,real:0,receiving:0,includedStages:[],includedQty:0,base:0,transit:0,deduct:0,
    fba:0,d30:30,d14:14,d7:7,daily:'1.00',monthly:'30.00',production:0,domestic:0,
    airStart:null,airDays:null,railStart:null,railDays:null,seaStart:0,seaDays:30,listingDays:0,safety:1.1,
    promo:0,promoName:'',airCover:0,railCover:0,seaCover:30,rawAir:0,rawRail:0,rawSea:33,air:0,rail:0,sea:33,
    months:'0.00',monthsRaw:0,newStatus:'非新品',action:'需补货',nonFbaExcludedQty:0,fbmExcludedQty:0,
    ...overrides
  };
}
function makePayload(rows, exceptions = []) {
  return { templateVersion:'FBA-BI-PURPLE-PINK-V9',generatedAt:'2026-11-18 12:00',period:'2026-W47',
    periodStart:'2026-11-16',periodEnd:'2026-11-22',sourceMode:'upload',
    listingTotal:rows.length+exceptions.length,totalProducts:rows.length,rows,exceptions };
}
function run(payload) {
  const dir = mkdtempSync(join(tmpdir(), 'fba-board-test-'));
  const input = join(dir, 'input.json');
  const output = join(dir, 'output.html');
  writeFileSync(input, JSON.stringify(payload), 'utf8');
  const result = spawnSync(process.execPath, [renderer,'--input',input,'--output',output], {encoding:'utf8'});
  const html = existsSync(output) ? readFileSync(output, 'utf8') : null;
  rmSync(dir, {recursive:true,force:true});
  return {result,html};
}

test('packages one offline HTML with vertical centering, fixed labels and no mock data', () => {
  const clear = makeRow({msku:'SKU-002',avail:210,base:210,deduct:210,fba:210,months:'7.00',monthsRaw:7,
    promo:5,rawSea:5,sea:0,action:'清货'});
  const zeroClear = makeRow({msku:'SKU-003',avail:8,base:8,deduct:8,fba:8,d30:0,d14:0,d7:0,
    daily:'0.00',monthly:'0.00',months:null,monthsRaw:null,rawSea:0,sea:0,action:'清货'});
  const included = makeRow({msku:'SKU-004',avail:13,working:2,shipped:3,real:1,receiving:0,
    includedStages:['实际在途','标发在途'],includedQty:4,nonFbaExcludedQty:2,fbmExcludedQty:2,base:7,transit:5,deduct:12,
    fba:0,rawSea:21,sea:21,name:'',promoName:''});
  const {result,html} = run(makePayload([makeRow(),clear,zeroClear,included]));
  assert.equal(result.status, 0, result.stderr);
  assert.ok(html);
  assert.match(html, /thead th,tbody td\{vertical-align:middle\}/);
  assert.match(html, /data-template-version="FBA-BI-PURPLE-PINK-V9"/);
  assert.match(html, /当前筛选条件下无商品/);
  assert.match(html, /跨境吴老师_FBA备货_\$\{payload.period\}_\$\{action\}商品_当前筛选明细\.csv/);
  assert.match(html, /可用总库存含FBM可售2件，已从补货扣减库存中剔除/);
  assert.match(html, /销量为0；FBA可售库存8件；按1件\/月模拟，库存可支持8\.00个月；执行清货/);
  assert.match(html, /测算存在补货需求，但命中清货条件；清货优先/);
  assert.match(html, /标发在途、实际在途/);
  assert.match(html, /未获取/);
  assert.doesNotMatch(html, /B0SIM|2026-W45|mockInputs|跨站归属模拟/);
  assert.doesNotMatch(html, /当前筛选：/);
  assert.doesNotMatch(html, /__FBA_/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Script(script));
});

test('blocks inconsistent actions and does not create HTML', () => {
  const invalid = makeRow({action:'无补货需求',air:0,rail:0,sea:0});
  const {result,html} = run(makePayload([invalid]));
  assert.notEqual(result.status, 0);
  assert.equal(html, null);
  assert.match(result.stderr, /无补货需求条件不成立/);
});

test('escapes product text inside the script payload', () => {
  const {result,html} = run(makePayload([makeRow({name:'</script><script>alert(1)</script>'})]));
  assert.equal(result.status, 0, result.stderr);
  assert.ok(html);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /\\u003c\/script\\u003e/);
});

test('isolates one unexplained MSKU sales discrepancy without hiding healthy products', () => {
  const exception = {owner:'运营甲',site:'US',shop:'示例店铺',parent:'B000000002',msku:'SKU-002',
    name:'本地商品乙',asin:'B000000002',issues:[
      {category:'销量核对异常',detail:'近30天：Listing参考销量37件，产品表现销量36件；定向复查仍无法解释。'},
      {category:'销量核对异常',detail:'近14天：Listing参考销量13件，产品表现销量12件；定向复查仍无法解释。'}
    ]};
  const {result,html} = run(makePayload([makeRow()], [exception]));
  assert.equal(result.status, 0, result.stderr);
  assert.match(html, /参与计算商品：1 个/);
  assert.match(html, /待核实商品（未参与计算）/);
  assert.match(html, /SKU-002/);
  assert.match(html, /Listing参考销量37件，产品表现销量36件/);
  assert.match(html, /Listing参考销量13件，产品表现销量12件/);
  assert.match(html, /待核实（未计算）/);
  assert.doesNotMatch(html, /"msku":"SKU-002"[^\n]*"action":"无补货需求"/);
});

test('blocks all-exception and duplicate-identity dashboards', () => {
  const exception = {owner:'运营甲',site:'US',shop:'示例店铺',parent:'B000000001',msku:'SKU-001',
    name:'本地商品甲',asin:'B000000001',issues:[{category:'销量核对异常',detail:'近30天销量无法核对。'}]};
  const allExcluded = run(makePayload([], [exception]));
  assert.notEqual(allExcluded.result.status, 0);
  assert.equal(allExcluded.html, null);
  const duplicate = run(makePayload([makeRow()], [exception]));
  assert.notEqual(duplicate.result.status, 0);
  assert.equal(duplicate.html, null);
});

test('rejects unaccounted Listings and undefined exception categories', () => {
  const exception = {owner:'运营甲',site:'US',shop:'示例店铺',parent:'B000000002',msku:'SKU-002',
    name:'本地商品乙',asin:'B000000002',issues:[{category:'销量核对异常',detail:'近30天销量核对未通过。'}]};
  const missing = makePayload([makeRow()], [exception]);
  missing.listingTotal = 3;
  const countFailure = run(missing);
  assert.notEqual(countFailure.result.status, 0);
  assert.equal(countFailure.html, null);
  const badCategory = makePayload([makeRow()], [exception]);
  badCategory.exceptions[0].issues[0].category = '无需补货';
  const categoryFailure = run(badCategory);
  assert.notEqual(categoryFailure.result.status, 0);
  assert.equal(categoryFailure.html, null);
});
