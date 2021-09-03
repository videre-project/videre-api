import { MTGO } from 'data/mtgo';
import { groupBy, dynamicSortMultiple } from 'utils/database';
import { pruneObjectKeys } from 'utils/querybuilder';

/**
 * Formats an array of Scryfall objects or Scryfall collection object into sorted array.
 */
const formatCollection = (collection, source) => {
    let data = collection.map((card, i) => {
        // Get properties of front face for double-sided or split cards.
        let card_props = [];
        if (card_faces) {
            card_props = {
                // Spread unique colors (WUBRG) between card faces.
                colors: [
                    ...(!card.card_faces[0].colors.length) ? [ 'C' ] : card.card_faces[0].colors,
                    ...(!card.card_faces[1].colors.length) ? [ 'C' ] : card.card_faces[1].colors
                ].filter((item, pos, self) => self.indexOf(item) == pos),
                display_type: card.card_faces[0].type_line,
                // Default to front face image.
                image: [...new Set([
                    card.card_faces[0].image_uris.png,
                    card.card_faces[1].image_uris.png,
                ])],
                oracle_text: [
                    card.card_faces[0].oracle_text,
                    card.card_faces[1].oracle_text,
                ],
                power: [
                    card.card_faces[0].power,
                    card.card_faces[1].power,
                ],
                toughness: [
                    card.card_faces[0].toughness,
                    card.card_faces[1].toughness,
                ],
                loyalty: [
                    card.card_faces[0].loyalty,
                    card.card_faces[1].loyalty
                ]
            };
        } else {
            card_props = {
                colors: (!card.colors.length) ? [ 'C' ] : card.colors,
                display_type: card.type_line,
                image: card.image_uris.png,
                oracle_text: card.oracle_text,
                power: card.power,
                toughness: card.toughness,
                loyalty: card.loyalty,
            };
        }

        return pruneObjectKeys({
            object: 'card',
            uid: null,
            id_scryfall: card.id,
            oracle_scryfall: card.oracle_id, 
            name: card.name,
            //
            colors: card_props.colors,
            color_identity: (!card.color_identity.length)
                ? [ 'C' ]
                : card.color_identity,
            produced_mana: card.produced_mana,
            cmc: card.cmc,
            mana_cost: card?.mana_cost
                ?.slice(1,-1)
                ?.split(/}{/),
            //
            layout: card.layout,
            type: card.type_line,
            oracle_text: card_props.oracle_text,
            keywords: card.keywords,
            //
            power: card_props.power,
            toughness: card_props.toughness,
            loyalty: card_props.loyalty,
            //
            legalities: card.legalities,
            //
            image: card_props.image,
            //
            tags: [],
            variation: card.variation,
            variation_of: card.variation_of,
        });
    });
    
    let array = [];
    [...new Set([ 'Companion', ...MTGO.CARD_TYPES, 'Sideboard' ])]
        .forEach((type) => {
            const getType = (typeline) =>
                [...new Set(['Land', ...MTGO.CARD_TYPES])]
                    .find((type) => typeline.includes(type));
            if (data.some(card => getType(card.type) == type)) {
                array.push(
                    ...groupBy(data, card => card.display_type)
                        .get(type)
                        // Encode WUBRG order numerically.
                        .map(({ color_identity, colors, ...rest }, i) => ({
                            colors: colors.map(c => MTGO.COLORS.indexOf(c)),
                            color_identity: color_identity.map(c => MTGO.COLORS.indexOf(c)),
                            ...rest
                        }))
                        // Sort collection by card properties.
                        .sort(dynamicSortMultiple('cmc', 'colors', '-qty', 'color_identity', 'name'))
                        // Remap colors back to WUBRG.
                        .map(({ colors, color_identity, ...rest }) => ({
                            colors: `{${colors.map(i => MTGO.COLORS[i]).join('}{')}}`,
                            color_identity: `{${color_identity.map(i => MTGO.COLORS[i]).join('}{')}}`,
                            ...rest
                        }))
                );
            }
        });
    return array;
};

export default (req, res) =>
    res.status(400).json({
        details:
            "No data is returned at this path. For more information about this API's published methods and objects, see https://videreproject.com/docs/api.",
    });
