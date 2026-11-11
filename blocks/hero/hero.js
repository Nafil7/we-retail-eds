export default function decorate(block) {
  // Read instrumented (Universal Editor) or published block rows
  const headingEl = block.querySelector('[data-aue-prop="content_heading"]') || block.querySelector('h1, h2, p');
  const imgEl = block.querySelector('[data-aue-prop="media_desktopImage"] img') || block.querySelector('img');
  const title = headingEl ? headingEl.textContent.trim() : '';

  const card = document.createElement('div');
  card.className = 'hero-content';

  if (title) {
    const h1 = document.createElement('h1');
    h1.textContent = title;
    card.append(h1);
  }

  // Preserve picture
  if (imgEl) {
    const pic = imgEl.closest('picture') || imgEl;
    block.prepend(pic);
  }

  block.append(card);
}
