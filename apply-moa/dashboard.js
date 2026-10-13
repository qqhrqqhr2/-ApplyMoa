(async function () {
  "use strict";
  const C=globalThis.FWA;
  const $=id=>document.getElementById(id);
  const element=(tag,cls,value)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=value;return e;};
  if(chrome.storage.local.setAccessLevel)await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  if(navigator.locks){
    const acquired=await new Promise(resolve=>{navigator.locks.request("fwa-dashboard-controller",{ifAvailable:true},lock=>{resolve(!!lock);return lock?new Promise(()=>{}):undefined;}).catch(()=>resolve(false));});
    if(!acquired){$("error").textContent="다른 지원 도우미 화면이 열려 있습니다. 그 화면을 사용해 주세요.";$("error").hidden=false;document.querySelectorAll("button,input,select,textarea").forEach(e=>e.disabled=true);return;}
  }
  const state=C.migrateState((await chrome.storage.local.get("fwaState")).fwaState || C.initialState());
  state.ui ||= {};
  state.settings.regions ||= [];
  state.settings.autoApply ||= false;
  state.settings.excludeAppliedCompanies = true;
  await chrome.storage.local.remove(['fwaResume','fwaAIKeys','fwaAIModelCatalog']);
  state.settings.sites=["saramin","jobkorea"];
  const selected=new Set();
  let renderQueued=false;
  // Runner saves can fire several times per tick; draw once per batch.
  const scheduleRender=()=>{if(renderQueued)return;renderQueued=true;setTimeout(()=>{renderQueued=false;render();},0);};
  const runner=new FWARunner(state,scheduleRender);
  let renderedJobsSignature="";
  let jobListPage=1;
  const companyDisplayJobs=new Map();
  let errorTimer;
    let settingsBusy=false;
  function error(message){$("error").textContent=message;$("error").hidden=false;clearTimeout(errorTimer);errorTimer=setTimeout(()=>{$("error").hidden=true;},15000);}
  const wrap=fn=>async()=>{try{await fn();}catch(e){error(e.message);}};
  function values(id){return [...$(id).querySelectorAll('input:checked')].map(input=>input.value).filter(Boolean);}
  function filters(){return C.searchFilters({companyTypes:values('companyTypes'),employmentTypes:values('employmentTypes')});}
  function choiceSummary(id,options,allLabel){
    const summary=$(id+'Summary');if(!summary)return;
    const picked=new Set(values(id));
    summary.textContent=picked.size?options.filter(option=>picked.has(option.key)).map(option=>option.label).join(' · '):allLabel;
  }
  function choices(id,options,selected,allLabel){
    const root=$(id),grid=root.querySelector('.choice-grid');
    grid.replaceChildren(...[{key:'',label:allLabel},...options].map(option=>{
      const choice=element('label','check choice'),input=element('input');input.type='checkbox';input.value=option.key;input.checked=option.key?selected.includes(option.key):!selected.length;
      choice.append(input,element('span','',option.label));return choice;
    }));
    root.onchange=event=>{
      const input=event.target;
      if(input.matches('input[type="checkbox"]')&&input.checked){
        if(!input.value)root.querySelectorAll('input').forEach(other=>other.checked=other===input);
        else root.querySelector('input[value=""]').checked=false;
      }
      if(id==='regions'&&input.matches('input[type="checkbox"]')&&input.checked&&input.value){
        const province=input.value.split(' ')[0];
        for(const other of root.querySelectorAll('input'))if(other!==input&&(input.value===province?other.value.startsWith(province+' '):other.value===province))other.checked=false;
      }
      if(!values(id).length)root.querySelector('input[value=""]').checked=true;
      choiceSummary(id,options,allLabel);renderStart();
    };
    choiceSummary(id,options,allLabel);
  }
  const installedVersion=chrome.runtime.getManifest().version;
  $('sidebarVersion').textContent='LOCAL · '+installedVersion;
  $('appVersion').textContent='v'+installedVersion;
  function loadSettings(){
    $("applyConcurrency").value=String(state.settings.applyConcurrency);
    const limit=String(C.dailyLimitValue(state.settings.dailyLimit));
    if(![...$("dailyLimit").options].some(option=>option.value===limit))$("dailyLimit").append(Object.assign(element("option","",limit+"건"),{value:limit}));
    $("dailyLimit").value=limit;
    $("includeNationwide").checked=state.settings.includeNationwide!==false;$("excludeExact").checked=!!state.settings.excludeExact;
    $("titleKeywords").value=state.settings.titleKeywords.join(", ");
    $("excludedTitleTerms").value=state.settings.excludedTitleTerms.join(", ");
    $("keyword").value=state.settings.keyword;$("excluded").value=state.settings.excluded.join("\n");$("delay").value=String(state.settings.delay);$("autoApply").checked=state.settings.autoApply;$("excludeAppliedCompanies").checked=true;
    choices('companyTypes',C.companyOptions,state.settings.companyTypes,'전체 기업');choices('employmentTypes',C.employmentOptions,state.settings.employmentTypes,'전체 채용 형태');
    const knownRegions=[...C.regionOptions,...C.detailedRegionOptions];
    const regions=[...knownRegions,...state.settings.regions.filter(region=>!knownRegions.includes(region))];
    choices('regions',regions.map(region=>({key:region,label:region})),state.settings.regions,'전체 지역');
    const grid=$('regions').querySelector('.choice-grid');
    for(const [province,cities] of Object.entries(C.regionGroups)){
      const details=element('details','city-region-group'),summary=element('summary','',province+' 상세 지역');
      const cityGrid=element('div','city-region-grid');
      for(const city of cities){
        const label=[...grid.querySelectorAll('label')].find(item=>item.querySelector('input')?.value===province+' '+city);
        if(label)cityGrid.append(label);
      }
      details.append(summary,cityGrid);grid.append(details);
    }
  }
  function badge(status){return {ready:["확인 완료","green"],review:["결과 확인 필요","amber"],paused:["확인 필요","amber"],scanning:["수집 중","blue"],running:["지원 중","blue"],done:["처리 완료","green"],completed:["완료 확인","green"],manual:["직접 확인","amber"],unknown:["결과 불명","red"],submitting:["결과 확인 중","blue"],skipped:["건너뜀",""],idle:["대기",""]}[status] || ["미수집",""];}
  function makeBadge(status){const [s,c]=badge(status);return element("span","badge "+c,s);}
  function historyCards(){
    const cards=[];
    for(const site of state.settings.sites){
      const meta=state.histories[site];
      const card=element("div","site-card");
      const top=element("div","site-top");
      top.append(element("span","site-symbol "+(site==="jobkorea"?"jk":""),site==="saramin"?"S":"JK"),element("strong","",C.sites[site].label),makeBadge(meta?.status));
      const desc=element("p","site-description",meta ? `${meta.jobs?.length||0}건 · ${meta.pages||0}페이지${meta.dateHints?.length ? " · 조회기간 "+meta.dateHints.join(" ~ ") : ""}\n${meta.reason||""}` : "이력 수집을 누르면 최근 2개월을 자동 조회합니다.");
      const buttons=element("div","site-buttons");
      const open=element("button","secondary","로그인 / 지원 현황");open.addEventListener("click",wrap(()=>runner.openHistory(site)));
      const scan=element("button","secondary",meta?.status==="paused"?(meta.pages&&!meta.needsRestart?"이력 이어 수집":"지원 이력 다시 수집"):meta?"지원 이력 다시 수집":"지원 이력 수집");scan.disabled=settingsBusy || !runner.canCollectHistory(site);scan.addEventListener("click",wrap(()=>runner.scanHistory(site)));
      scan.title=runner.historyBusy(site)?"이 사이트의 지원 이력을 수집하고 있습니다.":!runner.canCollectHistory(site)?"현재 공고 수집 또는 지원 작업을 마친 뒤 사용하세요.":"최근 2개월의 지원 이력을 수집합니다.";
      buttons.append(open,scan);card.append(top,desc,buttons);
      if(meta){
        const diagnostic=element("button","plain",meta.status==='paused'?"수집 오류 진단 저장":"화면 구조 진단 저장");diagnostic.disabled=runner.active;
        diagnostic.addEventListener("click",wrap(async()=>{runner.cancelled=false;download(`지원이력_${C.sites[site].label}_진단.json`,await runner.diagnostics(site));}));diagnostic.classList.add("diagnostic-button");buttons.append(diagnostic);
      }
      if(meta && ["review","ready"].includes(meta.status)){
        const check=element("label","check review");const input=element("input");input.type="checkbox";input.checked=!!meta.reviewed;input.disabled=runner.historyBusy(site)||runner.busy||runner.batchBusy;
        input.addEventListener("change",wrap(async()=>{meta.reviewed=input.checked;meta.status=input.checked?"ready":"review";await runner.save();}));
        check.append(input,element("span","","조회기간과 수집 건수를 확인했습니다."));card.append(check);
      }
      cards.push(card);
    }
    $("historyCards").replaceChildren(...cards);
  }
  function rows(jobs){
    const query=C.normalize($("filter").value);const view=$("viewFilter").value;
    const filtered=jobs.filter(j=>!query || C.normalize(j.company+" "+j.title).includes(query)).filter(j=>view==="all" || (view==="eligible"&&j.eligible&&(!state.attempts[j.key]||state.attempts[j.key].status==='manual')) || (view==="excluded"&&!j.eligible) || (view==="results"&&!!state.attempts[j.key]));
    const groups=C.groupCompanyJobs(C.sortJobs(filtered,$("sortOrder").value));
    const totalPages=Math.max(1,Math.ceil(groups.length/C.searchBatchSize));
    jobListPage=Math.max(1,Math.min(jobListPage,totalPages));
    $("jobPageCount").textContent=`${groups.length}개 기업 · ${filtered.length}개 공고 · ${jobListPage} / ${totalPages}페이지`;
    $("previousJobs").disabled=jobListPage===1;$("nextJobs").disabled=jobListPage===totalPages;
    const output=[];
    for(const group of groups.slice((jobListPage-1)*C.searchBatchSize,jobListPage*C.searchBatchSize)){
      const job=group.jobs.find(item=>selected.has(item.key))||group.jobs.find(item=>item.key===companyDisplayJobs.get(group.key))||group.jobs.find(item=>item.eligible&&(!state.attempts[item.key]||state.attempts[item.key].status==='manual'))||group.jobs[0];
      const attempt=state.attempts[job.key];
      const row=element("tr","compact-company-row");const tick=element("td");const input=element("input");input.type="checkbox";input.checked=selected.has(job.key);input.disabled=!job.eligible || (!!attempt&&attempt.status!=='manual') || runner.active;input.setAttribute("aria-label",job.company+" "+job.title+" 선택");
      input.addEventListener("change",wrap(async()=>{if(input.checked){if(state.attempts[job.key]?.status==='manual')await runner.resetManual([job.key]);const next=C.selectCompanyJob(selected,jobs,job.key);selected.clear();for(const key of next)selected.add(key);}else selected.delete(job.key);renderedJobsSignature="";render();}));tick.append(input);
      const info=element("td","compact-job-info"),line=element('div','company-job-line');
      const company=element("span","job-company",job.company);company.title=job.company;line.append(company);
      const link=element("a","job-title",group.jobs.length>1?'보기 ↗':job.title);link.href=job.url;link.target="_blank";link.rel="noopener noreferrer";link.title=job.title;
      const titleGroup=element('div','job-title-group');
      if(group.jobs.length>1){
        const picker=element('select','company-job-picker');picker.setAttribute('aria-label',job.company+' 공고 선택');picker.disabled=runner.active;
        for(const posting of group.jobs){const option=element('option','',C.sites[posting.site].label+' · '+posting.title);option.value=posting.key;picker.append(option);}
        picker.value=job.key;picker.title=job.title;
        picker.addEventListener('change',wrap(async()=>{
          const next=group.jobs.find(item=>item.key===picker.value);if(!next)return;
          const wasSelected=group.jobs.some(item=>selected.has(item.key));
          for(const item of group.jobs)selected.delete(item.key);
          companyDisplayJobs.set(group.key,next.key);
          if(wasSelected&&next.eligible&&(!state.attempts[next.key]||state.attempts[next.key].status==='manual')){
            if(state.attempts[next.key]?.status==='manual')await runner.resetManual([next.key]);
            for(const key of C.selectCompanyJob(selected,jobs,next.key))selected.add(key);
          }
          $('consent').checked=false;renderedJobsSignature="";render();
        }));titleGroup.append(picker);
      }
      titleGroup.append(link);line.append(titleGroup);
      if(job.location){const location=element("span","job-location",job.location);location.title=job.location;line.append(location);}
      info.append(line);
      const site=element("td","site-label",C.sites[job.site].label);
      const status=element("td"),statusLine=element("div","status-line");status.append(statusLine);statusLine.append(attempt?makeBadge(attempt.status):job.eligible?element("span","badge blue","지원 대상"):element("span","badge",job.reason));
      if(attempt?.reason){status.title=attempt.reason;statusLine.append(element("span","job-reason",attempt.reason));}
      if(attempt?.status==='manual'){
        const retry=element('button','secondary retry-job','다시 선택');
        retry.disabled=runner.active;
        retry.addEventListener('click',wrap(async()=>{await runner.resetManual([job.key]);selected.delete(job.key);renderedJobsSignature="";$('consent').checked=false;render();}));
        statusLine.append(retry);
      }
      const registered=element("td","posted-date-col",job.postedDate||"—");registered.title=job.postedDate?"사이트에 표시된 공고 등록일":"공고 목록에 등록일이 표시되지 않았거나 아직 수집하지 않았습니다.";
      row.append(tick,info,registered,site,status);output.push(row);
    }
    $("jobs").replaceChildren(...output);$("empty").hidden=output.length>0;
    if(jobs.length && !output.length){$("empty").querySelector("strong").textContent="조건에 맞는 공고가 없습니다.";$("empty").querySelector("p").textContent="목록 검색이나 유형을 바꿔 주세요.";}
  }
  function historyList(){
    const history=C.uniqueJobs(runner.history());
    const groups=new Map();
    for(const job of history){const key=C.companyKey(job.company);if(!key)continue;if(!groups.has(key))groups.set(key,{company:job.company,jobs:[]});groups.get(key).jobs.push(job);}
    $("historyCompanyCount").textContent=`${groups.size}개 기업 · ${history.length}건`;
    const query=C.normalize($("historyFilter").value);
    const list=[];
    for(const group of [...groups.values()].sort((a,b)=>a.company.localeCompare(b.company,"ko"))){
      if(query&&!C.normalize(group.company+" "+group.jobs.map(j=>j.title).join(" ")).includes(query))continue;
      const item=element("details","history-company");const summary=element("summary");summary.append(element("strong","",group.company),element("span","site-label",[...new Set(group.jobs.map(j=>C.sites[j.site].label))].join(" · ")),element("span","badge",group.jobs.length+"건"));
      const postings=element("ul");for(const job of group.jobs){const li=element("li");const a=element("a","",job.title);a.href=job.url;a.target="_blank";a.rel="noopener noreferrer";li.append(a,element("span","site-label",C.sites[job.site].label));postings.append(li);}
      item.append(summary,postings);list.push(item);
    }
    if(!list.length)list.push(element("p","history-empty",history.length?"검색 조건에 맞는 지원 이력이 없습니다.":"지원 이력을 수집하면 회사별 목록이 표시됩니다."));
    $("historyList").replaceChildren(...list);
  }
  function renderStart(){
    const jobs=runner.jobs();const count=jobs.filter(j=>j.eligible && selected.has(j.key) && (!state.attempts[j.key]||state.attempts[j.key].status==='manual')).length;
    const action=state.settings.autoApply?"일괄 지원":"지원 화면 열기";
    $("start").textContent=count?`${count}개 공고 ${action}`:action;
    const pausedQueue=state.run.status==="paused" && !!state.run.queue && state.attempts[state.run.job?.key]?.status!=='manual';
    const limit=C.dailyLimitValue(state.settings.dailyLimit),used=C.dailyUsed(state),limitFull=state.settings.autoApply&&limit>0&&used>=limit;
    // Tell the user why the button is disabled, in the order they need to fix things.
    const missingHistory=state.settings.sites.find(site=>{const h=state.histories[site];return !(h?.status==="ready"&&h.reviewed&&h.periodVerified);});
    const hint=settingsBusy?"설정을 저장하는 중입니다.":runner.active?"진행 중인 작업이 끝나면 지원할 수 있습니다.":dirty()?"변경한 설정을 먼저 저장해 주세요.":missingHistory?`1단계: ${C.sites[missingHistory].label} 지원 이력 수집과 확인 체크가 필요합니다.`:!runner.ready()?"2단계: 두 사이트 공고 수집을 먼저 완료해 주세요.":pausedQueue?"진행 중인 지원을 계속하거나 건너뛰어 주세요.":limitFull?"오늘 지원 상한에 도달했습니다. 상한을 바꾸거나 내일 다시 지원해 주세요.":!count?"지원할 공고를 선택해 주세요.":(state.settings.autoApply&&!$("consent").checked)?"위의 이력서 제출 확인에 체크해 주세요.":"";
    $("startHint").textContent=hint;
    $("start").disabled=!!hint;
    $("dailyUsage").hidden=!state.settings.autoApply;
    $("dailyUsage").textContent=`오늘 자동 지원 ${used}${limit?` / ${limit}`:""}건`;
    $("dailyUsage").classList.toggle("is-full",!!limitFull);
    $("saveSettings").textContent=dirty()?"변경사항 저장":"설정 저장";
    $("consentLabel").hidden=!state.settings.autoApply;
    $("selectAll").disabled=runner.active;
    const manualCount=Object.values(state.attempts).filter(attempt=>attempt.status==='manual').length;
    $('resetManual').disabled=runner.active||!manualCount;
    $('resetManual').textContent='직접 확인 공고 초기화'+(manualCount?' ('+manualCount+'개)':'');
    const selectable=jobs.filter(j=>j.eligible&&(!state.attempts[j.key]||state.attempts[j.key].status==='manual'));const checks=selectable.filter(j=>selected.has(j.key)).length;const companyCount=C.onePerCompany(selectable).length;
    $("selectAll").checked=selectable.length>0&&checks===companyCount;$("selectAll").indeterminate=checks>0&&checks<companyCount;
  }
  function renderSettingsSummary(){
    const folded=!!state.ui.settingsCollapsed&&!!C.titleTerms(state.settings.keyword).length&&!dirty();
    $("settingsSummary").hidden=!folded;
    document.querySelectorAll(".settings,.preference-settings").forEach(section=>section.classList.toggle("is-collapsed-settings",folded));
    if(!folded)return;
    const s=state.settings,regions=s.regions.length?s.regions.join("·")+(s.includeNationwide!==false?" (전국 포함)":""):"전체 지역";
    const parts=["검색어 "+C.titleTerms(s.keyword).join(", "),$("companyTypesSummary").textContent,$("employmentTypesSummary").textContent,regions];
    if(s.titleKeywords.length)parts.push("제목 포함 "+s.titleKeywords.join(", "));
    if(s.excluded.length)parts.push(`제외 기업 ${s.excluded.length}곳${s.excludeExact?" (완전 일치)":""}`);
    if(s.excludedTitleTerms.length)parts.push("제목 제외 "+s.excludedTitleTerms.join(", "));
    parts.push(s.autoApply?`자동지원 켜짐 · 동시 ${s.applyConcurrency}개`:"자동지원 꺼짐",`대기 ${s.delay}초`,C.dailyLimitValue(s.dailyLimit)?`하루 ${C.dailyLimitValue(s.dailyLimit)}건까지`:"하루 상한 없음");
    $("settingsSummaryText").textContent=parts.join(" · ");
  }
  function render(){
    historyCards();historyList();
    const pills=state.settings.sites.map(site=>{
      const m=state.scans[site];const e=element("div","search-pill");e.dataset.site=site;
      const top=element("div","search-top");top.append(element("strong","",C.sites[site].label),element("span","",`${m?.jobs?.length||0}건 · ${m?.pages||0}페이지`),makeBadge(m?.status));e.append(top);
      e.append(element("p","search-reason",m?.collectionMode||(site==='saramin'?'일반 채용만 · 100개씩':'20개씩 · 최대 5페이지 동시 수집')));
      if(m?.reason)e.append(element("p","search-reason"+(m.status==="paused"?" search-error":""),m.reason));
      const actions=element("div","search-actions");const scan=element("button","secondary",m?.status==="paused"&&m.pages&&!m.needsRestart?"이어서 수집":m?.status==="ready"?"다시 수집":"공고 수집");
      scan.disabled=runner.active||!C.clean(state.settings.keyword)||(state.run.status==="paused"&&!!state.run.queue);
      scan.addEventListener("click",wrap(async()=>{
        if(dirty())throw new Error("변경한 설정을 먼저 저장해 주세요.");
        if(m?.status==="ready"||m?.needsRestart){delete state.scans[site];state.jobs=state.jobs.filter(j=>j.site!==site);selected.clear();$("consent").checked=false;}
        // Same keyword-by-keyword path as the two-site button, limited to this site.
        await runner.scanSearchAll([site]);
      }));actions.append(scan);
      if(m?.status==="paused"){
        const diagnostic=element("button","plain","수집 오류 진단 저장");diagnostic.disabled=runner.active;
        diagnostic.addEventListener("click",wrap(async()=>{runner.cancelled=false;download(`공고수집_${C.sites[site].label}_진단.json`,await runner.diagnostics(site,"search"));}));actions.append(diagnostic);
      }
      e.append(actions);return e;
    });$("searchStatus").replaceChildren(...pills);
    const jobs=runner.jobs();
    for(const j of jobs)if(!j.eligible||(state.attempts[j.key]&&state.attempts[j.key].status!=='manual'))selected.delete(j.key);
    const signature=JSON.stringify([jobs.map(j=>[j.key,j.reason,j.title,j.company,j.location,j.postedDate]),state.attempts,runner.active,$("filter").value,$("viewFilter").value,$("sortOrder").value,jobListPage]);
    if(signature!==renderedJobsSignature){rows(jobs);renderedJobsSignature=signature;}
    $("totalCount").textContent=jobs.length;$("eligibleCount").textContent=jobs.filter(j=>j.eligible&&(!state.attempts[j.key]||state.attempts[j.key].status==='manual')).length;$("excludedCount").textContent=jobs.filter(j=>!j.eligible).length;const summary=C.workCounts(state);$('doneCount').textContent=summary.current;$('allDoneCount').textContent=summary.total;$('resetWorkSummary').disabled=runner.active||settingsBusy;
    const locked=settingsBusy || runner.active || (state.run.status==="paused"&&!!state.run.queue);for(const id of ["keyword","excluded","companyTypes","employmentTypes","regions","delay","applyConcurrency","titleKeywords","excludedTitleTerms","saveSettings","scanAll","dailyLimit","includeNationwide","excludeExact","editSettings"])$(id).disabled=locked;
    for(const id of ['companyTypes','employmentTypes','regions'])$(id).querySelectorAll('input').forEach(input=>input.disabled=locked);
    $("scanAll").disabled=locked || !C.clean(state.settings.keyword);
    $("scanHistoryAll").disabled=settingsBusy||!runner.canCollectHistory()||state.settings.sites.every(site=>runner.historyBusy(site));
    $("autoApply").disabled=settingsBusy||runner.active;
    $("excludeAppliedCompanies").disabled=true;
    const r=state.run;const active=["running","paused","scanning","done"].includes(r.status);
    $("runPanel").hidden=!active;$("runBadge").replaceWith(Object.assign(makeBadge(r.status),{id:"runBadge"}));
    const attempt=state.attempts[r.job?.key];
    $("runTitle").textContent=r.job?`${r.job.company} · ${(r.index||0)+1} / ${r.queue?.length||0}`:r.status==="scanning"?`${r.site==='all'?'사람인·잡코리아 동시':C.sites[r.site].label} · ${r.kind==="history"?"지원 이력":"공고"} 수집 중`:r.status==="done"?"선택 목록 처리가 끝났습니다.":r.status==="running"?`${r.index?"다음 공고 준비 중":"일괄 지원 준비 중"} · ${(r.index||0)+1} / ${r.queue?.length||0}`:"일시 중지되었습니다.";
    $("runReason").textContent=r.status==="running"&&!r.job?(r.index?`다음 공고 지원까지 ${state.settings.delay}초 대기 후 지원 화면을 준비합니다.`:"선택한 공고의 지원 화면을 준비하고 있습니다."):r.status==="scanning"&&r.site==='all'?`두 사이트가 각각 수집 중입니다. 사이트별 진행 상태는 ${r.kind==='history'?'지원 이력 확인':'공고 모으기'}에서 확인하세요.`:attempt?.reason || r.reason || (r.job?r.job.title:"지원 양식을 직접 확인해야 하는 공고는 이곳에 표시됩니다.");
    $('verifyResult').hidden=!r.job||!['unknown','submitting'].includes(attempt?.status);$('verifyResult').disabled=runner.active;
    $("openTask").hidden=!r.job;$("resume").hidden=r.status!=="paused"||!r.queue;$("resume").disabled=runner.active || ["unknown","submitting"].includes(attempt?.status) || (state.settings.autoApply&&!$("consent").checked);
    $("skip").hidden=r.status!=="paused"||!r.queue;$("skip").disabled=runner.active;$("stop").hidden=r.status==="done";
    $('parallelTasks').hidden=!r.parallel;
    if(r.parallel){
      const tasks=r.tasks||[],done=tasks.filter(task=>state.attempts[task.job.key]?.status==='completed').length;
      const working=tasks.filter(task=>['running','submitting'].includes(state.attempts[task.job.key]?.status||task.status)).length;
      $('runTitle').textContent=`동시 지원 ${r.limit}개 · 완료 ${done} / ${tasks.length} · 진행 ${working}개`;
      $('runReason').textContent=r.reason||'각 공고를 독립적으로 지원합니다. 추가 확인이 필요한 공고는 남겨 두고 다른 공고를 계속 진행합니다.';
      $('resume').hidden=true;$('skip').hidden=true;
      $('parallelTasks').replaceChildren(...tasks.map(task=>{
        const attempt=state.attempts[task.job.key],status=attempt?.status||task.status;
        const item=element('div','parallel-task');
        item.append(element('strong','',task.job.company),status==='waiting'?element('span','badge','대기'):status==='stopped'?element('span','badge amber','중단'):makeBadge(status));
        const reason=element('span','parallel-task-reason',attempt?.reason||task.reason||task.job.title);reason.title=reason.textContent;item.append(reason);
        if(['manual','unknown','submitting'].includes(status)){
          const open=element('button','secondary','사이트 열기');open.addEventListener('click',wrap(()=>task.tabId?runner.focus(task.tabId):runner.open(task.job.url)));item.append(open);
          if(['unknown','submitting'].includes(status)){const verify=element('button','secondary','완료 재확인');verify.disabled=runner.active;verify.addEventListener('click',wrap(()=>runner.verifyResult(task.job)));item.append(verify);}
        }
        return item;
      }));
    }
    // Avoid repeating the title as the description (e.g. "선택 목록 처리가 끝났습니다.").
    $("runReason").hidden=C.clean($("runReason").textContent)===C.clean($("runTitle").textContent);
    renderSettingsSummary();
    const collapsed=!!state.ui.runPanelCollapsed;
    $('runPanel').classList.toggle('is-collapsed',collapsed);
    $('toggleRunPanel').textContent=collapsed?'펼치기':'접기';
    $('toggleRunPanel').setAttribute('aria-expanded',String(!collapsed));
    if(collapsed&&!r.parallel&&r.queue?.length)$('runTitle').textContent+=` · 완료 ${r.queue.filter(key=>state.attempts[key]?.status==='completed').length}건`;
    $('runTitle').title=$('runTitle').textContent;
    $("logs").replaceChildren(...state.logs.map(l=>{const li=element("li");li.append(element("time","",new Date(l.time).toLocaleTimeString("ko-KR")),document.createTextNode(l.message));return li;}));
    renderStart();
  }
  function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json;charset=utf-8"}));const link=element("a");link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function dirty(){return !C.sameKeywords($("keyword").value,state.settings.keyword) || Number($("dailyLimit").value)!==C.dailyLimitValue(state.settings.dailyLimit) || $("includeNationwide").checked!==(state.settings.includeNationwide!==false) || $("excludeExact").checked!==!!state.settings.excludeExact || JSON.stringify(C.companyList($("excluded").value))!==JSON.stringify(state.settings.excluded) || C.searchFilterKey(filters())!==C.searchFilterKey(state.settings) || JSON.stringify(C.normalizeRegions(values('regions')))!==JSON.stringify(state.settings.regions) || Number($("applyConcurrency").value)!==state.settings.applyConcurrency || Number($("delay").value)!==state.settings.delay || JSON.stringify(C.titleTerms($("excludedTitleTerms").value))!==JSON.stringify(state.settings.excludedTitleTerms) || JSON.stringify(C.titleTerms($("titleKeywords").value))!==JSON.stringify(state.settings.titleKeywords);}
  async function saveSettings(){
    if(settingsBusy||runner.active)throw new Error('현재 작업이 끝난 뒤 설정을 저장해 주세요.');
    settingsBusy=true;render();
    try{
    // Keep the stored text when the keyword list is unchanged so collected results stay valid.
    const keywordChanged=!C.sameKeywords($("keyword").value,state.settings.keyword);
    const keyword=keywordChanged?C.keywordText($("keyword").value):state.settings.keyword;if(!C.titleTerms(keyword).length)throw new Error("검색어를 입력해 주세요.");
    const searchChanged=keywordChanged||C.searchFilterKey(filters())!==C.searchFilterKey(state.settings);
    if(searchChanged){state.jobs=[];state.scans={};selected.clear();$("consent").checked=false;}
    state.settings={...state.settings,...filters(),keyword,titleKeywords:C.titleTerms($("titleKeywords").value),excludedTitleTerms:C.titleTerms($("excludedTitleTerms").value),excluded:C.companyList($("excluded").value),regions:C.normalizeRegions(values('regions')),applyConcurrency:Math.max(1,Math.min(5,Number($("applyConcurrency").value)||1)),delay:Math.max(6,Number($("delay").value)||6),dailyLimit:C.dailyLimitValue($("dailyLimit").value),includeNationwide:$("includeNationwide").checked,excludeExact:$("excludeExact").checked,excludeAppliedCompanies:true};
    $("excluded").value=state.settings.excluded.join("\n");
    $("excludedTitleTerms").value=state.settings.excludedTitleTerms.join(", ");
    state.ui.settingsCollapsed=true;
    runner.log("설정을 저장했습니다.");await runner.save();
    }finally{settingsBusy=false;render();}
  }
  $("saveSettings").addEventListener("click",wrap(saveSettings));
  $("scanHistoryAll").addEventListener("click",wrap(()=>runner.scanHistoryAll()));
  $("scanAll").addEventListener("click",wrap(async()=>{
    if(!C.clean(state.settings.keyword))throw new Error("원하는 검색어를 입력하고 설정을 저장해 주세요.");
    if(dirty())throw new Error("변경한 설정을 먼저 저장해 주세요.");
    if(state.settings.sites.every(site=>state.scans[site]?.status==="ready")){state.scans={};state.jobs=[];selected.clear();$("consent").checked=false;}
    await runner.scanSearchAll();
  }));
  $('resetWorkSummary').addEventListener('click',wrap(async()=>{
    if(runner.active||settingsBusy)throw new Error('진행 중인 작업을 먼저 중지해 주세요.');
    C.resetWorkSummary(state);selected.clear();$('consent').checked=false;renderedJobsSignature="";
    runner.log('이번 작업 집계와 선택 상태를 초기화했습니다. 지원 기록은 유지됩니다.');await runner.save();
  }));
  $('resetManual').addEventListener('click',wrap(async()=>{
    await runner.resetManual(Object.keys(state.attempts));
    selected.clear();$('consent').checked=false;renderedJobsSignature="";render();
  }));
  $("selectAll").addEventListener("change",()=>{const jobs=runner.jobs().filter(j=>j.eligible&&(!state.attempts[j.key]||state.attempts[j.key].status==='manual'));if($("selectAll").checked){
    const chosenCompanies=new Set(jobs.filter(job=>selected.has(job.key)).map(job=>C.companyKey(job.company)||job.key));
    for(const job of C.onePerCompany(jobs)){const company=C.companyKey(job.company)||job.key;if(!chosenCompanies.has(company)){selected.add(job.key);chosenCompanies.add(company);}}
  }else for(const job of jobs)selected.delete(job.key);renderedJobsSignature="";render();});
  $("filter").addEventListener("input",()=>{jobListPage=1;render();});$("viewFilter").addEventListener("change",()=>{jobListPage=1;render();});$("consent").addEventListener("change",render);
  $("previousJobs").addEventListener("click",()=>{jobListPage--;render();});$("nextJobs").addEventListener("click",()=>{jobListPage++;render();});
  for(const id of ["keyword","titleKeywords","excluded","excludedTitleTerms"])$(id).addEventListener("input",renderStart);
  for(const id of ['delay'])$(id).addEventListener('change',renderStart);
  $("autoApply").addEventListener("change",wrap(async()=>{state.settings.autoApply=$("autoApply").checked;$("consent").checked=false;runner.log(state.settings.autoApply?"자동지원을 켰습니다.":"자동지원을 껐습니다.");await runner.save();}));
  $("historyFilter").addEventListener("input",historyList);
  $("exportHistory").addEventListener("click",()=>download("지원기업_이력_"+new Date().toISOString().slice(0,10)+".json",{exportedAt:new Date().toISOString(),sites:Object.fromEntries(state.settings.sites.map(s=>[s,{collectedAt:state.histories[s]?.at,dateHints:state.histories[s]?.dateHints}])),jobs:C.uniqueJobs(runner.history())}));
  $("applyConcurrency").addEventListener("change",renderStart);
  for(const id of ["dailyLimit","includeNationwide","excludeExact"])$(id).addEventListener("change",renderStart);
  $("sortOrder").addEventListener("change",()=>{jobListPage=1;render();});
  $("editSettings").addEventListener("click",wrap(async()=>{state.ui.settingsCollapsed=false;await runner.save();$("keyword").focus();}));
  $("exportCsv").addEventListener("click",()=>{
    const jobs=runner.jobs(),seen=new Set(jobs.map(job=>job.key));
    const extra=Object.values(state.attempts).filter(attempt=>attempt.job&&!seen.has(attempt.job.key)).map(attempt=>({...attempt.job,eligible:false,reason:""}));
    const label=status=>badge(status)[0];
    const time=value=>value?new Date(value).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"}):"";
    const rows=[["사이트","기업","공고","지역","등록일","상태","사유","처리 시각","지원 클릭 시각","링크"]];
    for(const job of C.sortJobs([...jobs,...extra],$("sortOrder").value)){
      const attempt=state.attempts[job.key];
      rows.push([C.sites[job.site]?.label||job.site,job.company,job.title,job.location,job.postedDate,attempt?label(attempt.status):job.eligible?"지원 대상":"제외",attempt?.reason||job.reason||"",time(attempt?.at),time(attempt?.submittedAt),job.url]);
    }
    const url=URL.createObjectURL(new Blob([C.toCsv(rows)],{type:"text/csv;charset=utf-8"}));
    const link=element("a");link.href=url;link.download="지원결과_"+C.seoulDay()+".csv";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  $("start").addEventListener("click",wrap(async()=>{if(state.settings.autoApply&&!$("consent").checked)throw new Error("선택한 회사에 이력서 제출을 확인해 주세요.");await runner.resetManual([...selected].filter(key=>state.attempts[key]?.status==='manual'));await runner.start([...selected]);}));
  $('verifyResult').addEventListener('click',wrap(()=>runner.verifyResult()));
  $("resume").addEventListener("click",wrap(async()=>{if(state.settings.autoApply&&!$("consent").checked)throw new Error("목록의 회사에 이력서 제출을 확인해 주세요.");await runner.start([],true);}));
  $("skip").addEventListener("click",wrap(()=>runner.skip()));
  $("toggleRunPanel").addEventListener("click",wrap(async()=>{state.ui.runPanelCollapsed=!state.ui.runPanelCollapsed;await runner.save();}));
  $("stop").addEventListener("click",wrap(()=>runner.stop()));
  $("openTask").addEventListener("click",wrap(async()=>{const id=state.attempts[state.run.job?.key]?.tabId || state.run.tabs?.at(-1);if(id)await runner.focus(id);else if(state.run.job)await runner.open(state.run.job.url);}));
  $("export").addEventListener("click",()=>download("지원결과_"+new Date().toISOString().slice(0,10)+".json",{keyword:state.settings.keyword,exportedAt:new Date().toISOString(),jobs:runner.jobs(),attempts:state.attempts}));
  $("diagnostics").addEventListener("click",wrap(async()=>{if(runner.active)throw new Error("작업을 중지한 뒤 진단을 저장해 주세요.");runner.cancelled=false;download("지원도우미_화면진단.json",await runner.diagnostics());}));
  window.addEventListener("beforeunload",event=>{if(runner.active){event.preventDefault();event.returnValue="";}});
  loadSettings();await chrome.storage.session?.remove?.('fwaAIToken');render();await runner.save();
})();
