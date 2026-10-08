
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.REALTIME_TEST_BASE||'http://127.0.0.1:3018';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
 try{
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'no-preference'});
 await ctx.addCookies([{name:'disdex_auth',value:'1',url:base}]);
 const user={id:'ui-preview-only',email:'preview@example.invalid',displayName:'Preview',role:'user',createdAt:0,lastLogin:0,isApproved:true,isTotpEnabled:false};
 await ctx.addInitScript(user=>{
  localStorage.setItem('jdex_current_user',JSON.stringify(user));localStorage.setItem('jdex_users',JSON.stringify([user]));localStorage.setItem('disdex_auth_user',user.id);
  window.__anim=[];const original=Element.prototype.animate;
  Element.prototype.animate=function(frames,options){
   if(this.classList.contains('ranking-flyer'))window.__anim.push({id:this.dataset.rankingCurrency,at:performance.now(),duration:options.duration,frames});
   return original.call(this,frames,options);
  };
 },user);
 let scores=[80,60,40],version=Date.now();
 const data=()=>({ok:true,checkedAt:version,runtimeSha:'fixture',metric:'fixture',errors:{},rows:['A','B','C'].map((id,i)=>({id,symbol:id+'USDT',logic:'V12',side:'LONG',score:scores[i],gates:[],reason:'fixture',fresh:true,checkedAt:version}))});
 await ctx.route('**/*',async r=>{
  if(!['GET','HEAD'].includes(r.request().method()))return r.abort();
  if(r.request().url().includes('/api/auth/users'))return r.fulfill({json:{success:true,users:[user]}});
  if(r.request().url().includes('/api/system/realtime-ranking'))return r.fulfill({json:data()});
  return r.continue();
 });
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/realtime',{waitUntil:'domcontentloaded',timeout:180000});
 await page.waitForFunction(()=>document.querySelectorAll('[data-ranking-row]').length===3);
 async function update(values){scores=values;version+=1000;await page.getByRole('button',{name:/^更新 ·/}).click();}
 await update([80,90,95]);
 await page.waitForFunction(()=>document.querySelector('[data-ranking-moving=true]'));
 const first=await page.evaluate(()=>[...new Set([...document.querySelectorAll('[data-ranking-moving=true]')].map(n=>n.dataset.rankingCurrency))]);
 if(first.length!==1)throw Error('Multiple currencies moving concurrently: '+first);
 await page.waitForFunction(()=>document.querySelector('[data-ranking-completed=true]'));
 const retained=await page.evaluate(()=>[...document.querySelectorAll('[data-ranking-completed=true]')].every(n=>getComputedStyle(n).outlineStyle==='solid'&&getComputedStyle(n).outlineWidth==='2px'));
 if(!retained)throw Error('Completed currency outline missing before last landing');
 await update([99,90,95]);
 if((await page.locator('[data-ranking-row=A]').textContent()).includes('99'))throw Error('Update interrupted current batch');
 await page.waitForFunction(()=>document.querySelector('[data-ranking-row=A]')?.textContent?.includes('99'),{timeout:25000});
 await page.waitForFunction(()=>!document.querySelector('.ranking-flyer'),{timeout:25000});
 const animations=await page.evaluate(()=>window.__anim);
 const groups=[];for(const a of animations){if(groups.at(-1)?.id!==a.id)groups.push(a);}
 if(groups.length<3)throw Error('Expected multiple serial currency steps');
 for(let i=1;i<groups.length;i++)if(groups[i].at-groups[i-1].at<groups[i-1].duration-100)throw Error('Steps overlap');
 if(animations.some(a=>a.duration!==3600))throw Error('Expected slower 3600ms currency motion');
 if(await page.locator('.rank-batch-completed').count())throw Error('Outlines remained after final landing');
 if(await page.locator('[data-ranking-row],[data-ranking-leader]').evaluateAll(ns=>ns.some(n=>n.style.opacity==='0')))throw Error('Original left hidden');
 await page.evaluate(()=>window.__anim=[]);
 await update([99,90,95]);if(await page.evaluate(()=>window.__anim.length))throw Error('Unchanged ranks animated');
 await update([80,90,95]);await page.waitForFunction(()=>document.querySelector('[data-ranking-moving=true]'));
 await page.getByRole('button',{name:'動き ON',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.ranking-flyer'));
 await update([99,90,95]);if(await page.locator('.ranking-flyer').count())throw Error('Motion OFF animated');
 await page.getByRole('button',{name:'動き OFF',exact:true}).click();
 await page.emulateMedia({reducedMotion:'reduce'});
 await update([80,90,95]);if(await page.locator('.ranking-flyer').count())throw Error('Reduced motion animated');
 await page.emulateMedia({reducedMotion:'no-preference'});
 await update([99,90,95]);await page.waitForFunction(()=>document.querySelector('.ranking-flyer'));
 await page.getByRole('textbox',{name:'通貨を検索'}).fill('A');
 await page.waitForFunction(()=>!document.querySelector('.ranking-flyer'));
 await page.setViewportSize({width:390,height:844});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile horizontal overflow');
 if(errors.length)throw Error(errors.join(';'));
 console.log('SERIAL_3600MS_RETAINED_OUTLINES_FINAL_CLEANUP_QUEUED_UPDATE_OFF_REDUCED_FILTER_MOBILE_PASS');
 console.log(JSON.stringify(groups.map(({id,at,duration})=>({id,at:Math.round(at),duration}))));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1)});
