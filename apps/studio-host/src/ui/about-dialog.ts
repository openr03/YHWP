/**
 * HOP 제품 정보 다이얼로그
 *
 * 업스트림 rhwp AboutDialog 를 확장하여 HOP 만의 정보를 표시한다.
 * - 상단 브랜드 영역 (로고 + 워드마크)
 * - HOP 버전 + 기술 스택
 * - 영삼넷 (youngsam.net) fork & 호스팅 카드
 * - rhwp 엔진 크레딧 카드
 * - 업스트림 고지/라이선스/저작권 (그대로 유지)
 *
 * Why: 단순히 버전만 표시하던 기본 About 을 정식 제품 정보로 격상.
 * fork 운영자(영삼넷) 정보를 명확히 노출.
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

const HOP_FORK_CARD: InfoCard = {
  emoji: '🌐',
  title: '영삼넷',
  subtitle: 'Fork & Hosting · youngsam.net',
  description:
    'HOP 의 fork 빌드와 hwp.youngsam.net 다운로드 사이트를 운영합니다.',
  links: [
    { label: 'hwp.youngsam.net', url: 'https://hwp.youngsam.net' },
    { label: 'youngsam.net', url: 'https://youngsam.net' },
  ],
};

const HOP_PROJECT_CARD: InfoCard = {
  emoji: '📦',
  title: 'HOP',
  subtitle: '업스트림 프로젝트 · MIT License',
  links: [
    { label: 'GitHub: golbin/hop', url: 'https://github.com/golbin/hop' },
    { label: '릴리즈 노트', url: 'https://github.com/golbin/hop/releases' },
  ],
};

const RHWP_ENGINE_CARD: InfoCard = {
  emoji: '⚙️',
  title: 'rhwp',
  subtitle: 'HWP 엔진 · by Edward Kim',
  links: [
    { label: 'GitHub: edwardkim/rhwp', url: 'https://github.com/edwardkim/rhwp' },
  ],
};

function buildBrand(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'about-brand';
  wrap.innerHTML = `
    <img class="about-brand-logo" src="/favicon.ico" alt="HOP" width="40" height="40" />
    <div class="about-brand-text">
      <div class="about-brand-name">HOP</div>
      <div class="about-brand-tag">Open HWP · 오픈소스 HWP 데스크톱 앱</div>
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

function buildSectionTitle(text: string): HTMLElement {
  const t = document.createElement('div');
  t.className = 'about-section-title';
  t.textContent = text;
  return t;
}

export class AboutDialog extends UpstreamAboutDialog {
  protected override createBody(): HTMLElement {
    const body = super.createBody();
    body.classList.add('about-body-hop');

    // 1) 상단 브랜드 영역 — 맨 앞에 삽입
    body.insertBefore(buildBrand(), body.firstChild);

    // 2) HOP 버전 (업스트림에서 영문 명칭이 길게 표시되니, 더 깔끔하게)
    const productEn = body.querySelector('.about-product-name');
    if (productEn instanceof HTMLElement) {
      productEn.style.display = 'none';
    }
    const productKo = body.querySelector('.about-product-name-ko');
    if (productKo instanceof HTMLElement) {
      productKo.textContent = 'HWP / HWPX 문서 데스크톱 앱';
      productKo.classList.add('about-product-name-ko-hop');
    }

    // 3) HOP 버전 라벨 (업스트림은 rhwp 버전 — HOP 버전을 위에 큼직하게)
    const version = body.querySelector('.about-version');
    if (version instanceof HTMLElement) {
      version.classList.add('about-version-rhwp');
      version.textContent = `rhwp engine ${__APP_VERSION__}`;
      const hopBig = document.createElement('div');
      hopBig.className = 'about-version-hop';
      hopBig.textContent = `HOP ${__HOP_VERSION__}`;
      version.parentNode?.insertBefore(hopBig, version);
    }

    // 기존 super 가 추가한 .about-hop-version 은 이제 중복 — 제거
    body.querySelector('.about-hop-version')?.remove();

    // 4) 기술 스택 다음에 fork & engine 카드 섹션 삽입
    const tech = body.querySelector('.about-tech');
    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'about-info-cards';
    cardsWrap.appendChild(buildCard(HOP_FORK_CARD));
    cardsWrap.appendChild(buildCard(HOP_PROJECT_CARD));
    cardsWrap.appendChild(buildCard(RHWP_ENGINE_CARD));

    const sectionTitle = buildSectionTitle('프로젝트 & 호스팅');

    if (tech?.parentNode) {
      tech.parentNode.insertBefore(sectionTitle, tech.nextSibling);
      tech.parentNode.insertBefore(cardsWrap, sectionTitle.nextSibling);
    } else {
      body.appendChild(sectionTitle);
      body.appendChild(cardsWrap);
    }

    // 5) 라이선스 섹션 제목을 통일된 스타일로
    const licenseTitle = body.querySelector('.about-license-title');
    if (licenseTitle instanceof HTMLElement) {
      licenseTitle.classList.add('about-section-title');
    }

    // 6) HOP 저작권 추가
    const copyright = body.querySelector('.about-copyright');
    if (copyright?.parentNode) {
      const hopCopy = document.createElement('div');
      hopCopy.className = 'about-copyright about-copyright-hop';
      hopCopy.textContent = '© 2026 HOP contributors · 영삼넷 fork';
      copyright.parentNode.insertBefore(hopCopy, copyright.nextSibling);
    }

    // 7) http(s) 외부 링크는 시스템 브라우저로 열기
    attachExternalLinkHandler(body);

    return body;
  }
}
