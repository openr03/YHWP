import { AboutDialog as UpstreamAboutDialog } from '@/upstream/ui';

export class AboutDialog extends UpstreamAboutDialog {
  protected override createBody(): HTMLElement {
    const body = super.createBody();
    const version = body.querySelector('.about-version');

    const logo = document.createElement('img');
    logo.className = 'about-yhwp-logo';
    logo.src = '/images/yhwp-logo.png';
    logo.alt = 'YHWP';
    logo.width = 64;
    logo.height = 64;
    logo.style.cssText = 'display:block;margin:0 auto 8px;border-radius:14px';
    body.prepend(logo);

    const yhwpVersion = document.createElement('div');
    yhwpVersion.className = 'about-yhwp-version';
    yhwpVersion.textContent = `YHWP ${__YHWP_VERSION__}`;

    if (version?.parentNode) {
      version.parentNode.insertBefore(yhwpVersion, version.nextSibling);
    } else {
      body.appendChild(yhwpVersion);
    }

    const credits = document.createElement('div');
    credits.className = 'about-yhwp-credits';
    credits.textContent =
      '개발: 영삼넷(youngsam.net) · 엔진: rhwp(MIT) · 데스크톱 셸: HOP(MIT) · 아이콘: Lucide(ISC)\n' +
      '본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.';
    credits.style.cssText = 'white-space:pre-line;font-size:11px;color:var(--ui-text-muted);margin-top:8px;line-height:1.6';
    body.appendChild(credits);

    return body;
  }
}
