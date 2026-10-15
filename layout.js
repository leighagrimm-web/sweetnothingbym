/* Shared header and footer for the public pages. */
(function () {
  const cfg = SN.load();
  const page = document.body.dataset.page || '';
  const links = [
    ['order', 'index.html', 'Order'],
    ['about', 'about.html', 'About'],
    ['events', 'events.html', 'Special Events'],
    ['gallery', 'gallery.html', 'Gallery']
  ];
  const count = SN.getBag().reduce((a, it) => a + it.qty, 0);
  const onOrder = page === 'order';

  const header = document.getElementById('site-header');
  if (header) {
    header.innerHTML =
      '<div class="proto-banner">Prototype preview: orders here are for demo only and are not sent anywhere.</div>' +
      '<header class="site-header"><div class="wrap">' +
        '<a class="brand" href="index.html"><img src="assets/logo.png" alt="Sweet Nothings by M"><span>Sweet Nothings <em>by M</em></span></a>' +
        '<div class="header-right">' +
          '<nav class="main-nav" aria-label="Main">' +
            links.map(([key, href, label]) => '<a href="' + href + '"' + (key === page ? ' aria-current="page"' : '') + '>' + label + '</a>').join('') +
          '</nav>' +
          '<a class="icon-btn" href="' + SN.esc(cfg.instagram) + '" target="_blank" rel="noopener" aria-label="Instagram ' + SN.esc(cfg.instagramHandle) + '">' + SN_ICONS.insta + '</a>' +
          (onOrder
            ? '<button type="button" class="bag-btn" id="bag-btn" aria-label="Open bag">' + SN_ICONS.bag + ' Bag <span class="bag-count" id="bag-count">' + count + '</span></button>'
            : '<a class="bag-btn" href="index.html?bag=1" aria-label="Open bag">' + SN_ICONS.bag + ' Bag <span class="bag-count">' + count + '</span></a>') +
        '</div>' +
      '</div></header>';
  }

  const footer = document.getElementById('site-footer');
  if (footer) {
    footer.innerHTML =
      '<footer class="site-footer"><div class="wrap">' +
        '<span>© Sweet Nothings by M · Pickup in ' + SN.esc(cfg.pickupCity) + '</span>' +
        '<nav aria-label="Footer">' +
          '<a href="' + SN.esc(cfg.instagram) + '" target="_blank" rel="noopener">Instagram ' + SN.esc(cfg.instagramHandle) + '</a>' +
          '<a href="admin.html">Owner admin (prototype)</a>' +
        '</nav>' +
      '</div></footer>';
  }
})();
