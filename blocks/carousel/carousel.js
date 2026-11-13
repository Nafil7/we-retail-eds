/**
 * Carousel block — We.Retail EDS
 *
 * Source: weretail/components/content/carousel with 3 teaser children.
 * Cloud JCR currently stores these as `cards` model (bug in last migration run).
 * This block handles the carousel model structure when re-migrated correctly.
 *
 * Raw HTML delivered per slide (carousel-item child):
 *   <div data-aue-model="carousel-item">
 *     <div>  ← image cell
 *       <picture><img src="..." alt="title"></picture>
 *     </div>
 *     <div>  ← content cell
 *       <h3>title</h3>
 *       <p>description</p>
 *       <p><a href="...">Explore →</a></p>
 *     </div>
 *   </div>
 *
 * Behavior:
 *  - One slide visible at a time (desktop: show slide with prev/next controls)
 *  - Dot indicators beneath
 *  - Keyboard: ArrowLeft / ArrowRight
 *  - No autoplay (source does not autoplay)
 *  - Idempotent: skip if .carousel-track already present
 */
export default function decorate(block) {
  if (block.querySelector('.carousel-track')) return; // idempotency

  const slides = [...block.children];
  if (slides.length === 0) return;

  // Build track
  const track = document.createElement('div');
  track.className = 'carousel-track';

  slides.forEach((slide, i) => {
    slide.classList.add('carousel-slide');
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `Slide ${i + 1} of ${slides.length}`);
    if (i !== 0) slide.setAttribute('aria-hidden', 'true');

    // Promote image and content semantics within each slide
    const cells = [...slide.children];
    if (cells[0]) cells[0].classList.add('carousel-slide-image');
    if (cells[1]) cells[1].classList.add('carousel-slide-content');

    // CTA button styling
    const ctaP = [...(cells[1]?.querySelectorAll('p') || [])].find((p) => {
      const a = p.querySelector('a');
      return a && p.textContent.trim() === a.textContent.trim();
    });
    if (ctaP) {
      ctaP.querySelector('a').classList.add('button', 'primary');
      ctaP.classList.add('button-wrapper');
    }

    track.append(slide);
  });

  block.innerHTML = '';
  block.append(track);

  // Prev/Next controls
  const prev = document.createElement('button');
  prev.className = 'carousel-prev';
  prev.setAttribute('aria-label', 'Previous slide');
  prev.innerHTML = '&#10094;';

  const next = document.createElement('button');
  next.className = 'carousel-next';
  next.setAttribute('aria-label', 'Next slide');
  next.innerHTML = '&#10095;';

  // Dots
  const dots = document.createElement('div');
  dots.className = 'carousel-dots';
  dots.setAttribute('role', 'tablist');

  const dotEls = slides.map((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'carousel-dot';
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-label', `Go to slide ${i + 1}`);
    dot.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    dots.append(dot);
    return dot;
  });

  block.append(prev, next, dots);

  let current = 0;

  function goTo(index) {
    const allSlides = [...track.children];
    const n = allSlides.length;
    if (n === 0) return;
    const next_i = (index + n) % n;

    allSlides[current].setAttribute('aria-hidden', 'true');
    dotEls[current].setAttribute('aria-selected', 'false');
    dotEls[current].classList.remove('active');

    current = next_i;

    allSlides[current].removeAttribute('aria-hidden');
    dotEls[current].setAttribute('aria-selected', 'true');
    dotEls[current].classList.add('active');

    track.style.transform = `translateX(-${current * 100}%)`;
  }

  // Set initial dot
  if (dotEls[0]) {
    dotEls[0].classList.add('active');
  }

  prev.addEventListener('click', () => goTo(current - 1));
  next.addEventListener('click', () => goTo(current + 1));
  dotEls.forEach((dot, i) => dot.addEventListener('click', () => goTo(i)));

  // Keyboard navigation
  block.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') goTo(current - 1);
    if (e.key === 'ArrowRight') goTo(current + 1);
  });
  block.setAttribute('tabindex', '0');

  // Handle zero/one slide gracefully
  if (slides.length <= 1) {
    prev.style.display = 'none';
    next.style.display = 'none';
    dots.style.display = 'none';
  }
}

