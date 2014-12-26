exports.json_date = function(date) {
  date = date || new Date();
  return JSON.stringify(date).replace(/\"/g, '');
};