/**
 * House switcher (multi-home).
 *
 * Selection is stored in a `house` cookie that the server reads on every
 * request, so the rest of the app needs no changes to become house-aware.
 * The control hides itself when fewer than two homes are configured, so it
 * stays invisible until Maui exists.
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

    const mount = document.querySelector('.toolbar-right') || document.querySelector('.gallery-toolbar');
    if (!mount) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'house-switcher';

    const label = document.createElement('label');
    label.setAttribute('for', 'house-select');
    label.textContent = 'Home';
    label.style.marginRight = '6px';

    const select = document.createElement('select');
    select.id = 'house-select';
    select.title = 'Which home to manage (TVs, tagsets, analytics)';
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
    mount.insertBefore(wrapper, mount.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
