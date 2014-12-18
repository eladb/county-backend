var groups = {};

var redis_url = process.env.REDISCLOUD_URL || 'redis://localhost:6379';
var redis_subscriber = require('redis-url').connect(redis_url);
var redis_publisher = require('redis-url').connect(redis_url);

redis_subscriber.on('ready', function() {
  console.log('redis connected', redis_url);
  redis_subscriber.psubscribe('group:*');
  redis_subscriber.on('pmessage', function(pattern, channel, message) {
    var msg = JSON.parse(message);
    console.log('received a message from channel', channel, '-', msg);
    var group_id = channel.split(':')[1];
    var group = groups[group_id];
    if (group) {
      group.emit('update', msg);
    }
  });
});

redis_subscriber.on('error', function(err) {
  console.error('cannot connect to redis at', redis_url, '-', err.stack);
});

function publish_to_group(group_id, obj) {
  redis_publisher.publish('group:' + group_id, JSON.stringify(obj));
}

module.exports = function(group_id) {
  var existing_group = groups[group_id];
  if (existing_group) {
    return existing_group;
  }

  var self = Object.create(new process.EventEmitter());
  self.setMaxListeners(1000);

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
    publish_to_group(group_id, { counters: counter_update });
  };

  self.message = function(metadata) {
    messages.push(metadata);
    publish_to_group(group_id, { messages: [ metadata ] });
  };

  self.get_all = function(callback) {
    return callback(null, {
      counters: counters,
      messages: messages,
    });
  };

  return self;
};