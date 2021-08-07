import MTGO from 'data/mtgo';
import { sql, dynamicSortMultiple } from 'utils/database';
import { getQueryArgs, groupQuery, eventsQuery } from 'utils/querybuilder';

export default async (req, res) => {
  // Group query parameters by named params and aliases
  const queryParams = groupQuery({
    query: getQueryArgs(req?.query).flat(1),
    _mainParam: ['card', 'name', 'cardname', 'cardName'],
    _param1: ['qty', 'quantity'],
    _param2: ['is', 'c', 'cont', 'container'],
  });

  // Match query against params and extract query logic
  const query = [...new Set(queryParams.map(obj => obj.group))]
    .map(group => queryParams.filter(obj => obj.group == group))
    ?.flat(1);
  if (!query?.length) {
    return res.status(400).json({ "details": "You didn't enter anything to search for." });
  }

  const { parameters, data: request_1 } = await eventsQuery(req.query);
  if (!request_1[0]) {
    return res.status(404).json({ "details": 'No event data was found.' });
  }

  // Get unique formats in matched events
  const formats = [...new Set(request_1.map(obj => obj.format.toLowerCase()))].filter(
    item => MTGO.FORMATS.includes(item)
  );

  const request_2 = await sql.unsafe(`
        SELECT uid, event, deck, archetype FROM results
        WHERE event IN (${request_1.map(obj => obj.uid)})
        AND archetype::TEXT != '{}';
    `);
  if (!request_2[0]) {
    return res.status(404).json({ "details": 'No archetype data was found.' });
  }

  const decks = request_2
    .map(obj => {
      const archetype0 = obj.archetype[Object.keys(obj.archetype)[0]];
      if (!archetype0?.uid || archetype0?.uid == null) return;
      return [
        ...obj.deck?.mainboard.map(_obj => ({
          ..._obj,
          container: 'mainboard',
        })),
        ...obj.deck?.sideboard.map(_obj => ({
          ..._obj,
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
                    const { _group, parameter, operator, value } = _condition;
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
          "object": 'catalog',
          "count": [...new Set(formatData.map(_obj => _obj.deck_uid))]?.length,
          "percentage":
            (
              ([...new Set(formatData.map(_obj => _obj.deck_uid))]?.length /
                [...new Set(_formatData.map(_obj => _obj.deck_uid))]?.length) * 100
            ).toFixed(2) + '%',
          "unique": [...new Set(formatData.map(_obj => _obj.archetype_uid))]?.length,
          "data": [...new Set(formatData.map(_obj => _obj.archetype_uid))]
            .map(_uid => ({
              "object": 'archetype',
              "uid": _uid,
              "displayName": formatData.filter(_obj => _obj.archetype_uid == _uid)[0]
                .displayName,
              "count": [
                ...new Set(
                  formatData
                    .filter(_obj => _obj.archetype_uid == _uid)
                    .map(_obj => _obj.deck_uid)
                ),
              ]?.length,
              "percentage":
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
                    ]?.length) * 100
                ).toFixed(2) + '%',
            }))
            .sort(dynamicSortMultiple('-count', 'displayName')),
        },
      };
    })
    .reduce((a, b) => ({ ...a, ...b }));

  res.status(200).json({
    "object": 'collection',
    "parameters": parameters,
    "conditions": [...new Set(query.map(obj => obj.group))]
      .filter(Boolean)
      .map((group, i) =>
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
    "data": formats
        .map(format => ({
          [format]: {
            "events": {
              "object": 'collection',
              "count": request_1.count,
              "unique": [...new Set(
                request_1.filter(obj => obj.format.toLowerCase() == format)
                  .map(obj => obj.type))].length,
              "types": [...new Set(
                request_1.filter(obj => obj.format.toLowerCase() == format)
                  .map(obj => obj.type))],
              "data": request_1.filter(obj => obj.format.toLowerCase() == format)
                .map(obj => ({ object: 'event', ...obj })),
            },
            "archetypes": cards[format]
          },
        }))
        .flat(1)
        .reduce((a, b) => ({ ...a, ...b })),
  });
};
