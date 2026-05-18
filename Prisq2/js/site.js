// Shared site settings, data paths, and timing values used across every page.
const PRISQ_LANGUAGE_KEY = "prisqLanguage";
const PRISQ_DATA_URL = "data/quiz_data.json?v=2026-05-18-team-member-update";
const PRISQ_PENDING_NAVIGATION_KEY = "prisqPendingNavigation";
const PRISQ_SKELETON_MIN_DURATION = 420;
const PRISQ_SKELETON_FALLBACK_DURATION = 4200;
const PRISQ_PENDING_NAVIGATION_MAX_AGE = 5000;
const PRISQ_SERVICE_WORKER_URL = "service-worker.js?v=10";
const PRISQ_HTML_PROTOCOLS = ["http:", "https:"];
const PRISQ_HOME_SPLASH_EXIT_DELAY = 2500;
const PRISQ_HOME_SPLASH_EXIT_DURATION = 760;
const PRISQ_HOME_SPLASH_REDUCED_DELAY = 180;
const PRISQ_PREFETCH_ROUTES = {
    home: ["quiz.html", "info.html", "risk.html"],
    quiz: ["risk.html", "info.html", "index.html"],
    info: ["quiz.html", "risk.html", "index.html"],
    risk: ["quiz.html", "info.html", "index.html"],
    about: ["index.html", "team.html", "quiz.html"],
    contact: ["index.html", "quiz.html", "about.html"],
    team: ["index.html", "about.html", "quiz.html"]
};

let prisqDataPromise = null;
let siteTranslations = null;
let revealObserver = null;
let serviceWorkerRegistrationPromise = null;

const prefetchedResources = new Set();

// Tracks the temporary loading skeleton shown during page-to-page navigation.
const pageSkeletonState = {
    overlay: null,
    visible: false,
    startedAt: 0,
    fallbackTimer: 0
};

const homeSplashState = {
    overlay: null,
    exitTimer: 0,
    cleanupTimer: 0,
    active: false
};

// Loads the shared JSON file once so all pages reuse the same data request.
function loadPrisqData() {
    if (!prisqDataPromise) {
        prisqDataPromise = fetch(PRISQ_DATA_URL)
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`Failed to load PRISQ data: ${response.status}`);
                }

                return response.json();
            })
            .catch((error) => {
                prisqDataPromise = null;
                throw error;
            });
    }

    return prisqDataPromise;
}

// Pulls only the site-wide translation block from the shared quiz data file.
async function loadSiteTranslations() {
    if (siteTranslations) {
        return siteTranslations;
    }

    try {
        const data = await loadPrisqData();
        siteTranslations = data.siteTranslations || {};
    } catch (error) {
        console.error("Failed to load site translations:", error);
        siteTranslations = {};
    }

    return siteTranslations;
}

// Reads the user's saved language and falls back to English when missing.
function getCurrentLanguage() {
    const storedLanguage = window.localStorage.getItem(PRISQ_LANGUAGE_KEY);
    return storedLanguage === "ar" ? "ar" : "en";
}

// Resolves nested translation keys like "nav.home" inside the active language object.
function getTranslationValue(language, key) {
    return key.split(".").reduce((value, part) => value?.[part], siteTranslations?.[language]);
}

// Checks whether the current protocol supports prefetching and service workers.
function supportsNetworkEnhancements() {
    return PRISQ_HTML_PROTOCOLS.includes(window.location.protocol);
}

// Avoids aggressive background prefetching on slow or data-saving connections.
function connectionAllowsIdlePrefetch() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

    if (!connection) {
        return supportsNetworkEnhancements();
    }

    return !connection.saveData && !["slow-2g", "2g"].includes(connection.effectiveType);
}

// Normalizes the current URL into the simple page filename used throughout the app.
function normalizePathname(pathname = window.location.pathname) {
    return pathname.split("/").pop() || "index.html";
}

// Runs low-priority tasks when the browser is idle, with a timeout fallback.
function scheduleIdleTask(callback, timeout = 1600) {
    if ("requestIdleCallback" in window) {
        window.requestIdleCallback(callback, { timeout });
        return;
    }

    window.setTimeout(() => callback({ timeRemaining: () => 0, didTimeout: false }), 280);
}

