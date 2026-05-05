/**
 * YHWP 제품 정보 다이얼로그
 *
 * 업스트림 AboutDialog (modal popup) 를 확장하여 YHWP 정체성으로 채운다.
 * - 상단 브랜드 영역 (YHWP 로고 + 워드마크)
 * - YHWP 버전
 * - 영삼넷 (youngsam.net) 카드 하나만
 * - 업스트림 이름 / 외부 개발자 크레딧 카드는 모두 숨김
 *   (단, MIT 라이선스가 요구하는 라이선스 표 + 업스트림 저작권 줄은 보존 —
 *    이건 법적 의무라 임의 제거 불가, 대신 작게 표시)
 */

import { AboutDialog as UpstreamAboutDialog } from '@upstream/ui/about-dialog';
import { isTauriRuntime } from '@/core/bridge-factory';

async function openExternalUrl(url: string): Promise<void> {
  if (!isTauriRuntime()) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_external_url', { url });
  } catch (err) {
    console.warn('[about-dialog] open_external_url 실패:', err);
  }
}

function attachExternalLinkHandler(root: HTMLElement): void {
  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) return;
    e.preventDefault();
    void openExternalUrl(href);
  });
}

interface InfoLink {
  label: string;
  url: string;
}

interface InfoCard {
  emoji: string;
  title: string;
  subtitle: string;
  description?: string;
  links: InfoLink[];
}

const YHWP_CARD: InfoCard = {
  emoji: '🌐',
  title: '영삼넷',
  subtitle: 'youngsam.net',
  description:
    'YHWP 제작 · 운영 · hwp.youngsam.net 다운로드 사이트 운영.',
  links: [
    { label: 'hwp.youngsam.net', url: 'https://hwp.youngsam.net' },
    { label: 'youngsam.net', url: 'https://youngsam.net' },
  ],
};

function buildBrand(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'about-brand';
  wrap.innerHTML = `
    <img class="about-brand-logo" src="/favicon.ico" alt="YHWP" width="40" height="40" />
    <div class="about-brand-text">
      <div class="about-brand-name">YHWP</div>
      <div class="about-brand-tag">오픈소스 HWP / HWPX 데스크톱 앱</div>
    </div>
  `;
  return wrap;
}

function buildCard(card: InfoCard): HTMLElement {
  const el = document.createElement('div');
  el.className = 'about-info-card';
  const linksHtml = card.links
    .map(
      (link) => `
        <a class="about-info-link"
           href="${link.url}"
           target="_blank"
           rel="noopener noreferrer">
          ${link.label}
          <span class="about-info-arrow" aria-hidden="true">↗</span>
        </a>`,
    )
    .join('');
  el.innerHTML = `
    <div class="about-info-emoji" aria-hidden="true">${card.emoji}</div>
    <div class="about-info-body">
      <div class="about-info-title">${card.title}</div>
      <div class="about-info-subtitle">${card.subtitle}</div>
      ${card.description ? `<div class="about-info-desc">${card.description}</div>` : ''}
      <div class="about-info-links">${linksHtml}</div>
    </div>
  `;
  return el;
}

export class AboutDialog extends UpstreamAboutDialog {
  protected override createBody(): HTMLElement {
    const body = super.createBody();
    body.classList.add('about-body-hop');

    // 1) 상단 YHWP 브랜드
    body.insertBefore(buildBrand(), body.firstChild);

    // 2) 업스트림 영문 제품명 ("HWP 5.0 Compatible Module for Rust") 숨김
    const productEn = body.querySelector('.about-product-name');
    if (productEn instanceof HTMLElement) productEn.style.display = 'none';

    // 3) 한글 제품 설명 — 중립적인 문구로 교체
    const productKo = body.querySelector('.about-product-name-ko');
    if (productKo instanceof HTMLElement) {
      productKo.textContent = 'HWP / HWPX 문서 데스크톱 앱';
      productKo.classList.add('about-product-name-ko-hop');
    }

    // 4) 버전: 업스트림이 보여주던 "Version X.Y.Z" 줄을 작은 회색으로 격하시키고,
    //    위에 큰 "YHWP vX.Y.Z" 라벨을 추가
    const version = body.querySelector('.about-version');
    if (version instanceof HTMLElement) {
      version.style.display = 'none';
    }
    body.querySelector('.about-hop-version')?.remove();

    const yhwpBig = document.createElement('div');
    yhwpBig.className = 'about-version-hop';
    yhwpBig.textContent = `YHWP ${__HOP_VERSION__}`;
    const tech = body.querySelector('.about-tech');
    if (tech?.parentNode) {
      tech.parentNode.insertBefore(yhwpBig, tech);
    } else if (productKo?.parentNode) {
      productKo.parentNode.insertBefore(yhwpBig, productKo.nextSibling);
    }

    // 5) 기술 스택 ("Rust + WebAssembly + TypeScript") — 그대로 두되 숨길 수도 있음
    //    (지금은 그대로 표시)

    // 6) 영삼넷 카드 1개만 (HOP / rhwp 카드 제거)
    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'about-info-cards';
    cardsWrap.appendChild(buildCard(YHWP_CARD));

    if (tech?.parentNode) {
      tech.parentNode.insertBefore(cardsWrap, tech.nextSibling);
    } else {
      body.appendChild(cardsWrap);
    }

    // 7) 업스트림의 "한글과컴퓨터 공개 문서 참고" 고지문은 HWP 스펙 라이선스
    //    상 필수 표시 — 그대로 유지하되 작게.

    // 8) 라이선스 섹션 제목을 통일된 스타일로 (MIT 의무)
    const licenseTitle = body.querySelector('.about-license-title');
    if (licenseTitle instanceof HTMLElement) {
      licenseTitle.classList.add('about-section-title');
    }

    // 9) 업스트림 저작권 줄 ("© 2026 rhwp: Edward Kim") 은 MIT 의 "preserve
    //    copyright notice" 의무라 그대로 두되, YHWP 저작권을 위에 우선 표시
    const copyright = body.querySelector('.about-copyright');
    if (copyright?.parentNode) {
      const hopCopy = document.createElement('div');
      hopCopy.className = 'about-copyright about-copyright-hop';
      hopCopy.textContent = '© 2026 영삼넷 (youngsam.net)';
      copyright.parentNode.insertBefore(hopCopy, copyright);
      // 업스트림 저작권은 작게 표시
      if (copyright instanceof HTMLElement) {
        copyright.style.fontSize = '10px';
        copyright.style.opacity = '0.55';
      }
    }

    // 10) http(s) 외부 링크는 시스템 브라우저로 열기
    attachExternalLinkHandler(body);

    return body;
  }
}
