// Optional integration check against the Lute shipped with an installed SiYuan.
// Usage: node scripts/verify-lute.cjs "<SiYuan resources>/stage/protyle/js/lute/lute.min.js"
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = process.argv[2];
if (!path) throw new Error('Pass the absolute path to the installed lute.min.js');
global.require = require;
vm.runInThisContext(fs.readFileSync(path, 'utf8'));
const lute = global.Lute.New();
lute.SetProtyleWYSIWYG(true);
const data = {version:1,url:'https://example.com/?a=1&b=2',title:'中文 " <script>test</script>',description:'测试摘要',site:'Example',image:'',favicon:'',fetched:true};
const encoded = encodeURIComponent(JSON.stringify(data));
const html = `<iframe src="/plugins/siyuan-auto-card-link/card.html#${encoded}" data-src="/plugins/siyuan-auto-card-link/card.html#${encoded}" data-subtype="widget" style="width: 100%; height: 156px;"></iframe>`;
for (const method of ['Md2BlockDOM','HTML2BlockDOM']) {
  const block = lute[method](html);
  assert.match(block, /data-type="NodeWidget"/);
  assert.ok(block.includes(encoded));
  const exported = lute.BlockDOM2Md(block);
  const reopened = lute.Md2BlockDOM(exported);
  assert.match(reopened, /data-type="NodeWidget"/);
  assert.ok(reopened.includes(encoded));
  assert.match(reopened, /height: 156px/);
  console.log(`${method}: native widget, metadata and dimensions survive export/reimport`);
}
const local=lute.Md2BlockDOM(html+'\n{: custom-data-assets="assets/cardlink-cover.jpg"}\n');
assert.match(local,/custom-data-assets="assets\/cardlink-cover.jpg"/);
assert.match(lute.Md2BlockDOM(lute.BlockDOM2Md(local)),/custom-data-assets="assets\/cardlink-cover.jpg"/);
console.log('Local cover asset reference survives export/reimport');
