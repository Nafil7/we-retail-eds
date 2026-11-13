export default function decorate(block) {
  const slides = [...block.children];
  if (slides.length === 0) return;

  const slidesContainer = document.createElement('div');
  slidesContainer.className = 'carousel-slides';

  const indicators = document.createElement('ol');
  indicators.className = 'carousel-indicators';
  indicators.setAttribute('role', 'tablist');

  slides.forEach((slide, idx) => {
    slide.className = 'carousel-slide';
    slide.setAttribute('role', 'tabpanel');
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `${idx + 1} of ${slides.length}`);

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
    } else {
      slide.setAttribute('aria-hidden', 'true');
    }

    slidesContainer.appendChild(slide);

    // Indicator button
    const indicator = document.createElement('button');
    indicator.className = 'carousel-indicator';
    indicator.setAttribute('role', 'tab');
    indicator.setAttribute('aria-label', `Slide ${idx + 1}`);
    if (idx === 0) {
      indicator.classList.add('active');
      indicator.setAttribute('aria-selected', 'true');
    } else {
      indicator.setAttribute('aria-selected', 'false');
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
    slides[currentIdx].classList.remove('active');
    slides[currentIdx].setAttribute('aria-hidden', 'true');
    indicators.children[currentIdx].classList.remove('active');
    indicators.children[currentIdx].setAttribute('aria-selected', 'false');

    currentIdx = (newIdx + slides.length) % slides.length;

    slides[currentIdx].classList.add('active');
    slides[currentIdx].setAttribute('aria-hidden', 'false');
    indicators.children[currentIdx].classList.add('active');
    indicators.children[currentIdx].setAttribute('aria-selected', 'true');
  }

  prevBtn.addEventListener('click', () => showSlide(currentIdx - 1));
  nextBtn.addEventListener('click', () => showSlide(currentIdx + 1));

  // 5000ms autoplay matching AEM Core Components data-cmp-delay="5000"
  function startAutoplay() {
    if (!timer) {
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

  block.addEventListener('mouseenter', pauseAutoplay);
  block.addEventListener('mouseleave', startAutoplay);
  block.addEventListener('focusin', pauseAutoplay);
  block.addEventListener('focusout', startAutoplay);

  // Keyboard navigation on indicators
  indicators.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      showSlide(currentIdx - 1);
      indicators.children[currentIdx].focus();
    } else if (e.key === 'ArrowRight') {
      showSlide(currentIdx + 1);
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
