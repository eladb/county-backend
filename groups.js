var groups = {};

var apn = require('./apn');
var redis = require('./redis');
var utils = require('./util');

var redis_subscriber = redis.pubsub();
var redis_client = redis.connect();

var badger = require('./badger');

redis_subscriber.on('ready', function() {
  redis_subscriber.psubscribe('group:*');
  redis_subscriber.on('pmessage', function(pattern, channel, message) {
    var msg = JSON.parse(message);
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

  // get group metadata
  self.metadata = function(callback) {
    return redis_client.hgetall(group_key(), function(err, formatted_metadata) {
      if (err) return callback(err);
      if (!formatted_metadata) return callback(null, null);
      var metadata = {};

      // parse values from json to their javascript friends
      Object.keys(formatted_metadata).forEach(function(key) {
        var parsed;
        try { metadata[key] = JSON.parse(formatted_metadata[key]) }
        catch (e) { metadata[key] = formatted_metadata[key] } // skip parse
      });

      return callback(null, metadata);
    });
  };

  // update group metadata
  self.update = function(metadata, callback) {
    callback = callback || function() { };

    // stringify each value to json so we preserve type and support complex objects
    // would have been nice if the redis library would do this by default
    var formatted_metadata = {};
    Object.keys(metadata).forEach(function(key) {
      formatted_metadata[key] = JSON.stringify(metadata[key]);
    });

    return redis_client.hmset(group_key(), formatted_metadata, callback);
  };

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

  self.message_scorers = function(user, key, score) {
    // key = message_id
    return redis_client.hget(group_key("message_scorers"), key, function(err, message_scorers) {
      if (err) {
        console.error('hget error:', err);
        return;
      }

      message_scorers = message_scorers ? JSON.parse(message_scorers) : {}

      message_scorers[user] = score;

      return redis_client.hset(group_key("message_scorers"), key, JSON.stringify(message_scorers), function(err) {
        if (err) {
          console.error('hset error:', err);
          return;
        }

        // notify all subscribers
        // var message_scorers = {};
        // message_scorers[user] = score;
        var messages = {};
        messages[key] = message_scorers;
        publish_to_group({ message_scorers: messages });
      });

    })
    
  };


  self.message = function(metadata) {
    metadata.timestamp = utils.json_date();
    var score = Date.now();
    redis_client.zadd(group_key('messages'), score, JSON.stringify(metadata), function(err) {
      return get_message_count(function(err, message_count) {
        if (err) {
          console.error('error: cannot get message count for group', group_id, '--', err);
          return;
        }

        badger.sync_group_count(group_id, message_count);
      });
    });

    publish_to_group({ messages: [ metadata ] });

    // update last-message in group metadata, so we can sort
    // messages based on last message and show the text
    self.update({ last_message: metadata });
  };

  self.push = function(notification) {
    return get_all_members(function(err, members) {
      if (err) {
        console.error('cannot get members to send push:', err);
        return;
      }

      members.forEach(function(user_key) {
        apn.send_push(user_key, notification);
      });
    });
  };

  self.join = function(user_key, callback) {
    callback = callback || function() {};
    return redis_client.sadd(group_key('members'), user_key, callback);
  };

  self.leave = function(user_key, callback) {
    callback = callback || function() {};
    return redis_client.srem(group_key('members'), user_key, callback);
  };

  function get_message_count(callback) {
    return redis_client.zcard(group_key('messages'), callback);
  }

  function get_all_members(callback) {
    return redis_client.smembers(group_key('members'), callback);
  }

  function get_all_message_scorers(callback) {
    return redis_client.hgetall(group_key("message_scorers"), function(err, message_scorers) {
      if (err) {
        console.error('hgetall error:',err);
        return callback(null,null);
      }

      if (!message_scorers) return callback(null, {});

      Object.keys(message_scorers).forEach(function(key) {
        var parsed;
        try { message_scorers[key] = JSON.parse(message_scorers[key]) }
        catch (e) { message_scorers[key] = message_scorers[key] } // skip parse
      });

      callback(null, message_scorers);
    });
  }

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
        return get_all_members(function(err, members) {
          if (err) return callback(err);
          return get_all_message_scorers(function(err, message_scorers) {
            return callback(null, {
            counters: counters,
            messages: messages,
            members: members,
            message_scorers: message_scorers,
            });
          })
        });
      });
    });
  };

  return self;
};