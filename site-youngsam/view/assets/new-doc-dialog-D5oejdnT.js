var e=`https://hwp.youngsam.net/templates/manifest.json`,t=class{overlay;dialog;categoryList;grid;statusEl;resolver=null;manifest=null;activeCategoryId=null;constructor(){this.build()}build(){this.overlay=document.createElement(`div`),this.overlay.className=`hop-newdoc-overlay`,this.dialog=document.createElement(`div`),this.dialog.className=`hop-newdoc-dialog`,this.dialog.setAttribute(`role`,`dialog`),this.dialog.setAttribute(`aria-modal`,`true`),this.dialog.innerHTML=`
      <div class="hop-newdoc-header">
        <div class="hop-newdoc-icon" aria-hidden="true">✨</div>
        <div class="hop-newdoc-titles">
          <div class="hop-newdoc-title">새 문서 만들기</div>
          <div class="hop-newdoc-subtitle">빈 문서로 시작하거나 템플릿을 선택하세요.</div>
        </div>
        <button type="button" class="hop-newdoc-close" aria-label="닫기">×</button>
      </div>

      <div class="hop-newdoc-body">
        <aside class="hop-newdoc-sidebar"></aside>
        <section class="hop-newdoc-grid-wrap">
          <div class="hop-newdoc-status"></div>
          <div class="hop-newdoc-grid" role="list"></div>
        </section>
      </div>

      <div class="hop-newdoc-footer">
        <span class="hop-newdoc-footer-hint">템플릿은 <a href="https://hwp.youngsam.net" target="_blank" rel="noopener">hwp.youngsam.net</a> 에서 동기화됩니다.</span>
        <button type="button" class="hop-newdoc-btn hop-newdoc-btn-cancel">취소</button>
      </div>
    `,this.overlay.appendChild(this.dialog),this.categoryList=this.dialog.querySelector(`.hop-newdoc-sidebar`),this.grid=this.dialog.querySelector(`.hop-newdoc-grid`),this.statusEl=this.dialog.querySelector(`.hop-newdoc-status`),this.dialog.querySelector(`.hop-newdoc-close`).addEventListener(`click`,()=>this.cancel()),this.dialog.querySelector(`.hop-newdoc-btn-cancel`).addEventListener(`click`,()=>this.cancel()),this.overlay.addEventListener(`click`,e=>{e.target===this.overlay&&this.cancel()}),this.dialog.addEventListener(`keydown`,e=>{e.key===`Escape`&&(e.preventDefault(),this.cancel())})}show(){return document.body.appendChild(this.overlay),this.loadManifest(),new Promise(e=>{this.resolver=e})}async loadManifest(){this.setStatus(`템플릿 목록 불러오는 중...`);try{let t=await fetch(e,{cache:`no-cache`});if(!t.ok)throw Error(`HTTP ${t.status}`);this.manifest=await t.json(),this.renderManifest(),this.setStatus(``)}catch(e){console.warn(`[new-doc] manifest fetch 실패:`,e),this.manifest=this.buildOfflineFallback(),this.renderManifest(),this.setStatus(`오프라인 — 빈 문서만 사용 가능합니다.`)}}buildOfflineFallback(){return{version:1,categories:[{id:`basic`,label:`기본`,templates:[{id:`blank`,name:`빈 문서`,desc:`비어있는 새 문서를 만듭니다.`,icon:`📄`,file:null}]}]}}renderManifest(){if(this.manifest){this.categoryList.innerHTML=``;for(let e of this.manifest.categories){let t=document.createElement(`button`);t.type=`button`,t.className=`hop-newdoc-cat`,t.textContent=e.label,t.dataset.catId=e.id;let n=e.templates.length,r=e.templates.filter(e=>!e.comingSoon).length,i=document.createElement(`span`);i.className=`hop-newdoc-cat-badge`,i.textContent=`${r}/${n}`,t.appendChild(i),t.addEventListener(`click`,()=>this.selectCategory(e.id)),this.categoryList.appendChild(t)}this.manifest.categories.length>0&&this.selectCategory(this.manifest.categories[0].id)}}selectCategory(e){this.activeCategoryId=e,this.categoryList.querySelectorAll(`.hop-newdoc-cat`).forEach(t=>{t.classList.toggle(`active`,t.dataset.catId===e)}),this.renderGrid()}renderGrid(){if(!this.manifest||!this.activeCategoryId)return;let e=this.manifest.categories.find(e=>e.id===this.activeCategoryId);if(e){this.grid.innerHTML=``;for(let t of e.templates){let e=document.createElement(`button`);e.type=`button`,e.className=`hop-newdoc-card`+(t.comingSoon?` is-coming-soon`:``),e.setAttribute(`role`,`listitem`),e.disabled=!!t.comingSoon,e.innerHTML=`
        <div class="hop-newdoc-card-icon" aria-hidden="true">${t.icon??`📄`}</div>
        <div class="hop-newdoc-card-name">${n(t.name)}</div>
        ${t.desc?`<div class="hop-newdoc-card-desc">${n(t.desc)}</div>`:``}
        ${t.comingSoon?`<div class="hop-newdoc-card-badge">준비 중</div>`:``}
      `,t.comingSoon||e.addEventListener(`click`,()=>this.choose(t)),this.grid.appendChild(e)}}}async choose(t){if(t.file===null){this.close({kind:`blank`});return}this.setStatus(`"${t.name}" 템플릿 다운로드 중...`);try{let n=t.file.startsWith(`http`)?t.file:new URL(t.file,e).toString(),r=await fetch(n,{cache:`no-cache`});if(!r.ok)throw Error(`HTTP ${r.status}`);let i=await r.arrayBuffer();this.close({kind:`template`,name:`${t.name}.hwp`,bytes:new Uint8Array(i)})}catch(e){console.warn(`[new-doc] template fetch 실패:`,e),this.setStatus(`"${t.name}" 다운로드 실패. 빈 문서로 시작하시겠어요?`)}}setStatus(e){this.statusEl.textContent=e,this.statusEl.style.display=e?``:`none`}cancel(){this.close(null)}close(e){this.overlay.parentNode&&this.overlay.parentNode.removeChild(this.overlay),this.resolver?.(e),this.resolver=null}};function n(e){return e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`).replace(/'/g,`&#39;`)}export{t as NewDocDialog};