export default function decorate(block) {
  if (block.classList.contains('cards-decorated')) return;

  // Detect whether this card block is a product grid or a stories grid
  const hasProducts = block.querySelector('.price, strong') || block.querySelector('a[href*="/products/"]');
  const hasStories = block.querySelector('a[href*="/experience/"]');

  if (hasProducts && !hasStories) {
    block.classList.add('cards-products');
  } else if (hasStories) {
    block.classList.add('cards-stories');
  }

  const ul = document.createElement('ul');
  [...block.children].forEach((row) => {
    const li = document.createElement('li');
    while (row.firstElementChild) li.append(row.firstElementChild);
    [...li.children].forEach((div) => {
      if (div.children.length === 1 && div.querySelector('picture, img')) {
        div.className = 'cards-card-image';
      } else {
        div.className = 'cards-card-body';
      }
    });
    ul.append(li);
  });
  block.textContent = '';
  block.append(ul);
  block.classList.add('cards-decorated');
}
