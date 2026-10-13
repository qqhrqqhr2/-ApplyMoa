/* Long operations live in the dashboard tab, not the MV3 service worker. */
(function () {
  "use strict";
  const C = globalThis.FWA;
  const FIRST_LOAD_TIMEOUT=20000, PAGE_READ_TIMEOUT=12000;
  class Runner {
    constructor(state, update, restoring=true) {
      this.state = state;
      this.update = update;
      this.busy = false;
      this.batchBusy = false;
      this.cancelled = false;
      this.frames = new Map();
      this.owned = new Set();
      this.persistChain = Promise.resolve();
      this.searchWorkers = new Map();
      this.applicationWorkers = new Map();
      this.historyWorkers = new Map();
      this.historyTasks = new Map();
      this.applicationBindings = new Map();
      this.applyLocks = new Map();
      this.dashboardContext=chrome.tabs.getCurrent().catch(()=>null);
      chrome.runtime.onMessage.addListener((m,sender) => {
        if(m?.type==='FWA_APPLY_COMPLETE'&&sender.id===chrome.runtime.id&&sender.tab?.id){
          const attempt=this.state.attempts[m.key];
          if(attempt&&['submitting','unknown'].includes(attempt.status)&&attempt.token===m.token&&attempt.tabId===sender.tab.id&&attempt.frameId===(sender.frameId||0)){
            this.completed(attempt.job,'지원 완료 팝업 표시 확인');
            this.save().catch(()=>{});
          }
        }

        if (m?.type === "FWA_HELLO" && sender.id === chrome.runtime.id && sender.tab?.id && C.siteOf(sender.url || sender.tab.url)) {
          const f = this.frames.get(sender.tab.id) || new Set([0]);
          f.add(sender.frameId || 0);
          this.frames.set(sender.tab.id,f);
        }
      });
      chrome.tabs.onUpdated.addListener((id,change) => {
        if (change.status === "loading") this.frames.set(id,new Set([0]));
      });
      chrome.tabs.onRemoved.addListener(id=>{this.frames.delete(id);this.owned.delete(id);});
      chrome.tabs.onCreated.addListener(tab=>{
        if (this.owned.has(tab.openerTabId)) {
          this.owned.add(tab.id);
          if (this.state.run?.job) this.state.run.tabs = [...new Set([...(this.state.run.tabs||[]),tab.id])];
          if(this.state.settings.autoApply&&this.active)this.returnToDashboard().catch(()=>{});
        }
      });
      if (restoring && ["running","scanning"].includes(state.run?.status)) state.run.status = "paused";
      for (const attempt of Object.values(state.attempts)) if (restoring && attempt.status === "submitting") {
        attempt.status = "unknown";
        attempt.reason = "작업 화면이 닫혔습니다. 지원 현황에서 결과를 확인해 주세요.";
      }
      if(restoring&&state.run?.parallel&&state.run.status==='paused'){state.run.status='done';state.run.reason='작업 화면이 닫혀 동시 지원을 중단했습니다. 제출 결과를 확인하고 남은 공고를 다시 선택해 주세요.';for(const task of state.run.tasks||[])if(task.status==='running')task.status='stopped';}
      // Saved numeric tab IDs may be reused after Chrome restarts. Do not claim ownership.
    }
    save() {
      this.update();
      // One queued write serves every save() made before it starts; it snapshots the
      // state when it runs, so it always includes the caller's changes. A failed write
      // is reported to its callers but does not block later writes.
      if(!this.pendingSave){
        const write=this.persistChain.catch(()=>{}).then(()=>{
          if(this.pendingSave===write)this.pendingSave=null;
          return chrome.storage.local.set({fwaState:JSON.parse(JSON.stringify(this.state))});
        });
        this.pendingSave=write;this.persistChain=write;
      }
      return this.pendingSave;
    }
    log(message) {
      this.state.logs.unshift({time:new Date().toISOString(),message});
      this.state.logs = this.state.logs.slice(0,200);
    }
    check() {if (this.cancelled) throw new Error("사용자가 작업을 중지했습니다.");}
    async delay(ms) {
      for(let remaining=ms;remaining>0;remaining-=250) {
        this.check();
        await new Promise(r=>setTimeout(r,Math.min(250,remaining)));
      }
    }
    async command(tabId,command,data={},frameId=0) {
      this.check();
      if(command==='prepareSearch'||command==='collect'&&data.kind==='search'||command==='diagnostics')data={...data,filters:C.searchFilters(this.state.settings)};
      const applicationKey=data.job&&this.applicationBindings.get(data.job.key)?.get(tabId);
      if(applicationKey&&command!=='identifyApplication')data={...data,applicationKey};
      return chrome.tabs.sendMessage(tabId,{type:"FWA_COMMAND",command,...data},{frameId});
    }
    get active() {return this.busy || this.batchBusy || this.historyTasks.size>0;}
    async waitReady(id,expectedUrl,options={}) {
      const until=options.deadline||Date.now()+25000;
      while(Date.now()<until) {
        this.check();
        const tab=await chrome.tabs.get(id);
        if (tab.url && !C.siteOf(tab.url) && tab.status === "complete" && !tab.url.startsWith("about:")) throw new Error("대상 사이트 밖으로 이동했습니다. 직접 확인해 주세요.");
        try {
          const reply=await this.readWithin(this.command(id,"ping"),until);
          let atExpected=true;
          if(expectedUrl) {
            const expected=new URL(expectedUrl);const actual=new URL(tab.url);
            atExpected=expected.origin===actual.origin && expected.pathname.toLowerCase().replace(/\/$/,"")===actual.pathname.toLowerCase().replace(/\/$/,"") && [...expected.searchParams].every(([key,value])=>actual.searchParams.getAll(key).includes(value));
          }
          // Search pages may keep loading ads and images long after the list is drawn.
          const loaded=tab.status==="complete"||options.domReady&&reply.readyState&&reply.readyState!=="loading";
          if(reply.ok && loaded && atExpected) {
            if(reply.protocolVersion!==C.contentProtocol)throw Object.assign(new Error('사이트 탭에 이전 버전이 연결되어 있습니다. 사람인·잡코리아 탭을 새로고침한 뒤 다시 실행해 주세요.'),{connectionError:true});
            // Broadcast once so content scripts in supported embedded frames announce themselves.
            chrome.tabs.sendMessage(id,{type:"FWA_COMMAND",command:"announce"}).catch(()=>{});
            if(!options.deadline)await this.delay(700);
            return tab;
          }
        } catch (e) {this.check();if(e.connectionError)throw e;}
        await this.delay(Math.min(200,Math.max(0,until-Date.now())));
      }
      throw Object.assign(new Error("사이트 로딩 또는 확장 프로그램 연결에 실패했습니다."),{retryable:true});
    }
    async readWithin(promise,deadline) {
      let timer;
      try{return await Promise.race([promise,new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(Object.assign(new Error('페이지 로딩·연결이 제한 시간 안에 완료되지 않았습니다.'),{retryable:true})),Math.max(0,deadline-Date.now()));
      })]);}finally{clearTimeout(timer);}
    }
    // A fresh search tab opened in the background can take well over 5s to finish loading
    // (100 postings, images, ads). Give the first load and each page read realistic limits.
    async retrySearchPage(tabId,read,timeout=PAGE_READ_TIMEOUT) {
      for(let attempt=0;attempt<3;attempt++){
        this.check();
        try{const deadline=Date.now()+timeout;return await this.readWithin(read(deadline),deadline);}
        catch(error){
          this.check();
          const transient=error.retryable===true||/receiving end|connection|message port|could not establish/i.test(error.message||'');
          if(!transient||error.connectionError)throw error;
          if(attempt===2)throw Object.assign(new Error(error.message+` · ${Math.round(timeout/1000)}초씩 3번 기다렸지만 실패했습니다. 사이트 탭이 열리는지 확인한 뒤 이어서 수집할 수 있습니다.`),{retryable:true,pageRetriesExhausted:true});
          // Reloading a page that is still loading only restarts it; keep waiting instead.
          const current=await chrome.tabs.get(tabId).catch(()=>null);
          if(!current)throw Object.assign(new Error('수집 중인 사이트 탭이 닫혔습니다. 이어서 수집을 눌러 주세요.'),{retryable:true});
          this.log((C.sites[C.siteOf(current.url)]?.label||'채용사이트')+' · 페이지 로딩 '+(current.status==='loading'?'대기 연장 ':'재시도 ')+(attempt+1)+' / 2');
          if(current.status!=='loading')await chrome.tabs.reload(tabId);
        }
      }
    }
    async readSearchPage(tabId,options={}) {
      return this.retrySearchPage(tabId,async deadline=>{
        await this.waitReady(tabId,options.expectedUrl,{deadline,domReady:true});
        let result=options.initialResult;options.initialResult=null;
        do{
          this.check();
          if(options.validate)await options.validate(await chrome.tabs.get(tabId));
          result=result||await this.readWithin(this.command(tabId,'collect',{kind:'search'}),deadline);
          if(result?.ok&&(!options.previousSignature||result.signature!==options.previousSignature))return result;
          if(!result?.ok&&!result?.retryable)throw new Error(result?.reason||'공고 목록을 읽을 수 없습니다.');
          result=null;
          await this.delay(Math.min(200,Math.max(0,deadline-Date.now())));
        }while(Date.now()<deadline);
        throw Object.assign(new Error('공고 목록의 로딩이 제한 시간 안에 완료되지 않았습니다.'),{retryable:true});
      });
    }
    async open(url,active=true) {
      if(!C.siteOf(url)) throw new Error("지원하는 사이트 주소가 아닙니다.");
      const tab=await chrome.tabs.create({url,active});
      this.owned.add(tab.id);
      return tab;
    }
    async focus(id) {
      try {const tab=await chrome.tabs.update(id,{active:true});await chrome.windows.update(tab.windowId,{focused:true});} catch (_) { /* closed by user */ }
    }
    async returnToDashboard(){
      if(!this.state.settings.autoApply)return;
      const tab=await this.dashboardContext;if(!tab?.id)return;
      try{await chrome.tabs.update(tab.id,{active:true});await chrome.windows.update(tab.windowId,{focused:true});}catch(_){}
    }
    async openHistory(site) {
      const tabs=await chrome.tabs.query({url:["https://*."+site+".co.kr/*"]});
      const existing=tabs.filter(t=>C.isHistory(t.url,site)).sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0))[0];
      if(existing){await this.focus(existing.id);return existing;}
      return this.open(C.sites[site].historyUrl);
    }
    historyBusy(site) {return this.historyTasks.has(site);}
    canCollectHistory(site) {
      return !this.busy&&!this.batchBusy&&!(this.cancelled&&this.historyTasks.size)&&(!site||!this.historyBusy(site));
    }
    async scanHistory(site) {
      if(this.historyTasks.has(site))return this.historyTasks.get(site).promise;
      if(!this.canCollectHistory(site))return;
      if(!this.historyTasks.size){this.historyReturnRun=this.state.run.status==='paused'&&this.state.run.queue?this.state.run:null;this.cancelled=false;}
      let worker=this.historyWorkers.get(site);
      if(!worker){
        worker=new Runner({...this.state,run:{status:'idle'}},()=>{},false);
        worker.log=message=>this.log(message);
        worker.check=()=>{this.check();if(worker.cancelled)throw new Error('사용자가 작업을 중지했습니다.');};
        worker.save=async()=>{this.state.histories[site]=worker.state.histories[site];return this.save();};
        this.historyWorkers.set(site,worker);
      }
      worker.cancelled=false;
      worker.state={...this.state,histories:{[site]:this.state.histories[site]},run:{status:'idle'}};
      const task={worker,promise:null};this.historyTasks.set(site,task);
      this.state.run={status:'scanning',kind:'history',site:this.historyTasks.size>1?'all':site};
      task.promise=(async()=>{
        try{await this.save();await worker.scan('history',site);}
        finally{
          this.historyTasks.delete(site);
          if(this.historyTasks.size)this.state.run={status:'scanning',kind:'history',site:[...this.historyTasks.keys()][0]};
          else{this.state.run=this.historyReturnRun||{status:'idle'};this.historyReturnRun=null;}
          await this.save();
        }
      })();
      return task.promise;
    }
    async scanHistoryAll() {
      if(!this.canCollectHistory())return;
      return Promise.allSettled(this.state.settings.sites.map(site=>this.scanHistory(site)));
    }
    async scanSearchAll(only) {
      if(this.active)return;
      if(!C.titleTerms(this.state.settings.keyword).length)throw new Error('검색어를 입력해 주세요.');
      const sites=this.state.settings.sites.filter(site=>!only||only.includes(site));
      if(!sites.length)return;
      this.batchBusy=true;this.cancelled=false;
      this.state.run={status:'scanning',kind:'search',site:sites.length>1?'all':sites[0]};
      try{
        await this.save();
        const reads=await Promise.allSettled(sites.map(site=>{
          let worker=this.searchWorkers.get(site);
          if(!worker){
            worker=new Runner({...this.state,run:{status:'idle'}},()=>{},false);
            worker.log=message=>this.log(message);
            worker.check=()=>{this.check();if(worker.cancelled)throw new Error('사용자가 작업을 중지했습니다.');};
            worker.save=async()=>{
              this.state.scans[site]=worker.state.scans[site];
              this.state.jobs=C.uniqueJobs([...this.state.jobs.filter(job=>job.site!==site),...worker.state.jobs.filter(job=>job.site===site)]);
              return this.save();
            };
            this.searchWorkers.set(site,worker);
          }
          worker.state={...this.state,settings:{...this.state.settings,sites:[site]},jobs:this.state.jobs.filter(job=>job.site===site),scans:{[site]:this.state.scans[site]},run:{status:'idle'}};
          worker.cancelled=false;
          return worker.scanSearchSequential();
        }));
        for(const [index,result] of reads.entries())if(result.status==='rejected'){
          const site=sites[index],reason=result.reason?.message||'공고 수집에 실패했습니다.';
          this.state.scans[site]={...this.state.scans[site],status:'paused',reason};
          this.log(C.sites[site].label+' · '+reason);
        }
      }finally{
        this.batchBusy=false;this.state.run={status:'idle'};await this.save();
      }
    }
    async scanSearchSequential() {
      if(this.active)return;
      this.batchBusy=true;this.cancelled=false;
      try{
        const keywords=C.titleTerms(this.state.settings.keyword);
        if(!keywords.length)throw new Error('검색어를 입력해 주세요.');
        for(const site of this.state.settings.sites){
          if(this.cancelled)break;
          const previous=this.state.scans[site];
          if(previous?.status==='ready'&&previous.keyword===this.state.settings.keyword)continue;
          const sameSearch=previous?.keyword===this.state.settings.keyword&&previous.filterKey===C.searchFilterKey(this.state.settings);
          const terms=sameSearch?{...(previous.termScans||{})}:{};
          if(keywords.length===1&&previous&&!previous.termScans&&previous.keyword===keywords[0])terms[keywords[0]]=previous;
          // Merged postings of every keyword read so far. Finished keywords keep only counts.
          let collected=sameSearch||terms[keywords[0]]===previous?[...(previous?.jobs||[])]:[];
          for(let index=0;index<keywords.length;index++){
            if(this.cancelled)break;
            const keyword=keywords[index];
            if(terms[keyword]?.status==='ready')continue;
            this.state.scans[site]=terms[keyword];
            this.log(C.sites[site].label+' · 검색어 '+(index+1)+' / '+keywords.length+' · '+keyword);
            for(let retry=0;retry<3;retry++){
              await this.scan('search',site,{keyword,autoRetry:retry<2});
              const scan=this.state.scans[site];
              if(scan?.status!=='paused'||!scan.retryableFailure||scan.needsRestart||this.cancelled)break;
              if(retry<2){this.log(C.sites[site].label+' · 일시적인 수집 오류, 자동 재시도 '+(retry+1)+' / 2');await this.delay(1500*(retry+1));}
            }
            terms[keyword]=this.state.scans[site];
            const metas=keywords.map(word=>terms[word]).filter(Boolean);
            const complete=keywords.every(word=>terms[word]?.status==='ready');
            collected=C.uniqueJobs([...collected,...(terms[keyword]?.jobs||[])]);
            // A paused keyword keeps its own list so it can resume; finished ones are compacted.
            for(const word of keywords)if(terms[word]?.status==='ready'&&terms[word].jobs)terms[word]=C.compactScan({...terms[word]});
            this.state.scans[site]={...terms[keyword],keyword:this.state.settings.keyword,termScans:{...terms},jobs:collected,pages:metas.reduce((sum,meta)=>sum+(meta.pages||0),0),status:complete?'ready':terms[keyword]?.status==='paused'?'paused':'scanning',reason:complete?keywords.length+'개 검색어 수집 완료':keyword+' · '+(terms[keyword]?.reason||'수집 중')};
            delete this.state.scans[site].jobCount;
            await this.save();
            if(terms[keyword]?.status!=='ready')break;
          }
        }
      }finally{this.batchBusy=false;await this.save();}
    }
    async readSearchPages(source, pages, temporaryTabs) {
      const base=new URL(source.url);const first=Number(base.searchParams.get('Page_No')||1);
      const plans=pages.slice(0,Math.ceil(C.searchBatchSize/20)-1);
      for(const [index,plan] of plans.entries()){
        if(plan.page!==first+index+1||C.siteOf(plan.url)!=='jobkorea'||!C.sameSearch(source.url,plan.url)||Number(new URL(plan.url).searchParams.get('Page_No'))!==plan.page)throw new Error('검색 조건 또는 페이지 순서가 다른 동시 수집 주소입니다.');
      }
      const reads=await Promise.allSettled(plans.map(async plan=>{
        let tab;
        try{
          this.check();tab=await this.open(plan.url,false);temporaryTabs.add(tab.id);
          const result=await this.readSearchPage(tab.id,{expectedUrl:plan.url,validate:actual=>{
            if(!C.sameSearch(source.url,actual.url)||Number(new URL(actual.url).searchParams.get('Page_No'))!==plan.page)throw new Error('동시 수집 중 검색 조건 또는 페이지가 바뀌었습니다.');
          }});
          if(result.page!==plan.page)throw new Error(`${plan.page}페이지 대신 다른 페이지가 표시되었습니다.`);
          return {tab,result,page:plan.page};
        }catch(error){return {tab,error,page:plan.page};}
      }));
      return reads.map((read,index)=>read.status==='fulfilled'?read.value:{page:plans[index].page,error:read.reason});
    }
    async scan(kind,site,options={}) {
      if(this.busy) return;
      this.busy=true; this.cancelled=false;
      let meta;
      const temporaryTabs=new Set();
      const returnRun=this.state.run.status==="paused" && this.state.run.queue ? this.state.run : null;
      const holder=kind==="history"?this.state.histories:this.state.scans;
      try {
        if(kind==="search" && !C.clean(this.state.settings.keyword))throw new Error("원하는 검색어를 입력하고 설정을 저장해 주세요.");
        meta=holder[site];
        if(kind==='search'&&meta?.pages&&meta.filterKey!==C.searchFilterKey(this.state.settings)){
          meta.needsRestart=true;throw new Error('기업·고용 형태 설정이 바뀌었습니다. 공고를 다시 수집해 주세요.');
        }
        let tab;
        if(!options.automatic && meta?.status==="paused" && meta.tabId && !meta.needsRestart) {
          try {tab=await chrome.tabs.get(meta.tabId);} catch (_) { /* recreate */ }
        }
        if(!tab) {
          tab=await this.open(kind==='history'?C.sites[site].historyUrl:C.sites[site].searchUrl(options.keyword||this.state.settings.keyword,this.state.settings),false);
          meta={status:"scanning",jobs:[],pages:0,seen:[],tabId:tab.id,keyword:options.keyword||this.state.settings.keyword};
          holder[site]=meta;
        }
        meta.status="scanning"; meta.reason="";meta.reviewed=false;meta.retryableFailure=false;
        meta.rowsRead ??= meta.pages?meta.jobs.length:0;
        this.state.run={status:"scanning",kind,site};
        await this.save();
        if(kind==='search')await this.retrySearchPage(tab.id,deadline=>this.waitReady(tab.id,undefined,{deadline,domReady:true}),FIRST_LOAD_TIMEOUT);
        else await this.waitReady(tab.id);
        if(kind==='history'){
          const range=options.range||meta.period||C.historyRange();
          if(meta.pages&&meta.periodVerified&&meta.paginationVersion===2){
            const period=await this.command(tab.id,'historyPeriod',{range});
            if(!period?.ok){meta.needsRestart=true;throw new Error(period?.reason||'지원 이력 조회기간이 바뀌었습니다. 최근 2개월을 다시 수집해 주세요.');}
          }else{
            const prepared=await this.command(tab.id,'prepareHistory',{range});
            if(!prepared?.ok)throw new Error(prepared?.reason||'최근 2개월 조회 설정에 실패했습니다. 사이트 탭을 새로고침해 주세요.');
            if(!prepared.ready){
              await this.waitReady(tab.id);const until=Date.now()+20000;let verified;
              while(Date.now()<until){
                this.check();try{verified=await this.command(tab.id,'historyPeriod',{range,previousDocument:prepared.documentToken});if(verified?.ok)break;}catch(_){this.check();}
                await this.delay(500);
              }
              if(!verified?.ok)throw new Error(verified?.reason||'최근 2개월 조회 결과를 확인하지 못했습니다.');
            }
          }
          meta.period=range;meta.periodVerified=true;meta.paginationVersion=2;
        }
        if(kind==='search'){
          const prepared=await this.command(tab.id,'prepareSearch',{resume:meta.pages>0});
          if(!prepared?.ok){if(prepared?.restart)meta.needsRestart=true;throw new Error(prepared?.reason||'검색 조건을 설정하지 못했습니다. 사이트 탭을 새로고침해 주세요.');}
          if(prepared.policyVersion!==C.searchPolicyVersion)throw new Error('사이트 탭에 이전 버전이 연결되어 있습니다. 사이트 탭을 새로고침한 뒤 다시 수집해 주세요.');
          meta.policyVersion=C.searchPolicyVersion;
          meta.filterKey=C.searchFilterKey(this.state.settings);
          meta.batchSize=C.searchBatchSize;
          meta.collectionMode=site==='saramin'?'100개씩 표시':'20개씩 · 최대 5페이지 동시 수집';
          if(site==='jobkorea')meta.sourceUrl||=(await chrome.tabs.get(tab.id)).url;
        }
        let pendingResult;let pendingPages=[];
        while(true) {
          this.check();
          if(kind==='history'){const period=await this.command(tab.id,'historyPeriod',{range:meta.period});if(!period?.ok){meta.needsRestart=true;throw new Error(period?.reason||'지원 이력 조회기간이 바뀌었습니다.');}}
          if(kind==='search'){
            if(meta.filterKey!==C.searchFilterKey(this.state.settings))throw new Error('기업·고용 형태 설정이 바뀌었습니다. 공고를 다시 수집해 주세요.');
            const currentTab=await chrome.tabs.get(tab.id);const u=new URL(currentTab.url);
            if(!C.isSearch(u.href,site)||C.clean(u.searchParams.get(site==='saramin'?'searchword':'stext'))!==C.clean(meta.keyword))throw new Error('검색어 또는 검색 화면이 바뀌어 수집을 중지했습니다.');
            if(site==='jobkorea'&&!C.sameSearch(meta.sourceUrl,u.href))throw new Error('잡코리아 검색 조건이 바뀌어 수집을 중지했습니다.');
          }
          let result=kind==='search'?await this.readSearchPage(tab.id,{initialResult:pendingResult}):pendingResult || await this.command(tab.id,"collect",{kind});pendingResult=null;
          const loadUntil=Date.now()+16000;
          while(kind!=='search' && result?.retryable && Date.now()<loadUntil) {
            await this.delay(500);
            result=await this.command(tab.id,"collect",{kind});
          }
          while(kind==='history'&&result?.ok&&result.pagination?.verified===false&&Date.now()<loadUntil){
            await this.delay(500);
            result=await this.command(tab.id,"collect",{kind});
          }
          if(!result?.ok) {
            // Keep verified entries, but never mark an incomplete page reviewed.
            if(kind==="history" && result?.code==="HISTORY_FIELDS") {
              meta.jobs=C.uniqueJobs([...meta.jobs,...result.jobs]);
              meta.unreadCount=result.unreadCount;
              meta.currentPage=result.page;
              meta.dateHints=result.dateHints;
            }
            throw Object.assign(new Error(result?.reason || "목록을 읽을 수 없습니다."),{retryable:result?.retryable===true,code:result?.code});
          }
          meta.unreadCount=0;
          if(kind==='search'&&result.policyVersion!==C.searchPolicyVersion)throw new Error('사이트 탭에 이전 버전이 연결되어 있습니다. 사이트 탭을 새로고침한 뒤 다시 수집해 주세요.');
          if(kind==='history'&&!result.pagination)throw new Error('사이트 탭에 이전 버전이 연결되어 있습니다. 사람인·잡코리아 탭을 새로고침한 뒤 다시 수집해 주세요.');
          if(!meta.pages && result.page!==1) throw new Error("전체 목록을 읽으려면 사이트의 1페이지에서 수집을 시작해 주세요. 조회기간은 그대로 유지해 주세요.");
          if(meta.seen.includes(result.signature) && meta.lastSignature !== result.signature) throw new Error("이전에 읽은 페이지가 다시 나타나 수집을 중지했습니다.");
          const lastReadPage=meta.lastReadPage||meta.pages;
          if(meta.pages&&result.signature===meta.lastSignature&&result.page!==lastReadPage)throw new Error('다른 페이지에서 같은 공고 목록이 표시되어 수집을 중지했습니다.');
          if(meta.pages && result.signature!==meta.lastSignature && result.page!==lastReadPage+1)throw new Error(`페이지를 건너뛴 상태입니다. ${lastReadPage+1}페이지에서 이어서 수집해 주세요.`);
          if(!meta.seen.includes(result.signature)) {meta.seen.push(result.signature);meta.pages++;meta.rowsRead=(meta.rowsRead||0)+result.jobs.length;}
          meta.lastSignature=result.signature;
          meta.lastReadPage=result.page;
          meta.jobs=C.uniqueJobs([...meta.jobs,...result.jobs]);
          meta.dateHints=result.dateHints;
          meta.currentPage=result.page;
          if(kind==="search") this.state.jobs=C.uniqueJobs([...this.state.jobs,...result.jobs]);
          this.log(C.sites[site].label+" · "+(kind==="history"?"지원 이력":"공고")+" "+result.page+"페이지, 누적 "+meta.jobs.length+"건");
          await this.save();
          if(!result.hasNext){
            if(kind==='history'&&result.pagination?.verified===false)throw new Error(result.pagination.reason||'지원 이력의 마지막 페이지를 확인하지 못했습니다.');
            if(kind==='history'&&Number.isInteger(result.pagination?.totalCount)&&meta.rowsRead<result.pagination.totalCount)throw new Error(`사이트의 총 ${result.pagination.totalCount}건 중 ${meta.rowsRead}건만 읽었습니다. 다음 페이지를 확인하고 이력 이어 수집을 누르세요.`);
            break;
          }
          if(kind==='search'&&site==='jobkorea'&&!pendingPages.length&&result.search?.batchPages?.length){
            this.log(`잡코리아 · ${result.page+1}페이지부터 최대 5페이지를 함께 읽습니다.`);
            if(this.owned.has(tab.id))temporaryTabs.add(tab.id);
            await this.delay(2500);
            pendingPages=await this.readSearchPages(await chrome.tabs.get(tab.id),result.search.batchPages,temporaryTabs);
          }
          if(pendingPages.length){
            const entry=pendingPages.shift();const previous=tab;
            if(entry.tab){tab=entry.tab;meta.tabId=tab.id;}
            if(previous.id!==tab.id&&temporaryTabs.has(previous.id)){
              await chrome.tabs.remove(previous.id).catch(()=>{});temporaryTabs.delete(previous.id);
            }
            if(entry.error)throw Object.assign(new Error(`잡코리아 ${entry.page}페이지 · ${entry.error.message}`),{retryable:entry.error.retryable,pageRetriesExhausted:entry.error.pageRetriesExhausted});
            pendingResult=entry.result;continue;
          }
          await this.delay(kind==='search'?2500:Math.max(2500,this.state.settings.delay*1000));
          const next=await this.command(tab.id,"next",{kind});
          if(!next.ok) throw new Error(next.reason);
          if(next.end) break;
          if(next.navigationUrl) {
            if(kind!=="search" || !C.isSearch(next.navigationUrl,site))throw new Error("다음 검색 페이지 주소를 확인할 수 없습니다.");
            const target=new URL(next.navigationUrl);
            if(C.clean(target.searchParams.get(site==="saramin"?"searchword":"stext"))!==C.clean(meta.keyword))throw new Error("검색어가 다른 페이지로 이동하려 해 수집을 중지했습니다.");
            if(site==='jobkorea'&&!C.sameSearch(meta.sourceUrl,next.navigationUrl))throw new Error('검색 조건이 다른 페이지로 이동하려 해 수집을 중지했습니다.');
            await chrome.tabs.update(tab.id,{url:next.navigationUrl});
          }
          if(kind==='search'){
            pendingResult=await this.readSearchPage(tab.id,{expectedUrl:next.navigationUrl,previousSignature:result.signature});
            continue;
          }
          if(next.navigating) await this.waitReady(tab.id,next.navigationUrl);
          const until=Date.now()+16000;
          let changed=false;
          while(Date.now()<until) {
            this.check();
            try {
              const after=await this.command(tab.id,"collect",{kind});
              if(!after.ok && !after.retryable)throw Object.assign(new Error(after.reason||"다음 페이지 목록을 읽을 수 없습니다."),{collectionError:true,retryable:after.retryable===true,code:after.code});
              if(after.ok && after.signature!==result.signature) {pendingResult=after;changed=true;break;}
            } catch (e) {if(e.collectionError) throw e;}
            await this.delay(500);
          }
          if(!changed) throw Object.assign(new Error("다음 페이지의 로딩을 확인하지 못했습니다."),{retryable:kind==='search'});
        }
        meta.status=kind==="history"&&!options.automatic?"review":"ready";
        if(kind==='history')meta.paginationVersion=2;
        if(kind==='history'&&options.automatic){meta.reviewed=true;meta.periodVerified=true;}
        meta.at=new Date().toISOString();
        meta.reason=kind==="history"?(options.automatic?'최근 2개월 · 전체 페이지 확인 완료':'조회기간과 수집 결과를 확인해 주세요.'):'수집 완료';
        if(kind==="history") {
          const keys=new Set(meta.jobs.map(j=>j.key));
          for(const [key,attempt] of Object.entries(this.state.attempts)) {
            if((keys.has(key)||keys.has(attempt.applicationKey)) && ["unknown","submitting","manual"].includes(attempt.status)) {
              attempt.status="completed";attempt.reason="사이트 지원 이력에서 확인";
            }
          }
        }
        this.state.run=returnRun || {status:"idle"};
      } catch(e) {
        if(meta){meta.status="paused";meta.reason=e.message;meta.retryableFailure=e.retryable===true&&!e.pageRetriesExhausted;}
        this.state.run=returnRun || {status:"idle"};
        this.log(e.message);

      } finally {
        // Close a successfully collected history tab only when this runner created it.
        for(const id of temporaryTabs)if(id!==meta?.tabId)await chrome.tabs.remove(id).catch(()=>{});
        if(kind==='history'&&['review','ready'].includes(meta?.status)&&this.owned.has(meta.tabId)){
          const id=meta.tabId;
          try{await chrome.tabs.remove(id);this.owned.delete(id);delete meta.tabId;}
          catch(_){/* Keep the saved tab reference if Chrome did not close it. */}
        }
        this.busy=false;
        await this.save();
      }
    }
    history() {return C.uniqueJobs([...this.state.settings.sites.flatMap(site=>this.state.histories[site]?.jobs||[]),...Object.values(this.state.attempts).filter(a=>a.status==="completed"&&a.job&&this.state.settings.sites.includes(a.job.site)).map(a=>({...a.job,confirmedAt:a.at}))]);}
    jobs() {
      const jobs=this.state.jobs;
      const attempts=Object.fromEntries(Object.entries(this.state.attempts).filter(([,attempt])=>attempt.status!=='manual'));
      return C.classify(jobs,this.history(),this.state.settings.excluded,attempts,this.state.settings.regions,true,false,this.state.settings.excludedTitleTerms,this.state.settings.titleKeywords||[],{includeNationwide:this.state.settings.includeNationwide!==false,excludeExact:!!this.state.settings.excludeExact});
    }
    async resetManual(keys){
      if(this.active)throw new Error('진행 중인 작업을 먼저 중지해 주세요.');
      const reset=C.resetManualAttempts(this.state,keys);
      if(!reset.length)return reset;
      this.log('직접 확인 공고 '+reset.length+'개를 다시 선택할 수 있도록 초기화했습니다.');
      await this.save();return reset;
    }
    ready() {
      return !!C.clean(this.state.settings.keyword) && this.state.settings.sites.length && this.state.settings.sites.every(site=>this.state.histories[site]?.status==="ready" && this.state.histories[site].reviewed && this.state.histories[site].periodVerified && this.state.histories[site].paginationVersion===2 && this.state.scans[site]?.status==="ready" && this.state.scans[site].policyVersion===C.searchPolicyVersion && this.state.scans[site].filterKey===C.searchFilterKey(this.state.settings) && this.state.scans[site].keyword===this.state.settings.keyword);
    }
    async probes(job,ids) {
      const hits=[];
      for(const id of ids) {
        let tab;
        try {tab=await chrome.tabs.get(id);}catch(_){continue;}
        if(C.siteOf(tab.url)!==job.site) continue;
        const frames=this.frames.get(id)||new Set([0]);
        for(const frameId of frames) {
          try {const p=await this.command(id,"probe",{job},frameId);if(p.ok)hits.push({id,frameId,p});}catch(_){this.check();}
        }
      }
      return hits;
    }
    // Daily limit applies to automatic submissions; `pending` holds jobs being processed in parallel.
    limitReached(pending=new Set()) {
      const limit=C.dailyLimitValue(this.state.settings.dailyLimit);
      return !!this.state.settings.autoApply&&limit>0&&C.dailyUsed(this.state,new Date(),pending)>=limit;
    }
    limitMessage() {return `오늘 지원 상한 ${C.dailyLimitValue(this.state.settings.dailyLimit)}건에 도달해 멈췄습니다. 남은 공고는 내일 다시 선택하거나 상한을 바꿔 주세요.`;}
    pause(job,status,reason,tabId,canContinue=false) {
      this.state.attempts[job.key]={job,status,reason,at:new Date().toISOString(),tabId,canContinue,submittedAt:this.state.attempts[job.key]?.submittedAt,applicationKey:this.state.attempts[job.key]?.applicationKey||this.applicationBindings.get(job.key)?.get(tabId)};
      this.state.run.status="paused";
      this.log(job.company+" · "+reason);
    }
    async confirmFromHistory(job){
      let tab;
      try{
        tab=await this.open(C.sites[job.site].historyUrl,false);await this.waitReady(tab.id);
        const range=C.historyRange();
        const prepared=await this.command(tab.id,'prepareHistory',{range});
        if(!prepared?.ok)return false;
        let verified={ok:prepared.ready===true};
        const until=Date.now()+10000;
        while(!verified.ok&&Date.now()<until){
          this.check();
          try{verified=await this.command(tab.id,'historyPeriod',{range,previousDocument:prepared.documentToken});}catch(_){this.check();}
          if(!verified.ok)await this.delay(400);
        }
        if(!verified.ok)return false;
        let result=await this.command(tab.id,'collect',{kind:'history'});
        const loadUntil=Date.now()+5000;
        while(result?.retryable&&Date.now()<loadUntil){await this.delay(400);result=await this.command(tab.id,'collect',{kind:'history'});}
        const applicationKey=this.state.attempts[job.key]?.applicationKey;
        return result?.ok===true&&result.jobs?.some(entry=>entry.key===job.key||applicationKey&&entry.key===applicationKey)===true;
      }catch(error){this.check();this.log(job.company+' · 지원 이력 재확인을 완료하지 못했습니다: '+error.message);return false;}
      finally{if(tab&&this.owned.has(tab.id)){await chrome.tabs.remove(tab.id).catch(()=>{});this.owned.delete(tab.id);}}
    }
    async verifyResult(jobOverride){
      if(this.active)return;
      const job=jobOverride||this.state.run?.job,attempt=this.state.attempts[job?.key];
      if(!job||!['unknown','submitting'].includes(attempt?.status))return;
      this.busy=true;this.cancelled=false;
      try{
        if(await this.confirmFromHistory(job)){this.completed(job,'사이트 지원 이력에서 완료 확인');this.log(job.company+' · 완료 기록을 복구했습니다. 확인 후 계속으로 다음 공고를 진행하세요.');}
        else this.log(job.company+' · 최근 지원 이력 첫 페이지에서 해당 공고를 확인하지 못했습니다. 제출을 반복하지 않습니다.');
      }finally{this.busy=false;await this.save();}
    }
    async applicationTabs(job,ids,beforeTabs){
      if(job.site!=='jobkorea')return [...new Set(ids)];
      const tabs=await chrome.tabs.query({url:['https://*.jobkorea.co.kr/Recruit/OnPass*']});
      const bindings=this.applicationBindings.get(job.key)||new Map();
      const matched=tabs.filter(tab=>{
        const key=C.applicationPosting(tab.url)?.key;
        return !!key&&(key===job.key||bindings.get(tab.id)===key);
      });
      const related=matched.filter(tab=>tab.status==='complete'&&(ids.includes(tab.id)||this.owned.has(tab.openerTabId)||matched.length===1));
      if(this.state.run.verifiedDetailId){
        const candidates=[];
        for(const tab of tabs){
          if(tab.status!=='complete'||beforeTabs.has(tab.id)||related.some(item=>item.id===tab.id))continue;
          if(tab.openerTabId&&tab.openerTabId!==this.state.run.verifiedDetailId)continue;
          try{
            const identity=await this.command(tab.id,'identifyApplication',{job});
            if(identity.ok&&identity.protocolVersion===C.contentProtocol&&identity.popupKey===C.applicationPosting(tab.url)?.key&&identity.titleMatches&&identity.employerMatches)candidates.push({tab,key:identity.popupKey});
          }catch(_){this.check();}
        }
        const linked=candidates.filter(item=>item.tab.openerTabId===this.state.run.verifiedDetailId);
        const competing=(this.applicationContext?.tasks||[]).some(task=>task.job.key!==job.key&&C.normalize(task.job.title)===C.normalize(job.title)&&!['waiting','completed','skipped'].includes(task.status));
        const expected=candidates.filter(item=>item.key===this.state.run.expectedApplicationKey);
        const approved=linked.length?linked:expected.length===1?expected:!competing&&candidates.length===1?candidates:[];
        for(const {tab,key} of approved){bindings.set(tab.id,key);related.push(tab);}
      }
      this.applicationBindings.set(job.key,bindings);
      for(const tab of related)if(!beforeTabs.has(tab.id))this.owned.add(tab.id);
      if(related.some(tab=>!ids.includes(tab.id)))await this.returnToDashboard();
      const result=[...new Set([...ids,...related.map(tab=>tab.id)])];
      this.state.run.tabs=result;return result;
    }
    async process(job,resume=false) {
      let run=this.state.run;
      if(!resume){this.applicationBindings.delete(job.key);delete run.verifiedDetailId;delete run.expectedApplicationKey;}
      const beforeTabs=new Set((await chrome.tabs.query({})).map(tab=>tab.id));
      let ids=[];
      if(resume) {
        ids=(run.tabs||[]).filter(Boolean);
      } else {
        const tab=await this.open(job.url,!this.state.settings.autoApply);
        ids=[tab.id]; run.tabs=ids;
        await this.waitReady(tab.id);
      }
      if(!ids.length) {this.pause(job,"manual","열린 지원 탭이 없습니다. 공고를 다시 열어 확인해 주세요.");return false;}
      run.job=job;run.tabs=ids;
      await this.save();
      ids=await this.applicationTabs(job,ids,beforeTabs);
      let hits=await this.probes(job,ids);
      if(hits.some(h=>h.p.success||h.p.already)) {this.completed(job,"사이트에서 기존 지원 또는 완료 표시 확인");return true;}
      if(!hits.some(h=>h.p.form)) {
        const detail=hits.find(h=>h.p.openAvailable);
        if(!detail) {this.pause(job,"manual",hits.find(h=>h.p.blocked)?.p.blocked || "공고의 지원 버튼을 확인할 수 없습니다.",ids[0]);return false;}
        const opened=await this.command(detail.id,"open",{job},detail.frameId);
        if(opened.ok){run.verifiedDetailId=detail.id;run.expectedApplicationKey=opened.applicationKey;}
        if(!opened.ok){this.pause(job,"manual",opened.reason,detail.id);return false;}
        const until=Date.now()+20000;
        run.reason='지원 버튼 클릭 완료 · 팝업 또는 지원 페이지가 열리는지 확인 중';await this.save();
        while(Date.now()<until) {
          await this.delay(500);
          ids=await this.applicationTabs(job,[...new Set([...ids,...(run.tabs||[])])],beforeTabs);run.tabs=ids;
          hits=await this.probes(job,ids);
          if(hits.some(h=>h.p.form||h.p.canCompleteResumeSelection||h.p.blocked||h.p.success||h.p.already))break;
        }
      }
      if(job.site==='jobkorea'){
        run.reason='잡코리아 새 창 로딩 완료 대기 · 이력서와 지원하기 버튼 준비 확인 중';await this.save();
        const until=Date.now()+25000;
        do{
          ids=await this.applicationTabs(job,[...new Set([...ids,...(run.tabs||[])])],beforeTabs);
          const currentHits=await this.probes(job,ids);
          const popupHits=currentHits.filter(hit=>{const key=C.applicationPosting(hit.p.url)?.key;return key&&(key===job.key||this.applicationBindings.get(job.key)?.get(hit.id)===key);});
          hits=popupHits.length?popupHits:currentHits;
          if(hits.some(hit=>hit.p.success||hit.p.already||hit.p.gate?.ok||hit.p.blocked||hit.p.form&&(hit.p.terms||hit.p.questions||hit.p.missingFields)))break;
          await this.delay(300);
        }while(Date.now()<until);
      }
      if(hits.some(h=>h.p.success||h.p.already)){this.completed(job,"사이트 완료 표시 확인");return true;}
      if(!hits.some(h=>h.p.form||h.p.canCompleteResumeSelection)){
        this.pause(job,'manual',hits.find(h=>h.p.blocked)?.p.blocked||'지원 버튼을 눌렀지만 20초 동안 팝업·지원 페이지를 확인하지 못했습니다. 팝업 차단 또는 새 탭을 확인하고 다시 선택해 주세요.',ids.at(-1));return false;
      }
      let hit=hits.find(h=>h.p.canCompleteResumeSelection) || hits.find(h=>h.p.gate?.ok) || hits.find(h=>h.p.form) || hits.find(h=>h.p.blocked);
      if(!this.state.settings.autoApply) {
        this.pause(job,"manual","자동지원이 꺼져 있습니다. 사이트에서 이력서를 확인하고 직접 제출한 뒤 ‘확인 후 계속’을 눌러 주세요.",hit?.id||ids.at(-1));
        return false;
      }
      if(job.site==='jobkorea'&&hit?.p.portfolioRequired&&!hit.p.portfolioReady){
        run.reason='포트폴리오 변경 · 첫 번째 등록 파일 선택 중';await this.save();
        const opened=await this.command(hit.id,'portfolioOpen',{job},hit.frameId);
        if(!opened.ok){this.pause(job,'manual',opened.reason,hit.id);return false;}
        let until=Date.now()+5000;
        while(Date.now()<until&&!hit.p.portfolioReady&&!hit.p.canSelectPortfolio){await this.delay(300);hit={...hit,p:await this.command(hit.id,'probe',{job},hit.frameId)};}
        if(!hit.p.portfolioReady){
          const selected=await this.command(hit.id,'portfolioSelect',{job},hit.frameId);
          if(!selected.ok){this.pause(job,'manual',selected.reason,hit.id);return false;}
          await this.delay(300);
          const committed=await this.command(hit.id,'portfolioCommit',{job},hit.frameId);
          if(!committed.ok){this.pause(job,'manual',committed.reason,hit.id);return false;}
          until=Date.now()+5000;
          do{await this.delay(300);hit={...hit,p:await this.command(hit.id,'probe',{job},hit.frameId)};}while(Date.now()<until&&!hit.p.portfolioReady&&!hit.p.blocked);
          if(!hit.p.portfolioReady){this.pause(job,'manual','포트폴리오 변경 결과를 확인하지 못했습니다.',hit.id);return false;}
        }
      }
      if(hit?.p.canChooseResumeMethod){
        const choice=await this.command(hit.id,'resumeMethod',{job},hit.frameId);
        if(!choice.ok){this.pause(job,'manual',choice.reason,hit.id);return false;}
        const until=Date.now()+12000;
        do{
          await this.delay(400);
          hit={...hit,p:await this.command(hit.id,'probe',{job},hit.frameId)};
          if(hit.p.blocked)break;
          if(hit.p.canCompleteResumeSelection||hit.p.form&&!hit.p.canChooseResumeMethod)break;
        }while(Date.now()<until);
      }
      if(hit?.p.canCompleteResumeSelection){
        const reply=await this.command(hit.id,'completeResumeSelection',{job},hit.frameId);
        if(!reply.ok){this.pause(job,'manual',reply.reason,hit.id);return false;}
        const until=Date.now()+8000;
        do{
          await this.delay(400);hit={...hit,p:await this.command(hit.id,'probe',{job},hit.frameId)};
          if(hit.p.blocked||hit.p.form&&!hit.p.canCompleteResumeSelection)break;
        }while(Date.now()<until);
      }
      // Wait for selected-resume cards and the recruitment area to finish rendering.
      if(hit?.p.form&&!hit.p.gate?.ok&&!hit.p.blocked){
        const until=Date.now()+5000;
        while(Date.now()<until&&!hit.p.gate?.ok&&!hit.p.blocked){
          await this.delay(400);
          hit={...hit,p:await this.command(hit.id,'probe',{job},hit.frameId)};
        }
      }
      if(job.site==='jobkorea'&&hit?.p.form&&!hit.p.gate?.ok&&!hit.p.blocked&&!hit.p.terms&&!hit.p.questions&&!hit.p.missingFields&&!hit.p.resumeSelected){
        run.reason='잡코리아 지원하기 화면 · 선택된 이력서 로딩 확인 중';await this.save();
        const until=Date.now()+6000;
        while(Date.now()<until&&!hit.p.gate?.ok&&!hit.p.blocked&&!hit.p.terms&&!hit.p.questions&&!hit.p.missingFields){
          await this.delay(300);hit={...hit,p:await this.command(hit.id,'probe',{job},hit.frameId)};
        }
      }
      if(hit?.p.canSelectResume) {
        const r=await this.command(hit.id,"resume",{job},hit.frameId);
        if(r.ok) {await this.delay(400);hit={...hit,p:await this.command(hit.id,"probe",{job},hit.frameId)};}
      }
      if(!hit || !hit.p.gate?.ok){this.pause(job,"manual",hit?.p.gate?.reason || "지원 양식을 인식하지 못했습니다. 사이트에서 직접 확인해 주세요.",hit?.id||ids.at(-1),!!hit?.p.form&&!hit.p.blocked);return false;}
      const token=crypto.randomUUID();
      const arm=await this.command(hit.id,"arm",{job,token},hit.frameId);
      if(!arm.ok){this.pause(job,"manual",arm.reason,hit.id);return false;}
      this.check();
      this.state.attempts[job.key]={job,status:"submitting",reason:"제출 결과 확인 중",at:new Date().toISOString(),submittedAt:new Date().toISOString(),tabId:hit.id,frameId:hit.frameId||0,token,applicationKey:this.applicationBindings.get(job.key)?.get(hit.id)};
      // Commit uncertainty before the irreversible click. Never resend after message loss.
      await this.save();
      this.check();
      let reply;
      try {reply=await this.command(hit.id,"submit",{job,token},hit.frameId);}catch(_){reply=null;}
      if(reply && !reply.ok && !reply.submitted){this.pause(job,"manual",reply.reason,hit.id);return false;}
      const until=Date.now()+15000;
      while(Date.now()<until) {
        if(this.state.attempts[job.key]?.status==='completed')return true;
        await this.delay(500);
        ids=await this.applicationTabs(job,[...new Set([...ids,...(run.tabs||[])])],beforeTabs);
        const results=await this.probes(job,ids);
        if(results.some(h=>h.p.success||h.p.already)){this.completed(job,"사이트 완료 표시 확인");return true;}
      }
      if(this.state.attempts[job.key]?.status==='completed')return true;
      this.state.attempts[job.key].reason='완료 표시 재확인 · 사이트 지원 이력 조회 중';await this.save();
      if(await this.confirmFromHistory(job)){this.completed(job,'사이트 지원 이력에서 완료 확인');return true;}
      if(this.state.attempts[job.key]?.status==='completed')return true;
      this.pause(job,"unknown","지원 버튼 이후 완료 표시를 확인하지 못했습니다. 지원 현황을 확인해 주세요. 자동 재제출하지 않습니다.",hit.id);
      return false;
    }
    completed(job,reason) {
      this.state.attempts[job.key]={job,status:"completed",reason,at:new Date().toISOString(),submittedAt:this.state.attempts[job.key]?.submittedAt,applicationKey:this.state.attempts[job.key]?.applicationKey};
      this.log(job.company+" · 지원 완료 확인");
    }
    async startParallel(keys) {
      if(this.active)return;
      if(!this.ready())throw new Error('두 사이트의 지원 이력 확인과 공고 수집을 먼저 완료해 주세요.');
      const eligible=new Map(this.jobs().filter(job=>job.eligible).map(job=>[job.key,job]));
      const queue=C.onePerCompany([...new Set(keys)].map(key=>eligible.get(key)).filter(Boolean));
      if(!queue.length)throw new Error('선택한 지원 대상이 없습니다.');
      const limit=Math.min(queue.length,this.state.settings.applyConcurrency||1);
      const run={status:'running',parallel:true,limit,queue:queue.map(job=>job.key),index:0,tabs:[],tasks:queue.map(job=>({job,status:'waiting'}))};
      this.state.run=run;this.busy=true;this.cancelled=false;
      let nextIndex=0;const pending=new Set();
      try{
        await this.save();
        await Promise.allSettled(Array.from({length:limit},async(_,slot)=>{
          let worker=this.applicationWorkers.get(slot);
          if(!worker){
            worker=new Runner({...this.state,run:{status:'idle'}},()=>{},false);
            worker.log=message=>this.log(message);
            worker.check=()=>{this.check();if(worker.cancelled)throw new Error('사용자가 작업을 중지했습니다.');};
            this.applicationWorkers.set(slot,worker);
          }
          worker.cancelled=false;worker.busy=true;
          try{
            while(nextIndex<queue.length&&!this.cancelled){
              if(this.limitReached(pending)){if(!run.limitReached){run.limitReached=true;this.log(this.limitMessage());}break;}
              const index=nextIndex++,job=queue[index],task=run.tasks[index];
              const current=this.jobs().find(item=>item.key===job.key);
              if(!current?.eligible){task.status='skipped';task.reason=current?.reason||'지원 대상에서 제외';run.index++;await this.save();continue;}
              worker.state={...this.state,run:{status:'running',job,queue:[job.key],index:0,tabs:[]}};
              worker.applicationContext=run;
              task.status='running';pending.add(job.key);
              worker.save=async()=>{
                const attempt=this.state.attempts[job.key];
                task.status=attempt?.status||'running';task.reason=attempt?.reason||worker.state.run.reason||'지원 화면 준비 중';
                task.tabs=[...(worker.state.run.tabs||[])];task.tabId=attempt?.tabId||task.tabs.at(-1);
                return this.save();
              };
              await worker.save();
              let complete=false;
              try{complete=await worker.process(job);}
              catch(error){
                const attempt=this.state.attempts[job.key];
                if(attempt?.status!=='completed')worker.pause(job,['submitting','unknown'].includes(attempt?.status)?'unknown':'manual',error.message,worker.state.run.tabs?.at(-1));
                complete=this.state.attempts[job.key]?.status==='completed';
              }
              finally{pending.delete(job.key);}
              await worker.save();
              if(complete)for(const id of worker.state.run.tabs||[])if(worker.owned.has(id))await chrome.tabs.remove(id).catch(()=>{});
              run.index++;await this.save();
              if(nextIndex<queue.length&&!this.cancelled)await worker.delay(this.state.settings.delay*1000);
            }
          }finally{worker.busy=false;}
        }));
      }finally{
        this.busy=false;run.status='done';
        if(run.limitReached)for(const task of run.tasks)if(task.status==='waiting'){task.status='stopped';task.reason='하루 지원 상한 도달';}
        run.reason=run.limitReached&&!this.cancelled?this.limitMessage():this.cancelled?'동시 지원을 중지했습니다. 남은 공고는 목록에서 다시 선택할 수 있습니다.':'동시 지원을 마쳤습니다. 직접 확인·결과 불명 공고는 개별 상태를 확인해 주세요.';
        for(const task of run.tasks)if(task.status==='running')task.status='stopped';
        this.log(run.reason);await this.save();
      }
    }
    async start(keys,resume=false) {
      if(!resume&&this.state.settings.autoApply&&this.state.settings.applyConcurrency>1)return this.startParallel(keys);
      if(this.busy)return;
      if(!this.ready())throw new Error("두 사이트의 지원 이력 확인과 공고 수집을 먼저 완료해 주세요.");
      this.busy=true;this.cancelled=false;
      try {
        if(!resume) {
          const allowed=new Set(this.jobs().filter(j=>j.eligible).map(j=>j.key));
          const requested=[...new Set(keys)].filter(k=>allowed.has(k));
          const byKey=new Map(this.state.jobs.map(job=>[job.key,job]));
          const queue=C.onePerCompany(requested.map(key=>byKey.get(key)).filter(Boolean)).map(job=>job.key);
          if(!queue.length)throw new Error("선택한 지원 대상이 없습니다.");
          this.state.run={status:"running",queue,index:0,tabs:[]};
        } else {
          const attempt=this.state.attempts[this.state.run.job?.key];
          if(attempt?.status==="unknown" || attempt?.status==="submitting")throw new Error("결과 불명 공고는 지원 현황에서 먼저 확인해야 합니다.");
          this.state.run.status="running";
        }
        await this.save();
        const run=this.state.run;
        while(run.index<run.queue.length) {
          this.check();
          const key=run.queue[run.index];
          const job=this.state.jobs.find(j=>j.key===key);
          const attempt=this.state.attempts[key];
          if(!job || attempt?.status==="completed" || attempt?.status==="skipped"){run.index++;continue;}
          if(attempt?.status==="unknown" || attempt?.status==="submitting") {run.status="paused";break;}
          const reason=this.jobs().find(j=>j.key===key)?.reason;
          if(reason && reason!=="지원 결과 확인 필요") {
            this.state.attempts[key]={job,status:"skipped",reason,at:new Date().toISOString()};run.index++;continue;
          }
          if(this.limitReached()){run.status="done";run.job=null;run.tabs=[];run.reason=this.limitMessage();this.log(run.reason);break;}
          const isResume=resume && run.job?.key===key && run.tabs?.length;
          let completed;
          completed=await this.process(job,isResume);
          resume=false;
          await this.save();
          if(!completed){
            const attempt=this.state.attempts[key];
            if(!this.state.settings.autoApply)await this.focus(attempt?.tabId);break;
          }
          // Close only extension-created task tabs after a positively confirmed result.
          for(const id of run.tabs||[])if(this.owned.has(id))await chrome.tabs.remove(id).catch(()=>{});
          run.tabs=[];run.job=null;run.index++;
          await this.save();
          if(run.index<run.queue.length)await this.delay(this.state.settings.delay*1000);
        }
        if(run.index>=run.queue.length){run.status="done";run.job=null;this.log("선택 목록 처리가 끝났습니다.");}
      }catch(e){
        const job=this.state.run.job;
        if(job) {
          const submitting=["submitting","unknown"].includes(this.state.attempts[job.key]?.status);
          this.pause(job,submitting?"unknown":"manual",e.message,this.state.run.tabs?.at(-1));
        }else{this.state.run.status="paused";this.log(e.message);}
      }finally{this.busy=false;await this.save();}
    }
    async skip() {
      if(this.busy)return;
      const run=this.state.run;
      if(run.status!=="paused" || !run.queue)return;
      const key=run.queue[run.index];
      const job=this.state.jobs.find(j=>j.key===key);
      const old=this.state.attempts[key];
      if(old?.status!=="unknown")this.state.attempts[key]={job,status:"skipped",reason:"사용자가 건너뜀",at:new Date().toISOString()};
      run.index++;run.job=null;run.tabs=[];
      await this.save();
      return this.start([],true);
    }
    async stop() {
      this.cancelled=true;
      for(const worker of [...this.searchWorkers.values(),...this.applicationWorkers.values(),...this.historyWorkers.values()])worker.cancelled=true;
      this.log("중지 요청 · 이미 제출한 지원은 취소하지 않습니다.");
      if(!this.active) {this.state.run={status:"idle"};await this.save();}
    }
    async diagnostics(site,kind="history") {
      const tabs=await chrome.tabs.query({url:site?["https://*."+site+".co.kr/*"]:["https://*.saramin.co.kr/*","https://*.jobkorea.co.kr/*"]});
      const data=[];
      for(const tab of tabs.filter(t=>!site||(kind==="search"?C.isSearch(t.url,site):C.isHistory(t.url,site))))try{data.push(await this.command(tab.id,"diagnostics"));}catch(_){/* unavailable tab */}
      if(!data.length)throw new Error("진단할 사이트 화면을 찾지 못했습니다. 해당 사이트 탭을 새로고침하고 다시 저장해 주세요.");
      return data;
    }
  }
  globalThis.FWARunner=Runner;
})();
