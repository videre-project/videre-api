import MTGO from 'data/mtgo';
import { sql, dynamicSortMultiple } from 'utils/database';
import { eventsQuery } from 'utils/querybuilder';

/**
 * @typedef {string} date - Hyphen-separated date in MM/DD/YYYY or YYYY/MM/DD format.
 * @typedef {object} collection - An object-array of original objects.
 * @typedef {object} catalog - An object-array of references to objects.
 */

/**
 * Root Metagame Endpoint
 *
 * @access public - https://api.videreproject.com/metagame
 *
 * Returns metagame data by events collection, archetypes and cards
 * catalog matching a specified format and date range or time interval.
 *
 * @async
 *
 * @param       {string}        format              - Format to return results from (required).
 * @param       {integer}       [time_interval=14]  - Number of days to return results from
 *                                                    (ignored when both `min_date` and
 *                                                    `max_date` are provided).
 * @param       {integer}       [offset]            - Offset in days to offset `time_interval`
 *                                                    or `min_date` / `max_date`.
 * @param       {date}          [min_date]          - Minimum date to return results from in
 *                                                    `MM/DD/YYYY` or `YYYY/MM/DD` format.
 * @param       {date}          [max_date]          - Maximum date to return results from in
 *                                                    `MM/DD/YYYY` or `YYYY/MM/DD` format.
 *
 * @returns     {object}        {  events: {object}, archetypes: {object}, cards: {object} }
 * @property    {collection}    events              - Collection of events data is sourced from.
 * @property    {catalog}       archetypes          - Catalog of unique archetypes and aggregate.
 * @property    {catalog}       events              - Catalog of unique cards and aggregate.
 *
 */
