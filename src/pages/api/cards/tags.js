import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import { setDelay } from 'utils/database';
import { getParams } from 'utils/querybuilder';

const getScryfallTags = async type => {
  const response = await fetch('https://scryfall.com/docs/tagger-tags');
  const html = await response.text();
  const { document } = new JSDOM(html).window;

  const sections = Array.from(document.querySelectorAll('div.prose h2'));
  const tags = sections.reduce((output, section) => {
    const sectionType = section.innerText.endsWith('(functional)')
      ? 'functional'
      : 'artwork';
    if (sectionType !== type) return output;

    const links = Array.from(section.nextElementSibling.querySelectorAll('a'));
    links.forEach(({ innerText, href }) => {
      output.push({
        type: sectionType,
        name: innerText,
        href,
      });
    });

    return output;
  }, []);

  return tags;
};

const getTaggedCards = async tags =>
  await Promise.all(
    tags.map(async (tag, i) => {
      if (i > 0) await setDelay(100);
      const page = await fetch(`https://api.scryfall.com/cards${tag.uri}`).then(res =>
        res.json()
      );
      const { has_more, total_cards = 0, data = [] } = page;

      if (has_more) {
        const numPages = Math.ceil(total_cards / data.length);
        for (let i = 2; i <= numPages; i++) {
          await setDelay(100);
          const nextPage = await fetch(`${tag.url}&page=${i}`).then(res => res.json());
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
  const source = getParams(req?.query, 'src', 'source', 'from');
  const type = getParams(req?.query, 'type');
  const _tags = getParams(req?.query, 'tag', 'tags').join(' ').split(' ').filter(Boolean);

  if (source.includes('scryfall')) {
    const tags = [...new Set(await getScryfallTags(type))].filter(tag =>
      _tags?.length ? _tags.includes(tag.name) : tag.name
    );
    if (!_tags?.length) {
      res.status(200).json({
        details: `${
          type?.length
            ? `Displaying ${type.join(', ').replace(/, ([^,]*)$/, ' and $1')} tags only. `
            : 'Displaying all available tags. '
        }Refer to https://scryfall.com/docs/tagger-tags for more.`,
        data: {
          tags: {
            object: 'list',
            count: tags.length,
            types: ['functional', 'artwork'].filter(obj =>
              type?.length ? type.includes(obj) : obj
            ),
            data: tags,
          },
        },
      });
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
      data: {
        tags: {
          object: 'list',
          count: tagData.length,
          data: tagData
            .map(({ name, count, uri }) => ({
              name,
              count,
              url: `https://api.scryfall.com/cards${uri}`,
              exclusive: uniqueCards.filter(
                ({ tags }) => tags.includes(name) && tags.length === 1
              ).length,
              type: 'functional',
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
  }
};

export default tags;
