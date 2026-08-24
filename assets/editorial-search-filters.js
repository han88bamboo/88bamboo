(function() {
  'use strict';

  var EXCLUSION_TAGS = [
    'Section: Books',
    'Section: DuRhum Rum Reviews',
    'Section: Rhythm and Booze',
    'Section: Bottoms Up',
    'Section: 88 Bamboo Japan',
    'Section: 88 Bamboo Hong Kong',
    'Section: 88 Bamboo Taiwan',
    'Section: 88 Bamboo Philippines',
    'Section: 88 Bamboo Thailand',
    'Section: 88 Bamboo Vietnam',
    'Section: 88 Bamboo Indonesia',
    'Section: 88 Bamboo Korea',
    'Section: Japanese Whisky Dictionary',
    "Section: Sku's Drinks",
    'Section: Sicklehut',
    'Section: SG Alcohol Guy',
    'Section: Prints',
    'Section: TV'
  ];
  var LEGACY_EXCLUSION_TAGS = ['Panda Press'];
  var CLEANUP_TAGS = EXCLUSION_TAGS.concat(LEGACY_EXCLUSION_TAGS);
  var BROWSE_GROUP_PARAMETER = 'browse_group';
  var selectors = {
    form: '[data-editorial-search-form]',
    visibleQuery: '[data-editorial-search-visible-query]',
    shopifyQuery: '[data-editorial-search-shopify-query]',
    persistentFilter: '[data-editorial-search-filter]',
    browseFilter: '[data-editorial-search-browse-filter]',
    browseGroup: '[data-editorial-search-browse-group]',
    browseGroupSummary: '[data-editorial-search-browse-group-summary]',
    browseGroupState: '[data-editorial-search-browse-group-state]',
    browseClear: '[data-editorial-search-browse-clear]'
  };

  function normalizeWhitespace(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeHtmlEntities(value) {
    return (value || '')
      .replace(/&amp;quot;/gi, '"')
      .replace(/&quot;|&#34;|&#x22;/gi, '"')
      .replace(/&apos;|&#39;|&#x27;/gi, "'");
  }

  function addUnique(values, value) {
    if (value && values.indexOf(value) === -1) {
      values.push(value);
    }
  }

  function getExclusionClause(tag) {
    return '-tag:"' + tag + '"';
  }

  function getFormPersistentFilters(form) {
    if (!form || !form.elements) {
      return [];
    }

    return Array.prototype.filter.call(form.elements, function(element) {
      return (
        element.hasAttribute &&
        element.hasAttribute('data-editorial-search-filter')
      );
    });
  }

  function getFormBrowseFilters(form) {
    var browseFilters = document.querySelectorAll(selectors.browseFilter);

    return Array.prototype.filter.call(browseFilters, function(filter) {
      return filter.form === form;
    });
  }

  function getBrowseTags(filter) {
    var tags = (filter.getAttribute('data-editorial-search-browse-tags') || '')
      .split('~');

    return tags.reduce(function(normalizedTags, tag) {
      tag = normalizeWhitespace(tag);
      addUnique(normalizedTags, tag);
      return normalizedTags;
    }, []);
  }

  function getManagedCleanupTags() {
    var cleanupTags = CLEANUP_TAGS.slice();
    var browseFilters = document.querySelectorAll(selectors.browseFilter);

    Array.prototype.forEach.call(browseFilters, function(filter) {
      getBrowseTags(filter).forEach(function(tag) {
        addUnique(cleanupTags, tag);
      });
    });

    return cleanupTags;
  }

  function removeManagedExclusions(value) {
    var visibleQuery = normalizeHtmlEntities(value);

    getManagedCleanupTags().forEach(function(tag) {
      visibleQuery = visibleQuery.split(getExclusionClause(tag)).join(' ');
    });

    return normalizeWhitespace(visibleQuery);
  }

  function getActiveExclusionTags(form) {
    var checkboxes = getFormPersistentFilters(form);

    if (checkboxes.length > 0) {
      return checkboxes.reduce(function(tags, checkbox) {
        if (checkbox.checked) {
          addUnique(tags, checkbox.value);
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

  function getBrowseGroupStateInput(form) {
    return form.querySelector(selectors.browseGroupState);
  }

  function getBrowseGroupContainers() {
    return document.querySelectorAll(selectors.browseGroup);
  }

  function getBrowseGroupCheckboxes(form, groupName) {
    return getFormBrowseFilters(form).filter(function(checkbox) {
      return (
        checkbox.getAttribute('data-editorial-search-browse-group-name') ===
        groupName
      );
    });
  }

  function isValidBrowseGroup(form, groupName) {
    if (!groupName) {
      return false;
    }

    return getBrowseGroupCheckboxes(form, groupName).length > 0;
  }

  function getUrlBrowseGroup() {
    var queryString = window.location.search.replace(/^\?/, '');
    var pairs = queryString ? queryString.split('&') : [];
    var browseGroup = '';

    pairs.some(function(pair) {
      var parts = pair.split('=');
      var name = decodeURIComponent((parts[0] || '').replace(/\+/g, ' '));

      if (name !== BROWSE_GROUP_PARAMETER) {
        return false;
      }

      browseGroup = decodeURIComponent((parts[1] || '').replace(/\+/g, ' '));
      return true;
    });

    return browseGroup;
  }

  function queryHasExclusion(query, tag) {
    return (
      normalizeHtmlEntities(query).indexOf(getExclusionClause(tag)) !== -1
    );
  }

  function detectBrowseGroupFromQuery(form, query) {
    var detectedGroup = '';

    getFormBrowseFilters(form).some(function(checkbox) {
      var hasManagedExclusion = getBrowseTags(checkbox).some(function(tag) {
        return queryHasExclusion(query, tag);
      });

      if (hasManagedExclusion) {
        detectedGroup = checkbox.getAttribute(
          'data-editorial-search-browse-group-name'
        );
      }

      return hasManagedExclusion;
    });

    return detectedGroup;
  }

  function getActiveBrowseGroup(form) {
    var stateInput = getBrowseGroupStateInput(form);

    if (!stateInput || stateInput.disabled) {
      return '';
    }

    return stateInput.value;
  }

  function setActiveBrowseGroup(form, groupName) {
    var stateInput = getBrowseGroupStateInput(form);

    if (!stateInput) {
      return;
    }

    stateInput.value = groupName || '';
    stateInput.disabled = !groupName;
  }

  function getBrowseComplementExclusionTags(form) {
    var activeGroup = getActiveBrowseGroup(form);

    if (!activeGroup) {
      return [];
    }

    return getBrowseGroupCheckboxes(form, activeGroup).reduce(function(
      tags,
      checkbox
    ) {
      if (!checkbox.checked) {
        getBrowseTags(checkbox).forEach(function(tag) {
          addUnique(tags, tag);
        });
      }

      return tags;
    }, []);
  }

  function buildShopifyQuery(
    value,
    activeExclusionTags,
    browseExclusionTags
  ) {
    var visibleQuery = removeManagedExclusions(value);

    if (visibleQuery.length === 0) {
      return visibleQuery;
    }

    var allExclusionTags = [];
    (activeExclusionTags || []).forEach(function(tag) {
      addUnique(allExclusionTags, tag);
    });
    (browseExclusionTags || []).forEach(function(tag) {
      addUnique(allExclusionTags, tag);
    });

    var exclusionClauses = allExclusionTags.map(getExclusionClause);
    return normalizeWhitespace(
      [visibleQuery].concat(exclusionClauses).join(' ')
    );
  }

  function updateBrowseAvailability(form) {
    var activeGroup = getActiveBrowseGroup(form);
    var groupContainers = getBrowseGroupContainers();
    var clearButton = document.querySelector(selectors.browseClear);

    Array.prototype.forEach.call(groupContainers, function(container) {
      var groupName = container.getAttribute(
        'data-editorial-search-browse-group'
      );
      var isUnavailable = Boolean(activeGroup && groupName !== activeGroup);
      var summary = container.querySelector(selectors.browseGroupSummary);

      container.classList.toggle(
        'search-page-browse__group--disabled',
        isUnavailable
      );

      if (summary) {
        summary.setAttribute('aria-disabled', String(isUnavailable));
        summary.setAttribute(
          'title',
          isUnavailable ? 'Clear the active Browse filters to use this group' : ''
        );
      }

      if (isUnavailable) {
        container.open = false;
      }

      getBrowseGroupCheckboxes(form, groupName).forEach(function(checkbox) {
        checkbox.disabled = isUnavailable;
      });
    });

    if (clearButton) {
      clearButton.disabled = !activeGroup;
    }
  }

  function syncPaginationBrowseGroup(groupName) {
    var paginationLinks = document.querySelectorAll('.pagination a[href]');

    Array.prototype.forEach.call(paginationLinks, function(link) {
      if (typeof window.URL !== 'function') {
        return;
      }

      var url = new window.URL(link.href, window.location.href);

      if (groupName) {
        url.searchParams.set(BROWSE_GROUP_PARAMETER, groupName);
      } else {
        url.searchParams.delete(BROWSE_GROUP_PARAMETER);
      }

      link.href = url.pathname + url.search + url.hash;
    });
  }

  function initializeBrowseState(form, shopifyQuery) {
    var browseFilters = getFormBrowseFilters(form);

    if (browseFilters.length === 0) {
      return;
    }

    var activeGroup = getUrlBrowseGroup();

    if (!isValidBrowseGroup(form, activeGroup)) {
      activeGroup = detectBrowseGroupFromQuery(form, shopifyQuery);
    }

    if (!isValidBrowseGroup(form, activeGroup)) {
      activeGroup = '';
    }

    setActiveBrowseGroup(form, activeGroup);

    browseFilters.forEach(function(checkbox) {
      var checkboxGroup = checkbox.getAttribute(
        'data-editorial-search-browse-group-name'
      );

      checkbox.checked = Boolean(
        activeGroup === checkboxGroup &&
          !getBrowseTags(checkbox).some(function(tag) {
            return queryHasExclusion(shopifyQuery, tag);
          })
      );
    });

    updateBrowseAvailability(form);
    syncPaginationBrowseGroup(activeGroup);
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
      getActiveExclusionTags(form),
      getBrowseComplementExclusionTags(form)
    );

    if (visibleQuery.length === 0) {
      visibleInput.focus();
      return false;
    }

    return true;
  }

  function submitPreparedForm(form) {
    if (!form || !prepareForm(form)) {
      return;
    }

    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
    } else {
      form.submit();
    }
  }

  function handleSubmit(event) {
    if (!prepareForm(event.currentTarget)) {
      event.preventDefault();
    }
  }

  function handlePersistentFilterChange(event) {
    submitPreparedForm(event.currentTarget.form);
  }

  function handleBrowseFilterChange(event) {
    var checkbox = event.currentTarget;
    var form = checkbox.form;
    var checkboxGroup = checkbox.getAttribute(
      'data-editorial-search-browse-group-name'
    );
    var activeGroup = getActiveBrowseGroup(form);

    if (activeGroup && activeGroup !== checkboxGroup) {
      checkbox.checked = false;
      return;
    }

    var checkedInGroup = getBrowseGroupCheckboxes(form, checkboxGroup).filter(
      function(groupCheckbox) {
        return groupCheckbox.checked;
      }
    );

    setActiveBrowseGroup(
      form,
      checkedInGroup.length > 0 ? checkboxGroup : ''
    );
    updateBrowseAvailability(form);
    syncPaginationBrowseGroup(getActiveBrowseGroup(form));
    submitPreparedForm(form);
  }

  function handleBrowseClear(event) {
    var form = document.getElementById('SearchPageForm');

    if (!form) {
      return;
    }

    getFormBrowseFilters(form).forEach(function(checkbox) {
      checkbox.checked = false;
    });

    setActiveBrowseGroup(form, '');
    updateBrowseAvailability(form);
    syncPaginationBrowseGroup('');
    submitPreparedForm(form);
  }

  function handleBrowseGroupSummaryClick(event) {
    if (event.currentTarget.getAttribute('aria-disabled') === 'true') {
      event.preventDefault();
    }
  }

  function init() {
    var forms = document.querySelectorAll(selectors.form);

    Array.prototype.forEach.call(forms, function(form) {
      var visibleInput = form.querySelector(selectors.visibleQuery);
      var shopifyQueryInput = form.querySelector(selectors.shopifyQuery);

      initializeBrowseState(
        form,
        shopifyQueryInput ? shopifyQueryInput.value : ''
      );

      if (visibleInput) {
        visibleInput.value = removeManagedExclusions(visibleInput.value);
      }

      form.addEventListener('submit', handleSubmit);

      getFormPersistentFilters(form).forEach(function(checkbox) {
        checkbox.addEventListener('change', handlePersistentFilterChange);
      });

      getFormBrowseFilters(form).forEach(function(checkbox) {
        checkbox.addEventListener('change', handleBrowseFilterChange);
      });
    });

    var clearButton = document.querySelector(selectors.browseClear);
    if (clearButton) {
      clearButton.addEventListener('click', handleBrowseClear);
    }

    var browseGroupSummaries = document.querySelectorAll(
      selectors.browseGroupSummary
    );
    Array.prototype.forEach.call(browseGroupSummaries, function(summary) {
      summary.addEventListener('click', handleBrowseGroupSummaryClick);
    });
  }

  window.theme = window.theme || {};
  window.theme.EditorialSearchFilters = {
    exclusionTags: EXCLUSION_TAGS.slice(),
    buildShopifyQuery: buildShopifyQuery,
    getBrowseComplementExclusionTags: getBrowseComplementExclusionTags,
    getExclusionClause: getExclusionClause,
    normalizeHtmlEntities: normalizeHtmlEntities,
    removeManagedExclusions: removeManagedExclusions,
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
