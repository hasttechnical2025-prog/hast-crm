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
    let camelKey = key.replace(/(_\w)/g, m => m[1].toUpperCase());

    // Khớp lại tên viết tắt viết hoa (Acronym) cho phía Frontend
    if (camelKey === 'isForCpc') camelKey = 'isForCPC';

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
    let snakeKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();

    // Fix known acronym mappings that regex splits incorrectly
    if (snakeKey === 'is_for_c_p_c') snakeKey = 'is_for_cpc';
    if (snakeKey.includes('c_p_c')) snakeKey = snakeKey.replace(/c_p_c/g, 'cpc');

    snakeObj[snakeKey] = camelToSnake(obj[key]);
  }
  return snakeObj;
}

module.exports = {
  snakeToCamel,
  camelToSnake
};