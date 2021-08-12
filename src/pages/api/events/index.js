import MTGO from 'data/mtgo';
import { sql, dynamicSortMultiple } from 'utils/database';
import { getParams, eventsQuery } from 'utils/querybuilder';

export default async (req, res) => {
  const uids = getParams(req.query, 'id', 'uid', 'event', 'event_id', 'eventID');
  const { parameters, data: request_1 } = await eventsQuery(
      req.query,
      uids.map(id => id.match(/[0-9]+/g)).join('')
    );
  const _format = [...(parameters?.format || parameters?.formats)];
  if (_format && !_format.filter(format => MTGO.FORMATS.includes(format.toLowerCase()))) {
    return res.status(400)
      .json({ details: "No valid 'format' parameter provided." });
  }
  if (parameters?.time_interval && parameters?.time_interval <= 0) {
    return res.status(400)
      .json({ details: "'time_interval' parameter must be greater than zero." });
  }
  if (!request_1[0]) {
    return res.status(404)
      .json({ details: 'No event data was found.' });
  }

  // Get unique formats in matched events
  const formats = [...new Set(request_1.map(obj => obj.format.toLowerCase()))]
    .filter(item => MTGO.FORMATS.includes(item));

  const request_2 = await sql.unsafe(`
        SELECT * from results
        WHERE event in (${request_1.map(obj => obj.uid)});
    `);
  if (!request_2[0]) {
    return res.status(404)
        .json({ details: 'No player data was found.' });
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
    })
    .filter(Boolean);

  return res.status(200).json({
    object: 'catalog',
    parameters: parameters,
    data: formats
      .map(format => {
        const _events = request_1.filter(_obj => _obj.format.toLowerCase() === format);
        const _archetypes = archetypes.filter(archetype =>
            _events.map(_obj => _obj.uid).includes(archetype.event_uid)
        );
        return {
          [format]: {
            events: {
              object: 'collection',
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
                  data: request_2.filter(_obj => _obj.event == obj.uid)
                    .map(_obj => {
                      const archetype0 = obj.archetype !== {}
                        ? _obj.archetype[Object.keys(_obj.archetype)[0]]
                        : {};
                      const tiebreakers = {
                        tiebreakers: {
                          GWP: _obj.stats?.GWP || '-',
                          OGWP: _obj.stats?.OGWP || '-',
                          OMWP: _obj.stats?.OMWP || '-',
                        }
                      };
                      return {
                        object: 'player-result',
                        uid: _obj.uid,
                        username: _obj.username,
                        record: _obj.stats.record,
                        event_id: _obj.event,
                        url: _obj.url,
                        archetype: {
                          object: 'archetype',
                          uid: archetype0?.uid || null,
                          displayName: [...archetype0?.alias, archetype0?.displayName]
                            .filter(Boolean)[0] || null,
                        },
                        deck: {
                          mainboard: _obj.deck?.mainboard
                            .map(__obj => ({
                              object: 'card',
                              uid: null,
                              cardname: __obj.cardName,
                              quantity: __obj.quantity,
                            })),
                          sideboard: _obj.deck?.sideboard
                            .map(__obj => ({
                              object: 'card',
                              uid: null,
                              cardname: __obj.cardName,
                              quantity: __obj.quantity,
                            })),
                        },
                        stats: {
                          points: _obj.stats.points,
                          ...tiebreakers
                        }
                      }
                    }).filter(Boolean)
                })),
            },
          },
        };
      }).flat(1).reduce((a, b) => ({ ...a, ...b })),
  });
};