// Only registers the service worker when the browser and protocol support it safely.
function canRegisterServiceWorker() {
    const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    return "serviceWorker" in navigator
        && supportsNetworkEnhancements()
        && (window.isSecureContext || isLocalhost);
}

// Registers the site's service worker once and reuses the same promise afterward.
function registerServiceWorker() {
    if (!canRegisterServiceWorker()) {
        return Promise.resolve(null);
    }

    if (!serviceWorkerRegistrationPromise) {
        serviceWorkerRegistrationPromise = navigator.serviceWorker.register(PRISQ_SERVICE_WORKER_URL)
            .catch((error) => {
                console.error("Service worker registration failed:", error);
                serviceWorkerRegistrationPromise = null;
                return null;
            });
    }

    return serviceWorkerRegistrationPromise;
}

// Prevents the same page or data file from being prefetched more than once.
function rememberPrefetchedResource(resourceKey) {
    if (prefetchedResources.has(resourceKey)) {
        return false;
    }

    prefetchedResources.add(resourceKey);
    return true;
}

// Converts a relative path into a same-origin URL and rejects cross-origin targets.
function buildSameOriginUrl(urlLike) {
    try {
        const url = new URL(urlLike, window.location.href);

        if (!supportsNetworkEnhancements() || url.origin !== window.location.origin) {
            return null;
        }

        return url;
    } catch (error) {
        return null;
    }
}

// Prefetches likely next pages to make navigation feel faster.
function prefetchDocument(urlLike) {
    const url = buildSameOriginUrl(urlLike);

    if (!url || !rememberPrefetchedResource(url.href)) {
        return;
    }

    const preloadHint = document.createElement("link");
    preloadHint.rel = "prefetch";
    preloadHint.as = "document";
    preloadHint.href = url.href;
    preloadHint.dataset.prisqPrefetch = "true";
    document.head.appendChild(preloadHint);

    if (!connectionAllowsIdlePrefetch()) {
        return;
    }

    fetch(url.href, { credentials: "same-origin" }).catch(() => {
        // Keep the hint in place even if the eager fetch fails.
    });
}

// Prefetches the quiz JSON separately because several pages depend on it.
function prefetchQuizData() {
    const quizDataUrl = buildSameOriginUrl(PRISQ_DATA_URL);

    if (!quizDataUrl || !rememberPrefetchedResource(quizDataUrl.href)) {
        return;
    }

    fetch(quizDataUrl.href, { credentials: "same-origin" }).catch(() => {
        prefetchedResources.delete(quizDataUrl.href);
    });
}

// Warms the most likely next routes based on the current page.
function warmLikelyNextRoutes() {
    const currentPage = document.body?.dataset.page || "home";
    const routes = PRISQ_PREFETCH_ROUTES[currentPage] || PRISQ_PREFETCH_ROUTES.home;

    scheduleIdleTask(() => {
        if (!connectionAllowsIdlePrefetch()) {
            return;
        }

        routes.forEach((route) => prefetchDocument(route));

        if (currentPage !== "quiz") {
            prefetchQuizData();
        }
    });
}

// Session storage remembers where the user was headed so the next page can show a loader.
function readPendingNavigationState() {
    try {
        const storedState = window.sessionStorage.getItem(PRISQ_PENDING_NAVIGATION_KEY);

        if (!storedState) {
            return null;
        }

        return JSON.parse(storedState);
    } catch (error) {
        console.warn("Unable to read pending navigation state:", error);
        return null;
    }
}

function clearPendingNavigationState() {
    try {
        window.sessionStorage.removeItem(PRISQ_PENDING_NAVIGATION_KEY);
    } catch (error) {
        console.warn("Unable to clear pending navigation state:", error);
    }
}

function persistPendingNavigationState(url) {
    try {
        window.sessionStorage.setItem(PRISQ_PENDING_NAVIGATION_KEY, JSON.stringify({
            pathname: normalizePathname(url.pathname),
            timestamp: Date.now()
        }));
    } catch (error) {
        console.warn("Unable to persist pending navigation state:", error);
    }
}

// These helpers apply translated copy and active-link state to the current page.
function updatePageTitle(language) {
    const currentPage = document.body?.dataset.page;

    if (!currentPage) {
        return;
    }

    const translatedTitle = siteTranslations?.[language]?.pageTitles?.[currentPage];

    if (translatedTitle) {
        document.title = translatedTitle;
    }
}

