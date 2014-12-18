var groups = {};

module.exports = function(group_id) {
  var existing_group = groups[group_id];
  if (existing_group) {
    return existing_group;
  }

  var self = Object.create(new process.EventEmitter());
  groups[group_id] = self;

  var counters = {};
  var messages = [];

  self.increment = function(key, increment) {
    var current_value = counters[key];
    if (!current_value) {
      current_value = 0;
    }
    current_value += increment;
    counters[key] = current_value;

    // notify all subscribers
    var counter_update = {};
    counter_update[key] = current_value;
    self.emit('update', { counters: counter_update });
  };

  self.message = function(metadata) {
    messages.push(metadata);
    self.emit('update', { messages: [ metadata ] });
  };

  self.get_all = function(callback) {
    return callback(null, {
      counters: counters,
      messages: messages,
    });
  };

  return self;
};