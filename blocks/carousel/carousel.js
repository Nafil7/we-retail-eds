let carouselCounter = 0;

function findAssociatedHeading(block) {
  if (block.hasAttribute('aria-labelledby')) {
    const existingId = block.getAttribute('aria-labelledby');
    if (document.getElementById(existingId)) return document.getElementById(existingId);
  }

  let prev = block.previousElementSibling;
  while (prev) {
    if (/^H[1-6]$/.test(prev.tagName)) return prev;
    const h = prev.querySelector('h1, h2, h3, h4, h5, h6');
    if (h) return h;
    break;
  }

  if (block.parentElement) {
    const headings = [...block.parentElement.querySelectorAll('h1, h2, h3, h4, h5, h6')];
    const prevHeadings = headings.filter(h => (h.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING));
    if (prevHeadings.length > 0) return prevHeadings[prevHeadings.length - 1];
  }
  return null;
}

function isFirstContentFocusable(panel) {
  function findFirstMeaningful(node) {
    for (const child of node.children) {
      if (child.hasAttribute('hidden') || child.getAttribute('aria-hidden') === 'true') continue;
      const tag = child.tagName.toUpperCase();
      if (['DIV', 'SECTION', 'ARTICLE', 'PICTURE'].includes(tag)) {
        const found = findFirstMeaningful(child);
        if (found) return found;
      } else {
        return child;
      }
    }
    return null;
  }

  const first = findFirstMeaningful(panel);
  if (!first) return false;

  const isInteractive = (
    (first.tagName === 'A' && first.hasAttribute('href')) ||
    (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(first.tagName) && !first.hasAttribute('disabled')) ||
    (first.hasAttribute('tabindex') && parseInt(first.getAttribute('tabindex'), 10) >= 0)
  );

  return isInteractive;
}

function updateSlideFocusability(slide, isActive) {
  if (!isActive) {
    slide.removeAttribute('tabindex');
    return;
  }
  if (isFirstContentFocusable(slide)) {
    slide.removeAttribute('tabindex');
  } else {
    slide.setAttribute('tabindex', '0');
  }
}

