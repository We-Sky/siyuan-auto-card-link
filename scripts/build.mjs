import {build} from 'esbuild';
import {mkdir, cp, readFile, writeFile, readdir} from 'node:fs/promises';
import {zipSync} from 'fflate';
await mkdir('dist', {recursive:true});
await cp('public', 'dist', {recursive:true});
await Promise.all([
  build({entryPoints:['src/index.ts'], outfile:'dist/index.js', bundle:true, format:'cjs', platform:'browser', target:'es2020', external:['siyuan'], minify:true}),
  build({entryPoints:['src/card.ts'], outfile:'dist/card.js', bundle:true, format:'iife', platform:'browser', target:'es2020', minify:true})
]);
for (const name of ['plugin.json','README.md','LICENSE','CHANGELOG.md','icon.png','preview.png']) await cp(name, `dist/${name}`);
const files = {};
async function walk(dir, prefix='') { for (const entry of await readdir(dir,{withFileTypes:true})) { const key=prefix+entry.name; if(entry.isDirectory()) await walk(`${dir}/${entry.name}`,`${key}/`); else files[key]=new Uint8Array(await readFile(`${dir}/${entry.name}`)); } }
await walk('dist');
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/package.zip',zipSync(files,{level:9}));
console.log('Built dist/ and artifacts/package.zip');
