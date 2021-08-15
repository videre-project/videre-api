import fetch from 'node-fetch';
import MTGO from 'data/mtgo';
import { sql, dynamicSortMultiple } from 'utils/database';
import { getQueryArgs, groupQuery, eventsQuery } from 'utils/querybuilder';

export default async (req, res) => {
  // Group query parameters by named params and aliases.
  const queryParams = groupQuery({
    query: getQueryArgs(req?.query).flat(1),
    _mainParam: ['card', 'name', 'cardname'],
    _param1: ['qty', 'quantity'],
    _param2: ['is', 'c', 'cont', 'container'],
  });

  // Match query against params and extract query logic.
  const _query = [...new Set(queryParams.map(obj => obj.group))]
    .map(group => queryParams.filter(obj => obj.group == group))
    .flat(1);
  if (!_query?.length) {
    return res.status(400).json({ details: "You didn't enter anything to search for." });
  }

  // Remove unmatched cards from query conditions.
  let ignoredGroups = [];
  let query = await Promise.all(
    _query
      .map(async obj => {
        if (obj.parameter == 'cardname') {
          const request = await fetch(
            `https://api.scryfall.com/cards/named?fuzzy=${obj.value}`
          ).then(response => response.json());
          if (!request?.name) ignoredGroups.push(obj.group);
          return { ...obj, value: request?.name || null };
        }
        if (obj.parameter == 'quantity') {
          if (isNaN(obj.value)) {
            ignoredGroups.push(obj.group);
            return { ...obj, value: null };
          }
        }
        if (obj.parameter == 'container') {
          if (!['mainboard', 'sideboard'].includes(obj.value)) {
            ignoredGroups.push(obj.group);
            return { ...obj, value: null };
          }
        }
        return obj;
      })
      .filter(Boolean)
  );

  // Create warnings for invalid parameters.
  let warnings = ignoredGroups.length
    ? {
        warnings: [...new Set(query.map(obj => obj.group))]
          .filter(Boolean)
          .filter(group => ignoredGroups.includes(group))
          .map(group => {
            const getValue = parameter =>
              _query
                .filter(obj => obj.group == group)
                .filter(obj => obj.parameter == parameter)
                .map(obj => obj.value)[0];
            const errors = query
              .filter(obj => obj.value === null)
              .map(obj => obj.parameter);
            const condition = _query
              .filter(obj => obj.group == group)
              .map(_obj =>
                [
                  _obj.parameter.toLowerCase(),
                  _obj.operator,
                  !isNaN(_obj.value) ? _obj.value : `'${_obj.value || ''}'`,
                ].join(' ')
              )
              .join(' and ');
            return [
              'T' +
                [
                  errors.includes('cardname')
                    ? `the card '${getValue('cardname')}' could not be found`
                    : '',
                  errors.includes('quantity')
                    ? `the quantity '${getValue('quantity')}' is not a number`
                    : '',
                  errors.includes('container')
                    ? `the container '${getValue('container')}' does not exist`
                    : '',
                ]
                  .join(', ')
                  .replace(/, ([^,]*)$/, ' and $1')
                  .slice(1) +
                '.',
              `Condition ${group} “${condition}” was ignored.`,
            ]
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim();
          })
          .flat(1),
      }
    : {};

  // Filter query for valid query conditions.
  query = query.filter(obj => !ignoredGroups.includes(obj.group));
  // Throw error if no valid query conditions are found.
  if (!query?.length) {
    return res.status(400).json({
      details: `Provided query ${
        ignoredGroups?.length == 1 ? 'condition' : 'conditions'
      } had one or more invalid parameters.`,
      ...warnings,
    });
  }

  // Get event catalog and parsed parameters.
  const { parameters, data: request_1 } = await eventsQuery(req.query);

  // Handle erronous parameters.
  const unmatchedFormats = (
    typeof parameters?.format == 'object'
      ? [...new Set(parameters?.format)]
      : [parameters?.format]
  )
    .filter(format => !MTGO.FORMATS.includes(format?.toLowerCase()))
    .filter(Boolean);
  const unmatchedTypes = (
    typeof (parameters?.type || parameters?.types) == 'object'
      ? [...new Set(parameters?.type || parameters?.types)]
      : [parameters?.type || parameters?.types]
  )
    .filter(type => !MTGO.EVENT_TYPES.includes(type?.toLowerCase()))
    .filter(Boolean);
  if ([...unmatchedFormats, ...unmatchedTypes].length) {
    warnings.warnings = {
      ...unmatchedFormats.map(
        format => `The format parameter '${format}' does not exist.`
      ),
      ...unmatchedTypes.map(type => `The event type parameter '${type}' does not exist.`),
      ...warnings?.warnings,
    };
  }
  if (!request_1[0]) {
    return res.status(404).json({ details: 'No event data was found.', ...warnings });
  }

  // Get unique formats from matched events.
  const formats = [...new Set(request_1.map(obj => obj.format.toLowerCase()))].filter(
    item => MTGO.FORMATS.includes(item)
  );

  // Get event results from event catalog.
  const request_2 = await sql.unsafe(`
    SELECT * from results
    WHERE event in (${request_1.map(obj => obj.uid)});
  `);
  if (!request_2[0]) {
    return res.status(404).json({ details: 'No archetype data was found.', ...warnings });
  }

  // Parse results for valid archetype decklists.
  const decks = request_2
    .map(obj => {
      if (obj.archetype === {}) return;
      const archetype0 = obj.archetype[Object.keys(obj.archetype)[0]];
      if (!archetype0?.uid || archetype0?.uid == null) return;
      return [
        ...obj.deck?.mainboard.map(_obj => ({
          cardname: _obj.cardName,
          quantity: _obj.quantity,
          container: 'mainboard',
        })),
        ...obj.deck?.sideboard.map(_obj => ({
          cardname: _obj.cardName,
          quantity: _obj.quantity,
          container: 'sideboard',
        })),
      ].map(_obj => ({
        uid: null,
        ..._obj,
        deck_uid: obj.uid,
        archetype_uid: archetype0.uid,
        displayName: [...archetype0.alias, archetype0.displayName].filter(Boolean)[0],
        event_uid: obj.event,
      }));
    })
    .filter(Boolean)
    .flat(1);

  // Parse archetype decklists for valid cards and filter against query conditions.
  const cards = formats
    .map(format => {
      const _formatData = decks.filter(card =>
        request_1
          .filter(_obj => _obj.format.toLowerCase() === format)
          .map(_obj => _obj.uid)
          .includes(card.event_uid)
      );
      let formatData = _formatData;
      [...new Set(query.map(obj => obj.group))].filter(Boolean).forEach(group => {
        const _query = query.filter(_obj => _obj.group == group);
        const filteredUIDs = [...new Set(formatData.map(_obj => _obj.deck_uid))]
          .map(_uid => {
            const filteredData = _formatData
              .filter(obj => obj.deck_uid == _uid)
              .filter(_data => {
                const _filter = _query
                  .map(_condition => {
                    const { parameter, operator, value } = _condition;
                    switch (operator) {
                      case '>=':
                        return _data[parameter] >= value;
                      case '<=':
                        return _data[parameter] <= value;
                      case '>':
                        return _data[parameter] > value;
                      case '<':
                        return _data[parameter] < value;
                      case '=':
                        return _data[parameter] == value;
                      case '!=':
                        return _data[parameter] !== value;
                    }
                  })
                  .filter(Boolean);
                return _filter?.length == _query?.length;
              });
            return filteredData?.length ? _uid : null;
          })
          .filter(_uid => _uid !== null);
        formatData = formatData.filter(obj => filteredUIDs.includes(obj.deck_uid)) || [];
      });
      return {
        [format]: {
          object: 'catalog',
          count: [...new Set(formatData.map(_obj => _obj.deck_uid))]?.length,
          percentage:
            (
              ([...new Set(formatData.map(_obj => _obj.deck_uid))]?.length /
                [...new Set(_formatData.map(_obj => _obj.deck_uid))]?.length) *
              100
            ).toFixed(2) + '%',
          unique: [...new Set(formatData.map(_obj => _obj.archetype_uid))]?.length,
          data: [...new Set(formatData.map(_obj => _obj.archetype_uid))]
            .map(_uid => ({
              object: 'archetype',
              uid: _uid,
              displayName: formatData.filter(_obj => _obj.archetype_uid == _uid)[0]
                .displayName,
              count: [
                ...new Set(
                  formatData
                    .filter(_obj => _obj.archetype_uid == _uid)
                    .map(_obj => _obj.deck_uid)
                ),
              ]?.length,
              percentage:
                (
                  ([
                    ...new Set(
                      formatData
                        .filter(_obj => _obj.archetype_uid == _uid)
                        .map(_obj => _obj.deck_uid)
                    ),
                  ]?.length /
                    [
                      ...new Set(
                        _formatData
                          .filter(_obj => _obj.archetype_uid == _uid)
                          .map(_obj => _obj.deck_uid)
                      ),
                    ]?.length) *
                  100
                ).toFixed(2) + '%',
            }))
            .sort(dynamicSortMultiple('-count', 'displayName')),
        },
      };
    })
    .reduce((a, b) => ({ ...a, ...b }));

  // Return collection object.
  return res.status(200).json({
    object: 'collection',
    ...warnings,
    parameters: parameters,
    conditions: [...new Set(query.map(obj => obj.group))]
      .filter(Boolean)
      .filter(group => !ignoredGroups.includes(group))
      .map(group =>
        query
          .filter(obj => obj.group == group)
          .map(_obj =>
            [
              _obj.parameter.toLowerCase(),
              _obj.operator,
              !isNaN(_obj.value) ? _obj.value : `'${_obj.value || ''}'`,
            ].join(' ')
          )
          .join(' and ')
      )
      .flat(1),
    data: formats
      .map(format => ({ [format]: { archetypes: cards[format] } }))
      .flat(1)
      .reduce((a, b) => ({ ...a, ...b })),
  });
};
