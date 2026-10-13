/* DOM only: no fetch, cookies, credentials, private APIs, or form-value export. */
(function () {
  "use strict";
  if (globalThis.FWAContent) return;
  const C = globalThis.FWA;
  const site = C.siteOf(location.href);
  if (!site) return;
  const text = element => C.clean(element?.innerText || "");
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none";
  const all = (selector, root = document) => [...root.querySelectorAll(selector)];
  const controls = root => all('button,a,input[type="submit"],input[type="button"],[role="button"]', root).filter(visible);
  const label = el => text(el) || (el.matches("input") ? C.clean(el.value) : "") || C.clean(el.getAttribute("aria-label"));
  const jobLinks = root => all("a[href]", root).filter(a => C.posting(a.href));
  const distinct = root => new Set(jobLinks(root).map(a => C.posting(a.href).key));
  let currentPageOverride = null;
  let pagePermit = null;
  let spentPermit = null;
  const completionReceipts=new Set();
  let completionWatch=null;
  let openingJob = null;
  let applicationBinding = null;
  let portfolioSelection = null;
  const documentToken = Math.random().toString(36).slice(2);
  let historyPreparation = null;
  let searchSelection = C.searchFilters();

  function blocker() {
    const b = text(document.body);
    if (all('input[type="password"]').some(visible)) return "로그인이 필요합니다. 열린 사이트 탭에서 로그인한 뒤 다시 시작해 주세요.";
    if (/verify you are human|자동입력 방지|로봇이 아닙니다|비정상적인 접근|자동화된 접근|접근이 차단|보안 문자|captcha/i.test(b) && b.length < 16000) return "사이트의 보안 확인이 필요합니다. 자동 작업을 중지했습니다.";
    if (/접속이 제한|잠시 후 다시 시도|요청이 너무 많|too many requests|access denied/i.test(b) && b.length < 10000) return "사이트가 요청을 제한하거나 오류를 표시했습니다. 잠시 후 직접 확인해 주세요.";
    return "";
  }
  function applyLabel(root) {
    const labels = controls(root).map(label);
    return {immediate: labels.some(s => /^(?:즉시\s*지원|입사\s*지원)$/.test(s)), external: labels.some(s => /홈페이지\s*지원|자사\s*지원/.test(s)), alreadyApplied: labels.some(s => /^(지원\s*완료|이미\s*지원|지원\s*취소)/.test(s)), closed: labels.some(s => /^(마감|접수\s*마감|지원\s*마감)$/.test(s))};
  }
  function genericRow(anchor) {
    let el = anchor.parentElement;
    for (let depth = 0; el && depth < 9; depth++, el = el.parentElement) {
      if (["BODY", "HTML", "MAIN"].includes(el.tagName)) break;
      if (distinct(el).size > 1) break;
      const t = text(el);
      if (t.length > 35 && (el.matches("tr,li,article") || controls(el).some(e => !e.matches("a") && /지원|열람|불합격|서류|삭제/.test(label(e))))) return el;
    }
    return anchor.closest("tr,li,article") || anchor.parentElement?.parentElement;
  }
  function postedDate(row) {
    const explicit=all('[itemprop="datePosted"],[data-reg-date],[data-posted-date],[data-publish-date],.reg_date,.regDate,.registration-date,.posted-date,.datePosted',row);
    for(const element of explicit){
      const raw=element.getAttribute('content')||element.getAttribute('datetime')||element.getAttribute('data-reg-date')||element.getAttribute('data-posted-date')||element.getAttribute('data-publish-date')||text(element);
      const value=C.registeredDateText(raw);if(value)return value;
    }
    // Read registration labels only; generic dates can be application deadlines.
    for(const element of all('span,time,small,em,dd,p',row).filter(visible)){
      const raw=text(element);
      if(raw.length>90||!/등록일|게재일|게시일|등록|게재/.test(raw))continue;
      const value=C.registeredDateText(raw);if(value)return value;
    }
    return '';
  }
  function parseRow(row, anchor) {
    const post = C.posting(anchor.href);
    if (!post || !row) return null;
    const links = jobLinks(row).filter(a => C.posting(a.href).key === post.key);
    let titleEl = row.querySelector('.job_tit a,.job_tit,.recruit_title a,.recruit_tit a,.title a,[data-sentry-component="Title"],.recruitInfo a,.recruit-info a');
    if (!titleEl || !text(titleEl)) titleEl = links.find(a => a.querySelector("h2,h3,strong")) || links.reduce((best, a) => text(a).length > text(best).length ? a : best, anchor);
    let companyEl = row.querySelector('.corp_name a,.corp_name,.company_name,.company-name,.corpName,.companyName,.co_name,.coName,.company > a');
    if (!companyEl) companyEl = links.find(a => a !== titleEl && !a.contains(titleEl) && text(a) && !/로고$/.test(text(a)));
    let company = companyEl ? text(companyEl.querySelector("span") || companyEl) : "";
    if (!company) company = C.clean(row.querySelector('img[alt$=" 로고"]')?.alt?.replace(/ 로고$/, ""));
    const locationEl = row.querySelector('.job_condition span,[data-sentry-component="GrayChip"],.work_location,.location,.loc,.loc_long,.area');
    const location = text(locationEl).slice(0,220);
    const registered=postedDate(row);
    return {...post, company: company.slice(0,220), title: (C.clean(titleEl?.getAttribute("title")) || text(titleEl)).slice(0,450), location, ...(registered?{postedDate:registered}:{}), ...applyLabel(row)};
  }
  // History pages have different rows from search cards. A nested title <li>
  // is not the whole application row, and unrelated job links are not history.
  const historyContainers = '.list_apply,.apply_list,.applyList,#applyList,#ApplyList,#apply_list,.apply-status-list,.application-list,[data-sentry-component="ApplicationList"]';
  const unrelatedHistory = 'nav,header,footer,aside,[id*="recommend" i],[class*="recommend" i],[id*="hot100" i]';
  const companyFields = '.corp_name,.corpName,.company_name,.company-name,.companyName,.companyNm,.co_name,.coName,.co_nm,.company,.corp,.co,[data-sentry-component="CompanyName"]';
  const titleFields = '.job_tit,.recruit_title,.recruit_tit,.recruit_name,.recruitName,.recruitInfo,.recruit-info,.title,.tit,.subject,[data-sentry-component="Title"]';
  function historyPosting(el) {
    for (const value of [el.href,el.getAttribute('data-href'),el.getAttribute('data-url')]) {
      const post = value && C.posting(value,location.href);
      if (post?.site === site) return post;
    }
    // Read only quoted, supported posting URLs; never evaluate inline code.
    for (const source of [el.getAttribute('href'),el.getAttribute('onclick')]) {
      for (const match of (source || '').matchAll(/['"]((?:https:\/\/|\/)[^'"\s]+)['"]/g)) {
        const post = C.posting(match[1],location.href);
        if (post?.site === site) return post;
      }
    }
    return null;
  }
  function historyLinks(root) {
    return all('a[href],a[data-href],a[data-url]',root).filter(visible).filter(a=>!a.closest(unrelatedHistory)).map(anchor=>({anchor,post:historyPosting(anchor)})).filter(e=>e.post);
  }
  function historyTableColumn(row,pattern) {
    if (!row.matches('tr,[role="row"]')) return null;
    const table = row.closest('table,[role="table"]');
    if (!table) return null;
    const headers = all('th,[role="columnheader"]',table);
    const cells = [...row.children].filter(e=>e.matches('td,[role="cell"]'));
    if (!headers.length || headers.some(e=>Number(e.getAttribute('colspan')||1)>1)) return null;
    const index = headers.findIndex(e=>pattern.test(text(e)));
    return index >= 0 ? cells[index] || null : null;
  }
  const historyStatus = row => /지원\s*(?:완료|취소|일(?:자)?|날짜)|입사지원\s*(?:일|완료)|(?:미|최초\s*)?열람|서류\s*(?:전형|검토|합격|불합격)|불합격|최종\s*합격/.test(text(row));
  function historyEvidence(row) {
    return historyStatus(row) || !!row.closest(historyContainers) || !!(historyTableColumn(row,/기업|회사/) && historyTableColumn(row,/공고|채용|모집/));
  }
  const usefulHistoryText = el => {
    if (!el || !visible(el)) return '';
    const value = C.clean(el.getAttribute('title')) || text(el);
    return /^(?:공고\s*보기|상세\s*보기|상세\s*요강|채용\s*공고|기업\s*정보|입사지원|지원하기|지원\s*취소|지원\s*완료|열람|미열람|회사명|기업명|공고명)$/.test(value) ? '' : value;
  };
  function parseHistoryRow(row,entry) {
    const links = historyLinks(row).filter(e=>e.post.key===entry.post.key).map(e=>e.anchor);
    const named = selectors => all(selectors,row).filter(visible);
    const companyCell = historyTableColumn(row,/기업|회사/);
    const titleCell = historyTableColumn(row,/공고|채용|모집/);
    const choose = elements => elements.map(el=>({el,value:usefulHistoryText(el.matches('a')?el:(all('a',el).find(a=>usefulHistoryText(a))||el))})).find(e=>e.value);
    let title = choose([...(titleCell?[titleCell]:[]),...named(titleFields).filter(el=>!el.closest(companyFields))]);
    if (!title) title = choose(links.filter(a=>!a.closest(companyFields)).sort((a,b)=>usefulHistoryText(b).length-usefulHistoryText(a).length));
    const profileLinks = all('a[href]',row).filter(visible).filter(a=>{
      try { const u=new URL(a.href);return C.siteOf(u.href)===site && /\/company(?:-info|\/)|\/Recruit\/Co_(?:Read|Info)/i.test(u.pathname); }catch(_){return false;}
    });
    let company = choose([...(companyCell?[companyCell]:[]),...named(companyFields),...profileLinks]);
    if (!company) company = choose(links.filter(a=>a!==title?.el && !a.contains(title?.el) && !title?.el.contains(a)));
    const logo = all('img[alt]',row).filter(visible).find(e=>/\s로고$/.test(e.alt));
    return {...entry.post,company:(company?.value||C.clean(logo?.alt?.replace(/\s로고$/,''))).slice(0,220),title:(title?.value||'').slice(0,450),location:'',alreadyApplied:true};
  }
  function historyRow(entry) {
    let incomplete = null;
    for (let el=entry.anchor.parentElement,depth=0;el&&depth<12;el=el.parentElement,depth++) {
      if (el.matches('body,html,main') || el.matches(unrelatedHistory)) break;
      if (new Set(historyLinks(el).map(e=>e.post.key)).size>1) break;
      if (!historyEvidence(el)) continue;
      const job=parseHistoryRow(el,entry);
      if (job.company && job.title) return {row:el,job};
      if (!incomplete) incomplete={row:el,job};
    }
    return incomplete;
  }
  function historyCollection() {
    const entries=historyLinks(document);
    const found=new Map();
    let ignored=0;
    for (const entry of entries) {
      const hit=historyRow(entry);
      if (!hit) {ignored++;continue;}
      const previous=found.get(entry.post.key);
      if (!previous || (!previous.company || !previous.title) && hit.job.company && hit.job.title) found.set(entry.post.key,hit.job);
    }
    const jobs=[...found.values()].filter(j=>j.company&&j.title);
    const unread=[...found.values()].filter(j=>!j.company||!j.title);
    const empty=all('p,div,td,li',document).filter(visible).filter(e=>!e.closest(unrelatedHistory)).some(e=>/^\s*(?:(?:조회된?|검색된?|최근\s*\d+\s*(?:개월|년)\s*동안의)\s*)?(?:입사\s*)?지원\s*(?:내역|이력|현황|한\s*공고|한\s*채용)(?:이|가|은|는)?\s*(?:없습니다|없어요|없음)[.!]?\s*$/.test(text(e)));
    return {jobs,unread,ignored,empty:empty&&!found.size};
  }
  function collect(kind,filters) {
    if(filters)searchSelection=C.searchFilters(filters);
    const bad = blocker();
    if (bad) return {ok: false, reason: bad};
    if (kind === "history" && !C.isHistory(location.href, site)) return {ok: false, reason: "입사지원 현황 화면이 아닙니다. 로그인 후 지원 현황을 열어 주세요."};
    if (kind === "search" && !C.isSearch(location.href,site)) return {ok: false, reason: "검색 결과 화면이 아닙니다."};
    if(kind==='search'){
      const options=site==='saramin'?saraminSearchOptions():jobkoreaSearchOptions();
      if(!options.ready)return {ok:false,code:'SEARCH_OPTIONS',retryable:site==='saramin'?options.parametersReady:true,reason:'설정한 기업·고용 형태와 즉시지원 조건을 아직 확인하지 못했습니다. 화면 로딩 후 다시 확인합니다.'};
    }
    let rows = [];
    let history;
    if (kind === "history") {
      history=historyCollection();rows=history.jobs;
    } else if (kind === "search" && site === "saramin") {
      for (const row of all(".item_recruit",document.querySelector('#recruit_info')||document).filter(visible)) {
        const a = row.querySelector(".job_tit a[href]");
        if (a) rows.push(parseRow(row, a));
      }
    } else {
      // CPC cards outside JobList do not receive company/employment filters.
      const searchRoot=document.querySelector('[data-sentry-component="JobList"]');
      let anchors = kind === "search" && site === "jobkorea" ? all('a[data-sentry-component="Title"]',searchRoot||document).filter(a => C.posting(a.href) && visible(a)) : [];
      if (!anchors.length && searchRoot) anchors = jobLinks(searchRoot).filter(visible);
      for (const a of anchors) {
        if (a.closest('[id*="recommend" i],[class*="recommend" i],[id*="hot100" i]')) continue;
        const row = a.closest('[data-sentry-component="CardJob"]')||genericRow(a);
        if (row && distinct(row).size === 1) rows.push(parseRow(row, a));
      }
    }
    rows = C.uniqueJobs(rows.filter(Boolean));
    const sourceRows=rows;
    if(kind==='search')rows=rows.filter(row=>row.immediate&&!row.external&&!row.closed&&!row.alreadyApplied);
    const bodyText = text(document.body);
    const empty = kind === "history" ? history.empty : /검색\s*결과가\s*없|검색된\s*채용정보가\s*없|검색결과\s*0건/.test(bodyText);
    if (kind !== "history" && rows.some(r => !r.company || !r.title)) return {ok: false, reason: "일부 공고의 회사·제목을 읽을 수 없어 수집을 중지했습니다."};
    const pagination = pageInfo(kind);
    const dates=kind==='history'?historyDateFields():{};
    const dateHints=[dates.start,dates.end].filter(Boolean).map(e=>dateValue(e.value)).filter(Boolean);
    const result={site,jobs:rows,page:pagination.current,hasNext:!!pagination.next,signature:sourceRows.map(r=>r.key).sort().join("|"),dateHints,empty:empty||kind==='search'&&sourceRows.length>0&&!rows.length};
    if(kind==='search')result.policyVersion=C.searchPolicyVersion;
    if(kind==='search'&&site==='jobkorea')result.search={pageSize:20,batchSize:C.searchBatchSize,batchPages:pagination.batchPages||[]};
    if(kind==='history')result.pagination={verified:empty||pagination.verified,totalCount:pagination.totalCount,reason:pagination.reason};
    if (history?.unread.length) return {...result,ok:false,code:'HISTORY_FIELDS',unreadCount:history.unread.length,reason:`지원 이력 ${rows.length}건은 읽었지만 ${history.unread.length}건의 회사·제목을 확인하지 못했습니다. 수집 오류 진단을 저장해 주세요.`};
    if (!rows.length && !result.empty) return {...result,ok:false,code:'LIST_NOT_READY',retryable:true,reason:kind==='history'?'지원 이력 목록을 인식하지 못했습니다. 사이트 지원 현황을 확인하고 수집 오류 진단을 저장해 주세요.':'공고 목록을 인식하지 못했습니다. 로그인·페이지 로딩을 확인해 주세요. 화면 구조가 다르면 수정이 필요합니다.'};
    return {...result,ok:true};
  }
  const twoMonths = value => /^(?:(?:최근|지난)\s*)?2\s*개?월$/.test(C.clean(value));
  const dateValue = value => {const m=C.clean(value).match(/^(\d{4})[-./]?(\d{2})[-./]?(\d{2})$/);return m?`${m[1]}-${m[2]}-${m[3]}`:null;};
  function historyDateFields() {
    const inputs=all('input').filter(e=>!e.closest(unrelatedHistory)&&['date','text','hidden'].includes(e.type));
    const name=e=>[e.id,e.name,...[...(e.labels||[])].map(text)].join(' ');
    let starts=inputs.filter(e=>/(?:start|begin|from|searchs|applys|term_?s|\bs)[_-]?(?:date|dt)|(?:date|dt)[_-]?(?:range[_-]?)?(?:start|begin|from|s)(?:\b|$)|시작\s*(?:일|날짜)/i.test(name(e)));
    let ends=inputs.filter(e=>/(?:end|to|searche|applye|term_?e|\be)[_-]?(?:date|dt)|(?:date|dt)[_-]?(?:range[_-]?)?(?:end|to|e)(?:\b|$)|종료\s*(?:일|날짜)/i.test(name(e)));
    const dates=inputs.filter(e=>e.type==='date'&&visible(e));
    if(!starts.length&&!ends.length&&dates.length===2){starts=[dates[0]];ends=[dates[1]];}
    return {start:starts.length===1?starts[0]:null,end:ends.length===1?ends[0]:null};
  }
  function historyPreset() {
    const selects=all('select').filter(e=>visible(e)||visible(e.parentElement)).filter(e=>!e.closest(unrelatedHistory)).map(select=>({select,options:[...select.options].filter(option=>twoMonths(option.textContent))})).filter(e=>e.options.length===1);
    if(selects.length===1){const {select,options}=selects[0];return {element:select,option:options[0],selected:select.value===options[0].value};}
    const radios=all('input[type="radio"]').filter(e=>!e.closest(unrelatedHistory)).filter(e=>[...(e.labels||[])].some(l=>visible(l)&&twoMonths(text(l))));
    if(radios.length===1)return {element:radios[0],selected:radios[0].checked};
    const choices=[...new Set([...controls(document),...all('[role="option"],[data-value],[data-period],[data-month],[onclick]').filter(visible)])].filter(e=>!e.closest(unrelatedHistory)&&twoMonths(label(e)));
    const buttons=choices.filter(e=>!choices.some(other=>other!==e&&e.contains(other)));
    if(buttons.length===1){const element=buttons[0];return {element,selected:element.matches('.on,.active,.selected,[aria-pressed="true"],[aria-selected="true"],[data-state="checked"]')||!!element.closest('li.on,li.selected')||element.hasAttribute('aria-haspopup')};}
    return null;
  }
  function historyPeriod(range,previousDocument) {
    const bad=blocker();if(bad)return {ok:false,reason:bad};
    if(!C.isHistory(location.href,site))return {ok:false,reason:'로그인 후 지원 현황 화면에서 다시 시작해 주세요.'};
    if(!range||range.months!==2||!dateValue(range.start)||!dateValue(range.end)||range.start>=range.end)return {ok:false,reason:'지원 이력 조회기간이 올바르지 않습니다.'};
    const fields=historyDateFields(),preset=historyPreset();
    const dates=fields.start&&fields.end?[dateValue(fields.start.value),dateValue(fields.end.value)]:null;
    const matches=dates?dates[0]===range.start&&dates[1]===range.end:!!preset?.selected;
    let refreshed=!previousDocument||previousDocument!==documentToken;
    if(!refreshed&&historyPreparation?.started&&(!historyPreparation.queryRequired||historyPreparation.queryStarted)){
      const first=historyLinks(document)[0]?.anchor;
      const empty=historyEmptyMarker();
      refreshed=!!historyPreparation.refreshed||(first?first!==historyPreparation.first:!!empty&&empty!==historyPreparation.empty);
    }
    if(refreshed&&previousDocument)currentPageOverride=null;
    return {ok:matches&&refreshed&&(!previousDocument||historyPageInfo().current===1),matches,refreshed,documentToken,dates,reason:historyPreparation?.error||'최근 2개월 조회기간 적용과 1페이지 목록 갱신을 확인하지 못했습니다.'};
  }
  function historyEmptyMarker(){return all('p,td,li,div').filter(visible).filter(e=>!e.closest(unrelatedHistory)&&!e.children.length).find(e=>/^(?:(?:조회된?|검색된?)\s*)?(?:입사\s*)?지원\s*(?:내역|이력|현황)(?:이|가|은|는)?\s*없(?:습니다|어요|음)[.!]?$/.test(text(e)));}
  async function prepareHistory(range) {
    const bad=blocker();if(bad)return {ok:false,reason:bad};
    const checked=historyPeriod(range);
    if(!C.isHistory(location.href,site)||!range||range.months!==2||!dateValue(range.start)||!dateValue(range.end)||range.start>=range.end)return {ok:false,reason:'지원 현황 화면과 최근 2개월 조회기간을 확인해 주세요.'};
    let fields=historyDateFields(),preset=historyPreset();
    if(!preset){
      const openers=[...controls(document),...all('[role="combobox"]').filter(visible)].filter(e=>!e.closest(unrelatedHistory)&&/^(?:(?:최근|지난)\s*)?\d+\s*개?월(?:\s*[▾▼])?$|^(?:조회\s*기간|기간\s*선택|전체\s*기간)$/.test(label(e)));
      if(openers.length===1){openers[0].click();await waitFor(()=>!!historyPreset(),2000);preset=historyPreset();fields=historyDateFields();}
    }
    if(!preset&&!(fields.start&&fields.end))return {ok:false,reason:'최근 2개월 조회 옵션을 찾지 못했습니다. 사이트에서 지난 2개월로 조회한 뒤 다시 실행해 주세요.'};
    const root=(preset?.element||fields.start).closest('form')||document.querySelector('main,#content,.content')||document;
    const queries=controls(root).filter(e=>!e.closest(unrelatedHistory)&&/^(?:조회|검색|조회하기|검색하기|기간\s*조회|적용|적용하기|기간\s*적용)$/.test(label(e)));
    if(queries.length>1||!queries.length&&!preset)return {ok:false,reason:'지원 이력 조회 버튼을 하나로 확인하지 못했습니다. 사이트에서 지난 2개월로 조회한 뒤 다시 실행해 주세요.'};
    const query=queries[0];
    if(!query&&checked.ok&&historyPageInfo().current===1)return {ok:true,ready:true,documentToken};
    if(query){
      const form=query.closest('form');const action=form?.getAttribute('action');const href=query.getAttribute('href');
      if(action&&!C.isHistory(new URL(action,location.href).href,site)||href&&!href.startsWith('#')&&!/^javascript:/i.test(href)&&!C.isHistory(new URL(href,location.href).href,site))return {ok:false,reason:'지원 현황 조회 주소를 확인하지 못했습니다.'};
    }
    historyPreparation?.observer?.disconnect();
    historyPreparation={first:historyLinks(document)[0]?.anchor,empty:historyEmptyMarker(),started:false,queryRequired:!!query,queryStarted:false,refreshed:false};
    const oldRow=historyPreparation.first&&historyRow({anchor:historyPreparation.first,post:historyPosting(historyPreparation.first)})?.row;
    const observer=new MutationObserver(records=>{
      if(!historyPreparation.started||historyPreparation.queryRequired&&!historyPreparation.queryStarted)return;
      if(records.some(record=>record.type==='characterData'&&oldRow?.contains(record.target)||record.type==='childList'&&(oldRow?.contains(record.target)||[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&(node===oldRow||node.contains?.(oldRow)||all('a[href],a[data-href],a[data-url]',node).some(historyPosting))))))historyPreparation.refreshed=true;
    });
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});historyPreparation.observer=observer;
    // Reply before a native change/query handler reloads this document.
    setTimeout(()=>{
      try{
        historyPreparation.started=true;
        const setDates=()=>{const f=historyDateFields();const pairs=[[f.start,range.start],[f.end,range.end]].filter(([input])=>input);for(const [input,value] of pairs){
          const previous=C.clean(input.value);const formatted=previous.includes('.')?value.replaceAll('-','.'):previous.includes('/')?value.replaceAll('-','/'): /^\d{8}$/.test(previous)?value.replaceAll('-',''):value;
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,formatted);
        }for(const [input] of pairs){input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}};
        setDates();
        if(preset&&(!preset.selected||!query)){if(preset.option){Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(preset.element,preset.option.value);preset.element.dispatchEvent(new Event('change',{bubbles:true}));}else preset.element.click();}
        if(query)setTimeout(()=>{try{
          setDates();
          for(const input of all('input[type="hidden"]',query.closest('form')||root))if(pageParam(input.name)||pageParam(input.id))input.value='1';
          currentPageOverride=null;historyPreparation.first=historyLinks(document)[0]?.anchor;historyPreparation.empty=historyEmptyMarker();historyPreparation.refreshed=false;historyPreparation.queryStarted=true;query.click();
        }catch(e){historyPreparation.error=e.message;}},150);
      }catch(e){historyPreparation.error=e.message;}
    },60);
    return {ok:true,navigating:true,documentToken};
  }
  const pageValue=value=>/^\d{1,5}$/.test(C.clean(value))&&Number(value)>0?Number(value):null;
  const pageParam=name=>/^(?:page|page_?no|page_?num|page_?number|current_?page|page_?index|page_?idx|p)$/i.test(name||'');
  function pageFromUrl(value) {
    try {
      const u=new URL(value,location.href);
      if(!C.isHistory(u.href,site))return null;
      // Saramin's native links retain ?page=1 on every page; the route is authoritative.
      const pathPage=site==='saramin'&&u.pathname.match(/\/page\/([1-9]\d{0,4})\/?$/)?.[1];
      if(pathPage)return Number(pathPage);
      for(const [name,value] of u.searchParams)if(pageParam(name)&&pageValue(value))return pageValue(value);
    } catch(_) { /* A script link is clicked through the site's own handler. */ }
    return null;
  }
  function historyPageNumber(el) {
    for(const name of ['data-page','data-page-no','data-page-num','data-page-number','data-pageno','data-page_no','data-page_num','data-page-idx','page','page_no','page_num','pageno']){
      const number=pageValue(el.getAttribute(name));if(number)return number;
    }
    const plain=pageValue(label(el));if(plain)return plain;
    const spoken=label(el).match(/^(?:(?:현재|선택된)\s*페이지\s*)?(\d+)\s*(?:페이지(?:\s*(?:(?:로\s*)?이동|보기))?)?(?:\s*현재\s*페이지)?$/);
    if(spoken)return pageValue(spoken[1]);
    const accessible=C.clean(el.getAttribute('aria-label')||el.getAttribute('title'));
    const named=accessible.match(/^(?:page\s*)?(\d+)\s*(?:페이지|page)?(?:\s*(?:로\s*이동|보기))?$/i);
    if(named)return pageValue(named[1]);
    const href=el.getAttribute('href');const linked=href&&pageFromUrl(href);if(linked)return linked;
    // Extract only the page argument; never run/evaluate source text ourselves.
    const inline=[href,el.getAttribute('onclick')].filter(Boolean).join(' ');
    const call=inline.match(/(?:[\w$.]*(?:page|paging|paginate)[\w$]*)\s*\(\s*['"]?(\d+)['"]?\s*(?:,|\))/i);
    return call? pageValue(call[1]):null;
  }
  const pagerExcluded='header,footer,aside,[id*="recommend" i],[class*="recommend" i],[id*="hot100" i]';
  const historyPagerSelector='.pagination,.paging,.page_navi,.wrap_paging,.tplPagination,.PageWrap,.PageBox,.page_wrap,.paginate,[class*="pagination" i],[class*="paging" i],[id*="pagination" i],[id*="paging" i],[aria-label*="페이지"],[aria-label*="pagination" i],[data-total-pages]';
  function historyPagerControls(root) {
    return all('button,a,input[type="submit"],input[type="button"],[role="button"],[role="link"],[onclick],[data-page],[data-page-no],[data-page-num]',root).filter(visible).filter(el=>!el.closest(pagerExcluded)&&!historyPosting(el));
  }
  function pageMarker(root) {
    if(!root)return null;
    const marked=all('[aria-current="page"],[aria-current="true"],.on,.current,.now,.active,.selected,.select,.curr,strong,b,em,span.page',root).filter(visible).find(el=>historyPageNumber(el));
    const plain=all('span',root).filter(visible).find(el=>pageValue(text(el))&&!el.closest('a,button,[role="button"]'));
    return marked||plain;
  }
  const nextHistoryControl=el=>{
    const accessible=C.clean([label(el),el.getAttribute('aria-label'),el.getAttribute('title'),...all('img[alt]',el).map(img=>img.alt)].filter(Boolean).join(' '));
    return !/이전|처음|마지막|previous|prev|first|last/i.test(accessible)&&(/다음|next/i.test(accessible)||/(?:^|[\s_-])(?:btn_?)?next(?:page)?(?:$|[\s_-])/i.test(el.className));
  };
  const enabledPage=el=>!el.disabled&&!el.hasAttribute('disabled')&&!el.closest('[aria-disabled="true"],.disabled,.disable');
  function historyTotalCount() {
    const values=new Set();
    for(const el of all('[data-total-count],.total_count,.totalCount,.total,.count,.list_info,.listInfo,.result_count,[class*="total" i],p,h2,h3,span,strong,em').filter(visible)){
      if(el.closest(pagerExcluded)||text(el).length>90)continue;
      const data=el.getAttribute('data-total-count');
      if(data!==null&&/^\d+$/.test(data)){values.add(Number(data));continue;}
      const match=text(el).match(/(?:총\s*(?:지원)?|전체|입사\s*지원(?:\s*(?:현황|내역))?|지원\s*(?:현황|내역|이력|공고|완료))\s*(?:전체|총)?\s*[:：]?\s*\(?([\d,]+)\)?\s*(?:건|$)/);
      if(match)values.add(Number(match[1].replace(/,/g,'')));
    }
    return values.size===1?[...values][0]:null;
  }
  function historyPageInfo() {
    const roots=new Set(all(historyPagerSelector).filter(visible).filter(el=>!el.closest(pagerExcluded)));
    // Also recognize compact number/button groups whose class names changed.
    for(const control of historyPagerControls(document).filter(el=>historyPageNumber(el)||nextHistoryControl(el))){
      for(let el=control.parentElement,depth=0;el&&depth<3;el=el.parentElement,depth++){
        if(el.matches('body,html,main,form')||historyLinks(el).length)break;
        const buttons=historyPagerControls(el);
        if(buttons.length<=60&&(buttons.filter(e=>historyPageNumber(e)).length>=2||(pageMarker(el)&&buttons.some(e=>historyPageNumber(e)||nextHistoryControl(e)))))roots.add(el);
      }
    }
    const ranked=[...roots].map(root=>{
      const buttons=historyPagerControls(root);
      const numbered=buttons.filter(el=>historyPageNumber(el));
      const marker=pageMarker(root);
      const usable=numbered.length||buttons.some(nextHistoryControl)||marker;
      const score=(marker?30:0)+(numbered.length?20:0)+(buttons.some(nextHistoryControl)?10:0)-buttons.length/100;
      return {root,buttons,marker,usable,score};
    }).filter(item=>item.usable&&!historyLinks(item.root).length).sort((a,b)=>b.score-a.score);
    const pager=ranked[0];
    const input=all('input[type="hidden"]').find(el=>pageParam(el.name||el.id)&&pageValue(el.value));
    const current=(pager?.marker&&historyPageNumber(pager.marker))||currentPageOverride||pageFromUrl(location.href)||pageValue(input?.value)||1;
    const buttons=pager?.buttons||[];
    const next=buttons.find(el=>enabledPage(el)&&historyPageNumber(el)===current+1)||buttons.find(el=>enabledPage(el)&&nextHistoryControl(el)&&(!historyPageNumber(el)||historyPageNumber(el)===current+1));
    const later=buttons.some(el=>(historyPageNumber(el)||0)>current&&(!nextHistoryControl(el)||enabledPage(el))||enabledPage(el)&&nextHistoryControl(el));
    const totalCount=historyTotalCount();
    const visibleCount=historyCollection().jobs.length;
    const verified=!!next||!!pager&&!later||current===1&&totalCount!==null&&totalCount===visibleCount;
    const reason=verified?'':'지원 이력의 마지막 페이지를 확인하지 못했습니다. 지원 현황에서 다음 페이지를 연 뒤 이력 이어 수집을 누르거나 화면 구조 진단을 저장해 주세요.';
    return {current,next,verified,totalCount,reason,root:pager?.root,candidates:ranked.slice(0,4).map(item=>item.root)};
  }
  function pageInfo(kind) {
    if(kind==='history')return historyPageInfo();
    if (site === "saramin") {
      const root = (kind === "search" ? document.querySelector("#recruit_info") : document.querySelector("main,#content,.content")) || document;
      let pages = all(".pagination,.paging,.page_navi,.wrap_paging", root).filter(visible);
      if (!pages.length) pages = all(".pagination,.paging,.page_navi,.wrap_paging").filter(visible);
      const pg = pages.find(p => all("a[page],a[href]", p).length) || pages[0];
      const marker = pg?.querySelector("span.page,strong,.on,.current,[aria-current=page]");
      const current = Number(text(marker)) || currentPageOverride || Number(new URL(location.href).searchParams.get("recruitPage") || new URL(location.href).searchParams.get("page")) || 1;
      const links = pg ? all("a",pg).filter(visible).filter(e => !e.matches("[aria-disabled=true],.disabled")) : [];
      const number = a => {
        const attribute=Number(a.getAttribute("page"));if(attribute)return attribute;
        const href=a.getAttribute('href')||'';
        const u=href&&!href.startsWith('#')&&!/^javascript:/i.test(href)?new URL(href,location.href):null;
        return Number(u?.searchParams.get("recruitPage") || u?.searchParams.get("page")) || Number(text(a));
      };
      const next = links.find(a => number(a) === current + 1) || links.find(a => /다음|next/i.test(label(a) + a.className) && (number(a) === current + 1 || !number(a)));
      return {current, next};
    }
    const u = new URL(location.href);
    const pg=all('[data-sentry-component="Pagination"],.pagination,.paging,.page_navi,.wrap_paging,.tplPagination,[aria-label*="페이지"]',document).filter(visible).find(el=>all('a[href]',el).some(a=>C.sameSearch(a.href,location.href))||controls(el).some(e=>/^\d+$/.test(e.getAttribute('data-page')||text(e))))||null;
    const marker=pg && all('strong,b,.on,.current,.now,[aria-current="page"]',pg).filter(visible).find(e=>/^\d+$/.test(text(e)));
    const current = Number(text(marker)) || currentPageOverride || Number(u.searchParams.get("Page_No") || u.searchParams.get("page") || u.searchParams.get("Page")) || 1;
    const links = all("a[href]").filter(visible).filter(a => !a.matches("[aria-disabled=true],.disabled") && C.siteOf(a.href) === site);
    const number = a => {const v = new URL(a.href); return Number(v.searchParams.get("Page_No") || v.searchParams.get("page") || v.searchParams.get("Page"));};
    const localNext=pg && controls(pg).filter(e=>!e.disabled&&!e.matches('[aria-disabled="true"],.disabled')).find(e=>Number(e.getAttribute('data-page')||e.getAttribute('page')||text(e))===current+1||/^(다음|다음 페이지)$/.test(label(e)));
    const next = localNext || links.find(a => number(a) === current + 1 && new URL(a.href).pathname.toLowerCase().replace(/\/$/,"") === u.pathname.toLowerCase().replace(/\/$/,"")) || all("button",document).filter(visible).find(e => /^(다음|다음 페이지)$/.test(label(e)) && !e.disabled);
    const batchPages=[];
    // Use links the site actually exposes. Do not guess a last page or change filters.
    const numbered=new Map();
    for(const a of pg?all('a[href]',pg).filter(visible):[]){
      const n=number(a);
      if(Number.isInteger(n)&&n>current&&!a.matches('[aria-disabled=true],.disabled')&&C.sameSearch(a.href,location.href))numbered.set(n,a.href);
    }
    for(let page=current+1;page<current+Math.ceil(C.searchBatchSize/20)&&numbered.has(page);page++)batchPages.push({page,url:numbered.get(page)});
    return {current, next, batchPages};
  }
  function saraminSearchOptions() {
    const root=document.querySelector('#recruit_info');
    const general=root?.querySelector('input.company_cd#default');
    const dispatch=root?.querySelector('input.company_cd#dispatch');
    const headhunting=root?.querySelector('input.company_cd#headhunting');
    const size=root?.querySelector('.layer_filter.count li.selected button[position="recruit"]')?.getAttribute('value');
    const expected=C.filterCodes('saramin',searchSelection);
    // Saramin applies company_type/job_type from the address and carries them over when the
    // list is re-queried, but no longer checks the detailed-search boxes. Trust the address.
    const u0=new URL(location.href);
    const companyReady=parameterMatches(u0,'company_type',expected.company),employmentReady=parameterMatches(u0,'job_type',expected.employment);
    const instant=root?.querySelector('.btn_quick_apply');
    const u=new URL(location.href);
    const parametersReady=parameterMatches(u,'company_type',expected.company)&&parameterMatches(u,'job_type',expected.employment);
    const available=!!(general&&dispatch&&headhunting&&size&&instant);
    return {root,general,dispatch,headhunting,instant,companyReady,employmentReady,parametersReady,instantReady:!!instant?.classList.contains('apply_on'),size:Number(size)||null,available,ready:available&&parametersReady&&companyReady&&employmentReady&&instant.classList.contains('apply_on')&&general.checked&&!dispatch.checked&&!headhunting.checked&&Number(size)===100};
  }
  function parameterMatches(url,name,expected){
    const values=url.searchParams.getAll(name);
    return values.length<=1&&C.sameCodes(values.length&&values[0]?values[0].split(','):[],expected);
  }
  function jobkoreaSearchOptions(){
    const u=new URL(location.href),root=document.querySelector('[data-sentry-component="FilterList"]');
    const expected=C.filterCodes('jobkorea',searchSelection);
    const chosen=(name,count)=>!!root&&controls(root).some(e=>{const value=label(e).replace(/\s/g,'');return value===name+(count||'')||!count&&value===name+'0';});
    const companyReady=parameterMatches(u,'cotype',expected.company)&&chosen('기업형태',expected.company.length);
    const employmentReady=parameterMatches(u,'jobtype',expected.employment)&&chosen('고용형태',expected.employment.length);
    const instantReady=parameterMatches(u,'filter',['2'])&&chosen('조건추가',1);
    return {available:!!root,companyReady,employmentReady,instantReady,ready:companyReady&&employmentReady&&instantReady};
  }
  async function prepareSearch(resume=false,filters) {
    if(filters)searchSelection=C.searchFilters(filters);
    const bad=blocker();if(bad)return {ok:false,reason:bad};
    if(site==='jobkorea'&&C.isSearch(location.href,site)){
      if(await waitFor(()=>jobkoreaSearchOptions().ready,8000))return {ok:true,policyVersion:C.searchPolicyVersion,pageSize:20,batchSize:C.searchBatchSize,mode:'parallel-pages'};
      return {ok:false,restart:true,reason:'잡코리아의 기업·고용 형태 또는 즉시지원 조건이 설정과 다릅니다. 공고 수집을 다시 시작해 주세요.'};
    }
    if(site!=='saramin'||!C.isSearch(location.href,site))return {ok:false,reason:'사람인 검색 결과 화면이 아닙니다.'};
    let options=saraminSearchOptions();
    if(!options.companyReady||!options.employmentReady)await waitFor(()=>{const o=saraminSearchOptions();return o.companyReady&&o.employmentReady;},8000);
    options=saraminSearchOptions();
    if(!options.available)return {ok:false,reason:'사람인 일반 채용정보·100개씩 옵션을 읽을 수 없습니다. 검색 화면을 확인하고 수집 오류 진단을 저장해 주세요.'};
    if(!options.parametersReady||!options.companyReady||!options.employmentReady)return {ok:false,restart:true,reason:'사람인의 기업·고용 형태가 설정과 다릅니다. 공고 수집을 다시 시작해 주세요.'};
    if(options.ready)return {ok:true,policyVersion:C.searchPolicyVersion};
    if(resume)return {ok:false,restart:true,reason:'사람인 검색 조건이 바뀌었습니다. 공고 수집을 다시 시작하면 일반 채용정보만 · 100개씩으로 처음부터 읽습니다.'};
    const changed=async element=>{
      const list=document.querySelector('#recruit_info_list');const first=list?.querySelector('.item_recruit');const marker=list?.firstElementChild;
      element.click();
      const refreshed=await waitFor(()=>{
        const after=document.querySelector('#recruit_info_list');
        if(!after)return false;
        const row=after.querySelector('.item_recruit');
        if(row&&visible(row))return after!==list||row!==first;
        return /검색\s*결과가\s*없|검색된\s*채용정보가\s*없|검색결과\s*0건/.test(text(after))&&after.firstElementChild!==marker;
      },16000);
      if(!refreshed)throw new Error('사람인 검색 조건 변경 후 공고 목록이 갱신되지 않았습니다. 사이트 탭을 확인해 주세요.');
    };
    try{
      for(const [name,checked] of [['general',true],['dispatch',false],['headhunting',false]]){
        options=saraminSearchOptions();if(!options.available)throw new Error('사람인 검색 옵션을 다시 읽을 수 없습니다.');
        if(options[name].checked!==checked)await changed(options[name]);
      }
      options=saraminSearchOptions();
      if(!options.instantReady)await changed(options.instant);
      options=saraminSearchOptions();
      if(options.size!==100){
        const button=options.root.querySelector('.layer_filter.count button[value="100"][position="recruit"]');
        if(!button)throw new Error('사람인의 100개씩 표시 옵션을 찾을 수 없습니다.');
        if(!visible(button)){
          const trigger=button.closest('.item')?.querySelector('.btn_filter');
          if(!trigger)throw new Error('사람인의 공고 개수 메뉴를 열 수 없습니다.');
          trigger.click();if(!await waitFor(()=>visible(button),2000))throw new Error('사람인의 공고 개수 메뉴가 열리지 않았습니다.');
        }
        await changed(button);
      }
      return saraminSearchOptions().ready?{ok:true,policyVersion:C.searchPolicyVersion}:{ok:false,reason:'사람인의 기업·고용 형태 · 즉시지원 · 일반 채용정보만 · 100개씩 설정을 확인하지 못했습니다.'};
    }catch(error){return {ok:false,reason:error.message};}
  }
  async function nextPage(kind) {
    const before = collect(kind);
    if (!before.ok) return before;
    const info = pageInfo(kind);
    if (!info.next) return kind==='history'&&!info.verified?{ok:false,reason:info.reason}:{ok: true, end: true};
    const href = info.next.getAttribute("href");
    if(kind==='history'){
      if(href&&!href.startsWith('#')&&!/^javascript:/i.test(href)&&!C.isHistory(new URL(href,location.href).href,site))return {ok:false,reason:"다음 지원 현황 페이지 주소를 확인할 수 없습니다."};
      // Respond before a site handler reloads the document. This also handles
      // AJAX buttons; the runner waits for changed rows before counting a page.
      currentPageOverride=info.current+1;
      setTimeout(()=>info.next.click(),60);
      return {ok:true,navigating:true,expectedPage:info.current+1,previous:before.signature};
    }
    if (kind === "search" && site === "saramin") {
      // The site's UI preserves company filters, which a document reload resets.
      setTimeout(()=>info.next.click(),60);
      return {ok:true,navigating:true,expectedPage:info.current+1,previous:before.signature};
    }
    if (href && !href.startsWith("#") && !/^javascript:/i.test(href)) {
      const u = new URL(href,location.href);
      if (C.siteOf(u.href) !== site) return {ok:false,reason:"다음 페이지 주소를 확인할 수 없습니다."};
      if (kind === "search") {
        if (!C.isSearch(u.href,site)) return {ok:false,reason:"다음 검색 페이지 주소를 확인할 수 없습니다."};
        return {ok:true,navigating:true,navigationUrl:u.href,expectedPage:info.current+1,previous:before.signature};
      }
    }
    info.next.click();
    const changed = await waitFor(() => {
      const after = collect(kind);
      return after.ok && after.signature !== before.signature;
    }, 14000);
    if (!changed) return {ok:false,reason:"페이지가 바뀌지 않았습니다. 자동 수집을 멈췄습니다."};
    currentPageOverride = info.current + 1;
    return {ok:true,expectedPage:info.current+1, previous:before.signature};
  }
  async function waitFor(predicate, ms = 8000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (predicate()) return true;
      await new Promise(r => setTimeout(r, 250));
    }
    return false;
  }
  function mainIdentity(job) {
    const post=C.posting(location.href);
    if(!post||post.key!==job.key)return false;
    if(site==='jobkorea'){
      const header=document.querySelector('[data-jobview-section="atf"]');
      const headings=all('h1,h2,h3,[role="heading"],[class*="title" i],[class*="tit" i]',header||document);
      const title=headings.find(e=>visible(e)&&C.normalize(text(e))===C.normalize(job.title));
      if(!title||!C.companyKey(job.company))return false;
      const matches=root=>all('a,strong,span,p,h2,h3,.company,.corp_name,.company_name,[data-sentry-component="CompanyName"]',root).some(e=>visible(e)&&C.companyKey(text(e))===C.companyKey(job.company));
      if(header&&header.contains(title)&&matches(header))return true;
      for(let parent=title.parentElement,depth=0;parent&&parent!==document.body&&depth<7;parent=parent.parentElement,depth++)if(text(parent).length<6000&&matches(parent))return true;
      return false;
    }
    const header=document.querySelector('.jv_header[data-rec_idx="'+job.id+'"]');
    const titleEl=(header?all('h1',header):all('h1')).find(e=>visible(e)&&C.normalize(text(e))===C.normalize(job.title));
    if(!titleEl)return false;
    const head=header||titleEl.closest('.jv_header,header')||titleEl.parentElement?.parentElement;
    const corp=head?.querySelector('.company a,.company,.corp_name,a[href*="company-info"],a[href*="/company/"]');
    return !!corp&&C.companyKey(text(corp))===C.companyKey(job.company);
  }
  function applicationIdentity(job,scope=document.body){
    const popup=C.applicationPosting(location.href);
    const titleMatches=all('h1,h2,h3,[role="heading"],strong,p,span,div,[class*="title" i],[class*="tit" i]',scope).some(e=>visible(e)&&C.normalize(text(e))===C.normalize(job.title)&&![...e.children].some(child=>visible(child)&&C.normalize(text(child))===C.normalize(job.title)));
    const corp=scope.querySelector('.company,.corp_name,.company_name,.company-name,[data-sentry-component="CompanyName"]');
    const employerMatches=!corp||!visible(corp)||C.companyKey(text(corp))===C.companyKey(job.company);
    return {ok:!!popup,popupKey:popup?.key,titleMatches,employerMatches,protocolVersion:C.contentProtocol};
  }
  function scopeIdentity(scope, job) {
    const t = C.normalize(text(scope));
    const employer = C.companyKey(text(scope)).includes(C.companyKey(job.company));
    const title = t.includes(C.normalize(job.title));
    const linkId = jobLinks(scope).some(a => C.posting(a.href).key === job.key);
    const u = new URL(location.href);
    const current = C.posting(u.href);
    if (current && current.key !== job.key) return false;
    if (site === "jobkorea" && /^\/Recruit\/OnPass\/?$/i.test(u.pathname)) {
      // OnPass often shows the title and resume without the employer name.
      // The runner reaches this popup from an owned, verified detail page.
      const identity=applicationIdentity(job,scope);
      const bound=applicationBinding?.jobKey===job.key&&applicationBinding.popupKey===identity.popupKey;
      return identity.ok&&(identity.popupKey===job.key||bound)&&identity.titleMatches&&identity.employerMatches;
    }
    const urlId = [...u.searchParams].some(([name,id]) => /^(?:rec_idx|gino|gno|gi_no)$/i.test(name) && id === job.id);
    return employer && (title || linkId || urlId);
  }
  function resumeSelectionDialog(job){
    if(site!=='saramin'||C.posting(location.href)?.key!==job.key)return null;
    if(openingJob?.key!==job.key&&!mainIdentity(job))return null;
    const buttons=controls(document).filter(e=>/^이력서\s*선택\s*완료$/.test(label(e))&&!e.disabled);
    for(const button of buttons){
      for(let scope=button.parentElement,depth=0;scope&&scope!==document.body&&depth<12;scope=scope.parentElement,depth++){
        if(/지원할\s*이력서를\s*선택/.test(text(scope))&&all('input[type="radio"]',scope).length)return scope;
      }
    }
    return null;
  }
  function completeResumeSelection(job){
    const scope=resumeSelectionDialog(job);if(!scope)return {ok:false,reason:'이력서 선택 완료 화면을 확인하지 못했습니다.'};
    const radios=all('input[type="radio"]',scope).filter(e=>!e.disabled);
    if(!radios.some(e=>e.checked)){
      if(radios.length!==1)return {ok:false,reason:'여러 이력서 중 제출할 이력서를 직접 선택해 주세요.'};
      radios[0].click();
    }
    const button=controls(scope).find(e=>/^이력서\s*선택\s*완료$/.test(label(e))&&!e.disabled);
    if(!button)return {ok:false,reason:'이력서 선택 완료 버튼을 확인하지 못했습니다.'};
    button.click();return {ok:true};
  }
  function resumeMethodChoice(scope){
    if(!scope||!/지원\s*양식\s*선택/.test(text(scope)))return null;
    const exact=e=>/^(?:사람인\s*이력서로\s*지원|사람인\s*이력서\s*지원)$/.test(text(e));
    const targets=all('button,a,[role="button"],label,p,span,div',scope).filter(visible).filter(exact).filter(e=>!e.disabled&&e.getAttribute('aria-disabled')!=='true');
    return targets.find(e=>![...e.children].some(child=>visible(child)&&exact(child)))||null;
  }
  function selectResumeMethod(job){
    const scope=findForm(job),choice=resumeMethodChoice(scope);
    if(!scope||!scopeIdentity(scope,job)||!choice)return {ok:false,reason:'사람인 이력서 지원 방식을 확인하지 못했습니다.'};
    choice.click();return {ok:true};
  }
  function findForm(job) {
    const candidates = all('dialog,[role="dialog"],form,[id*="apply" i],[class*="apply_layer" i],[class*="apply-modal" i],[class*="applyModal"],[class*="apply_wrap" i],[class*="modal" i],[class*="layer" i]').filter(visible).filter(e => /이력서/.test(text(e)) && submitButtons(e).length > 0);
    if (/이력서/.test(text(document.body)) && /입사지원|지원하기|지원서\s*제출/.test(text(document.body)) && !C.posting(location.href)) candidates.push(document.body);
    // Method selection can appear before the final submit button becomes enabled.
    for(const labelNode of all('button,a,[role="button"],label,p,span,div').filter(visible).filter(e=>/^(?:사람인\s*이력서로\s*지원|사람인\s*이력서\s*지원)$/.test(text(e)))){
      for(let panel=labelNode.parentElement,depth=0;panel&&panel!==document.body&&depth<14;panel=panel.parentElement,depth++){
        if(visible(panel)&&scopeIdentity(panel,job)&&resumeMethodChoice(panel))candidates.push(panel);
      }
    }
    // The current Saramin side panel can use generic React containers with no apply/modal class.
    for(const button of submitButtons(document)){
      for(let panel=button.parentElement,depth=0;panel&&panel!==document.body&&depth<14;panel=panel.parentElement,depth++){
        if(visible(panel)&&(/선택된\s*이력서/.test(text(panel))||!!resumeMethodChoice(panel))&&scopeIdentity(panel,job)&&submitButtons(panel).length===1)candidates.push(panel);
      }
    }
    return candidates.filter(e => scopeIdentity(e,job)&&(resumeInfo(e).registeredRequired===true||!!resumeMethodChoice(e))).sort((a,b) => text(a).length - text(b).length)[0] || null;
  }
  function fieldLabel(el, scope) {
    const linked = el.id ? all("label",scope).find(l => l.htmlFor === el.id) : null;
    return text(linked || el.closest("label")) || C.clean(el.getAttribute("aria-label")) || text(el.closest("tr,li,fieldset,.field,.form_row,.input_row"));
  }
  function resumeInfo(scope) {
    if (!scope) return {selected:false,choice:null};
    const selects = all("select",scope).filter(visible).filter(e => /resume|이력서/i.test(e.id+" "+e.name+" "+fieldLabel(e,scope)));
    const radios = all('input[type="radio"]',scope).filter(e => visible(e) || visible(e.closest("label"))).filter(e => /resume|이력서/i.test(e.name+" "+e.id+" "+fieldLabel(e,scope)+" "+e.closest('[class*="resume" i],[id*="resume" i]')?.className));
    const selectedSelect = selects.some(e => e.selectedIndex >= 0 && !!e.value && !/^(?:[-\s]*|(?:이력서(?:를)?\s*)?(?:선택(?:하세요|해\s*주세요)?|등록|작성)|새\s*이력서)$/.test(text(e.selectedOptions[0])));
    const selectedRadio = all('input[type="radio"],input[type="checkbox"]',scope).some(e =>
      e.checked && !e.disabled && /resume|resumeno|r_idx|res_idx|이력서/i.test(e.name+' '+e.id+' '+fieldLabel(e,scope)+' '+(e.closest('[class*="resume" i],[id*="resume" i]')?.className||'')) &&
      !/새\s*이력서|이력서\s*작성|개인정보|동의/.test(fieldLabel(e,scope)));
    const storedSelection=all('input[type="hidden"]',scope).some(e=>{
      const name=(e.name||e.id||'').replace(/[_-]/g,'').toLowerCase();
      return /^(?:selected|select|apply|applicant|default)?(?:resume|resumeno|resumeid|resumeidx|resumenum|resumeindex|ridx|residx|resno|resid)(?:id|idx|no|num|index)?$/.test(name)&&/^[1-9][0-9]*$/.test(String(e.value||'').trim());
    });
    const marker = all('[data-selected-resume],.selected_resume,.resume_item.selected,.resume_list .selected,.resume_selected',scope).some(visible);
    const choice = radios.length === 1 && !radios[0].checked && !/새\s*이력서|이력서\s*작성/.test(fieldLabel(radios[0],scope)) ? radios[0] : null;
    const cardSelected = !radios.length && !selects.length && savedResumeCard(scope);
    const registeredRequired=!!(selects.length||radios.length||C.applicationPosting(location.href)||scope.querySelector('.resume_list,.saved-card,.selected_resume,.resume_selected')||/선택된\s*이력서|등록\s*이력서\s*(?:필수|선택)/.test(text(scope)));
    return {selected:selectedSelect || selectedRadio || storedSelection || marker || cardSelected,choice,registeredRequired};
  }
  function savedResumeCard(scope) {
    const headings = all('h1,h2,h3,h4,h5,h6,legend,strong,p,span,div,dt,label',scope).filter(visible).map(text);
    const explicit = headings.some(s => /^선택된\s*이력서(?:\s*이력서\s*(?:변경|수정))?$/.test(s));
    const onPass = !!C.applicationPosting(location.href) && headings.some(s => /^이력서$/.test(s));
    const currentCard=all('.resume_list,.resume_item,[class*="selected_resume" i],[class*="resume_selected" i],[class*="resume-card" i],[class*="resume_card" i]',scope).filter(visible).filter(card=>{
      const title=all('strong,b,h1,h2,h3,h4,h5,h6,[class*="title" i],[class*="tit" i]',card).filter(visible).map(text).some(value=>value.length>2&&!/^(?:이력서|선택된\s*이력서|이력서\s*(?:선택|등록|작성))$/.test(value));
      const change=controls(card).some(button=>/^(?:이력서\s*)?(?:변경|수정)$/.test(label(button)));
      return title&&change&&!/이력서(?:를)?\s*(?:선택해|선택하세요|등록해)/.test(text(card));
    });
    if(currentCard.length===1)return true;
    if (!explicit && !onPass) return false;
    const savedDate = s => /\d{4}[.\/-]\s*\d{1,2}[.\/-]\s*\d{1,2}.{0,40}저장/.test(s);
    const stamps = all('p,span,div,small,time,li,dt,dd',scope).filter(visible).filter(e => savedDate(text(e)) && ![...e.children].some(c => visible(c) && savedDate(text(c))));
    const cards = new Set();
    for (const stamp of stamps) {
      for (let card=stamp.parentElement,depth=0; card && scope.contains(card) && depth<8; card=card.parentElement,depth++) {
        if (/연락처|휴대폰|제출서류/.test(text(card))) break;
        const names = all('strong,b,h1,h2,h3,h4,h5,h6,p,span,div,dd,[class*="title" i],[class*="tit" i],[class*="resume-name" i]',card).filter(visible).filter(e => {
          const s = text(e);
          return s.length > 2 && s.length < 250 && !savedDate(s) && !/첨부파일|이력서에 첨부된 파일|선택된\s*이력서|이력서\s*(?:변경|수정)/.test(s) && !/^(이력서|선택된\s*이력서|제출\s*이력서|기본|수정|변경|등록|선택|이력서\s*변경)$/.test(s) && !/^https?:\/\//.test(s) && !e.closest('button,a,[role="button"]');
        });
        const basic = all('span,strong,b,em,div',card).filter(visible).some(e => /^기본$/.test(text(e)));
        if (names.length && (explicit || basic)) {cards.add(card);break;}
        if (card === scope) break;
      }
    }
    return cards.size === 1;
  }
  function portfolioControl(scope,pattern){
    const native=controls(scope).filter(e=>pattern.test(label(e))&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');
    if(native.length)return native.find(e=>!native.some(other=>other!==e&&e.contains(other)))||native[0];
    const labels=all('span,p,div',scope).filter(visible).filter(e=>pattern.test(text(e))&&![...e.children].some(child=>visible(child)&&pattern.test(text(child))));
    return labels.map(e=>e.closest('button,a,[role="button"]')||e).find(e=>!e.disabled&&e.getAttribute('aria-disabled')!=='true')||null;
  }
  function portfolioInfo(job){
    if(site!=='jobkorea'||!C.applicationPosting(location.href)||!scopeIdentity(document.body,job))return {required:false,ready:false};
    const headings=all('h1,h2,h3,h4,strong,p,span,div',document).filter(visible).filter(e=>/^첨부파일$/.test(text(e))&&![...e.children].some(child=>visible(child)&&/^첨부파일$/.test(text(child))));
    let section;
    for(const heading of headings){
      for(let node=heading.parentElement,depth=0;node&&node!==document.body&&depth<9;node=node.parentElement,depth++){
        if(/연락처|휴대폰/.test(text(node)))break;
        if(portfolioControl(node,/^파일\s*첨부$/)&&portfolioControl(node,/^변경(?:\s*\d+)?$/)){section=node;break;}
      }
      if(section)break;
    }
    if(!section&&headings.length===1){
      const start=headings[0];
      const end=all('h1,h2,h3,h4,strong,p,span,div',document).filter(visible).find(e=>/^연락처$/.test(text(e))&&!!(start.compareDocumentPosition(e)&4)&&![...e.children].some(child=>visible(child)&&/^연락처$/.test(text(child))));
      if(end){
        const includes=e=>start.contains(e)||!!(start.compareDocumentPosition(e)&4)&&!!(e.compareDocumentPosition(end)&4)&&!e.contains(start)&&!e.contains(end);
        const bounded={querySelectorAll:selector=>all(selector,document).filter(includes),contains:includes};
        Object.defineProperty(bounded,'innerText',{get:()=>all('*',bounded).filter(visible).filter(e=>!e.children.length).map(text).join(' ')});
        if(portfolioControl(bounded,/^파일\s*첨부$/)&&portfolioControl(bounded,/^변경(?:\s*\d+)?$/))section=bounded;
      }
    }
    if(!section)return {required:/포트폴리오.{0,30}(?:필수|필요|첨부해)/.test(text(document.body)),ready:false};
    const checkboxes=all('input[type="checkbox"]',section).filter(e=>!e.disabled&&(visible(e)||visible(e.closest('label'))));
    const confirm=portfolioControl(section,/^변경\s*하기$/);
    const editing=!!confirm&&checkboxes.length>0;
    const required=/포트폴리오.{0,30}(?:필수|필요|첨부해)/.test(text(section));
    const files=all('strong,b,h3,h4,p,span,div,a',section).filter(visible).filter(e=>{
      const value=text(e);return value.length<350&&/\.(?:pptx?|pdf|docx?|hwp|hwpx|zip|xlsx?|txt)(?:$|\s|\?)/i.test(value)&&![...e.children].some(child=>visible(child)&&/\.(?:pptx?|pdf|docx?|hwp|hwpx|zip|xlsx?|txt)(?:$|\s|\?)/i.test(text(child)));
    });
    return {section,checkboxes,confirm,editing,required,ready:!editing&&files.length>0,change:portfolioControl(section,/^변경(?:\s*\d+)?$/)};
  }
  function portfolioOpen(job){
    const info=portfolioInfo(job);
    if(!info.required||info.ready||info.editing)return {ok:true};
    if(!info.change)return {ok:false,reason:'포트폴리오 변경 버튼을 확인하지 못했습니다.'};
    info.change.click();return {ok:true};
  }
  function portfolioSelect(job){
    const info=portfolioInfo(job),first=info.checkboxes?.[0];
    if(!info.editing||!first)return {ok:false,reason:'선택할 등록 포트폴리오 파일이 없습니다.'};
    if(!first.checked)first.click();
    if(!first.checked)return {ok:false,reason:'첫 번째 포트폴리오 파일의 선택을 확인하지 못했습니다.'};
    portfolioSelection={key:job.key,input:first};return {ok:true};
  }
  function portfolioCommit(job){
    const info=portfolioInfo(job);
    if(portfolioSelection?.key!==job.key||!portfolioSelection.input.checked||!info.section?.contains(portfolioSelection.input)||!info.confirm)return {ok:false,reason:'포트폴리오 선택과 변경하기 버튼을 확인하지 못했습니다.'};
    info.confirm.click();return {ok:true};
  }
  function applicationResultComplete(job){
    const result=C.applicationResult(location.href);
    if(!result||(result.key!==job.key&&!(applicationBinding?.jobKey===job.key&&applicationBinding.popupKey===result.key)))return false;
    return controls(document).some(e=>visible(e)&&/^추가\s*지원$/.test(label(e))&&(e.disabled||e.getAttribute('aria-disabled')==='true'))||all('h1,h2,h3,strong,p,span,div').some(e=>visible(e)&&/지원\s*완료\s*되었습니다/.test(text(e)));
  }
  function formStamp(scope) {
    // Only a hash is kept in memory; form contents are never exported.
    const state = text(scope) + all('input[type="radio"],input[type="checkbox"],select',scope).map(e => e.name+":"+e.value+":"+e.checked).join("|")+all('input[type="file"]',scope).map(e=>[...e.files||[]].map(file=>file.name+':'+file.size+':'+file.lastModified).join('|')).join('|');
    let hash = 2166136261;
    for (let i=0;i<state.length;i++) hash = Math.imul(hash ^ state.charCodeAt(i),16777619);
    return hash >>> 0;
  }
  function submitButtons(scope) {
    const buttons=controls(scope).filter(e=>/^(?:지원\s*하기|입사\s*지원(?:\s*하기)?|지원서\s*제출|입사\s*지원\s*완료|제출\s*하기)$/.test(label(e))&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');
    return site==='jobkorea'?buttons.filter(button=>!buttons.some(other=>other!==button&&button.contains(other))):buttons;
  }
  function completionText(value){
    if(/(?:^|\s)입사\s*지원\s*완료\s*[!！](?:\s|$)|방금\s*지원한\s*공고는\s*지원\s*현황에서\s*확인/.test(value))return true;
    return /(?:입사\s*)?지원(?:이|을)?\s*(?:정상적으로\s*)?(?:완료\s*되었습니다|완료\s*했습니다|완료\s*하였습니다)|지원서(?:가|를)?\s*(?:정상적으로\s*)?(?:제출|접수)(?:되었습니다|했습니다)|성공적으로\s*지원(?:되었습니다|했습니다)/.test(value);
  }
  function watchCompletion(job,token){
    completionWatch?.stop();
    let timer,observer,confirmed=false;
    const stop=()=>{clearTimeout(timer);observer?.disconnect();document.removeEventListener('click',capture,true);if(completionWatch?.stop===stop)completionWatch=null;};
    const inspect=()=>{
      if(confirmed)return;
      const dialogSources=all('dialog,[role="dialog"],.apply_success,.apply_complete,.success_msg,.msg_complete,[class*="success" i],[class*="complete" i],[class*="modal" i],[class*="layer" i]').filter(visible);
      // Generic confirmation containers may lack a dialog role or a stable class.
      const sources=[...dialogSources,...all('h1,h2,h3,h4,h5,h6,strong,b,p,span,div',document).filter(e=>visible(e)&&completionText(text(e))&&![...e.children].some(child=>visible(child)&&completionText(text(child))))];
      const current=C.posting(location.href);
      const success=sources.some(e=>completionText(text(e))&&(scopeIdentity(e,job)||(openingJob?.key===job.key&&(!current||current.key===job.key))));
      if(!success)return;
      confirmed=true;completionReceipts.add(job.key);
      chrome.runtime.sendMessage({type:'FWA_APPLY_COMPLETE',key:job.key,token}).catch(()=>{});
      stop();
    };
    const capture=()=>inspect();
    observer=new MutationObserver(inspect);
    observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden']});
    document.addEventListener('click',capture,true);
    timer=setTimeout(stop,60000);completionWatch={stop};
    return inspect;
  }
  function primaryApplyControls(job){
    const pattern=/^(?:입사지원|사람인 입사지원|지원하기|즉시\s*지원|지원\s*완료|지원\s*취소)$/;
    if(site==='jobkorea'){
      if(!mainIdentity(job))return [];
      const containers=all('[data-sentry-component="ApplyButton"]');
      const precise=[...new Set(containers.flatMap(container=>[...(container.matches('button,a,input[type="submit"],[role="button"]')?[container]:[]),...controls(container)]))].filter(visible).filter(button=>pattern.test(label(button)));
      const actual=precise.filter(button=>!precise.some(other=>other!==button&&button.contains(other)));
      if(actual.length)return actual;
      const fallback=controls(document).filter(button=>pattern.test(label(button)));
      const immediate=fallback.filter(button=>/^즉시\s*지원$/.test(label(button)));
      const candidates=immediate.length?immediate:fallback;
      const leaves=candidates.filter(button=>!candidates.some(other=>other!==button&&button.contains(other)));
      return leaves.length===1?leaves:[];
    }
    const precise=all('.jv_header[data-rec_idx="'+job.id+'"] .btn_apply button,.jv_header[data-rec_idx="'+job.id+'"] .btn_apply a');
    if(precise.some(visible))return precise;
    const headers=all('.jv_header').filter(header=>visible(header)&&scopeIdentity(header,job));
    const scoped=headers.flatMap(header=>controls(header)).filter(button=>pattern.test(label(button)));
    if(scoped.length)return scoped;
    if(!mainIdentity(job))return [];
    const fallback=controls(document).filter(button=>pattern.test(label(button)));
    return fallback.length===1?fallback:[];
  }
  // Recruitment-area (지원분야/모집분야) dropdowns. Choose only when the answer is unambiguous:
  // a single real option, or exactly one option whose text appears in the posting title.
  const areaPattern=/모집\s*(분야|부문)|지원\s*(분야|부문)/;
  const placeholderOption=option=>!option||option.disabled&&!option.value||!C.clean(option.value)||/선택해|선택하세요|선택\s*$|^-+$/.test(C.clean(option.textContent));
  function areaSelects(form){
    return form?all('select',form).filter(e=>(visible(e)||visible(e.parentElement))&&!e.disabled&&areaPattern.test(fieldLabel(e,form)+' '+text(e)+' '+text(e.parentElement?.parentElement))):[];
  }
  function areaChoice(select,job){
    if(!placeholderOption(select.selectedOptions?.[0]))return null;
    const real=[...select.options].filter(option=>!option.disabled&&!placeholderOption(option));
    if(real.length===1)return real[0];
    const title=C.normalize(job.title);
    const matched=real.filter(option=>{const value=C.normalize(option.textContent);return value.length>=2&&title.includes(value);});
    return matched.length===1?matched[0]:null;
  }
  function selectArea(job){
    const form=findForm(job);
    if(!form||!scopeIdentity(form,job))return {ok:false,reason:'지원분야를 선택할 지원 화면을 확인하지 못했습니다.'};
    let changed=0;
    for(const select of areaSelects(form)){
      const option=areaChoice(select,job);if(!option)continue;
      // React/Vue keep their own state, so use the native setter and fire the usual events.
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,option.value);
      select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));
      changed++;
    }
    return changed?{ok:true,changed}:{ok:false,reason:'지원분야 선택지가 여러 개라 직접 선택해 주세요.'};
  }
  function probe(job) {
    const bad = blocker();
    const portfolio=portfolioInfo(job);
    const form = findForm(job);
    // Only a short acknowledgement or an owned form can provide success evidence.
    const dialogs = all('dialog,[role="dialog"],.apply_success,.apply_complete,.success_msg,.msg_complete,[class*="apply-success" i]').filter(visible);
    const sources = [form, ...dialogs].filter(Boolean);
    if (!C.posting(location.href) && text(document.body).length < 6000) sources.push(document.body);
    const currentPosting=C.posting(location.href);
    const matchedPosting=currentPosting?.key===job.key;
    const banners=all('h1,h2,h3,h4,h5,h6,strong,b,p,span,div',document).filter(e=>visible(e)&&completionText(text(e)));
    const success = applicationResultComplete(job)||completionReceipts.has(job.key)||[...sources,...banners].some(e => completionText(text(e)) && (scopeIdentity(e,job) || openingJob?.key === job.key || matchedPosting));
    if(success)completionReceipts.add(job.key);
    const detail = mainIdentity(job);
    const primaryControls = primaryApplyControls(job);
    const primary = primaryControls.filter(visible).filter(e=>!e.disabled&&e.getAttribute("aria-disabled")!=="true").filter(e=>/^(입사지원|사람인 입사지원|지원하기|즉시\s*지원)$/.test(label(e)));
    const already = detail && primaryControls.some(e=>visible(e)&&/지원\s*완료|지원\s*취소/.test(label(e)));
    const terms = !!form && all('input[type="checkbox"]',form).some(e => {
      const s = fieldLabel(e,form);
      return (visible(e) || visible(e.closest("label"))) && !e.checked && /동의|약관/.test(s) && (e.required || e.getAttribute("aria-required") === "true" || !/선택/.test(s));
    });
    const questions = !!form && (all('textarea,[contenteditable="true"]',form).some(visible) || all('input[type="file"]',form).some(e => visible(e) && (e.required || e.getAttribute("aria-required") === "true") && !e.files?.length && !(portfolio.ready&&portfolio.section?.contains(e))) || /사전\s*질문|추가\s*질문|사전\s*인터뷰|자기소개서\s*(작성|입력)|질문에\s*답/.test(text(form)));
    const missingFields = !!form && all("input[required],select[required],textarea[required],[aria-required=true]",form).filter(visible).filter(e=>!(e.matches('input[type="file"]')&&portfolio.ready&&portfolio.section?.contains(e))).some(e=> e.matches('input[type="checkbox"],input[type="radio"]') ? !e.checked && !(e.type === "radio" && all('input[type="radio"]',form).some(r=>r.name === e.name && r.checked)) : !e.value || e.validity?.valid === false);
    // Unselected recruitment-area controls must be filled by the applicant.
    const areaMissing = !!form && all("select,fieldset,.apply_field,.recruit_field",form).filter(visible).some(e => /모집\s*(분야|부문)|지원\s*(분야|부문)/.test(fieldLabel(e,form)+" "+text(e)) && (e.matches("select") ? !e.value || /선택/.test(text(e.selectedOptions?.[0])) : all('input[type="radio"],input[type="checkbox"]',e).length > 0 && !all("input:checked",e).length));
    const resume = resumeInfo(form);
    const submit = form ? submitButtons(form) : [];
    const actualForm = submit[0]?.form || form?.closest("form") || form?.querySelector("form");
    const destination = submit[0]?.getAttribute("formaction") || actualForm?.getAttribute("action") || (submit[0]?.matches("a") ? submit[0].getAttribute("href") : "");
    const externalDestination = !!destination && !/^javascript:/i.test(destination) && C.siteOf(new URL(destination,location.href).href) !== site;
    const canSelectArea = areaMissing && areaSelects(form).some(select=>!!areaChoice(select,job));
    const snapshot = {blocked:bad || (externalDestination ? "다른 사이트로 제출하는 양식입니다. 직접 확인해 주세요." : ""), identity:!!form && scopeIdentity(form,job), form:!!form, terms, questions, areaMissing, missingFields:missingFields || portfolio.required&&!portfolio.ready, resumeSelected:resume.selected, submitUnique:submit.length === 1};
    const gate = C.guard(snapshot);
    return {ok:true, success, already, detail, openAvailable:detail && primary.length > 0, form:!!form, gate, portfolioRequired:portfolio.required,portfolioReady:portfolio.ready,portfolioEditing:portfolio.editing,canSelectPortfolio:!!portfolio.checkboxes?.length, canCompleteResumeSelection:!!resumeSelectionDialog(job), canChooseResumeMethod:!!resumeMethodChoice(form), canSelectResume:!!resume.choice && !terms && !questions, canSelectArea, url:location.href, ...snapshot};
  }
  function openApply(job) {
    const p = probe(job);
    if (p.blocked) return {ok:false,reason:p.blocked};
    if (!p.detail || !p.openAvailable) return {ok:false,reason:"현재 공고의 지원 버튼을 확인할 수 없습니다. 홈페이지 지원 또는 화면 구조 변경일 수 있습니다."};
    if(p.form)return {ok:true,alreadyOpen:true};
    const button=primaryApplyControls(job).filter(visible).find(e=>!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&/^(입사지원|사람인 입사지원|지원하기|즉시\s*지원)$/.test(label(e)));
    if(!button)return {ok:false,reason:'지원 버튼이 아직 준비되지 않았습니다. 잠시 후 다시 선택해 주세요.'};
    button.scrollIntoView({block:'center',behavior:'instant'});
    openingJob = job;
    const application=C.applicationPosting(button.href||button.closest('a')?.href||'');
    button.click();
    return {ok:true,applicationKey:application?.key};
  }
  function selectResume(job) {
    const p = probe(job);
    if (!p.canSelectResume || p.blocked) return {ok:false,reason:p.gate.reason};
    resumeInfo(findForm(job)).choice.click();
    return {ok:true};
  }
  function arm(job, token) {
    const p = probe(job);
    if (!p.gate.ok) return {ok:false,reason:p.gate.reason};
    const form = findForm(job);
    pagePermit = {key:job.key, token, time:Date.now(), form, button:submitButtons(form)[0], stamp:formStamp(form)};
    return {ok:true};
  }
  function submit(job, token) {
    if (spentPermit === token) return {ok:false,reason:"같은 지원 제출을 반복하지 않습니다."};
    const p = probe(job);
    const form = findForm(job);
    const button = form && submitButtons(form)[0];
    if (!pagePermit || pagePermit.token !== token || pagePermit.key !== job.key || Date.now()-pagePermit.time > 15000 || pagePermit.form !== form || pagePermit.button !== button || !p.gate.ok || pagePermit.stamp !== formStamp(form)) {
      return {ok:false,reason:!p.gate.ok ? p.gate.reason : "지원 화면이나 선택된 서류가 바뀌었습니다. 다시 확인해 주세요."};
    }
    spentPermit = token;
    pagePermit = null;
    openingJob = job;
    const inspect=watchCompletion(job,token);
    button.click();inspect();
    return {ok:true,submitted:true};
  }
  function diagnostics(filters) {
    if(filters)searchSelection=C.searchFilters(filters);
    const shape=el=>({tag:el.tagName.toLowerCase(),classes:[...el.classList].filter(s=>/^[A-Za-z_][A-Za-z0-9_-]*$/.test(s)).slice(0,8).map(s=>s.replace(/\d/g,'#').slice(0,60)),children:el.children.length});
    let history,search;
    if (C.isHistory(location.href,site)) {
      const collected=collect('history');const pager=historyPageInfo();
      history={ok:collected.ok,code:collected.code||null,jobsCount:collected.jobs?.length||0,unreadCount:collected.unreadCount||0,page:collected.page||null,hasNext:!!collected.hasNext,samples:historyLinks(document).slice(0,8).map(entry=>{
        const parents=[];
        for(let el=entry.anchor;el&&parents.length<8;el=el.parentElement){parents.push(shape(el));if(el.matches('body,main,table'))break;}
        const hit=historyRow(entry);
        return {parents,recognized:!!hit,companyFound:!!hit?.job.company,titleFound:!!hit?.job.title,rowShape:hit?all('*',hit.row).filter(visible).slice(0,60).map(shape):[]};
      }),pagination:{verified:pager.verified,totalCount:pager.totalCount,current:pager.current,nextShape:pager.next?shape(pager.next):null,candidates:pager.candidates.map(root=>({shape:shape(root),controls:historyPagerControls(root).slice(0,30).map(el=>({shape:shape(el),page:historyPageNumber(el),next:nextHistoryControl(el),enabled:enabledPage(el),inlineHandler:!!el.getAttribute('onclick'),scriptLink:/^javascript:/i.test(el.getAttribute('href')||'')}))}))}};
    }
    if(C.isSearch(location.href,site)){
      const collected=collect('search');const pager=pageInfo('search');
      search={ok:collected.ok,code:collected.code||null,jobsCount:collected.jobs?.length||0,page:pager.current,hasNext:!!pager.next,nextShape:pager.next?shape(pager.next):null,samples:jobLinks(document).filter(visible).slice(0,6).map(a=>{
        const row=site==='saramin'?a.closest('.item_recruit'):genericRow(a);
        return {anchor:shape(a),rowShape:row?all('*',row).filter(visible).slice(0,60).map(shape):[]};
      })};
      if(site==='saramin'){
        const options=saraminSearchOptions();
        search.options={available:options.available,ready:options.ready,companyReady:options.companyReady,employmentReady:options.employmentReady,instantReady:options.instantReady,generalChecked:!!options.general?.checked,dispatchChecked:!!options.dispatch?.checked,headhuntingChecked:!!options.headhunting?.checked,pageSize:options.size};
      }
      if(site==='jobkorea')search.options={...jobkoreaSearchOptions(),pageSize:20,batchSize:C.searchBatchSize,maxPages:5,linkedNextPages:pager.batchPages.length};
    }
    return {version:2,site,path:location.pathname,headingCount:all("h1,h2").filter(visible).length,jobLinkCount:jobLinks(document).filter(visible).length,formCount:all("form").filter(visible).length,buttonLabels:controls(document).map(label).filter(s=>/^(?:입사지원|지원하기|지원서\s*제출|지원\s*취소|지원\s*완료|이력서\s*(?:변경|수정)|파일\s*(?:추가|첨부)|다음(?:\s*페이지)?)$/.test(s)).slice(0,40),history,search,frames:all("iframe").map(e=>{try {const u=new URL(e.src,location.href);return C.siteOf(u.href)?u.origin+u.pathname:"다른 사이트";}catch(_){return "주소 없음";}})};
  }
  const api = {selectArea,collect,nextPage,prepareSearch,prepareHistory,historyPeriod,probe,openApply,selectResume,arm,submit,diagnostics,mainIdentity};
  globalThis.FWAContent = api;
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
      if (sender.id !== chrome.runtime.id || !message || message.type !== "FWA_COMMAND") return;
      const job = message.job;
      if (job && (job.site !== site || !C.posting(job.url) || C.posting(job.url).key !== job.key)) {respond({ok:false,reason:"공고 주소가 올바르지 않습니다."});return;}
      if(message.applicationKey&&job){
        const result=C.applicationResult(location.href);
        if(result){
          if(result.key!==job.key&&result.key!==message.applicationKey){respond({ok:false,reason:'지원 결과 화면의 공고 번호가 다릅니다.'});return;}
          applicationBinding={jobKey:job.key,popupKey:message.applicationKey};
        }else{
          const identity=applicationIdentity(job);
          if(!identity.ok||identity.popupKey!==message.applicationKey||!identity.titleMatches||!identity.employerMatches){respond({ok:false,reason:'현재 새 지원 창의 공고를 확인할 수 없습니다.'});return;}
          applicationBinding={jobKey:job.key,popupKey:identity.popupKey};
        }
      }
      let result;
      switch(message.command) {
        case "identifyApplication": result=applicationIdentity(job); break;
        case "portfolioOpen": result=portfolioOpen(job); break;
        case "portfolioSelect": result=portfolioSelect(job); break;
        case "portfolioCommit": result=portfolioCommit(job); break;
        case "ping": result = {ok:true,site,url:location.href,protocolVersion:C.contentProtocol,readyState:document.readyState}; break;
        case "announce": chrome.runtime.sendMessage({type:"FWA_HELLO"}).catch(()=>{}); result={ok:true}; break;
        case "collect": result = collect(message.kind,message.filters); break;
        case "prepareSearch": result = prepareSearch(!!message.resume,message.filters); break;
        case "prepareHistory": result = prepareHistory(message.range); break;
        case "historyPeriod": result = historyPeriod(message.range,message.previousDocument); break;
        case "next": result = nextPage(message.kind); break;
        case "probe": result = probe(job); break;
        case "open": result = openApply(job); break;
        case "completeResumeSelection": result = completeResumeSelection(job); break;
        case "resumeMethod": result = selectResumeMethod(job); break;
        case "resume": result = selectResume(job); break;
        case "area": result = selectArea(job); break;
        case "arm": result = arm(job,message.token); break;
        case "submit": result = submit(job,message.token); break;
        case "diagnostics": result = diagnostics(message.filters); break;
        default: result = {ok:false,reason:"지원하지 않는 작업입니다."};
      }
      Promise.resolve(result).then(respond).catch(()=>respond({ok:false,reason:"화면을 읽는 중 오류가 발생했습니다."}));
      return true;
    });
    chrome.runtime.sendMessage({type:"FWA_HELLO"}).catch(()=>{});
  }
})();
