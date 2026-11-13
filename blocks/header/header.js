export default function decorate(block) {
  block.innerHTML = `
<div class="we-header-utility">
  <div class="we-header-container">
    <div class="we-lang"><span class="we-flag">&#x1f1fa;&#x1f1f8;</span> EN</div>
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
    <div class="we-search">
      <a href="/content/we-retail/us/en/search.html" class="we-search-btn" aria-label="Search">&#x1f50d;</a>
    </div>
  </div>
</div>`;
}

