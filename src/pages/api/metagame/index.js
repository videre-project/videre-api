import { MTGO, TEMPLATES } from 'constants';
import { sql, removeDuplicates, dynamicSortMultiple } from 'utils/database';
import { getParams, eventsQuery } from 'utils/querybuilder';

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
  const params = removeDuplicates(req.query);

  const _format = getParams(params, 'f', 'format').map(obj => {
    const text = obj?.match(/[a-zA-Z\-]+/g).join('');
    return text.charAt(0).toUpperCase() + text.slice(1);
  });
  if (
    !_format ||
    !_format.filter(format => MTGO.FORMATS.includes(format.toLowerCase()))
  ) {
    return res.status(TEMPLATES.BAD_REQUEST.status).json({
      ...TEMPLATES.BAD_REQUEST,
      details: "No valid 'format' parameter provided.",
    });
  }
  const _type = getParams(params, 't', 'type').map(obj => {
    const text = obj
      .replaceAll(' ', '-')
      ?.match(/[a-zA-Z\-]+/g)
      .map(x =>
        x
          .split(/-/g)
          .map(_obj => {
            return _obj.charAt(0).toUpperCase() + _obj.slice(1);
          })
          .join(' ')
      )
      .flat(1);
    return text.join('');
  });

  const _time_interval = parseInt(getParams(params, 'i', 'int', 'interval')[0]) || 2 * 7;
  if (!(_time_interval > 0)) {
    return res.status(TEMPLATES.BAD_REQUEST.status).json({
      ...TEMPLATES.BAD_REQUEST,
      details: "'time_interval' parameter must be greater than zero.",
    });
  }

  const request_1 = await eventsQuery({
    format: _format,
    type: _type,
    time_interval: _time_interval,
    offset: getParams(params, 'o', 'ofs', 'offset'),
    _min_date: getParams(params, 'min', 'min-date'),
    _max_date: getParams(params, 'max', 'max-date'),
  });
  if (!request_1[0]) {
    return res.status(TEMPLATES.BAD_REQUEST.status).json({
      ...TEMPLATES.BAD_REQUEST,
      details: 'No event data was found.',
    });
  }

  const request_2 = await sql.unsafe(`
        SELECT * from results
        WHERE event in (${request_1.map(obj => obj.uid)})
        AND archetype::TEXT != '{}';
    `);
  if (!request_2[0]) {
    return res.status(TEMPLATES.BAD_REQUEST.status).json({
      ...TEMPLATES.BAD_REQUEST,
      details: 'No archetype data was found.',
    });
  }

  const archetypes = request_2
    .map(obj => {
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
      };
    })
    .filter(Boolean);

  const cards = archetypes
    .map(obj => {
      return obj.deck.map(card => ({
        uid: null,
        deck_uid: obj.deck_uid,
        archetype_uid: obj.uid,
        cardname: card.cardName,
        quantity: card.quantity,
        container: card.container,
      }));
    })
    .filter(Boolean)
    .flat(1);

  return res.status(200).json({
    object: 'collection',
    parameters: Object.entries({
      [_format?.length == 1 ? 'format' : 'formats']:
        _format?.length == 1 ? _format[0] : _format,
      [_type?.length == 1 ? 'type' : 'types']: _type?.length == 1 ? _type[0] : _type,
      time_interval: _time_interval,
      offset: getParams(params, 'o', 'ofs', 'offset'),
      min_date: getParams(params, 'min', 'min-date'),
      max_date: getParams(params, 'max', 'max-date'),
    })
      .filter(([_, v]) => (typeof v == 'object' ? v?.length : v != null))
      .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
    data: {
      events: {
        object: 'collection',
        count: request_1.count,
        unique: [...new Set(request_1.map(obj => obj.type))].length,
        types: [...new Set(request_1.map(obj => obj.type))],
        data: request_1.map(obj => ({ object: 'event', ...obj })),
      },
      archetypes: {
        object: 'catalog',
        count: request_2.count,
        unique: [...new Set(archetypes.map(obj => obj.uid))].length,
        types: [],
        data: archetypes
          .filter((obj, i) => archetypes.findIndex(_obj => _obj.uid === obj.uid) === i)
          .map(obj => ({
            object: 'archetype',
            uid: obj.uid,
            displayName: obj.displayName,
            count: archetypes.filter(_obj => _obj.uid === obj.uid).length,
            percentage:
              (
                (archetypes.filter(_obj => _obj.uid === obj.uid).length /
                  archetypes.length) *
                100
              ).toFixed(2) + '%',
          }))
          .sort(dynamicSortMultiple('-count', 'displayName')),
      },
      cards: {
        object: 'catalog',
        count: cards.length,
        unique: [...new Set(cards.map(obj => obj.cardname))].length,
        types: [],
        data: cards
          .filter(
            (obj, i) => cards.findIndex(_obj => _obj.cardname === obj.cardname) === i
          )
          .map(obj => ({
            object: 'card',
            uid: obj.uid,
            cardname: obj.cardname,
            count: cards.filter(_obj => _obj.cardname === obj.cardname).length,
            percentage:
              parseFloat(
                ([
                  ...new Set(
                    cards
                      .filter(_obj => _obj.cardname === obj.cardname)
                      .map(_obj => _obj.deck_uid)
                  ),
                ].length /
                  [...new Set(cards.map(_obj => _obj.deck_uid))].length) *
                  100
              ).toFixed(2) + '%',
            average: parseFloat(
              (
                cards
                  .filter(_obj => _obj.cardname === obj.cardname)
                  .map(_obj => _obj.quantity)
                  .reduce((a, b) => a + b, 0) /
                [
                  ...new Set(
                    cards
                      .filter(_obj => _obj.cardname === obj.cardname)
                      .map(_obj => _obj.deck_uid)
                  ),
                ].length
              ).toFixed(2)
            ),
            container: [
              ...new Set(
                cards
                  .filter(_obj => _obj.cardname === obj.cardname)
                  .map(_obj => _obj.container)
              ),
            ],
          }))
          .sort(dynamicSortMultiple('-count', '-average', 'cardname')),
      },
    },
  });
};
