export default function decorate(block) {
  block.innerHTML = `
<div class="we-header-utility">
  <div class="we-header-container">
    <div class="we-lang">
      <button class="we-lang-btn" type="button" aria-expanded="false" aria-haspopup="true" aria-label="Select Language">
        <span class="we-flag">&#x1f1fa;&#x1f1f8;</span> EN <span class="we-lang-arrow" aria-hidden="true">&#x25be;</span>
      </button>
      <div class="we-lang-dropdown" role="menu">
        <a href="/content/we-retail/us/en.html" class="active" role="menuitem">United States (EN)</a>
        <a href="/content/we-retail/us/es.html" role="menuitem">United States (ES)</a>
        <a href="/content/we-retail/ca/en.html" role="menuitem">Canada (EN)</a>
        <a href="/content/we-retail/ca/fr.html" role="menuitem">Canada (FR)</a>
        <a href="/content/we-retail/de/de.html" role="menuitem">Germany (DE)</a>
        <a href="/content/we-retail/fr/fr.html" role="menuitem">France (FR)</a>
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
      <form class="we-search-form" action="/content/we-retail/us/en/search.html" method="get" role="search">
        <input class="we-search-input" type="search" name="fulltext" placeholder="Search" aria-label="Search">
        <button class="we-search-btn" aria-label="Search" type="submit">&#x1f50d;</button>
      </form>
    </div>
  </div>
</div>`;

  // Item C: Accessible Language Selector (Enter, Space, Escape, outside click)
  const langContainer = block.querySelector('.we-lang');
  const langBtn = block.querySelector('.we-lang-btn');
  if (langBtn && langContainer) {
    const toggleDropdown = (open) => {
      const shouldOpen = open !== undefined ? open : !langContainer.classList.contains('open');
      langContainer.classList.toggle('open', shouldOpen);
      langBtn.setAttribute('aria-expanded', String(shouldOpen));
    };

    langBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown();
    });

    langBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleDropdown();
      } else if (e.key === 'Escape' && langContainer.classList.contains('open')) {
        e.preventDefault();
        toggleDropdown(false);
        langBtn.focus();
      } else if (e.key === 'ArrowDown' && langContainer.classList.contains('open')) {
        e.preventDefault();
        const firstLink = langContainer.querySelector('.we-lang-dropdown a');
        if (firstLink) firstLink.focus();
      }
    });

    langContainer.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        toggleDropdown(false);
        langBtn.focus();
      }
    });

    document.addEventListener('click', () => {
      toggleDropdown(false);
    });
  }

  // Item D: Accessible Search Form (Enter submit, focus, toggle, parameter preservation)
  const searchForm = block.querySelector('.we-search-form');
  const searchBtn = block.querySelector('.we-search-btn');
  const searchInput = block.querySelector('.we-search-input');

  if (searchForm && searchBtn && searchInput) {
    const openSearch = () => {
      searchForm.classList.add('active');
      searchInput.classList.add('active');
      searchInput.focus();
    };

    const closeSearch = () => {
      searchForm.classList.remove('active');
      searchInput.classList.remove('active');
    };

    searchBtn.addEventListener('click', (e) => {
      if (!searchForm.classList.contains('active')) {
        e.preventDefault();
        openSearch();
      } else if (!searchInput.value.trim()) {
        e.preventDefault();
        closeSearch();
      }
      // If active and has value, natural form submission to /content/we-retail/us/en/search.html?fulltext=...
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeSearch();
        searchBtn.focus();
      }
    });

    document.addEventListener('click', (e) => {
      if (!searchForm.contains(e.target)) {
        if (!searchInput.value.trim()) {
          closeSearch();
        }
      }
    });
  }
}

