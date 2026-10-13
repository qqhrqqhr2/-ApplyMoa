(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FWA = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const searchBatchSize = 100;
  const searchPolicyVersion = 2;
  const contentProtocol = 11;
  const companyOptions = [
    {key:'sme',label:'중소기업',saramin:'scale004',jobkorea:'15'},
    {key:'medium',label:'중견기업',saramin:'scale003',jobkorea:'4'},
    {key:'large',label:'대기업',saramin:'scale001',jobkorea:'1'},
    {key:'top1000',label:'매출 1000대 기업',saramin:'scale002',jobkorea:'3'},
    {key:'foreign',label:'외국계',saramin:'foreign',jobkorea:'6'},
    {key:'public',label:'공기업·공공기관',saramin:'public',jobkorea:'8'},
    {key:'nonprofit',label:'비영리단체·협회',saramin:'nonprofit',jobkorea:'9'},
    {key:'kospi',label:'코스피 상장',saramin:'kospi',jobkorea:'11'},
    {key:'kosdaq',label:'코스닥 상장',saramin:'kosdaq',jobkorea:'12'},
    {key:'konex',label:'코넥스 상장',saramin:'konex',jobkorea:'13'}
  ];
  const employmentOptions = [
    {key:'regular',label:'정규직',saramin:'1',jobkorea:'1'},
    {key:'contract',label:'계약직',saramin:'2',jobkorea:'2'},
    {key:'intern',label:'인턴',saramin:'4',jobkorea:'3'},
    {key:'dispatch',label:'파견직',saramin:'6',jobkorea:'4'},
    {key:'freelance',label:'프리랜서',saramin:'9',jobkorea:'6'},
    {key:'parttime',label:'아르바이트',saramin:'5',jobkorea:'7'},
    {key:'trainee',label:'교육생·연수생',saramin:'12',jobkorea:'8'},
    {key:'military',label:'병역특례',saramin:'3',jobkorea:'9'},
    {key:'commission',label:'위촉직',saramin:'8',jobkorea:'10'}
  ];
  const regionOptions = ['서울','경기','인천','부산','대구','광주','대전','울산','세종','강원','충북','충남','전북','전남','경북','경남','제주','전국'];
  const regionGroups={"서울": ["강남구", "강동구", "강북구", "강서구", "관악구", "광진구", "구로구", "금천구", "노원구", "도봉구", "동대문구", "동작구", "마포구", "서대문구", "서초구", "성동구", "성북구", "송파구", "양천구", "영등포구", "용산구", "은평구", "종로구", "중구", "중랑구"], "경기": ["가평군", "고양시", "과천시", "광명시", "광주시", "구리시", "군포시", "김포시", "남양주시", "동두천시", "부천시", "성남시", "수원시", "시흥시", "안산시", "안성시", "안양시", "양주시", "양평군", "여주시", "연천군", "오산시", "용인시", "의왕시", "의정부시", "이천시", "파주시", "평택시", "포천시", "하남시", "화성시"], "강원": ["강릉시", "동해시", "삼척시", "속초시", "원주시", "춘천시", "태백시"], "충북": ["제천시", "청주시", "충주시"], "충남": ["계룡시", "공주시", "논산시", "당진시", "보령시", "서산시", "아산시", "천안시"], "전북": ["군산시", "김제시", "남원시", "익산시", "전주시", "정읍시"], "전남": ["광양시", "나주시", "목포시", "순천시", "여수시"], "경북": ["경산시", "경주시", "구미시", "김천시", "문경시", "상주시", "안동시", "영주시", "영천시", "포항시"], "경남": ["거제시", "김해시", "밀양시", "사천시", "양산시", "진주시", "창원시", "통영시"], "제주": ["서귀포시", "제주시"]};
  const detailedRegionOptions=Object.entries(regionGroups).flatMap(([province,cities])=>cities.map(city=>province+" "+city));
  function searchFilters(settings={}) {
    const select=(values,options,fallback)=>{
      if(values===undefined)return [fallback];
      if(!Array.isArray(values)||values.some(value=>!options.some(option=>option.key===value)))throw new Error('기업·고용 형태 설정을 다시 확인해 주세요.');
      return options.filter(option=>values.includes(option.key)).map(option=>option.key);
    };
    return {companyTypes:select(settings.companyTypes,companyOptions,'sme'),employmentTypes:select(settings.employmentTypes,employmentOptions,'regular')};
  }
  const searchFilterKey=settings=>JSON.stringify(searchFilters(settings));
  function filterCodes(site,settings={}) {
    const filters=searchFilters(settings);
    return {company:companyOptions.filter(o=>filters.companyTypes.includes(o.key)).map(o=>o[site]),employment:employmentOptions.filter(o=>filters.employmentTypes.includes(o.key)).map(o=>o[site])};
  }
  const sameCodes=(values,expected)=>values.length===expected.length&&new Set(values).size===values.length&&[...values].sort().every((value,index)=>value===[...expected].sort()[index]);
  function searchUrl(site,keyword,settings={}) {
    const codes=filterCodes(site,settings);
    const url=new URL(site==='saramin'?'https://www.saramin.co.kr/zf_user/search':'https://www.jobkorea.co.kr/Search/');
    url.searchParams.set(site==='saramin'?'searchword':'stext',keyword);
    if(site==='saramin'){url.searchParams.set('searchType','search');url.searchParams.set('recruitPage','1');url.searchParams.set('company_cd','0,1,2,3,4,5,6,7');url.searchParams.set('recruitPageCount','100');url.searchParams.set('quick_apply','y');}
    else{url.searchParams.set('tabType','recruit');url.searchParams.set('Page_No','1');url.searchParams.set('filter','2');}
    if(codes.company.length)url.searchParams.set(site==='saramin'?'company_type':'cotype',codes.company.join(','));
    if(codes.employment.length)url.searchParams.set(site==='saramin'?'job_type':'jobtype',codes.employment.join(','));
    return url.href;
  }
  const sites = {
    saramin: {label: "사람인", historyUrl: "https://www.saramin.co.kr/zf_user/persons/apply-status-list", searchUrl: (keyword,settings) => searchUrl('saramin',keyword,settings)},
    jobkorea: {label: "잡코리아", historyUrl: "https://www.jobkorea.co.kr/User/Applymng", searchUrl: (keyword,settings) => searchUrl('jobkorea',keyword,settings)}
  };
  const clean = value => String(value || "").replace(/\s+/g, " ").trim();
  const normalize = value => clean(value).normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  const companyKey = value => normalize(String(value || "").replace(/주식회사|\(\s*주\s*\)|㈜|\(\s*유\s*\)|유한회사/g, ""));
  function siteOf(value) {
    try {
      const u = new URL(value);
      if (u.protocol !== "https:" || u.username || u.password) return null;
      for (const site of Object.keys(sites)) {
        if (u.hostname === site + ".co.kr" || u.hostname.endsWith("." + site + ".co.kr")) return site;
      }
    } catch (_) { /* invalid URL */ }
    return null;
  }
  function posting(value, base) {
    try {
      const u = new URL(value, base);
      const site = siteOf(u.href);
      let id = null;
      if (site === "saramin" && /\/jobs\/(relay\/)?view(?:\/|$)/i.test(u.pathname)) id = u.searchParams.get("rec_idx");
      if (site === "jobkorea") id = u.pathname.match(/\/Recruit\/GI_Read\/(\d+)(?:\/|$)/i)?.[1];
      if (!id || !/^\d{4,12}$/.test(id)) return null;
      return {site, id, key: site + ":" + id, url: site === "saramin" ? "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=" + id : "https://www.jobkorea.co.kr/Recruit/GI_Read/" + id};
    } catch (_) { return null; }
  }
  function isHistory(value, site = siteOf(value)) {
    if (!site || siteOf(value) !== site) return false;
    const path = new URL(value).pathname.toLowerCase().replace(/\/$/, "");
    return site === "saramin" ? /^\/zf_user\/persons\/apply-status-list(?:\/page\/[1-9]\d{0,4})?$/.test(path) : path === "/user/applymng";
  }
  function isSearch(value, site = siteOf(value)) {
    if (!site || siteOf(value) !== site) return false;
    const path = new URL(value).pathname.toLowerCase().replace(/\/$/, "");
    return site === "saramin" ? /^\/zf_user\/search(?:\/recruit)?$/.test(path) : path === "/search";
  }
  function searchPage(value, page) {
    if (!isSearch(value) || !Number.isInteger(page) || page < 1) return null;
    const u=new URL(value);
    u.searchParams.set(siteOf(value)==="saramin"?"recruitPage":"Page_No",String(page));
    u.hash="";
    return u.href;
  }
  function sameSearch(left, right) {
    if(!isSearch(left)||!isSearch(right)||siteOf(left)!==siteOf(right))return false;
    const a=new URL(left),b=new URL(right);
    // Saramin uses both routes for the same search as its native UI updates the list.
    const path=u=>siteOf(u.href)==='saramin'?'/zf_user/search':u.pathname.toLowerCase().replace(/\/$/,"");
    if(a.origin!==b.origin||path(a)!==path(b))return false;
    const filters=u=>JSON.stringify([...u.searchParams].filter(([key])=>!(/^(?:Page_No|page)$/i.test(key)&&siteOf(u.href)==='jobkorea'||/^(?:recruitPage|page)$/i.test(key)&&siteOf(u.href)==='saramin')).sort(([ak,av],[bk,bv])=>ak.localeCompare(bk)||av.localeCompare(bv)));
    return filters(a)===filters(b);
  }
  function historyRange(now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));
    const year=Number(parts.year),month=Number(parts.month),day=Number(parts.day);
    const first=new Date(Date.UTC(year,month-3,1));
    const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
    const date=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(day,last)));
    return {months:2,start:date.toISOString().slice(0,10),end:`${parts.year}-${parts.month}-${parts.day}`};
  }
  function identityKey(job) {
    return job.company && job.title ? companyKey(job.company) + "|" + normalize(job.title) : "";
  }
  function applicationPosting(value) {
    try {
      const u = new URL(value);
      if (siteOf(u.href) !== "jobkorea" || !/^\/Recruit\/OnPass\/?$/i.test(u.pathname)) return null;
      const ids = [...u.searchParams].filter(([name]) => /^(?:gino|gi_no|gno)$/i.test(name)).map(([,id]) => id);
      if (!ids.length || new Set(ids).size !== 1 || !/^\d{4,12}$/.test(ids[0])) return null;
      return posting("https://www.jobkorea.co.kr/Recruit/GI_Read/" + ids[0]);
    } catch (_) { return null; }
  }
  function applicationResult(value) {
    try{
      const u=new URL(value);
      if(siteOf(u.href)!=='jobkorea'||!/^\/Recruit\/(?:OnPass\/)?OnPassResult\/?$/i.test(u.pathname))return null;
      const names=['gno','gino'];
      for(const name of names){const ids=[...u.searchParams].filter(([key])=>key.toLowerCase()===name).map(([,id])=>id);if(!ids.length)continue;if(new Set(ids).size!==1||!/^\d{4,12}$/.test(ids[0]))return null;return posting('https://www.jobkorea.co.kr/Recruit/GI_Read/'+ids[0]);}
    }catch(_){}
    return null;
  }
  function companyList(value) {
    const companies = new Map();
    for (const company of String(value || "").split(/[,;\n]/).map(clean).filter(Boolean)) {
      const key = companyKey(company);
      if (key && !companies.has(key)) companies.set(key,company);
    }
    return [...companies.values()];
  }
  function migrateState(state) {
    const legacy=(state.version||1)<5;
    Object.assign(state.settings,searchFilters(state.settings));
    state.settings.regions=normalizeRegions(state.settings.regions||[]);
    if ((state.version || 1) < 2) {
      state.settings.excluded = (state.settings.excluded || []).filter(company => companyKey(company) !== companyKey("범한유니솔루션"));
    }
    state.settings.excluded ||= [];
    if((state.version||1)<3){
      for(const meta of Object.values(state.histories||{}))if(['ready','review'].includes(meta.status)&&!meta.paginationVersion){
        meta.status='paused';meta.reviewed=false;meta.needsRestart=true;
        meta.reason='업데이트 후 지원 이력의 전체 페이지를 다시 확인해 주세요. 사이트 조회기간을 확인하고 1페이지에서 다시 수집하세요.';
      }
    }
    for(const [site,search] of Object.entries(state.scans||{})){
      if(legacy&&search.policyVersion===searchPolicyVersion&&!search.filterKey)search.filterKey=searchFilterKey({});
      if(search.policyVersion===searchPolicyVersion&&search.filterKey===searchFilterKey(state.settings))continue;
      search.status='paused';search.needsRestart=true;search.jobs=[];
      search.reason='설정한 기업·고용 형태와 즉시지원 조건으로 공고를 다시 수집해 주세요.';
      state.jobs=(state.jobs||[]).filter(job=>job.site!==site);
    }
    for(const meta of Object.values(state.histories||{}))if(meta.paginationVersion!==2||!meta.periodVerified){
      meta.status='paused';meta.reviewed=false;meta.needsRestart=true;
      meta.reason='최근 2개월 설정과 전체 페이지를 다시 확인해 주세요. 지원 이력 다시 수집을 누르면 1페이지부터 자동 조회합니다.';
    }
    for(const key of Object.keys(state.settings))if(key.startsWith('ai')||key==='resumeMeta')delete state.settings[key];
    delete state.ai;
    // The one-click automatic workflow was removed from the UI.
    delete state.workflow;
    delete state.settings.attachResume;
    // Completed per-keyword scans only need their counts; the merged list lives in scans[site].jobs.
    for(const search of Object.values(state.scans||{}))for(const term of Object.values(search?.termScans||{}))if(term?.status==='ready')compactScan(term);
    for(const job of state.jobs||[])for(const key of ['aiScore','aiReason','aiExplanation'])delete job[key];
    state.settings.excludedTitleTerms ??= [];
    if ((state.version || 1) < 7) {
      const previousDefaults = state.settings.excludedTitleTerms.map(term => normalize(term));
      if (previousDefaults.length === 2 && previousDefaults.includes('pcb') && previousDefaults.includes('회로')) {
        state.settings.excludedTitleTerms = [];
      }
    }
    state.settings.titleKeywords ??= [];
    state.settings.includeNationwide ??= true;
    state.settings.excludeExact ??= false;
    state.settings.dailyLimit=dailyLimitValue(state.settings.dailyLimit);
    state.settings.applyConcurrency=Math.max(1,Math.min(5,Math.floor(Number(state.settings.applyConcurrency)||1)));
    if(!state.workSummary||!Array.isArray(state.workSummary.baselineCompletedKeys))resetWorkSummary(state);
    state.version = 7;
    return state;
  }
  function compactScan(meta){
    if(!meta||!Array.isArray(meta.jobs))return meta;
    meta.jobCount=meta.jobs.length;
    delete meta.jobs;delete meta.seen;
    return meta;
  }
  function regionKey(value) {
    const mapped=clean(value).normalize("NFKC").replace(/서울특별시/g,"서울").replace(/부산광역시/g,"부산").replace(/대구광역시/g,"대구").replace(/인천광역시/g,"인천").replace(/광주광역시/g,"광주").replace(/대전광역시/g,"대전").replace(/울산광역시/g,"울산").replace(/세종특별자치시/g,"세종").replace(/경기도/g,"경기").replace(/강원특별자치도|강원도/g,"강원").replace(/충청북도/g,"충북").replace(/충청남도/g,"충남").replace(/전북특별자치도|전라북도/g,"전북").replace(/전라남도/g,"전남").replace(/경상북도/g,"경북").replace(/경상남도/g,"경남").replace(/제주특별자치도|제주도/g,"제주");
    return normalize(mapped.replace(/([가-힣]{2,})(시|군|구)(?=\s|$)/g,"$1"));
  }
  function dailyLimitValue(value){const n=Math.floor(Number(value)||0);return n>0?Math.min(n,500):0;}
  function regionMatches(location, regions, includeNationwide = false) {
    if (!regions || !regions.length) return true;
    if (!clean(location)) return false;
    const locations = String(location).split(/[,;|·/]|외\s*\d+\s*지역/).map(regionKey).filter(Boolean);
    // A nationwide posting fits any chosen region when the option is on.
    if (includeNationwide && locations.some(l => /^전국/.test(l))) return true;
    return regions.map(regionKey).filter(Boolean).some(r => locations.some(l => l.startsWith(r) || (r === "전국" && /전국/.test(l))));
  }
  function normalizeRegions(regions) {
    const values=[...new Set(regions.map(value=>{const cleanValue=clean(value);return regionOptions.find(option=>regionKey(option)===regionKey(cleanValue))||cleanValue;}).filter(Boolean))];
    return [...regionOptions.filter(option=>values.includes(option)),...values.filter(value=>!regionOptions.includes(value)).sort((a,b)=>a.localeCompare(b,'ko'))];
  }
  function uniqueJobs(jobs) {
    const found = new Map();
    for (const job of jobs) if (job.key) found.set(job.key, {...found.get(job.key), ...job});
    return [...found.values()];
  }
  function registeredDateText(value) {
    let raw=clean(value);
    const token='(?:\\d{4}[-./]\\d{1,2}[-./]\\d{1,2}|\\d{2}[-./]\\d{1,2}[-./]\\d{1,2}|\\d{1,2}[-./]\\d{1,2}|\\d+\\s*(?:일|시간|분)\\s*전|오늘|어제|방금)';
    const labeled=raw.match(new RegExp('(?:등록일|게재일|게시일|등록|게재)\\s*[:：]?\\s*('+token+')'))||raw.match(new RegExp('('+token+')\\s*(?:등록|게재|게시)'));
    if(labeled)raw=labeled[1];
    else if(/마감|수정|갱신|지원|접수/.test(raw))return '';
    const full=raw.match(/^(\d{4}|\d{2})[-./](\d{1,2})[-./](\d{1,2})(?:$|T|\s|\()/);
    if(full){
      const year=full[1].length===2?2000+Number(full[1]):Number(full[1]),month=Number(full[2]),day=Number(full[3]);
      const date=new Date(Date.UTC(year,month-1,day));
      if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return '';
      return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
    const partial=raw.match(/^(\d{1,2})[-./](\d{1,2})(?:$|\s|\()/);
    if(partial){const month=Number(partial[1]),day=Number(partial[2]),date=new Date(Date.UTC(2000,month-1,day));if(date.getUTCMonth()===month-1&&date.getUTCDate()===day)return `${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;return '';}
    const relative=raw.match(/^(?:\d+\s*(?:일|시간|분)\s*전|오늘|어제|방금)$/);
    return relative?clean(relative[0]):'';
  }
  function titleTerms(value){
    const seen=new Set();
    return String(value||'').split(/[,;\r\n]/).map(clean).filter(term=>{const key=term.normalize('NFKC').toLowerCase();if(!key||seen.has(key))return false;seen.add(key);return true;});
  }
  // Site keywords are stored as one "a, b" string. Split before whitespace is
  // collapsed so newline-separated keywords stay separate searches.
  const keywordText=value=>titleTerms(value).join(', ');
  const sameKeywords=(left,right)=>JSON.stringify(titleTerms(left))===JSON.stringify(titleTerms(right));
  function excludedTitleWord(title,terms){
    const normalized=clean(title).normalize('NFKC').toLowerCase();
    return (terms||[]).find(term=>normalized.includes(clean(term).normalize('NFKC').toLowerCase()))||'';
  }
  function classify(jobs, history, excluded = [], attempts = {}, regions = [], excludeAppliedCompanies = false, onePerCompany = true, excludedTitleTerms = [], requiredTitleTerms = [], options = {}) {
    const hKeys = new Set(history.map(j => j.key).filter(Boolean));
    const hIdentities = new Set(history.map(identityKey).filter(Boolean));
    const hCompanies = new Set(history.map(j=>companyKey(j.company)).filter(Boolean));
    const reservedKeys = new Set();
    const reservedIds = new Set();
    const reservedCompanies = new Set();
    for (const [key, attempt] of Object.entries(attempts)) {
      if (["completed", "submitting", "unknown"].includes(attempt.status)) {
        reservedKeys.add(key);
        if (attempt.job) reservedIds.add(identityKey(attempt.job));
        if (attempt.job?.company) {
          if (attempt.status === "completed") hCompanies.add(companyKey(attempt.job.company));
          else reservedCompanies.add(companyKey(attempt.job.company));
        }
      }
    }
    const seen = new Set();
    const seenCompanies = new Set();
    const excludedKeys = excluded.map(companyKey).filter(Boolean);
    return uniqueJobs(jobs).map(job => {
      const id = identityKey(job);
      const excludedWord=excludedTitleWord(job.title,excludedTitleTerms);
      let reason = "";
      if (!job.company || !job.title) reason = "회사·공고 확인 필요";
      else if (excludedKeys.some(k => options.excludeExact ? companyKey(job.company) === k : companyKey(job.company).includes(k))) reason = "제외 회사";
      else if (excludedWord) reason = "제목 제외 단어: "+excludedWord;
      else if (requiredTitleTerms.length&&!excludedTitleWord(job.title,requiredTitleTerms)) reason = "제목에 검색어 없음";
      else if (hKeys.has(job.key) || hIdentities.has(id) || job.alreadyApplied) reason = "기존 지원";
      else if (excludeAppliedCompanies && hCompanies.has(companyKey(job.company))) reason = "이미 지원한 기업";
      else if (reservedKeys.has(job.key) || reservedIds.has(id)) reason = "지원 결과 확인 필요";
      else if (reservedCompanies.has(companyKey(job.company))) reason = "기업 지원 결과 확인 필요";
      else if (regions.length && !job.location) reason = "지역 확인 필요";
      else if (!regionMatches(job.location, regions, options.includeNationwide)) reason = "설정 지역 밖";
      else if (seen.has(id)) reason = "동일 회사·제목 중복";
      else if (job.external) reason = "홈페이지 지원";
      else if (job.closed) reason = "마감 공고";
      else if (!job.immediate) reason = "즉시 지원 확인 필요";
      else if (onePerCompany && seenCompanies.has(companyKey(job.company))) reason = "같은 기업의 다른 포지션";
      // An excluded or external entry must not suppress a usable duplicate.
      if (!reason && id) {seen.add(id);seenCompanies.add(companyKey(job.company));}
      return {...job, eligible: !reason, reason};
    });
  }
  function guard(snapshot) {
    if (snapshot.blocked) return {ok: false, reason: snapshot.blocked};
    if (!snapshot.identity) return {ok: false, reason: "지원할 회사와 공고를 확인할 수 없습니다."};
    if (!snapshot.form) return {ok: false, reason: "등록 이력서 지원 양식을 확인할 수 없습니다."};
    if (snapshot.terms) return {ok: false, reason: "필수 동의 항목이 선택되지 않았습니다. 사이트에서 확인해 주세요."};
    if (snapshot.questions) return {ok: false, reason: "추가 질문 또는 작성할 항목이 있습니다."};
    if (snapshot.missingFields) return {ok: false, reason: "필수 입력 또는 모집분야 선택이 필요합니다."};
    if (!snapshot.resumeSelected) return {ok: false, reason: "제출할 등록 이력서를 사이트에서 선택해 주세요."};
    if (!snapshot.submitUnique) return {ok: false, reason: "최종 지원 버튼을 하나로 확인할 수 없습니다."};
    return {ok: true, reason: "등록 이력서로 지원 가능"};
  }
  function resetWorkSummary(state){
    state.workSummary={startedAt:new Date().toISOString(),baselineCompletedKeys:Object.entries(state.attempts||{}).filter(([,attempt])=>attempt.status==='completed').map(([key])=>key)};
  }
  // Calendar day in Korea, used for the daily application limit.
  const seoulDay = (value = new Date()) => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
  // Counts submit clicks made today. Keys in `pending` are counted once even before they submit.
  function dailyUsed(state, now = new Date(), pending = new Set()) {
    const today = seoulDay(now);
    let used = 0;
    for (const [key, attempt] of Object.entries(state.attempts || {})) if (!pending.has(key) && attempt?.submittedAt && seoulDay(attempt.submittedAt) === today) used++;
    return used + pending.size;
  }
  // Sort key for the posting date text shown by the sites (larger = newer, -Infinity = unknown).
  function postedSortKey(value, now = new Date()) {
    const raw = clean(value);
    if (!raw) return -Infinity;
    const [y, m, d] = seoulDay(now).split('-').map(Number);
    const today = Date.UTC(y, m - 1, d), day = 86400000;
    let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return Date.UTC(+match[1], match[2] - 1, +match[3]);
    match = raw.match(/^(\d{2})-(\d{2})$/);
    if (match) { let t = Date.UTC(y, match[1] - 1, +match[2]); if (t > today + day) t = Date.UTC(y - 1, match[1] - 1, +match[2]); return t; }
    if (/^(?:오늘|방금)$|^\d+\s*(?:시간|분)\s*전$/.test(raw)) return today;
    if (raw === '어제') return today - day;
    match = raw.match(/^(\d+)\s*일\s*전$/);
    return match ? today - match[1] * day : -Infinity;
  }
  function sortJobs(jobs, order = 'default', now = new Date()) {
    if (order === 'posted') return jobs.map((job, index) => ({job, index, key: postedSortKey(job.postedDate, now)})).sort((a, b) => b.key - a.key || a.index - b.index).map(item => item.job);
    if (order === 'company') return [...jobs].sort((a, b) => clean(a.company).replace(/주식회사|\(\s*주\s*\)|㈜/g, '').trim().localeCompare(clean(b.company).replace(/주식회사|\(\s*주\s*\)|㈜/g, '').trim(), 'ko') || clean(a.title).localeCompare(clean(b.title), 'ko'));
    return jobs;
  }
  // Excel-friendly CSV: BOM for Korean, quoted fields, formula-looking cells neutralized.
  function toCsv(rows) {
    const cell = value => {
      let text = value === undefined || value === null ? '' : String(value);
      if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    return '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  function workCounts(state){
    const baseline=new Set(state.workSummary?.baselineCompletedKeys||[]);
    const completed=Object.entries(state.attempts||{}).filter(([,attempt])=>attempt.status==='completed');
    return {current:completed.filter(([key])=>!baseline.has(key)).length,total:completed.length};
  }
  function resetManualAttempts(state,keys){
    const reset=[];
    for(const key of new Set(keys))if(state.attempts[key]?.status==='manual'){delete state.attempts[key];reset.push(key);}
    if(state.run?.status==='paused'&&reset.includes(state.run.job?.key))state.run={status:'idle'};
    return reset;
  }
  function groupCompanyJobs(jobs){
    const groups=new Map();
    for(const job of jobs){const key=companyKey(job.company)||job.key;if(!groups.has(key))groups.set(key,{key,company:job.company,jobs:[]});groups.get(key).jobs.push(job);}
    return [...groups.values()];
  }
  function onePerCompany(jobs) {
    const seen=new Set();
    return jobs.filter(job=>{const company=companyKey(job.company)||job.key;if(seen.has(company))return false;seen.add(company);return true;});
  }
  function selectCompanyJob(keys,jobs,key) {
    const job=jobs.find(item=>item.key===key);if(!job)return [...keys];
    const company=companyKey(job.company)||job.key;
    const conflicts=new Set(jobs.filter(item=>(companyKey(item.company)||item.key)===company).map(item=>item.key));
    return [...keys].filter(item=>!conflicts.has(item)).concat(key);
  }
  function initialState() {
    return {version: 7, settings: {keyword: "", titleKeywords:[], excluded: [], excludedTitleTerms:[], regions: [], includeNationwide: true, excludeExact: false, dailyLimit: 0, ...searchFilters(), autoApply: false, applyConcurrency:1, excludeAppliedCompanies: true, sites: ["saramin", "jobkorea"], delay: 6}, workSummary:{startedAt:new Date().toISOString(),baselineCompletedKeys:[]}, histories: {}, jobs: [], attempts: {}, scans: {}, logs: [], run: {status: "idle"}};
  }
  return {dailyLimitValue, seoulDay, dailyUsed, postedSortKey, sortJobs, toCsv, sites, companyOptions, employmentOptions, regionOptions, regionGroups, detailedRegionOptions, searchFilters, searchFilterKey, filterCodes, sameCodes, normalizeRegions, searchBatchSize, searchPolicyVersion, contentProtocol, clean, normalize, companyKey, siteOf, posting, applicationPosting, applicationResult, isHistory, isSearch, searchPage, sameSearch, historyRange, identityKey, companyList, migrateState, regionKey, regionMatches, uniqueJobs, classify, guard, registeredDateText, titleTerms, keywordText, sameKeywords, compactScan, excludedTitleWord, resetManualAttempts, resetWorkSummary, workCounts, groupCompanyJobs, onePerCompany, selectCompanyJob, initialState};
});
