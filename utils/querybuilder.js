import { sql } from 'utils/database.js';
import { MTGO } from 'constants.js';

export const FORMATS = MTGO.FORMATS
    .map(obj => {
        const text = obj?.match(/[a-zA-Z]+/g).join('');
        return text.charAt(0).toUpperCase() + text.slice(1);
    });
export const EVENT_TYPES = MTGO.EVENT_TYPES
    .map(obj => {
        const text = obj?.match(/[a-zA-Z\-]+/g)
        .map(x => x.split(/-/g)
            .map(_obj => {
                return _obj.charAt(0).toUpperCase() + _obj.slice(1);
            }).join(' ')
        ).flat(1);
        return text.join('');
    });

export const getParams = (query, prop1, prop2, prop3) => [].concat.apply(
    [], [prop1, prop2, prop3]?.map(prop => query?.[prop]).filter(Boolean)
);

export const getQuery = (query) =>
    getParams(query, 'q', 'query')
        .map(obj => {
            let _query = obj.trim().split(' ');
            let args = [];
            let offset = 1;
            _query.forEach((_arg, i) => {
                const condition = (/>=|<=|>|<|=/g.test(_arg) &&
                    _arg.replace(/>=|<=|>|<|=/g, '').length)
                    || !args[i - offset]
                if (condition) args.push(_arg);
                else {
                    args[i - offset] += ' ' + _arg;
                    offset++;
                }
            })
            return args.filter(_obj =>
                />=|<=|>|<|=/g.test(_obj)
            );
        });

export const groupQuery = ({query, _mainParam, _param1, _param2, _param3}) => {
    const mainParam = _mainParam?.slice(-1)[0];
    const param1 = _param1?.slice(-1)[0];
    const param2 = _param2?.slice(-1)[0];
    const param3 = _param3?.slice(-1)[0];
    let i = 0;
    let params = query
        .map(_param => {
            const [_parameter, value] = _param.split(/>=|<=|>|<|=/g);
            let parameter = [_mainParam, _param1, _param2, _param3]
                .filter(Boolean)
                .map(param => 
                    param
                        .map(p => isNaN(p) ? p?.toLowerCase() : p)
                        .includes(_parameter?.toLowerCase())
                            ? param?.slice(-1)[0]
                            : false
                ).filter(Boolean)
                ?.flat(1);
            if (typeof(parameter) == 'object') parameter = parameter[0];
            if (parameter === mainParam) i++;
            const [operator] = _param.match(/>=|<=|>|<|=|!=/g);
            return {
                group: i > 0 ? i : 1,
                parameter: parameter,
                operator: operator,
                value: !isNaN(value) ? Number(value) : value,
            }
        });
    [mainParam, param1, param2, param3]
        .filter(Boolean)
        .map(_param => {
            const set = params
                .filter(obj => obj?.parameter == _param)
                .map(obj => obj.group);

            [...new Set(params.map(obj => obj.group))]
                .forEach(group => {
                    let i = 0;
                    let g = 0;
                    params
                        .forEach((obj, _i) => {
                            if (obj.group == group && obj.parameter == _param) i++;
                            if (g > 0 && g !== obj.group) i = 0;
                            g = obj.group;
                            if (i > 1) {
                                params[_i] = {
                                    group: obj.group + 1,
                                    parameter: obj.parameter,
                                    operator: obj.operator,
                                    value: obj.value,
                                }
                            }
                        });
                });
        });
    return params;
}

/**
 * @typedef {string} date - Hyphen-separated date in MM/DD/YYYY or YYYY/MM/DD format.
 * @typedef {object} catalog - An object-array of references to objects.
 */

/**
 * Queries database, accepts parameters and array of uids to filter events from.
 * 
 * @async
 * 
 * @param       {string}        [format]            - Format to return results from.
 * @param       {string}        [type]              - Event type to return results from.
 * @param       {integer}       [time_interval]     - Number of days to return results from
 *                                                    (ignored when both `min_date` and 
 *                                                    `max_date` are provided).
 * @param       {integer}       [offset]            - Offset in days to offset `time_interval`
 *                                                    or `min_date` / `max_date`.
 * @param       {date}          [min_date]          - Minimum date to return results from in
 *                                                    `MM/DD/YYYY` or `YYYY/MM/DD` format.
 * @param       {date}          [max_date]          - Maximum date to return results from in
 *                                                    `MM/DD/YYYY` or `YYYY/MM/DD` format.
 * @param       {catalog}       [uids]              - List of uids to filter selection from.
 */
export const eventsQuery = async ({
        format, type, time_interval, offset, _min_date, _max_date, uids
    }) => {
    const min_date = _min_date?.length
        ? new Intl.DateTimeFormat('en-US').format(new Date(
                new Date(_min_date?.replace(/-/g, '/'))).getTime()
                + (offset ? parseInt(offset) : 0)
            )
        : undefined;
    const max_date = _max_date?.length
        ? new Intl.DateTimeFormat('en-US').format(new Date(
                new Date(_max_date?.replace(/-/g, '/'))).getTime()
                - (offset ? parseInt(offset) : 0)
            )
        : (offset?.length
                ? new Intl.DateTimeFormat('en-US').format(
                    new Date().getTime()
                    - parseInt(offset))
                : undefined
            );
    
    return await sql.unsafe(`
        SELECT * FROM events
        WHERE uid IN (
            SELECT uid FROM events
            WHERE ${[
                `format in (${
                    (format?.length ? format : FORMATS)
                        .map(obj => `'${obj}'`)
                        .join()
                })`,
                `type in (${
                    (type?.length ? type : EVENT_TYPES)
                        .map(obj => `'${obj}'`)
                        .join()
                })`,
                !isNaN(time_interval)
                    ? `date::DATE ${
                            (min_date && !max_date) ? '<=' : '>='
                        } ${ (min_date && !max_date)
                            ? `'${ min_date }'::DATE`
                            : (max_date ? `'${ max_date }'::DATE` : 'CURRENT_DATE')
                        } ${ (min_date && !max_date) ? '+' : '-' } ${ time_interval }::INT`
                    : '',
                min_date
                    ? `date::DATE >= '${ min_date }'::DATE`
                    : '',
                max_date
                    ? `date::DATE <= '${ max_date }'::DATE`
                    : '',
                uids?.length
                    ? `uid IN (${uids})`
                    : '',
            ].filter(Boolean).join(' AND ')}
        ) ORDER BY date::DATE DESC, uid DESC;
    `);
}