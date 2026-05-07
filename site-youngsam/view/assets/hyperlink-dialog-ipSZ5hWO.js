var e=class{overlay;dialog;urlInput;textInput;resolver=null;constructor(){this.build()}build(){this.overlay=document.createElement(`div`),this.overlay.className=`hop-hyperlink-overlay`,this.dialog=document.createElement(`div`),this.dialog.className=`hop-hyperlink-dialog`,this.dialog.setAttribute(`role`,`dialog`),this.dialog.setAttribute(`aria-modal`,`true`),this.dialog.setAttribute(`aria-labelledby`,`hop-hyperlink-title`),this.dialog.innerHTML=`
      <div class="hop-hyperlink-header">
        <div class="hop-hyperlink-icon" aria-hidden="true">🔗</div>
        <div>
          <div id="hop-hyperlink-title" class="hop-hyperlink-title">하이퍼링크 삽입</div>
          <div class="hop-hyperlink-subtitle">URL 과 보일 텍스트를 입력하세요.</div>
        </div>
        <button type="button" class="hop-hyperlink-close" aria-label="닫기">×</button>
      </div>

      <form class="hop-hyperlink-form" novalidate>
        <label class="hop-hyperlink-field">
          <span class="hop-hyperlink-field-label">URL</span>
          <input class="hop-hyperlink-url" type="url" required
                 placeholder="https://example.com"
                 autocomplete="off" spellcheck="false" />
        </label>
        <label class="hop-hyperlink-field">
          <span class="hop-hyperlink-field-label">
            보일 텍스트
            <span class="hop-hyperlink-field-hint">(비우면 URL 그대로)</span>
          </span>
          <input class="hop-hyperlink-text" type="text"
                 placeholder="예: 영삼넷 홈페이지"
                 autocomplete="off" />
        </label>

        <div class="hop-hyperlink-note">
          현재 버전은 URL/텍스트 형태로 본문에 삽입합니다. 클릭 가능한
          하이퍼링크 메타데이터 삽입은 코어 엔진 지원 시 활성화 예정.
        </div>

        <div class="hop-hyperlink-actions">
          <button type="button" class="hop-hyperlink-btn hop-hyperlink-btn-cancel">취소</button>
          <button type="submit" class="hop-hyperlink-btn hop-hyperlink-btn-primary">삽입</button>
        </div>
      </form>
    `,this.overlay.appendChild(this.dialog),this.urlInput=this.dialog.querySelector(`.hop-hyperlink-url`),this.textInput=this.dialog.querySelector(`.hop-hyperlink-text`),this.dialog.querySelector(`.hop-hyperlink-close`).addEventListener(`click`,()=>this.cancel()),this.dialog.querySelector(`.hop-hyperlink-btn-cancel`).addEventListener(`click`,()=>this.cancel()),this.dialog.querySelector(`.hop-hyperlink-form`).addEventListener(`submit`,e=>{e.preventDefault(),this.submit()}),this.overlay.addEventListener(`click`,e=>{e.target===this.overlay&&this.cancel()}),this.dialog.addEventListener(`keydown`,e=>{e.key===`Escape`&&(e.preventDefault(),this.cancel())})}show(e){return this.urlInput.value=e?.url??`https://`,this.textInput.value=e?.text??``,document.body.appendChild(this.overlay),requestAnimationFrame(()=>{this.urlInput.focus(),this.urlInput.select()}),new Promise(e=>{this.resolver=e})}submit(){let e=this.urlInput.value.trim();if(!e||e===`https://`||e===`http://`){this.urlInput.focus(),this.urlInput.classList.add(`hop-hyperlink-input-error`),setTimeout(()=>this.urlInput.classList.remove(`hop-hyperlink-input-error`),600);return}let t=this.textInput.value.trim();this.close({url:e,text:t||e})}cancel(){this.close(null)}close(e){this.overlay.parentNode&&this.overlay.parentNode.removeChild(this.overlay),this.resolver?.(e),this.resolver=null}};export{e as HyperlinkDialog};