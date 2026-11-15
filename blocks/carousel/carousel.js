let carouselCounter = 0;

export default function decorate(block) {
  const slides = [...block.children];
  if (slides.length === 0) return;

  const carouselId = ++carouselCounter;

  const slidesContainer = document.createElement('div');
  slidesContainer.className = 'carousel-slides';

  const indicators = document.createElement('ol');
  indicators.className = 'carousel-indicators';
  indicators.setAttribute('role', 'tablist');
  indicators.setAttribute('aria-label', 'Carousel slides');
  indicators.setAttribute('aria-orientation', 'horizontal');

  slides.forEach((slide, idx) => {
    const slideId = `carousel-${carouselId}-slide-${idx}`;
    const tabId = `carousel-${carouselId}-tab-${idx}`;

    slide.id = slideId;
    slide.className = 'carousel-slide';
    slide.setAttribute('role', 'tabpanel');
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `${idx + 1} of ${slides.length}`);
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

    if (idx === 0) {
      slide.classList.add('active');
      slide.setAttribute('aria-hidden', 'false');
      slide.removeAttribute('inert');
    } else {
      slide.setAttribute('aria-hidden', 'true');
      slide.setAttribute('inert', '');
    }

    slidesContainer.appendChild(slide);

    // Indicator button (WAI-ARIA Tab)
    const indicator = document.createElement('button');
    indicator.id = tabId;
    indicator.className = 'carousel-indicator';
    indicator.setAttribute('role', 'tab');
    indicator.setAttribute('aria-label', `Slide ${idx + 1}`);
    indicator.setAttribute('aria-controls', slideId);

    if (idx === 0) {
      indicator.classList.add('active');
      indicator.setAttribute('aria-selected', 'true');
      indicator.setAttribute('tabindex', '0');
    } else {
      indicator.setAttribute('aria-selected', 'false');
      indicator.setAttribute('tabindex', '-1');
    }
    indicator.addEventListener('click', () => showSlide(idx));
    indicators.appendChild(indicator);
  });

  // Navigation buttons
  const prevBtn = document.createElement('button');
  prevBtn.className = 'carousel-btn prev';
  prevBtn.innerHTML = '&#10094;';
  prevBtn.setAttribute('aria-label', 'Previous slide');

  const nextBtn = document.createElement('button');
  nextBtn.className = 'carousel-btn next';
  nextBtn.innerHTML = '&#10095;';
  nextBtn.setAttribute('aria-label', 'Next slide');

  let currentIdx = 0;
  let timer = null;

  function showSlide(newIdx) {
    // Deactivate previous slide and indicator
    slides[currentIdx].classList.remove('active');
    slides[currentIdx].setAttribute('aria-hidden', 'true');
    slides[currentIdx].setAttribute('inert', '');

    indicators.children[currentIdx].classList.remove('active');
    indicators.children[currentIdx].setAttribute('aria-selected', 'false');
    indicators.children[currentIdx].setAttribute('tabindex', '-1');

    currentIdx = (newIdx + slides.length) % slides.length;

    // Activate new slide and indicator
    slides[currentIdx].classList.add('active');
    slides[currentIdx].setAttribute('aria-hidden', 'false');
    slides[currentIdx].removeAttribute('inert');

    indicators.children[currentIdx].classList.add('active');
    indicators.children[currentIdx].setAttribute('aria-selected', 'true');
    indicators.children[currentIdx].setAttribute('tabindex', '0');
  }

  prevBtn.addEventListener('click', () => showSlide(currentIdx - 1));
  nextBtn.addEventListener('click', () => showSlide(currentIdx + 1));

  // State-managed autoplay lifecycle (5000ms matching AEM Core Components data-cmp-delay="5000")
  let isHovered = false;
  let isFocused = false;

  function startAutoplay() {
    if (!timer && !isHovered && !isFocused) {
      timer = setInterval(() => {
        showSlide(currentIdx + 1);
      }, 5000);
    }
  }

  function pauseAutoplay() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function syncAutoplay() {
    if (isHovered || isFocused) {
      pauseAutoplay();
    } else {
      startAutoplay();
    }
  }

  block.addEventListener('mouseenter', () => {
    isHovered = true;
    syncAutoplay();
  });

  block.addEventListener('mouseleave', () => {
    isHovered = false;
    syncAutoplay();
  });

  block.addEventListener('focusin', () => {
    isFocused = true;
    syncAutoplay();
  });

  block.addEventListener('focusout', (e) => {
    // If focus moves to another control inside the carousel, do not treat focus as lost
    if (e.relatedTarget && block.contains(e.relatedTarget)) {
      return;
    }
    if (document.activeElement && block.contains(document.activeElement)) {
      return;
    }
    isFocused = false;
    syncAutoplay();
  });

  // Keyboard navigation on indicators (WAI-ARIA tabs pattern: ArrowLeft, ArrowRight, Home, End)
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

  block.innerHTML = '';
  block.appendChild(slidesContainer);
  block.appendChild(prevBtn);
  block.appendChild(nextBtn);
  block.appendChild(indicators);

  startAutoplay();
}