function updateTranslatedText(language) {
    document.querySelectorAll("[data-i18n]").forEach((element) => {
        const translatedText = getTranslationValue(language, element.dataset.i18n);

        if (typeof translatedText === "string") {
            element.textContent = translatedText;
        }
    });
}

function updateControlLabels(language) {
    const toggleButton = document.querySelector("[data-language-toggle]");
    const menuButton = document.querySelector(".menu-toggle");
    const closeButton = document.querySelector(".site-drawer .btn-close");
    const navigationText = siteTranslations?.[language]?.nav;

    if (!navigationText) {
        return;
    }

    if (toggleButton) {
        toggleButton.textContent = language === "ar" ? "EN" : "AR";
        toggleButton.setAttribute("aria-label", navigationText.switchLanguage);
    }

    if (menuButton) {
        menuButton.setAttribute("aria-label", navigationText.openMenu);
    }

    if (closeButton) {
        closeButton.setAttribute("aria-label", navigationText.closeMenu);
    }
}

function updateActiveNavigation() {
    const currentPage = normalizePathname();

    document.querySelectorAll("[data-nav-target]").forEach((link) => {
        const isActive = link.dataset.navTarget === currentPage;
        link.classList.toggle("active", isActive);

        if (isActive) {
            link.setAttribute("aria-current", "page");
        } else {
            link.removeAttribute("aria-current");
        }
    });
}

// Applies one language choice to the entire page shell and visible content.
function applyLanguage(language) {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    document.body?.classList.toggle("is-arabic", language === "ar");
    updateTranslatedText(language);
    updateControlLabels(language);
    updatePageTitle(language);
    updateActiveNavigation();
}

// Flips between English and Arabic and notifies page-specific scripts about the change.
function toggleLanguage() {
    const nextLanguage = getCurrentLanguage() === "ar" ? "en" : "ar";
    window.localStorage.setItem(PRISQ_LANGUAGE_KEY, nextLanguage);
    applyLanguage(nextLanguage);
    window.dispatchEvent(new CustomEvent("prisq-language-change", {
        detail: { language: nextLanguage }
    }));
}

function isReducedMotionPreferred() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isHomePage() {
    return document.body?.dataset.page === "home";
}

// The home page splash animation has its own copy and lifecycle helpers here.
function updateHomeSplashCopy() {
    const splashArabicLabel = document.querySelector("[data-splash-arabic]");
    const arabicBrand = siteTranslations?.ar?.pageTitles?.home;

    if (!(splashArabicLabel instanceof HTMLElement) || typeof arabicBrand !== "string" || !arabicBrand.trim()) {
        return;
    }

    splashArabicLabel.textContent = arabicBrand;
}

function cleanupHomeSplash() {
    window.clearTimeout(homeSplashState.exitTimer);
    window.clearTimeout(homeSplashState.cleanupTimer);
    homeSplashState.exitTimer = 0;
    homeSplashState.cleanupTimer = 0;
    homeSplashState.active = false;
    homeSplashState.overlay?.remove();
    homeSplashState.overlay = null;
    document.body?.classList.remove("is-splash-active", "is-splash-leaving");
}

function beginHomeSplashExit() {
    if (!homeSplashState.active) {
        return;
    }

    document.body?.classList.add("is-splash-leaving");
    signalPageReady({ immediate: true });

    homeSplashState.cleanupTimer = window.setTimeout(() => {
        cleanupHomeSplash();
    }, isReducedMotionPreferred() ? 0 : PRISQ_HOME_SPLASH_EXIT_DURATION);
}

function startHomeSplash() {
    if (!isHomePage() || homeSplashState.active) {
        return;
    }

    const overlay = document.querySelector("[data-home-splash]");

    if (!(overlay instanceof HTMLElement)) {
        return;
    }

    clearPendingNavigationState();
    homeSplashState.overlay = overlay;
    homeSplashState.active = true;
    document.body?.classList.add("is-splash-active");
    document.body?.classList.remove("is-splash-leaving");

    const exitDelay = isReducedMotionPreferred()
        ? PRISQ_HOME_SPLASH_REDUCED_DELAY
        : PRISQ_HOME_SPLASH_EXIT_DELAY;

    homeSplashState.exitTimer = window.setTimeout(() => {
        beginHomeSplashExit();
    }, exitDelay);
}

