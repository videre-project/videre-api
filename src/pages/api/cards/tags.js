import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import { setDelay } from 'utils/database';
import { getParams, removeDuplicates, pruneObjectKeys } from 'utils/querybuilder';

const getScryfallTags = async type => {
  const response = await fetch('https://scryfall.com/docs/tagger-tags');
  const html = await response.text();
  const { document } = new JSDOM(html).window;

  const sections = Array.from(document.querySelectorAll('div.prose h2'));
  const tags = sections.reduce((output, section) => {
    const sectionType = section.textContent.endsWith('(functional)')
      ? 'functional'
      : 'artwork';

    const links = Array.from(section.nextElementSibling.querySelectorAll('a'));
    links.forEach(({ text, href }) => {
      output.push({
        type: sectionType,
        name: text,
        url: `https://api.scryfall.com/cards${href}`,
      });
    });

    return output.filter(obj => type?.length ? type.includes(obj.type) : true);
  }, []);

  return tags;
};

const getTaggedCards = async tags =>
  await Promise.all(
    tags.map(async (tag, i) => {
      if (i > 0) await setDelay(100);
      const page = await fetch(tag.url).then(res =>
        res.json()
      );
      let { has_more, total_cards = 0, data = [] } = page;

      if (has_more) {
        const numPages = Math.ceil(total_cards / data.length);
        for (let i = 2; i <= numPages; i++) {
          await setDelay(100);
          const nextPage = await fetch(tag.url).then(res => res.json());
          data = data.concat(nextPage?.data);
        }
      }

      return {
        ...tag,
        count: total_cards,
        data,
      };
    })
  );

const tags = async (req, res) => {
  const source = getParams(removeDuplicates(req?.query), 'src', 'source', 'from');
  const type = getParams(req?.query, 'type');
  if (!['functional', 'artwork'].includes(...type)) {
    res.status(400).json({
      details: `'${type}' type parameter does not exist.`
    });
    return;
  }
  const _tags = getParams(req?.query, 'tag', 'tags')
    .join(' ')
    .replaceAll(',', ' ')
    .split(' ')
    .filter(Boolean);

  const parameters = pruneObjectKeys({
    [source?.length == 1 ? 'source' : 'sources']:
      source?.length == 1 ? source[0] : source,
    [type?.length == 1 ? 'type' : 'types']:
      type?.length == 1 ? type[0] : type,
    tags: _tags,
  });

  if (source.includes('scryfall')) {
    const tags = [...new Set(await getScryfallTags(type))].filter(tag =>
      _tags?.length ? _tags.includes(tag.name) : tag.name
    );
    if (!_tags?.length) {
      res.status(200).json({
        object: 'catalog',
        details: `${
          type?.length
            ? `Displaying ${type.join(', ').replace(/, ([^,]*)$/, ' and $1')} tags only. `
            : 'Displaying all available tags. '
        }Refer to https://scryfall.com/docs/tagger-tags for more.`,
        parameters: parameters,
        data: {
          tags: {
            object: 'list',
            count: tags?.length,
            types: ['functional', 'artwork'].filter(obj =>
              type?.length ? type.includes(obj) : obj
            ),
            data: tags.map(tag => ({ object: 'tag', ...tag })),
          },
        },
      });
      return;
    }
    const tagData = await getTaggedCards(tags);
    const uniqueCards = [...new Set(tagData.map(obj => obj.data).flat(1))].map(
      ({ object, oracle_id, name, lang, keywords }) => ({
        object,
        oracle_id,
        name,
        lang,
        keywords,
        tags: tagData
          .map(
            ({ data, name }) =>
              data.filter(_obj => _obj.oracle_id === oracle_id).length && name
          )
          .filter(Boolean)
          .flat(1),
      })
    );

    res.status(200).json({
      object: 'collection',
      parameters: parameters,
      data: {
        tags: {
          object: 'list',
          count: tagData.length,
          data: tagData
            .map(({ name, type, url }) => ({
              object: 'tag',
              name,
              type,
              url,
              count: uniqueCards.filter(
                ({ tags }) => tags.includes(name)
              ).length,
              exclusive: uniqueCards.filter(
                ({ tags }) => tags.includes(name) && tags.length === 1
              ).length,
            }))
            .sort((a, b) => (a.count < b.count ? 1 : -1)),
        },
        cards: {
          object: 'catalog',
          count: uniqueCards.length,
          data: uniqueCards,
        },
      },
    });
    return;
  }
};

export default tags;
