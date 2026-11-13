export default function decorate(block) {
  block.innerHTML = `
<div class="we-header-utility">
  <div class="we-header-container">
    <div class="we-lang" role="button" aria-expanded="false" tabindex="0">
      <span class="we-flag">&#x1f1fa;&#x1f1f8;</span> EN
      <div class="we-lang-dropdown">
        <a href="/content/we-retail/us/en.html" class="active">United States (EN)</a>
        <a href="/content/we-retail/us/es.html">United States (ES)</a>
        <a href="/content/we-retail/ca/en.html">Canada (EN)</a>
        <a href="/content/we-retail/ca/fr.html">Canada (FR)</a>
        <a href="/content/we-retail/de/de.html">Germany (DE)</a>
        <a href="/content/we-retail/fr/fr.html">France (FR)</a>
      </div>
    </div>
    <div class="we-user-nav">
      <a href="/content/we-retail/us/en/user/account.html">ACCOUNT</a>
      <a href="/content/we-retail/us/en/user/profile.html">PROFILE</a>
      <a href="/content/we-retail/us/en/user/wishlist.html">&#x2661; WISHLIST</a>
      <a href="/content/we-retail/us/en/user/cart.html" class="we-cart">&#x1f6d2; MY CART</a>
    </div>
  </div>
</div>
<div class="we-header-main">
  <div class="we-header-container">
    <div class="we-logo">
      <a href="/content/we-retail/us/en.html">
        <span class="we-logo-we">WE</span><span class="we-logo-dot">.</span><span class="we-logo-retail">RETAIL</span>
      </a>
    </div>
    <nav class="we-nav">
      <a href="/content/we-retail/us/en/experience.html">EXPERIENCE</a>
      <a href="/content/we-retail/us/en/men.html">MEN</a>
      <a href="/content/we-retail/us/en/women.html">WOMEN</a>
      <a href="/content/we-retail/us/en/equipment.html">EQUIPMENT</a>
      <a href="/content/we-retail/us/en/about-us.html">ABOUT US</a>
      <a href="/content/we-retail/us/en/products.html">PRODUCTS</a>
      <a href="/content/we-retail/us/en/community.html">COMMUNITY</a>
    </nav>
    <div class="we-actions">
      <form class="we-search-form" action="/content/we-retail/us/en/search.html" method="get">
        <input class="we-search-input" type="text" name="fulltext" placeholder="Search" aria-label="Search">
      </form>
      <button class="we-search-btn" aria-label="Search" type="button">&#x1f50d;</button>
    </div>
  </div>
</div>`;

  const langToggle = block.querySelector('.we-lang');
  if (langToggle) {
    langToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = langToggle.classList.toggle('open');
      langToggle.setAttribute('aria-expanded', String(isOpen));
    });
    document.addEventListener('click', () => {
      langToggle.classList.remove('open');
      langToggle.setAttribute('aria-expanded', 'false');
    });
  }

  const searchBtn = block.querySelector('.we-search-btn');
  const searchInput = block.querySelector('.we-search-input');
  if (searchBtn && searchInput) {
    searchBtn.addEventListener('click', () => {
      searchInput.classList.toggle('active');
      if (searchInput.classList.contains('active')) {
        searchInput.focus();
      }
    });
  }
}

