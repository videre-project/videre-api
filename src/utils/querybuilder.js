import { sql } from './database';
import MTGO from '../data/mtgo';

const toPascalCase = text => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Get request parameters by alias.
 */
export const getParams = (query, ...props) =>
  [].concat.apply([], props?.map(prop => query?.[prop]).filter(Boolean));

/**
 * Parse arguments from request query parameter.
 */
export const getQueryArgs = query =>
  getParams(query, 'q', 'query').map(obj => {
    let _query = obj.trim().split(' ');
    let args = [];
    let offset = 1;
    _query.forEach((_arg, i) => {
      const condition =
        (/>=|<=|>|<|=|!=/g.test(_arg) && _arg.replace(/>=|<=|>|<|=|!=/g, '').length) ||
        !args[i - offset];
      if (condition) args.push(_arg);
      else {
        args[i - offset] += ' ' + _arg;
        offset++;
      }
    });
    return args.filter(_obj => />=|<=|>|<|=|!=/g.test(_obj));
  });

/**
 * Group query parameters by main query parameter type.
 */
export const groupQuery = ({ query, _mainParam, _param1, _param2, _param3 }) => {
  // Enumerate parameters to declare final item in array as parameter name.
  const mainParam = _mainParam?.slice(-1)[0];
  const param1 = _param1?.slice(-1)[0];
  const param2 = _param2?.slice(-1)[0];
  const param3 = _param3?.slice(-1)[0];

  let i = 0;
  let params = query.map(_param => {
    const [_parameter, value] = _param.split(/>=|<=|>|<|=|!=/g);
    let parameter = [_mainParam, _param1, _param2, _param3]
      .filter(Boolean)
      .map(param =>
        param
          .map(p => (isNaN(p) ? p?.toLowerCase() : p))
          .includes(_parameter?.toLowerCase())
          ? param?.slice(-1)[0]
          : false
      )
      .filter(Boolean)
      ?.flat(1);
    if (typeof parameter == 'object') parameter = parameter[0];
    if (parameter === mainParam) i++;
    const [operator] = _param.match(/>=|<=|>|<|=|!=/g);
    return {
      group: i > 0 ? i : 1,
      parameter: parameter,
      operator: operator,
      value: !isNaN(value) ? Number(value) : value,
    };
  });
  [mainParam, param1, param2, param3].filter(Boolean).map(_param => {
    [...new Set(params.map(obj => obj.group))].forEach(group => {
      let i = 0;
      let g = 0;
      params.forEach((obj, _i) => {
        if (obj.group == group && obj.parameter == _param) i++;
        if (g > 0 && g !== obj.group) i = 0;
        g = obj.group;
        if (i > 1) {
          params[_i] = {
            group: obj.group + 1,
            ...obj,
          };
        }
      });
    });
  });
  return params;
};

/**
 * Removes duplicate query parameters.
 */
export const removeDuplicates = query =>
  Object.keys(query)
    .map(param => ({
      [param]:
        typeof query[param] === 'object'
          ? query[param]?.length > 1
            ? query[param][0]
            : []
          : query[param],
    }))
    .reduce((r, c) => Object.assign(r, c), {});

/**
 * Removes undefined object keys.
 */
export const pruneObjectKeys = object => {
  return Object.entries(object)
    .filter(([, v]) => (typeof v == 'object' ? v?.length : v != null))
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
};

/**
 * Queries database, accepts parameters and array of uids to filter events from.
 */
export const eventsQuery = async (query, uids) => {
  const params = removeDuplicates(query);

  // Enumerate and parse arguments from query.
  const _format = getParams(query, 'f', 'fmt', 'format').map(obj => {
    const text = obj?.match(/[a-zA-Z-]+/g).join('');
    return text.charAt(0).toUpperCase() + text.slice(1);
  });
  const _type = getParams(query, 't', 'type', 'event_type').map(obj => {
    const text = obj
      .replaceAll(' ', '-')
      ?.match(/[a-zA-Z-]+/g)
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
  const _time_interval = parseInt(
    getParams(params, 'i', 'int', 'interval', 'time_interval')[0]
  );
  const offset = getParams(params, 'o', 'ofs', 'offset')[0];
  const _min_date = getParams(params, 'min', 'min_date', 'min-date')[0];
  const _max_date = getParams(params, 'max', 'max_date', 'max-date')[0];

  const time_interval = uids?.length ? undefined : _time_interval || 2 * 7;

  // Format prettified dates from query string.
  const min_date =
    _min_date?.length && (_min_date?.match('///g') || []).length == 2
      ? new Intl.DateTimeFormat('en-US').format(
          new Date(new Date(_min_date?.replace(/-/g, '/'))).getTime() +
            (offset ? parseInt(offset) : 0)
        )
      : undefined;
  const max_date =
    _max_date?.length && (_max_date?.match('///g') || []).length == 2
      ? new Intl.DateTimeFormat('en-US').format(
          new Date(new Date(_max_date?.replace(/-/g, '/'))).getTime() -
            (offset ? parseInt(offset) : 0)
        )
      : offset?.length
      ? new Intl.DateTimeFormat('en-US').format(new Date().getTime() - parseInt(offset))
      : undefined;

  const eventData = await sql.unsafe(`
    SELECT * FROM events
    WHERE uid IN (
        SELECT uid FROM events
        WHERE ${[
          `format in (${(_format?.length
            ? _format
            : MTGO.FORMATS.map(obj => toPascalCase(obj?.match(/[a-z]+/gi).join('')))
          )
            .map(obj => `'${obj}'`)
            .join()})`,
          `type in (${(_type?.length
            ? _type
            : MTGO.EVENT_TYPES.map(obj => {
                const text = obj
                  ?.match(/[a-zA-Z-]+/g)
                  .map(x => x.split(/-/g).map(toPascalCase).join(' '))
                  .flat(1);
                return text.join('');
              })
          )
            .map(obj => `'${obj}'`)
            .join()})`,
          !isNaN(time_interval)
            ? `date::DATE ${min_date && !max_date ? '<=' : '>='} ${
                min_date && !max_date
                  ? `'${min_date}'::DATE`
                  : max_date
                  ? `'${max_date}'::DATE`
                  : 'CURRENT_DATE'
              } ${min_date && !max_date ? '+' : '-'} ${time_interval}::INT`
            : '',
          min_date ? `date::DATE >= '${min_date}'::DATE` : '',
          max_date ? `date::DATE <= '${max_date}'::DATE` : '',
          uids?.length ? `uid IN (${uids.map(_uid => `${_uid}::INTEGER`)})` : '',
        ]
          .filter(Boolean)
          .join(' AND ')}
    ) ORDER BY date::DATE DESC, uid DESC;
  `);

  return {
    parameters: pruneObjectKeys({
      [_format?.length == 1 ? 'format' : 'formats']:
        _format?.length == 1 ? _format[0] : _format,
      [_type?.length == 1 ? 'type' : 'types']: _type?.length == 1 ? _type[0] : _type,
      time_interval: time_interval,
      offset,
      min_date: _min_date,
      max_date: _max_date,
      uids: [...new Set(uids)].filter(uid =>
        [...new Set(eventData.map(obj => obj.uid.toString()))].includes(uid.toString())
      ),
    }),
    data: eventData,
  };
};
