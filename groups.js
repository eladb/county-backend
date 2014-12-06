var groups = {};

module.exports = function(group_id) {
  var existing_group = groups[group_id];
  if (existing_group) {
    return existing_group;
  }

  var self = Object.create(new process.EventEmitter());
  groups[group_id] = self;

  var counters = {};

  self.increment = function(key, increment) {
    var current_value = counters[key];
    if (!current_value) {
      current_value = 0;
    }
    current_value += increment;
    counters[key] = current_value;

    // notify all subscribers
    var update = {};
    update[key] = current_value;
    self.emit('update', update);
  };

  self.get_all = function(callback) {
    return callback(null, counters);
  };

  return self;
};