let carouselCounter = 0;

export default function decorate(block) {
  const slides = [...block.children];
  if (slides.length === 0) return;

  const carouselId = ++carouselCounter;
  if (!block.id) {
    block.id = `carousel-${carouselId}`;
  }

  // Workstream A: Carousel Container Semantics
  block.setAttribute('role', 'region');
  block.setAttribute('aria-roledescription', 'carousel');
  if (!block.hasAttribute('aria-label') && !block.hasAttribute('aria-labelledby')) {
    const accessibleName = carouselId === 1 ? 'Featured Stories' : `Featured Stories ${carouselId}`;
    block.setAttribute('aria-label', accessibleName);
  }

  // Workstream B & D: Slides container and live region
  const slidesContainer = document.createElement('div');
  slidesContainer.className = 'carousel-slides';
  slidesContainer.setAttribute('aria-atomic', 'true');

  const indicators = document.createElement('ol');
  indicators.className = 'carousel-indicators';
  indicators.setAttribute('role', 'tablist');
  indicators.setAttribute('aria-label', 'Carousel slides');
  indicators.setAttribute('aria-orientation', 'horizontal');

  // Single-slide edge case
  if (slides.length === 1) {
    const slide = slides[0];
    slide.id = `carousel-${carouselId}-slide-0`;
    slide.className = 'carousel-slide active';
    slide.setAttribute('role', 'tabpanel');
    slide.setAttribute('aria-hidden', 'false');
    slide.removeAttribute('inert');

    const cells = [...slide.children];
    if (cells.length >= 2) {
      const caption = document.createElement('div');
      caption.className = 'carousel-caption';
      while (cells[1].firstChild) {
        caption.appendChild(cells[1].firstChild);
      }
      cells[1].replaceWith(caption);
    }

    const hasFocusable = slide.querySelector('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!hasFocusable) {
      slide.setAttribute('tabindex', '0');
    }

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
    const heading = slide.querySelector('h1, h2, h3, h4, h5, h6');
    const tabLabel = (heading && heading.textContent.trim()) ? heading.textContent.trim() : `Slide ${idx + 1}`;

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

      const hasFocusable = slide.querySelector('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!hasFocusable) {
        slide.setAttribute('tabindex', '0');
      } else {
        slide.removeAttribute('tabindex');
      }

      indicator.classList.add('active');
      indicator.setAttribute('aria-selected', 'true');
      indicator.setAttribute('tabindex', '0');
    } else {
      slide.classList.remove('active');
      slide.setAttribute('aria-hidden', 'true');
      slide.setAttribute('inert', '');
      slide.removeAttribute('tabindex');

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

  // Workstream C: Native visible autoplay control button (First interactive control)
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
    // Deactivate previous slide and indicator
    const prevSlide = slides[currentIdx];
    prevSlide.classList.remove('active');
    prevSlide.setAttribute('aria-hidden', 'true');
    prevSlide.setAttribute('inert', '');
    prevSlide.removeAttribute('tabindex');

    indicators.children[currentIdx].classList.remove('active');
    indicators.children[currentIdx].setAttribute('aria-selected', 'false');
    indicators.children[currentIdx].setAttribute('tabindex', '-1');

    currentIdx = (newIdx + slides.length) % slides.length;

    // Activate new slide and indicator
    const activeSlide = slides[currentIdx];
    activeSlide.classList.add('active');
    activeSlide.setAttribute('aria-hidden', 'false');
    activeSlide.removeAttribute('inert');

    const hasFocusable = activeSlide.querySelector('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!hasFocusable) {
      activeSlide.setAttribute('tabindex', '0');
    } else {
      activeSlide.removeAttribute('tabindex');
    }

    indicators.children[currentIdx].classList.add('active');
    indicators.children[currentIdx].setAttribute('aria-selected', 'true');
    indicators.children[currentIdx].setAttribute('tabindex', '0');
  }

  // Autoplay button toggle
  autoplayBtn.addEventListener('click', () => {
    if (isPlaying && !isFocusStopped) {
      // Explicitly stop rotation
      isPlaying = false;
      isFocusStopped = true;
    } else {
      // Explicitly start rotation
      isPlaying = true;
      isFocusStopped = false;
      isHovered = false;
    }
    syncAutoplay();
  });

  // Previous and next button clicks
  prevBtn.addEventListener('click', () => {
    showSlide(currentIdx - 1);
  });

  nextBtn.addEventListener('click', () => {
    showSlide(currentIdx + 1);
  });

  // Pointer hover pause and resume
  block.addEventListener('mouseenter', () => {
    isHovered = true;
    syncAutoplay();
  });

  block.addEventListener('mouseleave', () => {
    isHovered = false;
    syncAutoplay();
  });

  // Focus enter: stop automatic rotation permanently until explicit restart
  block.addEventListener('focusin', (e) => {
    const focusFromOutside = !e.relatedTarget || !block.contains(e.relatedTarget);
    if (focusFromOutside) {
      if (isPlaying && !isFocusStopped) {
        isFocusStopped = true;
        syncAutoplay();
      }
    }
  });

  // Keyboard navigation on tablist indicators
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

  // DOM assembly: autoplayBtn must occur first in tab sequence
  block.innerHTML = '';
  block.appendChild(autoplayBtn);
  block.appendChild(slidesContainer);
  block.appendChild(prevBtn);
  block.appendChild(nextBtn);
  block.appendChild(indicators);

  // Initialize button and rotation
  syncAutoplay();
}
