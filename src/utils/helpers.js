function snakeToCamel(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(snakeToCamel);
  if (typeof obj !== 'object' || obj instanceof Date) return obj;

  const camelObj = {};
  for (const key of Object.keys(obj)) {
    if (key === 'history' && typeof obj[key] === 'object') {
      camelObj[key] = obj[key];
      continue;
    }
    const camelKey = key.replace(/(_\w)/g, m => m[1].toUpperCase());
    camelObj[camelKey] = snakeToCamel(obj[key]);
  }
  return camelObj;
}

function camelToSnake(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(camelToSnake);
  if (typeof obj !== 'object' || obj instanceof Date) return obj;

  const snakeObj = {};
  for (const key of Object.keys(obj)) {
    if (key === 'history' && typeof obj[key] === 'object') {
      snakeObj[key] = obj[key];
      continue;
    }
    const snakeKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
    snakeObj[snakeKey] = camelToSnake(obj[key]);
  }
  return snakeObj;
}

module.exports = {
  snakeToCamel,
  camelToSnake
};