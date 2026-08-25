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

  function getLegacyProducerAliases(producer) {
    var aliases = [producer];
    var alias = producer
      .replace('The ', '')
      .replace(/ Distillery/g, '')
      .replace(/ Distillerie/g, '')
      .replace(/ Brewery/g, '')
      .replace(/ Brewing/g, '')
      .replace(/ Inc\./g, '')
      .replace(/ Inc/g, '')
      .trim();

    addUnique(aliases, alias);

    if (producer === 'The Macallan') {
      addUnique(aliases, 'Macallan Distillery');
    }

    return aliases;
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

  function parseProducerExtensions(value) {
    return splitDefinitions(value).reduce(function(extensions, definition) {
      var parts = definition.split('::');

      extensions[parts[0]] = splitTags(parts[1]);
      return extensions;
    }, {});
  }

  function parseProducers(config) {
    var extensions = parseProducerExtensions(config.producerExtensions);

    return splitDefinitions(config.producers).map(function(producer) {
      var aliases = getLegacyProducerAliases(producer);

      (extensions[producer] || []).forEach(function(alias) {
        addUnique(aliases, alias);
      });

      return {
        label: producer,
        aliases: aliases,
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

  // Country tags, keyed for lookup, so a place name is never read as a
  // producer. Stripping " Distillery" collapses "Singapore Distillery" onto
  // "Singapore", which would otherwise prefix every Singapore-tagged article.
  // Matching on the raw tag keeps genuine "Singapore Distillery" tags working.
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

  function getAvailableCountries(articles, countries) {
    return countries.filter(function(country) {
      return articles.some(function(article) {
        return articleHasTag(article, country.tags);
      });
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

  function getAvailableProducers(articles, producers) {
    var availableByLabel = {};

    articles.forEach(function(article) {
      (article.tags || []).forEach(function(articleTag) {
        var tagKey = normalizeProducerName(articleTag);

        producers.some(function(producer) {
          if (producer.matchKeys.indexOf(tagKey) === -1) {
            return false;
          }

          if (!availableByLabel[producer.label]) {
            availableByLabel[producer.label] = {
              label: producer.label,
              tags: producer.aliases.slice()
            };
          }

          addUnique(availableByLabel[producer.label].tags, articleTag);
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
    link.textContent = producerPrefix + truncateArticleTitle(fullTitle);
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

  function renderCountries(
    container,
    availableCountries,
    endpoint,
    blogHandle,
    categoryTags,
    producers
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
                  return getAvailableProducers(articles, producers);
                }
              );
            },
            function(producerContainer, availableProducers) {
              availableProducers.forEach(function(producer) {
                var producerDetails = createDisclosure(
                  producer.label,
                  'producer',
                  function(currentProducerDetails) {
                    var reviewQuery = buildArticleQuery(
                      categoryTags,
                      country.tags,
                      producer.tags
                    );

                    loadOnce(
                      currentProducerDetails,
                      'Loading reviews\u2026',
                      'No reviews found.',
                      function() {
                        return fetchAllArticles(
                          endpoint,
                          blogHandle,
                          reviewQuery
                        );
                      },
                      renderArticles
                    );
                  }
                );

                producerContainer.appendChild(producerDetails);
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
      var availableCountries = getAvailableCountries(categoryArticles, countries);

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
        producers
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
