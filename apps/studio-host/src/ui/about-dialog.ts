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

const BRAND_CARDS: InfoCard[] = [
  {
    emoji: '🌐',
    title: '영삼넷',
    subtitle: 'youngsam.net',
    description: 'YHWP 제작 · 운영 · 배포 — 영삼넷의 오픈소스 프로그램 라인업의 한 축.',
    links: [
      { label: 'hwp.youngsam.net', url: 'https://hwp.youngsam.net' },
      { label: 'YHWP 소개 페이지 ↗', url: 'https://youngsam.net/programs/yhwp' },
      { label: 'youngsam.net', url: 'https://youngsam.net' },
    ],
  },
];

function buildBrand(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'about-brand';
  // 센터 정렬 — 로고를 상단 가운데에 크게, 그 아래 브랜드명 + 태그라인.
  wrap.innerHTML = `
    <img class="about-brand-logo" src="/favicon.ico" alt="YHWP" width="64" height="64" />
    <div class="about-brand-text">
      <div class="about-brand-name">YHWP</div>
      <div class="about-brand-tag">오픈소스 HWP · HWPX 데스크톱 앱</div>
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
    yhwpBig.textContent = `YHWP ${__YHWP_VERSION__}`;
    const tech = body.querySelector('.about-tech');
    if (tech?.parentNode) {
      tech.parentNode.insertBefore(yhwpBig, tech);
    } else if (productKo?.parentNode) {
      productKo.parentNode.insertBefore(yhwpBig, productKo.nextSibling);
    }

    // 5) 기술 스택 ("Rust + WebAssembly + TypeScript") — 그대로 두되 숨길 수도 있음
    //    (지금은 그대로 표시)

    // 6) 브랜드 카드들 (영삼넷 / GitHub / 피드백)
    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'about-info-cards';
    for (const card of BRAND_CARDS) {
      cardsWrap.appendChild(buildCard(card));
    }

    if (tech?.parentNode) {
      tech.parentNode.insertBefore(cardsWrap, tech.nextSibling);
    } else {
      body.appendChild(cardsWrap);
    }

    // 7) "한글과컴퓨터 공개 문서 참고" 고지문 / 라이선스 표 / 저작권 줄은
    //    영삼님 요청으로 about 다이얼로그 화면에서 모두 제거. (LICENSE 파일과
    //    git 저장소에는 그대로 보존되어 MIT 의 source-form 의무는 충족.)
    const hideSelectors = [
      '.about-notice',
      '.about-license-title',
      '.about-license-table',
      '.about-copyright',
    ];
    for (const sel of hideSelectors) {
      body.querySelectorAll<HTMLElement>(sel).forEach((el) => {
        el.style.display = 'none';
      });
    }

    // 8) http(s) 외부 링크는 시스템 브라우저로 열기
    attachExternalLinkHandler(body);

    return body;
  }
}
