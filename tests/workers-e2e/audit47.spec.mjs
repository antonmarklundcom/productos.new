import {test,expect} from '@playwright/test';
import sharp from 'sharp';
import {createHarness,restrictBrowser,fixturePassword} from '../../scripts/workers-browser-harness.mjs';
import {PUBLIC_DATA_CACHE_SECONDS,PUBLIC_PREFETCH_CACHE_SECONDS} from '../../workers/d1/public-cache-budget.mjs';
let h;
test.beforeEach(async({context})=>{h=await createHarness({cacheSeconds:30});await restrictBrowser(context,h.baseURL);});
test.afterEach(async()=>{await h?.close();});
async function rendered(route,clock,headers={}) {
 return test.step(`${headers.rsc ? 'RSC' : 'HTML'} fixture render ${route}`,async()=>{
  let target=new URL(h.baseURL+route);
  const signal=AbortSignal.timeout(15000);
  for(let redirects=0;redirects<=3;redirects++){
   const response=await fetch(target,{headers:{accept:'text/html','x-fixture-clock-ms':String(clock),...headers},redirect:'manual',signal});
   const location=response.headers.get('location');
   if([301,302,303,307,308].includes(response.status)&&location){
    const next=new URL(location,target);
    expect(next.origin,'fixture redirects remain isolated from public networks').toBe(h.baseURL);
    await response.arrayBuffer();target=next;continue;
   }
   return {status:response.status,headers:response.headers,text:await response.text()};
  }
  throw Error('Fixture render exceeded three same-origin redirects');
 });
}
async function cached(route,clock) {
 let result;
 await expect.poll(async()=>{result=await rendered(route,clock);return result.headers.get('x-catalog-cache');},{timeout:10000}).toBe('HIT');
 return result;
}
test('cache-enabled built Worker shares fresh DTOs across HTML/RSC and expires edited content without stacked TTLs',async({browserName})=>{
 test.skip(browserName!=='chromium','The cache lifecycle is engine-independent; public interactions run in every engine.');
 const time=Date.now(), route='/producto/synthetic-visible';
 const initial=await rendered(route,time);
 expect(initial.status).toBe(200);expect(initial.headers.get('x-catalog-cache')).toBe('MISS');
 expect(Number(initial.headers.get('x-catalog-expires-at'))).toBeLessThanOrEqual(time+30000);
 await cached(route,time);
 await h.db.prepare("UPDATE products SET name='Synthetic fresh after expiry' WHERE id=1").run();
 const old=await rendered(route,time+29000);expect(old.headers.get('x-catalog-cache')).toBe('HIT');expect(old.text).not.toContain('Synthetic fresh after expiry');
 const rsc=await rendered(route,time+29000,{rsc:'1',accept:'text/x-component'});
 expect(rsc.status).toBe(200);expect(rsc.headers.get('content-type')).toContain('text/x-component');expect(rsc.text.length).toBeGreaterThan(0);
 expect(rsc.headers.get('x-catalog-cache')).toBe('BYPASS');expect(rsc.headers.get('cache-control')).toContain('no-store');
 expect(rsc.text).toContain('Synthetic visible');expect(rsc.text).not.toContain('Synthetic fresh after expiry');expect(rsc.text).not.toContain('Synthetic hidden private marker');
 for(const headers of [{cookie:'fixture_private=1'},{authorization:'Bearer synthetic-private'},{'cache-control':'no-cache'}]){
  const privateRead=await rendered(route,time+29000,headers);
  expect(privateRead.headers.get('x-catalog-cache')).toBe('BYPASS');expect(privateRead.headers.get('cache-control')).toContain('no-store');expect(privateRead.text).toContain('Synthetic fresh after expiry');
 }
 const expired=await rendered(route,time+30001);
 expect(expired.headers.get('x-catalog-cache')).toBe('MISS');expect(expired.text).toContain('Synthetic fresh after expiry');
 expect(Number(expired.headers.get('x-catalog-expires-at'))).toBeLessThanOrEqual(time+60001);
 expect(PUBLIC_DATA_CACHE_SECONDS).toBe(30);expect(PUBLIC_PREFETCH_CACHE_SECONDS).toBe(30);expect(PUBLIC_DATA_CACHE_SECONDS+PUBLIC_PREFETCH_CACHE_SECONDS).toBeLessThanOrEqual(60);
 const freshRsc=await rendered(route,time+30001,{rsc:'1',accept:'text/x-component'});expect(freshRsc.status).toBe(200);expect(freshRsc.headers.get('content-type')).toContain('text/x-component');expect(freshRsc.text).toContain('Synthetic fresh after expiry');
});
test('cache-enabled built Worker never stores a failed streamed catalogue render',async({browserName})=>{
 test.skip(browserName!=='chromium','Worker response policy is engine-independent.');
 const time=Date.now(),route='/categoria/synthetic';
 const failed=await rendered(route,time,{'x-fixture-product-query-outage':'true'});
 expect(failed.headers.get('x-catalog-cache')).toBe('BYPASS');expect(failed.headers.get('cache-control')).toContain('no-store');
 expect(failed.status).toBe(503);
 const healthy=await rendered(route,time);expect(healthy.status).toBe(200);expect(healthy.headers.get('x-catalog-cache')).toBe('MISS');expect(healthy.text).toContain('Synthetic visible');
 await cached(route,time);
});
async function noOverflow(page) {
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
}
test('public keyboard search, integer budget filtering, completed counts and narrow/200-percent reflow remain usable',async({page})=>{
 await page.setViewportSize({width:360,height:800});await page.goto(h.baseURL+'/',{waitUntil:'networkidle'});await noOverflow(page);
 const input=page.locator('input[name="q"]:visible').first();await input.focus();await page.keyboard.insertText('synthetic');await page.keyboard.press('Tab');
 await expect(page.locator('button[type="submit"]:visible').first()).toBeFocused();await page.keyboard.press('Enter');
 await page.waitForURL(/\/buscar\?q=synthetic/);await expect(page.locator('[data-catalog-result-count]')).toContainText('2');
 await expect(page.locator('[data-catalog-result-count]')).toHaveAttribute('aria-live','polite');
 await expect(page.locator('#contenido')).toHaveAttribute('aria-busy','false');
 const min=page.getByLabel('Mínimo (Gs.)'),max=page.getByLabel('Máximo (Gs.)');
 await min.focus();await page.keyboard.insertText('100000');await max.focus();await page.keyboard.insertText('10000');
 await page.getByRole('button',{name:'Aplicar presupuesto'}).focus();await page.keyboard.press('Enter');
 await page.waitForURL(url=>url.searchParams.get('min')==='10000'&&url.searchParams.get('max')==='100000');
 await expect(page.locator('[data-catalog-result-count]')).toContainText('1');expect(new URL(page.url()).searchParams.get('q')).toBe('synthetic');
 await noOverflow(page);
 await page.getByRole('button',{name:'Limpiar todo'}).focus();await page.keyboard.press('Enter');
 await expect(page.locator('[data-catalog-result-count]')).toContainText('2');expect(new URL(page.url()).searchParams.get('q')).toBe('synthetic');
 await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>{document.documentElement.style.zoom='2';});await noOverflow(page);
 await expect(page.locator('input[name="q"]:visible').first()).toBeVisible();
});
test('semantic forms, variant selection and gallery dialog support keyboard state and focus return',async({page})=>{
 const warnings=[];page.on('console',message=>{if(message.type()==='error'&&/hydration|cannot be a descendant|nested.*form/i.test(message.text()))warnings.push('invalid-markup');});
 await h.db.exec("INSERT INTO variants(product_id,sku,label,price_pyg,on_hand,is_active) VALUES(1,'SYNTH-ALT','Alternative option',60000,0,1); INSERT INTO product_images(product_id,cloudinary_id,alt,position) VALUES(1,'invalid-fixture-placeholder-one','Synthetic first',0),(1,'invalid-fixture-placeholder-two','Synthetic second',1)");
 await page.goto(h.baseURL+'/producto/synthetic-visible',{waitUntil:'networkidle'});
 await expect(page.locator('h1')).toHaveCount(1);await expect(page.locator('form form')).toHaveCount(0);
 const alternative=page.getByRole('button',{name:'Alternative option',exact:true});await alternative.focus();await page.keyboard.press('Enter');await expect(alternative).toHaveAttribute('aria-pressed','true');
 const opener=page.getByRole('button',{name:/Ampliar imagen/});await opener.focus();await page.keyboard.press('Enter');
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await page.keyboard.press('ArrowRight');await expect(dialog).toContainText('2 / 2');
 await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(opener).toBeFocused();
 const semantic=await page.evaluate(()=>({imagesWithoutAlt:document.querySelectorAll('img:not([alt])').length,unnamedFields:[...document.querySelectorAll('input:not([type="hidden"]),select,textarea')].filter(el=>!el.labels?.length&&!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')&&!['submit','button'].includes(el.type)).length}));
 expect(semantic).toEqual({imagesWithoutAlt:0,unnamedFields:0});expect(warnings).toEqual([]);
});
test('owner forms and real canvas image preparation persist across supported browser engines',async({page})=>{
 const warnings=[];page.on('console',message=>{if(message.type()==='error'&&/hydration|cannot be a descendant|nested.*form/i.test(message.text()))warnings.push('invalid-markup');});
 await page.goto(h.baseURL+'/admin/login',{waitUntil:'networkidle'});await page.getByTestId('admin-login-email').fill('owner@fixture.invalid');await page.getByTestId('admin-login-password').fill(fixturePassword);await page.getByTestId('admin-login-submit').click();
 await page.waitForURL(url=>url.pathname!=='/admin/login');
 await page.goto(h.baseURL+'/admin/productos/1',{waitUntil:'networkidle'});
 const png=await sharp({create:{width:640,height:480,channels:3,background:'#237d48'}}).png().toBuffer();
 await page.locator('input#file').setInputFiles({name:'synthetic-engine.png',mimeType:'image/png',buffer:png});
 await page.locator('input#file').locator('xpath=ancestor::form').getByRole('button',{name:/subir/i}).click();
 await expect.poll(async()=>Number((await h.db.prepare('SELECT COUNT(*) n FROM product_images WHERE product_id=1').first()).n)).toBe(1);
 const saved=await h.db.prepare('SELECT cloudinary_id FROM product_images WHERE product_id=1').first();expect(saved.cloudinary_id).toMatch(/^r2:p1\//);
 await page.reload({waitUntil:'networkidle'});await expect(page.locator('form form')).toHaveCount(0);
 await page.goto(h.baseURL+'/admin/categorias',{waitUntil:'networkidle'});await expect(page.locator('form form')).toHaveCount(0);expect(warnings).toEqual([]);
});

test('actual client prefetch reuse expires within the combined DTO and router freshness window',async({page,context,browserName})=>{
 test.skip(browserName!=='chromium','Client cache lifecycle is exercised once; interaction coverage runs in every supported engine.');
 const epoch=Date.now(),productPath='/producto/synthetic-visible';
 await rendered(productPath,epoch); // Warm the real shared DTO thirty seconds before its expiry.
 let serverClock=epoch+29000;
 await context.route(h.baseURL+'/**',route=>route.continue({headers:{...route.request().headers(),'x-fixture-clock-ms':String(serverClock)}}));
 await page.clock.setFixedTime(new Date(serverClock));
 const productRequests=[];
 page.on('request',request=>{if(new URL(request.url()).pathname===productPath)productRequests.push(request);});
 await page.goto(h.baseURL+'/categoria/synthetic',{waitUntil:'networkidle'});
 const card=()=>page.locator('[data-slug="synthetic-visible"]').first();
 const prefetch=page.waitForResponse(response=>new URL(response.url()).pathname===productPath&&response.request().headers().rsc==='1'&&response.status()===200,{timeout:15000});
 await card().hover();const prefetched=await prefetch;await prefetched.finished();
 await page.evaluate(()=>Promise.resolve());
 const prefetchedRequestCount=productRequests.length;expect(prefetchedRequestCount).toBeGreaterThan(0);
 await h.db.prepare("UPDATE products SET name='Synthetic client cache refreshed' WHERE id=1").run();
 serverClock=epoch+58000;await page.clock.setFixedTime(new Date(serverClock));
 await card().click();await page.waitForURL(url=>url.pathname===productPath);
 await expect(page.getByRole('heading',{level:1})).toHaveText('Synthetic visible');
 expect(productRequests.length,'the full prefetched payload is actually reused before its client expiry').toBe(prefetchedRequestCount);
 await page.goBack();await page.waitForURL(url=>url.pathname==='/categoria/synthetic');
 serverClock=epoch+60001;await page.clock.setFixedTime(new Date(serverClock));
 const refreshed=page.waitForResponse(response=>new URL(response.url()).pathname===productPath&&response.request().headers().rsc==='1'&&response.status()===200,{timeout:15000});
 await card().click();await refreshed;
 await expect(page.getByRole('heading',{level:1})).toHaveText('Synthetic client cache refreshed');
 expect(productRequests.length).toBeGreaterThan(prefetchedRequestCount);
});
