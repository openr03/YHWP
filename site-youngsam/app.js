/* ──────────────────────────────────────────────
   THEME TOGGLE
   ────────────────────────────────────────────── */
const THEME_KEY = "hop:theme";
const root = document.documentElement;

function applyTheme(theme) {
    root.dataset.theme = theme;
}
function loadTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") applyTheme(saved);
    else applyTheme("auto");
}
function toggleTheme() {
    const current = root.dataset.theme;
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next =
        current === "auto"
            ? systemDark
                ? "light"
                : "dark"
            : current === "dark"
              ? "light"
              : "dark";
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
}
loadTheme();
document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);

/* ──────────────────────────────────────────────
   OS / ARCH DETECTION
   ────────────────────────────────────────────── */
function detectOS() {
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    const haystack = ua + platform;
    if (/iPhone|iPad|iPod|Android/i.test(ua)) return "mobile";
    if (/Mac/i.test(haystack)) return "mac";
    if (/Win/i.test(haystack)) return "windows";
    if (/Linux|X11/i.test(haystack)) return "linux";
    return "unknown";
}

async function detectMacArch() {
    // userAgentData is the most reliable
    if (navigator.userAgentData?.getHighEntropyValues) {
        try {
            const v = await navigator.userAgentData.getHighEntropyValues([
                "architecture",
                "bitness",
            ]);
            if (v.architecture === "arm") return "arm64";
            if (v.architecture === "x86") return "x64";
        } catch {
            /* fall through */
        }
    }
    // Heuristic: macOS 14+ is increasingly Apple Silicon
    const ua = navigator.userAgent || "";
    const m = ua.match(/Mac OS X (\d+)[._](\d+)/);
    if (m && parseInt(m[1], 10) >= 12) return "arm64";
    return "arm64"; // safer default for new visitors
}

const OS_INFO = {
    mac: {
        label: (arch) =>
            arch === "arm64"
                ? "macOS Apple Silicon용 다운로드"
                : "macOS Intel용 다운로드",
        meta: (arch, size) =>
            `macOS ${arch === "arm64" ? "Apple Silicon" : "Intel"} · .dmg${size ? ` · ${size}` : ""}`,
        asset: (arch) =>
            arch === "arm64" ? "HOP-macos-arm64.dmg" : "HOP-macos-x64.dmg",
    },
    windows: {
        label: () => "Windows용 다운로드",
        meta: (_a, size) => `Windows x64 · MSI 인스톨러${size ? ` · ${size}` : ""}`,
        asset: () => "HOP-windows-x64.msi",
    },
    linux: {
        label: () => "Linux용 다운로드 (.deb)",
        meta: (_a, size) =>
            `Debian/Ubuntu · x64 · .deb${size ? ` · ${size}` : ""}`,
        asset: () => "HOP-linux-x64.deb",
    },
    mobile: {
        label: () => "데스크톱 앱 보기",
        meta: () => "HOP는 데스크톱 앱입니다. PC에서 다시 방문해 주세요.",
        asset: () => null,
    },
    unknown: {
        label: () => "다운로드 페이지로",
        meta: () =>
            "OS를 자동으로 감지하지 못했습니다. 아래에서 직접 선택해 주세요.",
        asset: () => null,
    },
};

const REPO = "golbin/hop";
const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_URL = `https://github.com/${REPO}/releases`;

const detectedOS = detectOS();

/* ──────────────────────────────────────────────
   DOWNLOAD TABS
   ────────────────────────────────────────────── */
const tabs = document.querySelectorAll(".dl-tab");
const panels = document.querySelectorAll(".dl-panel");
function activateTab(os) {
    tabs.forEach((t) =>
        t.setAttribute("aria-selected", t.dataset.os === os ? "true" : "false"),
    );
    panels.forEach((p) => (p.hidden = p.dataset.os !== os));
}
tabs.forEach((t) =>
    t.addEventListener("click", () => activateTab(t.dataset.os)),
);
activateTab(
    detectedOS === "mac" || detectedOS === "windows" || detectedOS === "linux"
        ? detectedOS
        : "windows",
);

/* ──────────────────────────────────────────────
   INSTALL TABS (Linux distro variants)
   ────────────────────────────────────────────── */
