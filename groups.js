var groups = {};

var redis_url = process.env.REDISCLOUD_URL || 'redis://localhost:6379';
var redis_subscriber = require('redis-url').connect(redis_url);
var redis_client = require('redis-url').connect(redis_url);

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


module.exports = function(group_id) {
  var existing_group = groups[group_id];
  if (existing_group) {
    return existing_group;
  }

  var self = Object.create(new process.EventEmitter());
  self.setMaxListeners(1000);

  groups[group_id] = self;

  function group_key(subkey) {
    var prefix = 'group:' + group_id;
    return subkey ? prefix + ':' + subkey : prefix;
  }

  function publish_to_group(obj) {
    redis_client.publish(group_key(), JSON.stringify(obj));
  }

  self.increment = function(key, increment) {
    return redis_client.hincrby(group_key('counters'), key, increment, function(err, current_value) {
      if (err) {
        console.error('hincrby error:', err);
        return;
      }

      // notify all subscribers
      var counter_update = {};
      counter_update[key] = current_value;
      publish_to_group({ counters: counter_update });
    });
  };

  self.message = function(metadata) {
    metadata.timestamp = JSON.stringify(new Date()).replace(/\"/g, '');
    var score = Date.now();
    redis_client.zadd(group_key('messages'), score, JSON.stringify(metadata));
    publish_to_group({ messages: [ metadata ] });
  };

  function get_all_counters(callback) {
    return redis_client.hgetall(group_key('counters'), function(err, counters) {
      if (err) {
        return callback(err);
      }

      var output = {};
      for (var key in counters) {
        output[key] = parseInt(counters[key]);
      }

      return callback(null, output);
    });    
  }

  function get_all_messages(callback) {
    return redis_client.zrange(group_key('messages'), 0, -1, function(err, messages) {
      if (err) return callback(err);
      var output = [];
      for (var i = 0; i < messages.length; ++i) {
        output.push(JSON.parse(messages[i]));
      }
      return callback(null, output);
    });
  }

  self.get_all = function(callback) {
    return get_all_counters(function(err, counters) {
      if (err) return callback(err);
      return get_all_messages(function(err, messages) {
        if (err) return callback(err);
        return callback(null, {
          counters: counters,
          messages: messages,
        });
      });
    });
  };

  return self;
};