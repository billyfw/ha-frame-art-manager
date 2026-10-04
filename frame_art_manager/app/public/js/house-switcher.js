/**
 * House switcher (multi-home), for the per-home pages only.
 *
 * Since 2026-10-04 the gallery, the display list and the tagsets cover every home at once
 * (`/api/ha/tvs?house=all`; each display carries its home). Statistics, the display logs and
 * the recency settings are still kept per home, so this control sits on those pages. The
 * selection is a `house` cookie that the server reads on every request. Hidden with fewer than
 * two homes.
 */
(function () {
  'use strict';

  function setHouseCookie(id) {
    // One year, path=/ so every API call carries it.
    document.cookie = 'house=' + encodeURIComponent(id) + ';path=/;max-age=31536000;samesite=lax';
  }

  async function init() {
    let data;
    try {
      const response = await fetch('api/ha/houses');
      if (!response.ok) return;
      data = await response.json();
    } catch (err) {
      return; // never block the gallery on this
    }

    const houses = (data && data.houses) || [];
    if (houses.length < 2) return;

    const mounts = [
      document.querySelector('#analytics-tab .analytics-header'),
      document.getElementById('advanced-recency-content'),
    ].filter(Boolean);

    mounts.forEach(function (mount, index) {
      const id = 'house-select-' + index;
      const wrapper = document.createElement('div');
      wrapper.className = 'house-switcher';
      wrapper.style.display = 'inline-flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.margin = '0 12px 8px 0';

      const label = document.createElement('label');
      label.setAttribute('for', id);
      label.textContent = 'Home';
      label.style.marginRight = '6px';

      const select = document.createElement('select');
      select.id = id;
      select.title = 'Statistics, display logs and recency settings are kept per home';
      for (const house of houses) {
        const option = document.createElement('option');
        option.value = house.id;
        option.textContent = house.name;
        if (house.id === data.active) option.selected = true;
        select.appendChild(option);
      }

      select.addEventListener('change', function () {
        setHouseCookie(select.value);
        window.location.reload();
      });

      wrapper.appendChild(label);
      wrapper.appendChild(select);
      // In the statistics header: before the close button; in the recency panel: at the top.
      const closeBtn = mount.querySelector('#go-home-analytics-btn');
      mount.insertBefore(wrapper, closeBtn || mount.firstChild);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