document.querySelectorAll(".install-tabs").forEach((group) => {
    const buttons = group.querySelectorAll(".install-tab");
    const card = group.closest(".install-card");
    const ipanels = card?.querySelectorAll("[data-itab-panel]") || [];
    buttons.forEach((b) => {
        b.addEventListener("click", () => {
            const target = b.dataset.itab;
            buttons.forEach((x) => x.classList.toggle("is-active", x === b));
            ipanels.forEach((p) =>
                p.classList.toggle("is-active", p.dataset.itabPanel === target),
            );
        });
    });
});

/* ──────────────────────────────────────────────
   COPY BUTTONS (any [data-clipboard])
   ────────────────────────────────────────────── */
document.querySelectorAll("[data-clipboard]").forEach((wrap) => {
    const btn = wrap.querySelector(".copy-btn");
    if (!btn) return;
    btn.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
            await navigator.clipboard.writeText(wrap.dataset.clipboard || "");
            const original = btn.textContent;
            btn.textContent = "복사됨";
            btn.classList.add("copied");
            setTimeout(() => {
                btn.textContent = original;
                btn.classList.remove("copied");
            }, 1400);
        } catch {
            btn.textContent = "복사 실패";
        }
    });
});

/* ──────────────────────────────────────────────
   PRIMARY DOWNLOAD CTA (with arch detection)
   ────────────────────────────────────────────── */
async function setPrimaryDownload(os, sizeFromAPI) {
    const info = OS_INFO[os] || OS_INFO.unknown;
    const arch = os === "mac" ? await detectMacArch() : null;
    const link = document.getElementById("primary-download");
    const label = document.getElementById("primary-download-label");
    const meta = document.getElementById("primary-download-meta");
    const assetName = info.asset(arch);
    if (link && assetName) {
        link.href = `https://github.com/${REPO}/releases/latest/download/${assetName}`;
        link.dataset.asset = assetName;
    } else if (link) {
        link.href = "#download";
    }
    if (label) label.textContent = info.label(arch);
    if (meta) meta.textContent = info.meta(arch, sizeFromAPI);

    // Mark Intel mac as recommended if user is on Intel
    if (os === "mac" && arch === "x64") {
        document
            .querySelector('[data-arch-tag="arm64"]')
            ?.setAttribute("hidden", "");
        document
            .querySelector('[data-arch-tag="x64"]')
            ?.removeAttribute("hidden");
    }
}
setPrimaryDownload(detectedOS);

/* ──────────────────────────────────────────────
   FORMATTING UTILITIES
   ────────────────────────────────────────────── */
function fmtMB(bytes) {
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
}
function fmtCount(n) {
    if (n >= 10000) return (n / 1000).toFixed(1) + "k";
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return String(n);
}
function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/* ──────────────────────────────────────────────
   MINIMAL MARKDOWN → HTML (release notes)
   Only handles ## heading, * list, [text](url), `code`, blank line paragraphs, **bold**
   ────────────────────────────────────────────── */
