import MTGO from 'data/mtgo';
import { sql } from 'utils/database';
import { calculateEventStats } from 'utils/swiss';
import { getParams, eventsQuery } from 'utils/querybuilder';

export default async (req, res) => {
  // Parse and pre-validate 'uids' parameter
  const _uids = getParams(req.query, 'id', 'uid', 'event', 'event_id', 'eventID');
  const uids = _uids.map(id =>
      [...id.split(',')].map(_id =>
        _id.match(/[0-9]+/g).join('')
      ) || null
    ).flat(1).filter(Boolean);
  if (_uids.length && !uids?.length) {
    return res.status(400).json({
      details: `No valid 'eventID' ${ uids?.length == 1 ? 'parameter' : 'parameters' } provided.`
    });
  }

  // Get event catalog and parsed parameters.
  const { parameters, data: request_1 } = await eventsQuery(req.query, uids);

  // Handle erronous parameters.
  const _format = [...(parameters?.format || parameters?.formats)];
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
  const unmatchedTypes = (typeof((parameters?.type || parameters?.types)) == 'object'
      ? [...new Set((parameters?.type || parameters?.types))]
      : [(parameters?.type || parameters?.types)]
    ).filter(type => !(MTGO.EVENT_TYPES.includes(type?.toLowerCase())))
    .filter(Boolean);
  const unmatchedUIDs = [...new Set(uids)].filter(uid =>
    !([...new Set(request_1.map(obj => obj.uid.toString()))].includes(uid))
  );
  const warnings = [...unmatchedFormats, ...unmatchedTypes, ...unmatchedUIDs].length
    ? {
        warnings: [...unmatchedFormats, ...unmatchedTypes].length
          // Invalid format and/or event types might create erronous warnings for invalid event ids.
          ? [
            ...unmatchedFormats.map(format => `The format parameter '${format}' does not exist.`),
            ...unmatchedTypes.map(type => `The event type parameter '${type}' does not exist.`),
          ]
          // Show invalid event ids once format type and/or event type is valid.
          : [
            ...unmatchedUIDs.map(uid => `The event id parameter '${uid}' could not be found.`)
          ]
      }
    : {};
  if (!request_1[0]) {
    return res.status(404).json({ details: 'No event data was found.', ...warnings });
  }

  // Get unique formats from matched events.
  const formats = [...new Set(request_1.map(obj => obj.format.toLowerCase()))]
    .filter(item => MTGO.FORMATS.includes(item));

  // Get event results from event catalog.
  const request_2 = await sql.unsafe(`
    SELECT * from results
    WHERE event in (${request_1.map(obj => obj.uid)});
  `);
  if (!request_2[0]) {
    return res.status(404).json({ details: 'No player data was found.', ...warnings });
  }
  // Get approx total players and swiss distribution per event.
  const eventRecords = [...new Set(request_2.map(obj => obj.event))]
    .map(uid => {
      const records = request_2
        .filter(obj => obj.event == uid)
        .map(obj => obj?.stats?.record);
      const recordData = [...new Set(records)].map(record => ({
          record,
          count: records.filter(_record => _record == record).length
        })).sort((a, b) =>
          parseInt(b.record.split('-')[0]) - parseInt(a.record.split('-')[0])
        );
      return {
        [uid]: calculateEventStats(recordData)
      };
    }).flat(1).reduce((a, b) => ({ ...a, ...b }));

  // Parse results for valid archetypes.
  const archetypes = request_2
    .map(obj => {
      if (obj.archetype === {}) return;
      const archetype0 = obj.archetype[Object.keys(obj.archetype)[0]];
      if (!archetype0?.uid) return;
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

  // Return catalog object.
  return res.status(200).json({
    object: 'catalog',
    ...warnings,
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
                  uid: obj.uid,
                  url: `https://magic.wizards.com/en/articles/archive/mtgo-standings/${obj.uri}`,
                  ...obj,
                  stats: {
                    numPlayers: eventRecords[obj.uid].numPlayers,
                    approxSwiss: eventRecords[obj.uid].triangle,
                    obsPlayers: eventRecords[obj.uid].truncPlayers,
                    obsSwiss: eventRecords[obj.uid].truncTriangle,
                    obsArchetypes: _archetypes.filter(archetype => obj.uid == archetype.event_uid).length,
                  },
                  data: request_2.filter(_obj => _obj.event == obj.uid)
                    .map(_obj => {
                      const archetype0 = obj.archetype !== {}
                        ? _obj.archetype[Object.keys(_obj.archetype)[0]]
                        : {};
                      const tiebreakers = _obj.stats?.GWP
                        ? {
                            tiebreakers: {
                              GWP: _obj.stats?.GWP,
                              OGWP: _obj.stats?.OGWP,
                              OMWP: _obj.stats?.OMWP,
                            }
                          }
                        : {};
                      return {
                        object: 'event-result',
                        uid: _obj.uid,
                        username: _obj.username,
                        record: _obj.stats.record,
                        event_id: _obj.event,
                        url: _obj.url,
                        archetype: {
                          object: 'archetype',
                          uid: archetype0?.uid || null,
                          displayName: [...archetype0?.alias || [], archetype0?.displayName || []]
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