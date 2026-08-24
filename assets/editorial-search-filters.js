(function() {
  'use strict';

  var PANDA_PRESS_EXCLUSION = '-tag:"Panda Press"';
  var selectors = {
    form: '[data-editorial-search-form]',
    visibleQuery: '[data-editorial-search-visible-query]',
    shopifyQuery: '[data-editorial-search-shopify-query]',
    pandaPressFilter: '[data-editorial-search-panda-press-filter]'
  };

  function normalizeWhitespace(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function removePandaPressExclusion(value) {
    return normalizeWhitespace(
      (value || '').split(PANDA_PRESS_EXCLUSION).join(' ')
    );
  }

  function buildShopifyQuery(value, exclusionActive) {
    var visibleQuery = removePandaPressExclusion(value);

    if (!exclusionActive || visibleQuery.length === 0) {
      return visibleQuery;
    }

    return visibleQuery + ' ' + PANDA_PRESS_EXCLUSION;
  }

  function isExclusionActive(form) {
    var checkbox = form.querySelector(selectors.pandaPressFilter);

    if (checkbox) {
      return checkbox.checked;
    }

    return (
      form.getAttribute('data-editorial-search-exclude-panda-press') === 'true'
    );
  }

  function prepareForm(form) {
    var visibleInput = form.querySelector(selectors.visibleQuery);
    var shopifyQueryInput = form.querySelector(selectors.shopifyQuery);

    if (!visibleInput || !shopifyQueryInput) {
      return true;
    }

    var visibleQuery = removePandaPressExclusion(visibleInput.value);
    visibleInput.value = visibleQuery;
    shopifyQueryInput.value = buildShopifyQuery(
      visibleQuery,
      isExclusionActive(form)
    );

    if (visibleQuery.length === 0) {
      visibleInput.focus();
      return false;
    }

    return true;
  }

  function handleSubmit(event) {
    if (!prepareForm(event.currentTarget)) {
      event.preventDefault();
    }
  }

  function handleFilterChange(event) {
    var form = event.currentTarget.form;

    if (!form || !prepareForm(form)) {
      return;
    }

    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
    } else {
      form.submit();
    }
  }

  function init() {
    var forms = document.querySelectorAll(selectors.form);

    Array.prototype.forEach.call(forms, function(form) {
      form.addEventListener('submit', handleSubmit);

      var checkbox = form.querySelector(selectors.pandaPressFilter);
      if (checkbox) {
        checkbox.addEventListener('change', handleFilterChange);
      }
    });
  }

  window.theme = window.theme || {};
  window.theme.EditorialSearchFilters = {
    exclusion: PANDA_PRESS_EXCLUSION,
    buildShopifyQuery: buildShopifyQuery,
    removePandaPressExclusion: removePandaPressExclusion,
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
