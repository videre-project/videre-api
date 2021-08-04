import fetch from "node-fetch";
import { JSDOM } from 'jsdom';
import { setDelay } from 'utils/database.js';
import { usePuppeteerStealth } from 'utils/puppeteer.js';
import { getParams } from 'utils/querybuilder.js';

const getScryfallTags = async ({ functional }) => {
    const { browser, page } = await usePuppeteerStealth();

    await page.goto(`https://scryfall.com/docs/tagger-tags`);
    const self = await page.evaluate(() => {
        return document.querySelector('div.prose').innerHTML
            .replaceAll('</h2>', '')
            .split('<h2>')
            .slice(1);
    });

    await page.close();
    await browser.close();

    return self
        .filter(obj => functional === true ? obj.includes(' (functional)') : true)
        .map(obj => {
            const dom = new JSDOM(
                '<!DOCTYPE html>'
                + obj.split('\n').slice(1).join(' ').trim()
            );
            return [...dom.window.document.querySelectorAll('a')]
                .map(tag => ({
                    name: tag?.childNodes[0]?.nodeValue,
                    uri: tag.href
                }));
        }).flat(1);
}

const getTaggedCards = async (tags) => {
    return await Promise.all(
        tags.map(async (tag, i) => {
            if (i > 0) await setDelay(100);
            const page = await fetch(`https://api.scryfall.com/cards${tag.uri}`)
                .then(res => res.json());
            let data = [...page?.data];
            if (page?.has_more == true) {
                const numPages = Math.ceil(page.total_cards / page.data.length);
                for(let i = 2; i <= numPages; i++) {
                    await setDelay(100);
                    const _page = await fetch(`https://api.scryfall.com/cards${tag.uri}&page=${i}`)
                        .then(res => res.json());
                    data = data.concat(_page?.data);
                }
            }
            return {
                ...tag,
                count: page?.total_cards,
                data: data,
            }
        })
    )
}

export default async (req, res) => {
    const source = getParams(req?.query, 'src', 'source', 'from');
    if (source.includes('scryfall')) {
        const tags = [...new Set(await getScryfallTags({ functional: true }))]
            .filter(tag => tag.name == 'burn' || tag.name == 'removal');
        const tagData = await getTaggedCards(tags);
        const uniqueCards = [...new Set(tagData.map(obj => obj.data).flat(1))]
            .map(obj => ({
                object: obj.object,
                oracle_id: obj.oracle_id,
                name: obj.name,
                lang: obj.lang,
                tags: tagData
                    .map(tag =>
                        tag.data.filter(_obj => _obj.oracle_id === obj.oracle_id).length
                            ? tag.name
                            : false
                    ).filter(Boolean).flat(1),
                keywords: obj.keywords,
            }));

        res.status(200).json({
            "tags": {
                "object": "list",
                "count": tagData.length,
                "data": tagData
                    .map(obj => ({
                        name: obj.name,
                        url: `https://api.scryfall.com/cards${obj.uri}`,
                        count: obj.count,
                        exclusive: uniqueCards.filter(_obj =>
                                _obj.tags.includes(obj.name) &&
                                _obj.tags.length === 1
                            ).length,
                        type: 'functional',
                    })).sort((a, b) => (a.count < b.count) ? 1 : -1)
            },
            "cards": {
                "object": "catalog",
                "count": uniqueCards.length,
                "data": uniqueCards
            }
        });
    }
}