function escapeHtml(s) {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function renderInline(s) {
    return escapeHtml(s)
        .replace(
            /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
            '<a href="$2" target="_blank" rel="noopener">$1</a>',
        )
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}
function renderMarkdown(md) {
    const lines = (md || "").replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let listOpen = false;
    let paraBuf = [];

    function flushPara() {
        if (paraBuf.length) {
            out.push(`<p>${renderInline(paraBuf.join(" "))}</p>`);
            paraBuf = [];
        }
    }
    function closeList() {
        if (listOpen) {
            out.push("</ul>");
            listOpen = false;
        }
    }
    for (const raw of lines) {
        const line = raw.trimEnd();
        if (!line) {
            flushPara();
            closeList();
            continue;
        }
        const h2 = line.match(/^##\s+(.*)$/);
        if (h2) {
            flushPara();
            closeList();
            out.push(`<h3>${renderInline(h2[1])}</h3>`);
            continue;
        }
        const li = line.match(/^[-*]\s+(.*)$/);
        if (li) {
            flushPara();
            if (!listOpen) {
                out.push("<ul>");
                listOpen = true;
            }
            out.push(`<li>${renderInline(li[1])}</li>`);
            continue;
        }
        closeList();
        paraBuf.push(line);
    }
    flushPara();
    closeList();
    return out.join("\n");
}

/* ──────────────────────────────────────────────
   GITHUB RELEASE HYDRATION
   ────────────────────────────────────────────── */
async function hydrateRelease() {
    let release;
    try {
        const res = await fetch(RELEASE_API, {
            headers: { Accept: "application/vnd.github+json" },
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        release = await res.json();
    } catch {
        document.getElementById("download-status").textContent =
            "GitHub Releases에 연결하지 못해 정적인 latest 링크로 연결합니다.";
        document.getElementById("hero-version").textContent =
            "최신 안정 버전 · v0.1.10";
        return;
    }

    const tag = release.tag_name || "v0.1.x";
    const name = release.name || `HOP ${tag}`;

    // Hero version chip
    document.getElementById("hero-version").textContent =
        `최신 안정 버전 · ${tag} · ${fmtDate(release.published_at)}`;

    // Download status
    const downloadAssetCount = (release.assets || []).filter(
        (a) => !a.name.endsWith(".sig") && a.name !== "SHA256SUMS.txt" && a.name !== "latest.json",
    ).length;
    document.getElementById("download-status").innerHTML =
        `<strong>${name}</strong> · ${downloadAssetCount}개 플랫폼 빌드 · ` +
        `<a href="${release.html_url}" target="_blank" rel="noopener">변경 이력 ↗</a>`;

    // Hydrate dl-cards (size + count)
    const assetMap = new Map(release.assets.map((a) => [a.name, a]));
    let totalDownloads = 0;
    let primarySize = null;
    document.querySelectorAll("[data-asset]").forEach((card) => {
        const name = card.dataset.asset;
        const a = assetMap.get(name);
        if (!a) return;
        if (card.classList.contains("dl-card")) {
            card.href = a.browser_download_url;
            const size = card.querySelector(".dl-size");
            const count = card.querySelector(".dl-count");
            if (size) size.textContent = fmtMB(a.size);
            if (count) count.textContent = `↓ ${fmtCount(a.download_count)}`;
        }
        // Primary download button (in hero) gets size in meta
        const primary = document.getElementById("primary-download");
        if (primary && primary.dataset.asset === name) {
            primarySize = fmtMB(a.size);
        }
    });

    // SHA-256 해시는 GitHub API의 asset.digest 필드에서 직접 추출
    // (SHA256SUMS.txt 직접 fetch 는 Azure Blob redirect 의 CORS 제약으로 실패)
    document.querySelectorAll("[data-asset-hash]").forEach((el) => {
        const name = el.dataset.assetHash;
        const a = assetMap.get(name);
        const digest = a?.digest || "";
        const hash = digest.startsWith("sha256:") ? digest.slice(7) : "";
        el.textContent = hash || "해시 정보를 찾을 수 없음";
    });

    // Sum total downloads across product assets (exclude .sig and meta)
    for (const a of release.assets) {
        if (a.name.endsWith(".sig") || a.name === "SHA256SUMS.txt" || a.name === "latest.json")
            continue;
        totalDownloads += a.download_count;
    }
    const trustDownloads = document.getElementById("trust-downloads");
    if (trustDownloads && totalDownloads > 0) {
        trustDownloads.textContent = fmtCount(totalDownloads);
    }

    // Re-set primary CTA meta with size
    if (primarySize) {
        await setPrimaryDownload(detectedOS, primarySize);
    }

    // (변경사항 섹션은 제거됨 — release-* 엘리먼트 참조 안 함)

    // SHA256SUMS link to versioned URL
    const sumsAsset = assetMap.get("SHA256SUMS.txt");
    if (sumsAsset) {
        document.getElementById("sha256sums-link").href =
            sumsAsset.browser_download_url;
    }
}

/* ──────────────────────────────────────────────
   GITHUB STARS COUNT
   ────────────────────────────────────────────── */
async function hydrateStars() {
    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}`, {
            headers: { Accept: "application/vnd.github+json" },
        });
        if (!res.ok) return;
        const data = await res.json();
        const el = document.getElementById("trust-stars");
        if (el && data.stargazers_count) {
            el.textContent = fmtCount(data.stargazers_count);
        }
    } catch {
        /* keep static */
    }
}

/* ──────────────────────────────────────────────
   FOOTER YEAR + RUN
   ────────────────────────────────────────────── */
document.getElementById("year").textContent = new Date().getFullYear();

hydrateRelease();
hydrateStars();
