/**
 * PNN Library — app.js
 * ---------------------------------------------------------------
 * 1. Light/dark toggle, persisted in localStorage.
 * 2. Pulls the issue list from newspapers/manifest.json (a static
 *    file regenerated at build time — see scripts/generate-manifest.js),
 *    so new PDFs show up with no runtime backend involved.
 * 3. When an issue is opened, pdf.js rasterizes every page to an
 *    image and page-flip turns that stack of images into an
 *    interactive flipbook.
 * ---------------------------------------------------------------
 */

(() => {
  const root = document.documentElement;
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeIcon');
  const themeLabel = document.getElementById('themeLabel');

  const issueList = document.getElementById('issueList');
  const issueListLoading = document.getElementById('issueListLoading');

  const placeholder = document.getElementById('placeholder');
  const readerLoading = document.getElementById('readerLoading');
  const readerLoadingText = document.getElementById('readerLoadingText');
  const readerBook = document.getElementById('readerBook');
  const currentIssueTitle = document.getElementById('currentIssueTitle');
  const pageIndicator = document.getElementById('pageIndicator');
  const flipbookEl = document.getElementById('flipbook');

  const prevBtn = document.getElementById('prevPage');
  const nextBtn = document.getElementById('nextPage');
  const closeBtn = document.getElementById('closeBook');

  let pageFlip = null;
  let activeCard = null;
  let currentIssue = null;
  let lastRenderedWidth = 0;

  // ---------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    themeIcon.textContent = theme === 'dark' ? '🌙' : '☀️';
    themeLabel.textContent = theme === 'dark' ? 'Dark' : 'Light';
    localStorage.setItem('pnn-theme', theme);
  }

  const savedTheme = localStorage.getItem('pnn-theme')
    || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  applyTheme(savedTheme);

  themeToggle.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  });

  // ---------------------------------------------------------------
  // Issue list
  // ---------------------------------------------------------------

  async function loadIssues() {
    try {
      const res = await fetch('newspapers/manifest.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`manifest.json responded ${res.status}`);
      const data = await res.json();
      renderIssueList(data.issues || []);
    } catch (err) {
      issueListLoading.textContent = 'No issues found. Run the build once to generate the list.';
      console.error('Failed to load issues:', err);
    }
  }

  function renderIssueList(issues) {
    issueList.innerHTML = '';

    if (issues.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'issue-list__empty';
      empty.textContent = 'No issues yet — add a PDF to /newspapers.';
      issueList.appendChild(empty);
      return;
    }

    issues.forEach((issue, index) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'issue-card';
      card.dataset.url = issue.url;
      card.dataset.title = issue.title;

      const row = document.createElement('span');
      row.className = 'issue-card__row';

      const title = document.createElement('span');
      title.className = 'issue-card__title';
      title.textContent = issue.title;
      row.appendChild(title);

      if (index === 0) {
        const flag = document.createElement('span');
        flag.className = 'issue-card__flag';
        flag.textContent = 'New';
        row.appendChild(flag);
      }

      const date = document.createElement('span');
      date.className = 'issue-card__date';
      date.textContent = issue.date;

      card.appendChild(row);
      card.appendChild(date);

      card.addEventListener('click', () => openIssue(issue, card));
      issueList.appendChild(card);
    });
  }

  // ---------------------------------------------------------------
  // Opening an issue: PDF -> page images -> flipbook
  // ---------------------------------------------------------------

  pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  async function openIssue(issue, card) {
    if (activeCard) activeCard.classList.remove('is-active');
    card.classList.add('is-active');
    activeCard = card;
    currentIssue = issue;

    placeholder.hidden = true;
    flipbookEl.innerHTML = '';
    // Reveal the book container (toolbar + flipbook box) right away,
    // *before* rendering anything, so flipbook-wrap gets its real
    // layout size from the page — that's what we measure below to
    // decide how many pixels to rasterize per page. The loading
    // spinner sits on top as an overlay (see CSS) so nothing blank
    // flashes on screen while that happens.
    readerBook.hidden = false;
    readerLoading.hidden = false;
    readerLoadingText.textContent = `Opening ${issue.title}…`;

    try {
      const targetWidth = getFlipbookTargetWidth();
      lastRenderedWidth = targetWidth;

      const pageImages = await renderPdfToImages(issue.url, targetWidth, (done, total) => {
        readerLoadingText.textContent = `Rendering page ${done} of ${total}…`;
      });

      currentIssueTitle.textContent = issue.title;
      buildFlipbook(pageImages);

      readerLoading.hidden = true;
    } catch (err) {
      readerLoadingText.textContent = 'Something went wrong opening this issue.';
      console.error('Failed to open issue:', err);
    }
  }

  /**
   * How wide (in CSS px) a page will actually be drawn once page-flip
   * lays the book out. page-flip's "stretch" mode fits the book's
   * fixed 550:733 aspect ratio inside whatever box flipbook-wrap
   * gives it, clamped to the min/max width/height passed to it below
   * — so the true render target is whichever of "as wide as the box"
   * or "as wide as the box's height allows" is tighter.
   */
  function getFlipbookTargetWidth() {
    const wrap = document.querySelector('.flipbook-wrap');
    const rect = wrap.getBoundingClientRect();
    const aspect = 550 / 733;

    const boxWidth = rect.width || 550;
    const boxHeight = rect.height || 733;

    let width = Math.min(boxWidth, boxHeight * aspect);
    width = Math.max(240, Math.min(1100, width));
    return width;
  }

  async function renderPdfToImages(url, targetDisplayWidth, onProgress) {
    const loadingTask = pdfjsLib.getDocument(url);
    const pdf = await loadingTask.promise;
    const images = [];

    // Render every page at the pixel width it will actually be shown
    // at (targetDisplayWidth, measured from the real flipbook box —
    // see getFlipbookTargetWidth), times device pixel ratio so retina
    // screens don't upscale a lower-res image. Capped at 4x scale so
    // an unusually large monitor doesn't generate huge images.
    const dpr = Math.min(window.devicePixelRatio || 1, 4);

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.max(
          6,
          (targetDisplayWidth * dpr * 2) / baseViewport.width
      );
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';

      await page.render({ canvasContext: context, viewport }).promise;
      images.push(canvas.toDataURL('image/png'));

      if (onProgress) onProgress(pageNum, pdf.numPages);
    }

    return images;
  }

  function buildFlipbook(pageImages) {
    if (pageFlip) {
      pageFlip.destroy();
      pageFlip = null;
    }
    flipbookEl.innerHTML = '';

    pageFlip = new St.PageFlip(flipbookEl, {
      width: 550,
      height: 733,
      size: 'stretch',
      minWidth: 240,
      maxWidth: 1100,
      minHeight: 320,
      maxHeight: 1400,
      maxShadowOpacity: 0.4,
      showCover: true,
      mobileScrollSupport: true,
      usePortrait: true,
    });

    pageFlip.loadFromImages(pageImages);

    updatePageIndicator();
    pageFlip.on('flip', updatePageIndicator);
  }

  function updatePageIndicator() {
    if (!pageFlip) return;
    const current = pageFlip.getCurrentPageIndex() + 1;
    const total = pageFlip.getPageCount();
    pageIndicator.textContent = `${current} / ${total}`;
  }

  prevBtn.addEventListener('click', () => pageFlip && pageFlip.flipPrev());
  nextBtn.addEventListener('click', () => pageFlip && pageFlip.flipNext());

  closeBtn.addEventListener('click', () => {
    readerBook.hidden = true;
    placeholder.hidden = false;
    currentIssue = null;
    if (activeCard) {
      activeCard.classList.remove('is-active');
      activeCard = null;
    }
    if (pageFlip) {
      pageFlip.destroy();
      pageFlip = null;
    }
  });

  // ---------------------------------------------------------------
  // Keep resolution matched to the flipbook's real size as it
  // changes — window resize, browser zoom, or a phone rotating.
  // Only re-renders when the book got meaningfully BIGGER (re-doing
  // the work for a smaller size wouldn't improve anything, just cost
  // battery/bandwidth), and skips it entirely while nothing's open.
  // ---------------------------------------------------------------

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (!currentIssue || readerBook.hidden) return;

    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(async () => {
      const newWidth = getFlipbookTargetWidth();
      if (newWidth <= lastRenderedWidth * 1.15) return;

      lastRenderedWidth = newWidth;
      const issue = currentIssue;
      const pageImages = await renderPdfToImages(issue.url, newWidth);
      // Guard against the user closing/switching issues while this
      // re-render was in flight.
      if (currentIssue === issue && pageFlip) {
        pageFlip.loadFromImages(pageImages);
        updatePageIndicator();
      }
    }, 400);
  });

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------

  loadIssues();
})();
