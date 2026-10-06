
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.REALTIME_TEST_BASE||'http://127.0.0.1:3018';
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'no-preference'});
await ctx.addCookies([{name:'disdex_auth',value:'1',url:base}]);
const user={id:'ui-preview-only',email:'preview@example.invalid',displayName:'Preview',role:'user',createdAt:0,lastLogin:0,isApproved:true,isTotpEnabled:false};
await ctx.addInitScript(user=>{localStorage.setItem('jdex_current_user',JSON.stringify(user));localStorage.setItem('jdex_users',JSON.stringify([user]));localStorage.setItem('disdex_auth_user',user.id);
window.__anim=[];const animate=Element.prototype.animate;Element.prototype.animate=function(...args){window.__anim.push({flyer:this.classList.contains('ranking-flyer'),keyframes:args[0]});return animate.apply(this,args);};},user);
let scoreB=60,version=Date.now(),many=false;
function data(){return {ok:true,checkedAt:version,runtimeSha:'8ed7c2266af33758b0a0f301aefc2457a7a7eab6',metric:'fixture',errors:{},rows:(many?Array.from({length:20},(_,i)=>['R'+String(i).padStart(2,'0'),i===19?scoreB:80-i]):[['A',80],['B',scoreB],['C',40]]).map(([id,score])=>({id,symbol:id+'USDT',logic:'V12',side:'LONG',score,gates:[],reason:'fixture',fresh:true,checkedAt:version}))};}
await ctx.route('**/*',async r=>{if(!['GET','HEAD'].includes(r.request().method()))return r.abort();if(r.request().url().includes('/api/auth/users'))return r.fulfill({json:{success:true,users:[user]}});if(r.request().url().includes('/api/system/realtime-ranking'))return r.fulfill({json:data()});return r.continue();});
const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(base+'/realtime',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.querySelectorAll('[data-ranking-row]').length===3);
console.log('BEFORE',await page.locator('[data-ranking-row]').allTextContents());
scoreB=95;version+=1000;
await page.getByRole('button',{name:/^更新 ·/}).click();
await page.waitForFunction(()=>document.querySelector('[data-ranking-row=B]')?.textContent?.includes('95'));
console.log('AFTER',await page.locator('[data-ranking-row]').allTextContents());
console.log('ANIMATIONS',await page.evaluate(()=>window.__anim));
const moved=await page.evaluate(()=>window.__anim.filter(x=>x.flyer).length);console.log('MOVING_ELEMENTS',moved);if(moved!==4)throw Error('Expected both moving rows and both top cards to animate; got '+moved);if(errors.length)throw Error(errors.join(';'));

await page.waitForFunction(()=>!document.querySelector('.ranking-flyer'));
async function change(nextScore){
 await page.evaluate(()=>{window.__anim=[];});scoreB=nextScore;version+=1000;
 await page.getByRole('button',{name:/^更新 ·/}).click();
 await page.getByRole('button',{name:/^更新 ·/}).waitFor();
 return page.evaluate(()=>window.__anim.filter(x=>x.flyer).length);
}
if(await change(95)!==0)throw Error('Unchanged ranking animated');
await page.getByRole('button',{name:'動き ON',exact:true}).click();
if(await change(60)!==0)throw Error('Motion OFF animated');
await page.getByRole('button',{name:'動き OFF',exact:true}).click();
await page.emulateMedia({reducedMotion:'reduce'});
if(await change(95)!==0)throw Error('Reduced motion animated');
await page.emulateMedia({reducedMotion:'no-preference'});
if(await change(60)!==4)throw Error('Reverse swap did not animate both rows/cards');
await page.waitForFunction(()=>!document.querySelector('.ranking-flyer'));
if(await page.locator('[data-ranking-row],[data-ranking-leader]').evaluateAll(ns=>ns.some(n=>n.style.opacity==='0')))throw Error('Original element left hidden');
many=true;await change(61);
await page.waitForFunction(()=>document.querySelectorAll('[data-ranking-row]').length===20);
const cross=await change(95);
if(cross!==22)throw Error('Cross-column swap expected 20 rows + 2 existing leader cards; got '+cross);
await page.waitForFunction(()=>!document.querySelector('.ranking-flyer'));
await page.getByRole('textbox',{name:'通貨を検索'}).fill('R19');
if(await change(50)!==0)throw Error('Filter manufactured an animation origin');
await page.setViewportSize({width:390,height:844});
if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile horizontal overflow');
console.log('SWAP_4_STABLE_OFF_REDUCED_REVERSE_CROSS22_FILTER_MOBILE_PASS');
await browser.close();
})().catch(e=>{console.error(e.stack);process.exit(1)});
