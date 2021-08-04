import { MTGO, TEMPLATES } from 'constants.js'
import { sql, removeDuplicates, dynamicSortMultiple } from 'utils/database.js';
import { getParams, getQuery, groupQuery, eventsQuery } from 'utils/querybuilder.js';

export default async (req, res) => {
    const params = removeDuplicates(req?.query);
    const queryParams = groupQuery({
        query: getQuery(req?.query).flat(1),
        _mainParam: ['card', 'name', 'cardname', 'cardName'],
        _param1: ['qty', 'quantity'],
        _param2: ['is', 'c', 'cont', 'container']
    });

    const query = [...new Set(queryParams.map(obj => obj.group))]
        .map(group => queryParams.filter(obj => obj.group == group))
        ?.flat(1);

    if (!query?.length) {
        return res.status(TEMPLATES.BAD_REQUEST.status).json({
            ...TEMPLATES.BAD_REQUEST,
            "details": "You didn't enter anything to search for."
        });
    }

    const _format = getParams(req?.query, 'f', 'fmt', 'format')
        .map(obj => {
            const text = obj?.match(/[a-zA-Z\-]+/g).join('');
            return text.charAt(0).toUpperCase() + text.slice(1);
        });
    if (_format && !_format.filter(format => MTGO.FORMATS.includes(format.toLowerCase()))) {
        return res.status(TEMPLATES.BAD_REQUEST.status).json({
            ...TEMPLATES.BAD_REQUEST,
            "details": "Invalid 'format' parameter provided."
        });
    }
    const _type = getParams(req?.query, 't', 'type')
        .map(obj => {
            const text = obj.replaceAll(' ', '-')
                ?.match(/[a-zA-Z\-]+/g)
                .map(x => x.split(/-/g)
                    .map(_obj => {
                        return _obj.charAt(0).toUpperCase() + _obj.slice(1);
                    }).join(' ')
                ).flat(1);
            return text.join('');
        });

    const _time_interval = parseInt(getParams(params, 'i', 'int', 'interval')[0]) || 2 * 7;
    if (_time_interval <= 0) {
        return res.status(TEMPLATES.BAD_REQUEST.status).json({
            ...TEMPLATES.BAD_REQUEST,
            "details": "'time_interval' parameter must be greater than zero."
        });
    }

    const request_1 = await eventsQuery({
        format          : _format,
        type            : _type,
        time_interval   : _time_interval,
        offset          : getParams(params, 'o', 'ofs', 'offset'),
        _min_date       : getParams(params, 'min', 'min-date'),
        _max_date       : getParams(params, 'max', 'max-date'),
    });
    if (!request_1[0]) {
        return res.status(TEMPLATES.BAD_REQUEST.status).json({
            ...TEMPLATES.BAD_REQUEST,
            "details": "No event data was found."
        });
    }

    const formats = [...new Set(request_1.map(obj => obj.format.toLowerCase()))]
        .filter(item => MTGO.FORMATS.includes(item));

    const request_2 = await sql.unsafe(`
        SELECT uid, event, deck, archetype FROM results
        WHERE event IN (${ request_1.map(obj => obj.uid) })
        AND archetype::TEXT != '{}';
    `);
    if (!request_2[0]) {
        return res.status(TEMPLATES.BAD_REQUEST.status).json({
            ...TEMPLATES.BAD_REQUEST,
            "details": "No archetype data was found."
        });
    }
    
    const decks = request_2.map(obj => {
        const archetype0 = obj.archetype[Object.keys(obj.archetype)[0]];
        if (!archetype0?.uid || archetype0?.uid == null) return;
        return [
                ...obj.deck?.mainboard.map(_obj => ({
                    ..._obj,
                    container: 'mainboard'
                })),
                ...obj.deck?.sideboard.map(_obj => ({
                    ..._obj,
                    container: 'sideboard'
                }))
            ].map(_obj => ({
                uid: null,
                ..._obj,
                deck_uid: obj.uid,
                archetype_uid: archetype0.uid,
                displayName: [
                        ...archetype0.alias,
                        archetype0.displayName
                    ].filter(Boolean)[0],
                event_uid: obj.event,
            }));
    }).filter(Boolean).flat(1);

    const cards = formats
        .map(format => {
            const _formatData = decks
                .filter(card =>
                    request_1
                        .filter(_obj =>
                            _obj.format.toLowerCase() === format
                        ).map(_obj => _obj.uid)
                        .includes(card.event_uid)
                );
            let formatData = _formatData;
            [...new Set(query.map(obj => obj.group))]
                .filter(Boolean)
                .forEach(group => {
                    const _query = query.filter(_obj => _obj.group == group);
                    const filteredUIDs = [...new Set(formatData.map(_obj => _obj.deck_uid))]
                        .map(_uid => {
                            const filteredData = _formatData
                                .filter(obj => obj.deck_uid == _uid)
                                .filter(_data => {
                                    const _filter = _query.map(_condition => {
                                        const { _group, parameter, operator, value} = _condition;
                                        switch (operator) {
                                            case ">=":
                                                return _data[parameter] >= value;
                                            case "<=":
                                                return _data[parameter] <= value;
                                            case ">":
                                                return _data[parameter] > value;
                                            case "<":
                                                return _data[parameter] < value;
                                            case "=":
                                                return _data[parameter] == value;
                                            case "!=":
                                                return _data[parameter] !== value;
                                        }
                                    }).filter(Boolean);
                                    return _filter?.length == _query?.length;
                                });
                            return filteredData?.length ? _uid : null;
                        }).filter(_uid => _uid !== null);
                    formatData = formatData.filter(obj => filteredUIDs.includes(obj.deck_uid)) || [];
                });
            return {
                [format]: {
                    "object": "catalog",
                    "count": [...new Set(formatData.map(_obj => _obj.deck_uid))]?.length,
                    "percentage": ([...new Set(formatData.map(_obj => _obj.deck_uid))]?.length
                        / [...new Set(_formatData.map(_obj => _obj.deck_uid))]?.length * 100).toFixed(2) + '%',
                    "unique": [...new Set(formatData.map(_obj => _obj.archetype_uid))]?.length,
                    "data": [...new Set(formatData.map(_obj => _obj.archetype_uid))]
                        .map(_uid => ({
                            "object": "archetype",
                            "uid": _uid,
                            "displayName": formatData.filter(_obj => _obj.archetype_uid == _uid)[0].displayName,
                            "count": [...new Set(
                                    formatData.filter(_obj => _obj.archetype_uid == _uid)
                                        .map(_obj => _obj.deck_uid)
                                )]?.length,
                            "percentage": ([...new Set(
                                    formatData.filter(_obj => _obj.archetype_uid == _uid)
                                        .map(_obj => _obj.deck_uid)
                                )]?.length / [...new Set(
                                    _formatData.filter(_obj => _obj.archetype_uid == _uid)
                                        .map(_obj => _obj.deck_uid)
                                )]?.length * 100).toFixed(2) + '%',
                        })).sort(dynamicSortMultiple('-count', 'displayName')),
                }
            }
        }).reduce((a, b) => ({ ...a, ...b }));

    res.status(200).json({
        "object": "collection",
        "parameters": Object.entries(
            {
                [_format?.length == 1 ? 'format' : 'formats']:
                    _format?.length == 1 ? _format[0] : _format,
                [_type?.length == 1 ? 'type' : 'types']:
                    _type?.length == 1 ? _type[0] : _type,
                time_interval: _time_interval,
                offset: getParams(params, 'o', 'ofs', 'offset'),
                min_date: getParams(params, 'min', 'min-date'),
                max_date: getParams(params, 'max', 'max-date'),
            }).filter(([_, v]) =>
                typeof(v) == 'object'
                    ? v?.length
                    : v != null
            ).reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
        "conditions": [...new Set(query.map(obj => obj.group))]
            .filter(Boolean)
            .map((group, i) =>
                query.filter(obj => obj.group == group)
                    .map(_obj => [
                            _obj.parameter.toLowerCase(),
                            _obj.operator,
                            !isNaN(_obj.value)
                                ? _obj.value
                                : `'${_obj.value || ''}'`
                        ].join(' ')
                    ).join(' and '),
            ).flat(1),
        "data": {
            "archetypes": formats.map(format => ({
                    [format]: cards[format]
                })).flat(1)
                .reduce((a, b) => ({ ...a, ...b }))
        },
    });
}