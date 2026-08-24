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
  var BROWSE_OPEN_PARAMETER = 'browse_open';
  var BROWSE_PANEL_OPEN_PARAMETER = 'browse_panel_open';
  var NO_OPEN_BROWSE_GROUPS = 'none';
  var DESKTOP_FILTERS_MEDIA_QUERY = '(min-width: 990px)';
  var selectors = {
    form: '[data-editorial-search-form]',
    visibleQuery: '[data-editorial-search-visible-query]',
    shopifyQuery: '[data-editorial-search-shopify-query]',
    persistentFilter: '[data-editorial-search-filter]',
    browseFilter: '[data-editorial-search-browse-filter]',
    browseGroup: '[data-editorial-search-browse-group]',
    browseGroupSummary: '[data-editorial-search-browse-group-summary]',
    browseGroupSelection: '[data-editorial-search-browse-group-selection]',
    browsePanel: '[data-editorial-search-browse-panel]',
    browseSelectionSummary:
      '[data-editorial-search-browse-selection-summary]',
    browseOpenState: '[data-editorial-search-browse-open-state]',
    browsePanelOpenState:
      '[data-editorial-search-browse-panel-open-state]',
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

  function getInclusionClause(tag) {
    return 'tag:"' + tag + '"';
  }

  function findInclusionClauseIndex(query, tag) {
    var inclusionClause = getInclusionClause(tag);
    var searchFromIndex = 0;
    var inclusionIndex = -1;

    while (
      (inclusionIndex = query.indexOf(inclusionClause, searchFromIndex)) !== -1
    ) {
      if (inclusionIndex === 0 || query.charAt(inclusionIndex - 1) !== '-') {
        return inclusionIndex;
      }

      searchFromIndex = inclusionIndex + inclusionClause.length;
    }

    return -1;
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

  function getManagedBrowseTags() {
    var browseTags = [];
    var browseFilters = document.querySelectorAll(selectors.browseFilter);

    Array.prototype.forEach.call(browseFilters, function(filter) {
      getBrowseTags(filter).forEach(function(tag) {
        addUnique(browseTags, tag);
      });
    });

    return browseTags;
  }

  function getManagedCleanupTags() {
    var cleanupTags = CLEANUP_TAGS.slice();

    getManagedBrowseTags().forEach(function(tag) {
      addUnique(cleanupTags, tag);
    });

    return cleanupTags;
  }

  function removeManagedFilters(value) {
    var visibleQuery = normalizeHtmlEntities(value);
    var firstBrowseInclusionIndex = -1;

    getManagedBrowseTags().forEach(function(tag) {
      var inclusionIndex = findInclusionClauseIndex(visibleQuery, tag);

      if (
        inclusionIndex !== -1 &&
        (firstBrowseInclusionIndex === -1 ||
          inclusionIndex < firstBrowseInclusionIndex)
      ) {
        firstBrowseInclusionIndex = inclusionIndex;
      }
    });

    if (firstBrowseInclusionIndex !== -1) {
      var browseSeparatorIndex = visibleQuery.lastIndexOf(
        ' AND ',
        firstBrowseInclusionIndex
      );

      if (browseSeparatorIndex !== -1) {
        visibleQuery = visibleQuery.slice(0, browseSeparatorIndex);
      } else {
        getManagedBrowseTags().forEach(function(tag) {
          visibleQuery = visibleQuery
            .split(getInclusionClause(tag))
            .join(' ');
        });
        visibleQuery = visibleQuery
          .replace(/\(\s*(?:OR\s*)*\)/g, ' ')
          .replace(/(^|\s)OR(?=\s|$)/g, ' ');
      }
    }

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

  function getUrlParameter(parameterName) {
    var queryString = window.location.search.replace(/^\?/, '');
    var pairs = queryString ? queryString.split('&') : [];
    var parameterValue = null;

    pairs.some(function(pair) {
      var parts = pair.split('=');
      var name = decodeURIComponent((parts[0] || '').replace(/\+/g, ' '));

      if (name !== parameterName) {
        return false;
      }

      parameterValue = decodeURIComponent(
        (parts.slice(1).join('=') || '').replace(/\+/g, ' ')
      );
      return true;
    });

    return parameterValue;
  }

  function getLegacyUrlBrowseGroup() {
    return getUrlParameter('browse_group') || '';
  }

  function queryHasExclusion(query, tag) {
    return (
      normalizeHtmlEntities(query).indexOf(getExclusionClause(tag)) !== -1
    );
  }

  function queryHasInclusion(query, tag) {
    return findInclusionClauseIndex(normalizeHtmlEntities(query), tag) !== -1;
  }

  function detectLegacyBrowseGroupFromQuery(form, query) {
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

  function getBrowseInclusionExpressions(form) {
    var groupNames = [];
    var tagsByGroup = {};

    getFormBrowseFilters(form).forEach(function(checkbox) {
      if (!checkbox.checked) {
        return;
      }

      var groupName = checkbox.getAttribute(
        'data-editorial-search-browse-group-name'
      );

      if (!tagsByGroup[groupName]) {
        tagsByGroup[groupName] = [];
        groupNames.push(groupName);
      }

      getBrowseTags(checkbox).forEach(function(tag) {
        addUnique(tagsByGroup[groupName], tag);
      });
    });

    return groupNames.reduce(function(expressions, groupName) {
      var clauses = tagsByGroup[groupName].map(getInclusionClause);

      if (clauses.length === 1) {
        expressions.push(clauses[0]);
      } else if (clauses.length > 1) {
        expressions.push('(' + clauses.join(' OR ') + ')');
      }

      return expressions;
    }, []);
  }

  function buildShopifyQuery(
    value,
    activeExclusionTags,
    browseInclusionExpressions
  ) {
    var visibleQuery = removeManagedFilters(value);

    if (visibleQuery.length === 0) {
      return visibleQuery;
    }

    var allExclusionTags = [];
    (activeExclusionTags || []).forEach(function(tag) {
      addUnique(allExclusionTags, tag);
    });

    var exclusionClauses = allExclusionTags.map(getExclusionClause);
    var shopifyQuery = normalizeWhitespace(
      [visibleQuery].concat(exclusionClauses).join(' ')
    );

    (browseInclusionExpressions || []).forEach(function(expression) {
      shopifyQuery += ' AND ' + expression;
    });

    return normalizeWhitespace(shopifyQuery);
  }

  function updateBrowseAvailability(form) {
    var groupContainers = getBrowseGroupContainers();
    var clearButton = document.querySelector(selectors.browseClear);
    var hasBrowseSelections = getFormBrowseFilters(form).some(function(
      checkbox
    ) {
      return checkbox.checked;
    });

    Array.prototype.forEach.call(groupContainers, function(container) {
      var groupName = container.getAttribute(
        'data-editorial-search-browse-group'
      );
      var summary = container.querySelector(selectors.browseGroupSummary);

      container.classList.toggle(
        'search-page-browse__group--disabled',
        false
      );

      if (summary) {
        summary.setAttribute('aria-disabled', 'false');
        summary.setAttribute('title', '');
      }

      getBrowseGroupCheckboxes(form, groupName).forEach(function(checkbox) {
        checkbox.disabled = false;
      });
    });

    if (clearButton) {
      clearButton.disabled = !hasBrowseSelections;
    }

    updateBrowseSelectionSummaries(form);
  }

  function getBrowseFilterLabel(checkbox) {
    var option = checkbox.parentNode;
    var label = option && option.querySelector
      ? option.querySelector('label')
      : null;

    return normalizeWhitespace(label ? label.textContent : '');
  }

  function getSelectedBrowseLabels(checkboxes) {
    return checkboxes.reduce(function(labels, checkbox) {
      if (checkbox.checked) {
        addUnique(labels, getBrowseFilterLabel(checkbox));
      }

      return labels;
    }, []);
  }

  function getBrowseSelectionSummary(labels) {
    if (labels.length < 3) {
      return labels.join(', ');
    }

    return labels.length + ' selected';
  }

  function setBrowseSelectionSummary(element, labels) {
    if (!element) {
      return;
    }

    var summary = getBrowseSelectionSummary(labels);
    element.textContent = summary;
    element.hidden = summary.length === 0;
  }

  function updateBrowseSelectionSummaries(form) {
    Array.prototype.forEach.call(
      getBrowseGroupContainers(),
      function(container) {
        var groupName = container.getAttribute(
          'data-editorial-search-browse-group'
        );
        var summary = container.querySelector(
          selectors.browseGroupSelection
        );

        setBrowseSelectionSummary(
          summary,
          getSelectedBrowseLabels(
            getBrowseGroupCheckboxes(form, groupName)
          )
        );
      }
    );

    setBrowseSelectionSummary(
      document.querySelector(selectors.browseSelectionSummary),
      getSelectedBrowseLabels(getFormBrowseFilters(form))
    );
  }

  function getBrowseOpenStateInput(form) {
    return form.querySelector(selectors.browseOpenState);
  }

  function getBrowsePanelOpenStateInput(form) {
    return form.querySelector(selectors.browsePanelOpenState);
  }

  function getSelectedBrowseGroupNames(form) {
    return getFormBrowseFilters(form).reduce(function(groupNames, checkbox) {
      if (checkbox.checked) {
        addUnique(
          groupNames,
          checkbox.getAttribute('data-editorial-search-browse-group-name')
        );
      }

      return groupNames;
    }, []);
  }

  function getOpenBrowseGroupNames() {
    return Array.prototype.reduce.call(
      getBrowseGroupContainers(),
      function(groupNames, container) {
        if (container.open) {
          addUnique(
            groupNames,
            container.getAttribute('data-editorial-search-browse-group')
          );
        }

        return groupNames;
      },
      []
    );
  }

  function getUrlBrowseOpenGroups(form) {
    var openState = getUrlParameter(BROWSE_OPEN_PARAMETER);

    if (openState === null) {
      return null;
    }

    if (!openState || openState === NO_OPEN_BROWSE_GROUPS) {
      return [];
    }

    return openState.split(',').reduce(function(groupNames, groupName) {
      if (isValidBrowseGroup(form, groupName)) {
        addUnique(groupNames, groupName);
      }

      return groupNames;
    }, []);
  }

  function setBrowseOpenState(form, groupNames) {
    var stateInput = getBrowseOpenStateInput(form);

    if (!stateInput) {
      return;
    }

    stateInput.value = groupNames.length
      ? groupNames.join(',')
      : NO_OPEN_BROWSE_GROUPS;
    stateInput.disabled = false;
  }

  function syncPaginationBrowseState(form) {
    var paginationLinks = document.querySelectorAll('.pagination a[href]');
    var stateInput = getBrowseOpenStateInput(form);
    var panelStateInput = getBrowsePanelOpenStateInput(form);

    if (!stateInput || !panelStateInput) {
      return;
    }

    Array.prototype.forEach.call(paginationLinks, function(link) {
      if (typeof window.URL !== 'function') {
        return;
      }

      var url = new window.URL(link.href, window.location.href);
      url.searchParams.delete('browse_group');
      url.searchParams.set(BROWSE_OPEN_PARAMETER, stateInput.value);
      url.searchParams.set(
        BROWSE_PANEL_OPEN_PARAMETER,
        panelStateInput.value
      );
      link.href = url.pathname + url.search + url.hash;
    });
  }

  function setBrowsePanelOpenState(form, isOpen) {
    var stateInput = getBrowsePanelOpenStateInput(form);

    if (!stateInput) {
      return;
    }

    stateInput.value = isOpen ? 'true' : 'false';
    stateInput.disabled = false;
  }

  function restoreBrowsePanelOpenState(form) {
    var panel = document.querySelector(selectors.browsePanel);
    var urlState = getUrlParameter(BROWSE_PANEL_OPEN_PARAMETER);
    var shouldOpen;

    if (!panel) {
      return;
    }

    if (urlState === 'true' || urlState === 'false') {
      shouldOpen = urlState === 'true';
    } else {
      shouldOpen = window.matchMedia
        ? window.matchMedia(DESKTOP_FILTERS_MEDIA_QUERY).matches
        : true;
    }

    panel.open = shouldOpen;
    setBrowsePanelOpenState(form, shouldOpen);
    syncPaginationBrowseState(form);
  }

  function syncBrowsePanelOpenState(form) {
    var panel = document.querySelector(selectors.browsePanel);

    if (!panel) {
      return;
    }

    setBrowsePanelOpenState(form, panel.open);
    syncPaginationBrowseState(form);
  }

  function restoreBrowseOpenState(form) {
    var openGroupNames = getUrlBrowseOpenGroups(form);

    if (openGroupNames === null) {
      openGroupNames = getSelectedBrowseGroupNames(form);
    }

    Array.prototype.forEach.call(
      getBrowseGroupContainers(),
      function(container) {
        var groupName = container.getAttribute(
          'data-editorial-search-browse-group'
        );
        container.open = openGroupNames.indexOf(groupName) !== -1;
      }
    );

    setBrowseOpenState(form, openGroupNames);
    syncPaginationBrowseState(form);
  }

  function syncBrowseOpenState(form) {
    var openGroupNames = getOpenBrowseGroupNames();

    setBrowseOpenState(form, openGroupNames);
    syncPaginationBrowseState(form);
  }

  function initializeBrowseState(form, shopifyQuery) {
    var browseFilters = getFormBrowseFilters(form);

    if (browseFilters.length === 0) {
      return;
    }

    var hasBrowseInclusions = browseFilters.some(function(checkbox) {
      return getBrowseTags(checkbox).some(function(tag) {
        return queryHasInclusion(shopifyQuery, tag);
      });
    });
    var legacyActiveGroup = '';

    if (!hasBrowseInclusions) {
      legacyActiveGroup = getLegacyUrlBrowseGroup();

      if (!isValidBrowseGroup(form, legacyActiveGroup)) {
        legacyActiveGroup = detectLegacyBrowseGroupFromQuery(
          form,
          shopifyQuery
        );
      }

      if (!isValidBrowseGroup(form, legacyActiveGroup)) {
        legacyActiveGroup = '';
      }
    }

    browseFilters.forEach(function(checkbox) {
      var checkboxGroup = checkbox.getAttribute(
        'data-editorial-search-browse-group-name'
      );
      var browseTags = getBrowseTags(checkbox);

      if (hasBrowseInclusions) {
        checkbox.checked = browseTags.some(function(tag) {
          return queryHasInclusion(shopifyQuery, tag);
        });
      } else {
        checkbox.checked = Boolean(
          legacyActiveGroup === checkboxGroup &&
          !browseTags.some(function(tag) {
            return queryHasExclusion(shopifyQuery, tag);
          })
        );
      }
    });

    updateBrowseAvailability(form);
    restoreBrowseOpenState(form);
    restoreBrowsePanelOpenState(form);
  }

  function prepareForm(form) {
    var visibleInput = form.querySelector(selectors.visibleQuery);
    var shopifyQueryInput = form.querySelector(selectors.shopifyQuery);

    if (!visibleInput || !shopifyQueryInput) {
      return true;
    }

    syncBrowseOpenState(form);
    syncBrowsePanelOpenState(form);

    var visibleQuery = removeManagedFilters(visibleInput.value);
    visibleInput.value = visibleQuery;
    shopifyQueryInput.value = buildShopifyQuery(
      visibleQuery,
      getActiveExclusionTags(form),
      getBrowseInclusionExpressions(form)
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
    var form = event.currentTarget.form;

    updateBrowseAvailability(form);
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

    updateBrowseAvailability(form);
    submitPreparedForm(form);
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
        visibleInput.value = removeManagedFilters(visibleInput.value);
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

    var searchPageForm = document.getElementById('SearchPageForm');
    if (searchPageForm) {
      Array.prototype.forEach.call(
        getBrowseGroupContainers(),
        function(container) {
          container.addEventListener('toggle', function() {
            syncBrowseOpenState(searchPageForm);
          });
        }
      );

      var browsePanel = document.querySelector(selectors.browsePanel);
      if (browsePanel) {
        browsePanel.addEventListener('toggle', function() {
          syncBrowsePanelOpenState(searchPageForm);
        });
      }
    }
  }

  window.theme = window.theme || {};
  window.theme.EditorialSearchFilters = {
    exclusionTags: EXCLUSION_TAGS.slice(),
    buildShopifyQuery: buildShopifyQuery,
    getBrowseInclusionExpressions: getBrowseInclusionExpressions,
    getExclusionClause: getExclusionClause,
    getInclusionClause: getInclusionClause,
    normalizeHtmlEntities: normalizeHtmlEntities,
    removeManagedFilters: removeManagedFilters,
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
