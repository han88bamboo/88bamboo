(function() {
  'use strict';

  var PAGE_SIZE = 250;
  var requestCache = {};

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

  function showError(container, retry) {
    var retryButton = document.createElement('button');

    showStatus(container, 'Reviews could not be loaded.');
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
        showError(container, function() {
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

  function renderArticles(container, articles) {
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
        var link = document.createElement('a');

        item.className = 'article-review-index__article';
        link.href = article.onlineStoreUrl;
        link.textContent = article.title;
        item.appendChild(link);
        list.appendChild(item);
      });

    if (!list.children.length) {
      showStatus(container, 'No published review links found.');
      return;
    }

    container.appendChild(list);
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
    var endpoint = '/api/' + config.apiVersion + '/graphql.json';
    var drinks = index.querySelectorAll('[data-article-review-index-drink]');

    Array.prototype.forEach.call(drinks, function(drinkDetails) {
      var summary = drinkDetails.querySelector('summary');
      var blogHandle = drinkDetails.getAttribute('data-blog-handle');
      var categoryTags = splitTags(
        drinkDetails.getAttribute('data-category-tags')
      );

      drinkDetails.addEventListener('toggle', function() {
        summary.setAttribute('aria-expanded', drinkDetails.open ? 'true' : 'false');

        if (!drinkDetails.open) {
          return;
        }

        loadOnce(
          drinkDetails,
          'Loading countries\u2026',
          'No countries found.',
          function() {
            var categoryQuery = buildArticleQuery(categoryTags);

            return fetchAllArticles(endpoint, blogHandle, categoryQuery).then(
              function(articles) {
                return getAvailableCountries(articles, countries);
              }
            );
          },
          function(countryContainer, availableCountries) {
            availableCountries.forEach(function(country) {
              var countryDetails = createDisclosure(
                country.label,
                'country',
                function(currentCountryDetails) {
                  var countryQuery = buildArticleQuery(
                    categoryTags,
                    country.tags
                  );

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

              countryContainer.appendChild(countryDetails);
            });
          }
        );
      });
    });
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
