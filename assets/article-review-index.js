(function() {
  'use strict';

  var PAGE_SIZE = 250;
  var PRELOAD_MIN_WIDTH = 880;
  var PRELOAD_CONCURRENCY = 3;
  var ARTICLE_TITLE_MAX_LENGTH = 100;
  var requestCache = {};
  var countryRequestCache = {};

  function splitDefinitions(value) {
    return (value || '').split('|').filter(function(definition) {
      return definition.length > 0;
    });
  }

  function splitTags(value) {
    return (value || '').split('~').filter(function(tag) {
      return tag.length > 0;
    });
  }

  function addUnique(values, value) {
    var normalizedValue = String(value || '').toLowerCase();
    var exists = values.some(function(existingValue) {
      return String(existingValue).toLowerCase() === normalizedValue;
    });

    if (value && !exists) {
      values.push(value);
    }
  }

  function parseExtensions(value) {
    return splitDefinitions(value).reduce(function(extensions, definition) {
      var parts = definition.split('::');

      extensions[parts[0]] = {
        label: parts[1] || parts[0],
        tags: splitTags(parts[2])
      };
      return extensions;
    }, {});
  }

  function parseCountries(config) {
    var extensions = parseExtensions(config.countryExtensions);
    var countries = splitDefinitions(config.countryDefinitions).map(function(
      definition
    ) {
      var parts = definition.split('::');
      var extension = extensions[parts[0]] || {};
      var tags = splitTags(parts[1]);

      (extension.tags || []).forEach(function(tag) {
        addUnique(tags, tag);
      });

      return {
        label: extension.label || parts[0],
        tags: tags
      };
    });

    splitDefinitions(config.additionalCountries).forEach(function(definition) {
      var parts = definition.split('::');

      countries.push({
        label: parts[0],
        tags: splitTags(parts[1])
      });
    });

    return countries;
  }

  function normalizeProducerName(value) {
    var normalized = String(value || '');

    if (typeof normalized.normalize === 'function') {
      normalized = normalized.normalize('NFKC');
    }

    return normalized
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/^The\s+/i, '')
      .replace(/\s+(Distillery|Distillerie|Brewery|Brewing|Inc\.?)\b/gi, '')
      .replace(/\s+Whisky$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  // The producer alias table is built once in editorial-taxonomy and shared
  // with Search, so both resolve a producer to the same tag set. Each entry is
  // "Label::handleized id::tag1~tag2::origin1~origin2"; the handle comes from
  // Liquid's own handleize so producer links can address Search's checkboxes
  // exactly. The origins are Article Index only - Search ignores that field.
  function parseProducers(config) {
    return splitDefinitions(config.producerAliases).map(function(definition) {
      var parts = definition.split('::');
      var aliases = splitTags(parts[2]);

      return {
        label: parts[0],
        handle: parts[1],
        aliases: aliases,
        originKeys: splitTags(parts[3]).map(function(origin) {
          return String(origin).toLowerCase();
        }),
        matchKeys: aliases.reduce(function(keys, alias) {
          addUnique(keys, normalizeProducerName(alias));
          return keys;
        }, [])
      };
    });
  }

  // Flat lookup from a normalised producer tag to its canonical label, so a
  // section article can be prefixed without rescanning the producer list.
  function buildProducerKeyMap(producers) {
    var keyMap = {};

    producers.forEach(function(producer) {
      producer.matchKeys.forEach(function(matchKey) {
        if (matchKey && !Object.prototype.hasOwnProperty.call(keyMap, matchKey)) {
          keyMap[matchKey] = producer.label;
        }
      });
    });

    return keyMap;
  }

  // Producers keyed by normalised tag, so resolving one article's producers is
  // a lookup per tag instead of a scan of the whole producer list. The country
  // guard below runs this over every article in a drink, which the linear scan
  // in getAvailableProducers could not have afforded.
  function buildProducerLookup(producers) {
    var lookup = {};

    producers.forEach(function(producer) {
      producer.matchKeys.forEach(function(matchKey) {
        if (matchKey && !Object.prototype.hasOwnProperty.call(lookup, matchKey)) {
          lookup[matchKey] = producer;
        }
      });
    });

    return lookup;
  }

  function lookUpProducer(producerLookup, articleTag) {
    var matchKey = normalizeProducerName(articleTag);

    if (
      !matchKey ||
      !Object.prototype.hasOwnProperty.call(producerLookup, matchKey)
    ) {
      return null;
    }

    return producerLookup[matchKey];
  }

  // Country tags, keyed for lookup, so a place name is never read as a
  // producer. Legacy suffix-stripping can collapse a producer onto a country
  // name ("Singapore Distillery" -> "Singapore"); that producer has since
  // been removed from the taxonomy, so this now guards against reintroducing
  // such a collision rather than fixing a live one.
  function buildCountryTagKeys(countries) {
    var keys = {};

    countries.forEach(function(country) {
      country.tags.forEach(function(countryTag) {
        keys[String(countryTag).toLowerCase()] = true;
      });
    });

    return keys;
  }

  // Every canonical producer matched by an article's tags, in the article's own
  // tag order and deduplicated case-insensitively by addUnique.
  function getArticleProducerLabels(article, producerKeyMap, countryTagKeys) {
    var labels = [];

    (article.tags || []).forEach(function(articleTag) {
      var matchKey = normalizeProducerName(articleTag);

      if (
        countryTagKeys &&
        Object.prototype.hasOwnProperty.call(
          countryTagKeys,
          String(articleTag).toLowerCase()
        )
      ) {
        return;
      }

      if (matchKey && Object.prototype.hasOwnProperty.call(producerKeyMap, matchKey)) {
        addUnique(labels, producerKeyMap[matchKey]);
      }
    });

    return labels;
  }

  // Shared by every index section: the visible title is capped at
  // ARTICLE_TITLE_MAX_LENGTH characters, counting the ellipsis. Producer
  // prefixes are added by the caller and sit outside this limit.
  function truncateArticleTitle(title) {
    var value = String(title || '').trim();

    if (value.length <= ARTICLE_TITLE_MAX_LENGTH) {
      return value;
    }

    return (
      value.slice(0, ARTICLE_TITLE_MAX_LENGTH - 1).replace(/\s+$/, '') + '\u2026'
    );
  }

  function articleHasTag(article, candidateTags) {
    var normalizedCandidates = candidateTags.map(function(tag) {
      return String(tag).toLowerCase();
    });

    return (article.tags || []).some(function(tag) {
      return normalizedCandidates.indexOf(String(tag).toLowerCase()) !== -1;
    });
  }

  function escapeSearchValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function buildTagGroup(tags) {
    var uniqueTags = [];

    tags.forEach(function(tag) {
      addUnique(uniqueTags, tag);
    });

    var clauses = uniqueTags.map(function(tag) {
      return 'tag:"' + escapeSearchValue(tag) + '"';
    });

    if (clauses.length === 1) {
      return clauses[0];
    }

    return '(' + clauses.join(' OR ') + ')';
  }

  function buildArticleQuery(categoryTags, countryTags, producerTags) {
    var groups = [];

    if (categoryTags && categoryTags.length) {
      groups.push(buildTagGroup(categoryTags));
    }

    if (countryTags && countryTags.length) {
      groups.push(buildTagGroup(countryTags));
    }

    if (producerTags && producerTags.length) {
      groups.push(buildTagGroup(producerTags));
    }

    return groups.join(' AND ');
  }

  // Reproduces the URL Search itself would produce for "Section: Review" plus
  // one producer. Two parameters matter and do different jobs: `q` drives the
  // server-side results, while `browse_filters` only restores the checkbox UI
  // (initializeBrowseState never re-runs the search), so both are required or
  // the panel and the results disagree. Country is deliberately not included -
  // in this index countries only group producers.
  function buildProducerSearchUrl(config, producer) {
    var exclusionTags = splitDefinitions(config.searchExclusionTags);
    var terms = ['*'];

    exclusionTags.forEach(function(tag) {
      terms.push('-tag:"' + escapeSearchValue(tag) + '"');
    });

    var query = terms.join(' ');
    var filterIds = [];

    if (config.reviewSectionTag) {
      query += ' AND ' + buildTagGroup([config.reviewSectionTag]);
      filterIds.push('SearchBrowse-section-' + config.reviewSectionFilterId);
    }

    query += ' AND ' + buildTagGroup(producer.aliases);
    filterIds.push('SearchBrowse-producer-' + producer.handle);

    var parameters = [
      ['q', query],
      ['type', 'article'],
      ['browse_filters', filterIds.join(',')],
      ['browse_open', 'section,producer'],
      ['browse_panel_open', 'true'],
      ['options[prefix]', 'last']
    ];

    return (
      (config.searchUrl || '/search') +
      '?' +
      parameters
        .map(function(parameter) {
          return (
            encodeURIComponent(parameter[0]) +
            '=' +
            encodeURIComponent(parameter[1])
          );
        })
        .join('&')
    );
  }

  function fetchArticlePage(endpoint, blogHandle, articleQuery, after) {
    var graphqlQuery = [
      'query ArticleReviewIndex($blogHandle: String!, $after: String, $articleQuery: String) {',
      '  blog(handle: $blogHandle) {',
      '    articles(first: ' + PAGE_SIZE + ', after: $after, query: $articleQuery, sortKey: PUBLISHED_AT, reverse: true) {',
      '      nodes { title tags publishedAt onlineStoreUrl }',
      '      pageInfo { hasNextPage endCursor }',
      '    }',
      '  }',
      '}'
    ].join('\n');

    return window
      .fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: graphqlQuery,
          variables: {
            blogHandle: blogHandle,
            after: after,
            articleQuery: articleQuery || null
          }
        })
      })
      .then(function(response) {
        if (!response.ok) {
          throw new Error('The review index request failed.');
        }

        return response.json();
      })
      .then(function(payload) {
        if (payload.errors && payload.errors.length) {
          throw new Error(payload.errors[0].message || 'The review index request failed.');
        }

        if (!payload.data || !payload.data.blog) {
          throw new Error('The requested review blog is unavailable.');
        }

        return payload.data.blog.articles;
      });
  }

  function fetchAllArticles(endpoint, blogHandle, articleQuery) {
    var cacheKey = blogHandle + '::' + (articleQuery || '');

    if (requestCache[cacheKey]) {
      return requestCache[cacheKey];
    }

    requestCache[cacheKey] = new Promise(function(resolve, reject) {
      var articles = [];
      var seenCursors = {};

      function fetchNextPage(after) {
        fetchArticlePage(endpoint, blogHandle, articleQuery, after)
          .then(function(connection) {
            var pageInfo = connection.pageInfo || {};

            articles = articles.concat(connection.nodes || []);

            if (pageInfo.hasNextPage) {
              if (!pageInfo.endCursor || seenCursors[pageInfo.endCursor]) {
                throw new Error('The review index pagination cursor did not advance.');
              }

              seenCursors[pageInfo.endCursor] = true;
              fetchNextPage(pageInfo.endCursor);
              return;
            }

            resolve(articles);
          })
          .catch(reject);
      }

      fetchNextPage(null);
    }).catch(function(error) {
      delete requestCache[cacheKey];
      throw error;
    });

    return requestCache[cacheKey];
  }

  function fetchArticleTagsPage(endpoint, blogHandle, after) {
    var graphqlQuery = [
      'query ArticleReviewIndexCountryPreload($blogHandle: String!, $after: String) {',
      '  blog(handle: $blogHandle) {',
      '    articles(first: ' + PAGE_SIZE + ', after: $after, sortKey: PUBLISHED_AT, reverse: true) {',
      '      nodes { tags }',
      '      pageInfo { hasNextPage endCursor }',
      '    }',
      '  }',
      '}'
    ].join('\n');

    return window
      .fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: graphqlQuery,
          variables: {
            blogHandle: blogHandle,
            after: after
          }
        })
      })
      .then(function(response) {
        if (!response.ok) {
          throw new Error('The review index request failed.');
        }

        return response.json();
      })
      .then(function(payload) {
        if (payload.errors && payload.errors.length) {
          throw new Error(payload.errors[0].message || 'The review index request failed.');
        }

        if (!payload.data || !payload.data.blog) {
          throw new Error('The requested review blog is unavailable.');
        }

        return payload.data.blog.articles;
      });
  }

  function fetchAllArticleTags(endpoint, blogHandle) {
    if (countryRequestCache[blogHandle]) {
      return countryRequestCache[blogHandle];
    }

    countryRequestCache[blogHandle] = new Promise(function(resolve, reject) {
      var articles = [];
      var seenCursors = {};

      function fetchNextPage(after) {
        fetchArticleTagsPage(endpoint, blogHandle, after)
          .then(function(connection) {
            var pageInfo = connection.pageInfo || {};

            articles = articles.concat(connection.nodes || []);

            if (pageInfo.hasNextPage) {
              if (!pageInfo.endCursor || seenCursors[pageInfo.endCursor]) {
                throw new Error('The review index pagination cursor did not advance.');
              }

              seenCursors[pageInfo.endCursor] = true;
              fetchNextPage(pageInfo.endCursor);
              return;
            }

            resolve(articles);
          })
          .catch(reject);
      }

      fetchNextPage(null);
    }).catch(function(error) {
      delete countryRequestCache[blogHandle];
      throw error;
    });

    return countryRequestCache[blogHandle];
  }

  function clearElement(element) {
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function showStatus(container, message) {
    var status = document.createElement('p');

    clearElement(container);
    status.className = 'article-review-index__status';
    status.textContent = message;
    container.appendChild(status);
  }

  function showError(container, message, retry) {
    var retryButton = document.createElement('button');

    showStatus(container, message);
    retryButton.type = 'button';
    retryButton.className = 'article-review-index__retry';
    retryButton.textContent = 'Try again';
    retryButton.addEventListener('click', retry);
    container.appendChild(retryButton);
  }

  function loadOnce(details, loadingMessage, emptyMessage, loader, render) {
    var container = details.querySelector('[data-article-review-index-children]');

    if (!container || details.getAttribute('data-load-state') === 'loading') {
      return;
    }

    if (details.getAttribute('data-load-state') === 'loaded') {
      return;
    }

    details.setAttribute('data-load-state', 'loading');
    showStatus(container, loadingMessage);

    loader()
      .then(function(items) {
        details.setAttribute('data-load-state', 'loaded');
        clearElement(container);

        if (!items.length) {
          showStatus(container, emptyMessage);
          return;
        }

        render(container, items);
      })
      .catch(function() {
        details.setAttribute('data-load-state', 'error');
        showError(container, 'Reviews could not be loaded.', function() {
          loadOnce(details, loadingMessage, emptyMessage, loader, render);
        });
      });
  }

  function createDisclosure(label, level, loader) {
    var details = document.createElement('details');
    var summary = document.createElement('summary');
    var summaryLabel = document.createElement('span');
    var children = document.createElement('div');

    details.className =
      'article-review-index__branch article-review-index__branch--' + level;
    summary.className = 'article-review-index__summary';
    summary.setAttribute('aria-expanded', 'false');
    summaryLabel.textContent = label;
    children.className = 'article-review-index__children';
    children.setAttribute('data-article-review-index-children', '');
    children.setAttribute('aria-live', 'polite');
    summary.appendChild(summaryLabel);
    details.appendChild(summary);
    details.appendChild(children);
    details.addEventListener('toggle', function() {
      summary.setAttribute('aria-expanded', details.open ? 'true' : 'false');

      if (details.open) {
        loader(details);
      }
    });

    return details;
  }

  // A country is only worth showing if opening it would list a producer.
  // Country membership and producer membership used to be decided by separate
  // rules over the same articles, so a country could appear and then resolve to
  // nothing: an article that merely mentions a country - a rum-cask Scotch
  // tagged Trinidad - opened an empty Caribbean tab. Resolving producers for
  // every country in one pass makes the two levels agree by construction.
  //
  // This runs on the tags already preloaded for the whole blog, so it needs no
  // extra request, and it is a single pass over the articles rather than one
  // per country.
  function getAvailableCountries(articles, countries, producerLookup) {
    var countryHasProducer = {};

    articles.forEach(function(article) {
      var articleCountries = countries.filter(function(country) {
        return articleHasTag(article, country.tags);
      });

      if (!articleCountries.length) {
        return;
      }

      var isAmbiguous = articleCountries.length > 1;

      (article.tags || []).forEach(function(articleTag) {
        var producer = lookUpProducer(producerLookup, articleTag);

        if (!producer) {
          return;
        }

        articleCountries.forEach(function(country) {
          if (producerBelongsToCountry(producer, country, isAmbiguous)) {
            countryHasProducer[country.label] = true;
          }
        });
      });
    });

    return countries.filter(function(country) {
      return countryHasProducer[country.label] === true;
    });
  }

  function getCategoryArticles(articles, categoryTags) {
    if (!categoryTags.length) {
      return articles;
    }

    return articles.filter(function(article) {
      return articleHasTag(article, categoryTags);
    });
  }

  // How many of the taxonomy's countries an article's tags name at once. One
  // country is the ordinary case and needs no disambiguating; two or more is
  // the shape that caused producers to leak across country tabs.
  function countArticleCountries(article, countries) {
    return countries.reduce(function(total, candidate) {
      return articleHasTag(article, candidate.tags) ? total + 1 : total;
    }, 0);
  }

  // Only an article naming several countries is ambiguous about which of its
  // producers belongs to which of them, and only there is a producer's
  // declared origin consulted. An article naming a single country speaks for
  // itself: every producer on it belongs to that country's tab, whoever they
  // are. That keeps origins a tie-breaker rather than a register that has to
  // list every country a producer might ever appear under - a bottler's next
  // release from a new country lists itself, with no taxonomy edit.
  function producerBelongsToCountry(producer, country, isAmbiguous) {
    if (!isAmbiguous || !country || !producer.originKeys.length) {
      return true;
    }

    return (
      producer.originKeys.indexOf(String(country.label).toLowerCase()) !== -1
    );
  }

  function getAvailableProducers(articles, producers, country, countries) {
    var availableByLabel = {};

    articles.forEach(function(article) {
      var isAmbiguous = countArticleCountries(article, countries || []) > 1;

      (article.tags || []).forEach(function(articleTag) {
        var tagKey = normalizeProducerName(articleTag);

        producers.some(function(producer) {
          if (producer.matchKeys.indexOf(tagKey) === -1) {
            return false;
          }

          // The tag belongs to this producer either way, so the scan stops
          // here; only the listing is withheld when the origin does not match.
          if (
            producerBelongsToCountry(producer, country, isAmbiguous) &&
            !availableByLabel[producer.label]
          ) {
            availableByLabel[producer.label] = {
              label: producer.label,
              handle: producer.handle,
              aliases: producer.aliases.slice()
            };
          }

          return true;
        });
      });
    });

    return Object.keys(availableByLabel)
      .map(function(label) {
        return availableByLabel[label];
      })
      .sort(function(firstProducer, secondProducer) {
        return firstProducer.label.localeCompare(secondProducer.label);
      });
  }

  // The source title and URL are never altered: only the visible text is
  // shortened, while the tooltip and accessible name keep the full title.
  function createArticleLink(article, producerKeyMap, countryTagKeys) {
    var link = document.createElement('a');
    var fullTitle = String(article.title || '');
    var producerLabels = producerKeyMap
      ? getArticleProducerLabels(article, producerKeyMap, countryTagKeys)
      : [];
    var producerPrefix = producerLabels.length
      ? producerLabels.join(' / ') + ': '
      : '';
    var accessibleLabel = producerPrefix + fullTitle;

    link.href = article.onlineStoreUrl;

    // The row is styled like a producer leaf, but only the producer names
    // carry that leaf's bold weight: the colon and the title after it stay at
    // the link's own weight, so the prefix reads as the producer it names
    // rather than as part of the headline.
    if (producerLabels.length) {
      var producerName = document.createElement('strong');

      producerName.className = 'article-review-index__article-producer';
      producerName.textContent = producerLabels.join(' / ');
      link.appendChild(producerName);
      link.appendChild(document.createTextNode(': '));
    }

    link.appendChild(document.createTextNode(truncateArticleTitle(fullTitle)));
    link.setAttribute('title', accessibleLabel);
    link.setAttribute('aria-label', accessibleLabel);

    return link;
  }

  function renderArticleList(container, articles, producerKeyMap, countryTagKeys, emptyMessage) {
    var list = document.createElement('ul');

    list.className = 'article-review-index__articles';

    articles
      .filter(function(article) {
        return article.onlineStoreUrl;
      })
      .sort(function(firstArticle, secondArticle) {
        return new Date(secondArticle.publishedAt) - new Date(firstArticle.publishedAt);
      })
      .forEach(function(article) {
        var item = document.createElement('li');

        item.className = 'article-review-index__article';
        item.appendChild(createArticleLink(article, producerKeyMap, countryTagKeys));
        list.appendChild(item);
      });

    if (!list.children.length) {
      showStatus(container, emptyMessage);
      return;
    }

    container.appendChild(list);
  }

  function renderArticles(container, articles) {
    renderArticleList(container, articles, null, null, 'No published review links found.');
  }

  // Producers are leaves now: instead of expanding to every review, the name
  // links into Search pre-filtered to Review + that producer.
  function createProducerLink(config, producer) {
    var wrapper = document.createElement('div');
    var link = document.createElement('a');

    wrapper.className = 'article-review-index__producer';
    link.className = 'article-review-index__producer-link';
    link.href = buildProducerSearchUrl(config, producer);
    link.textContent = producer.label;
    link.setAttribute(
      'title',
      'See all ' + producer.label + ' reviews in Search'
    );
    wrapper.appendChild(link);

    return wrapper;
  }

  function renderCountries(
    container,
    availableCountries,
    endpoint,
    blogHandle,
    categoryTags,
    producers,
    countries,
    config
  ) {
    availableCountries.forEach(function(country) {
      var countryDetails = createDisclosure(
        country.label,
        'country',
        function(currentCountryDetails) {
          var countryQuery = buildArticleQuery(categoryTags, country.tags);

          loadOnce(
            currentCountryDetails,
            'Loading producers\u2026',
            'No producers found.',
            function() {
              return fetchAllArticles(endpoint, blogHandle, countryQuery).then(
                function(articles) {
                  return getAvailableProducers(
                    articles,
                    producers,
                    country,
                    countries
                  );
                }
              );
            },
            function(producerContainer, availableProducers) {
              availableProducers.forEach(function(producer) {
                producerContainer.appendChild(
                  createProducerLink(config, producer)
                );
              });
            }
          );
        }
      );

      container.appendChild(countryDetails);
    });
  }

  function initializeIndex(index) {
    var configElement = index.querySelector('[data-article-review-index-config]');
    var config;

    if (!configElement || typeof window.fetch !== 'function') {
      return;
    }

    try {
      config = JSON.parse(configElement.textContent);
    } catch (error) {
      return;
    }

    var countries = parseCountries(config);
    var producers = parseProducers(config);
    var producerKeyMap = buildProducerKeyMap(producers);
    var producerLookup = buildProducerLookup(producers);
    var countryTagKeys = buildCountryTagKeys(countries);
    var endpoint = '/api/' + config.apiVersion + '/graphql.json';
    // One selector so the queue follows document order: the Reviews drinks
    // first, then Interviews, Features and Deep Dives as displayed.
    var drinkElements = index.querySelectorAll(
      '[data-article-review-index-drink], [data-article-review-index-section-drink]'
    );
    var jobsByKey = {};
    var jobs = [];
    var queue = [];
    var activeJobCount = 0;
    var preloadingStarted = false;

    function getDrinkContainer(drink) {
      return drink.details.querySelector('[data-article-review-index-children]');
    }

    function showDrinkLoading(drink) {
      var container = getDrinkContainer(drink);

      if (
        !container ||
        drink.details.getAttribute('data-load-state') === 'loaded'
      ) {
        return;
      }

      drink.details.setAttribute('data-load-state', 'loading');
      showStatus(
        container,
        drink.kind === 'section'
          ? 'Loading articles\u2026'
          : 'Loading countries\u2026'
      );
    }

    function showDrinkError(drink, job) {
      var container = getDrinkContainer(drink);

      if (
        !container ||
        drink.details.getAttribute('data-load-state') === 'loaded'
      ) {
        return;
      }

      drink.details.setAttribute('data-load-state', 'error');
      showError(
        container,
        drink.kind === 'section'
          ? 'Articles could not be loaded.'
          : 'Reviews could not be loaded.',
        function() {
          queuePreloadJob(job, true, true);
        }
      );
    }

    function renderDrinkCountries(drink, articles) {
      var container = getDrinkContainer(drink);
      var categoryArticles = getCategoryArticles(articles, drink.categoryTags);
      var availableCountries = getAvailableCountries(
        categoryArticles,
        countries,
        producerLookup
      );

      if (!container) {
        return;
      }

      drink.details.setAttribute('data-load-state', 'loaded');
      clearElement(container);

      if (!availableCountries.length) {
        showStatus(container, 'No countries found.');
        return;
      }

      renderCountries(
        container,
        availableCountries,
        endpoint,
        drink.blogHandle,
        drink.categoryTags,
        producers,
        countries,
        config
      );
    }

    // Flat sections stop at the drink level: the blog is fetched once and its
    // articles are grouped locally by the shared drink tags.
    function renderSectionDrinkArticles(drink, articles) {
      var container = getDrinkContainer(drink);
      var drinkArticles = drink.drinkTags.length
        ? getCategoryArticles(articles, drink.drinkTags)
        : [];

      if (!container) {
        return;
      }

      drink.details.setAttribute('data-load-state', 'loaded');
      clearElement(container);

      if (!drinkArticles.length) {
        showStatus(container, 'No articles found.');
        return;
      }

      renderArticleList(
        container,
        drinkArticles,
        producerKeyMap,
        countryTagKeys,
        'No published article links found.'
      );
    }

    function renderDrink(drink, articles) {
      if (drink.kind === 'section') {
        renderSectionDrinkArticles(drink, articles);
        return;
      }

      renderDrinkCountries(drink, articles);
    }

    // Section jobs need the article fields their links render; review jobs only
    // need tags to work out which countries exist. Both reuse their cache, so a
    // promoted job never issues a second request.
    function fetchJobArticles(job) {
      if (job.kind === 'section') {
        return fetchAllArticles(endpoint, job.blogHandle, null);
      }

      return fetchAllArticleTags(endpoint, job.blogHandle);
    }

    function startNextPreloadJobs() {
      while (activeJobCount < PRELOAD_CONCURRENCY && queue.length) {
        (function(job) {
          queue.shift();
          job.state = 'loading';
          activeJobCount += 1;

          job.drinks.forEach(showDrinkLoading);

          fetchJobArticles(job).then(job.resolve, job.reject);

          job.promise.then(
            function(articles) {
              job.state = 'loaded';
              job.drinks.forEach(function(drink) {
                renderDrink(drink, articles);
              });
            },
            function() {
              job.state = 'error';
              job.drinks.forEach(function(drink) {
                showDrinkError(drink, job);
              });
            }
          ).then(
            function() {
              activeJobCount -= 1;
              startNextPreloadJobs();
            },
            function() {
              activeJobCount -= 1;
              startNextPreloadJobs();
            }
          );
        })(queue[0]);
      }
    }

    function promotePreloadJob(job) {
      var jobIndex = queue.indexOf(job);

      if (jobIndex <= 0) {
        return;
      }

      queue.splice(jobIndex, 1);
      queue.unshift(job);
    }

    function queuePreloadJob(job, prioritize, retry) {
      if (job.state === 'queued') {
        if (prioritize) {
          promotePreloadJob(job);
        }

        startNextPreloadJobs();
        return job.promise;
      }

      if (job.state === 'loading' || job.state === 'loaded') {
        return job.promise;
      }

      if (job.state === 'error' && !retry) {
        return job.promise;
      }

      job.state = 'queued';
      job.promise = new Promise(function(resolve, reject) {
        job.resolve = resolve;
        job.reject = reject;
      });

      if (prioritize) {
        queue.unshift(job);
      } else {
        queue.push(job);
      }

      job.drinks.forEach(showDrinkLoading);
      startNextPreloadJobs();
      return job.promise;
    }

    Array.prototype.forEach.call(drinkElements, function(drinkDetails) {
      var blogHandle = drinkDetails.getAttribute('data-blog-handle');
      var kind = drinkDetails.hasAttribute('data-article-review-index-section-drink')
        ? 'section'
        : 'reviews';
      var drink = {
        details: drinkDetails,
        summary: drinkDetails.querySelector('summary'),
        kind: kind,
        blogHandle: blogHandle,
        categoryTags: splitTags(
          drinkDetails.getAttribute('data-category-tags')
        ),
        drinkTags: splitTags(drinkDetails.getAttribute('data-drink-tags'))
      };
      // Every drink sharing a blog shares one job, so a section blog is
      // fetched once rather than once per drink.
      var jobKey = kind + '::' + blogHandle;
      var job = jobsByKey[jobKey];

      if (!job) {
        job = {
          kind: kind,
          blogHandle: blogHandle,
          drinks: [],
          state: 'idle',
          promise: null,
          resolve: null,
          reject: null
        };
        jobsByKey[jobKey] = job;
        jobs.push(job);
      }

      job.drinks.push(drink);

      drinkDetails.addEventListener('toggle', function() {
        drink.summary.setAttribute(
          'aria-expanded',
          drinkDetails.open ? 'true' : 'false'
        );

        if (drinkDetails.open) {
          queuePreloadJob(job, true, false);
        }
      });
    });

    // Each box (Reviews, Interviews, Features, Deep Dives) is its own
    // <details> so it can be collapsed independently of the others. This is
    // a pure display toggle: preloading is unaffected either way, exactly
    // like the per-drink disclosures already work.
    var boxElements = index.querySelectorAll('[data-article-review-index-box]');

    Array.prototype.forEach.call(boxElements, function(boxDetails) {
      var boxSummary = boxDetails.querySelector('.article-review-index__title');

      if (!boxSummary) {
        return;
      }

      boxDetails.addEventListener('toggle', function() {
        boxSummary.setAttribute('aria-expanded', boxDetails.open ? 'true' : 'false');
      });
    });

    // Reviews only: the drink list opens truncated, with the remaining rows
    // revealed by "See more". The button removes itself once clicked so the
    // full list simply reads on afterwards.
    var seeMoreButtons = index.querySelectorAll('[data-article-review-index-see-more]');

    Array.prototype.forEach.call(seeMoreButtons, function(seeMoreButton) {
      seeMoreButton.addEventListener('click', function() {
        var tree = seeMoreButton.closest('.article-review-index__tree');

        if (!tree) {
          return;
        }

        Array.prototype.forEach.call(tree.querySelectorAll('[hidden]'), function(hiddenDrink) {
          hiddenDrink.hidden = false;
        });

        seeMoreButton.remove();
      });
    });

    function beginPreloading() {
      if (preloadingStarted) {
        return;
      }

      preloadingStarted = true;
      jobs.forEach(function(job) {
        queuePreloadJob(job, false, false);
      });
    }

    if (typeof window.matchMedia === 'function') {
      var preloadMediaQuery = window.matchMedia(
        '(min-width: ' + PRELOAD_MIN_WIDTH + 'px)'
      );
      var handlePreloadWidthChange = function(event) {
        if (event.matches) {
          beginPreloading();
        }
      };

      if (preloadMediaQuery.matches) {
        beginPreloading();
      }

      if (typeof preloadMediaQuery.addEventListener === 'function') {
        preloadMediaQuery.addEventListener('change', handlePreloadWidthChange);
      } else if (typeof preloadMediaQuery.addListener === 'function') {
        preloadMediaQuery.addListener(handlePreloadWidthChange);
      }
    } else if (
      (window.innerWidth || document.documentElement.clientWidth) >=
      PRELOAD_MIN_WIDTH
    ) {
      beginPreloading();
    }
  }

  function initializeAllIndexes() {
    var indexes = document.querySelectorAll('[data-article-review-index]');

    Array.prototype.forEach.call(indexes, initializeIndex);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAllIndexes);
  } else {
    initializeAllIndexes();
  }
})();
