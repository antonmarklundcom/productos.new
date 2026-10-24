import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {d1StagingPlugin} from '../../workers/d1/build-plugin.mjs';

test('interactive ProductImage stays behind an explicit client boundary in source and native transform',()=>{
 const root=path.resolve(import.meta.dirname,'../..'),file=path.join(root,'src/components/product-image.tsx');
 const source=readFileSync(file,'utf8'),transformed=d1StagingPlugin(root).transform(source,file)?.code ?? source;
 for(const [label,code] of [['source',source],['native transformed',transformed]]){
  const ast=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),first=ast.statements[0];
  assert.ok(first&&ts.isExpressionStatement(first)&&ts.isStringLiteral(first.expression)&&first.expression.text==='use client',label+' must classify useState/onError image fallback as client code');
  assert.match(code,/useState/);assert.match(code,/onError/);
  const javascript=ts.transpileModule(code,{compilerOptions:{jsx:ts.JsxEmit.Preserve,module:ts.ModuleKind.ESNext}}).outputText;
  assert.doesNotMatch(javascript,/from ["'](?:@\/db(?:\/|["'])|@\/domain\/|.*workers\/d1\/database)/,'public image props/helpers cannot import private database readers');
 }
});