// Builds the loading skeleton markup used while the next page is arriving.
function getPageSkeletonTemplate(page) {
    if (page === "home") {
        return `
            <div class="page-skeleton-main page-skeleton-main-home">
                <div class="page-skeleton-card page-skeleton-card-hero">
                    <span class="page-skeleton-line page-skeleton-line-kicker"></span>
                    <span class="page-skeleton-line page-skeleton-line-xl"></span>
                    <span class="page-skeleton-line page-skeleton-line-lg"></span>
                    <span class="page-skeleton-line page-skeleton-line-md"></span>
                    <div class="page-skeleton-actions">
                        <span class="page-skeleton-pill page-skeleton-pill-wide"></span>
                        <span class="page-skeleton-pill page-skeleton-pill-secondary"></span>
                    </div>
                </div>
            </div>
        `;
    }

    if (page === "quiz") {
        return `
            <div class="page-skeleton-main page-skeleton-main-quiz">
                <div class="page-skeleton-line page-skeleton-line-chip"></div>
                <div class="page-skeleton-progress">
                    <span class="page-skeleton-progress-fill"></span>
                </div>
                <div class="page-skeleton-card">
                    <span class="page-skeleton-line page-skeleton-line-xl"></span>
                    <span class="page-skeleton-line page-skeleton-line-lg"></span>
                    <span class="page-skeleton-line page-skeleton-line-sm"></span>
                </div>
                <div class="page-skeleton-stack">
                    <span class="page-skeleton-pill"></span>
                    <span class="page-skeleton-pill"></span>
                    <span class="page-skeleton-pill"></span>
                    <span class="page-skeleton-pill page-skeleton-pill-wide"></span>
                </div>
            </div>
        `;
    }

    if (page === "about") {
        return `
            <div class="page-skeleton-main">
                <div class="page-skeleton-card">
                    <span class="page-skeleton-line page-skeleton-line-lg"></span>
                </div>
                <div class="page-skeleton-grid">
                    <span class="page-skeleton-tile"></span>
                    <span class="page-skeleton-tile"></span>
                    <span class="page-skeleton-tile"></span>
                    <span class="page-skeleton-tile"></span>
                </div>
            </div>
        `;
    }

    if (page === "team") {
        return `
            <div class="page-skeleton-main">
                <div class="page-skeleton-card">
                    <span class="page-skeleton-line page-skeleton-line-lg"></span>
                </div>
                <div class="page-skeleton-table">
                    <span class="page-skeleton-table-row"></span>
                    <span class="page-skeleton-table-row"></span>
                    <span class="page-skeleton-table-row"></span>
                    <span class="page-skeleton-table-row"></span>
                    <span class="page-skeleton-table-row"></span>
                </div>
            </div>
        `;
    }

    return `
        <div class="page-skeleton-main">
            <div class="page-skeleton-card">
                <span class="page-skeleton-line page-skeleton-line-lg"></span>
                <span class="page-skeleton-line page-skeleton-line-md"></span>
            </div>
            <div class="page-skeleton-stack">
                <div class="page-skeleton-card">
                    <span class="page-skeleton-line page-skeleton-line-lg"></span>
                    <span class="page-skeleton-line page-skeleton-line-md"></span>
                    <span class="page-skeleton-line page-skeleton-line-sm"></span>
                </div>
                <div class="page-skeleton-card">
                    <span class="page-skeleton-line page-skeleton-line-lg"></span>
                    <span class="page-skeleton-line page-skeleton-line-md"></span>
                    <span class="page-skeleton-line page-skeleton-line-sm"></span>
                </div>
                <span class="page-skeleton-pill page-skeleton-pill-wide"></span>
            </div>
        </div>
    `;
}

