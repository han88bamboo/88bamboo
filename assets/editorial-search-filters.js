(function() {
  'use strict';

  var EXCLUSION_TAGS = [
    'Section: Books',
    'Section: DuRhum Rum Reviews',
    'Section: Rhythm and Booze',
    'Section: Bottoms Up',
    'Section: 88 Bamboo Philippines',
    'Section: Japanese Whisky Dictionary',
    "Section: Sku's Drinks",
    'Section: Sicklehut',
    'Section: SG Alcohol Guy',
    'Section: Prints',
    'Section: TV'
  ];
  var selectors = {
    form: '[data-editorial-search-form]',
    visibleQuery: '[data-editorial-search-visible-query]',
    shopifyQuery: '[data-editorial-search-shopify-query]',
    filter: '[data-editorial-search-filter]'
  };

  function normalizeWhitespace(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function getExclusionClause(tag) {
    return '-tag:"' + tag + '"';
  }

  function removeManagedExclusions(value) {
    var visibleQuery = value || '';

    EXCLUSION_TAGS.forEach(function(tag) {
      visibleQuery = visibleQuery.split(getExclusionClause(tag)).join(' ');
    });

    return normalizeWhitespace(visibleQuery);
  }

  function getActiveExclusionTags(form) {
    var checkboxes = form.querySelectorAll(selectors.filter);

    if (checkboxes.length > 0) {
      return Array.prototype.reduce.call(checkboxes, function(tags, checkbox) {
        if (checkbox.checked && tags.indexOf(checkbox.value) === -1) {
          tags.push(checkbox.value);
        }

        return tags;
      }, []);
    }

    if (
      form.getAttribute('data-editorial-search-default-exclusions') === 'true'
    ) {
      return EXCLUSION_TAGS.slice();
    }

    return [];
  }

  function buildShopifyQuery(value, activeExclusionTags) {
    var visibleQuery = removeManagedExclusions(value);

    if (visibleQuery.length === 0) {
      return visibleQuery;
    }

    var exclusionClauses = activeExclusionTags.map(getExclusionClause);
    return normalizeWhitespace(
      [visibleQuery].concat(exclusionClauses).join(' ')
    );
  }

  function prepareForm(form) {
    var visibleInput = form.querySelector(selectors.visibleQuery);
    var shopifyQueryInput = form.querySelector(selectors.shopifyQuery);

    if (!visibleInput || !shopifyQueryInput) {
      return true;
    }

    var visibleQuery = removeManagedExclusions(visibleInput.value);
    visibleInput.value = visibleQuery;
    shopifyQueryInput.value = buildShopifyQuery(
      visibleQuery,
      getActiveExclusionTags(form)
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

      var checkboxes = form.querySelectorAll(selectors.filter);
      Array.prototype.forEach.call(checkboxes, function(checkbox) {
        checkbox.addEventListener('change', handleFilterChange);
      });
    });
  }

  window.theme = window.theme || {};
  window.theme.EditorialSearchFilters = {
    exclusionTags: EXCLUSION_TAGS.slice(),
    buildShopifyQuery: buildShopifyQuery,
    getExclusionClause: getExclusionClause,
    removeManagedExclusions: removeManagedExclusions,
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