export default async (req, res) => {
  const { parameters, data: request_1 } = await eventsQuery(req.query);
  const _format = parameters?.format || parameters?.formats;
  if (_format && !_format.filter(format => MTGO.FORMATS.includes(format.toLowerCase()))) {
    return res.status(400).json({ details: "No valid 'format' parameter provided." });
  }
  if (parameters?.time_interval && parameters?.time_interval <= 0) {
    return res.status(400).json({ details: "'time_interval' parameter must be greater than zero." });
  }

  const unmatchedFormats = (typeof(parameters?.format) == 'object'
      ? [...new Set(parameters?.format)]
      : [parameters?.format]
    ).filter(format => !(MTGO.FORMATS.includes(format?.toLowerCase())))
    .filter(Boolean);
  const unmatchedTypes = (typeof(parameters?.type) == 'object'
      ? [...new Set(parameters?.type)]
      : [parameters?.type]
    ).filter(type => !(MTGO.EVENT_TYPES.includes(type?.toLowerCase())))
    .filter(Boolean);

  const warnings = [...unmatchedFormats, ...unmatchedTypes].length > 0
    ? {
        warnings: [
          ...unmatchedFormats.map(format => `The format parameter '${format}' does not exist.`),
          ...unmatchedTypes.map(type => `The type parameter '${type}' does not exist.`),
        ]
      }
    : {};

  if (!request_1[0]) {
    return res.status(404).json({ details: 'No event data was found.', ...warnings });
  }

  // Get unique formats in matched events
  const formats = [...new Set(request_1.map(obj => obj.format.toLowerCase()))]
    .filter(item => MTGO.FORMATS.includes(item));

  const request_2 = await sql.unsafe(`
        SELECT * from results
        WHERE event in (${request_1.map(obj => obj.uid)});
    `);
  if (!request_2[0]) {
    return res.status(404).json({ details: 'No archetype data was found.', ...warnings });
  }

  const archetypes = request_2
    .map(obj => {
      if (obj.archetype === {}) return;
      const archetype0 = obj.archetype[Object.keys(obj.archetype)[0]];
      if (!archetype0?.uid || archetype0?.uid == null) return;
      return {
        uid: archetype0.uid,
        displayName: [...archetype0.alias, archetype0.displayName].filter(Boolean)[0],
        deck: [
          ...obj.deck?.mainboard.map(_obj => ({
            ..._obj,
            container: 'mainboard',
          })),
          ...obj.deck?.sideboard.map(_obj => ({
            ..._obj,
            container: 'sideboard',
          })),
        ],
        deck_uid: obj.uid,
        event_uid: obj.event,
      };
    }).filter(Boolean);

  const cards = archetypes
    .map(obj => {
      return obj.deck.map(card => ({
        uid: null,
        deck_uid: obj.deck_uid,
        archetype_uid: obj.uid,
        cardname: card.cardName,
        ...card,
        event_uid: obj.event_uid
      }));
    }).filter(Boolean).flat(1);

  return res.status(200).json({
    object: 'collection',
    parameters: parameters,
    data: formats
      .map(format => {
        const _events = request_1.filter(_obj => _obj.format.toLowerCase() === format);
        const _archetypes = archetypes.filter(archetype =>
          _events.map(_obj => _obj.uid).includes(archetype.event_uid)
        );
        const _cards = cards.filter(card =>
          _events.map(_obj => _obj.uid).includes(card.event_uid)
        );
        return {
          [format]: {
            events: {
              object: 'catalog',
              count: _events?.length,
              unique: [...new Set(_events.map(obj => obj.type))].length,
              types: [...new Set(_events.map(obj => obj.type))],
              data: _events.map(obj => ({
                object: 'event',
                ...obj,
                stats: {
                  players: request_2.filter(_obj => obj.uid == _obj.event).length,
                  archetypes: _archetypes.filter(archetype => obj.uid == archetype.event_uid).length,
                },
              })),
            },
            archetypes: {
              object: 'catalog',
              count: request_2?.length,
              unique: [...new Set(_archetypes.map(obj => obj.uid))].length,
              types: [],
              data: _archetypes
                .filter(
                  (obj, i) => _archetypes.findIndex(_obj => _obj.uid === obj.uid) === i
                )
                .map(obj => ({
                  object: 'archetype',
                  uid: obj.uid,
                  displayName: obj.displayName,
                  count: _archetypes.filter(_obj => _obj.uid === obj.uid).length,
                  percentage:
                    (
                      (_archetypes.filter(_obj => _obj.uid === obj.uid).length /
                        _archetypes.length) *
                      100
                    ).toFixed(2) + '%',
                }))
                .sort(dynamicSortMultiple('-count', 'displayName')),
            },
            cards: {
              object: 'catalog',
              count: _cards?.length,
              unique: [...new Set(_cards.map(obj => obj.cardname))].length,
              types: [],
              data: _cards
                .filter(
                  (obj, i) =>
                    _cards.findIndex(_obj => _obj.cardname === obj.cardname) === i
                )
                .map(obj => ({
                  object: 'card',
                  uid: obj.uid,
                  cardname: obj.cardname,
                  count: [
                    ...new Set(
                      _cards
                        .filter(_obj => _obj.cardname === obj.cardname)
                        .map(_obj => _obj.deck_uid)
                    ),
                  ].length,
                  percentage:
                    parseFloat(
                      ([
                        ...new Set(
                          _cards
                            .filter(_obj => _obj.cardname === obj.cardname)
                            .map(_obj => _obj.deck_uid)
                        ),
                      ].length /
                        [...new Set(_cards.map(_obj => _obj.deck_uid))].length) *
                        100
                    ).toFixed(2) + '%',
                  average: parseFloat(
                    (
                      _cards
                        .filter(_obj => _obj.cardname === obj.cardname)
                        .map(_obj => _obj.quantity)
                        .reduce((a, b) => a + b) /
                      [
                        ...new Set(
                          _cards
                            .filter(_obj => _obj.cardname === obj.cardname)
                            .map(_obj => _obj.deck_uid)
                        ),
                      ].length
                    ).toFixed(2)
                  ),
                  container: [
                    ...new Set(
                      _cards
                        .filter(_obj => _obj.cardname === obj.cardname)
                        .map(_obj => _obj.container)
                    ),
                  ],
                }))
                .sort(dynamicSortMultiple('-count', '-average', 'cardname')),
            },
          },
        };
      })
      .flat(1)
      .reduce((a, b) => ({ ...a, ...b })),
  });
};
