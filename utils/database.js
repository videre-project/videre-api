import postgres from 'postgres';
import config from 'config.js';

/**
 * Queries database, accepts a template string or JSON to format.
 *
 * @example sql`SELECT * FROM users`
 * @example sql`INSERT INTO users ${sql(user)}`
 */
export const sql = postgres(config.connectionString, {
  max: 1,
  idle_timeout: 3,
  connect_timeout: 5,
});

export const setDelay = ms => new Promise(res => setTimeout(res, ms));

/**
 * Takes an Array and a grouping function
 * and returns a Map of the array grouped by the grouping function.
 */
export function groupBy(list, keyGetter) {
  const map = new Map();
  list.forEach((item) => {
    const key = keyGetter(item);
    const collection = map.get(key);
    if (!collection) {
      map.set(key, [item]);
    } else {
      collection.push(item);
    }
  });
  return map;
}

/**
 * Removes duplicate query parameters 
 */
export const removeDuplicates = (query) => Object.keys(query)
  .map(param => ({
    [param]: typeof(query[param]) === 'object' 
    ? (query[param]?.length > 1 ? query[param][0] : [])
    : query[param]
  })).reduce(((r, c) => Object.assign(r, c)), {});

/**
 * Sort function with single sort parameter.
 */
export function dynamicSort(property) {
  let sortOrder = 1;
  if(property[0] === "-") {
      sortOrder = -1;
      property = property.substr(1);
  }
  return function (a,b) {
      /* next line works with strings and numbers, 
       * and you may want to customize it to your needs
       */
      const result = (a[property] < b[property]) ? -1 : (a[property] > b[property]) ? 1 : 0;
      return result * sortOrder;
  }
}

/**
 * Sort function with multiple sort parameters.
 */
export function dynamicSortMultiple() {
  const props = arguments;
  return function (obj1, obj2) {
      let i = 0, result = 0, numberOfProperties = props.length;
      while(result === 0 && i < numberOfProperties) {
          result = dynamicSort(props[i])(obj1, obj2);
          i++;
      }
      return result;
  }
}