export default function decorate(block) {
  const slides = [...block.children];
  if (slides.length === 0) return;

  const carouselId = ++carouselCounter;
  if (!block.id) {
    block.id = `carousel-${carouselId}`;
  }

  // Workstream A / Finding 1: Carousel Container Semantics & Visible Heading Association
  block.setAttribute('role', 'region');
  block.setAttribute('aria-roledescription', 'carousel');

  const heading = findAssociatedHeading(block);
  if (heading) {
    if (!heading.id) {
      heading.id = `carousel-heading-${carouselId}`;
    }
    block.setAttribute('aria-labelledby', heading.id);
    block.removeAttribute('aria-label');
  } else if (!block.hasAttribute('aria-label') && !block.hasAttribute('aria-labelledby')) {
    const accessibleName = carouselId === 1 ? 'Featured Stories' : `Featured Stories ${carouselId}`;
    block.setAttribute('aria-label', accessibleName);
  }

  // Workstream B & D / Finding 5: Slides container and live region
  const slidesContainer = document.createElement('div');
  slidesContainer.className = 'carousel-slides';
  slidesContainer.setAttribute('aria-atomic', 'false');

  const indicators = document.createElement('ol');
  indicators.className = 'carousel-indicators';
  indicators.setAttribute('role', 'tablist');
  indicators.setAttribute('aria-label', 'Carousel slides');
  indicators.setAttribute('aria-orientation', 'horizontal');

  // Finding 4: Single-slide edge case (no orphaned tabpanel or tablist)
  if (slides.length === 1) {
    const slide = slides[0];
    slide.id = `carousel-${carouselId}-slide-0`;
    slide.className = 'carousel-slide active';
    slide.setAttribute('aria-hidden', 'false');
    slide.removeAttribute('inert');
    slide.removeAttribute('role');

    const cells = [...slide.children];
    if (cells.length >= 2) {
      const caption = document.createElement('div');
      caption.className = 'carousel-caption';
      while (cells[1].firstChild) {
        caption.appendChild(cells[1].firstChild);
      }
      cells[1].replaceWith(caption);
    }

    updateSlideFocusability(slide, true);

    slidesContainer.appendChild(slide);
    slidesContainer.setAttribute('aria-live', 'polite');
    block.innerHTML = '';
    block.appendChild(slidesContainer);
    return;
  }

  slides.forEach((slide, idx) => {
    const slideId = `carousel-${carouselId}-slide-${idx}`;
    const tabId = `carousel-${carouselId}-tab-${idx}`;

    slide.id = slideId;
    slide.className = 'carousel-slide';
    slide.setAttribute('role', 'tabpanel');
    slide.setAttribute('aria-labelledby', tabId);

    // If slide has image + text cells, format as picture + caption
    const cells = [...slide.children];
    if (cells.length >= 2) {
      const caption = document.createElement('div');
      caption.className = 'carousel-caption';
      while (cells[1].firstChild) {
        caption.appendChild(cells[1].firstChild);
      }
      cells[1].replaceWith(caption);
    }

    // Determine accessible name for tab indicator from slide heading or fallback
    const slideHeading = slide.querySelector('h1, h2, h3, h4, h5, h6');
    const tabLabel = (slideHeading && slideHeading.textContent.trim()) ? slideHeading.textContent.trim() : `Slide ${idx + 1}`;

    const indicator = document.createElement('button');
    indicator.id = tabId;
    indicator.type = 'button';
    indicator.className = 'carousel-indicator';
    indicator.setAttribute('role', 'tab');
    indicator.setAttribute('aria-label', tabLabel);
    indicator.setAttribute('aria-controls', slideId);

    if (idx === 0) {
      slide.classList.add('active');
      slide.setAttribute('aria-hidden', 'false');
      slide.removeAttribute('inert');
      updateSlideFocusability(slide, true);

      indicator.classList.add('active');
      indicator.setAttribute('aria-selected', 'true');
      indicator.setAttribute('tabindex', '0');
    } else {
      slide.classList.remove('active');
      slide.setAttribute('aria-hidden', 'true');
      slide.setAttribute('inert', '');
      updateSlideFocusability(slide, false);

      indicator.classList.remove('active');
      indicator.setAttribute('aria-selected', 'false');
      indicator.setAttribute('tabindex', '-1');
    }

    indicator.addEventListener('click', () => {
      showSlide(idx);
    });

    slidesContainer.appendChild(slide);
    indicators.appendChild(indicator);
  });

  // Navigation buttons
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'carousel-btn prev';
  prevBtn.innerHTML = '&#10094;';
  prevBtn.setAttribute('aria-label', 'Previous slide');

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'carousel-btn next';
  nextBtn.innerHTML = '&#10095;';
  nextBtn.setAttribute('aria-label', 'Next slide');

  // Workstream C: Native visible autoplay control button
  const autoplayBtn = document.createElement('button');
  autoplayBtn.type = 'button';
  autoplayBtn.className = 'carousel-autoplay-btn';
  autoplayBtn.id = `carousel-${carouselId}-autoplay`;

  let currentIdx = 0;
  let timer = null;

  // State management
  let isPlaying = true;
  let isHovered = false;
  let isFocusStopped = false;
  let isPointerInteraction = false;

  if (typeof window !== 'undefined' && window.matchMedia) {
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reducedMotionQuery.matches) {
      isPlaying = false;
    }
  }

  function updateAutoplayButton() {
    const isRotating = isPlaying && !isFocusStopped;
    const label = isRotating ? 'Stop slide rotation' : 'Start slide rotation';
    autoplayBtn.setAttribute('aria-label', label);
    autoplayBtn.setAttribute('title', label);
    autoplayBtn.innerHTML = isRotating
      ? '<span class="carousel-autoplay-icon" aria-hidden="true">&#10074;&#10074;</span>'
      : '<span class="carousel-autoplay-icon" aria-hidden="true">&#9658;</span>';
  }

  function updateLiveRegion() {
    const isRotating = isPlaying && !isFocusStopped && !isHovered;
    slidesContainer.setAttribute('aria-live', isRotating ? 'off' : 'polite');
  }

  function startTimer() {
    if (!timer && isPlaying && !isFocusStopped && !isHovered) {
      timer = setInterval(() => {
        showSlide(currentIdx + 1);
      }, 5000);
    }
  }

  function clearTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function syncAutoplay() {
    if (isPlaying && !isFocusStopped && !isHovered) {
      startTimer();
    } else {
      clearTimer();
    }
    updateAutoplayButton();
    updateLiveRegion();
  }

  function showSlide(newIdx) {
    const prevSlide = slides[currentIdx];
    prevSlide.classList.remove('active');
    prevSlide.setAttribute('aria-hidden', 'true');
    prevSlide.setAttribute('inert', '');
    updateSlideFocusability(prevSlide, false);

    indicators.children[currentIdx].classList.remove('active');
    indicators.children[currentIdx].setAttribute('aria-selected', 'false');
    indicators.children[currentIdx].setAttribute('tabindex', '-1');

    currentIdx = (newIdx + slides.length) % slides.length;

    const activeSlide = slides[currentIdx];
    activeSlide.classList.add('active');
    activeSlide.setAttribute('aria-hidden', 'false');
    activeSlide.removeAttribute('inert');
    updateSlideFocusability(activeSlide, true);

    indicators.children[currentIdx].classList.add('active');
    indicators.children[currentIdx].setAttribute('aria-selected', 'true');
    indicators.children[currentIdx].setAttribute('tabindex', '0');
  }

  // Finding 6: Track pointer modality to distinguish pointer-induced focus from keyboard focus
  block.addEventListener('pointerdown', () => {
    isPointerInteraction = true;
  });

  block.addEventListener('mousedown', () => {
    isPointerInteraction = true;
  });

  // Autoplay button toggle
  autoplayBtn.addEventListener('click', () => {
    isPointerInteraction = false;
    if (isPlaying && !isFocusStopped) {
      isPlaying = false;
      isFocusStopped = true;
    } else {
      isPlaying = true;
      isFocusStopped = false;
      isHovered = false;
    }
    syncAutoplay();
  });

  prevBtn.addEventListener('click', () => {
    showSlide(currentIdx - 1);
  });

  nextBtn.addEventListener('click', () => {
    showSlide(currentIdx + 1);
  });

  block.addEventListener('mouseenter', () => {
    isHovered = true;
    syncAutoplay();
  });

  block.addEventListener('mouseleave', () => {
    isHovered = false;
    syncAutoplay();
  });

  block.addEventListener('focusin', (e) => {
    if (isPointerInteraction) {
      isPointerInteraction = false;
      return;
    }

    const focusFromOutside = !e.relatedTarget || !block.contains(e.relatedTarget);
    if (focusFromOutside) {
      if (isPlaying && !isFocusStopped) {
        isFocusStopped = true;
        syncAutoplay();
      }
    }
  });

  indicators.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      showSlide(currentIdx - 1);
      indicators.children[currentIdx].focus();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      showSlide(currentIdx + 1);
      indicators.children[currentIdx].focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      showSlide(0);
      indicators.children[currentIdx].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      showSlide(slides.length - 1);
      indicators.children[currentIdx].focus();
    }
  });

  // Finding 2: DOM assembly order (W3C APG Tabbed Carousel sequence)
  // 1. Rotation control -> 2. Prev button -> 3. Tablist -> 4. Next button -> 5. Slide content
  block.innerHTML = '';
  block.appendChild(autoplayBtn);
  block.appendChild(prevBtn);
  block.appendChild(indicators);
  block.appendChild(nextBtn);
  block.appendChild(slidesContainer);

  syncAutoplay();
}