function buildPageSkeleton() {
    const page = document.body?.dataset.page || "content";
    const overlay = document.createElement("div");
    overlay.className = "page-skeleton";
    overlay.dataset.pageSkeleton = page;
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
        <div class="page-skeleton-shell">
            <div class="page-skeleton-header">
                <span class="page-skeleton-circle"></span>
                <span class="page-skeleton-brand"></span>
                <span class="page-skeleton-circle"></span>
            </div>
            ${getPageSkeletonTemplate(page)}
        </div>
    `;
    return overlay;
}

// Decides whether the current page should show the navigation skeleton overlay.
function shouldShowPageSkeleton() {
    const currentPage = document.body?.dataset.page;

    if (currentPage === "home") {
        return false;
    }

    if (currentPage === "quiz") {
        return true;
    }

    const pendingNavigation = readPendingNavigationState();

    if (!pendingNavigation) {
        return false;
    }

    const isFresh = Date.now() - pendingNavigation.timestamp < PRISQ_PENDING_NAVIGATION_MAX_AGE;
    const isExpectedTarget = pendingNavigation.pathname === normalizePathname();

    if (!isFresh || !isExpectedTarget) {
        clearPendingNavigationState();
        return false;
    }

    return true;
}

function cleanupPageSkeleton() {
    window.clearTimeout(pageSkeletonState.fallbackTimer);
    pageSkeletonState.fallbackTimer = 0;
    pageSkeletonState.overlay?.remove();
    pageSkeletonState.overlay = null;
    pageSkeletonState.visible = false;
    pageSkeletonState.startedAt = 0;
    document.body?.classList.remove("has-page-skeleton");
    document.body?.removeAttribute("aria-busy");
    clearPendingNavigationState();
}

function hidePageSkeleton({ immediate = false } = {}) {
    if (!pageSkeletonState.visible || !pageSkeletonState.overlay) {
        clearPendingNavigationState();
        document.body?.classList.remove("is-navigating");
        document.body?.removeAttribute("aria-busy");
        return;
    }

    const elapsed = performance.now() - pageSkeletonState.startedAt;
    const waitTime = immediate ? 0 : Math.max(0, PRISQ_SKELETON_MIN_DURATION - elapsed);

    window.clearTimeout(pageSkeletonState.fallbackTimer);

    window.setTimeout(() => {
        const overlay = pageSkeletonState.overlay;

        if (!overlay) {
            cleanupPageSkeleton();
            return;
        }

        overlay.classList.add("is-hiding");
        document.body?.classList.remove("has-page-skeleton");
        document.body?.classList.remove("is-navigating");

        window.setTimeout(() => {
            cleanupPageSkeleton();
        }, isReducedMotionPreferred() ? 0 : 220);
    }, waitTime);
}

function signalPageReady(options = {}) {
    hidePageSkeleton(options);
}

// Inserts the skeleton early so non-home pages feel responsive during navigation.
function primePageSkeleton() {
    if (!document.body || pageSkeletonState.visible || !shouldShowPageSkeleton()) {
        return;
    }

    pageSkeletonState.overlay = buildPageSkeleton();
    pageSkeletonState.visible = true;
    pageSkeletonState.startedAt = performance.now();
    document.body.appendChild(pageSkeletonState.overlay);
    document.body.classList.add("has-page-skeleton");
    document.body.setAttribute("aria-busy", "true");

    pageSkeletonState.fallbackTimer = window.setTimeout(() => {
        signalPageReady({ immediate: true });
    }, PRISQ_SKELETON_FALLBACK_DURATION);
}

// Adds scroll-in reveal animations to the main visible sections on each page.
function prepareRevealTargets() {
    const revealSelectors = [
        ".container.vh-100 .col-md-6",
        ".page-title",
        ".info-container > *",
        ".quiz-container",
        ".content-cta",
        ".container.text-center .text-decoration-underline",
        ".about-logo-grid > .col",
        ".team-profile-card",
        ".team-table-card",
        ".btn-primary"
    ];

    const revealTargets = Array.from(document.querySelectorAll(revealSelectors.join(",")));

    if (!revealTargets.length) {
        return;
    }

    if (isReducedMotionPreferred()) {
        revealTargets.forEach((element) => {
            element.dataset.reveal = "";
            element.classList.add("is-visible");
        });
        return;
    }

    if (revealObserver) {
        revealObserver.disconnect();
    }

    revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) {
                return;
            }

            entry.target.classList.add("is-visible");
            revealObserver?.unobserve(entry.target);
        });
    }, {
        rootMargin: "0px",
        threshold: 0.18
    });

    revealTargets.forEach((element, index) => {
        if (element.dataset.revealReady === "true") {
            return;
        }

        element.dataset.reveal = "";
        element.dataset.revealReady = "true";
        element.style.setProperty("--reveal-delay", `${Math.min(index, 5) * 60}ms`);
        revealObserver.observe(element);
    });
}

// Shared navigation logic handles drawer closing, smart prefetching, and page transitions.
function closeNavigationDrawer() {
    const drawerElement = document.getElementById("siteNav");

    if (!drawerElement || !window.bootstrap?.Offcanvas) {
        return;
    }

    window.bootstrap.Offcanvas.getInstance(drawerElement)?.hide();
}

function handlePrefetchIntent(event) {
    if (!supportsNetworkEnhancements()) {
        return;
    }

    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;

    if (!(link instanceof HTMLAnchorElement) || !isEligibleNavigationLink(link)) {
        return;
    }

    prefetchDocument(link.href);

    if (normalizePathname(new URL(link.href, window.location.href).pathname) === "quiz.html") {
        prefetchQuizData();
    }
}

function isEligibleNavigationLink(link) {
    const href = link.getAttribute("href");

    if (!href || href.startsWith("#") || link.target === "_blank" || link.hasAttribute("download") || link.dataset.noTransition !== undefined) {
        return false;
    }

    const targetUrl = new URL(link.href, window.location.href);
    const isSupportedProtocol = ["http:", "https:", "file:"].includes(targetUrl.protocol);
    const isSameOrigin = targetUrl.origin === window.location.origin;
    const isHashOnlyNavigation = targetUrl.pathname === window.location.pathname
        && targetUrl.search === window.location.search
        && targetUrl.hash;

    return isSupportedProtocol && isSameOrigin && !isHashOnlyNavigation;
}

function handleNavigationClick(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
    }

    const target = event.target instanceof Element ? event.target.closest("a[href]") : null;

    if (!(target instanceof HTMLAnchorElement) || !isEligibleNavigationLink(target)) {
        return;
    }

    const destinationUrl = new URL(target.href, window.location.href);

    if (destinationUrl.href === window.location.href) {
        return;
    }

    event.preventDefault();
    persistPendingNavigationState(destinationUrl);
    closeNavigationDrawer();
    document.body?.classList.add("is-navigating");
    target.classList.add("is-pressed");

    window.setTimeout(() => {
        window.location.assign(destinationUrl.href);
    }, isReducedMotionPreferred() ? 0 : 130);
}

function bindSharedInteractions() {
    if (document.body?.dataset.interactionsReady === "true") {
        return;
    }

    document.addEventListener("click", handleNavigationClick);
    document.addEventListener("pointerover", handlePrefetchIntent, true);
    document.addEventListener("focusin", handlePrefetchIntent);
    document.addEventListener("touchstart", handlePrefetchIntent, { passive: true });
    document.addEventListener("prisq:page-ready", (event) => signalPageReady(event.detail || {}));
    document.body.dataset.interactionsReady = "true";
}

// Boots the shared page shell: animations, translations, navigation, and service worker.
async function initSite() {
    prepareRevealTargets();
    bindSharedInteractions();
    warmLikelyNextRoutes();
    startHomeSplash();

    await loadSiteTranslations();
    updateHomeSplashCopy();
    applyLanguage(getCurrentLanguage());

    const toggleButton = document.querySelector("[data-language-toggle]");

    if (toggleButton && !toggleButton.dataset.languageReady) {
        toggleButton.addEventListener("click", toggleLanguage);
        toggleButton.dataset.languageReady = "true";
    }

    if (document.readyState === "complete") {
        registerServiceWorker();
    } else {
        window.addEventListener("load", registerServiceWorker, { once: true });
    }

    if (document.body?.dataset.page !== "quiz" && document.body?.dataset.page !== "home") {
        signalPageReady();
    }
}

primePageSkeleton();

window.addEventListener("pageshow", (event) => {
    if (!event.persisted) {
        return;
    }

    cleanupHomeSplash();
    cleanupPageSkeleton();
    document.body?.classList.remove("is-navigating");
});

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSite);
} else {
    initSite();
}

// Exposes the few shared helpers that page-specific scripts like quiz.js rely on.
window.PrisqSite = {
    getCurrentLanguage,
    loadData: loadPrisqData,
    translate(key, language = getCurrentLanguage()) {
        return getTranslationValue(language, key) ?? getTranslationValue("en", key) ?? key;
    },
    applyLanguage,
    signalPageReady
};
