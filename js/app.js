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

    placeholder.hidden = true;
    readerBook.hidden = true;
    readerLoading.hidden = false;
    readerLoadingText.textContent = `Opening ${issue.title}…`;

    try {
      const pageImages = await renderPdfToImages(issue.url, (done, total) => {
        readerLoadingText.textContent = `Rendering page ${done} of ${total}…`;
      });

      currentIssueTitle.textContent = issue.title;
      buildFlipbook(pageImages);

      readerLoading.hidden = true;
      readerBook.hidden = false;
    } catch (err) {
      readerLoadingText.textContent = 'Something went wrong opening this issue.';
      console.error('Failed to open issue:', err);
    }
  }

  async function renderPdfToImages(url, onProgress) {
    const loadingTask = pdfjsLib.getDocument(url);
    const pdf = await loadingTask.promise;
    const images = [];

    // A scale of ~1.6 keeps text crisp without generating huge
    // images for long issues.
    const scale = 1.6;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext('2d');

      await page.render({ canvasContext: context, viewport }).promise;
      images.push(canvas.toDataURL('image/jpeg', 0.92));

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
      minWidth: 280,
      maxWidth: 1100,
      minHeight: 400,
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
  // Boot
  // ---------------------------------------------------------------

  loadIssues();
})();
